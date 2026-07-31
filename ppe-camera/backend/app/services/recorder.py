r"""
NVR recording engine -- turns the live pipeline into a video recorder.

The detection side of this system was always "watch, judge, alert, forget". The
moment a contractor disputes a violation, a single JPEG is thin evidence: it
shows one instant with no context, and it cannot answer "what was he doing five
seconds earlier". This module records the footage.

Three record modes per camera:

    off          nothing is written
    events       a clip is cut around each fired violation/hazard, including
                 pre-roll seconds that were already in memory when it fired
    continuous   always-on recording, cut into fixed-length segments

Why pre-roll matters: ViolationEngine deliberately needs several consecutive
frames of evidence before it fires, so by the time an event exists the person
has been non-compliant for seconds already. A clip that starts at the fire
instant misses the approach — exactly the part a safety officer wants to see.
Frames are therefore held in a ring buffer at all times and flushed into the
front of the clip when an event lands.

Threading contract: the camera worker thread calls `submit()` on its own frame
loop and must never block on disk. `submit()` only rate-limits and hands the
frame to a bounded queue; a full queue drops the frame and counts it. All
encoding happens on the recorder's own thread, so a slow or full disk degrades
recording quality and never detection latency.

Verifiability: the writer is chosen at runtime from whatever codecs OpenCV
actually has (Windows boxes usually lack H.264), and the chosen codec is stored
on the segment row. Playback does not depend on that choice — the API decodes
server-side and streams MJPEG, the same transport the live view already uses,
so a clip is playable in a plain <img> regardless of what encoded it.
"""
from __future__ import annotations

import logging
import queue
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone  # noqa: F401 (timedelta: pre-roll)
from pathlib import Path

from app.core.config import get_settings

log = logging.getLogger(__name__)

RECORD_MODES = ("off", "events", "continuous")

# Codecs tried in order. The first that actually opens wins; the container has
# to match the codec, hence the paired suffix.
_CODECS: list[tuple[str, str]] = [
    ("avc1", ".mp4"),   # H.264 — browser-native, needs openh264/ffmpeg
    ("H264", ".mp4"),
    ("mp4v", ".mp4"),   # MPEG-4 Part 2 — always present, not browser-native
    ("MJPG", ".avi"),   # last resort, large but universally writable
]


def _now() -> datetime:
    return datetime.now(timezone.utc)


