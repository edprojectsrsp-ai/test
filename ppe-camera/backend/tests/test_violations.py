"""Violation engine tests — the accuracy-critical path.

Each of the first three classes covers a defect verified to cause MISSED
violations on real geometry, which on a safety system is the failure mode that
matters more than noise.
"""
from __future__ import annotations

import os
import tempfile

import pytest

os.environ.setdefault("PPE_ROOT", tempfile.mkdtemp())

from app.ml.detector import Detection, FrameResult
from app.ml.violations import (GEAR_BANDS, PersonAssessment, ViolationEngine,
                               ZoneRule, in_gear_band)


def P(x1, y1, x2, y2, tid=None, conf=0.9):
    return Detection("person", "person", conf, (x1, y1, x2, y2), tid)


def G(cls, x1, y1, x2, y2, conf=0.9):
    return Detection(cls, cls, conf, (x1, y1, x2, y2), None)


def frame(*dets, w=640, h=480):
    fr = FrameResult(width=w, height=h)
    fr.detections = list(dets)
    return fr


def run(engine, fr, n=1):
    fired = []
    for _ in range(n):
        fired.extend(engine.update(fr))
    return fired


# ---- 1. anatomical priors --------------------------------------------------

class TestAnatomicalPriors:
    def test_helmet_on_the_ground_does_not_count_as_worn(self):
        """The defect that hid violations: a helmet at the worker's feet was
        credited because its centre fell inside the person box."""
        e = ViolationEngine(ZoneRule(required={"helmet"}, min_frames=3, window=10))
        # person spans y 100..300; helmet box down at the feet, bare head on top
        fr = frame(P(100, 100, 200, 300, tid=1),
                   G("helmet", 120, 280, 160, 300),
                   G("no_helmet", 120, 100, 160, 140))
        fired = run(e, fr, 6)
        assert fired, "helmet at the feet must not suppress the violation"
        assert fired[0].gear == "helmet"

    def test_helmet_on_the_head_does_count(self):
        e = ViolationEngine(ZoneRule(required={"helmet"}, min_frames=3, window=10))
        fr = frame(P(100, 100, 200, 300, tid=1), G("helmet", 120, 105, 160, 145))
        assert run(e, fr, 6) == []

    def test_boots_band_rejects_boots_at_head_height(self):
        assert in_gear_band((100, 100, 200, 300), (120, 105, 160, 130), "boots") is False
        assert in_gear_band((100, 100, 200, 300), (120, 280, 160, 300), "boots") is True

    def test_bands_tolerate_crouching_and_partial_boxes(self):
        """Bands must reject the wrong end of the body without demanding a
        precise pose, or every crouching worker becomes a false positive."""
        person = (100, 100, 200, 200)          # short box, crouched
        assert in_gear_band(person, (120, 105, 160, 130), "helmet") is True
        assert in_gear_band(person, (120, 150, 160, 175), "vest") is True

    def test_unknown_gear_type_is_not_constrained(self):
        assert in_gear_band((0, 0, 10, 100), (0, 90, 10, 100), "exoskeleton") is True

    def test_zero_height_person_is_rejected_not_crashed(self):
        assert in_gear_band((100, 100, 200, 100), (120, 100, 160, 100), "helmet") is False

    def test_band_enforcement_can_be_disabled(self):
        e = ViolationEngine(ZoneRule(required={"helmet"}, min_frames=3,
                                     window=10, require_band=False))
        fr = frame(P(100, 100, 200, 300, tid=1),
                   G("helmet", 120, 280, 160, 300),
                   G("no_helmet", 120, 100, 160, 140))
        assert run(e, fr, 6) == []


# ---- 2. identity without tracking ------------------------------------------

