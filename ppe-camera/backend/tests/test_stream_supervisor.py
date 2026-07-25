"""Stream supervision tests.

The failure this defends against is not a crash — it is twenty cameras quietly
dead by morning after a night of ordinary network noise, with a dashboard that
never said so.
"""
from __future__ import annotations

import numpy as np
import pytest

from app.services.stream_supervisor import (Action, Health, StreamSupervisor,
                                            SupervisorPolicy)


def frame(seed: int = 0, w: int = 64, h: int = 48):
    rng = np.random.default_rng(seed)
    return rng.integers(0, 255, (h, w, 3), dtype=np.uint8)


def live(_start: float = 0.0, **kw) -> StreamSupervisor:
    # Pin the clock origin: availability is measured against it, and leaving it
    # at real time while the tests inject now=100 makes elapsed negative.
    return StreamSupervisor("rtsp", SupervisorPolicy(**kw), now=_start)


class TestTransientGaps:
    def test_a_dropped_frame_is_retried_not_fatal(self):
        """One missed keyframe used to end the worker thread permanently."""
        s = live()
        assert s.on_empty_read(now=100) == Action.RETRY
        assert s.on_frame(frame(1), now=101) == Action.CONTINUE
        assert s.health == Health.HEALTHY

    def test_tolerance_is_configurable_and_enforced(self):
        s = live(tolerated_empty_reads=3)
        for i in range(3):
            assert s.on_empty_read(now=100 + i) == Action.RETRY
        assert s.on_empty_read(now=104) == Action.RECONNECT

    def test_a_good_frame_clears_accumulated_misses(self):
        s = live(tolerated_empty_reads=3)
        s.on_empty_read(now=100)
        s.on_empty_read(now=101)
        s.on_frame(frame(1), now=102)
        for i in range(3):
            assert s.on_empty_read(now=110 + i) == Action.RETRY


class TestReconnection:
    def test_camera_reboot_reconnects_rather_than_dying(self):
        s = live()
        assert s.on_error(OSError("Connection reset by peer"), now=100) == Action.RECONNECT
        s.on_reconnect_attempt()
        assert s.on_frame(frame(1), now=105) == Action.CONTINUE
        assert s.health == Health.HEALTHY
        assert s.stats.reconnects == 1

    def test_backoff_grows_then_caps(self):
        s = live(backoff_initial_s=1, backoff_factor=2, backoff_max_s=10,
                 backoff_jitter=0, failures_before_offline=99)
        seen = []
        for i in range(8):
            s.on_error(OSError("down"), now=100 + i)
            seen.append(s.backoff_s)
        assert seen[:4] == [2, 4, 8, 10]
        assert all(b == 10 for b in seen[4:]), seen

    def test_jitter_desynchronises_a_bank_of_cameras(self):
        """Twenty cameras behind one switch must not all retry on the same tick."""
        delays = set()
        for _ in range(20):
            s = live(backoff_initial_s=5, backoff_jitter=0.25,
                     failures_before_offline=99)
            s.on_error(OSError("down"), now=100)
            delays.add(round(s.backoff_s, 4))
        assert len(delays) > 15, "backoff is not jittered"

    def test_recovery_resets_the_backoff(self):
        s = live(backoff_initial_s=1, backoff_factor=2, backoff_jitter=0,
                 failures_before_offline=99)
        for i in range(4):
            s.on_error(OSError("down"), now=100 + i)
        assert s.backoff_s > 1
        s.on_frame(frame(1), now=110)
        assert s.backoff_s == 1

    def test_offline_is_reported_but_never_abandoned(self):
        """A camera powered down for a shift must rejoin by itself."""
        s = live(failures_before_offline=3, backoff_jitter=0)
        for i in range(3):
            s.on_error(OSError("down"), now=100 + i)
        assert s.health == Health.OFFLINE
        # still retrying, just slowly
        assert s.on_error(OSError("down"), now=200) == Action.OFFLINE
        assert s.backoff_s > 0
        assert s.on_frame(frame(1), now=9999) == Action.CONTINUE
        assert s.health == Health.HEALTHY


