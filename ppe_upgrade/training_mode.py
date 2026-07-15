"""training_mode.py — per-camera mode switcher + active-learning collector.

The self-training answer to "I can't label 5,000 images upfront":
run cameras in COLLECT mode; the collector auto-captures ONLY the frames the
model is unsure about (uncertainty band, prediction flicker) — typically a few
dozen per shift, not thousands — with provisional YOLO labels pre-drawn.
Operators fix them in the existing annotation canvas ("correct / new class /
violation / ignore"), and train_cli.py folds the corrections into the next
model version. Accuracy compounds exactly where YOUR plant's dust, angles and
lighting confuse the model — which no public dataset can do.

Modes (per camera, switchable live from the dashboard):
    OFF      source connected, nothing runs
    MONITOR  detect + alert, no collection
    COLLECT  detect + alert + harvest uncertain frames  ← the training mode
    STRICT   detect + alert with lower thresholds (audits/VIP rounds)

Integration seam (one line in the existing detection loop):
    collector.consider(camera_id, frame, detections)
"""
from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Callable, Dict, List, Optional, Tuple


class CameraMode(str, Enum):
    OFF = "off"
    MONITOR = "monitor"
    COLLECT = "collect"
    STRICT = "strict"


@dataclass
class Detection:
    """Minimal detection view (maps 1:1 from the YOLO11 wrapper output)."""
    cls: str
    conf: float
    xyxy: Tuple[float, float, float, float]     # absolute pixels
    track_id: Optional[int] = None


# ---------------------------------------------------------------------------
# Perceptual hash (8x8 average hash) — dedupe near-identical frames without
# an imagehash dependency. Works on any ndarray-like via PIL.
# ---------------------------------------------------------------------------

def average_hash(image, hash_size: int = 8) -> int:
    from PIL import Image
    import numpy as np
    if not isinstance(image, Image.Image):
        arr = np.asarray(image)
        if arr.ndim == 3:
            arr = arr[:, :, ::-1]  # BGR -> RGB
        image = Image.fromarray(arr.astype("uint8"))
    small = image.convert("L").resize((hash_size, hash_size))
    import numpy as np  # noqa: F811
    px = np.asarray(small, dtype="float32")
    bits = (px > px.mean()).flatten()
    value = 0
    for b in bits:
        value = (value << 1) | int(b)
    return value


def hamming(a: int, b: int) -> int:
    return bin(a ^ b).count("1")


# ---------------------------------------------------------------------------
# Uncertainty sampler — decides WHICH frames are worth a human's 10 seconds
# ---------------------------------------------------------------------------

@dataclass
class SamplerConfig:
    conf_low: float = 0.25       # below: model probably hallucinating — interesting
    conf_high: float = 0.60      # above: model confident — boring
    min_interval_s: float = 20.0  # per camera, don't spam the queue
    phash_min_distance: int = 10  # near-duplicate rejection
    flicker_window: int = 5       # frames of track history to detect class flicker
    max_per_hour: int = 40        # hard budget per camera


@dataclass
class UncertaintySampler:
    cfg: SamplerConfig = field(default_factory=SamplerConfig)
    _last_capture: Dict[str, float] = field(default_factory=dict)
    _recent_hashes: Dict[str, List[int]] = field(default_factory=dict)
    _track_history: Dict[Tuple[str, int], List[str]] = field(default_factory=dict)
    _hour_counts: Dict[str, List[float]] = field(default_factory=dict)

    def _budget_ok(self, cam: str, now: float) -> bool:
        window = [t for t in self._hour_counts.get(cam, []) if now - t < 3600]
        self._hour_counts[cam] = window
        return len(window) < self.cfg.max_per_hour

    def reasons(self, cam: str, frame, dets: List[Detection], now: Optional[float] = None) -> List[str]:
        """Return the (possibly empty) list of reasons this frame is worth harvesting."""
        now = time.time() if now is None else now
        if now - self._last_capture.get(cam, 0.0) < self.cfg.min_interval_s:
            return []
        if not self._budget_ok(cam, now):
            return []

        out: List[str] = []
        # 1) uncertainty band — the classic active-learning signal
        band = [d for d in dets if self.cfg.conf_low <= d.conf <= self.cfg.conf_high]
        if band:
            out.append(f"uncertain:{len(band)}@{min(d.conf for d in band):.2f}-{max(d.conf for d in band):.2f}")
        # 2) class flicker on a track (helmet <-> NO_helmet across frames)
        for d in dets:
            if d.track_id is None:
                continue
            key = (cam, d.track_id)
            hist = self._track_history.setdefault(key, [])
            hist.append(d.cls)
            if len(hist) > self.cfg.flicker_window:
                hist.pop(0)
            if len(set(hist)) > 1 and len(hist) >= 3:
                out.append(f"flicker:track{d.track_id}:{'/'.join(sorted(set(hist)))}")
        # 3) detector saw nothing but sampler is asked (caller passes dets=[]
        #    only when a person tracker sees a person the PPE head missed)
        if not dets:
            out.append("person_without_ppe_result")

        if not out:
            return []
        # 4) perceptual-hash dedupe LAST (hash only when otherwise interesting)
        h = average_hash(frame)
        recents = self._recent_hashes.setdefault(cam, [])
        if any(hamming(h, prev) < self.cfg.phash_min_distance for prev in recents):
            return []
        recents.append(h)
        if len(recents) > 50:
            recents.pop(0)
        self._last_capture[cam] = now
        self._hour_counts.setdefault(cam, []).append(now)
        return out


