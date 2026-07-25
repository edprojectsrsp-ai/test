"""
Inference budget — fair-share admission control for a camera fleet.

The detector holds a single model behind a mutex, so every camera's inference
serialises. Each worker calls `self._detect(frame)` directly and blocks until
the lock is free. Measured on this code with an optimistic 25 fps model:

     1 camera   demand   6 fps   p95 wait   40 ms
     4 cameras  demand  24 fps   p95 wait  118 ms
    10 cameras  demand  60 fps   p95 wait  327 ms
    20 cameras  demand 120 fps   p95 wait  707 ms

A real CPU YOLO on 1080p runs nearer 8 fps, so twenty cameras wait seconds. By
the time a violation is detected the worker has walked away, and the evidence
snapshot shows a different moment than the one that triggered it. Nothing
reports any of this: the cameras look healthy and simply lag.

Queueing cannot fix an oversubscribed resource — it only converts throughput
you do not have into latency you cannot see. So this admits or refuses each
frame immediately. A refused frame is skipped, not queued: at 6 fps the next
frame is 160 ms away and the scene has barely changed, whereas a queued frame
is already stale by the time it is processed.

Capacity is measured rather than configured, because the honest number depends
on the model, the hardware and the frame size, and any figure written into a
config file will be wrong on the next site.
"""
from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field


@dataclass
class BudgetPolicy:
    """Tunables for admission control."""

    # How many inferences may be in flight. The model is mutex-protected, so
    # more than a couple of waiters just builds a queue behind the lock.
    max_concurrent: int = 2

    # A frame older than this is not worth inferring — the moment has passed
    # and the result would be attached to a stale snapshot.
    max_frame_age_s: float = 0.75

    # Smoothing for the measured inference time. Low enough to react to a model
    # swap, high enough not to chase one slow frame.
    latency_ewma_alpha: float = 0.2

    # Assumed inference time before anything has been measured. Deliberately
    # pessimistic: starting optimistic would admit a flood on the first second
    # and produce exactly the pile-up this exists to prevent.
    initial_latency_s: float = 0.15

    # Keep some headroom so the fleet does not sit permanently at the edge.
    utilisation_target: float = 0.85

    # Below this share of its requested rate, a camera is reported starved.
    starvation_ratio: float = 0.5

    def validate(self) -> "BudgetPolicy":
        self.max_concurrent = max(1, int(self.max_concurrent))
        self.max_frame_age_s = max(0.05, float(self.max_frame_age_s))
        self.latency_ewma_alpha = min(1.0, max(0.01, float(self.latency_ewma_alpha)))
        self.initial_latency_s = max(0.001, float(self.initial_latency_s))
        self.utilisation_target = min(1.0, max(0.1, float(self.utilisation_target)))
        self.starvation_ratio = min(1.0, max(0.0, float(self.starvation_ratio)))
        return self


# Token accounting is floating point, so a camera asking for exactly its fair
# share accumulates 0.9999999999999998 tokens and is refused every few frames.
# The epsilon costs nothing and removes a silent ~20% frame loss at the
# boundary — the case that matters most, since fps_limit is usually set to
# exactly what the camera is expected to get.
_TOKEN_EPSILON = 1e-9


@dataclass
class _CameraBudget:
    camera_id: str
    weight: float = 1.0
    requested_fps: float = 6.0
    tokens: float = 0.0
    last_refill: float = 0.0
    admitted: int = 0
    skipped_rate: int = 0
    skipped_busy: int = 0
    skipped_stale: int = 0

    @property
    def attempts(self) -> int:
        return (self.admitted + self.skipped_rate + self.skipped_busy
                + self.skipped_stale)


# Priority weights. A gate camera watching everyone enter matters more than a
# storage yard, and under load the difference should show.
PRIORITY_WEIGHTS: dict[str, float] = {
    "critical": 4.0,     # access control, furnace floor, confined space
    "high": 2.0,
    "normal": 1.0,
    "low": 0.5,          # perimeter, storage
}


