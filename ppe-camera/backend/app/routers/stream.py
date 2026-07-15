"""
Live view + control endpoints for the Control Room dashboard.

  GET   /cameras/{id}/stream.mjpg   annotated MJPEG (plain <img> in the UI)
  GET   /cameras/{id}/snapshot.jpg  one annotated frame
  POST  /cameras/{id}/mode          {"mode": "off|monitor|collect|strict"}
  POST  /cameras/{id}/flag          human hits "Teach" on the live view ->
                                    current frame goes straight to the review
                                    queue as a manual capture
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field

from app.services import live_view

router = APIRouter(prefix="/api/cameras", tags=["live"])


def _manager():
    from app.services.runtime import get_manager

    return get_manager()


@router.get("/{camera_id}/stream.mjpg")
async def stream(camera_id: str, fps: float = 10.0):
    if live_view.latest(camera_id) is None:
        # camera may still be warming up; the generator waits ~10s then closes
        pass
    return StreamingResponse(
        live_view.mjpeg(camera_id, fps=fps),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={"Cache-Control": "no-store"},
    )


@router.get("/{camera_id}/snapshot.jpg")
async def snapshot(camera_id: str):
    buf = live_view.latest(camera_id)
    if buf is None:
        raise HTTPException(404, "no frame yet for this camera")
    return Response(content=buf, media_type="image/jpeg",
                    headers={"Cache-Control": "no-store"})


class ModeIn(BaseModel):
    mode: str = Field(..., pattern=r"^(off|monitor|collect|strict)$")


@router.post("/{camera_id}/mode")
async def set_mode(camera_id: str, payload: ModeIn) -> dict:
    try:
        mode = _manager().set_mode(camera_id, payload.mode)
    except KeyError:
        raise HTTPException(404, f"unknown camera {camera_id}")
    except ValueError as e:
        raise HTTPException(422, str(e))
    return {"camera_id": camera_id, "mode": mode}


@router.post("/{camera_id}/flag")
async def flag(camera_id: str, note: str = "") -> dict:
    """Manual teach: push the camera's current frame into the review queue."""
    import cv2
    import numpy as np

    buf = live_view.latest(camera_id)
    if buf is None:
        raise HTTPException(404, "no live frame to flag")
    frame = cv2.imdecode(np.frombuffer(buf, dtype=np.uint8), cv2.IMREAD_COLOR)

    from app.core.db import SessionLocal
    from app.ml.detector import FrameResult
    from app.services.capture_service import get_capture_service

    meta = live_view.latest_meta(camera_id)
    fr = FrameResult(width=frame.shape[1], height=frame.shape[0])  # boxes already burnt in
    async with SessionLocal() as session:
        item = await get_capture_service().capture_manual(
            session, camera_id, frame, fr,
            note=note or f"manual flag from live view (mode={meta.get('mode', '?')})",
        )
    return {"captured": True, "capture_id": item.id, "image": item.image_path}
