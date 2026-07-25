r"""
Camera manager -- the runtime spine.

Each camera runs in its own worker thread with an independent lifecycle:

    created -> starting -> running -> stopping -> stopped
                                \-> error (on source failure)

The manager owns a registry of cameras and can add/start/stop/remove them
dynamically at runtime (your requirement: "dynamic add/start/stop, unlimited
concurrent"). Each running worker pulls frames from its FrameSource, runs the
shared Detector, feeds a per-camera ViolationEngine, and hands fired
violations to the CaptureService.

Verifiability: the whole loop is driven by a pluggable FrameSource, so a
FakeSource lets us prove the state machine and pipeline wiring here without
any camera. The detector call is injected too, so tests don't need YOLO/torch.
"""
from __future__ import annotations

import enum
import threading
import time
from dataclasses import dataclass, field
from typing import Callable

from app.ml.detector import FrameResult
from app.ml.violations import ViolationEngine, ZoneRule
from app.ml.zones import ZoneMap
from app.ml.hazards import HazardConfig, HazardEngine
from app.services.sources import FrameSource, build_source
from app.services.inference_budget import get_budget
from app.services.stream_supervisor import (Action as SupervisorAction,
                                            StreamSupervisor)


class CameraState(str, enum.Enum):
    created = "created"
    starting = "starting"
    running = "running"
    stopping = "stopping"
    stopped = "stopped"
    error = "error"


@dataclass
class CameraConfig:
    camera_id: str
    source_kind: str                       # "rtsp" | "screen" | "video" | "fake"
    source_kwargs: dict = field(default_factory=dict)
    required_ppe: set[str] = field(default_factory=lambda: {"helmet", "vest"})
    fps_limit: float = 6.0                 # cap inference rate to save compute
    # Drives the share of detector capacity under load: a gate camera watching
    # everyone enter should not be starved by a storage yard.
    priority: str = "normal"               # critical | high | normal | low
    mode: str = "monitor"                  # off | monitor | collect | strict
    # non-PPE hazard rules (restricted zones, fall, near-miss, smoking, phone,
    # fire/smoke). None => a default HazardConfig (all rules on, no zones).
    restricted_zones: list = field(default_factory=list)
    # PPE monitoring zones: masks over public areas, regions of interest, and
    # per-zone gear requirements. Distinct from restricted_zones, which answer
    # "this person should not be here at all".
    monitoring_zones: list = field(default_factory=list)
    hazards_enabled: bool = True


# A detect function: (frame) -> FrameResult. Injected so tests avoid YOLO.
DetectFn = Callable[[object], FrameResult]
# A capture sink may return:
#   - bool                  legacy: whether a capture was made
#   - dict                  richer result, e.g. {"captured": True, "snapshot_path": "..."}
CaptureSink = Callable[[str, object, FrameResult, object], object]


@dataclass
class CameraStats:
    frames_read: int = 0
    frames_skipped: int = 0                # refused by the inference budget
    last_skip_reason: str = ""
    frames_inferred: int = 0
    violations_fired: int = 0
    captures_made: int = 0
    alerts_sent: int = 0
    last_error: str = ""


