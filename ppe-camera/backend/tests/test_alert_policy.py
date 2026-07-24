"""Alert policy tests — deduplication is what keeps the Telegram channel usable.

The failure mode being defended against is not "too few alerts" but a channel
so noisy that everyone mutes it, at which point the system alerts nobody.
"""
from __future__ import annotations

import os
import tempfile

import pytest

os.environ.setdefault("PPE_ROOT", tempfile.mkdtemp())

from app.services.alert_policy import AlertPolicy, AlertPolicyEngine


def E(**kw) -> AlertPolicyEngine:
    base = dict(person_cooldown_s=300, escalate_after_s=900, incident_reset_s=1800,
                max_per_minute=0, digest_window_s=0)
    base.update(kw)
    return AlertPolicyEngine(AlertPolicy(**base))


class TestPerPersonDeduplication:
    def test_same_person_same_gear_alerts_once(self):
        e = E()
        assert e.evaluate("cam1", "helmet", "t7", now=1000).send is True
        for t in range(1001, 1200, 10):
            assert e.evaluate("cam1", "helmet", "t7", now=t).send is False

    def test_different_people_each_alert(self):
        """The defect this replaces: keying on (camera, gear) meant ten
        bare-headed workers produced one alert and nine were lost."""
        e = E()
        assert e.evaluate("cam1", "helmet", "t1", now=1000).send is True
        assert e.evaluate("cam1", "helmet", "t2", now=1000).send is True
        assert e.evaluate("cam1", "helmet", "t3", now=1001).send is True

    def test_same_person_different_gear_alerts_separately(self):
        e = E()
        assert e.evaluate("cam1", "helmet", "t1", now=1000).send is True
        assert e.evaluate("cam1", "vest", "t1", now=1000).send is True

    def test_same_person_on_different_cameras_alerts_separately(self):
        e = E()
        assert e.evaluate("cam1", "helmet", "t1", now=1000).send is True
        assert e.evaluate("cam2", "helmet", "t1", now=1000).send is True

    def test_ongoing_incident_never_re_alerts_on_a_timer(self):
        """A continuing violation is one incident. Re-alerting every cooldown
        is precisely the flooding this engine exists to prevent — it escalates
        instead, then stays quiet."""
        e = E(person_cooldown_s=60, escalate_after_s=100_000)
        assert e.evaluate("cam1", "helmet", "t1", now=1000).send is True
        for t in range(1010, 2000, 10):
            assert e.evaluate("cam1", "helmet", "t1", now=t).send is False

    def test_closed_incident_reopens_after_anti_flap_cooldown(self):
        e = E(person_cooldown_s=100, incident_reset_s=200, escalate_after_s=50)
        assert e.evaluate("cam1", "helmet", "t1", now=1000).send is True
        d = e.evaluate("cam1", "helmet", "t1", now=2000)   # long gap, new incident
        assert d.send is True and d.kind == "new"

    def test_flapping_person_does_not_alert_on_every_re_entry(self):
        """Worker steps in and out of frame repeatedly. Without the anti-flap
        cooldown each re-entry would open a fresh incident and alert."""
        e = E(person_cooldown_s=600, incident_reset_s=60, escalate_after_s=30)
        assert e.evaluate("cam1", "helmet", "t1", now=1000).send is True
        sent = sum(1 for t in (1100, 1200, 1300, 1400)
                   if e.evaluate("cam1", "helmet", "t1", now=t).send)
        assert sent == 0, "re-entries within the anti-flap window must stay quiet"

    def test_occurrence_count_accumulates(self):
        e = E()
        e.evaluate("cam1", "helmet", "t1", now=1000)
        for t in range(1001, 1020):
            d = e.evaluate("cam1", "helmet", "t1", now=t)
        assert d.occurrence == 20


