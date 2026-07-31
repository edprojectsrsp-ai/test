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
    """Manual teach: push the camera's current frame into the review queue.

    Uses the RAW frame + this frame's detections from live_view's state store.
    The previous version decoded the annotated MJPEG frame — red boxes and the
    status banner burnt into the pixels — with an empty prediction list, so the
    labeler opened a defaced image with nothing to correct, and anything
    trained on it would learn to detect our own overlay.
    """
    from app.core.db import SessionLocal
    from app.ml.detector import Detection, FrameResult
    from app.services.capture_service import get_capture_service

    state = live_view.live_state(camera_id)
    if state is None:
        raise HTTPException(404, "no live frame to flag")
    fr = FrameResult(width=state["width"], height=state["height"])
    for d in state["detections"]:
        fr.detections.append(Detection(
            cls_name=d["cls"], raw_name=d["raw"], confidence=d["conf"],
            xyxy=tuple(d["xyxy"]), track_id=d.get("track_id")))
    meta = live_view.latest_meta(camera_id)
    async with SessionLocal() as session:
        item = await get_capture_service().capture_manual(
            session, camera_id, state["frame"], fr,
            note=note or f"manual flag from live view (mode={meta.get('mode', '?')})",
        )
    return {"captured": True, "capture_id": item.id, "image": item.image_path}


# ------------------------------------------------------------ live teach
def _describe_boxes(detections: list[dict]) -> list[dict]:
    """Detections -> teach boxes carrying label, flip target and kind."""
    from app.ml import taxonomy

    inverse = {v: k for k, v in taxonomy.GEAR_PAIRS.items()}
    boxes = []
    for i, d in enumerate(detections):
        cls = d["cls"]
        if cls in taxonomy.GEAR_PAIRS:            # positive gear
            counterpart, kind = taxonomy.GEAR_PAIRS[cls], "gear"
        elif cls in inverse:                       # negative twin
            counterpart, kind = inverse[cls], "violation"
        elif cls == "person":
            counterpart, kind = None, "person"
        else:
            counterpart, kind = None, "other"
        boxes.append({
            "i": i, "cls": cls, "conf": d["conf"], "xyxy": d["xyxy"],
            "kind": kind, "label": taxonomy.display_name(cls),
            "counterpart": counterpart,
            "known": cls in taxonomy.CLASS_TO_ID,
        })
    return boxes


def _teach_classes() -> dict:
    """The class palette the drawing tool offers, grouped for the picker."""
    from app.ml import taxonomy

    return {
        "classes": taxonomy.CANONICAL_CLASSES,
        "display_names": taxonomy.DISPLAY_NAMES,
        "gear_pairs": taxonomy.GEAR_PAIRS,
        "hazards": sorted(taxonomy.HAZARD_CLASSES),
    }


@router.get("/{camera_id}/live-labels")
async def live_labels(camera_id: str, frame_id: int | None = None) -> dict:
    """Detections as clickable boxes for the Live Teach overlay.

    Boxes carry the operator-facing label and the flip target so the frontend
    needs no taxonomy knowledge of its own. Pass `frame_id` to re-read a
    specific frame the operator froze rather than whatever is newest.
    """
    state = (live_view.frame_state(camera_id, frame_id) if frame_id is not None
             else live_view.live_state(camera_id))
    if state is None:
        raise HTTPException(404, "no live frame yet for this camera"
                            if frame_id is None else
                            f"frame {frame_id} is no longer buffered")
    return {"frame_id": state["frame_id"], "width": state["width"],
            "height": state["height"], "ts": state["ts"],
            "boxes": _describe_boxes(state["detections"]),
            **_teach_classes()}


@router.post("/{camera_id}/teach-freeze")
async def teach_freeze(camera_id: str, frame_id: int | None = None) -> dict:
    """Freeze a frame for labelling and hold it against eviction.

    Teaching on a moving picture is guesswork — the operator points at a worker
    and by the time they have chosen a class the worker has walked on. Freezing
    pins one frame server-side, so the boxes, the JPEG behind them and the
    labels that get saved are all provably the same instant.
    """
    state = live_view.pin_frame(camera_id, frame_id)
    if state is None:
        raise HTTPException(404, "no frame available to freeze")
    return {
        "frame_id": state["frame_id"], "width": state["width"],
        "height": state["height"], "ts": state["ts"],
        "boxes": _describe_boxes(state["detections"]),
        "image_url": (f"/api/cameras/{camera_id}/teach-frame.jpg"
                      f"?frame_id={state['frame_id']}"),
        **_teach_classes(),
    }