class TestIdentityWithoutTracking:
    def test_two_untracked_people_are_not_merged(self):
        """Previously both collapsed onto id -1 and their evidence cancelled."""
        e = ViolationEngine(ZoneRule(required={"helmet"}, min_frames=3, window=10))
        fr = frame(P(0, 100, 100, 300), G("no_helmet", 20, 105, 60, 145),
                   P(300, 100, 400, 300), G("helmet", 320, 105, 360, 145))
        fired = run(e, fr, 6)
        assert fired, "bare-headed worker must still fire alongside a compliant one"
        assert e.tracked_count == 2

    def test_untracked_person_keeps_identity_across_frames(self):
        e = ViolationEngine(ZoneRule(required={"helmet"}, min_frames=5, window=15))
        for dx in range(6):                    # walking slowly, boxes overlap
            e.update(frame(P(100 + dx * 3, 100, 200 + dx * 3, 300),
                           G("no_helmet", 120 + dx * 3, 105, 160 + dx * 3, 145)))
        assert e.tracked_count == 1, "small movement must not spawn new identities"

    def test_far_apart_detections_get_separate_identities(self):
        e = ViolationEngine(ZoneRule(required={"helmet"}, min_frames=3, window=10))
        e.update(frame(P(0, 100, 100, 300)))
        e.update(frame(P(500, 100, 600, 300)))
        assert e.tracked_count == 2

    def test_tracked_ids_are_preferred_over_spatial_matching(self):
        e = ViolationEngine(ZoneRule(required={"helmet"}, min_frames=3, window=10))
        e.update(frame(P(100, 100, 200, 300, tid=7)))
        e.update(frame(P(100, 100, 200, 300, tid=9)))   # same place, new id
        assert e.tracked_count == 2, "distinct track ids must stay distinct"

    def test_fired_violation_reports_identity(self):
        e = ViolationEngine(ZoneRule(required={"helmet"}, min_frames=3, window=10))
        fr = frame(P(100, 100, 200, 300, tid=4), G("no_helmet", 120, 105, 160, 145))
        fired = run(e, fr, 5)
        assert fired[0].track_id == 4
        assert fired[0].identity == "t4"


# ---- 3. occlusion tolerance ------------------------------------------------

class TestOcclusionTolerance:
    def test_single_occluded_frame_does_not_erase_evidence(self):
        """Previously one missed frame deleted the history, so the filter
        silently required consecutive visibility."""
        e = ViolationEngine(ZoneRule(required={"helmet"}, min_frames=5, window=15))
        bare = frame(P(100, 100, 200, 300, tid=7), G("no_helmet", 120, 105, 160, 145))
        run(e, bare, 4)
        e.update(frame())                      # occluded for one frame
        fired = run(e, bare, 2)
        assert fired, "evidence must survive a brief occlusion"

    def test_identity_ages_out_after_grace_period(self):
        e = ViolationEngine(ZoneRule(required={"helmet"}, min_frames=5,
                                     window=15, occlusion_grace_frames=3))
        e.update(frame(P(100, 100, 200, 300, tid=7), G("no_helmet", 120, 105, 160, 145)))
        assert e.tracked_count == 1
        for _ in range(5):
            e.update(frame())
        assert e.tracked_count == 0, "memory must not grow without bound"

    def test_long_absence_starts_fresh_evidence(self):
        e = ViolationEngine(ZoneRule(required={"helmet"}, min_frames=5,
                                     window=15, occlusion_grace_frames=2))
        bare = frame(P(100, 100, 200, 300, tid=7), G("no_helmet", 120, 105, 160, 145))
        run(e, bare, 4)
        for _ in range(6):
            e.update(frame())
        assert run(e, bare, 1) == [], "stale evidence must not fire on return"


# ---- 4. assessability gating -----------------------------------------------

