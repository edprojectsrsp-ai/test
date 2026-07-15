"""
Review service -- the human-in-the-loop half of active learning.

Frontend flow this backs:
  1. GET pending captures  -> operator sees frame + editable prediction boxes
  2. For each box the human can: keep it, fix its class, move/resize it,
     delete a wrong box, or draw a new one.
  3. Submit -> we replace that capture's labels with the corrected set and
     mark it 'labeled'. Or the human hits "ignore" and it never trains.
  4. Periodically, export all 'labeled' captures to YOLO format -> a dataset
     version the training CLI consumes.

Coordinates: the frontend works in pixel xyxy (what it drew on the image);
we store normalized YOLO xywh so export is trivial and resolution-independent.
"""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import get_settings
from app.ml import taxonomy
from app.models.review import (
    CaptureItem,
    CaptureStatus,
    ReviewLabel,
)


def xyxy_to_yolo(x1, y1, x2, y2, w, h):
    """Pixel corner box -> normalized (cx, cy, bw, bh), clamped to [0,1]."""
    cx = ((x1 + x2) / 2) / w
    cy = ((y1 + y2) / 2) / h
    bw = abs(x2 - x1) / w
    bh = abs(y2 - y1) / h
    clamp = lambda v: max(0.0, min(1.0, v))
    return clamp(cx), clamp(cy), clamp(bw), clamp(bh)


class ReviewService:
    def __init__(self) -> None:
        self.settings = get_settings()

    async def get_capture(self, session: AsyncSession, capture_id: str) -> CaptureItem | None:
        return await session.get(CaptureItem, capture_id)

    async def apply_corrections(
        self,
        session: AsyncSession,
        capture_id: str,
        boxes: list[dict],
    ) -> CaptureItem:
        """
        Replace a capture's labels with the human-corrected set.
        `boxes` items: {cls: str, xyxy: [x1,y1,x2,y2]} in PIXEL coords.
        Unknown classes are rejected loudly so bad labels never poison training.
        """
        item = await session.get(
            CaptureItem, capture_id,
            options=[selectinload(CaptureItem.labels)],
        )
        if item is None:
            raise ValueError(f"capture {capture_id} not found")

        # validate all classes up front
        for b in boxes:
            if b["cls"] not in taxonomy.CLASS_TO_ID:
                raise ValueError(f"unknown class '{b['cls']}'")

        item_id = item.id
        w = item.width or 1
        h = item.height or 1

        # wipe old labels for this capture (bulk delete: async-safe, no lazy load)
        await session.execute(
            delete(ReviewLabel).where(ReviewLabel.capture_id == item_id)
        )

        for b in boxes:
            x1, y1, x2, y2 = b["xyxy"]
            cx, cy, bw, bh = xyxy_to_yolo(x1, y1, x2, y2, w, h)
            session.add(
                ReviewLabel(
                    capture_id=item_id, cls_name=b["cls"],
                    cx=cx, cy=cy, w=bw, h=bh,
                )
            )

        item.status = CaptureStatus.labeled
        item.reviewed_at = datetime.now(timezone.utc)
        await session.commit()

        # fresh query so labels come back eagerly loaded and consistent.
        # populate_existing forces the already-cached CaptureItem's labels
        # collection to refresh instead of keeping its stale empty state.
        res = await session.execute(
            select(CaptureItem)
            .where(CaptureItem.id == item_id)
            .options(selectinload(CaptureItem.labels))
            .execution_options(populate_existing=True)
        )
        return res.scalar_one()

    async def ignore(self, session: AsyncSession, capture_id: str) -> CaptureItem:
        item = await session.get(CaptureItem, capture_id)
        if item is None:
            raise ValueError(f"capture {capture_id} not found")
        item.status = CaptureStatus.ignored
        item.reviewed_at = datetime.now(timezone.utc)
        await session.commit()
        await session.refresh(item)
        return item

    async def list_pending(self, session: AsyncSession, limit: int = 50) -> list[CaptureItem]:
        res = await session.execute(
            select(CaptureItem)
            .where(CaptureItem.status == CaptureStatus.pending)
            .order_by(CaptureItem.created_at.desc())
            .limit(limit)
        )
        return list(res.scalars().all())

    async def export_yolo(self, session: AsyncSession, version: str) -> dict:
        """
        Bake all 'labeled' captures into a YOLO dataset version on disk and
        flip them to 'exported'. Returns a manifest the training CLI reads.

        Layout:
            data/datasets/<version>/
                images/*.jpg
                labels/*.txt      (YOLO: "<cls_id> cx cy w h" per line)
                data.yaml
        """
        res = await session.execute(
            select(CaptureItem)
            .where(CaptureItem.status == CaptureStatus.labeled)
            .options(selectinload(CaptureItem.labels))
        )
        items = list(res.scalars().all())

        ds_dir = self.settings.DATASETS_DIR / version
        img_dir = ds_dir / "images"
        lbl_dir = ds_dir / "labels"
        img_dir.mkdir(parents=True, exist_ok=True)
        lbl_dir.mkdir(parents=True, exist_ok=True)

        import shutil

        exported = 0
        for item in items:
            src = Path(item.image_path)
            if not src.exists():
                continue
            stem = Path(item.image_path).stem
            shutil.copy2(src, img_dir / f"{stem}.jpg")
            lines = [
                f"{taxonomy.CLASS_TO_ID[l.cls_name]} {l.cx:.6f} {l.cy:.6f} {l.w:.6f} {l.h:.6f}"
                for l in item.labels
            ]
            (lbl_dir / f"{stem}.txt").write_text("\n".join(lines))
            item.status = CaptureStatus.exported
            exported += 1

        # data.yaml maps class ids -> names for the trainer
        names_block = "\n".join(
            f"  {i}: {n}" for i, n in enumerate(taxonomy.CANONICAL_CLASSES)
        )
        (ds_dir / "data.yaml").write_text(
            f"path: {ds_dir}\ntrain: images\nval: images\n"
            f"nc: {len(taxonomy.CANONICAL_CLASSES)}\nnames:\n{names_block}\n"
        )
        await session.commit()
        return {
            "version": version,
            "exported_items": exported,
            "dataset_dir": str(ds_dir),
            "data_yaml": str(ds_dir / "data.yaml"),
        }


_service: ReviewService | None = None


def get_review_service() -> ReviewService:
    global _service
    if _service is None:
        _service = ReviewService()
    return _service

