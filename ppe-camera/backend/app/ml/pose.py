r"""
Pose keypoints -- where the body actually is, instead of where a box assumes it is.

Why this exists
---------------
Two pieces of the pipeline currently reason about anatomy by slicing the person
bounding box into fixed fractions of its height (`GEAR_BANDS`: a helmet must sit
in the top 42%, boots in the bottom 40%, and so on). That works for one posture —
a person standing upright, facing the camera — and it is wrong for every other.

The failure is not theoretical and it is not rare. A worker bending over a
casting, kneeling at a valve, or crouched behind a pipe has their head somewhere
around 55-70% down their own bounding box. Their helmet then falls OUTSIDE the
(0.00, 0.42) head band, is not credited as worn, and the engine accumulates
evidence that they are bare-headed. On a steel plant, bending over is not an
edge case — it is most of the work. The band logic produces false violations
precisely when workers are doing their jobs, which is the fastest way to lose a
site's trust in a safety system.

Fall detection has the mirror problem. `HazardEngine._falls` calls a person
"lying down" when their box is wider than it is tall. That misses a fall
*toward or away from* the camera entirely — the box stays tall, so a genuine
collapse registers as nothing — and it fires on anyone bending, crouching, or
carrying something low. Both directions are bad: the miss is a safety failure,
the false alarm is why people mute the alerts.

Keypoints answer both properly. A helmet is credited when it is near the actual
head; a fall is a torso that has gone horizontal AND a head that has dropped to
hip level AND stayed there.

Cost, and why this is opt-in
----------------------------
This is a second model on top of the detector, and the detector is already the
fleet bottleneck (the whole `inference_budget` module exists because one model
behind one mutex cannot serve twenty cameras). On the CPU-only boxes this runs
on, pose roughly doubles per-frame inference cost.

So: off by default, enabled per camera, and the smallest pose checkpoint by
default. Turn it on for the cameras where posture actually varies — the ones
watching people work — and leave it off on a gate camera where everyone walks
past upright and the bands are already correct.
"""
from __future__ import annotations

import logging
import math
import threading
from dataclasses import dataclass, field

from app.core.config import get_settings

log = logging.getLogger(__name__)

# COCO-17 keypoint order, which every YOLO pose checkpoint emits.
NOSE, L_EYE, R_EYE, L_EAR, R_EAR = 0, 1, 2, 3, 4
L_SHOULDER, R_SHOULDER, L_ELBOW, R_ELBOW = 5, 6, 7, 8
L_WRIST, R_WRIST, L_HIP, R_HIP = 9, 10, 11, 12
L_KNEE, R_KNEE, L_ANKLE, R_ANKLE = 13, 14, 15, 16

HEAD_POINTS = (NOSE, L_EYE, R_EYE, L_EAR, R_EAR)
TORSO_POINTS = (L_SHOULDER, R_SHOULDER, L_HIP, R_HIP)

# A keypoint below this confidence is treated as absent rather than believed.
# Pose models emit a coordinate for every joint whether or not they can see it,
# and an invented ankle behind a pipe would silently move the boots anchor.
MIN_KP_CONF = 0.30

# Which joints anchor which gear, and how far from that anchor a detection may
# sit — as a fraction of the person's box height, so it scales with distance.
GEAR_ANCHORS: dict[str, tuple[tuple[int, ...], float]] = {
    "helmet":   (HEAD_POINTS, 0.28),
    "no_helmet": (HEAD_POINTS, 0.28),
    "goggles":  ((NOSE, L_EYE, R_EYE), 0.20),
    "no_goggles": ((NOSE, L_EYE, R_EYE), 0.20),
    "mask":     ((NOSE, L_EYE, R_EYE), 0.22),
    "no_mask":  ((NOSE, L_EYE, R_EYE), 0.22),
    "vest":     (TORSO_POINTS, 0.42),
    "no_vest":  (TORSO_POINTS, 0.42),
    "harness":  (TORSO_POINTS, 0.45),
    "no_harness": (TORSO_POINTS, 0.45),
    "gloves":   ((L_WRIST, R_WRIST), 0.26),
    "no_gloves": ((L_WRIST, R_WRIST), 0.26),
    "boots":    ((L_ANKLE, R_ANKLE), 0.24),
    "no_boots": ((L_ANKLE, R_ANKLE), 0.24),
}