class TestAssessability:
    def test_tiny_person_is_not_judged(self):
        e = ViolationEngine(ZoneRule(required={"helmet"}, min_frames=3,
                                     window=10, min_person_px=64))
        fr = frame(P(100, 100, 110, 130, tid=1), G("no_helmet", 101, 100, 109, 110))
        assert run(e, fr, 6) == []
        assert any(a.state == "unassessable" for a in e.last_assessments)

    def test_low_resolution_feed_is_still_assessable(self):
        """A person filling most of a 480p or analogue frame is close to the
        camera and judgeable; an absolute pixel floor alone would gate out
        every older CCTV feed on site."""
        e = ViolationEngine(ZoneRule(required={"helmet"}, min_frames=3,
                                     window=10, min_person_px=64))
        fr = frame(P(10, 5, 50, 45, tid=1), G("no_helmet", 20, 6, 40, 16), w=64, h=48)
        assert run(e, fr, 6), "40px person in a 48px frame is 83% of frame height"

    def test_escape_hatch_can_be_disabled(self):
        e = ViolationEngine(ZoneRule(required={"helmet"}, min_frames=3, window=10,
                                     min_person_px=64, always_assess_frac=0.0))
        fr = frame(P(10, 5, 50, 45, tid=1), G("no_helmet", 20, 6, 40, 16), w=64, h=48)
        assert run(e, fr, 6) == []

    def test_large_person_is_judged(self):
        e = ViolationEngine(ZoneRule(required={"helmet"}, min_frames=3,
                                     window=10, min_person_px=64))
        fr = frame(P(100, 100, 200, 300, tid=1), G("no_helmet", 120, 105, 160, 145))
        assert run(e, fr, 6)

    def test_boots_not_judged_when_feet_outside_frame(self):
        e = ViolationEngine(ZoneRule(required={"boots"}, min_frames=3, window=10))
        fr = frame(P(100, 200, 200, 480, tid=1), G("no_boots", 120, 440, 160, 478), h=480)
        assert run(e, fr, 6) == []
        assert any("feet outside frame" in a.reason for a in e.last_assessments)

    def test_helmet_not_judged_when_head_outside_frame(self):
        e = ViolationEngine(ZoneRule(required={"helmet"}, min_frames=3, window=10))
        fr = frame(P(100, 0, 200, 300, tid=1), G("no_helmet", 120, 0, 160, 40))
        assert run(e, fr, 6) == []

    def test_unassessable_frames_are_not_counted_as_compliant_either(self):
        """They must not clear a pending violation, only decline to judge."""
        e = ViolationEngine(ZoneRule(required={"helmet"}, min_frames=5,
                                     window=15, min_person_px=64))
        big = frame(P(100, 100, 200, 300, tid=1), G("no_helmet", 120, 105, 160, 145))
        small = frame(P(100, 100, 110, 130, tid=1))
        run(e, big, 4)
        e.update(small)                        # walked away, too small to judge
        assert run(e, big, 2), "evidence must survive an unassessable frame"

    def test_min_person_frac_scales_with_frame_height(self):
        e = ViolationEngine(ZoneRule(required={"helmet"}, min_frames=3, window=10,
                                     min_person_px=0, min_person_frac=0.5))
        fr = frame(P(100, 100, 200, 300, tid=1),
                   G("no_helmet", 120, 105, 160, 145), h=1080)
        assert run(e, fr, 6) == [], "200px person in a 1080p frame is 18% of height"
        assert any(a.state == "unassessable" for a in e.last_assessments)


# ---- 5. confidence weighting -----------------------------------------------

class TestConfidenceWeighting:
    def test_low_confidence_negatives_do_not_fire(self):
        e = ViolationEngine(ZoneRule(required={"helmet"}, min_frames=3,
                                     window=10, min_evidence_conf=0.5))
        fr = frame(P(100, 100, 200, 300, tid=1),
                   G("no_helmet", 120, 105, 160, 145, conf=0.30))
        assert run(e, fr, 8) == []

    def test_high_confidence_negatives_fire(self):
        e = ViolationEngine(ZoneRule(required={"helmet"}, min_frames=3,
                                     window=10, min_evidence_conf=0.5))
        fr = frame(P(100, 100, 200, 300, tid=1),
                   G("no_helmet", 120, 105, 160, 145, conf=0.88))
        assert run(e, fr, 5)

    def test_mixed_confidence_needs_enough_strong_frames(self):
        e = ViolationEngine(ZoneRule(required={"helmet"}, min_frames=4,
                                     window=10, min_evidence_conf=0.5))
        weak = frame(P(100, 100, 200, 300, tid=1),
                     G("no_helmet", 120, 105, 160, 145, conf=0.35))
        strong = frame(P(100, 100, 200, 300, tid=1),
                       G("no_helmet", 120, 105, 160, 145, conf=0.9))
        run(e, weak, 6)
        assert run(e, strong, 3) == [], "three strong frames is below min_frames=4"
        assert run(e, strong, 1)


# ---- 6. core temporal behaviour --------------------------------------------

