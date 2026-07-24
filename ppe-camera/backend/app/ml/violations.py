"""
Violation engine — industrial grade.

Turns per-frame detections into stable, per-person violations. This is where
false positives go to die, and equally where false *negatives* must not hide:
on a safety system a missed violation is the failure that matters.

What this version fixes, each verified to cause MISSED violations on real
geometry rather than merely adding noise:

1. Anatomical priors. Gear was associated to a person by centre-containment
   anywhere in the box, so a helmet lying on the ground at a worker's feet
   counted as "wearing a helmet" and suppressed the violation entirely. Each
   gear type now has a plausible vertical band within the person box (helmet in
   the head zone, boots at the feet, gloves at arm level); gear outside its
   band is not credited.

2. Identity when tracking is absent. Untracked people were all filed under
   id -1, so in a crowd every person shared one evidence buffer and a
   bare-headed worker's frames cancelled against a helmeted worker's. When the
   tracker yields no id (ONNX weights, or a dropped track) the engine now falls
   back to IoU-matched spatial identity across frames.

3. Occlusion tolerance. History was deleted the instant a person was missing
   from a frame, so one frame of occlusion — constant on a crowded site —
   erased all accumulated evidence and reset the temporal filter. Identities
   now age out after a grace period.

4. Assessability gating. PPE cannot be judged on a 20-pixel figure at the back
   of a yard, and boots cannot be judged on a person truncated by the frame
   edge. Those frames are reported unassessable and contribute no evidence
   either way, which keeps a violation defensible when a contractor disputes it.

5. Confidence-weighted evidence. A 0.26-confidence "no helmet" no longer counts
   the same as a 0.95 one.
"""
from __future__ import annotations

import time
from collections import defaultdict, deque
from dataclasses import dataclass, field

from app.ml.detector import Detection, FrameResult
from app.ml import taxonomy

# ---------------------------------------------------------------------------
# Anatomical bands as fractions of person-box height, measured from the top.
# A helmet sits on the head; a boot does not. Bands are deliberately generous —
# they exist to reject gear at the wrong end of the body, not to demand a
# precise pose — so crouching, ladders and partial occlusion still pass.
GEAR_BANDS: dict[str, tuple[float, float]] = {
    "helmet": (0.00, 0.42),
    "no_helmet": (0.00, 0.42),
    "goggles": (0.00, 0.38),
    "no_goggles": (0.00, 0.38),
    "mask": (0.00, 0.42),
    "no_mask": (0.00, 0.42),
    "vest": (0.10, 0.80),
    "no_vest": (0.10, 0.80),
    "harness": (0.10, 0.85),
    "no_harness": (0.10, 0.85),
    "gloves": (0.25, 0.90),
    "no_gloves": (0.25, 0.90),
    "boots": (0.60, 1.00),
    "no_boots": (0.60, 1.00),
}

BOTTOM_GEAR = {"boots", "no_boots"}
TOP_GEAR = {"helmet", "no_helmet", "goggles", "no_goggles", "mask", "no_mask"}


@dataclass
class ZoneRule:
    """What PPE is required in a given camera/zone, and how strictly."""
    required: set[str] = field(default_factory=lambda: {"helmet", "vest"})
    min_frames: int = 5               # supporting frames needed before firing
    window: int = 15                  # sliding evidence window, in frames
    cooldown_s: float = 3.0           # per (person, gear) re-fire interval
    min_person_px: int = 64           # below this height PPE is not assessable
    min_person_frac: float = 0.0      # additionally require this frac of frame height
    # Escape hatch for low-resolution feeds: a person occupying this much of
    # the frame is close to the camera and assessable regardless of absolute
    # pixels. Without it a 480p or analogue CCTV feed — common on older sites —
    # would be gated out entirely by the absolute floor above.
    always_assess_frac: float = 0.25
    occlusion_grace_frames: int = 15  # frames a lost identity is kept alive
    min_evidence_conf: float = 0.35   # below this a negative detection is weak
    require_band: bool = True         # enforce anatomical placement
    edge_margin_px: int = 4           # how close to the edge counts as truncated


@dataclass
class FiredViolation:
    track_id: int | None
    gear: str                         # the missing item
    person_box: tuple[float, float, float, float]
    confidence: float
    at: float
    rule_type: str = "ppe"            # "ppe" | restricted_area | fall | ...
    evidence_frames: int = 0          # how many frames supported it
    identity: str = ""                # resolved identity key


