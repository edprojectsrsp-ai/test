"""
Detector: thin, portable wrapper around Ultralytics YOLO with ByteTrack.

Why this shape:
- Lazy load. We do NOT import ultralytics or torch at module import time so
  the API can boot on a machine while weights are still downloading.
- Weight priority: fine-tuned PPE checkpoint > base COCO weights. This means
  the same code path improves automatically as the active-learning loop
  produces better weights, with zero config change.
- Tracking is built in (ByteTrack) so violation logic is per-person and
  temporally smoothed instead of per-frame-flickery.
"""
from __future__ import annotations

import threading
from dataclasses import dataclass, field
from pathlib import Path

from app.core.config import get_settings
from app.ml import taxonomy


@dataclass
class Detection:
    cls_name: str          # canonical class name (already mapped)
    raw_name: str          # what the model actually said
    confidence: float
    xyxy: tuple[float, float, float, float]
    track_id: int | None = None


@dataclass
class FrameResult:
    detections: list[Detection] = field(default_factory=list)
    width: int = 0
    height: int = 0

    @property
    def has_uncertain(self) -> bool:
        lo, hi = get_settings().LOW_CONF_BAND
        return any(lo <= d.confidence <= hi for d in self.detections)

    def violations(self) -> list[Detection]:
        return [d for d in self.detections if d.cls_name in taxonomy.VIOLATION_CLASSES]