class TestTemporalSmoothing:
    def test_single_frame_does_not_fire(self):
        e = ViolationEngine(ZoneRule(required={"helmet"}, min_frames=5, window=15))
        fr = frame(P(100, 100, 200, 300, tid=1), G("no_helmet", 120, 105, 160, 145))
        assert run(e, fr, 1) == [], "one frame of no_helmet is noise, not a violation"

    def test_sustained_absence_fires_once_within_cooldown(self):
        e = ViolationEngine(ZoneRule(required={"helmet"}, min_frames=3,
                                     window=15, cooldown_s=60))
        fr = frame(P(100, 100, 200, 300, tid=1), G("no_helmet", 120, 105, 160, 145))
        assert len(run(e, fr, 20)) == 1, "cooldown must collapse a sustained event"

    def test_compliant_person_never_fires(self):
        e = ViolationEngine(ZoneRule(required={"helmet", "vest"}, min_frames=3, window=10))
        fr = frame(P(100, 100, 200, 300, tid=1),
                   G("helmet", 120, 105, 160, 145),
                   G("vest", 115, 160, 185, 230))
        assert run(e, fr, 20) == []

    def test_unknown_state_does_not_fire(self):
        """No gear evidence at all is not proof of absence."""
        e = ViolationEngine(ZoneRule(required={"helmet"}, min_frames=3, window=10))
        assert run(e, frame(P(100, 100, 200, 300, tid=1)), 20) == []

    def test_positive_detection_beats_competing_negative(self):
        e = ViolationEngine(ZoneRule(required={"helmet"}, min_frames=3, window=10))
        fr = frame(P(100, 100, 200, 300, tid=1),
                   G("helmet", 120, 105, 160, 145),
                   G("no_helmet", 125, 108, 165, 148))
        assert run(e, fr, 10) == []

    def test_multiple_required_gear_fire_independently(self):
        e = ViolationEngine(ZoneRule(required={"helmet", "vest"}, min_frames=3,
                                     window=10, cooldown_s=60))
        fr = frame(P(100, 100, 200, 300, tid=1),
                   G("helmet", 120, 105, 160, 145),
                   G("no_vest", 115, 160, 185, 230))
        fired = run(e, fr, 8)
        assert [f.gear for f in fired] == ["vest"]

    def test_evidence_frame_count_is_reported(self):
        e = ViolationEngine(ZoneRule(required={"helmet"}, min_frames=3, window=10))
        fr = frame(P(100, 100, 200, 300, tid=1), G("no_helmet", 120, 105, 160, 145))
        assert run(e, fr, 5)[0].evidence_frames >= 3


# ---- 7. robustness ---------------------------------------------------------

class TestRobustness:
    def test_empty_frame_is_safe(self):
        e = ViolationEngine()
        assert e.update(frame()) == []

    def test_gear_with_no_person_never_fires(self):
        e = ViolationEngine(ZoneRule(required={"helmet"}, min_frames=1, window=5))
        assert run(e, frame(G("no_helmet", 10, 10, 50, 50)), 10) == []

    def test_crowd_does_not_leak_memory(self):
        e = ViolationEngine(ZoneRule(required={"helmet"}, min_frames=5,
                                     window=10, occlusion_grace_frames=5))
        for i in range(60):
            e.update(frame(P(i * 5, 100, i * 5 + 60, 300, tid=i)))
        assert e.tracked_count <= 10, f"identities leaked: {e.tracked_count}"

    def test_reset_clears_state(self):
        e = ViolationEngine(ZoneRule(required={"helmet"}, min_frames=3, window=10))
        run(e, frame(P(100, 100, 200, 300, tid=1),
                     G("no_helmet", 120, 105, 160, 145)), 3)
        e.reset()
        assert e.tracked_count == 0 and e.last_assessments == []

    def test_assessments_expose_the_reason(self):
        e = ViolationEngine(ZoneRule(required={"helmet"}, min_frames=3, window=10))
        e.update(frame(P(100, 100, 200, 300, tid=1)))
        a = e.last_assessments[0]
        assert isinstance(a, PersonAssessment) and a.reason == "no gear evidence"

    def test_every_canonical_gear_has_a_band(self):
        from app.ml import taxonomy
        for pos, neg in taxonomy.GEAR_PAIRS.items():
            assert pos in GEAR_BANDS, f"{pos} has no anatomical band"
            assert neg in GEAR_BANDS, f"{neg} has no anatomical band"


# ---- 8. capture integration ------------------------------------------------

class TestCaptureCooldownKeying:
    def test_untracked_people_get_distinct_cooldown_keys(self):
        """Keying on raw track_id put every untracked worker on one cooldown,
        so only the first one's evidence photo was ever saved."""
        from app.services.capture_service import _CooldownKey
        e = ViolationEngine(ZoneRule(required={"helmet"}, min_frames=3,
                                     window=10, cooldown_s=0))
        fr = frame(P(0, 100, 100, 300), G("no_helmet", 20, 105, 60, 145),
                   P(300, 100, 400, 300), G("no_helmet", 320, 105, 360, 145))
        fired = run(e, fr, 6)
        assert len(fired) >= 2
        keys = {_CooldownKey("cam1", f.identity, f.gear).as_tuple() for f in fired}
        assert len(keys) >= 2, "distinct people must not share a cooldown key"
