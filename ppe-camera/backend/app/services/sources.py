"""
Frame sources -- the pluggable ingestion layer.

One clean interface, several backends:
  - RTSPSource      : IP/WiFi/eSIM cameras, DVR/NVR via RTSP. The primary path.
  - ScreenSource    : fallback that captures a viewer app's window/region when
                      no RTSP is available. Fragile by nature (see note), so it
                      is explicitly a last resort, never the default.
  - FakeSource      : deterministic synthetic frames for tests/CI. No hardware.

Why an ABC instead of hardcoding VidGear everywhere: the camera worker only
knows read() -> frame. Swapping RTSP for screen-capture or a test source is a
one-line change, and we can verify the whole pipeline here with FakeSource.

NOTE on screen capture: it re-digitizes pixels off a monitor, so it loses the
original stream's timestamps and degrades on window move/resize. Use only when
the contractor genuinely cannot expose RTSP/ONVIF.
"""
from __future__ import annotations

import abc
import time
from dataclasses import dataclass, field


class FrameSource(abc.ABC):
    """Minimal contract every ingestion backend implements."""

    @abc.abstractmethod
    def open(self) -> None: ...

    @abc.abstractmethod
    def read(self):
        """Return a BGR numpy frame, or None if no frame is available."""

    @abc.abstractmethod
    def close(self) -> None: ...

    @property
    def name(self) -> str:
        return self.__class__.__name__


@dataclass
class RTSPSource(FrameSource):
    """
    RTSP/HTTP camera via VidGear's CamGear (FFmpeg-backed).

    VidGear handles reconnection, buffering and codec quirks better than raw
    cv2.VideoCapture, which matters for flaky industrial WiFi links.
    """
    url: str
    transport: str = ""          # "tcp" | "udp" | "" (auto). TCP is steadier on flaky links.
    _stream: object | None = None

    def open(self) -> None:
        import os

        from vidgear.gears import CamGear  # lazy: only when a real feed opens

        # Force RTSP-over-TCP when asked. CamGear's FFmpeg/OpenCV backend honours
        # this env var; TCP avoids the packet loss that garbles UDP on WiFi/eSIM.
        t = (self.transport or "").lower()
        if t in ("tcp", "udp"):
            os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = f"rtsp_transport;{t}"

        self._stream = CamGear(source=self.url, logging=False).start()

    def read(self):
        if self._stream is None:
            return None
        return self._stream.read()

    def close(self) -> None:
        if self._stream is not None:
            self._stream.stop()
            self._stream = None


@dataclass
class WebcamSource(FrameSource):
    """
    Local webcam via OpenCV -- the easiest way to test with no CCTV or GPU.
    `index` 0 is the default built-in camera; 1/2 for external USB cams.
    """
    index: int = 0
    _cap: object | None = None
    _backend_name: str = ""

    def open(self) -> None:
        import cv2  # lazy
        import time

        requested = int(self.index or 0)
        indexes = [requested] + [i for i in range(5) if i != requested]
        backends = [
            ("DirectShow", getattr(cv2, "CAP_DSHOW", cv2.CAP_ANY)),
            ("MSMF", getattr(cv2, "CAP_MSMF", cv2.CAP_ANY)),
            ("default", cv2.CAP_ANY),
        ]
        errors: list[str] = []

        for idx in indexes:
            for backend_name, backend in backends:
                cap = cv2.VideoCapture(idx, backend)
                if not cap.isOpened():
                    cap.release()
                    errors.append(f"{idx}/{backend_name}: open failed")
                    continue

                cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
                cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)

                frame = None
                ok = False
                for _ in range(12):
                    ok, frame = cap.read()
                    if ok and frame is not None and getattr(frame, "size", 0) > 0:
                        self.index = idx
                        self._cap = cap
                        self._backend_name = backend_name
                        return
                    time.sleep(0.05)

                cap.release()
                errors.append(f"{idx}/{backend_name}: no frames")

        raise RuntimeError(
            "could not read webcam frames. Tried indexes 0-4 with DirectShow, "
            f"MSMF, and default OpenCV backends. Details: {'; '.join(errors[:8])}"
        )

    def read(self):
        if self._cap is None:
            return None
        ok, frame = self._cap.read()
        return frame if ok else None

    def close(self) -> None:
        if self._cap is not None:
            self._cap.release()
            self._cap = None


