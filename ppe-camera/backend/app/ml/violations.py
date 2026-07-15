"""
Violation engine.

Turns per-frame detections into stable, per-person violations. This is where
false positives go to die. A single frame of "no_helmet" is noise; the same
tracked person missing a helmet across several seconds is a real violation.

Approach:
- Associate PPE boxes to the nearest 'person' box (by IoU / containment).
- Per camera zone, a required-PPE set says what each person MUST wear.
- A violation for (track_id, gear) must persist for >= min_frames within a
  sliding window before it "fires". This is the temporal smoothing.
- Every fired violation is emitted for capture (your choice: capture ALL
  violations to the review queue), subject to a per-(camera,person,gear)
  cooldown so we don't save 30 copies of the same event.
"""
from __future__ import annotations

import time
from collections import defaultdict, deque
from dataclasses import dataclass, field

from app.ml.detector import Detection, FrameResult
from app.ml import taxonomy


@dataclass
class ZoneRule:
    """What PPE is required in a given camera/zone."""
    required: set[str] = field(default_factory=lambda: {"helmet", "vest"})
    min_frames: int = 5        # frames within window before firing
    window: int = 15           # sliding window size in frames


@dataclass
class FiredViolation:
    track_id: int | None
    gear: str                  # e.g. "helmet" (the missing item)
    person_box: tuple[float, float, float, float]
    confidence: float
    at: float
    rule_type: str = "ppe"     # "ppe" | hazard rule_type (restricted_area, fall, ...)


def _iou(a, b) -> float:
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    if inter <= 0:
        return 0.0
    area_a = (ax2 - ax1) * (ay2 - ay1)
    area_b = (bx2 - bx1) * (by2 - by1)
    return inter / (area_a + area_b - inter)


def _contains_center(person, gear) -> bool:
    gx = (gear[0] + gear[2]) / 2
    gy = (gear[1] + gear[3]) / 2
    return person[0] <= gx <= person[2] and person[1] <= gy <= person[3]


class ViolationEngine:
    """Stateful per-camera. Create one instance per camera stream."""

    def __init__(self, rule: ZoneRule | None = None) -> None:
        self.rule = rule or ZoneRule()
        # history[track_id][gear] = deque of bool (missing?) over recent frames
        self._history: dict[int, dict[str, deque]] = defaultdict(
            lambda: defaultdict(lambda: deque(maxlen=self.rule.window))
        )
        self._last_fire: dict[tuple[int | None, str], float] = {}

    def _people_and_gear(self, fr: FrameResult):
        people = [d for d in fr.detections if d.cls_name == "person"]
        gear = [d for d in fr.detections if d.cls_name != "person"]
        return people, gear

    def _person_wears(self, person: Detection, gear_dets: list[Detection], item: str):
        """Return ('has'|'missing'|'unknown', best_conf) for `item` on person."""
        pos_hits = [g for g in gear_dets
                    if g.cls_name == item and _contains_center(person.xyxy, g.xyxy)]
        neg_cls = taxonomy.GEAR_PAIRS.get(item)
        # A "no_gear" box is typically small (a bare head, an ungloved hand)
        # and sits inside the person box, so center-containment is the right
        # association test here -- IoU would be tiny and miss it.
        neg_hits = [g for g in gear_dets
                    if g.cls_name == neg_cls and _contains_center(person.xyxy, g.xyxy)]
        if pos_hits:
            return "has", max(g.confidence for g in pos_hits)
        if neg_hits:
            return "missing", max(g.confidence for g in neg_hits)
        return "unknown", 0.0

    def update(self, fr: FrameResult) -> list[FiredViolation]:
        """Feed one frame; return violations that fired THIS frame."""
        people, gear = self._people_and_gear(fr)
        fired: list[FiredViolation] = []
        now = time.time()

        # mark all currently-tracked people to age out stale ones later
        seen_ids = set()

        for person in people:
            tid = person.track_id if person.track_id is not None else -1
            seen_ids.add(tid)
            for item in self.rule.required:
                state, conf = self._person_wears(person, gear, item)
                missing = state == "missing"
                hist = self._history[tid][item]
                hist.append(missing)

                if missing and hist.count(True) >= self.rule.min_frames:
                    key = (tid, item)
                    last = self._last_fire.get(key, 0.0)
                    # cooldown handled by caller for capture; here we just fire once
                    # per sustained event by requiring the streak to be "fresh"
                    if now - last > 3.0:
                        self._last_fire[key] = now
                        fired.append(
                            FiredViolation(
                                track_id=person.track_id,
                                gear=item,
                                person_box=person.xyxy,
                                confidence=conf,
                                at=now,
                            )
                        )

        # prune history for people no longer visible
        for tid in list(self._history.keys()):
            if tid not in seen_ids:
                del self._history[tid]
        return fired

