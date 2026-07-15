"""Seed one realistic review item so the dashboard is useful immediately."""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from PIL import Image, ImageDraw
from sqlalchemy import func, select

from app.core.config import get_settings
from app.core.db import SessionLocal, init_db
from app.models.review import CaptureItem, CaptureReason, CaptureStatus


def create_frame(path: Path) -> None:
    image = Image.new("RGB", (640, 480), "#10151f")
    draw = ImageDraw.Draw(image)
    for x in range(0, 640, 32):
        draw.line((x, 0, x, 480), fill="#172131")
    for y in range(0, 480, 32):
        draw.line((0, y, 640, y), fill="#172131")
    draw.ellipse((232, 76, 322, 168), fill="#445166")
    draw.rounded_rectangle((180, 145, 380, 456), radius=24, fill="#2a3646")
    draw.rectangle((205, 220, 360, 360), fill="#64748b")
    draw.text((12, 452), "CAM GATE-3  |  DEMO REVIEW FRAME", fill="#94a3b8")
    image.save(path, "JPEG", quality=90)


async def seed() -> None:
    await init_db()
    settings = get_settings()
    camera_dir = settings.CAPTURES_DIR / "cam-gate-3"
    camera_dir.mkdir(parents=True, exist_ok=True)

    async with SessionLocal() as session:
        pending = await session.scalar(
            select(func.count()).select_from(CaptureItem).where(
                CaptureItem.status == CaptureStatus.pending
            )
        )
        if pending:
            print(f"review queue already contains {pending} pending capture(s)")
            return

        image_path = camera_dir / "project-brain-demo.jpg"
        create_frame(image_path)
        item = CaptureItem(
            camera_id="cam-gate-3",
            image_path=str(image_path),
            reason=CaptureReason.violation,
            status=CaptureStatus.pending,
            predictions=[
                {
                    "cls": "person",
                    "raw": "person",
                    "conf": 0.92,
                    "xyxy": [180, 76, 380, 456],
                    "track_id": 7,
                },
                {
                    "cls": "no_helmet",
                    "raw": "no-hardhat",
                    "conf": 0.44,
                    "xyxy": [232, 76, 322, 168],
                    "track_id": None,
                },
                {
                    "cls": "vest",
                    "raw": "safety-vest",
                    "conf": 0.81,
                    "xyxy": [205, 220, 360, 360],
                    "track_id": None,
                },
            ],
            width=640,
            height=480,
            note="missing helmet (track 7) — demo capture",
        )
        session.add(item)
        await session.commit()
        print(f"seeded demo capture {item.id}")


if __name__ == "__main__":
    asyncio.run(seed())
