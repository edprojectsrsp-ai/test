r"""
NVR API -- recording control, timeline, playback, and teaching over footage.

Four groups of endpoints:

  recording   arm a camera for event or continuous recording, cut a clip on
              demand, see what each recorder is doing
  library     query segments, draw a day's timeline, lock evidence, delete
  playback    scrub to a frame, stream a clip, download the original file
  teach       run the detector on any recorded frame, correct it, and bank the
              correction as training data

On playback transport: recorded files are encoded with whatever codec OpenCV
could actually open on this machine, which on Windows is usually MPEG-4 Part 2
— a codec browsers refuse to decode. Rather than make the operator's ability to
review evidence depend on the codec lottery, playback decodes server-side and
streams MJPEG, the same transport the live view already uses. A clip therefore
plays in a plain <img> on any browser, seeking is instant (the server just
jumps the decoder), and `download` still hands over the original file for
anyone who wants it in a real player.

On teaching over footage: this is where the training data actually is. Live
Teach only sees what a camera is pointing at right now, so correcting the model
on a rare event — a worker without a harness at height, someone in the wrong
zone at night — means waiting for it to happen again while an operator watches.
The same event is already recorded. `GET /detect` runs the live detector over
any frame of any clip, `POST /teach` saves the corrected boxes on that exact
frame, and both feed the identical CaptureItem/ReviewLabel pipeline the live
path uses, so one "Train & go live" folds in corrections from both sources.
"""
from __future__ import annotations

import logging
import os
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import FileResponse, Response, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from app.core.config import get_settings
from app.core.db import SessionLocal
from app.models.nvr import RecordingSegment, SegmentKind
from app.services.recorder import RECORD_MODES, get_recorder

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/nvr", tags=["nvr"])


def _aware(dt: datetime | None) -> datetime | None:
    """SQLite returns naive datetimes; every comparison here needs UTC-aware."""
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _seg_dict(s: RecordingSegment) -> dict:
    started = _aware(s.started_at)
    ended = _aware(s.ended_at)
    return {
        "id": s.id,
        "camera_id": s.camera_id,
        "kind": s.kind.value if hasattr(s.kind, "value") else str(s.kind),
        "started_at": started.isoformat() if started else None,
        "ended_at": ended.isoformat() if ended else None,
        "duration_s": round(float(s.duration_s or 0), 2),
        "size_bytes": int(s.size_bytes or 0),
        "size_mb": round(int(s.size_bytes or 0) / 1024 ** 2, 2),
        "width": s.width, "height": s.height,
        "fps": float(s.fps or 0), "frames": int(s.frames or 0),
        "codec": s.codec, "trigger": s.trigger,
        "events": list(s.events or []),
        "event_count": len(s.events or []),
        "locked": bool(s.locked),
        "note": s.note or "",
        "exists": bool(s.path and os.path.exists(s.path)),
        "has_thumb": bool(s.thumb_path and os.path.exists(s.thumb_path)),
    }


async def _get_segment(segment_id: str) -> RecordingSegment:
    async with SessionLocal() as session:
        seg = await session.get(RecordingSegment, segment_id)
        if seg is None:
            raise HTTPException(404, f"segment {segment_id} not found")
        return seg


def _open_clip(seg: RecordingSegment):
    """Open a segment's file for decoding. Raises 410 if the file is gone."""
    import cv2

    if not seg.path or not os.path.exists(seg.path):
        raise HTTPException(410, "recording file is no longer on disk "
                                 "(deleted by retention?)")
    cap = cv2.VideoCapture(seg.path)
    if not cap.isOpened():
        cap.release()
        raise HTTPException(422, f"could not decode {Path(seg.path).name}")
    return cap


def _seek(cap, seg: RecordingSegment, t: float) -> None:
    """Seek to `t` seconds. Frame index first, milliseconds as the fallback.

    Frame-index seeking is exact for the codecs we write; POS_MSEC is honoured
    inconsistently and on some builds silently does nothing, which would make
    every scrub return frame 0.
    """
    import cv2

    t = max(0.0, float(t or 0.0))
    fps = float(seg.fps or 0) or 8.0
    idx = int(t * fps)
    if idx <= 0:
        return
    if not cap.set(cv2.CAP_PROP_POS_FRAMES, idx):
        cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000.0)


