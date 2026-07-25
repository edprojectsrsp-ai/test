"""Inference admission tests.

The failure being defended against is a fleet that looks healthy while every
detection arrives seconds late, because twenty cameras are queued behind one
mutex-protected model.
"""
from __future__ import annotations

import pytest

from app.services.inference_budget import (PRIORITY_WEIGHTS, BudgetPolicy,
                                           InferenceBudget)


def budget(**kw) -> InferenceBudget:
    base = dict(max_concurrent=2, initial_latency_s=0.04, utilisation_target=1.0)
    base.update(kw)
    return InferenceBudget(BudgetPolicy(**base), now=0.0)


class TestCapacityMeasurement:
    def test_capacity_derives_from_measured_latency(self):
        b = budget(max_concurrent=1)
        b.register("c1", now=0)
        for i in range(20):
            b.acquire("c1", now=i)
            b.release("c1", 0.05)          # 50 ms per inference
        assert b.capacity_fps == pytest.approx(20, rel=0.2)

    def test_capacity_tracks_a_model_change(self):
        """Swapping to a heavier model must lower capacity by itself; a figure
        from a config file would be wrong on the next site."""
        b = budget(max_concurrent=1, latency_ewma_alpha=0.5)
        for i in range(20):
            b.acquire("c1", now=i); b.release("c1", 0.02)
        fast = b.capacity_fps
        for i in range(20, 60):
            b.acquire("c1", now=i); b.release("c1", 0.20)
        assert b.capacity_fps < fast / 4

    def test_starts_pessimistic_before_any_measurement(self):
        """Starting optimistic would admit a flood in the first second."""
        b = InferenceBudget(BudgetPolicy(initial_latency_s=0.15, max_concurrent=2))
        assert b.capacity_fps < 20


class TestFairShare:
    def test_capacity_is_divided_between_cameras(self):
        b = budget(max_concurrent=1)
        for i in range(1, 5):
            b.register(f"c{i}", requested_fps=100, now=0)
        for i in range(20):
            b.acquire("c1", now=i); b.release("c1", 0.04)     # 25 fps capacity
        s = b.camera_stats("c1")
        assert s["granted_fps"] == pytest.approx(25 / 4, rel=0.25)

    def test_priority_gets_a_larger_slice(self):
        b = budget(max_concurrent=1)
        b.register("gate", requested_fps=100, priority="critical", now=0)
        b.register("yard", requested_fps=100, priority="low", now=0)
        for i in range(20):
            b.acquire("gate", now=i); b.release("gate", 0.04)
        gate = b.camera_stats("gate")["granted_fps"]
        yard = b.camera_stats("yard")["granted_fps"]
        assert gate > yard * 6, (gate, yard)
        assert PRIORITY_WEIGHTS["critical"] / PRIORITY_WEIGHTS["low"] == 8

    def test_a_camera_never_gets_more_than_it_asked_for(self):
        """Spare capacity must not push one camera to 40 fps."""
        b = budget(max_concurrent=1)
        b.register("only", requested_fps=5, now=0)
        for i in range(20):
            b.acquire("only", now=i); b.release("only", 0.01)   # 100 fps capacity
        assert b.camera_stats("only")["granted_fps"] == pytest.approx(5, rel=0.01)

    def test_an_idle_camera_cannot_bank_credit_and_burst(self):
        """Otherwise a camera that was quiet starves everyone on its return."""
        b = budget(max_concurrent=8)
        b.register("c1", requested_fps=10, now=0)
        admitted = sum(b.acquire("c1", now=1000)[0] for _ in range(20))
        assert admitted == 1, f"burst of {admitted} after a long idle period"


