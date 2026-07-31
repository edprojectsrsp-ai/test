r"""
Anonymous re-identification -- "is this the same worker?" without knowing who.

The problem
-----------
`ViolationEvent.employee_id` is never populated, so /api/analytics/repeat-offenders
ranks people by `track:7`. A ByteTrack id survives only as long as the tracker
holds the box: walk behind a column, leave frame for four seconds, or cross to
the next camera, and the same worker becomes track 8, then 12, then 31. The
"repeat offenders" table is therefore counting track fragments, not people, and
the number it shows is meaningless — a worker with six violations in a shift
appears as six different one-time offenders.

The approach, and why it is this one
------------------------------------
An appearance descriptor: a colour signature of the person's crop, split into
horizontal bands so that shirt colour, trouser colour and helmet colour each
contribute separately. Two crops of the same worker in the same clothing score
close together; two different workers usually do not.

This is deliberately NOT face recognition, and that is a design decision rather
than a limitation:

  * **It creates no biometric record.** What is stored is a histogram of colours
    in a bounding box. It cannot be reversed into a face, matched against an
    identity document, or used to find someone in another system. Under the
    DPDP Act 2023 that is a categorically easier thing to justify to a plant's
    workforce than a face database, and it is the difference between a system a
    union will tolerate and one it will not.

  * **It expires.** Descriptors are held for a shift-length TTL and then
    forgotten. The question this answers is "is this the same person as five
    minutes ago", not "who is this person, historically".

  * **It is honest about what it can do.** Clothing-based matching works within
    a shift and degrades when people change clothes, when lighting differs
    sharply between cameras, or when a whole crew wears identical overalls —
    which on a steel plant is common. So matches carry a score, the threshold
    is conservative, and an uncertain match creates a NEW identity rather than
    merging two people. Merging is the dangerous error: it attributes one
    worker's violations to another.

Cost is negligible — a histogram over a small crop, microseconds — which is why
this runs by default where pose does not.
"""
from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field

log = logging.getLogger(__name__)

# Crop geometry. Bands are fractions of the person box, top to bottom:
# head/helmet, torso/shirt, legs/trousers. Torso carries the most signal, so it
# is weighted highest; heads are small and often motion-blurred.
BANDS: tuple[tuple[float, float, float], ...] = (
    (0.00, 0.30, 0.8),      # head + shoulders
    (0.25, 0.70, 1.6),      # torso — the strongest clothing signal
    (0.60, 1.00, 1.0),      # legs
)

H_BINS, S_BINS = 8, 4


@dataclass
class Identity:
    """One tracked appearance. Not a person record — a short-lived signature."""

    key: str
    descriptor: list
    camera_id: str
    first_seen: float
    last_seen: float
    hits: int = 1
    cameras: set = field(default_factory=set)

    def merge(self, other: list, alpha: float = 0.30) -> None:
        """Blend a new observation in.

        A running average rather than a replacement: a single frame where the
        worker is half behind a pillar should nudge the signature, not become it.
        """
        self.descriptor = [(1 - alpha) * a + alpha * b
                           for a, b in zip(self.descriptor, other)]
        norm = sum(v * v for v in self.descriptor) ** 0.5 or 1.0
        self.descriptor = [v / norm for v in self.descriptor]


def describe(frame, xyxy, min_px: int = 32) -> list | None:
    """Appearance descriptor for one person box, or None if not worth computing.

    Returns a unit-length vector. None when the crop is too small to carry
    reliable colour information — a 20-pixel figure at the back of a yard is a
    handful of blurred pixels, and matching on it produces confident nonsense.
    """
    try:
        import cv2
        import numpy as np

        x1, y1, x2, y2 = (int(round(v)) for v in xyxy)
        h, w = frame.shape[:2]
        x1, y1 = max(0, x1), max(0, y1)
        x2, y2 = min(w, x2), min(h, y2)
        if (x2 - x1) < min_px // 2 or (y2 - y1) < min_px:
            return None
        crop = frame[y1:y2, x1:x2]
        if crop.size == 0:
            return None
        crop = cv2.resize(crop, (64, 128))
        hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)

        vec: list[float] = []
        ch, _cw = hsv.shape[:2]
        for lo, hi, weight in BANDS:
            band = hsv[int(ch * lo):max(int(ch * lo) + 1, int(ch * hi))]
            hist = cv2.calcHist([band], [0, 1], None, [H_BINS, S_BINS],
                                [0, 180, 0, 256])
            # Mask out near-black and near-white pixels before normalising:
            # shadow and blown highlights are camera artefacts, not clothing,
            # and they dominate the histogram on a plant floor at night.
            hist = cv2.normalize(hist, hist).flatten()
            vec.extend(float(v) * weight for v in hist)

        norm = sum(v * v for v in vec) ** 0.5
        if norm <= 1e-6:
            return None
        return [v / norm for v in vec]
    except Exception as exc:  # noqa: BLE001 - identity is an enhancement
        log.debug("descriptor failed: %s", exc)
        return None