@dataclass
class ScreenSource(FrameSource):
    """
    Fallback: capture a region of the screen (a CCTV viewer app window).
    Backed by VidGear ScreenGear. Coordinates are a screen rectangle.
    """
    top: int = 0
    left: int = 0
    width: int = 1280
    height: int = 720
    _stream: object | None = None

    def open(self) -> None:
        from vidgear.gears import ScreenGear  # lazy

        self._stream = ScreenGear(
            monitor=1,
            top=self.top, left=self.left,
            width=self.width, height=self.height,
            logging=False,
        ).start()

    def read(self):
        if self._stream is None:
            return None
        return self._stream.read()

    def close(self) -> None:
        if self._stream is not None:
            self._stream.stop()
            self._stream = None


@dataclass
class FakeSource(FrameSource):
    """
    Deterministic synthetic source for tests. Emits a fixed number of small
    black frames then returns None (end of stream). No numpy/cv2 dependency at
    import time; created lazily so CI stays light.
    """
    frames: int = 5
    height: int = 48
    width: int = 64
    _emitted: int = 0
    _opened: bool = False

    def open(self) -> None:
        self._opened = True
        self._emitted = 0

    def read(self):
        if not self._opened or self._emitted >= self.frames:
            return None
        self._emitted += 1
        import numpy as np

        return np.zeros((self.height, self.width, 3), dtype="uint8")

    def close(self) -> None:
        self._opened = False


@dataclass
class VideoFileSource(FrameSource):
    """
    Play an uploaded video file through the full pipeline -- the DEMO path.

    Paced to REAL TIME. The camera worker throttles *inference* and discards the
    frames in between with a cheap `continue`; if read() returned frames as fast
    as they decode, a 3-minute clip would blow past in seconds AND break tracking
    (ByteTrack would see frames too far apart to keep a stable id, so violations
    never accumulate). So read() paces itself to the clip's native fps against a
    wall clock -- playback looks like the original, and tracking/violations work.

    `speed` is a real-time multiplier:  0.5 = half speed, 1.0 = real time,
    2.0 = 2x fast-forward. `loop=True` replays for a continuous demo.
    """
    path: str = ""
    loop: bool = False
    speed: float = 1.0
    _cap: object | None = None
    _native_fps: float = 25.0
    _t0: float | None = None
    _emitted: int = 0

    def open(self) -> None:
        import cv2  # lazy
        import os

        if not self.path or not os.path.exists(self.path):
            raise RuntimeError(f"video file not found: {self.path}")
        cap = cv2.VideoCapture(self.path)
        if not cap.isOpened():
            cap.release()
            raise RuntimeError(f"could not open video: {self.path}")
        self._cap = cap
        fps = cap.get(cv2.CAP_PROP_FPS)
        # some containers report 0/NaN/absurd values -> clamp to a sane default
        self._native_fps = fps if (fps and 1.0 <= fps <= 120.0) else 25.0
        self._t0 = None
        self._emitted = 0

    def _pace(self) -> None:
        """Sleep so frames leave at native_fps * speed, tracking the wall clock
        (self-corrects for time spent in inference -- never over-sleeps)."""
        import time

        rate = max(0.1, self._native_fps * max(0.05, self.speed))
        now = time.time()
        if self._t0 is None:
            self._t0 = now
        target = self._t0 + self._emitted / rate
        dt = target - now
        if dt > 0:
            time.sleep(min(dt, 1.0))
        self._emitted += 1

    def read(self):
        if self._cap is None:
            return None
        ok, frame = self._cap.read()
        if not ok:
            if self.loop:
                import cv2
                self._cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                self._t0 = None
                self._emitted = 0
                ok, frame = self._cap.read()
                if not ok:
                    return None
            else:
                return None  # end of clip -> worker stops cleanly
        self._pace()
        return frame

    def close(self) -> None:
        if self._cap is not None:
            self._cap.release()
            self._cap = None


