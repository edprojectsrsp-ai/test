r"""
Ground-plane calibration -- metres instead of pixels.

Everything geometric in this system is currently expressed in pixels, and pixels
mean different things in different parts of the same frame. A person at the top
of a yard camera is 30 px tall and 60 m away; the same person at the bottom is
400 px tall and 5 m away. That single fact is behind three separate weaknesses:

  * `min_person_px` has to be hand-tuned per camera and is still wrong within
    one camera — one threshold cannot be right for both ends of a long yard.
  * Near-miss is a pixel IoU between a person box and a vehicle box. Boxes that
    overlap in the image can be twenty metres apart in the world (one simply
    behind the other), and boxes that do not overlap at all can be two metres
    apart. It answers a question nobody asked.
  * Restricted zones are drawn in image space, so "3 m clearance around the
    crane rail" is not expressible — only "this polygon of pixels".

A homography fixes all three, for points ON THE GROUND. Four points whose
real-world positions are known give a 3x3 matrix mapping image coordinates to
ground coordinates in metres.

The single most important caveat, stated up front because getting it wrong
produces confident nonsense: **this is valid only for points on the ground
plane.** A person's feet are on the ground; their head is not. Distances must
therefore be computed between FEET points (bottom-centre of the person box).
Feeding a box centroid into this returns a number that looks plausible and is
wrong, which is worse than no number at all — hence `distance_between_people`
takes boxes and extracts the feet itself, rather than trusting callers.

Operators do not know world coordinates, so the practical entry point is
`from_rectangle`: click the four corners of something whose size is known — a
concrete slab, a lane marking, a standard pallet — and give its width and
length. Everything else follows.
"""
from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field

log = logging.getLogger(__name__)

# Reprojection error above this (in metres) means the clicked points do not
# describe a plane consistently — usually because one was not actually on the
# ground, or the "rectangle" was not one.
MAX_ACCEPTABLE_ERROR_M = 0.75


@dataclass
class GroundPlane:
    """Image -> ground-plane mapping for one camera."""

    matrix: list                       # 3x3 homography, row-major
    image_points: list = field(default_factory=list)
    world_points: list = field(default_factory=list)
    unit: str = "m"
    error_m: float = 0.0
    note: str = ""

    def as_dict(self) -> dict:
        return {
            "matrix": self.matrix, "image_points": self.image_points,
            "world_points": self.world_points, "unit": self.unit,
            "error_m": round(self.error_m, 3), "note": self.note,
            "usable": self.usable, "quality": self.quality,
            "exact_fit": self.exact_fit,
        }

    @property
    def usable(self) -> bool:
        """Good enough to compute distances from.

        An exact 4-point fit counts as usable — it is the normal workflow and
        refusing it would leave every camera uncalibrated — but it is reported
        as `unverified` so nobody mistakes "it fitted" for "it is right".
        """
        if not self.matrix:
            return False
        return self.exact_fit or self.error_m <= MAX_ACCEPTABLE_ERROR_M

    @property
    def exact_fit(self) -> bool:
        """Were there exactly 4 points, making the residual meaningless?

        A homography has 8 degrees of freedom and each correspondence supplies
        2 equations, so 4 points determine it exactly and the reprojection error
        is ~0 by construction — for correct clicks and for badly wrong ones
        alike. Reporting that zero as accuracy would tell an operator their
        calibration is perfect when it may be nonsense, which is worse than
        reporting nothing.
        """
        return len(self.image_points) <= 4

    @property
    def quality(self) -> str:
        if not self.matrix:
            return "uncalibrated"
        if self.exact_fit:
            # Nothing has been cross-checked. The honest word for that is
            # "unverified", and the measure endpoint is how it gets verified.
            return "unverified"
        if self.error_m <= 0.15:
            return "excellent"
        if self.error_m <= 0.35:
            return "good"
        if self.error_m <= MAX_ACCEPTABLE_ERROR_M:
            return "usable"
        return "unreliable"

    # ---- mapping ---------------------------------------------------------
    def to_ground(self, x: float, y: float) -> tuple[float, float] | None:
        """Map an image point ON THE GROUND to world metres."""
        m = self.matrix
        if not m:
            return None
        denom = m[2][0] * x + m[2][1] * y + m[2][2]
        if abs(denom) < 1e-9:
            # The point maps to the horizon — infinitely far away. Returning a
            # huge number here would be worse than admitting we cannot say.
            return None
        return ((m[0][0] * x + m[0][1] * y + m[0][2]) / denom,
                (m[1][0] * x + m[1][1] * y + m[1][2]) / denom)

    def distance_m(self, p1: tuple[float, float],
                   p2: tuple[float, float]) -> float | None:
        """Ground distance in metres between two image points on the ground."""
        a, b = self.to_ground(*p1), self.to_ground(*p2)
        if a is None or b is None:
            return None
        return math.dist(a, b)

    @staticmethod
    def feet(box) -> tuple[float, float]:
        """Bottom-centre of a box — where a standing person meets the ground."""
        x1, _y1, x2, y2 = box
        return ((x1 + x2) / 2.0, y2)

    def distance_between_people(self, box_a, box_b) -> float | None:
        """Ground distance between two detections, measured foot to foot.

        Takes boxes rather than points on purpose. A homography is only valid on
        the ground plane, so measuring between box centroids — which float at
        chest height — silently returns a wrong answer. Extracting the feet here
        means a caller cannot make that mistake.
        """
        return self.distance_m(self.feet(box_a), self.feet(box_b))

    def camera_distance_m(self, box) -> float | None:
        """How far this person is from the camera's ground origin, in metres.

        Useful as a physically meaningful replacement for `min_person_px`:
        "PPE cannot be judged beyond 25 m" is a statement an operator can check
        with a tape measure, where "below 64 pixels" is not.
        """
        g = self.to_ground(*self.feet(box))
        if g is None:
            return None
        return math.hypot(g[0], g[1])


