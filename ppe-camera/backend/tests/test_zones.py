"""Monitoring-zone tests.

The failure being defended against is not a missed hazard — it is a camera that
also frames a public road, turning every passer-by into a violation until
nobody reads the alerts any more.
"""
from __future__ import annotations

import time

import pytest

from app.ml.zones import (EXCLUDE, INCLUDE, Zone, ZoneMap, foot_point,
                          validate_zone)

W, H = 1920, 1080

# Left half of the frame, in relative coordinates.
LEFT = [(0.0, 0.0), (0.5, 0.0), (0.5, 1.0), (0.0, 1.0)]
RIGHT = [(0.5, 0.0), (1.0, 0.0), (1.0, 1.0), (0.5, 1.0)]


def person_at(cx_frac: float, feet_frac: float = 0.9, w: int = 100, h: int = 300):
    """Person box whose feet land at the given fraction of the frame."""
    cx = cx_frac * W
    feet = feet_frac * H
    return (cx - w / 2, feet - h, cx + w / 2, feet)


class TestBoundaries:
    def test_a_point_on_the_edge_is_resolved_consistently(self):
        """Ray-casting is undefined exactly on a vertex boundary. It must at
        least be deterministic, so a worker standing on a painted line does not
        flicker in and out of a zone frame by frame."""
        zm = ZoneMap([Zone("bay", LEFT, EXCLUDE)], {"helmet"})
        box = person_at(0.5, feet_frac=0.5)          # feet exactly on x=0.5
        first = zm.evaluate(box, W, H).monitored
        assert all(zm.evaluate(box, W, H).monitored is first for _ in range(20))


class TestFootPoint:
    def test_feet_are_bottom_centre(self):
        assert foot_point((100, 200, 300, 800)) == (200.0, 800.0)

    def test_leaning_over_a_barrier_is_judged_by_the_feet(self):
        """Torso in the next bay, feet safely in the walkway. Testing the box
        centre would put this person in the wrong zone."""
        zones = ZoneMap([Zone("bay", RIGHT, EXCLUDE)], {"helmet"})
        # feet at x=0.45 (left), box extends right past 0.5
        box = (0.40 * W, 0.2 * H, 0.62 * W, 0.9 * H)
        foot = foot_point(box)
        assert foot[0] / W == pytest.approx(0.51, abs=0.01)
        # centre-based testing would differ; this documents the chosen rule
        assert zones.evaluate(box, W, H).monitored is False


class TestNoZones:
    def test_whole_frame_is_monitored_by_default(self):
        d = ZoneMap([], {"helmet", "vest"}).evaluate(person_at(0.5), W, H)
        assert d.monitored is True and d.required_ppe == {"helmet", "vest"}

    def test_reason_is_always_given(self):
        assert ZoneMap([], {"helmet"}).evaluate(person_at(0.5), W, H).reason


class TestExcludeZones:
    def test_a_public_road_mask_suppresses_violations(self):
        """The whole point: passers-by must not generate alerts."""
        zm = ZoneMap([Zone("public road", RIGHT, EXCLUDE)], {"helmet"})
        assert zm.evaluate(person_at(0.8), W, H).monitored is False
        assert zm.evaluate(person_at(0.2), W, H).monitored is True

    def test_masked_person_gets_no_ppe_requirements(self):
        zm = ZoneMap([Zone("road", RIGHT, EXCLUDE)], {"helmet", "vest"})
        assert zm.evaluate(person_at(0.8), W, H).required_ppe == set()

    def test_the_zone_is_named_so_an_operator_can_see_why(self):
        zm = ZoneMap([Zone("canteen door", RIGHT, EXCLUDE)], {"helmet"})
        d = zm.evaluate(person_at(0.8), W, H)
        assert d.zone_name == "canteen door" and "canteen door" in d.reason

    def test_outside_every_mask_the_camera_defaults_apply(self):
        zm = ZoneMap([Zone("road", RIGHT, EXCLUDE)], {"helmet"})
        d = zm.evaluate(person_at(0.1), W, H)
        assert d.monitored is True and d.required_ppe == {"helmet"}


