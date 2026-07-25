"""
Stream supervision — keeping cameras alive on a real site.

The worker loop treated any read failure as the end of the stream:

    frame = self._source.read()
    if frame is None:
        break                       # "transient gap (real) -> break test-fast"
    ...
    except Exception as e:
        self.state = CameraState.error
        return                      # thread exits, permanently

On a plant network that is fatal. Cameras reboot, PoE switches restart, NVRs
drop sessions, RTSP loses a keyframe. Every one of those ends the worker thread,
and the camera stays dead until a human notices. Overnight, that means every
camera is offline by morning and nothing was watching.

This module owns the decision of what to do when a stream misbehaves. It is
pure policy with no I/O, so the awkward cases — a camera that flaps every
thirty seconds, a stream that returns the same frozen frame for an hour — can
be tested deterministically instead of discovered on site.

Three failure modes, deliberately handled differently:

  * **Interrupted** — read returned nothing, or raised. Reconnect with backoff.
  * **Frozen** — reads keep succeeding but the picture never changes. This is
    the dangerous one: the camera reports healthy, frame counters climb, and
    the dashboard is green while the feed is a still image. Only a content
    check catches it.
  * **Ended** — a finite source (video file, image folder, test pattern) ran
    out. That is success, not failure, and must not trigger a reconnect loop.
"""
from __future__ import annotations

import hashlib
import random
import time
from dataclasses import dataclass, field
from enum import Enum

# Sources that legitimately finish. Everything else is a live feed that should
# still be there a second from now, so its absence is a fault.
FINITE_SOURCE_KINDS = frozenset({"fake", "video", "folder", "images"})


class Action(str, Enum):
    CONTINUE = "continue"        # all good
    RETRY = "retry"              # transient; read again shortly
    RECONNECT = "reconnect"      # tear the source down and reopen
    ENDED = "ended"              # finite source finished; stop cleanly
    OFFLINE = "offline"          # repeatedly failing; keep trying, but slowly


class Health(str, Enum):
    STARTING = "starting"
    HEALTHY = "healthy"
    DEGRADED = "degraded"        # recovering from failures, still delivering
    RECONNECTING = "reconnecting"
    FROZEN = "frozen"
    OFFLINE = "offline"
    STOPPED = "stopped"


@dataclass
class SupervisorPolicy:
    """Tunables. Defaults suit an industrial site on an unreliable network."""

    # A dropped packet or keyframe gap is normal; only treat repeated misses as
    # a disconnection.
    tolerated_empty_reads: int = 5

    # Exponential backoff between reconnect attempts.
    backoff_initial_s: float = 1.0
    backoff_max_s: float = 60.0
    backoff_factor: float = 2.0
    # Jitter matters at scale: without it, twenty cameras behind one switch all
    # reconnect on the same tick and hammer the network in lockstep.
    backoff_jitter: float = 0.25

    # After this many consecutive failed reconnects the camera is reported
    # offline. It is never abandoned — it keeps retrying at backoff_max_s,
    # because a camera that comes back after an eight-hour shutdown must
    # rejoin by itself.
    failures_before_offline: int = 5

    # Frozen-stream watchdog.
    freeze_detect_enabled: bool = True
    freeze_identical_frames: int = 30      # identical content this many times
    freeze_timeout_s: float = 20.0         # or no fresh frame for this long
    # Static scenes are common at night. Requiring both a content match and a
    # long window keeps an empty yard from being called frozen.

    def validate(self) -> "SupervisorPolicy":
        self.tolerated_empty_reads = max(0, int(self.tolerated_empty_reads))
        self.backoff_initial_s = max(0.05, float(self.backoff_initial_s))
        self.backoff_max_s = max(self.backoff_initial_s, float(self.backoff_max_s))
        self.backoff_factor = max(1.0, float(self.backoff_factor))
        self.backoff_jitter = min(1.0, max(0.0, float(self.backoff_jitter)))
        self.failures_before_offline = max(1, int(self.failures_before_offline))
        self.freeze_identical_frames = max(2, int(self.freeze_identical_frames))
        self.freeze_timeout_s = max(1.0, float(self.freeze_timeout_s))
        return self


@dataclass
class SupervisorStats:
    reconnects: int = 0
    failed_reads: int = 0
    freezes_detected: int = 0
    total_downtime_s: float = 0.0
    longest_outage_s: float = 0.0
    last_frame_at: float | None = None
    last_error: str = ""
    started_at: float = field(default_factory=time.time)

    def availability(self, now: float | None = None) -> float | None:
        """Fraction of wall time the stream has been delivering frames."""
        now = time.time() if now is None else now
        elapsed = now - self.started_at
        if elapsed <= 0:
            return None
        return max(0.0, min(1.0, 1.0 - self.total_downtime_s / elapsed))


