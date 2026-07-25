"""
Monitoring zones — where PPE rules apply, and which rules.

A camera on a real site rarely frames only the work area. It also catches a
public road, the neighbouring contractor's bay, a canteen door, an office
window. Without masking, every passer-by becomes a violation. That is the
failure that gets a safety system switched off: not missing a hazard, but
crying wolf until nobody reads the alerts.

Three capabilities, all per camera:

  * **Exclude zones (masks)** — never enforce inside. The public road.
  * **Include zones (ROI)** — when any exist, enforce *only* inside them.
  * **Per-zone requirements** — the welding bay needs goggles and gloves; the
    walkway crossing it needs only a helmet. One camera, different rules by
    where the person is standing.

Zones also carry an optional schedule, because requirements change by shift: a
hot-work area demands a face shield during the day shift and is empty at night.

`hazards.py` already has restricted-area polygons, but those answer a different
question — "this person should not be here at all". These answer "should this
person's PPE be judged, and against what". Both reuse the same geometry.

Coordinates are stored **relative** (0..1) by default. A zone drawn on a 1920x1080
preview must keep working when the stream renegotiates to 1280x720 after a
camera reboot, and absolute pixels break silently when that happens — the mask
quietly slides off the road it was covering and nobody notices until the false
alerts return.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field

from app.ml.hazards import point_in_polygon

# Zone kinds
INCLUDE = "include"      # only monitor inside (region of interest)
EXCLUDE = "exclude"      # never monitor inside (mask)


@dataclass
class Zone:
    """A polygon on the camera image with rules attached."""

    name: str
    points: list[tuple[float, float]]
    kind: str = INCLUDE
    # Which PPE applies inside. None means "whatever the camera requires".
    required_ppe: set[str] | None = None
    # Optional shift window in local hours, e.g. (6, 14). None = always active.
    active_hours: tuple[int, int] | None = None
    # Coordinates as fractions of width/height rather than pixels.
    relative: bool = True
    enabled: bool = True

    def is_active(self, now: float | None = None) -> bool:
        if not self.enabled:
            return False
        if self.active_hours is None:
            return True
        start, end = self.active_hours
        hour = time.localtime(time.time() if now is None else now).tm_hour
        # A window like (22, 6) legitimately wraps midnight — night shift is the
        # normal case on a plant, not an edge case.
        return (start <= hour or hour < end) if start > end else (start <= hour < end)

    def resolve(self, width: int, height: int) -> list[tuple[float, float]]:
        """Polygon in pixel coordinates for this frame size."""
        if not self.relative:
            return [(float(x), float(y)) for x, y in self.points]
        return [(float(x) * width, float(y) * height) for x, y in self.points]

    def is_valid(self) -> bool:
        return len(self.points) >= 3

    def as_dict(self) -> dict:
        return {
            "name": self.name,
            "points": [[float(x), float(y)] for x, y in self.points],
            "kind": self.kind,
            "required_ppe": sorted(self.required_ppe) if self.required_ppe else None,
            "active_hours": list(self.active_hours) if self.active_hours else None,
            "relative": self.relative,
            "enabled": self.enabled,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "Zone":
        pts = [(float(p[0]), float(p[1])) for p in (d.get("points") or [])
               if len(p) >= 2]
        ppe = d.get("required_ppe")
        hours = d.get("active_hours")
        return cls(
            name=str(d.get("name") or "zone"),
            points=pts,
            kind=EXCLUDE if str(d.get("kind", INCLUDE)).lower() == EXCLUDE else INCLUDE,
            required_ppe=set(ppe) if ppe else None,
            active_hours=(int(hours[0]), int(hours[1])) if hours and len(hours) >= 2 else None,
            relative=bool(d.get("relative", True)),
            enabled=bool(d.get("enabled", True)),
        )


@dataclass
class ZoneDecision:
    """Whether to judge this person, and against what."""
    monitored: bool
    required_ppe: set[str] = field(default_factory=set)
    zone_name: str | None = None
    reason: str = ""


def foot_point(box) -> tuple[float, float]:
    """Bottom-centre of a person box — where they are standing.

    Ground-plane zones must be tested against the feet, not the box centre.
    Someone leaning over a barrier has their torso inside the next bay while
    still standing safely in the walkway, and testing the centre would
    misattribute them.
    """
    x1, y1, x2, y2 = box
    return ((x1 + x2) / 2.0, y2)


class ZoneMap:
    """Per-camera zone set. Cheap to evaluate; called once per person per frame."""

    def __init__(self, zones: list[Zone] | None = None,
                 default_ppe: set[str] | None = None) -> None:
        self.zones = [z for z in (zones or []) if z.is_valid()]
        self.default_ppe = set(default_ppe or set())

    # ---- construction -----------------------------------------------------
    @classmethod
    def from_config(cls, raw: list | None,
                    default_ppe: set[str] | None = None) -> "ZoneMap":
        """Build from the JSON stored in cameras.zones. Never raises.

        A malformed zone must not take a camera off the air, so bad entries are
        dropped rather than propagated — losing one mask is recoverable, losing
        the camera is not.
        """
        zones: list[Zone] = []
        for item in (raw or []):
            try:
                z = Zone.from_dict(item) if isinstance(item, dict) else None
                if z and z.is_valid():
                    zones.append(z)
            except Exception:
                continue
        return cls(zones, default_ppe)

    @property
    def has_includes(self) -> bool:
        return any(z.kind == INCLUDE for z in self.zones)

    @property
    def is_empty(self) -> bool:
        return not self.zones

    # ---- evaluation -------------------------------------------------------
    def evaluate(self, person_box, width: int, height: int,
                 now: float | None = None) -> ZoneDecision:
        """Decide whether this person is monitored, and under which rules."""
        if self.is_empty:
            return ZoneDecision(True, set(self.default_ppe), None,
                                "no zones configured; whole frame monitored")

        foot = foot_point(person_box)
        active = [z for z in self.zones if z.is_active(now)]
        if not active:
            return ZoneDecision(True, set(self.default_ppe), None,
                                "no zone active at this hour; whole frame monitored")

        # Exclusions win. An exclude zone is an explicit statement that the area
        # is not ours — a public footpath overlapping the work front is still a
        # public footpath. Monitoring it produces false violations, and a system
        # that cries wolf gets switched off, which is the worse safety outcome.
        for z in active:
            if z.kind == EXCLUDE and point_in_polygon(foot, z.resolve(width, height)):
                return ZoneDecision(False, set(), z.name,
                                    f"inside excluded zone '{z.name}'")

        includes = [z for z in active if z.kind == INCLUDE]
        if not includes:
            return ZoneDecision(True, set(self.default_ppe), None,
                                "outside all masks; camera defaults apply")

        for z in includes:
            if point_in_polygon(foot, z.resolve(width, height)):
                ppe = set(z.required_ppe) if z.required_ppe else set(self.default_ppe)
                return ZoneDecision(True, ppe, z.name,
                                    f"inside monitored zone '{z.name}'")

        # Include zones exist and the person is in none of them. Defining an ROI
        # is an explicit statement that everywhere else is out of scope.
        return ZoneDecision(False, set(), None,
                            "outside all monitored zones")

    def required_ppe_union(self) -> set[str]:
        """Every gear type any zone can ask for.

        The detector must look for all of them regardless of where a person
        turns out to be standing — the zone is only known after detection.
        """
        out = set(self.default_ppe)
        for z in self.zones:
            if z.required_ppe:
                out |= z.required_ppe
        return out

    # ---- reporting --------------------------------------------------------
    def describe(self) -> dict:
        return {
            "zones": [z.as_dict() for z in self.zones],
            "count": len(self.zones),
            "includes": sum(1 for z in self.zones if z.kind == INCLUDE),
            "excludes": sum(1 for z in self.zones if z.kind == EXCLUDE),
            "scheduled": sum(1 for z in self.zones if z.active_hours),
            "monitors_whole_frame": self.is_empty or not self.has_includes,
        }


def validate_zone(d: dict) -> list[str]:
    """Problems with a zone definition, for the editor to show before saving."""
    problems: list[str] = []
    pts = d.get("points") or []
    if len(pts) < 3:
        problems.append("A zone needs at least three points.")
    if str(d.get("kind", INCLUDE)).lower() not in (INCLUDE, EXCLUDE):
        problems.append(f"kind must be '{INCLUDE}' or '{EXCLUDE}'.")
    if d.get("relative", True):
        for p in pts:
            if len(p) < 2 or not (0.0 <= float(p[0]) <= 1.0 and 0.0 <= float(p[1]) <= 1.0):
                problems.append("Relative points must be between 0 and 1. "
                                "Set relative=false to use pixel coordinates.")
                break
    hours = d.get("active_hours")
    if hours is not None:
        if len(hours) < 2 or not all(0 <= int(h) <= 23 for h in hours[:2]):
            problems.append("active_hours must be two values in 0..23.")
    if not str(d.get("name") or "").strip():
        problems.append("A zone needs a name, so alerts can say where.")
    return problems