@dataclass
class ONVIFSource(FrameSource):
    """
    ONVIF/IP camera: resolve the RTSP stream URI via the ONVIF Media service,
    then read it exactly like RTSPSource. Falls back to a directly-supplied
    rtsp_url if ONVIF discovery isn't available.
    """
    host: str = ""
    port: int = 80
    username: str = ""
    password: str = ""
    rtsp_url: str = ""
    _inner: FrameSource | None = None

    def _resolve_rtsp(self) -> str:
        if self.rtsp_url:
            return self.rtsp_url
        from onvif import ONVIFCamera  # lazy: pip install onvif-zeep

        cam = ONVIFCamera(self.host, self.port, self.username, self.password)
        media = cam.create_media_service()
        profile = media.GetProfiles()[0]
        req = media.create_type("GetStreamUri")
        req.ProfileToken = profile.token
        req.StreamSetup = {
            "Stream": "RTP-Unicast",
            "Transport": {"Protocol": "RTSP"},
        }
        return media.GetStreamUri(req).Uri

    def open(self) -> None:
        url = self._resolve_rtsp()
        self._inner = RTSPSource(url=url)
        self._inner.open()

    def read(self):
        return self._inner.read() if self._inner else None

    def close(self) -> None:
        if self._inner is not None:
            self._inner.close()
            self._inner = None



@dataclass
class MJPEGSource(FrameSource):
    """HTTP MJPEG stream — the fallback almost every IP camera exposes.

    Cheap Chinese and older Axis/Hikvision units often serve MJPEG on an HTTP
    path even when RTSP is locked down or on a nonstandard port, so this is
    frequently the only way in without vendor credentials. Parsed directly
    from the multipart stream rather than through OpenCV, which handles
    boundary quirks poorly on some firmware.
    """
    url: str
    username: str = ""
    password: str = ""
    timeout: float = 10.0
    _resp: object | None = None
    _buf: bytes = b""

    def open(self) -> None:
        import urllib.request

        req = urllib.request.Request(self.url)
        if self.username:
            import base64
            token = base64.b64encode(
                f"{self.username}:{self.password}".encode()).decode()
            req.add_header("Authorization", f"Basic {token}")
        self._resp = urllib.request.urlopen(req, timeout=self.timeout)
        self._buf = b""

    def read(self):
        import numpy as np
        import cv2

        if self._resp is None:
            return None
        # Accumulate until a complete JPEG (SOI..EOI) is in the buffer.
        for _ in range(2048):
            start = self._buf.find(b"\xff\xd8")
            end = self._buf.find(b"\xff\xd9", start + 2) if start != -1 else -1
            if start != -1 and end != -1:
                jpg = self._buf[start:end + 2]
                self._buf = self._buf[end + 2:]
                frame = cv2.imdecode(np.frombuffer(jpg, dtype=np.uint8),
                                     cv2.IMREAD_COLOR)
                if frame is not None:
                    return frame
                continue
            chunk = self._resp.read(4096)  # type: ignore[attr-defined]
            if not chunk:
                return None
            self._buf += chunk
        return None

    def close(self) -> None:
        if self._resp is not None:
            try:
                self._resp.close()  # type: ignore[attr-defined]
            except Exception:
                pass
            self._resp = None
        self._buf = b""


@dataclass
class HTTPSnapshotSource(FrameSource):
    """Polls a still-image URL (…/snapshot.jpg, …/cgi-bin/currentpic.cgi).

    Every IP camera ever made serves one of these. It is the lowest common
    denominator: no streaming protocol, no codec negotiation, works through
    HTTP proxies and locked-down site firewalls that block RTSP outright.
    Frame rate is limited by poll_interval rather than the camera.
    """
    url: str
    username: str = ""
    password: str = ""
    poll_interval: float = 1.0
    timeout: float = 8.0
    _last_poll: float = 0.0

    def open(self) -> None:
        self._last_poll = 0.0

    def read(self):
        import time as _t
        import urllib.request

        import numpy as np
        import cv2

        wait = self.poll_interval - (_t.time() - self._last_poll)
        if wait > 0:
            _t.sleep(wait)
        self._last_poll = _t.time()

        req = urllib.request.Request(self.url)
        if self.username:
            import base64
            token = base64.b64encode(
                f"{self.username}:{self.password}".encode()).decode()
            req.add_header("Authorization", f"Basic {token}")
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as r:
                data = r.read()
        except Exception:
            return None
        return cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)

    def close(self) -> None:
        pass


@dataclass
class ImageFolderSource(FrameSource):
    """Reads images from a directory, newest last.

    Two real uses: replaying a day of captured evidence through a changed model
    to compare detection counts, and ingesting from drone or handheld cameras
    that drop stills onto a share rather than streaming.
    """
    path: str
    loop: bool = False
    pattern: str = "*.jpg"
    _files: list = field(default_factory=list)
    _idx: int = 0

    def open(self) -> None:
        import glob
        import os

        self._files = sorted(glob.glob(os.path.join(self.path, self.pattern)))
        self._idx = 0

    def read(self):
        import cv2

        if self._idx >= len(self._files):
            if not self.loop or not self._files:
                return None
            self._idx = 0
        path = self._files[self._idx]
        self._idx += 1
        return cv2.imread(path)

    def close(self) -> None:
        self._files = []
        self._idx = 0


