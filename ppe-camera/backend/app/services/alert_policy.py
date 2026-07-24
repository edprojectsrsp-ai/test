"""
Alert policy — per-person deduplication, rate limiting and digests.

The naive cooldown keyed on (camera, gear), which is wrong in both directions
at once: ten bare-headed workers on one camera produced a single alert and nine
genuine violations were silently dropped, while one worker drifting in and out
of frame could re-alert indefinitely.

What a site actually needs is an *incident* model:

  - The same person committing the same violation continuously is ONE incident.
    It alerts once, then stays quiet.
  - If that person is still violating much later, it escalates — a supervisor
    needs to know it was never corrected, and silence would read as resolved.
  - A different person is always a different incident, even on the same camera
    in the same second.
  - If the same person is seen compliant for long enough and then violates
    again, that is a new incident, not a continuation.
  - Above a burst threshold the channel is rate limited and the remainder is
    rolled into a periodic digest, so a genuinely chaotic shift produces a
    readable summary instead of five hundred Telegram messages that everyone
    mutes — a muted channel is the real failure mode here.

Every suppression records a reason, so an operator asking "why didn't I get an
alert" gets an answer instead of a shrug.
"""
from __future__ import annotations

import threading
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Literal

KeyMode = Literal["person", "camera_gear", "camera"]


@dataclass
class AlertPolicy:
    """Runtime-tunable alerting rules. Defaults suit a busy construction site."""

    # How an "incident" is identified. "person" is correct for PPE; "camera_gear"
    # reproduces the old behaviour and is kept for zone-level hazards like fire,
    # where the person is irrelevant.
    key_mode: KeyMode = "person"

    # Minimum gap between any two alerts for the same person+gear, including
    # across separate incidents. This is the anti-flap guard: a worker stepping
    # in and out of frame must not alert on every re-entry.
    person_cooldown_s: float = 300.0

    # Still violating after this long since the FIRST alert of the incident?
    # Escalate, because uncorrected is worse than new.
    escalate_after_s: float = 900.0
    max_escalations: int = 3

    # Not seen violating for this long closes the incident; the next violation
    # opens a fresh one. Must exceed escalate_after_s, or an incident would
    # expire before it could ever escalate.
    incident_reset_s: float = 1800.0

    # Burst protection across the whole channel.
    max_per_minute: int = 12
    digest_window_s: float = 300.0

    # Optional quiet hours in local time, e.g. (22, 6). Escalations still go out.
    quiet_hours: tuple[int, int] | None = None

    def validate(self) -> "AlertPolicy":
        self.person_cooldown_s = max(0.0, float(self.person_cooldown_s))
        self.escalate_after_s = max(self.person_cooldown_s, float(self.escalate_after_s))
        self.incident_reset_s = max(0.0, float(self.incident_reset_s))
        if self.incident_reset_s and self.incident_reset_s <= self.escalate_after_s:
            # otherwise the incident is deleted before the escalation can fire
            self.incident_reset_s = self.escalate_after_s * 2
        self.max_per_minute = max(0, int(self.max_per_minute))
        self.digest_window_s = max(0.0, float(self.digest_window_s))
        self.max_escalations = max(0, int(self.max_escalations))
        return self


@dataclass
class Incident:
    key: str
    camera_id: str
    gear: str
    person: str
    first_at: float
    last_alert_at: float
    last_seen_at: float
    count: int = 1              # violations observed
    alerts: int = 1             # alerts actually sent
    escalations: int = 0


@dataclass
class Decision:
    send: bool
    reason: str
    kind: str = "new"           # new | escalation | digest | suppressed
    incident_key: str = ""
    occurrence: int = 1
    escalation_level: int = 0
    remaining_s: float = 0.0    # retained for callers written against the old API

    def as_dict(self) -> dict:
        return {
            "sent": self.send, "suppressed": not self.send, "reason": self.reason,
            "kind": self.kind, "incident_key": self.incident_key,
            "occurrence": self.occurrence, "escalation_level": self.escalation_level,
            "remaining_s": round(self.remaining_s, 1),
        }


@dataclass
class DigestEntry:
    camera_id: str
    gear: str
    person: str
    at: float