class TestAdmission:
    def test_within_capacity_everything_is_admitted(self):
        b = budget(max_concurrent=4)
        b.register("c1", requested_fps=5, now=0)
        ok = 0
        for i in range(1, 11):
            granted, _ = b.acquire("c1", now=i * 0.2)
            if granted:
                ok += 1
                b.release("c1", 0.02)      # slots must be returned, as in the loop
        assert ok >= 9

    def test_refusal_is_immediate_not_a_queue(self):
        """Queueing converts throughput you do not have into latency you
        cannot see, so a refusal must come back at once."""
        b = budget(max_concurrent=1)
        b.register("c1", requested_fps=100, now=0)
        assert b.acquire("c1", now=1)[0] is True
        admitted, reason = b.acquire("c1", now=1)
        assert admitted is False and reason

    def test_concurrency_refusal_is_distinguishable_from_rate_refusal(self):
        """Two independent limits: the operator needs to know which one bit,
        because the fixes are different — add capacity, or lower fps_limit."""
        b = budget(max_concurrent=1)
        # two cameras, so neither is rate-limited at this instant
        b.register("a", requested_fps=1000, now=0)
        b.register("b", requested_fps=1000, now=0)
        assert b.acquire("a", now=10)[0] is True       # takes the only slot
        admitted, reason = b.acquire("b", now=10)
        assert admitted is False and reason == "detector busy"

        # and the rate path reports itself differently
        b2 = budget(max_concurrent=8)
        b2.register("c", requested_fps=1, now=0)
        b2.acquire("c", now=10)
        admitted, reason = b2.acquire("c", now=10)
        assert admitted is False and "fair share" in reason

    def test_stale_frames_are_dropped(self):
        b = budget(max_concurrent=4, max_frame_age_s=0.5)
        b.register("c1", requested_fps=100, now=0)
        ok, reason = b.acquire("c1", frame_age_s=2.0, now=1)
        assert ok is False and "too old" in reason

    def test_concurrency_ceiling_is_respected(self):
        b = budget(max_concurrent=3)
        for i in range(6):
            b.register(f"c{i}", requested_fps=100, now=0)
        got = [b.acquire(f"c{i}", now=1000)[0] for i in range(6)]
        assert sum(got) == 3

    def test_release_frees_a_slot(self):
        b = budget(max_concurrent=1)
        b.register("a", requested_fps=1000, now=0)
        b.register("b", requested_fps=1000, now=0)
        assert b.acquire("a", now=10)[0] is True
        assert b.acquire("b", now=10)[0] is False      # slot held
        b.release("a", 0.01)
        assert b.acquire("b", now=10)[0] is True       # slot returned

    def test_unknown_camera_is_auto_registered(self):
        b = budget()
        assert b.acquire("surprise", now=1)[0] is True
        assert b.camera_stats("surprise") is not None


class TestSaturationReporting:
    def test_saturation_is_detected_and_quantified(self):
        b = budget(max_concurrent=1)
        for i in range(20):
            b.register(f"c{i}", requested_fps=6, now=0)
        b.acquire("c0", now=1); b.release("c0", 0.04)     # 25 fps capacity
        s = b.stats(now=10)
        assert s["saturated"] is True
        assert s["oversubscription"] == pytest.approx(120 / 25, rel=0.3)

    def test_starved_cameras_are_named(self):
        b = budget(max_concurrent=1)
        b.register("gate", requested_fps=6, priority="critical", now=0)
        for i in range(15):
            b.register(f"yard{i}", requested_fps=6, priority="low", now=0)
        b.acquire("gate", now=1); b.release("gate", 0.05)
        s = b.stats(now=10)
        assert s["starved_cameras"], "no camera reported starved under 5x load"
        assert "gate" not in s["starved_cameras"], "critical camera was starved"

    def test_advice_is_actionable_not_just_numbers(self):
        b = budget(max_concurrent=1)
        for i in range(20):
            b.register(f"c{i}", requested_fps=6, now=0)
        b.acquire("c0", now=1); b.release("c0", 0.04)
        advice = b.stats(now=10)["advice"]
        assert "Oversubscribed" in advice
        assert "fps_limit" in advice or "GPU" in advice

    def test_healthy_fleet_says_so(self):
        b = budget(max_concurrent=2)
        b.register("c1", requested_fps=2, now=0)
        b.acquire("c1", now=1); b.release("c1", 0.01)
        assert "Within capacity" in b.stats(now=10)["advice"]

    def test_stats_serialise(self):
        import json
        b = budget()
        b.register("c1", now=0); b.acquire("c1", now=1); b.release("c1", 0.03)
        json.dumps(b.stats(now=5))