class TestFrozenStream:
    """The dangerous failure: counters climb, dashboard is green, feed is a
    still image."""

    def test_identical_frames_over_time_trigger_a_reconnect(self):
        s = live(freeze_identical_frames=5, freeze_timeout_s=10)
        stuck = frame(42)
        act = Action.CONTINUE
        for i in range(12):
            act = s.on_frame(stuck, now=100 + i * 3)
            if act == Action.RECONNECT:
                break
        assert act == Action.RECONNECT
        assert s.stats.freezes_detected == 1

    def test_a_still_night_scene_is_not_called_frozen(self):
        """Identical content alone must not trip it, or an empty yard wakes
        somebody at 3 a.m."""
        s = live(freeze_identical_frames=5, freeze_timeout_s=60)
        stuck = frame(42)
        for i in range(10):                      # 10 frames in 10 seconds
            assert s.on_frame(stuck, now=100 + i) == Action.CONTINUE

    def test_changing_content_never_freezes(self):
        s = live(freeze_identical_frames=3, freeze_timeout_s=1)
        for i in range(50):
            assert s.on_frame(frame(i), now=100 + i * 5) == Action.CONTINUE
        assert s.stats.freezes_detected == 0

    def test_freeze_detection_can_be_disabled(self):
        s = live(freeze_detect_enabled=False, freeze_identical_frames=2,
                 freeze_timeout_s=1)
        stuck = frame(7)
        for i in range(20):
            assert s.on_frame(stuck, now=100 + i * 10) == Action.CONTINUE

    def test_recovery_after_a_freeze(self):
        s = live(freeze_identical_frames=3, freeze_timeout_s=5)
        stuck = frame(9)
        for i in range(10):
            if s.on_frame(stuck, now=100 + i * 3) == Action.RECONNECT:
                break
        s.on_reconnect_attempt()
        assert s.on_frame(frame(99), now=200) == Action.CONTINUE
        assert s.health == Health.HEALTHY


class TestFiniteSources:
    def test_a_video_file_ending_is_success_not_failure(self):
        """Otherwise replaying footage spins forever trying to reconnect."""
        for kind in ("fake", "video", "folder", "images"):
            s = StreamSupervisor(kind)
            assert s.on_empty_read(now=100) == Action.ENDED
            assert s.health == Health.STOPPED

    def test_a_live_source_ending_is_a_fault(self):
        for kind in ("rtsp", "onvif", "mjpeg", "snapshot", "hls", "webcam"):
            s = StreamSupervisor(kind, SupervisorPolicy(tolerated_empty_reads=0))
            assert s.on_empty_read(now=100) in (Action.RECONNECT, Action.OFFLINE)

    def test_error_on_a_finite_source_still_ends(self):
        s = StreamSupervisor("video")
        assert s.on_error(OSError("bad codec"), now=100) == Action.ENDED


class TestHealthReporting:
    def test_downtime_and_availability_are_tracked(self):
        s = live(tolerated_empty_reads=0, backoff_jitter=0)
        s.on_frame(frame(1), now=0)
        s.on_error(OSError("down"), now=10)
        s.on_frame(frame(2), now=40)             # 30s outage
        assert s.stats.total_downtime_s == pytest.approx(30, abs=0.1)
        assert s.stats.longest_outage_s == pytest.approx(30, abs=0.1)
        avail = s.stats.availability(now=100)
        assert 0.65 < avail < 0.75, avail

    def test_longest_outage_survives_a_later_shorter_one(self):
        s = live(tolerated_empty_reads=0, backoff_jitter=0)
        s.on_error(OSError("x"), now=0); s.on_frame(frame(1), now=100)
        s.on_error(OSError("x"), now=200); s.on_frame(frame(2), now=205)
        assert s.stats.longest_outage_s == pytest.approx(100, abs=0.1)

    def test_snapshot_is_serialisable_and_complete(self):
        import json
        s = live()
        s.on_frame(frame(1), now=100)
        snap = s.snapshot(now=105)
        json.dumps(snap)
        for key in ("health", "reconnects", "availability", "seconds_since_frame",
                    "next_backoff_s", "last_error", "freezes_detected"):
            assert key in snap
        assert snap["seconds_since_frame"] == pytest.approx(5, abs=0.1)

    def test_error_text_is_preserved_for_diagnosis(self):
        s = live()
        s.on_error(ConnectionRefusedError("port 554 closed"), now=100)
        assert "port 554 closed" in s.stats.last_error

    def test_health_progresses_through_expected_states(self):
        s = live(tolerated_empty_reads=1, failures_before_offline=2,
                 backoff_jitter=0)
        assert s.health == Health.STARTING
        s.on_frame(frame(1), now=100);  assert s.health == Health.HEALTHY
        s.on_empty_read(now=101);       assert s.health == Health.DEGRADED
        s.on_empty_read(now=102);       assert s.health == Health.RECONNECTING
        s.on_error(OSError("x"), now=103)
        assert s.health == Health.OFFLINE
        s.on_frame(frame(2), now=104);  assert s.health == Health.HEALTHY


