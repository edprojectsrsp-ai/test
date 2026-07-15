"""
Review + capture HTTP API. This is what the Next.js dashboard calls.

Endpoints:
  GET    /api/review/classes              -> label taxonomy for the labeler UI
  GET    /api/review/pending              -> queue of frames awaiting review
  GET    /api/review/captures/{id}        -> one capture with labels + overlays
  POST   /api/review/captures/{id}/labels -> submit human corrections
  POST   /api/review/captures/{id}/ignore -> drop from training path
  POST   /api/review/export               -> bake labeled captures into a dataset
  GET    /api/review/image/{id}           -> the captured frame (jpg)
  DELETE /api/review/captures             -> wipe stored photos (rows + files)
"""
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy import delete as sa_delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.db import get_session
from app.models.review import CaptureItem, ReviewLabel
from app.schemas.review import (
    CaptureDetailOut,
    CaptureOut,
    ClassesOut,
    CorrectionIn,
    ExportIn,
    ExportOut,
    LabelOut,
    classes_payload,
)
from app.services.review_service import get_review_service

router = APIRouter(prefix="/api/review", tags=["review"])


def _to_out(item: CaptureItem) -> CaptureOut:
    return CaptureOut(
        id=item.id,
        camera_id=item.camera_id,
        reason=item.reason.value,
        status=item.status.value,
        image_url=f"/api/review/image/{item.id}",
        predictions=item.predictions or [],
        width=item.width,
        height=item.height,
        note=item.note,
        created_at=item.created_at,
        reviewed_at=item.reviewed_at,
    )


@router.get("/classes", response_model=ClassesOut)
async def get_classes() -> ClassesOut:
    return classes_payload()


@router.get("/pending", response_model=list[CaptureOut])
async def list_pending(
    limit: int = 50, session: AsyncSession = Depends(get_session)
) -> list[CaptureOut]:
    items = await get_review_service().list_pending(session, limit=limit)
    return [_to_out(i) for i in items]


@router.get("/captures/{capture_id}", response_model=CaptureDetailOut)
async def get_capture(
    capture_id: str, session: AsyncSession = Depends(get_session)
) -> CaptureDetailOut:
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload

    res = await session.execute(
        select(CaptureItem)
        .where(CaptureItem.id == capture_id)
        .options(selectinload(CaptureItem.labels))
    )
    item = res.scalar_one_or_none()
    if item is None:
        raise HTTPException(status_code=404, detail="capture not found")
    base = _to_out(item)
    return CaptureDetailOut(
        **base.model_dump(),
        labels=[
            LabelOut(cls_name=l.cls_name, cx=l.cx, cy=l.cy, w=l.w, h=l.h)
            for l in item.labels
        ],
    )


@router.post("/captures/{capture_id}/labels", response_model=CaptureDetailOut)
async def submit_labels(
    capture_id: str,
    payload: CorrectionIn,
    session: AsyncSession = Depends(get_session),
) -> CaptureDetailOut:
    try:
        item = await get_review_service().apply_corrections(
            session, capture_id, [b.model_dump() for b in payload.boxes]
        )
    except ValueError as e:
        # unknown class or missing capture -> 400 with the reason
        raise HTTPException(status_code=400, detail=str(e))
    base = _to_out(item)
    return CaptureDetailOut(
        **base.model_dump(),
        labels=[
            LabelOut(cls_name=l.cls_name, cx=l.cx, cy=l.cy, w=l.w, h=l.h)
            for l in item.labels
        ],
    )


@router.post("/captures/{capture_id}/ignore", response_model=CaptureOut)
async def ignore_capture(
    capture_id: str, session: AsyncSession = Depends(get_session)
) -> CaptureOut:
    try:
        item = await get_review_service().ignore(session, capture_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return _to_out(item)


@router.post("/export", response_model=ExportOut)
async def export_dataset(
    payload: ExportIn, session: AsyncSession = Depends(get_session)
) -> ExportOut:
    manifest = await get_review_service().export_yolo(session, payload.version)
    return ExportOut(**manifest)


@router.get("/image/{capture_id}")
async def get_image(
    capture_id: str, session: AsyncSession = Depends(get_session)
):
    item = await session.get(CaptureItem, capture_id)
    if item is None:
        raise HTTPException(status_code=404, detail="capture not found")
    path = Path(item.image_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="image file missing")
    return FileResponse(str(path), media_type="image/jpeg")


@router.delete("/captures")
async def clear_stored_photos(
    include_violations: bool = True,
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Free disk: delete every stored capture (review queue) + its labels, and
    remove the image files under the captures directory. Also clears the alert
    log by default (its evidence photos are being deleted). Model weights,
    datasets and settings are untouched."""
    n_labels = await session.scalar(select(func.count()).select_from(ReviewLabel)) or 0
    n_caps = await session.scalar(select(func.count()).select_from(CaptureItem)) or 0
    await session.execute(sa_delete(ReviewLabel))
    await session.execute(sa_delete(CaptureItem))

    n_viol = 0
    if include_violations:
        from app.models.domain import ViolationEvent
        n_viol = await session.scalar(select(func.count()).select_from(ViolationEvent)) or 0
        await session.execute(sa_delete(ViolationEvent))
    await session.commit()

    # remove image files on disk
    import shutil
    captures_dir = get_settings().CAPTURES_DIR
    files_removed = 0
    bytes_freed = 0
    if captures_dir.exists():
        for f in captures_dir.rglob("*"):
            if f.is_file():
                try:
                    bytes_freed += f.stat().st_size
                    f.unlink()
                    files_removed += 1
                except Exception:
                    pass
        for d in sorted([p for p in captures_dir.rglob("*") if p.is_dir()], reverse=True):
            try:
                d.rmdir()
            except Exception:
                pass

    return {
        "captures_deleted": int(n_caps),
        "labels_deleted": int(n_labels),
        "violations_deleted": int(n_viol),
        "files_removed": files_removed,
        "mb_freed": round(bytes_freed / (1024 * 1024), 1),
    }