@router.post("/{camera_id}/teach-release")
async def teach_release(camera_id: str, frame_id: int) -> dict:
    """Drop a frozen frame's pin — the operator closed the teach panel."""
    return {"released": live_view.unpin_frame(camera_id, frame_id)}


@router.get("/{camera_id}/teach-frame.jpg")
async def teach_frame(camera_id: str, frame_id: int | None = None):
    """The RAW frame behind a teach session, with no overlay burnt in.

    Deliberately not the MJPEG frame: that one has our boxes and status banner
    drawn on it, and a training set built from those images teaches the model
    to detect our own rectangles.
    """
    import cv2

    state = live_view.frame_state(camera_id, frame_id)
    if state is None:
        raise HTTPException(404, "that frame is no longer buffered")
    ok, buf = cv2.imencode(".jpg", state["frame"],
                           [int(cv2.IMWRITE_JPEG_QUALITY), 90])
    if not ok:
        raise HTTPException(500, "could not encode frame")
    return Response(content=buf.tobytes(), media_type="image/jpeg",
                    headers={"Cache-Control": "no-store"})


class TeachBox(BaseModel):
    cls: str
    xyxy: list[float] = Field(..., min_length=4, max_length=4)


class TeachLiveIn(BaseModel):
    frame_id: int | None = None
    boxes: list[TeachBox]
    note: str = ""


@router.post("/{camera_id}/teach-live")
async def teach_live(camera_id: str, payload: TeachLiveIn) -> dict:
    """Save a corrected live frame straight into the training pool.

    `boxes` is the COMPLETE intended label set for the frame, not a patch. That
    is what makes all three corrections expressible with one payload:

        flip    the same box with its counterpart class ("Cap Not found" on a
                worker who is plainly wearing one)
        add     a box the model missed entirely — the highest-value correction,
                because a miss produces no box to click on
        delete  a box simply omitted, which is the only way to say "the model
                saw a helmet and there is no helmet there"

    The frame is resolved by exact `frame_id` from the ring buffer, so the
    labels land on the picture the operator was actually looking at rather than
    on whatever arrived while they were deciding. If that frame has aged out
    the correction is refused — attaching it to a different scene would quietly
    poison the training set.

    The result is marked LABELED and skips the Review queue: a human has
    already made the judgement, so asking a second human to confirm it adds
    latency and no information.
    """
    from app.core.db import SessionLocal
    from app.ml import taxonomy
    from app.ml.detector import FrameResult
    from app.services.capture_service import get_capture_service
    from app.services.review_service import get_review_service

    state = live_view.frame_state(camera_id, payload.frame_id)
    if state is None:
        raise HTTPException(
            409 if payload.frame_id is not None else 404,
            "that frame is no longer buffered — freeze the live view again"
            if payload.frame_id is not None else "no live frame for this camera")

    unknown = sorted({b.cls for b in payload.boxes
                      if b.cls not in taxonomy.CLASS_TO_ID})
    if unknown:
        raise HTTPException(422, f"unknown class(es): {', '.join(unknown)}")
    boxes = [{"cls": b.cls, "xyxy": list(b.xyxy)} for b in payload.boxes]
    if not boxes:
        raise HTTPException(422, "no labelable boxes in this frame")

    w, h = state["width"], state["height"]
    for b in boxes:
        x1, y1, x2, y2 = b["xyxy"]
        if x2 <= x1 or y2 <= y1:
            raise HTTPException(422, f"box for '{b['cls']}' has zero area")
        # Clamp rather than reject: a box drawn slightly off the edge is a
        # normal mouse gesture, and losing the whole correction over it would
        # be a worse answer than trimming it to the frame.
        b["xyxy"] = [max(0.0, min(x1, w)), max(0.0, min(y1, h)),
                     max(0.0, min(x2, w)), max(0.0, min(y2, h))]

    fr = FrameResult(width=w, height=h)
    async with SessionLocal() as session:
        item = await get_capture_service().capture_manual(
            session, camera_id, state["frame"], fr,
            note=payload.note or "live-teach correction from control room",
        )
        item = await get_review_service().apply_corrections(session, item.id, boxes)
    live_view.unpin_frame(camera_id, state["frame_id"])
    return {"captured": True, "capture_id": item.id, "labels": len(boxes),
            "status": item.status.value, "frame_id": state["frame_id"]}