class InferenceBudget:
    """Thread-safe. One instance per process, shared by all camera workers."""

    def __init__(self, policy: BudgetPolicy | None = None,
                 now: float | None = None) -> None:
        self.policy = (policy or BudgetPolicy()).validate()
        self._lock = threading.RLock()
        self._cameras: dict[str, _CameraBudget] = {}
        self._in_flight = 0
        self._latency_s = self.policy.initial_latency_s
        self._samples = 0
        self._started_at = time.time() if now is None else now
        self._total_admitted = 0
        self._total_skipped = 0

    # ---- registration -----------------------------------------------------
    def register(self, camera_id: str, requested_fps: float = 6.0,
                 priority: str = "normal", now: float | None = None) -> None:
        now = time.time() if now is None else now
        with self._lock:
            cam = self._cameras.get(camera_id)
            weight = PRIORITY_WEIGHTS.get(str(priority).lower(), 1.0)
            if cam is None:
                self._cameras[camera_id] = _CameraBudget(
                    camera_id=camera_id, weight=weight,
                    requested_fps=max(0.0, float(requested_fps)),
                    tokens=1.0, last_refill=now)
            else:
                cam.weight = weight
                cam.requested_fps = max(0.0, float(requested_fps))

    def unregister(self, camera_id: str) -> None:
        with self._lock:
            self._cameras.pop(camera_id, None)

    # ---- capacity ---------------------------------------------------------
    @property
    def measured_latency_s(self) -> float:
        return self._latency_s

    @property
    def capacity_fps(self) -> float:
        """Inferences per second the model can actually sustain."""
        if self._latency_s <= 0:
            return 0.0
        return (self.policy.max_concurrent / self._latency_s) * self.policy.utilisation_target

    @property
    def demand_fps(self) -> float:
        with self._lock:
            return sum(c.requested_fps for c in self._cameras.values())

    @property
    def is_saturated(self) -> bool:
        return self.demand_fps > self.capacity_fps

    def _fair_share_fps(self, cam: _CameraBudget) -> float:
        """This camera's slice of capacity, weighted by priority.

        Never exceeds what the camera actually asked for — a fleet with spare
        capacity should not have one camera inferring at 40 fps because the
        others are idle.
        """
        total_weight = sum(c.weight for c in self._cameras.values()) or 1.0
        share = self.capacity_fps * (cam.weight / total_weight)
        return min(cam.requested_fps, share) if cam.requested_fps > 0 else share

    # ---- admission --------------------------------------------------------
    def acquire(self, camera_id: str, frame_age_s: float = 0.0,
                now: float | None = None) -> tuple[bool, str]:
        """Ask permission to infer. Returns (admitted, reason) immediately.

        Never blocks. A refusal means skip this frame, not wait for it.
        """
        now = time.time() if now is None else now
        with self._lock:
            cam = self._cameras.get(camera_id)
            if cam is None:
                self.register(camera_id, now=now)
                cam = self._cameras[camera_id]

            if frame_age_s > self.policy.max_frame_age_s:
                cam.skipped_stale += 1
                self._total_skipped += 1
                return False, "frame too old to be worth inferring"

            # refill this camera's bucket at its fair share
            share = self._fair_share_fps(cam)
            elapsed = max(0.0, now - cam.last_refill)
            cam.last_refill = now
            # Burst of one: a camera that has been quiet must not bank credit
            # and then fire a burst that starves everyone else.
            cam.tokens = min(1.0, cam.tokens + elapsed * share)

            if cam.tokens < 1.0 - _TOKEN_EPSILON:
                cam.skipped_rate += 1
                self._total_skipped += 1
                return False, "over this camera's fair share"

            if self._in_flight >= self.policy.max_concurrent:
                cam.skipped_busy += 1
                self._total_skipped += 1
                return False, "detector busy"

            cam.tokens = max(0.0, cam.tokens - 1.0)
            cam.admitted += 1
            self._in_flight += 1
            self._total_admitted += 1
            return True, "admitted"

    def release(self, camera_id: str, duration_s: float) -> None:
        """Report how long the inference actually took.

        This is what makes capacity measured rather than guessed, so the fleet
        self-tunes when the model, the hardware or the frame size changes.
        """
        with self._lock:
            self._in_flight = max(0, self._in_flight - 1)
            if duration_s <= 0:
                return
            a = self.policy.latency_ewma_alpha
            self._latency_s = (a * duration_s + (1 - a) * self._latency_s
                               if self._samples else duration_s)
            self._samples += 1

    # ---- reporting --------------------------------------------------------
    def camera_stats(self, camera_id: str) -> dict | None:
        with self._lock:
            cam = self._cameras.get(camera_id)
            if cam is None:
                return None
            share = self._fair_share_fps(cam)
            served = (share / cam.requested_fps) if cam.requested_fps > 0 else 1.0
            return {
                "camera_id": cam.camera_id,
                "requested_fps": round(cam.requested_fps, 2),
                "granted_fps": round(share, 2),
                "served_ratio": round(min(1.0, served), 3),
                "starved": served < self.policy.starvation_ratio,
                "admitted": cam.admitted,
                "skipped_rate": cam.skipped_rate,
                "skipped_busy": cam.skipped_busy,
                "skipped_stale": cam.skipped_stale,
            }

    def stats(self, now: float | None = None) -> dict:
        now = time.time() if now is None else now
        with self._lock:
            cams = [self.camera_stats(c) for c in self._cameras]
            starved = [c["camera_id"] for c in cams if c and c["starved"]]
            demand = sum(c.requested_fps for c in self._cameras.values())
            capacity = self.capacity_fps
            return {
                "capacity_fps": round(capacity, 2),
                "demand_fps": round(demand, 2),
                "saturated": demand > capacity,
                "oversubscription": (round(demand / capacity, 2)
                                     if capacity > 0 else None),
                "measured_latency_ms": round(self._latency_s * 1000, 1),
                "latency_samples": self._samples,
                "in_flight": self._in_flight,
                "cameras": len(self._cameras),
                "starved_cameras": starved,
                "total_admitted": self._total_admitted,
                "total_skipped": self._total_skipped,
                "uptime_s": round(now - self._started_at, 1),
                "advice": self._advice(demand, capacity, starved),
            }

    def _advice(self, demand: float, capacity: float, starved: list[str]) -> str:
        """Say plainly what to do, rather than leaving an operator to infer it
        from two numbers."""
        if capacity <= 0:
            return "No inference timing recorded yet."
        if demand <= capacity:
            return (f"Within capacity: {demand:.0f} fps requested of "
                    f"{capacity:.0f} fps available.")
        factor = demand / capacity
        parts = [f"Oversubscribed {factor:.1f}x: {demand:.0f} fps requested of "
                 f"{capacity:.0f} fps available. Frames are being skipped, not "
                 f"queued, so detection stays current but sparser."]
        if starved:
            parts.append(f"Starved: {', '.join(starved[:5])}.")
        parts.append("Reduce fps_limit on low-priority cameras, raise their "
                     "priority if they matter, or add GPU capacity.")
        return " ".join(parts)

    def reset(self) -> None:
        with self._lock:
            self._cameras.clear()
            self._in_flight = 0
            self._total_admitted = 0
            self._total_skipped = 0
            self._samples = 0
            self._latency_s = self.policy.initial_latency_s


_budget: InferenceBudget | None = None
_budget_lock = threading.Lock()


def get_budget() -> InferenceBudget:
    global _budget
    if _budget is None:
        with _budget_lock:
            if _budget is None:
                _budget = InferenceBudget()
    return _budget