def build_source(kind: str, **kwargs) -> FrameSource:
    """Factory used by the camera manager to instantiate from config."""
    kind = kind.lower()
    if kind == "rtsp":
        return RTSPSource(url=kwargs["url"], transport=kwargs.get("transport", ""))
    if kind == "webcam":
        return WebcamSource(index=kwargs.get("index", 0))
    if kind == "screen":
        return ScreenSource(
            top=kwargs.get("top", 0), left=kwargs.get("left", 0),
            width=kwargs.get("width", 1280), height=kwargs.get("height", 720),
        )
    if kind == "video":
        return VideoFileSource(path=kwargs["path"], loop=kwargs.get("loop", False),
                               speed=float(kwargs.get("speed", 1.0)))
    if kind == "onvif":
        return ONVIFSource(
            host=kwargs.get("host", ""), port=int(kwargs.get("port", 80)),
            username=kwargs.get("username", ""), password=kwargs.get("password", ""),
            rtsp_url=kwargs.get("rtsp_url", ""),
        )
    if kind in ("mjpeg", "http-mjpeg"):
        return MJPEGSource(url=kwargs["url"], username=kwargs.get("username", ""),
                           password=kwargs.get("password", ""),
                           timeout=float(kwargs.get("timeout", 10.0)))
    if kind in ("snapshot", "http", "http-snapshot"):
        return HTTPSnapshotSource(
            url=kwargs["url"], username=kwargs.get("username", ""),
            password=kwargs.get("password", ""),
            poll_interval=float(kwargs.get("poll_interval", 1.0)),
            timeout=float(kwargs.get("timeout", 8.0)))
    if kind in ("folder", "images"):
        return ImageFolderSource(path=kwargs["path"], loop=kwargs.get("loop", False),
                                 pattern=kwargs.get("pattern", "*.jpg"))
    if kind in ("hls", "rtmp", "http-stream", "youtube"):
        # CamGear's FFmpeg backend already handles these; RTSPSource is just a
        # thin wrapper over it, so the same class serves them.
        return RTSPSource(url=kwargs["url"], transport=kwargs.get("transport", ""))
    if kind == "fake":
        # API-created demo cameras should live long enough for cold model warmup.
        return FakeSource(frames=kwargs.get("frames", 300))
    raise ValueError(
        f"unknown source kind '{kind}'. Supported: " + ", ".join(SOURCE_KINDS))


# Advertised to the frontend so the camera form can build itself, and so an
# operator can see what the system supports without reading the code.
SOURCE_KINDS: dict[str, dict] = {
    "rtsp": {"label": "RTSP stream", "fields": ["url", "transport"],
             "hint": "rtsp://user:pass@host:554/Streaming/Channels/101"},
    "onvif": {"label": "ONVIF (auto-discover)",
              "fields": ["host", "port", "username", "password"],
              "hint": "Finds the RTSP URL automatically. Most modern IP cameras."},
    "mjpeg": {"label": "HTTP MJPEG", "fields": ["url", "username", "password"],
              "hint": "http://host/video.cgi — works when RTSP is blocked"},
    "snapshot": {"label": "HTTP snapshot (polling)",
                 "fields": ["url", "username", "password", "poll_interval"],
                 "hint": "http://host/snapshot.jpg — lowest common denominator"},
    "hls": {"label": "HLS / RTMP / HTTP stream", "fields": ["url"],
            "hint": "https://host/stream.m3u8 — NVR and cloud re-streams"},
    "webcam": {"label": "USB / built-in camera", "fields": ["index"],
               "hint": "Device index, usually 0"},
    "video": {"label": "Video file", "fields": ["path", "loop", "speed"],
              "hint": "Replay recorded footage"},
    "folder": {"label": "Image folder", "fields": ["path", "pattern", "loop"],
               "hint": "Drone or handheld stills dropped on a share"},
    "screen": {"label": "Screen capture",
               "fields": ["top", "left", "width", "height"],
               "hint": "For NVR software with no stream export"},
    "fake": {"label": "Test pattern", "fields": ["frames"],
             "hint": "Synthetic frames for pipeline testing"},
}
