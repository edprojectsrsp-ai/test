"""
Persistence service -- writes durable operational records.

Separate from CaptureService (which owns the active-learning image queue) so the
two concerns don't entangle: capture is about *training data*, persistence is
about *operational analytics* (violations, alerts, incidents, audit). Both can
be triggered from one fired violation, but they answer different questions.

All writes are best-effort and self-contained: a failure here must never break
the inference loop, so callers wrap these in try/except and continue.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.domain import (
    Alert,
    AlertStatus,
    AuditLog,
    CameraRecord,
    ViolationEvent,
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


class PersistenceService:
    async def record_violation(
        self,
        session: AsyncSession,
        *,
        camera_id: str,
        rule_type: str,
        gear: str,
        track_id: int | None,
        confidence: float,
        person_box: list | tuple | None,
        capture_id: str | None = None,
        image_path: str = "",
        department: str = "",
        shift: str = "",
    ) -> ViolationEvent:
        ev = ViolationEvent(
            camera_id=camera_id,
            rule_type=rule_type,
            gear=gear,
            track_id=track_id,
            confidence=float(confidence or 0.0),
            person_box=list(person_box) if person_box else [],
            capture_id=capture_id,
            image_path=image_path,
            department=department,
            shift=shift,
        )
        session.add(ev)
        await session.commit()
        await session.refresh(ev)
        return ev

    async def record_alert(
        self,
        session: AsyncSession,
        *,
        camera_id: str,
        channel: str,
        gear: str,
        dedup_key: str,
        status: AlertStatus,
        detail: str = "",
        violation_id: str | None = None,
    ) -> Alert:
        a = Alert(
            camera_id=camera_id,
            violation_id=violation_id,
            channel=channel,
            gear=gear,
            dedup_key=dedup_key,
            status=status,
            detail=detail,
        )
        session.add(a)
        await session.commit()
        await session.refresh(a)
        return a

    async def audit(
        self,
        session: AsyncSession,
        *,
        action: str,
        actor: str = "system",
        target: str = "",
        meta: dict | None = None,
    ) -> AuditLog:
        log = AuditLog(actor=actor, action=action, target=target, meta=meta or {})
        session.add(log)
        await session.commit()
        return log

    # -- camera health --------------------------------------------------------
    async def upsert_camera(
        self, session: AsyncSession, camera_id: str, **fields
    ) -> CameraRecord:
        row = await session.get(CameraRecord, camera_id)
        if row is None:
            row = CameraRecord(id=camera_id)
            session.add(row)
        for k, v in fields.items():
            if hasattr(row, k) and v is not None:
                setattr(row, k, v)
        await session.commit()
        await session.refresh(row)
        return row

    async def touch_camera_health(
        self, session: AsyncSession, camera_id: str, state: str, error: str = ""
    ) -> None:
        row = await session.get(CameraRecord, camera_id)
        if row is None:
            return
        row.last_seen_at = _now()
        row.last_state = state
        if error:
            row.last_error = error
        await session.commit()

    async def all_cameras(self, session: AsyncSession) -> list[CameraRecord]:
        res = await session.execute(select(CameraRecord).where(CameraRecord.enabled))
        return list(res.scalars().all())


_service: PersistenceService | None = None


def get_persistence_service() -> PersistenceService:
    global _service
    if _service is None:
        _service = PersistenceService()
    return _service
