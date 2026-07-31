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
    # Why this fired, in the operator's words. A fall alert that says
    # "torso 71deg from vertical, head 0.04 body-heights above hips" is
    # arguable; one that says nothing is just an accusation.
    detail: str = ""


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
    # With a calibrated ground plane this becomes a real distance instead of a
    # pixel overlap, which is the only version of "near miss" that means
    # anything: two boxes can overlap in the image and be twenty metres apart.
    near_miss_metres: float = 3.0
    ground_plane: object | None = None
    fall_ar_thresh: float = 1.2          # w/h above this (and sustained) => lying
    # Pose thresholds, used when keypoints are available.
    # Keypoint spread wide:tall above this == body lying across the view. Uses
    # the keypoints rather than the box, so a worker bent over a valve (box
    # wide, body still vertical) is not called a fall.
    fall_ratio: float = 1.15
    # The temporal half: this person's keypoint height dropping to below this
    # fraction of their own running median. Catches the fall toward the camera
    # that no single frame can see.
    fall_height_drop: float = 0.45
    fall_height_min_samples: int = 8
    fall_min_frames: int = 4
    cooldown_s: float = 5.0


class HazardEngine:
    """Stateful per camera. Complements ViolationEngine (PPE)."""

    def __init__(self, cfg: HazardConfig | None = None) -> None:
        self.cfg = cfg or HazardConfig()
        self._fall_hist: dict[int, deque] = defaultdict(
            lambda: deque(maxlen=max(self.cfg.fall_min_frames * 2, 8))
        )
        # Per-person keypoint-height history, for the collapse test. Bounded so
        # a long-running camera cannot grow it without limit.
        self._height_hist: dict[int, deque] = defaultdict(
            lambda: deque(maxlen=60))
        self._last_fire: dict[tuple, float] = {}

    def _fresh(self, key, now) -> bool:
        last = self._last_fire.get(key, 0.0)
        if now - last < self.cfg.cooldown_s:
            return False
        self._last_fire[key] = now
        return True

    def update(self, fr: FrameResult, poses: dict | None = None) -> list[HazardEvent]:
        now = time.time()
        people = [d for d in fr.detections if d.cls_name == "person"]
        events: list[HazardEvent] = []
        self._poses = poses or {}

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
            plane = self.cfg.ground_plane
            for person in people:
                for v in vehicles:
                    # Ground distance when the camera is calibrated, pixel
                    # overlap otherwise. The overlap test is kept only as a
                    # fallback: boxes that overlap in the image are frequently
                    # far apart in the world (one simply behind the other), and
                    # boxes that never touch can be two metres apart, so it
                    # both misses and false-fires.
                    near, detail = False, ""
                    if plane is not None and getattr(plane, "usable", False):
                        d_m = plane.distance_between_people(person.xyxy, v.xyxy)
                        if d_m is not None:
                            near = d_m <= self.cfg.near_miss_metres
                            detail = (f"{d_m:.1f} m from vehicle "
                                      f"(limit {self.cfg.near_miss_metres:.1f} m)")
                    if not detail:
                        overlap = _iou(person.xyxy, v.xyxy)
                        near = overlap >= self.cfg.near_miss_iou
                        detail = (f"box overlap {overlap:.2f} — camera not "
                                  f"calibrated, so this is not a real distance")
                    if near:
                        tid = person.track_id
                        if self._fresh(("nearmiss", tid), now):
                            events.append(HazardEvent(
                                rule_type="near_miss", gear="near_miss",
                                track_id=tid, person_box=person.xyxy,
                                confidence=min(person.confidence, v.confidence),
                                at=now, detail=detail,
                            ))
                        break

        return events

    def _falls(self, people, now) -> list[HazardEvent]:
        """Fall detection, by pose when available and by box shape otherwise.

        The box-shape test — "wider than tall means lying down" — is wrong in
        both directions, and both matter:

          MISSES a fall toward or away from the camera. The person collapses,
          their box stays tall and narrow, and nothing fires. That is a safety
          failure, and it is the commonest fall geometry on a camera mounted
          looking down a walkway.

          FIRES on anyone bending, kneeling, or crouching to work, whose box is
          genuinely wider than tall while they are perfectly fine. False falls
          are how a site learns to mute the alert channel.

        Pose answers it properly: the torso has to have gone horizontal AND the
        head has to have dropped to hip level, sustained across frames. Bending
        keeps the head well above the hips; a crouch keeps the torso upright.
        """
        out = []
        seen = set()
        poses = getattr(self, "_poses", {}) or {}
        for idx, person in enumerate(people):
            tid = person.track_id if person.track_id is not None else -1
            seen.add(tid)
            pose = poses.get(idx)

            reason = ""
            if pose is not None:
                lying, reason = pose.is_supine(ratio=self.cfg.fall_ratio)
                if not lying:
                    if "too few keypoints" in reason:
                        # Keypoints occluded: fall back rather than silently
                        # stopping fall detection on this person.
                        pose = None
                    else:
                        # Second chance: a fall straight toward or away from the
                        # camera is foreshortened into a standing-shaped body,
                        # so no single frame can see it. What gives it away is
                        # that THIS person's keypoint height has collapsed
                        # against their own recent norm — they were 300px tall
                        # for the last minute and are 60px tall now.
                        lying, reason = self._collapsed(tid, pose, reason)
            if pose is None:
                x1, y1, x2, y2 = person.xyxy
                w, h = max(1e-3, x2 - x1), max(1e-3, y2 - y1)
                lying = (w / h) >= self.cfg.fall_ar_thresh
                reason = f"box aspect {w / h:.2f} (no pose)"

            hist = self._fall_hist[tid]
            hist.append(lying)
            if lying and hist.count(True) >= self.cfg.fall_min_frames:
                if self._fresh(("fall", tid), now):
                    out.append(HazardEvent(
                        rule_type="fall", gear="fall", track_id=person.track_id,
                        person_box=person.xyxy, confidence=person.confidence,
                        at=now, detail=reason,
                    ))
        for tid in list(self._fall_hist.keys()):
            if tid not in seen:
                del self._fall_hist[tid]
                self._height_hist.pop(tid, None)
        return out

    def _collapsed(self, tid: int, pose, reason: str) -> tuple[bool, str]:
        """Has this person's standing height suddenly collapsed?

        Tracks a running history of each person's visible keypoint height and
        compares the current frame against their own established median. A
        person who has been ~300 px tall for the last minute and is now 60 px
        tall has gone down, whatever direction they fell in.

        Per person, and against their own history, because absolute pixel
        heights mean nothing across a scene — someone at the back of a yard is
        legitimately a fifth the height of someone at the gate.
        """
        span = pose.visible_span()
        if span is None:
            return False, reason
        height = span[1]
        hist = self._height_hist[tid]
        # Judge BEFORE recording, so the collapsed frame cannot drag its own
        # baseline down; and require enough history that "median" means something.
        verdict, why = False, reason
        if len(hist) >= self.cfg.fall_height_min_samples:
            ordered = sorted(hist)
            median = ordered[len(ordered) // 2]
            if median > 1e-6 and height <= median * self.cfg.fall_height_drop:
                verdict = True
                why = (f"keypoint height collapsed {median:.0f}px -> "
                       f"{height:.0f}px ({height / median:.0%} of this "
                       f"person's normal) — probable fall toward the camera")
        # A collapsed frame must not join the baseline either, or a person who
        # stays down slowly re-normalises and the alarm silently clears.
        if not verdict:
            hist.append(height)
        return verdict, why

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