@dataclass
class PersonPose:
    """One person's keypoints, in frame pixel coordinates."""

    xyxy: tuple[float, float, float, float]
    # 17 x (x, y, confidence)
    points: list[tuple[float, float, float]] = field(default_factory=list)
    score: float = 0.0

    # ---- helpers ---------------------------------------------------------
    def point(self, idx: int) -> tuple[float, float] | None:
        """A keypoint, or None when the model could not actually see it."""
        if idx >= len(self.points):
            return None
        x, y, c = self.points[idx]
        return (x, y) if c >= MIN_KP_CONF else None

    def centroid(self, idxs) -> tuple[float, float] | None:
        pts = [p for p in (self.point(i) for i in idxs) if p is not None]
        if not pts:
            return None
        return (sum(p[0] for p in pts) / len(pts),
                sum(p[1] for p in pts) / len(pts))

    @property
    def height(self) -> float:
        return max(1.0, self.xyxy[3] - self.xyxy[1])

    def anchor(self, item: str) -> tuple[tuple[float, float], float] | None:
        """Where `item` should be on this body, and how far off it may sit."""
        spec = GEAR_ANCHORS.get(item)
        if spec is None:
            return None
        idxs, tol = spec
        # Wrists and ankles come in pairs and gloves/boots are worn on both, so
        # the nearest of the two is the anchor rather than their midpoint —
        # a midpoint between two spread-apart hands is where neither glove is.
        if len(idxs) == 2 and idxs in ((L_WRIST, R_WRIST), (L_ANKLE, R_ANKLE)):
            pts = [p for p in (self.point(i) for i in idxs) if p is not None]
            if not pts:
                return None
            return pts[0], tol * self.height     # caller checks both via matches()
        c = self.centroid(idxs)
        if c is None:
            return None
        return c, tol * self.height

    def matches(self, item: str, gear_box) -> tuple[bool | None, str]:
        """Is this gear detection plausibly ON this body, given the pose?

        Tri-state, and the third state is the important one:

            True   the gear is near the joint that wears it
            False  it is not — reject it
            None   the joints that would judge this are not visible, so this
                   pose has no opinion and the caller should fall back

        None rather than True for "cannot tell" is deliberate. Returning True
        would make an occluded skeleton silently disable the placement check
        altogether; returning False would turn an occluded ankle into a boots
        violation. Neither is honest — having no opinion is.
        """
        spec = GEAR_ANCHORS.get(item)
        if spec is None:
            return None, "no anchor defined for this item"
        idxs, tol = spec
        limit = tol * self.height
        gx = (gear_box[0] + gear_box[2]) / 2
        gy = (gear_box[1] + gear_box[3]) / 2

        candidates: list[tuple[float, float]] = []
        if len(idxs) == 2 and idxs in ((L_WRIST, R_WRIST), (L_ANKLE, R_ANKLE)):
            candidates = [p for p in (self.point(i) for i in idxs) if p is not None]
        else:
            c = self.centroid(idxs)
            if c is not None:
                candidates = [c]

        if not candidates:
            # The joints that would judge this are not visible. Say so; the
            # caller falls back to the box-band heuristic rather than guessing.
            return None, "keypoints not visible"

        best = min(math.dist((gx, gy), c) for c in candidates)
        return (best <= limit,
                f"{best:.0f}px from anchor, limit {limit:.0f}px")

    # ---- posture ---------------------------------------------------------
    def torso_angle_deg(self) -> float | None:
        """Angle of the torso away from vertical. 0 = upright, 90 = horizontal."""
        sh = self.centroid((L_SHOULDER, R_SHOULDER))
        hip = self.centroid((L_HIP, R_HIP))
        if sh is None or hip is None:
            return None
        dx, dy = hip[0] - sh[0], hip[1] - sh[1]
        if abs(dx) < 1e-6 and abs(dy) < 1e-6:
            return None
        # angle from the vertical axis, 0..90
        return abs(math.degrees(math.atan2(abs(dx), abs(dy))))

    def head_above_hips_frac(self) -> float | None:
        """How far the head sits above the hips, as a fraction of body height.

        Positive means head higher than hips (upright or bent). Near zero or
        negative means the head has dropped to hip level — the thing that
        separates a fall from bending over, which keeps the head well above.
        """
        head = self.centroid(HEAD_POINTS)
        hip = self.centroid((L_HIP, R_HIP))
        if head is None or hip is None:
            return None
        return (hip[1] - head[1]) / self.height

    def visible_span(self) -> tuple[float, float] | None:
        """Width and height covered by the keypoints we can actually see.

        Deliberately not the bounding box. The box is drawn by the detector and
        includes whatever it thought was person-shaped; the keypoint spread is
        the body itself, which is what posture questions are about.
        """
        pts = [p for p in (self.point(i) for i in range(17)) if p is not None]
        if len(pts) < 4:
            return None
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        return (max(xs) - min(xs), max(ys) - min(ys))

    def horizontality(self) -> float | None:
        """Keypoint spread width / height. > 1 means the body lies across view."""
        span = self.visible_span()
        if span is None or span[1] <= 1e-6:
            return None
        return span[0] / span[1]

    def is_supine(self, ratio: float = 1.15) -> tuple[bool, str]:
        """Does this body lie across the view?

        This is the single-frame half of fall detection, and it is worth being
        precise about what it can and cannot see.

        It measures the spread of the KEYPOINTS, not the bounding box. That
        matters because the box-aspect test it replaces fires on anyone bending:
        a worker bent over a valve has a box wider than it is tall while their
        keypoints still run mostly vertically — head down near the knees, hips
        up, legs straight — so the body is not actually horizontal.

        What it CANNOT see is a fall directly toward or away from the camera.
        Foreshortening collapses that person into something shaped very like a
        standing one, and no single frame distinguishes them. That case needs
        the person's own history — their keypoint height collapsing against
        their running median — which is stateful and therefore lives in
        HazardEngine._falls, not here.

        Earlier drafts of this used torso angle plus "head below hips". Both are
        wrong: a worker bent double genuinely has their head below their hips,
        so that pair fires on the single commonest posture on a plant floor.
        """
        h = self.horizontality()
        if h is None:
            return False, "too few keypoints visible to judge posture"
        if h >= ratio:
            return True, f"body lies across view (keypoint spread {h:.2f} wide:tall)"
        return False, f"body is upright-ish (keypoint spread {h:.2f} wide:tall)"


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