def _frame_at(seg: RecordingSegment, t: float):
    """Decode one frame at `t` seconds. Returns a BGR array."""
    cap = _open_clip(seg)
    try:
        _seek(cap, seg, t)
        ok, frame = cap.read()
        if not ok or frame is None:
            # a seek past the end, or a damaged tail — fall back to frame 0 so
            # the operator sees the clip rather than an error page
            cap.set(0, 0)
            ok, frame = cap.read()
        if not ok or frame is None:
            raise HTTPException(422, "no decodable frame at that position")
        return frame
    finally:
        cap.release()


# =========================================================== recording control
class RecordModeIn(BaseModel):
    mode: str = Field(..., pattern=r"^(off|events|continuous)$")


@router.get("/status")
async def nvr_status() -> dict:
    """What every recorder is doing right now, plus storage headroom."""
    rec = get_recorder()
    s = get_settings()
    async with SessionLocal() as session:
        total_bytes = int(await session.scalar(
            select(func.coalesce(func.sum(RecordingSegment.size_bytes), 0))) or 0)
        total_segments = int(await session.scalar(
            select(func.count()).select_from(RecordingSegment)) or 0)
        locked = int(await session.scalar(
            select(func.count()).select_from(RecordingSegment)
            .where(RecordingSegment.locked.is_(True))) or 0)
    budget = max(0.1, s.RECORD_MAX_GB) * 1024 ** 3
    return {
        "recorders": rec.status(),
        "modes": list(RECORD_MODES),
        "storage": {
            "used_bytes": total_bytes,
            "used_gb": round(total_bytes / 1024 ** 3, 3),
            "max_gb": s.RECORD_MAX_GB,
            "used_pct": round(min(100.0, total_bytes / budget * 100), 1),
            "segments": total_segments,
            "locked_segments": locked,
            "retention_days": s.RECORD_RETENTION_DAYS,
            "path": str(s.RECORDINGS_DIR),
        },
        "config": _config_payload(),
    }


@router.get("/cameras/{camera_id}/recording")
async def get_recording(camera_id: str) -> dict:
    rec = get_recorder()
    status = rec.status(camera_id)
    return status[0] if status else {"camera_id": camera_id, "mode": "off",
                                     "recording": False, "stats": {}}


@router.put("/cameras/{camera_id}/recording")
async def set_recording(camera_id: str, body: RecordModeIn) -> dict:
    """Arm or disarm recording for one camera. Takes effect on the next frame."""
    from app.services.runtime import get_manager

    try:
        get_manager().status(camera_id)      # 404 rather than record a ghost
    except KeyError:
        raise HTTPException(404, f"camera '{camera_id}' not found")
    try:
        mode = get_recorder().set_mode(camera_id, body.mode)
    except ValueError as e:
        raise HTTPException(422, str(e))
    await _save_camera_record_mode(camera_id, mode)
    return {"camera_id": camera_id, "mode": mode}


class RecordNowIn(BaseModel):
    seconds: float = Field(30.0, ge=2.0, le=600.0)


@router.post("/cameras/{camera_id}/record-now")
async def record_now(camera_id: str, body: RecordNowIn) -> dict:
    """Cut a clip from now, with the usual pre-roll already in front of it.

    The pre-roll is the point: an operator presses this *after* seeing
    something, so a clip that starts at the press has already missed it.
    """
    from app.services.runtime import get_manager

    try:
        get_manager().status(camera_id)
    except KeyError:
        raise HTTPException(404, f"camera '{camera_id}' not found")
    out = get_recorder().record_now(camera_id, seconds=body.seconds)
    await _save_camera_record_mode(camera_id, out["mode"])
    return out