class TestEscalation:
    def test_uncorrected_violation_escalates(self):
        """Silence after a long uncorrected violation reads as resolved."""
        e = E(person_cooldown_s=60, escalate_after_s=600, incident_reset_s=5000)
        assert e.evaluate("cam1", "helmet", "t1", now=1000).send is True
        # person stays in frame, still violating
        for t in range(1100, 1600, 100):
            assert e.evaluate("cam1", "helmet", "t1", now=t).send is False
        d = e.evaluate("cam1", "helmet", "t1", now=1601)
        assert d.send is True and d.kind == "escalation"
        assert d.escalation_level == 1

    def test_escalations_are_capped(self):
        e = E(person_cooldown_s=10, escalate_after_s=100, max_escalations=2,
              incident_reset_s=100_000)
        e.evaluate("cam1", "helmet", "t1", now=1000)
        levels = []
        for t in range(1010, 2000, 10):     # continuously observed
            d = e.evaluate("cam1", "helmet", "t1", now=t)
            if d.kind == "escalation":
                levels.append(d.escalation_level)
        assert levels == [1, 2], f"escalated {levels}, expected exactly two"

    def test_escalation_ignores_quiet_hours(self):
        """An uncorrected violation must reach a supervisor even overnight."""
        e = E(person_cooldown_s=60, escalate_after_s=600, incident_reset_s=5000)
        e.evaluate("cam1", "helmet", "t1", now=1000)
        e.policy.quiet_hours = (0, 24)          # everything is quiet now
        for t in range(1100, 1600, 100):
            e.evaluate("cam1", "helmet", "t1", now=t)
        d = e.evaluate("cam1", "helmet", "t1", now=1601)
        assert d.send is True and d.kind == "escalation"

    def test_new_incident_is_held_during_quiet_hours(self):
        e = E(quiet_hours=(0, 24))
        d = e.evaluate("cam1", "helmet", "t1", now=1000)
        assert d.send is False and d.reason == "quiet hours"


class TestIncidentLifecycle:
    def test_absence_ends_the_incident(self):
        e = E(person_cooldown_s=0, incident_reset_s=120, escalate_after_s=50)
        assert e.evaluate("cam1", "helmet", "t1", now=1000).send is True
        d = e.evaluate("cam1", "helmet", "t1", now=1200)   # 200s later, reset
        assert d.send is True and d.occurrence == 1, "should be a fresh incident"

    def test_active_incidents_are_listed(self):
        e = E()
        e.evaluate("cam1", "helmet", "t1", now=1000)
        e.evaluate("cam1", "vest", "t2", now=1000)
        assert len(e.active_incidents()) == 2

    def test_reset_clears_one_camera(self):
        e = E()
        e.evaluate("cam1", "helmet", "t1", now=1000)
        e.evaluate("cam2", "helmet", "t1", now=1000)
        e.reset("cam1")
        assert [i.camera_id for i in e.active_incidents()] == ["cam2"]

    def test_memory_does_not_grow_unbounded(self):
        e = E(incident_reset_s=60, escalate_after_s=20, person_cooldown_s=10)
        for i in range(500):
            e.evaluate("cam1", "helmet", f"t{i}", now=1000 + i)
        assert len(e.active_incidents()) < 100


class TestRateLimitAndDigest:
    def test_burst_is_rate_limited(self):
        e = E(max_per_minute=5, digest_window_s=60)
        sent = sum(1 for i in range(20)
                   if e.evaluate("cam1", "helmet", f"t{i}", now=1000 + i).send)
        assert sent == 5

    def test_rate_limit_window_slides(self):
        e = E(max_per_minute=3, digest_window_s=60)
        for i in range(3):
            assert e.evaluate("cam1", "helmet", f"t{i}", now=1000).send is True
        assert e.evaluate("cam1", "helmet", "tX", now=1010).send is False
        assert e.evaluate("cam1", "helmet", "tY", now=1061).send is True

    def test_suppressed_alerts_roll_into_a_digest(self):
        e = E(max_per_minute=2, digest_window_s=60)
        for i in range(10):
            e.evaluate("cam1", "helmet", f"t{i}", now=1000 + i)
        assert e.digest_due(now=1100) is True
        d = e.take_digest(now=1100)
        assert d["suppressed_count"] == 8
        assert d["by_camera"]["cam1"]["helmet"] == 8

    def test_digest_counts_distinct_people(self):
        e = E(max_per_minute=1, digest_window_s=60)
        for i in range(6):
            e.evaluate("cam1", "helmet", f"t{i % 3}", now=1000 + i)
        d = e.take_digest(now=1100)
        assert d["distinct_people"] == 3

    def test_digest_empties_after_taking(self):
        e = E(max_per_minute=1, digest_window_s=60)
        for i in range(5):
            e.evaluate("cam1", "helmet", f"t{i}", now=1000 + i)
        assert e.take_digest(now=1100) is not None
        assert e.take_digest(now=1101) is None

    def test_digest_disabled_by_zero_window(self):
        e = E(max_per_minute=1, digest_window_s=0)
        for i in range(5):
            e.evaluate("cam1", "helmet", f"t{i}", now=1000 + i)
        assert e.take_digest(now=1100) is None

    def test_rate_limit_disabled_by_zero(self):
        e = E(max_per_minute=0)
        sent = sum(1 for i in range(50)
                   if e.evaluate("cam1", "helmet", f"t{i}", now=1000).send)
        assert sent == 50


