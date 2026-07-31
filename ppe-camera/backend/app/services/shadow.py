r"""
Shadow mode and drift -- watching the live model on real traffic.

Offline evaluation answers "is the challenger better on 200 frames we chose?".
It cannot answer the two questions that actually decide whether a model is
working on this plant, this month:

  1. Would the challenger behave differently on the frames we are ACTUALLY
     seeing — not the curated ones? A golden set is, by construction, the cases
     someone thought to keep. The night shift in the rain is not in it.

  2. Has the world moved under a model that has not changed? A camera gets
     nudged, a floodlight fails, winter arrives and every worker puts on a
     jacket that reads as a vest. Every offline metric stays exactly where it
     was while live performance quietly collapses.

Shadow mode
-----------
A candidate model runs on a sampled fraction of live frames, alongside the model
already serving. Only DISAGREEMENTS are stored. That is deliberate on two
counts: agreement is the overwhelming majority and carries no information a
counter cannot hold, and the disagreements are simultaneously the evidence for
promotion and a perfectly targeted labelling queue — every one is a frame where
the two models cannot both be right, which is exactly where a human label is
worth most.

Sampling matters. Running two models on every frame halves fleet capacity, so
shadow inference is a low, configurable fraction and runs on its own thread with
a bounded queue. A shadow evaluation that degrades live detection would be a
straightforwardly bad trade.

Drift
-----
Each camera accumulates a periodic fingerprint of what it is seeing —
detections per frame, mean confidence, people per frame, per-class rates, scene
brightness. The first stable window becomes that camera's baseline; later
windows are scored against it. Per camera, not fleet-wide, because a gate camera
and a storage yard have nothing in common and a fleet average would hide both.
"""
from __future__ import annotations

import logging
import queue
import threading
import time
from collections import defaultdict, deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from app.core.config import get_settings

log = logging.getLogger(__name__)

# Boxes overlapping by at least this much are treated as the same object, so a
# disagreement means the two models genuinely differ rather than one having
# drawn a slightly looser rectangle.
SAME_BOX_IOU = 0.45


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iou(a, b) -> float:
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    if inter <= 0:
        return 0.0
    union = (ax2 - ax1) * (ay2 - ay1) + (bx2 - bx1) * (by2 - by1) - inter
    return inter / union if union > 0 else 0.0


def diff_detections(live: list[dict], cand: list[dict]) -> list[dict]:
    """What the two models disagree about on one frame.

    Three kinds, and the distinction is what makes the output actionable:

      candidate_found   the challenger sees something live misses. On a safety
                        system this is the interesting direction — a missed
                        violation is the failure that matters.
      live_found        live sees something the challenger misses. A promotion
                        risk: these are the regressions a golden set may not
                        have covered.
      class_conflict    both found the object, disagree on what it is. Usually
                        the most valuable to label, because it is a decision
                        boundary rather than a detection threshold.
    """
    out: list[dict] = []
    used: set[int] = set()

    for l in live:
        best_j, best_iou = -1, 0.0
        for j, c in enumerate(cand):
            if j in used:
                continue
            v = _iou(l["xyxy"], c["xyxy"])
            if v > best_iou:
                best_j, best_iou = j, v
        if best_iou >= SAME_BOX_IOU:
            used.add(best_j)
            c = cand[best_j]
            if c["cls"] != l["cls"]:
                out.append({
                    "kind": "class_conflict", "cls_name": l["cls"],
                    "live": l, "candidate": c,
                    "severity": round(min(l["conf"], c["conf"]), 3),
                })
        else:
            out.append({
                "kind": "live_found", "cls_name": l["cls"],
                "live": l, "candidate": None,
                "severity": round(float(l["conf"]), 3),
            })

    for j, c in enumerate(cand):
        if j in used:
            continue
        out.append({
            "kind": "candidate_found", "cls_name": c["cls"],
            "live": None, "candidate": c,
            "severity": round(float(c["conf"]), 3),
        })
    return out


def _boxes(fr) -> list[dict]:
    return [{"cls": d.cls_name, "conf": round(float(d.confidence), 3),
             "xyxy": [round(float(v), 1) for v in d.xyxy]} for d in fr.detections]


# ------------------------------------------------------------------ shadow run
@dataclass
class ShadowStats:
    frames_sampled: int = 0
    frames_scored: int = 0
    frames_dropped: int = 0
    agreements: int = 0
    disagreements: int = 0
    candidate_found: int = 0
    live_found: int = 0
    class_conflicts: int = 0
    last_error: str = ""
    started_at: float = 0.0