def from_points(image_points: list, world_points: list,
                note: str = "") -> tuple[GroundPlane | None, list[str]]:
    """Build a ground plane from >=4 image/world correspondences.

    Returns (plane, problems). A plane is returned even when the error is high,
    with the error reported, so the UI can show an operator that their points do
    not agree rather than silently refusing.
    """
    problems: list[str] = []
    if len(image_points) < 4 or len(world_points) < 4:
        return None, ["need at least 4 points on the ground"]
    if len(image_points) != len(world_points):
        return None, ["image and world point counts differ"]

    try:
        import cv2
        import numpy as np

        src = np.array([[float(p[0]), float(p[1])] for p in image_points],
                       dtype=np.float32)
        dst = np.array([[float(p[0]), float(p[1])] for p in world_points],
                       dtype=np.float32)

        # Collinear points cannot define a plane; findHomography may still
        # return something, and that something is garbage.
        if _degenerate(src):
            problems.append("the image points are nearly collinear — pick four "
                            "that form a wide quadrilateral, not a line")
        if _degenerate(dst):
            problems.append("the world points are nearly collinear")
        if len(image_points) == 4:
            problems += _convex_quad_problems(
                [(float(p[0]), float(p[1])) for p in image_points])

        H, _mask = cv2.findHomography(src, dst, method=0)
        if H is None:
            return None, problems + ["could not fit a plane to these points"]

        matrix = [[float(v) for v in row] for row in H]
        plane = GroundPlane(matrix=matrix,
                            image_points=[list(map(float, p)) for p in image_points],
                            world_points=[list(map(float, p)) for p in world_points],
                            note=note)

        # Reprojection error, in metres, against the operator's own points.
        errs = []
        for (ix, iy), (wx, wy) in zip(image_points, world_points):
            g = plane.to_ground(float(ix), float(iy))
            if g is None:
                problems.append("a calibration point maps to the horizon")
                continue
            errs.append(math.dist(g, (float(wx), float(wy))))
        plane.error_m = max(errs) if errs else 999.0

        if plane.exact_fit:
            # Say plainly that nothing has been verified, and how to verify it.
            plane.note = (plane.note + " | unverified: 4 points fit exactly, so "
                          "the residual proves nothing. Check it with "
                          "/calibration/measure against a distance you know."
                          ).strip(" |")
        elif plane.error_m > MAX_ACCEPTABLE_ERROR_M:
            problems.append(
                f"points disagree by up to {plane.error_m:.2f} m — usually one "
                f"of them was not actually on the ground, or the measured "
                f"rectangle is not the size given")
        return plane, problems
    except Exception as exc:  # noqa: BLE001
        return None, problems + [f"{type(exc).__name__}: {exc}"]