class TestKeyModes:
    def test_camera_gear_mode_reproduces_zone_behaviour(self):
        """Correct for scene hazards like fire, where the person is irrelevant."""
        e = E(key_mode="camera_gear")
        assert e.evaluate("cam1", "fire", "t1", now=1000).send is True
        assert e.evaluate("cam1", "fire", "t2", now=1001).send is False

    def test_camera_mode_collapses_everything(self):
        e = E(key_mode="camera")
        assert e.evaluate("cam1", "helmet", "t1", now=1000).send is True
        assert e.evaluate("cam1", "vest", "t2", now=1001).send is False

    def test_missing_identity_falls_back_to_camera_gear(self):
        """An unknown identity must not become an unbounded alert source."""
        e = E()
        assert e.evaluate("cam1", "helmet", None, now=1000).send is True
        assert e.evaluate("cam1", "helmet", None, now=1001).send is False


class TestPolicyValidation:
    def test_escalation_cannot_precede_cooldown(self):
        p = AlertPolicy(person_cooldown_s=600, escalate_after_s=60).validate()
        assert p.escalate_after_s >= p.person_cooldown_s

    def test_incident_reset_cannot_precede_escalation(self):
        """Otherwise the incident is deleted before it can ever escalate."""
        p = AlertPolicy(escalate_after_s=900, incident_reset_s=300).validate()
        assert p.incident_reset_s > p.escalate_after_s

    def test_negative_values_are_clamped(self):
        p = AlertPolicy(person_cooldown_s=-5, max_per_minute=-3).validate()
        assert p.person_cooldown_s == 0 and p.max_per_minute == 0

    def test_policy_is_hot_swappable(self):
        e = E()
        e.evaluate("cam1", "helmet", "t1", now=1000)
        e.set_policy(AlertPolicy(key_mode="camera", person_cooldown_s=1))
        assert e.stats()["policy"]["key_mode"] == "camera"

    def test_stats_report_state(self):
        e = E(max_per_minute=10)
        e.evaluate("cam1", "helmet", "t1", now=1000)
        s = e.stats()
        assert s["active_incidents"] == 1 and s["sent_last_minute"] == 1


class TestDecisionReporting:
    def test_every_suppression_states_a_reason(self):
        e = E(person_cooldown_s=300)
        e.evaluate("cam1", "helmet", "t1", now=1000)
        d = e.evaluate("cam1", "helmet", "t1", now=1010)
        assert d.send is False and d.reason

    def test_decision_serialises(self):
        import json
        e = E()
        json.dumps(e.evaluate("cam1", "helmet", "t1", now=1000).as_dict())


class TestSourceCatalogue:
    def test_every_advertised_kind_can_be_built(self):
        """The frontend builds its form from SOURCE_KINDS, so a kind listed
        there but missing from the factory would be an unbuildable option."""
        from app.services.sources import SOURCE_KINDS, build_source
        samples = {
            "url": "http://example/x", "host": "10.0.0.1", "path": "/tmp",
            "index": 0, "frames": 3,
        }
        for kind, spec in SOURCE_KINDS.items():
            kwargs = {f: samples.get(f) for f in spec["fields"] if f in samples}
            src = build_source(kind, **kwargs)
            assert src is not None, kind

    def test_unknown_kind_lists_the_supported_ones(self):
        from app.services.sources import build_source
        with pytest.raises(ValueError, match="Supported:"):
            build_source("quantum")