class CameraWorker:
    """Owns one camera's thread + pipeline state."""

    def __init__(
        self,
        config: CameraConfig,
        detect_fn: DetectFn,
        capture_sink: CaptureSink,
        source: FrameSource | None = None,
    ) -> None:
        self.config = config
        self._detect = detect_fn
        self._capture = capture_sink
        self._source = source  # if None, built from config on start
        # An injected source is reused on reconnect via this factory, so tests
        # and fixtures keep their own object rather than being silently
        # replaced by one built from config.
        self._source_factory = (lambda: source) if source is not None else None
        # An injected source still has to be opened once. Tracking "opened"
        # separately from "is not None" avoids skipping open() for a source
        # that was handed to us rather than built from config.
        self._source_opened = False
        self._supervisor = StreamSupervisor(config.source_kind)
        # Admission control only makes sense for a live feed, where a skipped
        # frame is replaced by another a few milliseconds later. Replaying a
        # video file or an image folder, every frame is unique and dropping one
        # loses it permanently — so finite sources run to completion instead.
        self._admission_applies = not self._supervisor.is_finite
        self._engine = ViolationEngine(ZoneRule(
            required=config.required_ppe,
            zones=ZoneMap.from_config(config.monitoring_zones,
                                      config.required_ppe) or None,
        ))
        self._hazards = HazardEngine(
            HazardConfig(restricted_zones=list(config.restricted_zones))
        ) if config.hazards_enabled else None
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self.state = CameraState.created
        self.stats = CameraStats()

    @property
    def health(self) -> dict:
        """Stream health for the dashboard: reconnects, freezes, availability."""
        return self._supervisor.snapshot()

    # ---- lifecycle -------------------------------------------------------
    def start(self) -> None:
        if self.state in (CameraState.running, CameraState.starting):
            return
        self._stop.clear()
        self.state = CameraState.starting
        if self._admission_applies:
            get_budget().register(
                self.config.camera_id,
                requested_fps=self.config.fps_limit or 30.0,
                priority=self.config.priority,
            )
        self._thread = threading.Thread(
            target=self._run, name=f"cam-{self.config.camera_id}", daemon=True
        )
        self._thread.start()

    def stop(self, timeout: float = 5.0) -> None:
        if self.state not in (CameraState.running, CameraState.starting):
            return
        self.state = CameraState.stopping
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=timeout)
        self.state = CameraState.stopped

    def set_mode(self, mode: str) -> str:
        if mode not in ("off", "monitor", "collect", "strict"):
            raise ValueError(f"invalid mode {mode!r}")
        self.config.mode = mode
        return mode

    def set_required_ppe(self, items: set[str] | list[str]) -> list[str]:
        """Hot-update which gear is mandatory for this camera (live overlay + engine)."""
        from app.ml.taxonomy import GEAR_PAIRS

        cleaned = {str(i).strip().lower() for i in items if str(i).strip().lower() in GEAR_PAIRS}
        if not cleaned:
            cleaned = {"helmet", "vest"}
        self.config.required_ppe = cleaned
        # rebuild violation engine with new zone rule
        from app.ml.violations import ZoneRule, ViolationEngine
        self._engine = ViolationEngine(ZoneRule(
            required=cleaned,
            zones=ZoneMap.from_config(self.config.monitoring_zones, cleaned) or None,
        ))
        return sorted(cleaned)

    # Field names as the API exposes them -> ZoneRule attribute.
    _RULE_FIELDS = {
        "min_person_px": "min_person_px",
        "min_person_frac": "min_person_frac",
        "always_assess_frac": "always_assess_frac",
        "min_frames": "min_frames",
        "window_frames": "window",
        "occlusion_grace_frames": "occlusion_grace_frames",
        "min_evidence_conf": "min_evidence_conf",
        "require_band": "require_band",
        "cooldown_s": "cooldown_s",
    }

    def get_detection_rule(self) -> dict:
        r = self._engine.rule
        out = {api_name: getattr(r, attr)
               for api_name, attr in self._RULE_FIELDS.items()}
        out["priority"] = self.config.priority
        out["camera_id"] = self.config.camera_id
        out["required_ppe"] = sorted(self.config.required_ppe)
        return out

    def set_detection_rule(self, patch: dict) -> dict:
        """Apply detection tuning live.

        Mutating the existing rule rather than rebuilding the engine is
        deliberate: a rebuild would discard every identity's accumulated
        evidence, so raising a threshold mid-shift would silently reset all
        in-progress violations.
        """
        r = self._engine.rule
        for api_name, attr in self._RULE_FIELDS.items():
            if api_name in patch and patch[api_name] is not None:
                setattr(r, attr, patch[api_name])
        # window is a deque maxlen captured at creation, so an existing
        # identity keeps its old window until it ages out. Say so rather than
        # pretending the change is instant everywhere.
        if "priority" in patch and patch["priority"]:
            self.config.priority = patch["priority"]
            try:
                get_budget().register(
                    self.config.camera_id,
                    requested_fps=self.config.fps_limit or 30.0,
                    priority=self.config.priority,
                )
            except Exception:
                pass
        return self.get_detection_rule()

    def set_monitoring_zones(self, zones: list) -> dict:
        """Hot-update masks and regions of interest.

        Applied live because zone editing is iterative — an operator drags a
        polygon over the public road and wants to see the false alerts stop,
        not restart the camera and lose the stream for ten seconds.
        """
        zone_map = ZoneMap.from_config(zones, self.config.required_ppe)
        self.config.monitoring_zones = list(zones or [])
        rule = self._engine.rule
        rule.zones = zone_map or None
        return zone_map.describe()

    def _capture_meta(self, result) -> tuple[bool, str | None]:
        """Normalize capture-sink outputs so legacy bool sinks still work."""
        if isinstance(result, dict):
            captured = bool(result.get("captured"))
            snapshot_path = result.get("snapshot_path") or None
            return captured, snapshot_path
        return bool(result), None

    # ---- event handling --------------------------------------------------
    def _handle_fired(self, fired, frame, result, mode: str) -> None:
        """Capture + alert one fired event (PPE violation OR hazard)."""
        self.stats.violations_fired += 1
        made, snapshot_path = self._capture_meta(
            self._capture(self.config.camera_id, frame, result, fired)
        )
        if made:
            self.stats.captures_made += 1
        try:
            from app.services.alert_service import get_alert_service
            decision = get_alert_service().fire(
                self.config.camera_id,
                getattr(fired, "gear", "ppe"),
                snapshot_path=snapshot_path,
                person=getattr(fired, "identity", None) or None,
                meta={"mode": mode,
                      "rule_type": getattr(fired, "rule_type", "ppe"),
                      "track_id": getattr(fired, "track_id", None),
                      "identity": getattr(fired, "identity", None),
                      "evidence_frames": getattr(fired, "evidence_frames", 0),
                      "confidence": getattr(fired, "confidence", None)},
            )
            if decision.get("sent"):
                self.stats.alerts_sent += 1
        except Exception:
            pass

    # ---- worker body -----------------------------------------------------
    def _open_source(self):
        """(Re)build and open the frame source. Raises on failure."""
        if self._source is not None and self._source_opened:
            try:
                self._source.close()
            except Exception:
                pass
            self._source = None
        if self._source is None:
            self._source = (self._source_factory() if self._source_factory
                            else build_source(self.config.source_kind,
                                              **self.config.source_kwargs))
        self._source.open()
        self._source_opened = True

    def _run(self) -> None:
        """Supervised capture loop.

        Previously a single empty read broke the loop and any exception exited
        the thread, so one dropped keyframe or one camera reboot killed the
        worker until a human restarted it. On a plant network that meant every
        camera was dead by morning. The loop now delegates every stream fault
        to StreamSupervisor and only leaves when told to stop or when a finite
        source genuinely ends.
        """
        sup = self._supervisor
        min_dt = 1.0 / self.config.fps_limit if self.config.fps_limit > 0 else 0.0
        last = 0.0

        try:
            while not self._stop.is_set():
                # ---- ensure we have an open source ------------------------
                if self._source is None or not self._source_opened:
                    try:
                        self._open_source()
                        self.state = CameraState.running
                    except Exception as exc:
                        action = sup.on_error(exc)
                        self.stats.last_error = sup.stats.last_error
                        self.state = CameraState.error
                        if action is SupervisorAction.ENDED:
                            break
                        sup.on_reconnect_attempt()
                        if self._stop.wait(sup.backoff_s):
                            break
                        continue

                # ---- read -------------------------------------------------
                try:
                    frame = self._source.read()
                except Exception as exc:
                    action = sup.on_error(exc)
                    self.stats.last_error = sup.stats.last_error
                    if action is SupervisorAction.ENDED:
                        break
                    self.state = CameraState.error
                    sup.on_reconnect_attempt()
                    self._source = None
                    self._source_opened = False
                    if self._stop.wait(sup.backoff_s):
                        break
                    continue

                if frame is None:
                    action = sup.on_empty_read()
                    if action is SupervisorAction.ENDED:
                        break
                    if action is SupervisorAction.RETRY:
                        # a dropped packet, not a disconnection
                        if self._stop.wait(0.05):
                            break
                        continue
                    self.stats.last_error = sup.stats.last_error
                    self.state = CameraState.error
                    sup.on_reconnect_attempt()
                    self._source = None
                    self._source_opened = False
                    if self._stop.wait(sup.backoff_s):
                        break
                    continue

                # ---- a frame arrived; check the feed is actually moving ----
                if sup.on_frame(frame) is SupervisorAction.RECONNECT:
                    # frozen: reads succeed but the picture never changes, so
                    # counters climb and the dashboard stays green
                    self.stats.last_error = sup.stats.last_error
                    self.state = CameraState.error
                    sup.on_reconnect_attempt()
                    self._source = None
                    self._source_opened = False
                    if self._stop.wait(sup.backoff_s):
                        break
                    continue

                if self.state is not CameraState.running:
                    self.state = CameraState.running
                self.stats.frames_read += 1

                now = time.time()
                if now - last < min_dt:
                    continue
                last = now

                mode = self.config.mode
                if mode == "off":
                    from app.services import live_view
                    live_view.publish(self.config.camera_id, frame, {"mode": mode})
                    continue

                # Admission control. The detector holds one model behind a
                # mutex, so calling it unconditionally means every camera
                # queues: measured at 20 cameras, p95 wait was 707 ms and the
                # violation was found after the person had walked away.
                # A refused frame is skipped rather than queued — the next one
                # is milliseconds away and the scene has barely moved.
                budget = get_budget()
                if self._admission_applies:
                    admitted, why = budget.acquire(
                        self.config.camera_id, frame_age_s=time.time() - now)
                    if not admitted:
                        self.stats.frames_skipped += 1
                        self.stats.last_skip_reason = why
                        continue

                t_infer = time.time()
                try:
                    result = self._detect(frame)
                finally:
                    if self._admission_applies:
                        budget.release(self.config.camera_id, time.time() - t_infer)
                self.stats.frames_inferred += 1

                fired_list = self._engine.update(result)
                for fired in fired_list:
                    self._handle_fired(fired, frame, result, mode)

                # non-PPE hazards (restricted area, fall, near-miss, smoking,
                # phone, fire/smoke) run through the SAME capture/alert path.
                if self._hazards is not None:
                    for hz in self._hazards.update(result):
                        self._handle_fired(hz, frame, result, mode)

                if mode in ("collect", "strict"):
                    try:
                        from app.services.uncertainty import get_sampler
                        reasons = get_sampler().reasons(
                            self.config.camera_id, frame, result, now=now
                        )
                    except Exception:
                        reasons = []
                    if reasons:
                        made, _snapshot_path = self._capture_meta(
                            self._capture(self.config.camera_id, frame, result, None)
                        )
                        if made:
                            self.stats.captures_made += 1

                try:
                    from app.services import live_view
                    annotated = live_view.draw_overlay(
                        frame, result, mode, self.config.camera_id,
                        required=self.config.required_ppe,
                    )
                    live_view.publish(
                        self.config.camera_id, annotated,
                        {"mode": mode, "detections": len(result.detections)},
                    )
                except Exception:
                    pass
        except Exception as e:
            # Anything reaching here is a defect in our own loop rather than a
            # stream fault; stream faults are handled above and reconnect.
            self.state = CameraState.error
            self.stats.last_error = f"{type(e).__name__}: {e}"
            return
        finally:
            sup.on_stopped()
            if self._source is not None:
                try:
                    self._source.close()
                except Exception:
                    pass
        if self.state != CameraState.error:
            self.state = CameraState.stopped