# ==================================================================== library
@router.get("/segments")
async def list_segments(
    camera_id: str = "",
    kind: str = "",
    start: str = "",
    end: str = "",
    events_only: bool = False,
    locked_only: bool = False,
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
) -> dict:
    """Query the recording library. All filters optional and combinable."""
    q = select(RecordingSegment)
    if camera_id:
        q = q.where(RecordingSegment.camera_id == camera_id)
    if kind:
        if kind not in [k.value for k in SegmentKind]:
            raise HTTPException(422, f"unknown kind '{kind}'")
        q = q.where(RecordingSegment.kind == SegmentKind(kind))
    if locked_only:
        q = q.where(RecordingSegment.locked.is_(True))
    for value, op in ((start, "start"), (end, "end")):
        if not value:
            continue
        try:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(422, f"{op} must be ISO-8601, got {value!r}")
        dt = dt.replace(tzinfo=None) if dt.tzinfo else dt
        q = q.where(RecordingSegment.started_at >= dt if op == "start"
                    else RecordingSegment.started_at <= dt)

    async with SessionLocal() as session:
        total = int(await session.scalar(
            select(func.count()).select_from(q.subquery())) or 0)
        rows = list((await session.execute(
            q.order_by(RecordingSegment.started_at.desc())
            .limit(limit).offset(offset))).scalars())

    items = [_seg_dict(r) for r in rows]
    if events_only:
        items = [i for i in items if i["event_count"] > 0 or i["kind"] == "event"]
    return {"segments": items, "total": total, "limit": limit, "offset": offset}


