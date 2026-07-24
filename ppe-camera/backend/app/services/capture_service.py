"""
Capture service -- the entry point of the active-learning loop.

When a violation fires (or a frame is uncertain, or a human flags it), this
saves the frame image to disk and writes a CaptureItem row with the model's
own predictions attached as editable overlays.

Cooldown: we don't want 30 near-identical captures of one person standing
without a helmet for 5 seconds. Per (camera, track_id, gear) we throttle to
one capture per CAPTURE_COOLDOWN_S. A distinct person or a distinct missing
item is a distinct event and captures immediately.
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.ml.detector import FrameResult
from app.ml.violations import FiredViolation
from app.models.review import CaptureItem, CaptureReason, CaptureStatus


@dataclass
class _CooldownKey:
    camera_id: str
    person: str          # resolved identity: tracked id, else spatial identity
    gear: str

    def as_tuple(self):
        return (self.camera_id, self.person, self.gear)


class CaptureService:
    def __init__(self) -> None:
        self.settings = get_settings()
        self._last: dict[tuple, float] = {}

    def _throttled(self, key: _CooldownKey, now: float, window: float | None = None) -> bool:
        window = self.settings.CAPTURE_COOLDOWN_S if window is None else window
        last = self._last.get(key.as_tuple())
        if last is not None and now - last < window:
            return True
        self._last[key.as_tuple()] = now
        return False

    def _predictions_payload(self, fr: FrameResult) -> list[dict]:
        return [
            {
                "cls": d.cls_name,
                "raw": d.raw_name,
                "conf": round(d.confidence, 4),
                "xyxy": [round(v, 1) for v in d.xyxy],
                "track_id": d.track_id,
            }
            for d in fr.detections
        ]

    def _write_image(self, camera_id: str, frame) -> Path:
        """Persist the BGR frame to disk. Returns the path."""
        import cv2  # lazy: only needed when actually capturing

        ts = int(time.time() * 1000)
        cam_dir = self.settings.CAPTURES_DIR / camera_id
        cam_dir.mkdir(parents=True, exist_ok=True)
        path = cam_dir / f"{ts}.jpg"
        cv2.imwrite(str(path), frame)
        return path

    async def capture_violation(
        self,
        session: AsyncSession,
        camera_id: str,
        frame,
        frame_result: FrameResult,
        fired: FiredViolation,
    ) -> CaptureItem | None:
        """Save one fired violation. Deduped per (camera, person, violation) over
        VIOLATION_COOLDOWN_S so the same person + same gear doesn't spam photos.
        Goes into the TRAINING queue (status=pending) only when the model was
        unsure (confidence < TRAINING_CONF_MAX); confident detections are still
        saved as evidence but marked so they don't clutter the labeler."""
        now = time.time()
        # Identity, not raw track_id: when the tracker yields no id the engine
        # assigns a spatial identity, and keying on a shared None would put
        # every untracked worker on one cooldown and drop their evidence photos.
        person = fired.identity or (
            f"t{fired.track_id}" if fired.track_id is not None else "unknown")
        key = _CooldownKey(camera_id, person, fired.gear)
        if self._throttled(key, now, window=self.settings.VIOLATION_COOLDOWN_S):
            return None

        # Active learning: only uncertain detections need a human label.
        needs_training = (fired.confidence or 0.0) < self.settings.TRAINING_CONF_MAX
        status = CaptureStatus.pending if needs_training else CaptureStatus.ignored

        path = self._write_image(camera_id, frame)
        item = CaptureItem(
            camera_id=camera_id,
            image_path=str(path),
            reason=CaptureReason.violation,
            status=status,
            predictions=self._predictions_payload(frame_result),
            width=frame_result.width,
            height=frame_result.height,
            note=f"missing {fired.gear}"
            + (f" (track {fired.track_id})" if fired.track_id is not None else "")
            + (f" · conf {fired.confidence:.0%}" if fired.confidence else ""),
        )
        session.add(item)
        await session.commit()
        await session.refresh(item)
        return item

    async def capture_uncertain(
        self, session: AsyncSession, camera_id: str, frame, frame_result: FrameResult,
    ) -> CaptureItem | None:
        """Active-learning harvest: the model was UNSURE about this frame.
        Cooldown keyed per camera (the sampler already dedupes/budgets)."""
        now = time.time()
        if self._throttled(_CooldownKey(camera_id, None, "__uncertain__"), now):
            return None
        path = self._write_image(camera_id, frame)
        item = CaptureItem(
            camera_id=camera_id,
            image_path=str(path),
            reason=CaptureReason.uncertain,
            status=CaptureStatus.pending,
            predictions=self._predictions_payload(frame_result),
            width=frame_result.width,
            height=frame_result.height,
            note="uncertainty harvest (collect mode)",
        )
        session.add(item)
        await session.commit()
        await session.refresh(item)
        return item

    async def capture_manual(
        self, session: AsyncSession, camera_id: str, frame, frame_result: FrameResult,
        note: str = "",
    ) -> CaptureItem:
        """A human flagged this frame from the live view -- always captures."""
        path = self._write_image(camera_id, frame)
        item = CaptureItem(
            camera_id=camera_id,
            image_path=str(path),
            reason=CaptureReason.manual,
            status=CaptureStatus.pending,
            predictions=self._predictions_payload(frame_result),
            width=frame_result.width,
            height=frame_result.height,
            note=note or "manual flag",
        )
        session.add(item)
        await session.commit()
        await session.refresh(item)
        return item


_service: CaptureService | None = None


def get_capture_service() -> CaptureService:
    global _service
    if _service is None:
        _service = CaptureService()
    return _service

