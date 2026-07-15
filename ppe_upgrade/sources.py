"""sources.py — unified video frame sources for the PPE pipeline.

One protocol, four sources, one factory string:
    "webcam:0"                     laptop/USB camera (TESTING provision)
    "rtsp://user:pass@ip/stream"   IP CCTV / DVR / NVR channel
    "file:/path/clip.mp4"          recorded footage (loops; demo/regression)
    "screen:0,0,1280,720"          SCREEN-RECORDER FALLBACK — captures a region
                                   of the desktop where a DVR viewer app (SmartPSS,
                                   iVMS-4200, etc.) is showing the feed. For when
                                   the DVR exposes no RTSP/ONVIF at all.

The camera manager only sees FrameSource: open() -> read() -> (ok, ndarray BGR)
-> close(). RTSP auto-reconnects with backoff; screen capture uses mss (MIT).
cv2 / mss / numpy are imported lazily so this module loads on any box.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Optional, Protocol, Tuple


class FrameSource(Protocol):
    def open(self) -> bool: ...
    def read(self) -> Tuple[bool, Optional["object"]]: ...
    def close(self) -> None: ...
    @property
    def label(self) -> str: ...


@dataclass
class WebcamSource:
    """Local webcam by index — the zero-setup testing source."""
    index: int = 0
    width: int = 1280
    height: int = 720
    _cap: object = field(default=None, repr=False)

    @property
    def label(self) -> str:
        return f"webcam:{self.index}"

    def open(self) -> bool:
        import cv2
        self._cap = cv2.VideoCapture(self.index)
        if not self._cap.isOpened():
            return False
        self._cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.width)
        self._cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.height)
        return True

    def read(self):
        if self._cap is None:
            return False, None
        return self._cap.read()

    def close(self) -> None:
        if self._cap is not None:
            self._cap.release()
            self._cap = None


@dataclass
class RtspSource:
    """RTSP/HTTP stream with automatic reconnect + exponential backoff."""
    url: str = ""
    reconnect_max_wait: float = 30.0
    _cap: object = field(default=None, repr=False)
    _fail_streak: int = field(default=0, repr=False)

    @property
    def label(self) -> str:
        return self.url.split("@")[-1][:60]  # never log credentials

    def open(self) -> bool:
        import cv2
        self._cap = cv2.VideoCapture(self.url, cv2.CAP_FFMPEG)
        ok = bool(self._cap.isOpened())
        self._fail_streak = 0 if ok else self._fail_streak + 1
        return ok

    def read(self):
        if self._cap is None and not self._reconnect():
            return False, None
        ok, frame = self._cap.read()
        if not ok:
            self._fail_streak += 1
            if self._reconnect():
                ok, frame = self._cap.read()
        else:
            self._fail_streak = 0
        return ok, frame

    def _reconnect(self) -> bool:
        wait = min(self.reconnect_max_wait, 0.5 * (2 ** min(self._fail_streak, 6)))
        time.sleep(wait)
        self.close()
        return self.open()

    def close(self) -> None:
        if self._cap is not None:
            self._cap.release()
            self._cap = None


@dataclass
class FileSource:
    """Video file that loops forever — demos and regression runs."""
    path: str = ""
    loop: bool = True
    _cap: object = field(default=None, repr=False)

    @property
    def label(self) -> str:
        return f"file:{self.path.rsplit('/', 1)[-1]}"

    def open(self) -> bool:
        import cv2
        self._cap = cv2.VideoCapture(self.path)
        return bool(self._cap.isOpened())

    def read(self):
        import cv2
        if self._cap is None:
            return False, None
        ok, frame = self._cap.read()
        if not ok and self.loop:
            self._cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            ok, frame = self._cap.read()
        return ok, frame

    def close(self) -> None:
        if self._cap is not None:
            self._cap.release()
            self._cap = None


@dataclass
class ScreenSource:
    """Screen-region capture — THE DVR-VIEWER FALLBACK.

    Point it at the rectangle of the desktop where the vendor viewer app shows
    the camera, and the pipeline treats it like any other feed. Uses mss (MIT,
    pure Python, ~60fps capable). fps_cap throttles so we don't melt the CPU.
    """
    left: int = 0
    top: int = 0
    width: int = 1280
    height: int = 720
    fps_cap: float = 8.0
    _sct: object = field(default=None, repr=False)
    _last_ts: float = field(default=0.0, repr=False)

    @property
    def label(self) -> str:
        return f"screen:{self.left},{self.top},{self.width}x{self.height}"

    def open(self) -> bool:
        import mss
        self._sct = mss.mss()
        return True

    def read(self):
        import numpy as np
        if self._sct is None:
            return False, None
        gap = 1.0 / self.fps_cap - (time.time() - self._last_ts)
        if gap > 0:
            time.sleep(gap)
        self._last_ts = time.time()
        shot = self._sct.grab({"left": self.left, "top": self.top,
                               "width": self.width, "height": self.height})
        frame = np.asarray(shot)[:, :, :3]  # BGRA -> BGR
        return True, frame

    def close(self) -> None:
        if self._sct is not None:
            self._sct.close()
            self._sct = None


def make_source(spec: str) -> FrameSource:
    """Factory: 'webcam:0' | 'rtsp://…' | 'file:/path' | 'screen:l,t,w,h'."""
    spec = (spec or "").strip()
    if spec.startswith("webcam:"):
        return WebcamSource(index=int(spec.split(":", 1)[1] or 0))
    if spec.startswith(("rtsp://", "rtsps://", "http://", "https://")):
        return RtspSource(url=spec)
    if spec.startswith("file:"):
        return FileSource(path=spec.split(":", 1)[1])
    if spec.startswith("screen:"):
        parts = [int(x) for x in spec.split(":", 1)[1].split(",")]
        left, top, width, height = (parts + [0, 0, 1280, 720])[:4]
        return ScreenSource(left=left, top=top, width=width, height=height)
    raise ValueError(f"Unknown source spec: {spec!r} "
                     "(use webcam:N | rtsp://… | file:/path | screen:l,t,w,h)")