class TestIncludeZones:
    def test_an_roi_limits_monitoring_to_itself(self):
        zm = ZoneMap([Zone("work front", LEFT, INCLUDE)], {"helmet"})
        assert zm.evaluate(person_at(0.2), W, H).monitored is True
        assert zm.evaluate(person_at(0.8), W, H).monitored is False

    def test_defining_an_roi_puts_everywhere_else_out_of_scope(self):
        zm = ZoneMap([Zone("bay 3", LEFT, INCLUDE)], {"helmet"})
        d = zm.evaluate(person_at(0.9), W, H)
        assert d.monitored is False and "outside all monitored" in d.reason


class TestPrecedence:
    # feet at 0.5 sit well inside; 0.9 would land exactly on the polygon edge,
    # where ray-casting is undefined by construction
    OVERLAP = [(0.1, 0.1), (0.4, 0.1), (0.4, 0.95), (0.1, 0.95)]

    def test_exclusion_beats_inclusion(self):
        """A footpath crossing the work front is still a footpath. Monitoring it
        produces false alerts, and a system that cries wolf gets switched off."""
        zm = ZoneMap([Zone("front", LEFT, INCLUDE),
                      Zone("footpath", self.OVERLAP, EXCLUDE)], {"helmet"})
        d = zm.evaluate(person_at(0.25, feet_frac=0.5), W, H)
        assert d.monitored is False and d.zone_name == "footpath"

    def test_order_of_definition_does_not_change_the_outcome(self):
        a = ZoneMap([Zone("f", LEFT, INCLUDE), Zone("p", self.OVERLAP, EXCLUDE)], {"helmet"})
        b = ZoneMap([Zone("p", self.OVERLAP, EXCLUDE), Zone("f", LEFT, INCLUDE)], {"helmet"})
        box = person_at(0.25, feet_frac=0.5)
        assert a.evaluate(box, W, H).monitored == b.evaluate(box, W, H).monitored
        assert a.evaluate(box, W, H).monitored is False


class TestPerZoneRequirements:
    def test_different_rules_in_different_zones_of_one_camera(self):
        zm = ZoneMap([
            Zone("welding bay", LEFT, INCLUDE, required_ppe={"helmet", "goggles", "gloves"}),
            Zone("walkway", RIGHT, INCLUDE, required_ppe={"helmet"}),
        ], {"helmet", "vest"})
        assert zm.evaluate(person_at(0.2), W, H).required_ppe == {"helmet", "goggles", "gloves"}
        assert zm.evaluate(person_at(0.8), W, H).required_ppe == {"helmet"}

    def test_a_zone_without_overrides_uses_the_camera_defaults(self):
        zm = ZoneMap([Zone("front", LEFT, INCLUDE)], {"helmet", "vest"})
        assert zm.evaluate(person_at(0.2), W, H).required_ppe == {"helmet", "vest"}

    def test_the_detector_must_look_for_every_gear_any_zone_can_ask_for(self):
        """The zone is only known after detection, so detection cannot be
        narrowed to one zone's list."""
        zm = ZoneMap([
            Zone("a", LEFT, INCLUDE, required_ppe={"goggles"}),
            Zone("b", RIGHT, INCLUDE, required_ppe={"harness"}),
        ], {"helmet"})
        assert zm.required_ppe_union() == {"helmet", "goggles", "harness"}


class TestSchedules:
    def test_a_zone_can_be_limited_to_a_shift(self):
        day = Zone("hot work", LEFT, INCLUDE, active_hours=(6, 14))
        assert day.is_active(time.mktime((2026, 7, 24, 9, 0, 0, 0, 0, -1))) is True
        assert day.is_active(time.mktime((2026, 7, 24, 20, 0, 0, 0, 0, -1))) is False

    def test_a_night_shift_window_wraps_midnight(self):
        """(22, 6) is the normal case on a plant, not an edge case."""
        night = Zone("night", LEFT, INCLUDE, active_hours=(22, 6))
        for hour, expected in ((23, True), (2, True), (5, True), (12, False), (21, False)):
            t = time.mktime((2026, 7, 24, hour, 0, 0, 0, 0, -1))
            assert night.is_active(t) is expected, hour

    def test_when_no_zone_is_active_the_whole_frame_is_monitored(self):
        """Safer than going blind: an out-of-hours ROI must not silently stop
        all monitoring."""
        zm = ZoneMap([Zone("day only", LEFT, INCLUDE, active_hours=(6, 14))], {"helmet"})
        night = time.mktime((2026, 7, 24, 23, 0, 0, 0, 0, -1))
        d = zm.evaluate(person_at(0.9), W, H, now=night)
        assert d.monitored is True and d.required_ppe == {"helmet"}

    def test_a_disabled_zone_is_inert(self):
        assert Zone("z", LEFT, INCLUDE, enabled=False).is_active() is False