class TestRobustness:
    def test_policy_is_validated(self):
        p = SupervisorPolicy(backoff_initial_s=-5, backoff_max_s=0,
                             backoff_factor=0.1, failures_before_offline=0,
                             backoff_jitter=99).validate()
        assert p.backoff_initial_s > 0 and p.backoff_max_s >= p.backoff_initial_s
        assert p.backoff_factor >= 1 and p.failures_before_offline >= 1
        assert 0 <= p.backoff_jitter <= 1

    def test_digest_handles_odd_frames_without_raising(self):
        s = live()
        for odd in (np.zeros((1, 1, 3), np.uint8), np.zeros((2, 2), np.uint8)):
            assert s.on_frame(odd, now=100) in (Action.CONTINUE, Action.RECONNECT)

    def test_unknown_source_kind_is_treated_as_live(self):
        """Safer to keep retrying an unrecognised source than to stop watching."""
        s = StreamSupervisor("some-new-protocol", SupervisorPolicy(tolerated_empty_reads=0))
        assert s.on_empty_read(now=100) != Action.ENDED


# ---- end-to-end through the real worker loop -------------------------------

@pytest.fixture
def workers():
    """Guarantees every started worker is stopped.

    The worker thread is a daemon, so a test that returns without stopping it
    leaves it blocked in a wait() while the interpreter tears down, which
    aborts the process after the results are printed.
    """
    started = []
    yield started
    for w in started:
        try:
            w.stop(timeout=2.0)
        except Exception:
            pass


class TestWorkerSurvivesRealFaults:
    """The scenarios that used to leave every camera dead by morning."""

    @staticmethod
    def _worker(source, camera_id="t"):
        from app.ml.detector import FrameResult
        from app.services.camera_manager import CameraConfig, CameraWorker
        w = CameraWorker(
            CameraConfig(camera_id=camera_id, source_kind="rtsp", fps_limit=0),
            detect_fn=lambda f: FrameResult(width=64, height=48),
            capture_sink=lambda *a, **k: False, source=source)
        w._supervisor.policy.backoff_initial_s = 0.02
        w._supervisor.policy.backoff_max_s = 0.05
        return w

    def test_sustained_gap_does_not_kill_the_worker(self, workers):
        import time

        from app.services.sources import FrameSource

        class Flaky(FrameSource):
            def __init__(self): self.n = 0
            def open(self): pass
            def read(self):
                self.n += 1
                return None if 3 <= self.n <= 9 else frame(self.n % 5)
            def close(self): pass

        w = self._worker(Flaky()); workers.append(w)
        w.start(); time.sleep(0.5); w.stop()
        assert w.stats.frames_read > 20, "worker stopped reading after the gap"
        assert w.health["reconnects"] >= 1

    def test_camera_reboot_recovers_without_intervention(self, workers):
        import time

        from app.services.sources import FrameSource

        class Rebooting(FrameSource):
            def __init__(self): self.n = 0
            def open(self): pass
            def read(self):
                self.n += 1
                if self.n in (3, 4):
                    raise OSError("[Errno 104] Connection reset by peer")
                return frame(self.n % 5)
            def close(self): pass

        w = self._worker(Rebooting()); workers.append(w)
        w.start(); time.sleep(0.5); w.stop()
        assert w.stats.frames_read > 20
        assert w.health["reconnects"] >= 1

    def test_frozen_feed_is_caught_instead_of_reporting_healthy(self, workers):
        import time

        from app.services.sources import FrameSource

        class Frozen(FrameSource):
            def __init__(self): self.f = frame(1)
            def open(self): pass
            def read(self): return self.f
            def close(self): pass

        w = self._worker(Frozen()); workers.append(w)
        w._supervisor.policy.freeze_identical_frames = 5
        w._supervisor.policy.freeze_timeout_s = 0.02
        w.start(); time.sleep(0.4); w.stop()
        assert w.health["freezes_detected"] >= 1

    def test_a_finite_source_still_ends_cleanly(self, workers):
        """Replaying footage must not spin forever trying to reconnect."""
        import time

        from app.ml.detector import FrameResult
        from app.services.camera_manager import CameraConfig, CameraWorker
        from app.services.sources import FrameSource

        class Clip(FrameSource):
            def __init__(self): self.n = 0
            def open(self): pass
            def read(self):
                self.n += 1
                return frame(self.n) if self.n <= 5 else None
            def close(self): pass

        w = CameraWorker(
            CameraConfig(camera_id="clip", source_kind="video", fps_limit=0),
            detect_fn=lambda f: FrameResult(width=64, height=48),
            capture_sink=lambda *a, **k: False, source=Clip())
        workers.append(w)
        w.start(); time.sleep(0.3)
        assert w.stats.frames_read == 5
        assert w.health["reconnects"] == 0, "finite source must not reconnect"
        w.stop()
