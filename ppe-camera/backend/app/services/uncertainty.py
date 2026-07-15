"""
Uncertainty sampler -- decides WHICH frames earn a human's ten seconds.

Used by the camera worker when a camera is in `collect` (or `strict`) mode.
A frame is harvested only if it is *informative*:
  - detections inside the low-confidence band (model is unsure), or
  - class flicker on a tracked person (helmet <-> NO_helmet across frames),
and it is not a near-duplicate (8x8 average perceptual hash) of a recent
capture, respects a per-camera minimum interval, and stays within an hourly
budget. Result: dozens of high-value frames per shift instead of thousands.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field

from app.core.config import get_settings
from app.ml.detector import FrameResult


def average_hash(frame, hash_size: int = 8) -> int:
    """8x8 average hash without external deps (numpy only, cv2-free)."""
    import numpy as np

    arr = np.asarray(frame)
    if arr.ndim == 3:  # BGR -> gray
        arr = arr[..., 0] * 0.114 + arr[..., 1] * 0.587 + arr[..., 2] * 0.299
    h, w = arr.shape[:2]
    ys = (np.linspace(0, h - 1, hash_size)).astype(int)
    xs = (np.linspace(0, w - 1, hash_size)).astype(int)
    small = arr[np.ix_(ys, xs)]
    bits = (small > small.mean()).flatten()
    value = 0
    for b in bits:
        value = (value << 1) | int(b)
    return value


def hamming(a: int, b: int) -> int:
    return bin(a ^ b).count("1")


@dataclass
class UncertaintySampler:
    min_interval_s: float = 20.0
    phash_min_distance: int = 10
    flicker_window: int = 5
    max_per_hour: int = 40

    _last_capture: dict[str, float] = field(default_factory=dict)
    _recent_hashes: dict[str, list[int]] = field(default_factory=dict)
    _track_history: dict[tuple[str, int], list[str]] = field(default_factory=dict)
    _hour_marks: dict[str, list[float]] = field(default_factory=dict)

    def _budget_ok(self, cam: str, now: float) -> bool:
        marks = [t for t in self._hour_marks.get(cam, []) if now - t < 3600]
        self._hour_marks[cam] = marks
        return len(marks) < self.max_per_hour

    def reasons(self, cam: str, frame, fr: FrameResult, now: float | None = None) -> list[str]:
        """Empty list = not worth capturing. Non-empty = why it is."""
        now = time.time() if now is None else now
        if now - self._last_capture.get(cam, 0.0) < self.min_interval_s:
            return []
        if not self._budget_ok(cam, now):
            return []

        out: list[str] = []
        lo, hi = get_settings().LOW_CONF_BAND
        band = [d for d in fr.detections if lo <= d.confidence <= hi]
        if band:
            confs = [d.confidence for d in band]
            out.append(f"uncertain:{len(band)}@{min(confs):.2f}-{max(confs):.2f}")

        for d in fr.detections:
            if d.track_id is None:
                continue
            key = (cam, d.track_id)
            hist = self._track_history.setdefault(key, [])
            hist.append(d.cls_name)
            if len(hist) > self.flicker_window:
                hist.pop(0)
            if len(hist) >= 3 and len(set(hist)) > 1:
                out.append(f"flicker:track{d.track_id}:{'/'.join(sorted(set(hist)))}")

        if not out:
            return []

        # hash LAST -- only pay for it when the frame is otherwise interesting
        h = average_hash(frame)
        recents = self._recent_hashes.setdefault(cam, [])
        if any(hamming(h, prev) < self.phash_min_distance for prev in recents):
            return []
        recents.append(h)
        if len(recents) > 50:
            recents.pop(0)
        self._last_capture[cam] = now
        self._hour_marks.setdefault(cam, []).append(now)
        return out


_sampler: UncertaintySampler | None = None


def get_sampler() -> UncertaintySampler:
    global _sampler
    if _sampler is None:
        _sampler = UncertaintySampler()
    return _sampler