class CameraManager:
    """Registry + orchestration for all cameras. Thread-safe."""

    def __init__(self, detect_fn: DetectFn, capture_sink: CaptureSink) -> None:
        self._detect = detect_fn
        self._capture = capture_sink
        self._cameras: dict[str, CameraWorker] = {}
        self._lock = threading.Lock()

    def add(self, config: CameraConfig, source: FrameSource | None = None) -> CameraWorker:
        with self._lock:
            if config.camera_id in self._cameras:
                raise ValueError(f"camera '{config.camera_id}' already exists")
            worker = CameraWorker(config, self._detect, self._capture, source=source)
            self._cameras[config.camera_id] = worker
            return worker

    def start(self, camera_id: str) -> None:
        self._get(camera_id).start()

    def stop(self, camera_id: str) -> None:
        self._get(camera_id).stop()

    def remove(self, camera_id: str) -> None:
        worker = self._get(camera_id)
        worker.stop()
        with self._lock:
            del self._cameras[camera_id]

    def set_mode(self, camera_id: str, mode: str) -> str:
        return self._get(camera_id).set_mode(mode)

    def set_required_ppe(self, camera_id: str, items: list[str] | set[str]) -> list[str]:
        return self._get(camera_id).set_required_ppe(items)

    def get_detection_rule(self, camera_id: str) -> dict:
        return self._get(camera_id).get_detection_rule()

    def set_detection_rule(self, camera_id: str, patch: dict) -> dict:
        return self._get(camera_id).set_detection_rule(patch)

    def get_zones(self, camera_id: str) -> dict:
        w = self._get(camera_id)
        return ZoneMap.from_config(w.config.monitoring_zones,
                                   w.config.required_ppe).describe()

    def set_zones(self, camera_id: str, zones: list) -> dict:
        return self._get(camera_id).set_monitoring_zones(zones)

    def status(self, camera_id: str) -> dict:
        w = self._get(camera_id)
        return {
            "camera_id": camera_id,
            "state": w.state.value,
            "source": w.config.source_kind,
            "mode": w.config.mode,
            "required_ppe": sorted(w.config.required_ppe),
            "stats": vars(w.stats),
        }

    def list_status(self) -> list[dict]:
        with self._lock:
            ids = list(self._cameras.keys())
        return [self.status(cid) for cid in ids]

    def list_health(self) -> list[dict]:
        """Stream health per camera — reconnects, freezes, availability."""
        with self._lock:
            items = list(self._cameras.items())
        out = []
        for cam_id, worker in items:
            h = worker.health
            h["camera_id"] = cam_id
            h["state"] = worker.state.value
            out.append(h)
        return out

    def stop_all(self) -> None:
        with self._lock:
            workers = list(self._cameras.values())
        for w in workers:
            w.stop()

    def _get(self, camera_id: str) -> CameraWorker:
        with self._lock:
            if camera_id not in self._cameras:
                raise KeyError(f"camera '{camera_id}' not found")
            return self._cameras[camera_id]
