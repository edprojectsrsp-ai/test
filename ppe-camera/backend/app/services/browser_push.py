"""
Browser push frames — operator crops a tab/window/webcam in the browser
and streams JPEG frames into a virtual camera on the PPE server.

Typical use:
  1. Login to an NVR / DVR web viewer in Chrome.
  2. PPE "Browser crop" → Share that tab → draw a rectangle over the live pane.
  3. Cropped frames POST to /api/cameras/{id}/push-frame.
  4. BrowserPushSource.read() feeds the worker pipeline like any other camera.
"""
from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from typing import Any

import numpy as np


@dataclass
class _Slot:
    frame: Any = None          # BGR numpy array
    updated_at: float = 0.0
    width: int = 0
    height: int = 0
    frames_received: int = 0
    last_error: str = ""


class BrowserFrameHub:
    """Process-wide latest-frame store keyed by camera_id."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._slots: dict[str, _Slot] = {}

    def push_jpeg(self, camera_id: str, data: bytes) -> dict:
        import cv2

        if not data:
            raise ValueError("empty frame")
        arr = np.frombuffer(data, dtype=np.uint8)
        bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if bgr is None or getattr(bgr, "size", 0) == 0:
            raise ValueError("could not decode JPEG frame")
        return self.push_bgr(camera_id, bgr)

    def push_bgr(self, camera_id: str, bgr) -> dict:
        h, w = bgr.shape[:2]
        with self._lock:
            slot = self._slots.get(camera_id)
            if slot is None:
                slot = _Slot()
                self._slots[camera_id] = slot
            slot.frame = bgr
            slot.updated_at = time.time()
            slot.width = int(w)
            slot.height = int(h)
            slot.frames_received += 1
            slot.last_error = ""
            n = slot.frames_received
        return {
            "camera_id": camera_id,
            "width": w,
            "height": h,
            "frames_received": n,
            "ok": True,
        }

    def latest(self, camera_id: str, *, max_age_s: float = 30.0):
        """Return a copy of the latest frame, or None if missing/stale."""
        with self._lock:
            slot = self._slots.get(camera_id)
            if slot is None or slot.frame is None:
                return None
            age = time.time() - slot.updated_at
            if max_age_s > 0 and age > max_age_s:
                return None
            return slot.frame.copy()

    def status(self, camera_id: str | None = None) -> dict:
        with self._lock:
            if camera_id:
                s = self._slots.get(camera_id)
                if not s:
                    return {"camera_id": camera_id, "has_frame": False}
                return {
                    "camera_id": camera_id,
                    "has_frame": s.frame is not None,
                    "width": s.width,
                    "height": s.height,
                    "age_s": round(time.time() - s.updated_at, 2) if s.updated_at else None,
                    "frames_received": s.frames_received,
                }
            return {
                "cameras": [
                    {
                        "camera_id": cid,
                        "has_frame": s.frame is not None,
                        "frames_received": s.frames_received,
                        "age_s": round(time.time() - s.updated_at, 2) if s.updated_at else None,
                    }
                    for cid, s in self._slots.items()
                ]
            }

    def clear(self, camera_id: str) -> None:
        with self._lock:
            self._slots.pop(camera_id, None)


_HUB: BrowserFrameHub | None = None
_HUB_LOCK = threading.Lock()


def get_hub() -> BrowserFrameHub:
    global _HUB
    with _HUB_LOCK:
        if _HUB is None:
            _HUB = BrowserFrameHub()
        return _HUB


@dataclass
class BrowserPushSource:
    """
    FrameSource fed by browser POSTs. Waits for the first frame on open(),
    then keeps returning the latest frame (or a short sleep + last frame)
    so the worker stays healthy while the operator is cropping.
    """
    camera_id: str
    wait_first_s: float = 0.0       # 0 = start immediately; blank until first push
    idle_sleep_s: float = 0.05
    max_age_s: float = 0.0          # 0 = never expire; browser may pause briefly
    _opened: bool = False
    _blank: Any = field(default=None, repr=False)
    # Lets close() interrupt the first-frame wait. Without it, stopping or
    # removing a browser camera while it is still waiting for the operator to
    # share their tab blocks for the whole wait_first_s window — two minutes by
    # default — with the API call hanging on the worker's join().
    _closing: threading.Event = field(default_factory=threading.Event, repr=False)

    def open(self) -> None:
        import cv2

        self._closing.clear()
        self._opened = True
        # Placeholder until the operator shares + crops in the browser.
        self._blank = np.zeros((360, 640, 3), dtype=np.uint8)
        cv2.putText(
            self._blank,
            "Waiting for browser crop…",
            (40, 180),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.7,
            (180, 180, 180),
            2,
            cv2.LINE_AA,
        )
        wait = float(self.wait_first_s or 0)
        if wait <= 0:
            return
        deadline = time.time() + wait
        hub = get_hub()
        while time.time() < deadline:
            fr = hub.latest(self.camera_id, max_age_s=0)
            if fr is not None:
                return
            # Interruptible: wait() returns immediately once close() fires, so
            # stopping the camera does not block for the rest of the window.
            if self._closing.wait(0.15):
                return

    def read(self):
        if not self._opened:
            return None
        hub = get_hub()
        fr = hub.latest(self.camera_id, max_age_s=float(self.max_age_s or 0) or 0)
        if fr is not None:
            time.sleep(self.idle_sleep_s)  # pace the worker when browser is slow
            return fr
        # No frame yet / browser paused — yield blank so supervisor stays healthy.
        time.sleep(0.2)
        return self._blank.copy() if self._blank is not None else None

    def close(self) -> None:
        self._closing.set()
        self._opened = False
        # Keep hub frames so a restart can resume; operator may still be pushing.
