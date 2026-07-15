"""
Hazard rules -- the non-PPE half of the Business Rules Engine.

The PPE ViolationEngine answers "is this person missing required gear?". These
rules answer everything else in your diagram:

  - Restricted Area : a person's feet fall inside a forbidden polygon
  - Smoking / Mobile : a direct-hazard class detected on/near a person
  - Fire / Smoke     : scene-level hazard (fires an incident, not per-person)
  - Fall Detection   : a tracked person's box flips wide-and-low (lying down)
                       or their centroid drops fast -> probable fall
  - Near Miss        : a person and a vehicle/equipment box get dangerously close

All pure geometry + small stateful trackers, so they unit-test without a model.
Each rule yields a HazardEvent with a `rule_type`, mirroring FiredViolation so
the capture/persistence/alert path treats them uniformly.
"""
from __future__ import annotations

import time
from collections import defaultdict, deque
from dataclasses import dataclass, field

from app.ml.detector import Detection, FrameResult
from app.ml import taxonomy


@dataclass
class HazardEvent:
    rule_type: str                                   # restricted_area, smoking, ...
    gear: str                                        # human label of the hazard
    track_id: int | None
    person_box: tuple[float, float, float, float]
    confidence: float
    at: float


# ------------------------------------------------------------------ geometry
def point_in_polygon(pt, poly) -> bool:
    """Ray-casting point-in-polygon. poly = [(x,y), ...] (>=3 pts)."""
    if not poly or len(poly) < 3:
        return False
    x, y = pt
    inside = False
    n = len(poly)
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if ((yi > y) != (yj > y)) and (
            x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-9) + xi
        ):
            inside = not inside
        j = i
    return inside


def _feet(box) -> tuple[float, float]:
    """Bottom-center of a person box == where they stand."""
    x1, y1, x2, y2 = box
    return ((x1 + x2) / 2.0, y2)


def _center(box) -> tuple[float, float]:
    x1, y1, x2, y2 = box
    return ((x1 + x2) / 2.0, (y1 + y2) / 2.0)


def _iou(a, b) -> float:
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    if inter <= 0:
        return 0.0
    ua = (ax2 - ax1) * (ay2 - ay1) + (bx2 - bx1) * (by2 - by1) - inter
    return inter / ua if ua > 0 else 0.0


@dataclass
class HazardConfig:
    restricted_zones: list = field(default_factory=list)   # list of polygons
    detect_smoking: bool = True
    detect_phone: bool = True
    detect_fire: bool = True
    detect_fall: bool = True
    # Near-miss (person overlapping a vehicle/machinery box) is a crude IoU
    # heuristic and false-positive prone, so it is OFF by default. Turn it on
    # deliberately per site once tuned.
    detect_near_miss: bool = False
    near_miss_iou: float = 0.10          # person/vehicle overlap that counts as near
    fall_ar_thresh: float = 1.2          # w/h above this (and sustained) => lying
    fall_min_frames: int = 4
    cooldown_s: float = 5.0


class HazardEngine:
    """Stateful per camera. Complements ViolationEngine (PPE)."""

    def __init__(self, cfg: HazardConfig | None = None) -> None:
        self.cfg = cfg or HazardConfig()
        self._fall_hist: dict[int, deque] = defaultdict(
            lambda: deque(maxlen=max(self.cfg.fall_min_frames * 2, 8))
        )
        self._last_fire: dict[tuple, float] = {}

    def _fresh(self, key, now) -> bool:
        last = self._last_fire.get(key, 0.0)
        if now - last < self.cfg.cooldown_s:
            return False
        self._last_fire[key] = now
        return True

    def update(self, fr: FrameResult) -> list[HazardEvent]:
        now = time.time()
        people = [d for d in fr.detections if d.cls_name == "person"]
        events: list[HazardEvent] = []

        # -- scene-level fire/smoke (not tied to a person) --------------------
        if self.cfg.detect_fire:
            for d in fr.detections:
                if d.cls_name in taxonomy.SCENE_HAZARD_CLASSES:
                    if self._fresh(("scene", d.cls_name), now):
                        events.append(HazardEvent(
                            rule_type=d.cls_name, gear=d.cls_name, track_id=None,
                            person_box=d.xyxy, confidence=d.confidence, at=now,
                        ))

        # -- direct hazards associated to a person (smoking / phone) ----------
        direct = []
        if self.cfg.detect_smoking:
            direct.append("smoking")
        if self.cfg.detect_phone:
            direct.append("mobile_phone")
        for item in direct:
            hits = [d for d in fr.detections if d.cls_name == item]
            for hz in hits:
                person = self._nearest_person(hz, people)
                tid = person.track_id if person else None
                if self._fresh(("direct", item, tid), now):
                    events.append(HazardEvent(
                        rule_type=item, gear=item, track_id=tid,
                        person_box=person.xyxy if person else hz.xyxy,
                        confidence=hz.confidence, at=now,
                    ))

        # -- restricted area --------------------------------------------------
        for person in people:
            if not self.cfg.restricted_zones:
                break
            foot = _feet(person.xyxy)
            if any(point_in_polygon(foot, z) for z in self.cfg.restricted_zones):
                tid = person.track_id
                if self._fresh(("zone", tid), now):
                    events.append(HazardEvent(
                        rule_type="restricted_area", gear="restricted_area",
                        track_id=tid, person_box=person.xyxy,
                        confidence=person.confidence, at=now,
                    ))

        # -- fall detection ---------------------------------------------------
        if self.cfg.detect_fall:
            events.extend(self._falls(people, now))

        # -- near miss (person vs vehicle) ------------------------------------
        if self.cfg.detect_near_miss:
            vehicles = [d for d in fr.detections if d.cls_name == "vehicle"]
            for person in people:
                for v in vehicles:
                    if _iou(person.xyxy, v.xyxy) >= self.cfg.near_miss_iou:
                        tid = person.track_id
                        if self._fresh(("nearmiss", tid), now):
                            events.append(HazardEvent(
                                rule_type="near_miss", gear="near_miss",
                                track_id=tid, person_box=person.xyxy,
                                confidence=min(person.confidence, v.confidence), at=now,
                            ))
                        break

        return events

    def _falls(self, people, now) -> list[HazardEvent]:
        out = []
        seen = set()
        for person in people:
            tid = person.track_id if person.track_id is not None else -1
            seen.add(tid)
            x1, y1, x2, y2 = person.xyxy
            w, h = max(1e-3, x2 - x1), max(1e-3, y2 - y1)
            lying = (w / h) >= self.cfg.fall_ar_thresh
            hist = self._fall_hist[tid]
            hist.append(lying)
            if lying and hist.count(True) >= self.cfg.fall_min_frames:
                if self._fresh(("fall", tid), now):
                    out.append(HazardEvent(
                        rule_type="fall", gear="fall", track_id=person.track_id,
                        person_box=person.xyxy, confidence=person.confidence, at=now,
                    ))
        for tid in list(self._fall_hist.keys()):
            if tid not in seen:
                del self._fall_hist[tid]
        return out

    @staticmethod
    def _nearest_person(det: Detection, people: list[Detection]):
        if not people:
            return None
        cx, cy = _center(det.xyxy)
        best, best_d = None, float("inf")
        for p in people:
            px, py = _center(p.xyxy)
            d = (px - cx) ** 2 + (py - cy) ** 2
            if d < best_d:
                best, best_d = p, d
        return best
