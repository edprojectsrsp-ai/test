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
from app.ml.hazards import HazardConfig, HazardEngine
from app.services.sources import FrameSource, build_source


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
    mode: str = "monitor"                  # off | monitor | collect | strict
    # non-PPE hazard rules (restricted zones, fall, near-miss, smoking, phone,
    # fire/smoke). None => a default HazardConfig (all rules on, no zones).
    restricted_zones: list = field(default_factory=list)
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
        self._engine = ViolationEngine(ZoneRule(required=config.required_ppe))
        self._hazards = HazardEngine(
            HazardConfig(restricted_zones=list(config.restricted_zones))
        ) if config.hazards_enabled else None
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self.state = CameraState.created
        self.stats = CameraStats()

    # ---- lifecycle -------------------------------------------------------
    def start(self) -> None:
        if self.state in (CameraState.running, CameraState.starting):
            return
        self._stop.clear()
        self.state = CameraState.starting
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
        self._engine = ViolationEngine(ZoneRule(required=cleaned))
        return sorted(cleaned)

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
    def _run(self) -> None:
        try:
            if self._source is None:
                self._source = build_source(
                    self.config.source_kind, **self.config.source_kwargs
                )
            self._source.open()
            self.state = CameraState.running
            min_dt = 1.0 / self.config.fps_limit if self.config.fps_limit > 0 else 0.0
            last = 0.0

            while not self._stop.is_set():
                frame = self._source.read()
                if frame is None:
                    # end of stream (fake) or transient gap (real) -> break test-fast
                    break
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

                result = self._detect(frame)
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
        except Exception as e:  # source failure, codec error, etc.
            self.state = CameraState.error
            self.stats.last_error = f"{type(e).__name__}: {e}"
            return
        finally:
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