def similarity(a: list, b: list) -> float:
    """Cosine similarity of two unit vectors, clamped to 0..1."""
    if not a or not b or len(a) != len(b):
        return 0.0
    return max(0.0, min(1.0, sum(x * y for x, y in zip(a, b))))


class ReidGallery:
    """Short-lived appearance memory, per site.

    Thread-safe: camera workers all write into it from their own threads.
    """

    def __init__(self, ttl_s: float = 900.0, match_threshold: float = 0.82,
                 cross_camera_threshold: float = 0.88, max_entries: int = 400) -> None:
        self.ttl_s = ttl_s
        # Same camera: a moderate bar, because lighting and pose are consistent.
        self.match_threshold = match_threshold
        # Across cameras: a deliberately higher bar. Different lighting and
        # angles make scores noisier, and a wrong cross-camera merge attributes
        # one worker's violations to another — the one error worth being
        # conservative about.
        self.cross_camera_threshold = cross_camera_threshold
        self.max_entries = max_entries
        self._entries: dict[str, Identity] = {}
        self._seq = 0
        self._lock = threading.Lock()
        self.stats = {"matched": 0, "created": 0, "cross_camera": 0, "evicted": 0}

    def _evict(self, now: float) -> None:
        dead = [k for k, e in self._entries.items() if now - e.last_seen > self.ttl_s]
        for k in dead:
            del self._entries[k]
        self.stats["evicted"] += len(dead)
        if len(self._entries) > self.max_entries:
            # Oldest first. A site memory that grows without bound would slow
            # every match down as the shift wears on.
            for k, _ in sorted(self._entries.items(),
                               key=lambda kv: kv[1].last_seen)[
                    :len(self._entries) - self.max_entries]:
                del self._entries[k]

    def match(self, descriptor: list, camera_id: str,
              now: float | None = None) -> tuple[str, float, bool]:
        """Find (or create) the identity for this appearance.

        Returns (key, score, is_new). An uncertain match deliberately creates a
        new identity: splitting one worker into two understates their violation
        count, whereas merging two workers attributes one person's violations to
        another. Only one of those is defensible in a disciplinary meeting.
        """
        now = time.time() if now is None else now
        if not descriptor:
            with self._lock:
                self._seq += 1
                key = f"p{self._seq}"
            return key, 0.0, True

        with self._lock:
            self._evict(now)
            best_key, best_score, best_same_cam = None, 0.0, False
            for key, ent in self._entries.items():
                score = similarity(descriptor, ent.descriptor)
                same_cam = ent.camera_id == camera_id
                threshold = (self.match_threshold if same_cam
                             else self.cross_camera_threshold)
                if score >= threshold and score > best_score:
                    best_key, best_score, best_same_cam = key, score, same_cam

            if best_key is not None:
                ent = self._entries[best_key]
                ent.merge(descriptor)
                ent.last_seen = now
                ent.hits += 1
                if ent.camera_id != camera_id:
                    ent.cameras.add(ent.camera_id)
                    ent.cameras.add(camera_id)
                    ent.camera_id = camera_id
                    self.stats["cross_camera"] += 1
                self.stats["matched"] += 1
                return best_key, best_score, False

            self._seq += 1
            key = f"p{self._seq}"
            self._entries[key] = Identity(
                key=key, descriptor=list(descriptor), camera_id=camera_id,
                first_seen=now, last_seen=now, cameras={camera_id})
            self.stats["created"] += 1
            return key, best_score, True

    def get(self, key: str) -> Identity | None:
        with self._lock:
            return self._entries.get(key)

    def snapshot(self) -> dict:
        now = time.time()
        with self._lock:
            people = [{
                "key": e.key,
                "cameras": sorted(e.cameras) or [e.camera_id],
                "hits": e.hits,
                "age_s": round(now - e.first_seen, 1),
                "idle_s": round(now - e.last_seen, 1),
                "seen_on_multiple_cameras": len(e.cameras) > 1,
            } for e in self._entries.values()]
        people.sort(key=lambda p: -p["hits"])
        return {
            "tracked": len(people),
            "ttl_s": self.ttl_s,
            "match_threshold": self.match_threshold,
            "cross_camera_threshold": self.cross_camera_threshold,
            "stats": dict(self.stats),
            "people": people[:100],
            "note": ("Anonymous appearance signatures — colour histograms, not "
                     "faces. They expire after the TTL and cannot identify "
                     "anyone; they answer 'same person as a moment ago', not "
                     "'who is this'."),
        }

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()


_gallery: ReidGallery | None = None
_lock = threading.Lock()


def get_gallery() -> ReidGallery:
    global _gallery
    if _gallery is None:
        with _lock:
            if _gallery is None:
                from app.core.config import get_settings

                s = get_settings()
                _gallery = ReidGallery(
                    ttl_s=s.REID_TTL_S,
                    match_threshold=s.REID_THRESHOLD,
                    cross_camera_threshold=s.REID_CROSS_THRESHOLD)
    return _gallery