class TestConcurrencySafety:
    def test_parallel_acquire_never_exceeds_the_ceiling(self):
        import threading
        b = budget(max_concurrent=4)
        for i in range(30):
            b.register(f"c{i}", requested_fps=1000, now=0)
        peak, lock = [0], threading.Lock()
        live = [0]

        def worker(i):
            for _ in range(40):
                ok, _r = b.acquire(f"c{i}", now=1000)
                if ok:
                    with lock:
                        live[0] += 1
                        peak[0] = max(peak[0], live[0])
                    b.release(f"c{i}", 0.001)
                    with lock:
                        live[0] -= 1

        ts = [threading.Thread(target=worker, args=(i,)) for i in range(30)]
        [t.start() for t in ts]; [t.join() for t in ts]
        assert peak[0] <= 4, f"concurrency ceiling breached: {peak[0]}"

    def test_release_without_acquire_does_not_go_negative(self):
        b = budget()
        for _ in range(5):
            b.release("ghost", 0.01)
        assert b.stats(now=1)["in_flight"] == 0


class TestPolicyValidation:
    def test_nonsense_values_are_clamped(self):
        p = BudgetPolicy(max_concurrent=0, max_frame_age_s=-1,
                         latency_ewma_alpha=5, initial_latency_s=0,
                         utilisation_target=99).validate()
        assert p.max_concurrent >= 1 and p.max_frame_age_s > 0
        assert 0 < p.latency_ewma_alpha <= 1 and p.initial_latency_s > 0
        assert p.utilisation_target <= 1

    def test_unregister_and_reset(self):
        b = budget()
        b.register("c1", now=0); b.register("c2", now=0)
        b.unregister("c1")
        assert b.camera_stats("c1") is None
        b.reset()
        assert b.stats(now=1)["cameras"] == 0


class TestNumericalRobustness:
    def test_a_camera_at_exactly_its_fair_share_is_not_silently_throttled(self):
        """Floating-point drift left tokens at 0.9999999999999998 and refused
        roughly one frame in five — at exactly the rate operators configure."""
        b = budget(max_concurrent=8)
        b.register("c1", requested_fps=5, now=0)
        admitted = 0
        for i in range(1, 51):
            granted, _ = b.acquire("c1", now=i * 0.2)   # exactly 5 fps
            if granted:
                admitted += 1
                b.release("c1", 0.01)
        assert admitted >= 49, f"lost {50 - admitted} frames to rounding"

    def test_tokens_never_go_negative(self):
        b = budget(max_concurrent=99)
        b.register("c1", requested_fps=1000, now=0)
        for i in range(200):
            b.acquire("c1", now=i * 0.001)
        assert b._cameras["c1"].tokens >= 0.0


class TestFleetScale:
    """The scenario that motivated this: 20 cameras against one model."""

    def test_a_saturated_fleet_stays_current_instead_of_queueing(self):
        """Latency is bounded because refused frames are dropped, not stacked.
        The alternative is a detection arriving after the person has left."""
        b = budget(max_concurrent=2, initial_latency_s=0.04, utilisation_target=1.0)
        for i in range(20):
            b.register(f"cam{i}", requested_fps=6, priority="normal", now=0)

        admitted = 0
        t = 0.0
        for _tick in range(200):            # 200 rounds of all 20 cameras
            t += 1 / 30
            for i in range(20):
                ok, _ = b.acquire(f"cam{i}", now=t)
                if ok:
                    admitted += 1
                    b.release(f"cam{i}", 0.04)

        s = b.stats(now=t)
        assert s["saturated"] is True
        # Throughput is capped near real capacity rather than accepting
        # everything and queueing 4x more work than the model can do.
        achieved = admitted / t
        assert achieved <= s["capacity_fps"] * 1.35, (achieved, s["capacity_fps"])
        assert s["total_skipped"] > s["total_admitted"], "nothing was shed"

    def test_critical_cameras_keep_working_while_the_fleet_sheds_load(self):
        """Under load the gate must not be starved by nineteen storage yards."""
        b = budget(max_concurrent=2, initial_latency_s=0.04, utilisation_target=1.0)
        b.register("gate", requested_fps=6, priority="critical", now=0)
        for i in range(19):
            b.register(f"yard{i}", requested_fps=6, priority="low", now=0)

        got = {"gate": 0, "yard": 0}
        t = 0.0
        for _tick in range(200):
            t += 1 / 30
            for name in ["gate"] + [f"yard{i}" for i in range(19)]:
                ok, _ = b.acquire(name, now=t)
                if ok:
                    got["gate" if name == "gate" else "yard"] += 1
                    b.release(name, 0.04)

        per_yard = got["yard"] / 19
        assert got["gate"] > per_yard * 3, (got["gate"], per_yard)
        assert b.camera_stats("gate")["starved"] is False