class Detector:
    """Singleton-style detector. Thread-safe lazy init."""

    _instance: "Detector | None" = None
    _lock = threading.Lock()

    def __init__(self) -> None:
        self._model = None
        self._model_lock = threading.Lock()
        self._weights_path: Path | None = None
        self.settings = get_settings()

    @classmethod
    def instance(cls) -> "Detector":
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance

    def _resolve_weights(self) -> str:
        """Fine-tuned checkpoint if present, else base weights (auto-download).

        Supports ppe_active.pt and ppe_active.onnx (nduka1999 ships ONNX).
        """
        wdir = self.settings.WEIGHTS_DIR
        candidates = [
            wdir / self.settings.ACTIVE_WEIGHTS_NAME,
            wdir / "ppe_active.pt",
            wdir / "ppe_active.onnx",
        ]
        # Prefer newest ppe_active.* if multiple exist
        for p in sorted(wdir.glob("ppe_active.*"), key=lambda x: x.stat().st_mtime, reverse=True):
            if p.suffix.lower() in (".pt", ".onnx", ".engine") and p not in candidates:
                candidates.insert(0, p)
        for active in candidates:
            if active.exists() and active.is_file() and active.stat().st_size > 1000:
                self._weights_path = active
                return str(active)
        # Ultralytics fetches base weights (e.g. yolo11m.pt) on first use.
        self._weights_path = Path(self.settings.BASE_WEIGHTS)
        return self.settings.BASE_WEIGHTS

    def _ensure_model(self):
        if self._model is None:
            with self._model_lock:
                if self._model is None:
                    from ultralytics import YOLO  # lazy

                    target = self._resolve_weights()
                    try:
                        self._model = YOLO(target)
                    except Exception:
                        # Requested base (e.g. yolo12) not resolvable in this
                        # ultralytics build -> fall back so we still boot.
                        fb = self.settings.BASE_WEIGHTS_FALLBACK
                        self._weights_path = Path(fb)
                        self._model = YOLO(fb)
        return self._model

    @property
    def active_weights(self) -> str:
        return str(self._weights_path) if self._weights_path else "(not loaded)"

    def reload(self) -> None:
        """Force reload after a retrain drops new active weights."""
        with self._model_lock:
            self._model = None
        try:
            self._ensure_model()
        except Exception as e:
            # Don't take down the API if a bad checkpoint was activated —
            # next infer() will retry / fall back.
            print(f"[detector] reload failed: {e}")

    def infer(self, frame, track: bool = True) -> FrameResult:
        """
        Run detection (optionally with tracking) on a single BGR numpy frame.
        Returns canonical FrameResult. Never raises on unknown labels; they're
        simply skipped from PPE logic but kept as raw for debugging.
        """
        try:
            model = self._ensure_model()
        except Exception as e:
            print(f"[detector] model load failed: {e}")
            h, w = (frame.shape[:2] if getattr(frame, "shape", None) is not None else (0, 0))
            return FrameResult(width=w, height=h)
        s = self.settings

        # optional enhancement (CLAHE/gamma) before detection
        from app.ml.enhance import enhance
        frame = enhance(frame)

        # SAHI sliced inference: small-PPE recall, predict-mode only (no track ids)
        if s.USE_SAHI and not track:
            return self._infer_sahi(model, frame)

        # ONNX export often lacks ByteTrack support — fall back to predict.
        use_track = track
        weights = str(self._weights_path or "").lower()
        if weights.endswith(".onnx"):
            use_track = False

        try:
            if use_track:
                results = model.track(
                    frame, persist=True, conf=s.CONF_THRESHOLD, iou=s.IOU_THRESHOLD,
                    imgsz=s.IMG_SIZE, device=s.DEVICE, verbose=False,
                    tracker=s.TRACKER,
                )
            else:
                results = model.predict(
                    frame, conf=s.CONF_THRESHOLD, iou=s.IOU_THRESHOLD,
                    imgsz=s.IMG_SIZE, device=s.DEVICE, verbose=False,
                )
        except Exception as e:
            # One more try without tracking if track path failed
            if use_track:
                try:
                    results = model.predict(
                        frame, conf=s.CONF_THRESHOLD, iou=s.IOU_THRESHOLD,
                        imgsz=s.IMG_SIZE, device=s.DEVICE, verbose=False,
                    )
                except Exception as e2:
                    print(f"[detector] infer failed: {e2}")
                    h, w = frame.shape[:2]
                    return FrameResult(width=w, height=h)
            else:
                print(f"[detector] infer failed: {e}")
                h, w = frame.shape[:2]
                return FrameResult(width=w, height=h)

        r = results[0]
        h, w = frame.shape[:2]
        out = FrameResult(width=w, height=h)
        names = r.names
        boxes = r.boxes
        if boxes is None:
            return out

        ids = boxes.id.int().tolist() if boxes.id is not None else [None] * len(boxes)
        for box, tid in zip(boxes, ids):
            raw = names[int(box.cls)]
            canonical = taxonomy.canon(raw) or raw  # keep raw if unmapped
            xyxy = tuple(float(v) for v in box.xyxy[0].tolist())
            out.detections.append(
                Detection(
                    cls_name=canonical,
                    raw_name=raw,
                    confidence=float(box.conf),
                    xyxy=xyxy,  # type: ignore[arg-type]
                    track_id=tid,
                )
            )
        return out

    def _infer_sahi(self, model, frame) -> FrameResult:
        """Sliced inference path (small-PPE recall). No track ids by design."""
        from app.ml.sahi_slicer import RawBox, sliced_predict

        s = self.settings

        def predict_tile(sub) -> list:
            res = model.predict(
                sub, conf=s.CONF_THRESHOLD, iou=s.IOU_THRESHOLD,
                imgsz=s.IMG_SIZE, device=s.DEVICE, verbose=False,
            )[0]
            names = res.names
            out = []
            if res.boxes is None:
                return out
            for box in res.boxes:
                raw = names[int(box.cls)]
                out.append(RawBox(
                    cls_name=taxonomy.canon(raw) or raw,
                    raw_name=raw,
                    confidence=float(box.conf),
                    xyxy=tuple(float(v) for v in box.xyxy[0].tolist()),
                ))
            return out

        h, w = frame.shape[:2]
        merged = sliced_predict(
            frame, predict_tile, slice_size=s.SAHI_SLICE,
            overlap=s.SAHI_OVERLAP, iou_thresh=s.IOU_THRESHOLD,
        )
        out = FrameResult(width=w, height=h)
        for rb in merged:
            out.detections.append(Detection(
                cls_name=rb.cls_name, raw_name=rb.raw_name,
                confidence=rb.confidence, xyxy=rb.xyxy, track_id=None,
            ))
        return out


def get_detector() -> Detector:
    return Detector.instance()

