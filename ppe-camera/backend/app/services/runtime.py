"""
Runtime wiring -- the seam between the framework and the pipeline.

This builds the ONE CameraManager the app uses, injecting:
  - the real Detector (YOLO+ByteTrack) as the detect function
  - a capture sink that writes to the review queue via CaptureService

The capture sink bridges the sync camera-worker threads to the async DB. It
runs a short-lived async task per capture on the app's event loop, so the
worker thread never blocks on IO and the DB session stays correctly scoped.
"""
from __future__ import annotations

import asyncio
import threading

from app.ml.detector import FrameResult, get_detector
from app.services.camera_manager import CameraManager

_manager: CameraManager | None = None
_loop: asyncio.AbstractEventLoop | None = None
_lock = threading.Lock()


def set_event_loop(loop: asyncio.AbstractEventLoop) -> None:
    """Called at startup so worker threads can schedule DB writes."""
    global _loop
    _loop = loop


def _detect(frame) -> FrameResult:
    return get_detector().infer(frame, track=True)


def _capture_sink(camera_id: str, frame, result: FrameResult, fired) -> dict:
    """
    Bridge sync worker -> async DB write. Schedules the capture on the app
    loop and waits briefly for the result so stats stay accurate.
    """
    if _loop is None:
        return False

    from app.core.db import SessionLocal
    from app.services.capture_service import get_capture_service

    async def _do() -> dict:
        async with SessionLocal() as session:
            svc = get_capture_service()
            if fired is None:  # uncertainty harvest (collect/strict mode)
                item = await svc.capture_uncertain(session, camera_id, frame, result)
                return {
                    "captured": item is not None,
                    "capture_id": getattr(item, "id", None),
                    "snapshot_path": getattr(item, "image_path", None),
                }
            item = await svc.capture_violation(
                session, camera_id, frame, result, fired
            )
            if item is None:
                # deduped (same person + same violation within cooldown) ->
                # don't create a duplicate alert either.
                return {"captured": False, "capture_id": None, "snapshot_path": None}
            # Durable operational record (analytics), independent of the image
            # queue. Best-effort: never let it fail the capture path.
            try:
                from app.services.persistence import get_persistence_service

                await get_persistence_service().record_violation(
                    session,
                    camera_id=camera_id,
                    rule_type=getattr(fired, "rule_type", "ppe"),
                    gear=getattr(fired, "gear", "ppe"),
                    track_id=getattr(fired, "track_id", None),
                    confidence=getattr(fired, "confidence", 0.0),
                    person_box=getattr(fired, "person_box", None),
                    capture_id=getattr(item, "id", None),
                    image_path=getattr(item, "image_path", ""),
                )
            except Exception:
                pass
            return {
                "captured": True,
                "capture_id": getattr(item, "id", None),
                "snapshot_path": getattr(item, "image_path", None),
            }

    fut = asyncio.run_coroutine_threadsafe(_do(), _loop)
    try:
        return fut.result(timeout=5.0)
    except Exception:
        return {"captured": False, "capture_id": None, "snapshot_path": None}


def get_manager() -> CameraManager:
    global _manager
    if _manager is None:
        with _lock:
            if _manager is None:
                _manager = CameraManager(detect_fn=_detect, capture_sink=_capture_sink)
    return _manager