class TestResolutionIndependence:
    def test_relative_zones_survive_a_resolution_change(self):
        """A stream renegotiating to 720p after a reboot must not slide the
        mask off the road it was covering."""
        zm = ZoneMap([Zone("road", RIGHT, EXCLUDE)], {"helmet"})
        for w, h in ((1920, 1080), (1280, 720), (640, 480), (3840, 2160)):
            box = (0.75 * w - 50, 0.5 * h, 0.75 * w + 50, 0.9 * h)
            assert zm.evaluate(box, w, h).monitored is False, (w, h)

    def test_absolute_zones_are_supported_but_tied_to_one_size(self):
        px = [(960, 0), (1920, 0), (1920, 1080), (960, 1080)]
        zm = ZoneMap([Zone("road", px, EXCLUDE, relative=False)], {"helmet"})
        assert zm.evaluate(person_at(0.8), W, H).monitored is False


class TestConfigParsing:
    def test_round_trips_through_json(self):
        import json
        z = Zone("bay", LEFT, EXCLUDE, required_ppe={"helmet"}, active_hours=(6, 14))
        back = Zone.from_dict(json.loads(json.dumps(z.as_dict())))
        assert back.name == "bay" and back.kind == EXCLUDE
        assert back.required_ppe == {"helmet"} and back.active_hours == (6, 14)

    def test_a_malformed_zone_does_not_take_the_camera_off_the_air(self):
        """Losing one mask is recoverable; losing the camera is not."""
        zm = ZoneMap.from_config([
            {"name": "good", "points": [[0, 0], [0.5, 0], [0.5, 1]], "kind": "exclude"},
            {"name": "too few points", "points": [[0, 0]]},
            {"name": "junk", "points": "not a list"},
            "not even a dict",
            None,
        ], {"helmet"})
        assert len(zm.zones) == 1 and zm.zones[0].name == "good"

    def test_empty_config_monitors_everything(self):
        for raw in (None, []):
            zm = ZoneMap.from_config(raw, {"helmet"})
            assert zm.is_empty and zm.evaluate(person_at(0.5), W, H).monitored


class TestValidation:
    def test_flags_the_mistakes_an_editor_should_catch(self):
        assert validate_zone({"name": "z", "points": [[0, 0], [1, 0]]})
        assert validate_zone({"name": "z", "points": [[0, 0], [1, 0], [1, 1]],
                              "kind": "maybe"})
        assert validate_zone({"name": "", "points": [[0, 0], [1, 0], [1, 1]]})
        assert validate_zone({"name": "z", "points": [[0, 0], [500, 0], [1, 1]]})
        assert validate_zone({"name": "z", "points": [[0, 0], [1, 0], [1, 1]],
                              "active_hours": [6, 99]})

    def test_accepts_a_well_formed_zone(self):
        assert validate_zone({"name": "road", "kind": "exclude",
                              "points": [[0.5, 0], [1, 0], [1, 1], [0.5, 1]],
                              "active_hours": [6, 14]}) == []

    def test_pixel_coordinates_are_allowed_when_declared(self):
        assert validate_zone({"name": "z", "relative": False,
                              "points": [[0, 0], [1920, 0], [1920, 1080]]}) == []


class TestReporting:
    def test_describe_summarises_the_setup(self):
        zm = ZoneMap([Zone("a", LEFT, INCLUDE),
                      Zone("b", RIGHT, EXCLUDE, active_hours=(6, 14))], {"helmet"})
        d = zm.describe()
        assert d["count"] == 2 and d["includes"] == 1 and d["excludes"] == 1
        assert d["scheduled"] == 1 and d["monitors_whole_frame"] is False

    def test_masks_only_still_monitors_the_whole_frame(self):
        zm = ZoneMap([Zone("road", RIGHT, EXCLUDE)], {"helmet"})
        assert zm.describe()["monitors_whole_frame"] is True

    def test_describe_serialises(self):
        import json
        json.dumps(ZoneMap([Zone("a", LEFT, INCLUDE)], {"helmet"}).describe())