@dataclass
class ShadowRun:
    """One candidate model under evaluation against live traffic."""

    weights: str
    label: str = ""
    sample_rate: float = 0.15          # fraction of inferred frames scored
    max_disagreements: int = 500       # stop storing past this; keep counting
    cameras: list = field(default_factory=list)   # empty == all cameras
    stats: ShadowStats = field(default_factory=ShadowStats)
    _q: "queue.Queue" = field(default_factory=lambda: queue.Queue(maxsize=24))
    _thread: threading.Thread | None = None
    _stop: threading.Event = field(default_factory=threading.Event)
    _model = None
    _counter: int = 0

    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self.stats = ShadowStats(started_at=time.time())
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, daemon=True,
                                        name="ppe-shadow")
        self._thread.start()

    def stop(self, timeout: float = 5.0) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=timeout)
            self._thread = None
        self._model = None

    def offer(self, camera_id: str, frame, live_result) -> None:
        """Called from the camera worker. Samples, never blocks.

        The live result is passed in rather than recomputed: the whole point is
        to compare against the judgement the system actually acted on, and
        re-running the live model would compare against a different one.
        """
        if self._stop.is_set():
            return
        if self.cameras and camera_id not in self.cameras:
            return
        self._counter += 1
        step = max(1, int(round(1.0 / max(0.01, self.sample_rate))))
        if self._counter % step:
            return
        self.stats.frames_sampled += 1
        try:
            self._q.put_nowait((camera_id, frame.copy(), _boxes(live_result),
                                live_result.width, live_result.height))
        except queue.Full:
            # Shadow work is strictly lower priority than live detection.
            # Dropping here is correct: the alternative is queuing frames the
            # candidate will score minutes late, against a scene long gone.
            self.stats.frames_dropped += 1

    def _ensure_model(self):
        if self._model is None:
            from ultralytics import YOLO

            self._model = YOLO(self.weights)
        return self._model

    def _run(self) -> None:
        s = get_settings()
        while not self._stop.is_set():
            try:
                camera_id, frame, live_boxes, w, h = self._q.get(timeout=0.5)
            except queue.Empty:
                continue
            try:
                from app.ml import taxonomy
                from app.ml.detector import Detection, FrameResult

                model = self._ensure_model()
                res = model.predict(frame, conf=s.CONF_THRESHOLD,
                                    iou=s.IOU_THRESHOLD, imgsz=s.IMG_SIZE,
                                    device=s.DEVICE, verbose=False)[0]
                fr = FrameResult(width=w, height=h)
                names = res.names
                if res.boxes is not None:
                    for box in res.boxes:
                        raw = names[int(box.cls)]
                        fr.detections.append(Detection(
                            cls_name=taxonomy.canon(raw) or raw, raw_name=raw,
                            confidence=float(box.conf),
                            xyxy=tuple(float(v) for v in box.xyxy[0].tolist())))
                cand_boxes = _boxes(fr)
                self.stats.frames_scored += 1

                diffs = diff_detections(live_boxes, cand_boxes)
                if not diffs:
                    self.stats.agreements += 1
                    continue
                self.stats.disagreements += 1
                for d in diffs:
                    if d["kind"] == "candidate_found":
                        self.stats.candidate_found += 1
                    elif d["kind"] == "live_found":
                        self.stats.live_found += 1
                    else:
                        self.stats.class_conflicts += 1

                if self.stats.disagreements <= self.max_disagreements:
                    self._persist(camera_id, frame, live_boxes, cand_boxes, diffs)
            except Exception as exc:  # noqa: BLE001 - shadow must never matter
                self.stats.last_error = f"{type(exc).__name__}: {exc}"

    def _persist(self, camera_id: str, frame, live_boxes, cand_boxes, diffs) -> None:
        """Save the frame + the disagreement rows. Best effort."""
        import cv2

        s = get_settings()
        out_dir = s.DATA_DIR / "shadow" / camera_id
        out_dir.mkdir(parents=True, exist_ok=True)
        path = out_dir / f"{int(time.time() * 1000)}.jpg"
        try:
            cv2.imwrite(str(path), frame, [int(cv2.IMWRITE_JPEG_QUALITY), 84])
        except Exception:
            return

        # Keep the most significant disagreement per frame rather than every
        # one: a frame with eight differences is one labelling task, not eight.
        top = max(diffs, key=lambda d: d["severity"])
        rows = [{
            "camera_id": camera_id, "candidate_label": self.label or
            Path(self.weights).name, "image_path": str(path),
            "kind": top["kind"], "cls_name": top["cls_name"],
            "live_boxes": live_boxes, "candidate_boxes": cand_boxes,
            "severity": top["severity"],
        }]
        _schedule_shadow_rows(rows)