class AlertPolicyEngine:
    """Thread-safe. One instance per process, shared across camera workers."""

    def __init__(self, policy: AlertPolicy | None = None) -> None:
        self.policy = (policy or AlertPolicy()).validate()
        self._incidents: dict[str, Incident] = {}
        # last alert per key, kept beyond incident close so the anti-flap
        # cooldown still applies when a person re-enters frame
        self._recent_alert: dict[str, float] = {}
        self._sent_times: deque[float] = deque()
        self._digest: list[DigestEntry] = []
        self._digest_started: float | None = None
        self._lock = threading.RLock()

    # ---- keying -----------------------------------------------------------
    def _key(self, camera_id: str, gear: str, person: str | None) -> str:
        mode = self.policy.key_mode
        if mode == "camera":
            return f"{camera_id}"
        if mode == "camera_gear":
            return f"{camera_id}|{gear}"
        # person mode; fall back to camera_gear when identity is unknown so a
        # missing identity cannot become an unbounded alert source
        return f"{camera_id}|{gear}|{person}" if person else f"{camera_id}|{gear}|?"

    def _in_quiet_hours(self, now: float) -> bool:
        qh = self.policy.quiet_hours
        if not qh:
            return False
        start, end = qh
        hour = time.localtime(now).tm_hour
        return start <= hour or hour < end if start > end else start <= hour < end

    def _rate_limited(self, now: float) -> bool:
        if self.policy.max_per_minute <= 0:
            return False
        cutoff = now - 60.0
        while self._sent_times and self._sent_times[0] < cutoff:
            self._sent_times.popleft()
        return len(self._sent_times) >= self.policy.max_per_minute

    # ---- main -------------------------------------------------------------
    def evaluate(self, camera_id: str, gear: str, person: str | None = None,
                 now: float | None = None) -> Decision:
        """Decide whether this violation should produce an alert."""
        now = time.time() if now is None else now
        p = self.policy
        key = self._key(camera_id, gear, person)

        with self._lock:
            self._expire(now)
            inc = self._incidents.get(key)

            # --- continuation of a live incident ---------------------------
            if inc is not None:
                inc.count += 1
                inc.last_seen_at = now
                since_alert = now - inc.last_alert_at
                since_first = now - inc.first_at

                if (since_first >= p.escalate_after_s
                        and inc.escalations < p.max_escalations
                        and since_alert >= p.escalate_after_s):
                    # Uncorrected after a long period: a supervisor must hear
                    # about it even during quiet hours.
                    inc.escalations += 1
                    inc.alerts += 1
                    inc.last_alert_at = now
                    self._sent_times.append(now)
                    self._recent_alert[key] = now
                    return Decision(True, "still violating after "
                                    f"{int(since_first)}s", "escalation", key,
                                    inc.count, inc.escalations)

                # A live incident never re-alerts on a timer — that is exactly
                # the flooding this engine exists to prevent. It alerts once,
                # then only escalates, then goes quiet until it closes.
                self._add_digest(camera_id, gear, person or "?", now)
                remaining = max(0.0, p.escalate_after_s - (now - inc.last_alert_at))
                return Decision(False, "ongoing incident already alerted",
                                "suppressed", key, inc.count, inc.escalations,
                                remaining_s=remaining)

            # --- brand new incident ----------------------------------------
            last = self._recent_alert.get(key, 0.0)
            if p.person_cooldown_s and now - last < p.person_cooldown_s:
                self._add_digest(camera_id, gear, person or "?", now)
                return Decision(False, f"same person alerted "
                                f"{int(now - last)}s ago", "suppressed", key, 1,
                                remaining_s=p.person_cooldown_s - (now - last))
            if self._rate_limited(now):
                self._add_digest(camera_id, gear, person or "?", now)
                return Decision(False, "rate limited", "digest", key, 1)
            if self._in_quiet_hours(now):
                self._add_digest(camera_id, gear, person or "?", now)
                return Decision(False, "quiet hours", "digest", key, 1)

            self._incidents[key] = Incident(
                key=key, camera_id=camera_id, gear=gear, person=person or "?",
                first_at=now, last_alert_at=now, last_seen_at=now)
            self._sent_times.append(now)
            self._recent_alert[key] = now
            return Decision(True, "new incident", "new", key, 1)

    # ---- digest -----------------------------------------------------------
    def _add_digest(self, camera_id: str, gear: str, person: str, now: float) -> None:
        if self.policy.digest_window_s <= 0:
            return
        if self._digest_started is None:
            self._digest_started = now
        self._digest.append(DigestEntry(camera_id, gear, person, now))

    def digest_due(self, now: float | None = None) -> bool:
        now = time.time() if now is None else now
        with self._lock:
            return (self._digest_started is not None
                    and self._digest
                    and now - self._digest_started >= self.policy.digest_window_s)

    def take_digest(self, now: float | None = None) -> dict | None:
        """Pop the pending digest. Returns None when there is nothing to send."""
        now = time.time() if now is None else now
        with self._lock:
            if not self._digest:
                self._digest_started = None
                return None
            entries = self._digest
            window_start = self._digest_started or now
            self._digest = []
            self._digest_started = None

        by_camera: dict[str, dict[str, int]] = {}
        people: set[str] = set()
        for e in entries:
            by_camera.setdefault(e.camera_id, {})
            by_camera[e.camera_id][e.gear] = by_camera[e.camera_id].get(e.gear, 0) + 1
            people.add(f"{e.camera_id}|{e.person}")
        return {
            "suppressed_count": len(entries),
            "distinct_people": len(people),
            "window_s": round(now - window_start, 1),
            "by_camera": by_camera,
            "from": time.strftime("%H:%M:%S", time.localtime(window_start)),
            "to": time.strftime("%H:%M:%S", time.localtime(now)),
        }

    # ---- housekeeping -----------------------------------------------------
    def _expire(self, now: float) -> None:
        """Close incidents whose person has not been seen violating recently."""
        reset = self.policy.incident_reset_s
        if reset <= 0:
            return
        stale = [k for k, i in self._incidents.items()
                 if now - i.last_seen_at > reset]
        for k in stale:
            del self._incidents[k]
        # bound the anti-flap map too; it outlives incidents but not forever
        horizon = max(reset, self.policy.person_cooldown_s) * 4
        for k in [k for k, t in self._recent_alert.items() if now - t > horizon]:
            del self._recent_alert[k]

    def active_incidents(self) -> list[Incident]:
        with self._lock:
            return list(self._incidents.values())

    def stats(self) -> dict:
        with self._lock:
            return {
                "active_incidents": len(self._incidents),
                "sent_last_minute": len(self._sent_times),
                "pending_digest": len(self._digest),
                "policy": {
                    "key_mode": self.policy.key_mode,
                    "person_cooldown_s": self.policy.person_cooldown_s,
                    "escalate_after_s": self.policy.escalate_after_s,
                    "incident_reset_s": self.policy.incident_reset_s,
                    "max_per_minute": self.policy.max_per_minute,
                    "digest_window_s": self.policy.digest_window_s,
                    "quiet_hours": self.policy.quiet_hours,
                },
            }

    def set_policy(self, policy: AlertPolicy) -> None:
        with self._lock:
            self.policy = policy.validate()

    def reset(self, camera_id: str | None = None) -> None:
        with self._lock:
            if camera_id is None:
                self._incidents.clear()
                self._recent_alert.clear()
                self._sent_times.clear()
                self._digest.clear()
                self._digest_started = None
            else:
                for k in [k for k, i in self._incidents.items()
                          if i.camera_id == camera_id]:
                    del self._incidents[k]