@dataclass
class PersonAssessment:
    """Per-person, per-gear outcome for one frame — for live diagnostics."""
    identity: str
    gear: str
    state: str                        # has | missing | unknown | unassessable
    confidence: float
    reason: str = ""


def _iou(a, b) -> float:
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    if inter <= 0:
        return 0.0
    area_a = max(1e-6, (ax2 - ax1) * (ay2 - ay1))
    area_b = max(1e-6, (bx2 - bx1) * (by2 - by1))
    return inter / (area_a + area_b - inter)


def _center(box) -> tuple[float, float]:
    return (box[0] + box[2]) / 2, (box[1] + box[3]) / 2


def _contains_center(person, gear) -> bool:
    gx, gy = _center(gear)
    return person[0] <= gx <= person[2] and person[1] <= gy <= person[3]


def in_gear_band(person, gear, item: str) -> bool:
    """Is `gear` in the anatomically plausible band of `person` for `item`?

    This is what stops a helmet on the ground, or a neighbour's boots
    overlapping the box, from being credited as worn PPE.
    """
    band = GEAR_BANDS.get(item)
    if band is None:
        return True                   # unknown gear type: do not constrain
    py1, py2 = person[1], person[3]
    height = py2 - py1
    if height <= 0:
        return False
    _, gy = _center(gear)
    rel = (gy - py1) / height
    lo, hi = band
    return lo <= rel <= hi


class _Identity:
    """A person's evidence buffers, surviving brief occlusion."""

    __slots__ = ("key", "box", "track_id", "last_seen_frame", "history", "last_fire")

    def __init__(self, key: str, box, track_id, frame_no: int, window: int):
        self.key = key
        self.box = box
        self.track_id = track_id
        self.last_seen_frame = frame_no
        self.history: dict[str, deque] = defaultdict(lambda: deque(maxlen=window))
        self.last_fire: dict[str, float] = {}