@router.get("/timeline")
async def timeline(camera_id: str, date: str = "", buckets: int = Query(288, ge=24, le=1440)) -> dict:
    """One camera's coverage for one day, as fixed buckets plus event markers.

    Returned as buckets rather than raw segments because a continuous camera
    produces 288 segments a day and the browser should not be re-deriving a
    coverage bar from them on every render. Default 288 buckets = 5 minutes
    each, which matches the default segment length.
    """
    if date:
        try:
            day = datetime.fromisoformat(date).replace(
                hour=0, minute=0, second=0, microsecond=0, tzinfo=timezone.utc)
        except ValueError:
            raise HTTPException(422, "date must be YYYY-MM-DD")
    else:
        day = datetime.now(timezone.utc).replace(
            hour=0, minute=0, second=0, microsecond=0)
    day_end = day + timedelta(days=1)
    naive_start, naive_end = day.replace(tzinfo=None), day_end.replace(tzinfo=None)

    async with SessionLocal() as session:
        rows = list((await session.execute(
            select(RecordingSegment)
            .where(RecordingSegment.camera_id == camera_id)
            .where(RecordingSegment.started_at >= naive_start)
            .where(RecordingSegment.started_at < naive_end)
            .order_by(RecordingSegment.started_at.asc()))).scalars())

    bucket_s = 86400.0 / buckets
    coverage = [0.0] * buckets
    markers: list[dict] = []
    for r in rows:
        started = _aware(r.started_at)
        if started is None:
            continue
        offset = (started - day).total_seconds()
        dur = float(r.duration_s or 0)
        first = max(0, int(offset // bucket_s))
        last = min(buckets - 1, int((offset + dur) // bucket_s))
        for b in range(first, last + 1):
            # fraction of this bucket the segment actually covers
            b_start, b_end = b * bucket_s, (b + 1) * bucket_s
            overlap = min(offset + dur, b_end) - max(offset, b_start)
            if overlap > 0:
                coverage[b] = min(1.0, coverage[b] + overlap / bucket_s)
        for ev in (r.events or []):
            markers.append({
                "segment_id": r.id,
                "t": ev.get("t", 0),
                "at_s": round(offset + float(ev.get("t") or 0), 1),
                "gear": ev.get("gear", ""),
                "rule_type": ev.get("rule_type", "ppe"),
                "confidence": ev.get("confidence"),
            })

    return {
        "camera_id": camera_id,
        "date": day.date().isoformat(),
        "buckets": buckets,
        "bucket_seconds": round(bucket_s, 2),
        "coverage": [round(c, 3) for c in coverage],
        "segments": [_seg_dict(r) for r in rows],
        "events": markers,
        "recorded_seconds": round(sum(float(r.duration_s or 0) for r in rows), 1),
    }


@router.get("/segments/{segment_id}")
async def get_segment(segment_id: str) -> dict:
    return _seg_dict(await _get_segment(segment_id))


class LockIn(BaseModel):
    locked: bool = True
    note: str = ""


@router.post("/segments/{segment_id}/lock")
async def lock_segment(segment_id: str, body: LockIn) -> dict:
    """Protect (or release) a clip from retention pruning."""
    async with SessionLocal() as session:
        seg = await session.get(RecordingSegment, segment_id)
        if seg is None:
            raise HTTPException(404, f"segment {segment_id} not found")
        seg.locked = bool(body.locked)
        if body.note:
            seg.note = body.note
        await session.commit()
        await session.refresh(seg)
        return _seg_dict(seg)


@router.delete("/segments/{segment_id}")
async def delete_segment(segment_id: str) -> dict:
    async with SessionLocal() as session:
        seg = await session.get(RecordingSegment, segment_id)
        if seg is None:
            raise HTTPException(404, f"segment {segment_id} not found")
        if seg.locked:
            raise HTTPException(409, "segment is locked — unlock it first")
        from app.services.recorder import _unlink

        _unlink(seg.path)
        _unlink(seg.thumb_path)
        await session.delete(seg)
        await session.commit()
    return {"deleted": segment_id}


# =================================================================== playback
@router.get("/segments/{segment_id}/thumb.jpg")
async def segment_thumb(segment_id: str):
    seg = await _get_segment(segment_id)
    if seg.thumb_path and os.path.exists(seg.thumb_path):
        return FileResponse(seg.thumb_path, media_type="image/jpeg",
                            headers={"Cache-Control": "max-age=86400"})
    return await segment_frame(segment_id, t=0.0)


@router.get("/segments/{segment_id}/frame.jpg")
async def segment_frame(segment_id: str, t: float = 0.0):
    """One decoded frame at `t` seconds — the scrub preview and teach canvas."""
    import anyio
    import cv2

    seg = await _get_segment(segment_id)
    frame = await anyio.to_thread.run_sync(lambda: _frame_at(seg, t))
    ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY),
                                           get_settings().RECORD_JPEG_QUALITY])
    if not ok:
        raise HTTPException(500, "could not encode frame")
    return Response(content=buf.tobytes(), media_type="image/jpeg",
                    headers={"Cache-Control": "no-store"})


def _playback_mjpeg(seg: RecordingSegment, start: float, speed: float,
                    fps: float, loop: bool):
    """Decode a clip and yield it as MJPEG, paced to real time."""
    import time as _t

    import cv2

    cap = _open_clip(seg)
    boundary = b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: "
    quality = [int(cv2.IMWRITE_JPEG_QUALITY), get_settings().RECORD_JPEG_QUALITY]
    src_fps = float(seg.fps or 0) or 8.0
    out_fps = max(1.0, min(30.0, fps))
    # Frames to skip between emitted frames so a 2x request really plays twice
    # as fast instead of just dropping the pacing sleep.
    step = max(1, int(round(src_fps * max(0.1, speed) / out_fps)))
    period = 1.0 / out_fps
    try:
        _seek(cap, seg, start)
        next_at = _t.time()
        while True:
            frame = None
            for _ in range(step):
                ok, f = cap.read()
                if not ok:
                    frame = None
                    break
                frame = f
            if frame is None:
                if loop:
                    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                    continue
                return
            ok, buf = cv2.imencode(".jpg", frame, quality)
            if not ok:
                continue
            data = buf.tobytes()
            yield boundary + str(len(data)).encode() + b"\r\n\r\n" + data + b"\r\n"
            next_at += period
            sleep = next_at - _t.time()
            if sleep > 0:
                _t.sleep(min(sleep, 1.0))
            else:
                next_at = _t.time()      # fell behind; stop accumulating debt
    finally:
        cap.release()


@router.get("/segments/{segment_id}/play.mjpg")
async def play_segment(
    segment_id: str,
    t: float = 0.0,
    speed: float = Query(1.0, ge=0.1, le=8.0),
    fps: float = Query(12.0, ge=1.0, le=30.0),
    loop: bool = False,
):
    """Stream a clip as MJPEG from `t` seconds. Plays in any <img>."""
    seg = await _get_segment(segment_id)
    return StreamingResponse(
        _playback_mjpeg(seg, t, speed, fps, loop),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={"Cache-Control": "no-store"},
    )


@router.get("/segments/{segment_id}/download")
async def download_segment(segment_id: str, request: Request):
    """The original encoded file, with Range support so players can seek."""
    seg = await _get_segment(segment_id)
    if not seg.path or not os.path.exists(seg.path):
        raise HTTPException(410, "recording file is no longer on disk")
    path = Path(seg.path)
    started = _aware(seg.started_at)
    stamp = started.strftime("%Y%m%d-%H%M%S") if started else "clip"
    filename = f"{seg.camera_id}_{stamp}{path.suffix}"
    media = "video/mp4" if path.suffix == ".mp4" else "video/x-msvideo"
    # FileResponse already implements Range for GET; passing the request lets
    # Starlette honour a partial request instead of resending the whole clip.
    return FileResponse(
        str(path), media_type=media, filename=filename,
        headers={"Accept-Ranges": "bytes"},
    )


# ====================================================== teaching over footage
@router.get("/segments/{segment_id}/detect")
async def detect_on_frame(segment_id: str, t: float = 0.0) -> dict:
    """Run the live detector over one recorded frame.

    Returns the same box shape as the live-teach endpoint, so the recorded and
    live teaching UIs are the same component pointed at a different source.
    """
    import anyio

    from app.ml import taxonomy

    seg = await _get_segment(segment_id)
    frame = await anyio.to_thread.run_sync(lambda: _frame_at(seg, t))

    def _infer():
        from app.ml.detector import get_detector

        # track=False: a single seeked frame has no temporal neighbours, and a
        # tracker fed disjoint frames invents ids that mean nothing here.
        return get_detector().infer(frame, track=False)

    fr = await anyio.to_thread.run_sync(_infer)
    inverse = {v: k for k, v in taxonomy.GEAR_PAIRS.items()}
    boxes = []
    for i, d in enumerate(fr.detections):
        cls = d.cls_name
        if cls in taxonomy.GEAR_PAIRS:
            counterpart, kind = taxonomy.GEAR_PAIRS[cls], "gear"
        elif cls in inverse:
            counterpart, kind = inverse[cls], "violation"
        elif cls == "person":
            counterpart, kind = None, "person"
        else:
            counterpart, kind = None, "other"
        boxes.append({
            "i": i, "cls": cls, "conf": round(float(d.confidence), 3),
            "xyxy": [round(float(v), 1) for v in d.xyxy],
            "kind": kind, "label": taxonomy.display_name(cls),
            "counterpart": counterpart,
            "known": cls in taxonomy.CLASS_TO_ID,
        })
    return {
        "segment_id": segment_id, "t": round(float(t), 3),
        "width": int(fr.width), "height": int(fr.height),
        "boxes": boxes,
        "classes": taxonomy.CANONICAL_CLASSES,
        "display_names": taxonomy.DISPLAY_NAMES,
    }


class TeachBoxIn(BaseModel):
    cls: str
    xyxy: list[float] = Field(..., min_length=4, max_length=4)


class TeachFrameIn(BaseModel):
    t: float = 0.0
    boxes: list[TeachBoxIn]
    note: str = ""


@router.post("/segments/{segment_id}/teach")
async def teach_on_frame(segment_id: str, payload: TeachFrameIn) -> dict:
    """Save a corrected recorded frame straight into the training pool.

    `boxes` is the COMPLETE intended label set for the frame, not a patch:
    boxes the operator deleted are simply absent, boxes they drew are present,
    and a flipped class is the same box with the counterpart name. Treating it
    as the whole truth is what makes deletion expressible at all — a patch
    format has no way to say "the model saw a helmet and there isn't one".
    """
    import anyio

    from app.ml import taxonomy
    from app.ml.detector import FrameResult
    from app.services.capture_service import get_capture_service
    from app.services.review_service import get_review_service

    seg = await _get_segment(segment_id)
    boxes = [{"cls": b.cls, "xyxy": [float(v) for v in b.xyxy]}
             for b in payload.boxes if b.cls in taxonomy.CLASS_TO_ID]
    unknown = [b.cls for b in payload.boxes if b.cls not in taxonomy.CLASS_TO_ID]
    if unknown:
        raise HTTPException(422, f"unknown class(es): {', '.join(sorted(set(unknown)))}")
    if not boxes:
        raise HTTPException(422, "no labelable boxes — an empty frame teaches nothing")

    frame = await anyio.to_thread.run_sync(lambda: _frame_at(seg, payload.t))
    h, w = frame.shape[:2]
    fr = FrameResult(width=int(w), height=int(h))
    started = _aware(seg.started_at)
    stamp = started.strftime("%Y-%m-%d %H:%M:%S") if started else "?"
    async with SessionLocal() as session:
        item = await get_capture_service().capture_manual(
            session, seg.camera_id, frame, fr,
            note=payload.note or (f"NVR teach — {stamp} +{payload.t:.1f}s "
                                  f"(segment {segment_id[:8]})"),
        )
        item = await get_review_service().apply_corrections(session, item.id, boxes)
    return {"captured": True, "capture_id": item.id, "labels": len(boxes),
            "status": item.status.value, "segment_id": segment_id,
            "t": round(float(payload.t), 3)}


# =========================================================== storage / config
def _config_payload() -> dict:
    s = get_settings()
    return {
        "record_mode_default": s.RECORD_MODE_DEFAULT,
        "segment_seconds": s.RECORD_SEGMENT_S,
        "pre_roll_s": s.RECORD_PRE_ROLL_S,
        "post_roll_s": s.RECORD_POST_ROLL_S,
        "record_fps": s.RECORD_FPS,
        "max_width": s.RECORD_MAX_WIDTH,
        "retention_days": s.RECORD_RETENTION_DAYS,
        "max_gb": s.RECORD_MAX_GB,
        "overlay": s.RECORD_OVERLAY,
    }


class NvrConfigIn(BaseModel):
    segment_seconds: int | None = Field(None, ge=10, le=3600)
    pre_roll_s: float | None = Field(None, ge=0, le=60)
    post_roll_s: float | None = Field(None, ge=1, le=300)
    record_fps: float | None = Field(None, ge=1, le=30)
    max_width: int | None = Field(None, ge=320, le=3840)
    retention_days: int | None = Field(None, ge=1, le=365)
    max_gb: float | None = Field(None, ge=0.5, le=10000)
    overlay: bool | None = None
    record_mode_default: str | None = Field(None, pattern=r"^(off|events|continuous)$")


_CONFIG_FIELDS = {
    "segment_seconds": "RECORD_SEGMENT_S",
    "pre_roll_s": "RECORD_PRE_ROLL_S",
    "post_roll_s": "RECORD_POST_ROLL_S",
    "record_fps": "RECORD_FPS",
    "max_width": "RECORD_MAX_WIDTH",
    "retention_days": "RECORD_RETENTION_DAYS",
    "max_gb": "RECORD_MAX_GB",
    "overlay": "RECORD_OVERLAY",
    "record_mode_default": "RECORD_MODE_DEFAULT",
}


@router.get("/config")
async def get_config() -> dict:
    return _config_payload()


@router.put("/config")
async def put_config(body: NvrConfigIn) -> dict:
    """Change recording settings live and persist them.

    Applied to the cached Settings instance so running recorders pick the new
    values up on their next segment, and written to the settings table so a
    restart does not silently revert to whatever the environment says.
    """
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    if not patch:
        raise HTTPException(400, "empty update")
    s = get_settings()
    for key, value in patch.items():
        setattr(s, _CONFIG_FIELDS[key], value)
    await _save_setting("nvr.config", patch)
    return _config_payload()


async def _save_setting(key: str, patch: dict) -> None:
    from app.models.domain import Setting

    try:
        async with SessionLocal() as session:
            row = await session.get(Setting, key)
            merged = dict((row.value if row else None) or {})
            merged.update(patch)
            if row is None:
                session.add(Setting(key=key, value=merged))
            else:
                row.value = merged
            await session.commit()
    except Exception as exc:  # noqa: BLE001 - a lost preference is not fatal
        log.warning("could not persist %s: %s", key, exc)


async def load_config() -> dict:
    """Apply persisted NVR settings at startup. Called from the lifespan."""
    from app.models.domain import Setting

    try:
        async with SessionLocal() as session:
            row = await session.get(Setting, "nvr.config")
        stored = dict((row.value if row else None) or {})
    except Exception as exc:  # noqa: BLE001
        log.warning("could not load nvr config: %s", exc)
        return {}
    s = get_settings()
    for key, value in stored.items():
        if key in _CONFIG_FIELDS and value is not None:
            setattr(s, _CONFIG_FIELDS[key], value)
    return stored


async def _save_camera_record_mode(camera_id: str, mode: str) -> None:
    """Remember a camera's record mode so a restart re-arms it."""
    await _save_setting("nvr.camera_modes", {camera_id: mode})


async def restore_camera_modes() -> dict:
    """Re-arm recorders for every camera that was recording before the restart.

    Without this, a power cut silently disarms the whole site: cameras come
    back and stream, the dashboard looks healthy, and nothing is being recorded
    until somebody notices weeks later that there is no footage.
    """
    from app.models.domain import Setting

    try:
        async with SessionLocal() as session:
            row = await session.get(Setting, "nvr.camera_modes")
        modes = dict((row.value if row else None) or {})
    except Exception as exc:  # noqa: BLE001
        log.warning("could not load camera record modes: %s", exc)
        return {}
    rec = get_recorder()
    applied = {}
    for camera_id, mode in modes.items():
        if mode in RECORD_MODES and mode != "off":
            try:
                applied[camera_id] = rec.set_mode(camera_id, mode)
            except Exception as exc:  # noqa: BLE001
                log.warning("could not re-arm recorder for %s: %s", camera_id, exc)
    if applied:
        log.info("re-armed recording on %d camera(s)", len(applied))
    return applied


@router.get("/storage")
async def storage() -> dict:
    """Per-camera storage breakdown — who is actually eating the disk."""
    s = get_settings()
    async with SessionLocal() as session:
        rows = list((await session.execute(
            select(RecordingSegment.camera_id,
                   func.count().label("segments"),
                   func.coalesce(func.sum(RecordingSegment.size_bytes), 0).label("bytes"),
                   func.coalesce(func.sum(RecordingSegment.duration_s), 0).label("seconds"),
                   func.min(RecordingSegment.started_at).label("oldest"),
                   func.max(RecordingSegment.started_at).label("newest"))
            .group_by(RecordingSegment.camera_id))).all())
    cameras = [{
        "camera_id": r.camera_id,
        "segments": int(r.segments),
        "bytes": int(r.bytes),
        "gb": round(int(r.bytes) / 1024 ** 3, 3),
        "hours": round(float(r.seconds) / 3600, 2),
        "oldest": (_aware(r.oldest).isoformat() if r.oldest else None),
        "newest": (_aware(r.newest).isoformat() if r.newest else None),
    } for r in rows]
    cameras.sort(key=lambda c: c["bytes"], reverse=True)
    used = sum(c["bytes"] for c in cameras)
    budget = max(0.1, s.RECORD_MAX_GB) * 1024 ** 3
    free_disk = None
    try:
        import shutil

        free_disk = shutil.disk_usage(str(s.RECORDINGS_DIR)).free
    except Exception:
        pass
    return {
        "cameras": cameras,
        "used_bytes": used,
        "used_gb": round(used / 1024 ** 3, 3),
        "max_gb": s.RECORD_MAX_GB,
        "used_pct": round(min(100.0, used / budget * 100), 1),
        "retention_days": s.RECORD_RETENTION_DAYS,
        "disk_free_gb": round(free_disk / 1024 ** 3, 2) if free_disk else None,
        "path": str(s.RECORDINGS_DIR),
    }


@router.post("/prune")
async def prune_now(dry_run: bool = False) -> dict:
    """Run retention immediately. `dry_run` reports without deleting."""
    from app.services.recorder import prune

    return await prune(dry_run=dry_run)


# ================================================================ NVR devices
class NvrScanIn(BaseModel):
    brand: str = "hikvision"
    host: str
    username: str = ""
    password: str = ""
    port: int | None = None
    channels: int = Field(8, ge=1, le=64)
    stream: str = Field("sub", pattern=r"^(main|sub)$")
    path: str = ""
    timeout: float = Field(6.0, ge=2.0, le=20.0)


@router.post("/devices/scan")
async def scan_device(body: NvrScanIn) -> dict:
    """Probe every channel of one NVR/DVR and report which carry video."""
    import anyio

    from app.services import nvr_devices

    return await anyio.to_thread.run_sync(lambda: nvr_devices.scan(
        brand=body.brand, host=body.host, username=body.username,
        password=body.password, port=body.port, channels=body.channels,
        stream=body.stream, path=body.path, timeout=body.timeout,
    ))


class NvrImportChannel(BaseModel):
    channel: int = Field(..., ge=1, le=64)
    url: str = ""
    camera_id: str = ""
    name: str = ""


class NvrImportIn(BaseModel):
    device_id: str = Field("nvr", pattern=r"^[A-Za-z0-9._-]+$")
    brand: str = "hikvision"
    host: str
    username: str = ""
    password: str = ""
    port: int | None = None
    stream: str = Field("sub", pattern=r"^(main|sub)$")
    path: str = ""
    channels: list[NvrImportChannel]
    required_ppe: list[str] = Field(default_factory=lambda: ["helmet", "vest"])
    fps_limit: float = Field(4.0, ge=0.5, le=30)
    transport: str = Field("tcp", pattern=r"^(tcp|udp|)$")
    record_mode: str = Field("events", pattern=r"^(off|events|continuous)$")
    autostart: bool = True


@router.post("/devices/import")
async def import_device(body: NvrImportIn) -> dict:
    """Register the chosen channels of an NVR as cameras, in one call.

    Partial success is the norm and is reported as such: one channel whose id
    collides with an existing camera must not stop the other fifteen being
    added, and the operator needs to know exactly which ones landed.
    """
    from app.services import nvr_devices
    from app.services.camera_manager import CameraConfig
    from app.services.runtime import get_manager

    if not body.channels:
        raise HTTPException(422, "no channels selected")
    planned = nvr_devices.plan(
        device_id=body.device_id, brand=body.brand, host=body.host,
        channels=[c.model_dump() for c in body.channels],
        username=body.username, password=body.password, port=body.port,
        stream=body.stream, path=body.path, required_ppe=body.required_ppe,
        fps_limit=body.fps_limit, transport=body.transport,
    )
    manager = get_manager()
    rec = get_recorder()
    added, failed = [], []
    for spec in planned:
        cid = spec["camera_id"]
        if not re.match(r"^[A-Za-z0-9._-]+$", cid):
            failed.append({"camera_id": cid, "error": "invalid camera id"})
            continue
        try:
            manager.add(CameraConfig(
                camera_id=cid,
                source_kind=spec["source_kind"],
                source_kwargs=spec["source_kwargs"],
                required_ppe=set(spec["required_ppe"]),
                fps_limit=spec["fps_limit"],
            ))
        except ValueError as e:
            failed.append({"camera_id": cid, "error": str(e)})
            continue
        try:
            if body.autostart:
                manager.start(cid)
            if body.record_mode != "off":
                rec.set_mode(cid, body.record_mode)
                await _save_camera_record_mode(cid, body.record_mode)
        except Exception as e:  # noqa: BLE001 - added is added; report the rest
            failed.append({"camera_id": cid, "error": f"added but: {e}"})
        added.append(cid)

    return {
        "device_id": body.device_id,
        "added": added,
        "failed": failed,
        "count": len(added),
        "record_mode": body.record_mode,
        "cameras": [manager.status(c) for c in added if c],
    }
