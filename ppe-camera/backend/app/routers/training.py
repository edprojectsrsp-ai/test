"""
Training API -- the "Train now" button behind Review & Teach.

  GET  /api/training/status     current/last job + how much labeled data exists
  POST /api/training/start      export -> fine-tune -> evaluate -> activate
  POST /api/training/cancel     stop at the next epoch boundary

A successful run ends with the new checkpoint copied over ppe_active.pt and the
shared detector hot-reloaded, so live cameras switch to it on their next frame.
No restart, no manual file copy, no CLI.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.models.review import CaptureItem, CaptureStatus, ReviewLabel
from app.services.training_service import get_training_service

router = APIRouter(prefix="/api/training", tags=["training"])


class TrainIn(BaseModel):
    epochs: int = Field(40, ge=1, le=500)
    imgsz: int = Field(640, ge=160, le=1536)
    # Empty = fine-tune from whatever is live, which is almost always right.
    base: str = ""
    dataset_version: str = Field("", pattern=r"^[A-Za-z0-9._-]*$")
    # Refuse to go live with a checkpoint that scores worse than the model
    # currently running. Turn off only for a deliberate experiment.
    promote_only_if_better: bool = True
    auto_activate: bool = True
    note: str = ""


@router.get("/status")
async def status(session: AsyncSession = Depends(get_session)) -> dict:
    """Job state plus the data situation, so the UI can explain what's missing."""
    counts: dict[str, int] = {}
    for st in CaptureStatus:
        counts[st.value] = int(await session.scalar(
            select(func.count()).select_from(CaptureItem)
            .where(CaptureItem.status == st)) or 0)
    boxes = int(await session.scalar(
        select(func.count()).select_from(ReviewLabel)) or 0)

    out = get_training_service().status()
    ready = counts.get("labeled", 0) + counts.get("exported", 0)
    out["data"] = {
        "captures_by_status": counts,
        "labeled_boxes": boxes,
        "trainable_images": ready,
        "ready": ready >= 8,
        "hint": ("Label frames in Review & Teach — 8 minimum, 30+ for a model "
                 "worth activating." if ready < 8 else
                 f"{ready} labeled frame(s) ready to train on."),
    }
    return out


@router.post("/start")
async def start(payload: TrainIn) -> dict:
    try:
        return get_training_service().start(
            epochs=payload.epochs, imgsz=payload.imgsz, base=payload.base,
            dataset_version=payload.dataset_version,
            promote_only_if_better=payload.promote_only_if_better,
            auto_activate=payload.auto_activate, note=payload.note)
    except RuntimeError as e:
        raise HTTPException(409, str(e))


@router.post("/cancel")
async def cancel() -> dict:
    return {"cancelling": get_training_service().cancel()}