# ---------------------------------------------------------------------------
# Collector — mode gate + disk/DB persistence of harvested samples
# ---------------------------------------------------------------------------

@dataclass
class ActiveLearningCollector:
    """Call collector.consider(...) once per processed frame. In COLLECT mode,
    interesting frames are saved as   <out_dir>/<cam>/<ts>.jpg + .txt (YOLO
    provisional labels) + .json (reasons, confs) and reported to on_sample
    (hook this to the existing review-queue INSERT)."""
    out_dir: str = "ppe_active_samples"
    class_names: List[str] = field(default_factory=lambda: [
        "person", "helmet", "vest", "gloves", "goggles", "boots", "harness",
        "NO_helmet", "NO_vest", "NO_gloves", "NO_goggles", "NO_boots", "NO_harness",
    ])
    sampler: UncertaintySampler = field(default_factory=UncertaintySampler)
    modes: Dict[str, CameraMode] = field(default_factory=dict)
    on_sample: Optional[Callable[[dict], None]] = None

    def set_mode(self, cam: str, mode: CameraMode | str) -> CameraMode:
        m = CameraMode(mode)
        self.modes[cam] = m
        return m

    def get_mode(self, cam: str) -> CameraMode:
        return self.modes.get(cam, CameraMode.MONITOR)

    def thresholds(self, cam: str) -> dict:
        """Detection thresholds per mode — STRICT lowers conf & smoothing."""
        m = self.get_mode(cam)
        if m == CameraMode.STRICT:
            return {"conf": 0.25, "violation_persist_frames": 3}
        return {"conf": 0.40, "violation_persist_frames": 8}

    def consider(self, cam: str, frame, dets: List[Detection], now: Optional[float] = None) -> Optional[dict]:
        if self.get_mode(cam) != CameraMode.COLLECT:
            return None
        reasons = self.sampler.reasons(cam, frame, dets, now=now)
        if not reasons:
            return None
        return self._persist(cam, frame, dets, reasons, now=now)

    def _persist(self, cam: str, frame, dets: List[Detection], reasons: List[str],
                 now: Optional[float] = None) -> dict:
        import numpy as np
        from PIL import Image
        ts = int((time.time() if now is None else now) * 1000)
        cam_dir = os.path.join(self.out_dir, cam)
        os.makedirs(cam_dir, exist_ok=True)
        stem = os.path.join(cam_dir, str(ts))

        arr = np.asarray(frame)
        h, w = arr.shape[:2]
        Image.fromarray(arr[:, :, ::-1].astype("uint8") if arr.ndim == 3 else arr).save(stem + ".jpg", quality=88)

        # provisional YOLO labels (normalized cx cy w h)
        lines = []
        for d in dets:
            if d.cls not in self.class_names:
                continue
            cid = self.class_names.index(d.cls)
            x1, y1, x2, y2 = d.xyxy
            lines.append(f"{cid} {((x1 + x2) / 2) / w:.6f} {((y1 + y2) / 2) / h:.6f} "
                         f"{(x2 - x1) / w:.6f} {(y2 - y1) / h:.6f}")
        with open(stem + ".txt", "w") as f:
            f.write("\n".join(lines))

        meta = {"camera": cam, "ts_ms": ts, "reasons": reasons,
                "detections": [{"cls": d.cls, "conf": round(d.conf, 3)} for d in dets],
                "image": stem + ".jpg", "labels": stem + ".txt", "status": "pending_review"}
        with open(stem + ".json", "w") as f:
            json.dump(meta, f)
        if self.on_sample:
            try:
                self.on_sample(meta)
            except Exception:
                pass
        return meta