# --------------------------------------------------------------------- writer
class SegmentFile:
    """One open video file plus the metadata its index row will need."""

    def __init__(self, camera_id: str, kind: str, width: int, height: int,
                 fps: float, trigger: str = "") -> None:
        s = get_settings()
        self.camera_id = camera_id
        self.kind = kind
        self.trigger = trigger
        self.width = int(width)
        self.height = int(height)
        self.fps = float(fps)
        self.started_at = _now()
        self.started_mono = time.time()
        self.frames = 0
        self.events: list[dict] = []
        self.codec = ""
        self._writer = None
        # Seconds of buffered footage written into the front of this clip. An
        # event clip's first frames are older than the file, so without this
        # every event clip claims to be pre-roll-seconds shorter than it is —
        # the timeline draws it in the wrong place and the event marker lands
        # before the footage it refers to.
        self.preroll_s = 0.0

        day = self.started_at.strftime("%Y-%m-%d")
        self.dir = Path(s.RECORDINGS_DIR) / camera_id / day
        self.dir.mkdir(parents=True, exist_ok=True)
        stem = f"{kind}_{int(self.started_mono * 1000)}"
        self.path = self.dir / f"{stem}.mp4"          # replaced by _open()
        self.thumb_path = self.dir / f"{stem}.jpg"

    def open(self) -> bool:
        import cv2

        stem = self.path.stem
        for fourcc_name, suffix in _CODECS:
            path = self.dir / f"{stem}{suffix}"
            try:
                fourcc = cv2.VideoWriter_fourcc(*fourcc_name)
                w = cv2.VideoWriter(str(path), fourcc, max(1.0, self.fps),
                                    (self.width, self.height))
            except Exception:
                continue
            if w is not None and w.isOpened():
                self._writer = w
                self.path = path
                self.codec = fourcc_name
                return True
            try:
                w.release()
            except Exception:
                pass
            # a failed attempt can still leave a zero-byte file behind
            try:
                if path.exists() and path.stat().st_size == 0:
                    path.unlink()
            except Exception:
                pass
        log.error("no usable video codec for camera %s — recording disabled",
                  self.camera_id)
        return False

    def write(self, frame) -> None:
        if self._writer is None:
            return
        import cv2

        if frame.shape[1] != self.width or frame.shape[0] != self.height:
            frame = cv2.resize(frame, (self.width, self.height))
        self._writer.write(frame)
        if self.frames == 0:
            try:
                cv2.imwrite(str(self.thumb_path), frame,
                            [int(cv2.IMWRITE_JPEG_QUALITY),
                             get_settings().RECORD_JPEG_QUALITY])
            except Exception:
                pass
        self.frames += 1

    def set_preroll(self, seconds: float) -> None:
        """Declare that `seconds` of buffered footage opened this clip."""
        seconds = max(0.0, float(seconds))
        if seconds <= 0:
            return
        self.preroll_s = seconds
        # The clip genuinely begins that far in the past; the timeline must
        # place it there or the footage will not line up with the event log.
        self.started_at = self.started_at - timedelta(seconds=seconds)

    def mark_event(self, meta: dict) -> None:
        """Attach an event marker at the current offset into this clip."""
        self.events.append({
            "t": round(max(0.0, self.preroll_s + time.time() - self.started_mono), 2),
            "gear": meta.get("gear", ""),
            "rule_type": meta.get("rule_type", "ppe"),
            "track_id": meta.get("track_id"),
            "confidence": meta.get("confidence"),
            "capture_id": meta.get("capture_id"),
        })

    @property
    def duration_s(self) -> float:
        """Footage length, counting the pre-roll written at the front."""
        return self.preroll_s + max(0.0, time.time() - self.started_mono)

    @property
    def wall_duration_s(self) -> float:
        """Time this file has been open — what segment rotation cares about."""
        return max(0.0, time.time() - self.started_mono)

    def close(self) -> dict | None:
        """Release the file and return the row payload, or None if it is empty."""
        if self._writer is not None:
            try:
                self._writer.release()
            except Exception:
                pass
            self._writer = None
        if self.frames == 0:
            for p in (self.path, self.thumb_path):
                try:
                    if p.exists():
                        p.unlink()
                except Exception:
                    pass
            return None
        try:
            size = self.path.stat().st_size
        except Exception:
            size = 0
        duration = self.duration_s
        return {
            "camera_id": self.camera_id,
            "path": str(self.path),
            "thumb_path": str(self.thumb_path) if self.thumb_path.exists() else "",
            "kind": self.kind,
            "started_at": self.started_at,
            "ended_at": _now(),
            # Real elapsed time, not frames/fps: a camera that stalled for a
            # minute writes fewer frames, and a player seeking by wall clock
            # must not be told the clip is a minute shorter than it is.
            "duration_s": round(duration, 2),
            "size_bytes": int(size),
            "width": self.width,
            "height": self.height,
            # Playback fps that actually reproduces real-time. The writer was
            # opened at a nominal fps; if the camera delivered fewer frames the
            # honest rate is frames/duration.
            "fps": round(self.frames / duration, 3) if duration > 0.2 else self.fps,
            "frames": self.frames,
            "codec": self.codec,
            "trigger": self.trigger,
            "events": list(self.events),
        }


# ------------------------------------------------------------ per-camera state
@dataclass
class RecorderStats:
    frames_written: int = 0
    frames_dropped: int = 0
    segments_written: int = 0
    events_recorded: int = 0
    bytes_written: int = 0
    last_error: str = ""