def _convex_quad_problems(quad) -> list[str]:
    """Is this four-point outline a sane, convex, correctly-ordered shape?

    For a 4-point calibration this is the ONLY structural check available —
    reprojection error is identically zero however wrong the clicks were. The
    two mistakes it catches are the two operators actually make: clicking the
    corners in the wrong order (which produces a self-intersecting bow-tie) and
    misplacing one corner far off the ground plane (which usually makes the
    outline concave).
    """
    problems: list[str] = []
    if len(quad) != 4:
        return problems
    # Sign of the cross product at each corner. All four must agree for a
    # convex, consistently-wound quadrilateral.
    signs = []
    for i in range(4):
        ax, ay = quad[i]
        bx, by = quad[(i + 1) % 4]
        cx, cy = quad[(i + 2) % 4]
        cross = (bx - ax) * (cy - by) - (by - ay) * (cx - bx)
        signs.append(cross)
    pos = sum(1 for s in signs if s > 0)
    neg = sum(1 for s in signs if s < 0)
    if pos and neg:
        problems.append(
            "these four corners cross over themselves — click them in order "
            "around the shape (clockwise from the top-left), not diagonally")
    if any(abs(s) < 1e-9 for s in signs):
        problems.append("three of the corners are in a straight line")
    return problems


def _degenerate(pts) -> bool:
    """Are these points nearly collinear (so they cannot define a plane)?"""
    import numpy as np

    if len(pts) < 3:
        return True
    centred = np.array(pts, dtype=float)
    centred = centred - centred.mean(axis=0)
    # Ratio of the two principal spreads: a line has one dominant direction.
    try:
        _u, s, _v = np.linalg.svd(centred)
        return bool(s[0] < 1e-6 or (s[1] / s[0]) < 0.02)
    except Exception:  # noqa: BLE001
        return False


def from_rectangle(image_quad: list, width_m: float, length_m: float,
                   note: str = "") -> tuple[GroundPlane | None, list[str]]:
    """Calibrate from four corners of a known rectangle on the ground.

    The realistic operator workflow: nobody knows world coordinates, but
    everybody can point at something whose size they know — a concrete bay, a
    painted lane, a standard 1.2 x 1.0 m pallet — and click its corners
    clockwise from the top-left.
    """
    if len(image_quad) != 4:
        return None, ["click exactly four corners, clockwise from top-left"]
    if width_m <= 0 or length_m <= 0:
        return None, ["width and length must be positive metres"]
    world = [(0.0, 0.0), (float(width_m), 0.0),
             (float(width_m), float(length_m)), (0.0, float(length_m))]
    return from_points(image_quad, world,
                       note=note or f"{width_m} x {length_m} m reference")


def load(data: dict | None) -> GroundPlane | None:
    """Rebuild a stored plane. Returns None for anything unusable."""
    if not data or not data.get("matrix"):
        return None
    try:
        return GroundPlane(
            matrix=[[float(v) for v in row] for row in data["matrix"]],
            image_points=data.get("image_points") or [],
            world_points=data.get("world_points") or [],
            unit=data.get("unit", "m"),
            error_m=float(data.get("error_m") or 0.0),
            note=data.get("note", ""))
    except Exception:  # noqa: BLE001
        return None