def _schedule_shadow_rows(rows: list[dict]) -> None:
    try:
        from app.services import runtime

        loop = getattr(runtime, "_loop", None)
        if loop is None or loop.is_closed():
            return
        import asyncio

        asyncio.run_coroutine_threadsafe(_insert_shadow_rows(rows), loop)
    except Exception as exc:  # noqa: BLE001
        log.warning("could not schedule shadow rows: %s", exc)


async def _insert_shadow_rows(rows: list[dict]) -> None:
    try:
        from app.core.db import SessionLocal
        from app.models.modelops import ShadowVerdict

        async with SessionLocal() as session:
            for r in rows:
                session.add(ShadowVerdict(**r))
            await session.commit()
    except Exception as exc:  # noqa: BLE001
        log.warning("could not store shadow verdicts: %s", exc)


# ------------------------------------------------------------------- the drift
@dataclass
class _CameraWindow:
    frames: int = 0
    detections: int = 0
    persons: int = 0
    conf_sum: float = 0.0
    brightness_sum: float = 0.0
    class_counts: dict = field(default_factory=lambda: defaultdict(int))
    started: float = field(default_factory=time.time)


class DriftMonitor:
    """Rolling per-camera fingerprints, compared against each camera's baseline."""

    def __init__(self, window_s: float = 900.0, min_frames: int = 60) -> None:
        self.window_s = window_s
        self.min_frames = min_frames
        self._windows: dict[str, _CameraWindow] = {}
        self._baselines: dict[str, dict] = {}
        self._lock = threading.Lock()
        self._recent: dict[str, deque] = defaultdict(lambda: deque(maxlen=20))

    def observe(self, camera_id: str, frame, result) -> None:
        """Fold one inferred frame into this camera's window. Cheap by design."""
        with self._lock:
            w = self._windows.get(camera_id)
            if w is None:
                w = self._windows[camera_id] = _CameraWindow()
            w.frames += 1
            w.detections += len(result.detections)
            for d in result.detections:
                w.conf_sum += float(d.confidence)
                w.class_counts[d.cls_name] += 1
                if d.cls_name == "person":
                    w.persons += 1
            # Brightness on every 10th frame only: a full-frame mean is the most
            # expensive thing here and the scene does not change that fast.
            if w.frames % 10 == 0:
                try:
                    w.brightness_sum += float(frame.mean())
                except Exception:
                    pass
            due = (time.time() - w.started >= self.window_s
                   and w.frames >= self.min_frames)
            if not due:
                return
            snapshot = self._close(camera_id, w)
        if snapshot:
            _schedule_drift_row(snapshot)

    def _close(self, camera_id: str, w: _CameraWindow) -> dict | None:
        elapsed = max(1e-3, time.time() - w.started)
        self._windows[camera_id] = _CameraWindow()
        if w.frames < self.min_frames:
            return None
        dets = w.detections / w.frames
        conf = (w.conf_sum / w.detections) if w.detections else 0.0
        persons = w.persons / w.frames
        rates = {k: round(v / w.frames, 4) for k, v in w.class_counts.items()}
        brightness = (w.brightness_sum / max(1, w.frames // 10))

        sample = {
            "camera_id": camera_id, "window_start": _now(), "window_s": elapsed,
            "frames": w.frames, "detections_per_frame": round(dets, 4),
            "mean_confidence": round(conf, 4),
            "persons_per_frame": round(persons, 4), "class_rates": rates,
            "mean_brightness": round(brightness, 2),
        }

        base = self._baselines.get(camera_id)
        if base is None:
            self._baselines[camera_id] = sample
            sample["is_baseline"] = True
            sample["drift_score"] = 0.0
            sample["drift_reason"] = "first stable window — this is the baseline"
        else:
            score, reason = self._score(base, sample)
            sample["is_baseline"] = False
            sample["drift_score"] = score
            sample["drift_reason"] = reason
        try:
            from app.ml.detector import get_detector
            from app.services.evaluation import weights_fingerprint

            sample["weights_sha"] = weights_fingerprint(
                get_detector().active_weights)
        except Exception:
            sample["weights_sha"] = ""
        self._recent[camera_id].append(sample)
        return sample

    @staticmethod
    def _score(base: dict, now: dict) -> tuple[float, str]:
        """Relative change against baseline, worst signal wins.

        Relative rather than absolute because cameras differ by an order of
        magnitude: a gate sees 4 people a frame, a yard sees 0.2, and one
        absolute threshold would either never fire on the gate or fire
        constantly on the yard.
        """
        reasons: list[tuple[float, str]] = []

        def rel(key: str, label: str, floor: float = 0.05) -> None:
            b, n = float(base.get(key) or 0.0), float(now.get(key) or 0.0)
            if b < floor:
                return
            change = (n - b) / b
            if abs(change) >= 0.30:
                reasons.append((abs(change),
                                f"{label} {b:.2f} -> {n:.2f} ({change:+.0%})"))

        rel("detections_per_frame", "detections/frame")
        rel("persons_per_frame", "people/frame")
        rel("mean_confidence", "mean confidence", floor=0.2)
        rel("mean_brightness", "scene brightness", floor=10.0)

        # A gear class that has stopped being detected entirely is the single
        # most informative signal and the easiest to miss in an average.
        for cls, b_rate in (base.get("class_rates") or {}).items():
            if b_rate < 0.05:
                continue
            n_rate = float((now.get("class_rates") or {}).get(cls, 0.0))
            if n_rate <= b_rate * 0.4:
                reasons.append((1.0 - (n_rate / b_rate),
                                f"'{cls}' detections collapsed "
                                f"{b_rate:.2f} -> {n_rate:.2f} per frame"))

        if not reasons:
            return 0.0, "within baseline"
        reasons.sort(reverse=True)
        score = round(min(1.0, reasons[0][0]), 3)
        return score, "; ".join(r[1] for r in reasons[:3])

    def snapshot(self) -> dict:
        with self._lock:
            return {
                "window_s": self.window_s,
                "cameras": [{
                    "camera_id": cam,
                    "frames_in_window": w.frames,
                    "has_baseline": cam in self._baselines,
                    "recent": list(self._recent.get(cam, []))[-5:],
                } for cam, w in self._windows.items()],
            }

    def reset_baseline(self, camera_id: str) -> bool:
        """Forget a camera's baseline — the right move after a deliberate change.

        Moving a camera or changing its lens makes the old baseline meaningless;
        without this the camera would alarm forever on a difference that is now
        simply the truth.
        """
        with self._lock:
            return self._baselines.pop(camera_id, None) is not None


def _schedule_drift_row(sample: dict) -> None:
    try:
        from app.services import runtime

        loop = getattr(runtime, "_loop", None)
        if loop is None or loop.is_closed():
            return
        import asyncio

        asyncio.run_coroutine_threadsafe(_insert_drift(sample), loop)
    except Exception as exc:  # noqa: BLE001
        log.warning("could not schedule drift sample: %s", exc)


async def _insert_drift(sample: dict) -> None:
    try:
        from app.core.db import SessionLocal
        from app.models.modelops import DriftSample

        async with SessionLocal() as session:
            session.add(DriftSample(**sample))
            await session.commit()
    except Exception as exc:  # noqa: BLE001
        log.warning("could not store drift sample: %s", exc)


# ------------------------------------------------------------------- singletons
_shadow: ShadowRun | None = None
_shadow_lock = threading.Lock()
_drift: DriftMonitor | None = None


def get_shadow() -> ShadowRun | None:
    return _shadow


def start_shadow(weights: str, label: str = "", sample_rate: float = 0.15,
                 cameras: list | None = None) -> dict:
    global _shadow
    with _shadow_lock:
        if _shadow is not None:
            _shadow.stop()
        _shadow = ShadowRun(weights=weights, label=label,
                            sample_rate=max(0.01, min(1.0, sample_rate)),
                            cameras=list(cameras or []))
        _shadow.start()
    return shadow_status()


def stop_shadow() -> dict:
    global _shadow
    with _shadow_lock:
        if _shadow is not None:
            _shadow.stop()
            out = shadow_status()
            _shadow = None
            return out
    return {"running": False}


def shadow_status() -> dict:
    s = _shadow
    if s is None:
        return {"running": False}
    st = vars(s.stats)
    scored = st["frames_scored"] or 1
    return {
        "running": s._thread is not None and s._thread.is_alive(),
        "weights": s.weights, "label": s.label,
        "sample_rate": s.sample_rate, "cameras": s.cameras,
        "stats": st,
        "agreement_rate": round(st["agreements"] / scored, 4),
        "elapsed_s": round(time.time() - (st["started_at"] or time.time()), 1),
    }


def get_drift() -> DriftMonitor:
    global _drift
    if _drift is None:
        _drift = DriftMonitor()
    return _drift