def attach(person_boxes: list, poses: list[PersonPose],
           min_iou: float = 0.5) -> dict[int, PersonPose]:
    """Match poses to the detector's person boxes, by index into `person_boxes`.

    The pose model finds its own people, which will not be exactly the boxes the
    main detector found. Greedy IoU matching, best pair first, so two people
    standing close together cannot both claim the same skeleton.
    """
    pairs = sorted(
        ((_iou(pb, p.xyxy), i, j)
         for i, pb in enumerate(person_boxes) for j, p in enumerate(poses)),
        reverse=True)
    out: dict[int, PersonPose] = {}
    used_pose: set[int] = set()
    for score, i, j in pairs:
        if score < min_iou or i in out or j in used_pose:
            continue
        out[i] = poses[j]
        used_pose.add(j)
    return out


class PoseEstimator:
    """Lazy, thread-safe wrapper around a YOLO pose checkpoint."""

    _instance: "PoseEstimator | None" = None
    _lock = threading.Lock()

    def __init__(self) -> None:
        self._model = None
        self._model_lock = threading.Lock()
        self._weights = ""
        self.last_error = ""

    @classmethod
    def instance(cls) -> "PoseEstimator":
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance

    @property
    def available(self) -> bool:
        return self._model is not None or not self.last_error

    @property
    def weights(self) -> str:
        return self._weights or get_settings().POSE_WEIGHTS

    def _ensure(self):
        if self._model is None:
            with self._model_lock:
                if self._model is None:
                    from ultralytics import YOLO

                    target = get_settings().POSE_WEIGHTS
                    self._model = YOLO(target)
                    self._weights = target
                    log.info("pose model loaded: %s", target)
        return self._model

    def estimate(self, frame) -> list[PersonPose]:
        """Keypoints for every person in the frame. Never raises."""
        s = get_settings()
        try:
            model = self._ensure()
        except Exception as exc:  # noqa: BLE001 - degrade to no pose
            self.last_error = f"{type(exc).__name__}: {exc}"
            log.warning("pose unavailable: %s", self.last_error)
            return []
        try:
            res = model.predict(frame, conf=s.POSE_CONF, imgsz=s.POSE_IMGSZ,
                                device=s.DEVICE, verbose=False)[0]
        except Exception as exc:  # noqa: BLE001
            self.last_error = f"{type(exc).__name__}: {exc}"
            return []

        out: list[PersonPose] = []
        kps = getattr(res, "keypoints", None)
        boxes = getattr(res, "boxes", None)
        if kps is None or boxes is None:
            return out
        try:
            xy = kps.data.tolist()          # [n][17][3] (x, y, conf)
        except Exception:
            return out
        for i, box in enumerate(boxes):
            if i >= len(xy):
                break
            pts = [(float(p[0]), float(p[1]),
                    float(p[2]) if len(p) > 2 else 1.0) for p in xy[i]]
            out.append(PersonPose(
                xyxy=tuple(float(v) for v in box.xyxy[0].tolist()),
                points=pts, score=float(box.conf)))
        self.last_error = ""
        return out


def get_pose() -> PoseEstimator:
    return PoseEstimator.instance()