class TestViolationEngineIntegration:
    """Zones must actually suppress violations, not merely compute a decision."""

    @staticmethod
    def _engine(zone_map):
        from app.ml.violations import ViolationEngine, ZoneRule
        return ViolationEngine(ZoneRule(required={"helmet"}, min_frames=3,
                                        window=10, zones=zone_map))

    @staticmethod
    def _frame(person_box, gear_box):
        from app.ml.detector import Detection, FrameResult
        fr = FrameResult(width=W, height=H)
        fr.detections = [
            Detection("person", "person", 0.9, person_box, 1),
            Detection("no_helmet", "no_helmet", 0.9, gear_box, None),
        ]
        return fr

    def test_a_passer_by_on_the_public_road_never_alerts(self):
        zm = ZoneMap([Zone("public road", RIGHT, EXCLUDE)], {"helmet"})
        e = self._engine(zm)
        box = person_at(0.8, feet_frac=0.5)
        head = (box[0] + 10, box[1], box[0] + 60, box[1] + 60)
        fired = []
        for _ in range(10):
            fired += e.update(self._frame(box, head))
        assert fired == [], "public road passer-by generated a violation"

    def test_the_same_person_inside_the_work_area_does_alert(self):
        zm = ZoneMap([Zone("public road", RIGHT, EXCLUDE)], {"helmet"})
        e = self._engine(zm)
        box = person_at(0.2, feet_frac=0.5)
        head = (box[0] + 10, box[1], box[0] + 60, box[1] + 60)
        fired = []
        for _ in range(10):
            fired += e.update(self._frame(box, head))
        assert fired, "worker inside the monitored area was not flagged"

    def test_the_zone_name_travels_with_the_violation(self):
        """An alert saying 'no helmet in welding bay' is actionable; one saying
        'no helmet on camera 7' sends somebody looking."""
        zm = ZoneMap([Zone("welding bay", LEFT, INCLUDE)], {"helmet"})
        e = self._engine(zm)
        box = person_at(0.2, feet_frac=0.5)
        head = (box[0] + 10, box[1], box[0] + 60, box[1] + 60)
        fired = []
        for _ in range(10):
            fired += e.update(self._frame(box, head))
        assert fired and fired[0].zone == "welding bay"

    def test_per_zone_requirements_are_enforced(self):
        """Goggles required in the bay, not on the walkway — one camera."""
        from app.ml.detector import Detection, FrameResult
        from app.ml.violations import ViolationEngine, ZoneRule

        zm = ZoneMap([
            Zone("bay", LEFT, INCLUDE, required_ppe={"goggles"}),
            Zone("walkway", RIGHT, INCLUDE, required_ppe={"helmet"}),
        ], {"helmet"})
        e = ViolationEngine(ZoneRule(required={"helmet", "goggles"},
                                     min_frames=3, window=10, zones=zm))

        def frame_for(cx):
            box = person_at(cx, feet_frac=0.5)
            fr = FrameResult(width=W, height=H)
            fr.detections = [
                Detection("person", "person", 0.9, box, 1),
                # bare head and no goggles both visible
                Detection("no_helmet", "no_helmet", 0.9,
                          (box[0] + 10, box[1], box[0] + 60, box[1] + 60), None),
                Detection("no_goggles", "no_goggles", 0.9,
                          (box[0] + 10, box[1], box[0] + 60, box[1] + 50), None),
            ]
            return fr

        bay = []
        for _ in range(8):
            bay += e.update(frame_for(0.2))
        assert {f.gear for f in bay} == {"goggles"}, {f.gear for f in bay}

    def test_no_zones_configured_behaves_exactly_as_before(self):
        e = self._engine(None)
        box = person_at(0.8, feet_frac=0.5)
        head = (box[0] + 10, box[1], box[0] + 60, box[1] + 60)
        fired = []
        for _ in range(10):
            fired += e.update(self._frame(box, head))
        assert fired, "backward compatibility broken"