class ViolationEngine:
    """Stateful per-camera. Create one instance per camera stream."""

    def __init__(self, rule: ZoneRule | None = None) -> None:
        self.rule = rule or ZoneRule()
        self._identities: dict[str, _Identity] = {}
        self._frame_no = 0
        self._next_spatial_id = 0
        self.last_assessments: list[PersonAssessment] = []

    # ---- identity ---------------------------------------------------------
    def _resolve_identity(self, person: Detection) -> _Identity:
        """Tracked id when available, else IoU match against recent identities.

        Without this fallback every untracked person shares one evidence
        buffer, and a bare-headed worker's frames cancel against a helmeted
        worker's.
        """
        if person.track_id is not None:
            key = f"t{person.track_id}"
            ident = self._identities.get(key)
            if ident is None:
                ident = _Identity(key, person.xyxy, person.track_id,
                                  self._frame_no, self.rule.window)
                self._identities[key] = ident
            ident.box = person.xyxy
            ident.last_seen_frame = self._frame_no
            return ident

        best, best_iou = None, 0.0
        for ident in self._identities.values():
            if ident.last_seen_frame == self._frame_no:
                continue              # already claimed by another detection
            score = _iou(ident.box, person.xyxy)
            if score > best_iou:
                best, best_iou = ident, score
        if best is not None and best_iou >= 0.3:
            best.box = person.xyxy
            best.last_seen_frame = self._frame_no
            return best

        key = f"s{self._next_spatial_id}"
        self._next_spatial_id += 1
        ident = _Identity(key, person.xyxy, None, self._frame_no, self.rule.window)
        self._identities[key] = ident
        return ident

    # ---- assessability ----------------------------------------------------
    def _assessable(self, person: Detection, item: str,
                    frame_w: int, frame_h: int) -> tuple[bool, str]:
        x1, y1, x2, y2 = person.xyxy
        height = y2 - y1
        frac = (height / frame_h) if frame_h else 0.0

        min_px = self.rule.min_person_px
        if self.rule.min_person_frac and frame_h:
            min_px = max(min_px, self.rule.min_person_frac * frame_h)
        big_in_frame = (self.rule.always_assess_frac > 0
                        and frac >= self.rule.always_assess_frac)
        if height < min_px and not big_in_frame:
            return False, f"person too small ({int(height)}px < {int(min_px)}px)"
        if self.rule.min_person_frac and frac < self.rule.min_person_frac:
            return False, (f"person too small in frame "
                           f"({frac:.0%} < {self.rule.min_person_frac:.0%})")

        m = self.rule.edge_margin_px
        if item in BOTTOM_GEAR and frame_h and y2 >= frame_h - m:
            return False, "feet outside frame"
        if item in TOP_GEAR and y1 <= m:
            return False, "head outside frame"
        return True, ""

    # ---- per-frame gear association --------------------------------------
    def _person_wears(self, person: Detection, gear_dets: list[Detection],
                      item: str) -> tuple[str, float, str]:
        """Return (state, confidence, reason) for `item` on `person`."""
        neg_cls = taxonomy.GEAR_PAIRS.get(item)

        def candidates(cls_name):
            if not cls_name:
                return []
            out = []
            for g in gear_dets:
                if g.cls_name != cls_name:
                    continue
                if not _contains_center(person.xyxy, g.xyxy):
                    continue
                if self.rule.require_band and not in_gear_band(
                        person.xyxy, g.xyxy, cls_name):
                    continue
                out.append(g)
            return out

        pos_hits = candidates(item)
        neg_hits = candidates(neg_cls)

        # A positive detection wins: seeing the helmet is stronger evidence
        # than a competing "no helmet" box on the same person.
        if pos_hits:
            return "has", max(g.confidence for g in pos_hits), "gear detected in band"
        if neg_hits:
            best = max(g.confidence for g in neg_hits)
            if best < self.rule.min_evidence_conf:
                return "unknown", best, "negative detection below confidence floor"
            return "missing", best, "violation class detected in band"
        return "unknown", 0.0, "no gear evidence"

    # ---- main -------------------------------------------------------------
    def update(self, fr: FrameResult) -> list[FiredViolation]:
        """Feed one frame; return violations that fired THIS frame."""
        self._frame_no += 1
        now = time.time()
        people = [d for d in fr.detections if d.cls_name == "person"]
        gear = [d for d in fr.detections if d.cls_name != "person"]
        fired: list[FiredViolation] = []
        assessments: list[PersonAssessment] = []

        for person in people:
            ident = self._resolve_identity(person)
            for item in self.rule.required:
                ok, why = self._assessable(person, item, fr.width, fr.height)
                if not ok:
                    assessments.append(PersonAssessment(
                        ident.key, item, "unassessable", 0.0, why))
                    # Not evidence either way. Leaving the buffer untouched
                    # avoids both a false clear and an accusation built on
                    # frames we could not actually judge.
                    continue

                state, conf, reason = self._person_wears(person, gear, item)
                assessments.append(PersonAssessment(ident.key, item, state, conf, reason))

                hist = ident.history[item]
                hist.append(conf if state == "missing" else 0.0)

                if state != "missing":
                    continue
                score = sum(1 for w in hist if w >= self.rule.min_evidence_conf)
                if score < self.rule.min_frames:
                    continue
                last = ident.last_fire.get(item, 0.0)
                if now - last <= self.rule.cooldown_s:
                    continue
                ident.last_fire[item] = now
                fired.append(FiredViolation(
                    track_id=ident.track_id,
                    gear=item,
                    person_box=person.xyxy,
                    confidence=conf,
                    at=now,
                    evidence_frames=int(score),
                    identity=ident.key,
                ))

        self.last_assessments = assessments
        self._prune()
        return fired

    def _prune(self) -> None:
        """Age out identities not seen recently, keeping memory bounded.

        Deleting on the first missed frame — as the naive version did — erased
        all evidence on a single frame of occlusion, so the temporal filter
        effectively demanded consecutive visibility and quietly missed
        sustained violations on a crowded site.
        """
        grace = self.rule.occlusion_grace_frames
        stale = [k for k, i in self._identities.items()
                 if self._frame_no - i.last_seen_frame > grace]
        for k in stale:
            del self._identities[k]

    # ---- introspection ----------------------------------------------------
    @property
    def tracked_count(self) -> int:
        return len(self._identities)

    def evidence_for(self, identity: str, gear: str) -> list[float]:
        ident = self._identities.get(identity)
        return list(ident.history[gear]) if ident else []

    def reset(self) -> None:
        self._identities.clear()
        self._frame_no = 0
        self.last_assessments = []