@dataclass
class _CameraRecorder:
    """Owns one camera's recording thread, ring buffer and open files."""

    camera_id: str
    mode: str = "off"
    fps: float = 8.0
    _q: "queue.Queue" = field(default_factory=lambda: queue.Queue(maxsize=90))
    _thread: threading.Thread | None = None
    _stop: threading.Event = field(default_factory=threading.Event)
    _lock: threading.Lock = field(default_factory=threading.Lock)
    _ring: deque = field(default_factory=deque)
    _cont: SegmentFile | None = None
    _event_file: SegmentFile | None = None
    _event_until: float = 0.0
    _pending_events: list = field(default_factory=list)
    _last_submit: float = 0.0
    stats: RecorderStats = field(default_factory=RecorderStats)

    # ---- lifecycle -------------------------------------------------------
    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        s = get_settings()
        self._ring = deque(maxlen=max(1, int(s.RECORD_PRE_ROLL_S * self.fps)))
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, daemon=True,
                                        name=f"rec-{self.camera_id}")
        self._thread.start()

    def stop(self, timeout: float = 6.0) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=timeout)
            self._thread = None

    # ---- producer side (camera worker thread) ----------------------------
    def submit(self, frame) -> None:
        """Offer a frame. Never blocks; a full queue drops rather than waits."""
        if self.mode == "off" or frame is None:
            return
        now = time.time()
        period = 1.0 / self.fps if self.fps > 0 else 0.0
        if now - self._last_submit < period:
            return
        self._last_submit = now
        try:
            # copy: the worker reuses/overwrites its frame buffer downstream
            self._q.put_nowait((now, frame.copy()))
        except queue.Full:
            self.stats.frames_dropped += 1

    def mark_event(self, meta: dict) -> None:
        """A violation/hazard fired. Cut (or extend) an event clip around it."""
        if self.mode == "off":
            return
        s = get_settings()
        with self._lock:
            self._event_until = max(self._event_until,
                                    time.time() + s.RECORD_POST_ROLL_S)
            self._pending_events.append(dict(meta or {}))
        self.stats.events_recorded += 1

    # ---- consumer side (recorder thread) ---------------------------------
    def _target_size(self, frame) -> tuple[int, int]:
        s = get_settings()
        h, w = frame.shape[:2]
        if w <= s.RECORD_MAX_WIDTH:
            return w, h
        scale = s.RECORD_MAX_WIDTH / float(w)
        # even dimensions: most encoders reject odd width/height outright
        return (int(w * scale) // 2 * 2, int(h * scale) // 2 * 2)

    def _prepare(self, frame):
        import cv2

        tw, th = self._target_size(frame)
        if (tw, th) != (frame.shape[1], frame.shape[0]):
            frame = cv2.resize(frame, (tw, th))
        return frame, tw, th

    def _run(self) -> None:
        s = get_settings()
        while not self._stop.is_set():
            try:
                ts, frame = self._q.get(timeout=0.4)
            except queue.Empty:
                self._maybe_close_event()
                self._maybe_rotate()
                continue
            try:
                frame, w, h = self._prepare(frame)
            except Exception as exc:  # noqa: BLE001
                self.stats.last_error = f"{type(exc).__name__}: {exc}"
                continue

            self._ring.append((ts, frame))

            with self._lock:
                pending = self._pending_events
                self._pending_events = []
                event_active = time.time() < self._event_until

            just_opened = False
            if event_active and self._event_file is None:
                trigger = (pending[0].get("gear") if pending else "") or "event"
                self._event_file = self._open_file("event", w, h, trigger)
                if self._event_file is not None:
                    just_opened = True
                    # Pre-roll: everything still in the ring, oldest first. The
                    # current frame is already the last ring entry, so writing
                    # it again below would duplicate it — hence just_opened.
                    ring = list(self._ring)
                    # Measured, not configured: a camera running below the
                    # requested rate holds fewer seconds than RECORD_PRE_ROLL_S,
                    # and claiming the configured value would misplace the clip
                    # on the timeline by the difference.
                    if len(ring) > 1:
                        self._event_file.set_preroll(ring[-1][0] - ring[0][0])
                    for _pts, pf in ring:
                        self._event_file.write(pf)
                        self.stats.frames_written += 1
            for meta in pending:
                if self._event_file is not None:
                    self._event_file.mark_event(meta)
                if self._cont is not None:
                    self._cont.mark_event(meta)

            if self.mode == "continuous":
                if self._cont is None:
                    self._cont = self._open_file("continuous", w, h, "")
                if self._cont is not None:
                    self._cont.write(frame)
                    self.stats.frames_written += 1

            if self._event_file is not None and event_active and not just_opened:
                self._event_file.write(frame)
                self.stats.frames_written += 1

            self._maybe_close_event()
            self._maybe_rotate()

        # shutdown: flush whatever is open
        self._finish(self._event_file)
        self._event_file = None
        self._finish(self._cont)
        self._cont = None

    def _maybe_close_event(self) -> None:
        if self._event_file is None:
            return
        with self._lock:
            active = time.time() < self._event_until
        if not active:
            self._finish(self._event_file)
            self._event_file = None

    def _maybe_rotate(self) -> None:
        s = get_settings()
        if self._cont is None:
            return
        if self.mode != "continuous":
            self._finish(self._cont)
            self._cont = None
            return
        if self._cont.wall_duration_s >= s.RECORD_SEGMENT_S:
            self._finish(self._cont)
            self._cont = None

    def _open_file(self, kind: str, w: int, h: int, trigger: str) -> SegmentFile | None:
        try:
            f = SegmentFile(self.camera_id, kind, w, h, self.fps, trigger=trigger)
            if not f.open():
                self.stats.last_error = "no usable video codec"
                return None
            return f
        except Exception as exc:  # noqa: BLE001 - disk full, permissions, ...
            self.stats.last_error = f"{type(exc).__name__}: {exc}"
            log.warning("could not open recording for %s: %s", self.camera_id, exc)
            return None

    def _finish(self, f: SegmentFile | None) -> None:
        if f is None:
            return
        try:
            row = f.close()
        except Exception as exc:  # noqa: BLE001
            self.stats.last_error = f"{type(exc).__name__}: {exc}"
            return
        if row is None:
            return
        self.stats.segments_written += 1
        self.stats.bytes_written += row["size_bytes"]
        _register_segment_async(row)

    # ---- introspection ---------------------------------------------------
    def snapshot(self) -> dict:
        return {
            "camera_id": self.camera_id,
            "mode": self.mode,
            "fps": self.fps,
            "recording": self._cont is not None or self._event_file is not None,
            "event_clip_open": self._event_file is not None,
            "queue_depth": self._q.qsize(),
            "preroll_frames": len(self._ring),
            "stats": vars(self.stats),
        }


# ------------------------------------------------------------ DB registration
def _register_segment_async(row: dict) -> None:
    """Insert the index row from the recorder thread. Best effort.

    A lost index row costs a clip its place on the timeline; a raised exception
    here would kill the recorder thread and cost every future clip. So this
    never raises — and the file stays on disk either way, where a rescan can
    still find it.
    """
    try:
        from app.services import runtime

        loop = getattr(runtime, "_loop", None)
        if loop is None or loop.is_closed():
            return
        import asyncio

        asyncio.run_coroutine_threadsafe(_insert_segment(row), loop)
    except Exception as exc:  # noqa: BLE001
        log.warning("could not schedule segment insert: %s", exc)


async def _insert_segment(row: dict) -> None:
    try:
        from app.core.db import SessionLocal
        from app.models.nvr import RecordingSegment, SegmentKind

        async with SessionLocal() as session:
            seg = RecordingSegment(
                camera_id=row["camera_id"],
                path=row["path"],
                thumb_path=row.get("thumb_path", ""),
                kind=SegmentKind(row.get("kind", "continuous")),
                started_at=row["started_at"],
                ended_at=row["ended_at"],
                duration_s=row["duration_s"],
                size_bytes=row["size_bytes"],
                width=row["width"],
                height=row["height"],
                fps=row["fps"],
                frames=row["frames"],
                codec=row.get("codec", ""),
                trigger=row.get("trigger", ""),
                events=row.get("events", []),
            )
            session.add(seg)
            await session.commit()
    except Exception as exc:  # noqa: BLE001
        log.warning("could not index recording %s: %s", row.get("path"), exc)


# --------------------------------------------------------------- the service
class RecorderService:
    """Fleet-wide recording. One recorder per camera, created on demand."""

    def __init__(self) -> None:
        self._recorders: dict[str, _CameraRecorder] = {}
        self._lock = threading.Lock()
        self._retention_thread: threading.Thread | None = None
        self._retention_stop = threading.Event()

    # ---- per camera ------------------------------------------------------
    def _get(self, camera_id: str) -> _CameraRecorder:
        with self._lock:
            r = self._recorders.get(camera_id)
            if r is None:
                s = get_settings()
                r = _CameraRecorder(camera_id=camera_id, fps=s.RECORD_FPS)
                self._recorders[camera_id] = r
            return r

    def set_mode(self, camera_id: str, mode: str) -> str:
        if mode not in RECORD_MODES:
            raise ValueError(f"mode must be one of {', '.join(RECORD_MODES)}")
        r = self._get(camera_id)
        r.mode = mode
        if mode == "off":
            r.stop()
        else:
            r.start()
        return mode

    def get_mode(self, camera_id: str) -> str:
        with self._lock:
            r = self._recorders.get(camera_id)
        return r.mode if r else "off"

    def submit(self, camera_id: str, frame) -> None:
        with self._lock:
            r = self._recorders.get(camera_id)
        if r is not None and r.mode != "off":
            r.submit(frame)

    def mark_event(self, camera_id: str, meta: dict) -> None:
        with self._lock:
            r = self._recorders.get(camera_id)
        if r is not None:
            r.mark_event(meta)

    def record_now(self, camera_id: str, seconds: float = 30.0) -> dict:
        """Operator pressed Record on the live view: cut a clip ending in
        `seconds` from now, with the usual pre-roll in front of it."""
        r = self._get(camera_id)
        if r.mode == "off":
            # a manual press implies intent to record; arm events for this camera
            r.mode = "events"
            r.start()
        with r._lock:
            r._event_until = max(r._event_until, time.time() + max(1.0, seconds))
            r._pending_events.append({"gear": "manual", "rule_type": "manual"})
        return {"camera_id": camera_id, "recording_until_s": round(seconds, 1),
                "mode": r.mode}

    def status(self, camera_id: str | None = None) -> list[dict]:
        with self._lock:
            items = list(self._recorders.values())
        if camera_id:
            items = [r for r in items if r.camera_id == camera_id]
        return [r.snapshot() for r in items]

    # ---- retention -------------------------------------------------------
    def start_retention(self, interval_s: float = 300.0) -> None:
        if self._retention_thread is not None and self._retention_thread.is_alive():
            return
        self._retention_stop.clear()

        def _loop() -> None:
            # a first sweep on boot reclaims whatever accumulated while the
            # service was down
            while not self._retention_stop.wait(5.0):
                try:
                    _prune_sync()
                except Exception as exc:  # noqa: BLE001
                    log.warning("retention sweep failed: %s", exc)
                if self._retention_stop.wait(interval_s):
                    break

        self._retention_thread = threading.Thread(target=_loop, daemon=True,
                                                  name="rec-retention")
        self._retention_thread.start()

    def stop_all(self) -> None:
        self._retention_stop.set()
        with self._lock:
            items = list(self._recorders.values())
        for r in items:
            r.stop()


def _prune_sync() -> None:
    """Schedule a retention pass on the app loop from the retention thread."""
    from app.services import runtime

    loop = getattr(runtime, "_loop", None)
    if loop is None or loop.is_closed():
        return
    import asyncio

    asyncio.run_coroutine_threadsafe(prune(), loop)


async def prune(dry_run: bool = False) -> dict:
    """Delete old recordings until both retention limits are satisfied.

    Age first, then size. Locked segments are never candidates — they are the
    ones someone deliberately kept — and are excluded from the size budget
    calculation only in the sense that they cannot be freed, not that they stop
    counting against the disk.
    """
    from sqlalchemy import select

    from app.core.db import SessionLocal
    from app.models.nvr import RecordingSegment

    s = get_settings()
    cutoff = _now() - timedelta(days=max(1, s.RECORD_RETENTION_DAYS))
    budget = int(max(0.1, s.RECORD_MAX_GB) * 1024 ** 3)
    deleted: list[str] = []
    freed = 0

    async with SessionLocal() as session:
        rows = list((await session.execute(
            select(RecordingSegment).order_by(RecordingSegment.started_at.asc())
        )).scalars())

        total = sum(int(r.size_bytes or 0) for r in rows)
        for row in rows:
            if row.locked:
                continue
            # SQLite hands back naive datetimes; comparing one to an aware
            # cutoff raises rather than returning False, which would abort the
            # sweep and let the disk fill silently.
            started = row.started_at
            if started is not None and started.tzinfo is None:
                started = started.replace(tzinfo=timezone.utc)
            over_age = started is not None and started < cutoff
            over_size = total > budget
            if not (over_age or over_size):
                # rows are oldest-first, and `total` only shrinks: once one row
                # is inside both limits, every later row is too
                break
            size = int(row.size_bytes or 0)
            if not dry_run:
                _unlink(row.path)
                _unlink(row.thumb_path)
                await session.delete(row)
            deleted.append(row.id)
            freed += size
            total -= size
        if not dry_run and deleted:
            await session.commit()

    if deleted:
        log.info("retention removed %d segment(s), freed %.1f MB",
                 len(deleted), freed / 1024 ** 2)
    return {"deleted": len(deleted), "freed_bytes": freed,
            "retention_days": s.RECORD_RETENTION_DAYS,
            "max_gb": s.RECORD_MAX_GB, "dry_run": dry_run}


def _unlink(path: str | None) -> None:
    if not path:
        return
    try:
        p = Path(path)
        if p.exists():
            p.unlink()
    except Exception as exc:  # noqa: BLE001
        log.warning("could not delete %s: %s", path, exc)


_service: RecorderService | None = None


def get_recorder() -> RecorderService:
    global _service
    if _service is None:
        _service = RecorderService()
    return _service