def policy_from_config() -> AlertPolicy:
    """Build a policy from the runtime alert config.

    person_cooldown_s falls back to the operator's existing cooldown_s setting
    so an installation that only ever configured the old single cooldown keeps
    the interval it was tuned to, now applied per person instead of per camera.
    """
    try:
        from app.services import alert_config as cfg
    except Exception:
        return AlertPolicy()

    def num(key, default):
        try:
            return float(cfg.get(key) or default)
        except (TypeError, ValueError):
            return default

    person_cd = num("person_cooldown_s", 0) or num("cooldown_s", 300)
    qf, qt = int(num("quiet_from", -1)), int(num("quiet_to", -1))
    mode = str(cfg.get("key_mode") or "person")
    if mode not in ("person", "camera_gear", "camera"):
        mode = "person"
    return AlertPolicy(
        key_mode=mode,                       # type: ignore[arg-type]
        person_cooldown_s=person_cd,
        escalate_after_s=num("escalate_after_s", 900),
        max_escalations=int(num("max_escalations", 3)),
        incident_reset_s=num("incident_reset_s", 1800),
        max_per_minute=int(num("max_per_minute", 12)),
        digest_window_s=num("digest_window_s", 300),
        quiet_hours=(qf, qt) if 0 <= qf <= 23 and 0 <= qt <= 23 else None,
    ).validate()


_engine: AlertPolicyEngine | None = None
_engine_lock = threading.Lock()


def get_policy_engine() -> AlertPolicyEngine:
    global _engine
    if _engine is None:
        with _engine_lock:
            if _engine is None:
                _engine = AlertPolicyEngine(policy_from_config())
    return _engine


def refresh_policy() -> AlertPolicy:
    """Re-read config after the frontend saves settings — no restart needed."""
    policy = policy_from_config()
    get_policy_engine().set_policy(policy)
    return policy