class StreamSupervisor:
    """Per-camera stream health policy. One instance per worker."""

    def __init__(self, source_kind: str, policy: SupervisorPolicy | None = None,
                 now: float | None = None) -> None:
        self.source_kind = (source_kind or "").lower()
        self.policy = (policy or SupervisorPolicy()).validate()
        self.stats = SupervisorStats(started_at=time.time() if now is None else now)
        self.health = Health.STARTING

        self._empty_reads = 0
        self._consecutive_failures = 0
        self._backoff = self.policy.backoff_initial_s
        self._last_digest: str | None = None
        self._identical_count = 0
        self._outage_began: float | None = None

    # ---- classification ---------------------------------------------------
    @property
    def is_finite(self) -> bool:
        return self.source_kind in FINITE_SOURCE_KINDS

    @property
    def backoff_s(self) -> float:
        """Delay before the next reconnect, with jitter applied."""
        j = self.policy.backoff_jitter
        if j <= 0:
            return self._backoff
        return self._backoff * (1.0 + random.uniform(-j, j))

    # ---- events -----------------------------------------------------------
    def on_frame(self, frame, now: float | None = None) -> Action:
        """A frame arrived. Returns CONTINUE, or RECONNECT if the feed is frozen."""
        now = time.time() if now is None else now
        self._end_outage(now)
        self._empty_reads = 0
        self._consecutive_failures = 0
        self._backoff = self.policy.backoff_initial_s
        self.stats.last_frame_at = now

        if not self.policy.freeze_detect_enabled:
            self.health = Health.HEALTHY
            return Action.CONTINUE

        digest = self._digest(frame)
        if digest is not None and digest == self._last_digest:
            self._identical_count += 1
        else:
            self._identical_count = 0
            self._last_digest = digest

        # Both conditions must hold. A still night scene repeats content
        # legitimately, so identical frames alone are not proof of a freeze —
        # pairing the content check with a time window avoids waking someone
        # at 3 a.m. because the yard is empty.
        frozen = (self._identical_count >= self.policy.freeze_identical_frames
                  and self._elapsed_identical(now) >= self.policy.freeze_timeout_s)
        if frozen:
            self.stats.freezes_detected += 1
            self.stats.last_error = (
                f"Stream frozen: {self._identical_count} identical frames over "
                f"{self._elapsed_identical(now):.0f}s")
            self.health = Health.FROZEN
            self._identical_count = 0
            self._first_identical_at = None
            self._begin_outage(now)
            return Action.RECONNECT

        self.health = Health.HEALTHY
        return Action.CONTINUE

    def on_empty_read(self, now: float | None = None) -> Action:
        """read() returned None."""
        now = time.time() if now is None else now
        if self.is_finite:
            self.health = Health.STOPPED
            return Action.ENDED

        self._empty_reads += 1
        self.stats.failed_reads += 1
        if self._empty_reads <= self.policy.tolerated_empty_reads:
            self.health = Health.DEGRADED
            return Action.RETRY
        self._begin_outage(now)
        return self._register_failure("stream returned no frames", now)

    def on_error(self, exc: BaseException, now: float | None = None) -> Action:
        """read() or open() raised. Never fatal for a live source."""
        now = time.time() if now is None else now
        self.stats.failed_reads += 1
        self._begin_outage(now)
        if self.is_finite:
            self.health = Health.STOPPED
            self.stats.last_error = f"{type(exc).__name__}: {exc}"
            return Action.ENDED
        return self._register_failure(f"{type(exc).__name__}: {exc}", now)

    def on_reconnect_attempt(self) -> None:
        self.stats.reconnects += 1
        self.health = Health.RECONNECTING

    def on_stopped(self, now: float | None = None) -> None:
        self._end_outage(time.time() if now is None else now)
        self.health = Health.STOPPED

    # ---- internals --------------------------------------------------------
    def _register_failure(self, message: str, now: float) -> Action:
        self._consecutive_failures += 1
        self._empty_reads = 0
        self.stats.last_error = message
        self._backoff = min(self.policy.backoff_max_s,
                            self._backoff * self.policy.backoff_factor)
        if self._consecutive_failures >= self.policy.failures_before_offline:
            self.health = Health.OFFLINE
            # OFFLINE is a report, not a surrender: the caller keeps retrying at
            # the capped backoff so a camera powered down for a shift rejoins on
            # its own when it comes back.
            return Action.OFFLINE
        self.health = Health.RECONNECTING
        return Action.RECONNECT

    _first_identical_at: float | None = None

    def _elapsed_identical(self, now: float) -> float:
        if self._identical_count <= 1:
            self._first_identical_at = now
            return 0.0
        if self._first_identical_at is None:
            self._first_identical_at = now
            return 0.0
        return now - self._first_identical_at

    def _begin_outage(self, now: float) -> None:
        if self._outage_began is None:
            self._outage_began = now

    def _end_outage(self, now: float) -> None:
        if self._outage_began is None:
            return
        outage = max(0.0, now - self._outage_began)
        self.stats.total_downtime_s += outage
        self.stats.longest_outage_s = max(self.stats.longest_outage_s, outage)
        self._outage_began = None

    @staticmethod
    def _digest(frame) -> str | None:
        """Cheap content fingerprint.

        Hashes a strided sample rather than the whole frame: a 1080p image is
        6 MB, and hashing every frame of twenty cameras would cost more CPU
        than the inference it is protecting.
        """
        if frame is None:
            return None
        try:
            sample = frame[::16, ::16]
            return hashlib.blake2b(sample.tobytes(), digest_size=8).hexdigest()
        except Exception:
            try:
                return hashlib.blake2b(bytes(frame), digest_size=8).hexdigest()
            except Exception:
                return None

    # ---- reporting --------------------------------------------------------
    def snapshot(self, now: float | None = None) -> dict:
        now = time.time() if now is None else now
        stale = (None if self.stats.last_frame_at is None
                 else round(now - self.stats.last_frame_at, 1))
        return {
            "health": self.health.value,
            "source_kind": self.source_kind,
            "reconnects": self.stats.reconnects,
            "failed_reads": self.stats.failed_reads,
            "freezes_detected": self.stats.freezes_detected,
            "consecutive_failures": self._consecutive_failures,
            "next_backoff_s": round(self._backoff, 2),
            "seconds_since_frame": stale,
            "downtime_s": round(self.stats.total_downtime_s, 1),
            "longest_outage_s": round(self.stats.longest_outage_s, 1),
            "availability": (None if self.stats.availability(now) is None
                             else round(self.stats.availability(now), 4)),
            "last_error": self.stats.last_error,
        }
