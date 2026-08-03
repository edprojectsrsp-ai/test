"""
Cloud push control (edge role only) -- the "send to cloud" button and its state.

  GET  /api/sync/status    is sync configured, is auto on, when did it last run
  GET  /api/sync/pending   how many violations are queued (+ a preview list)
  POST /api/sync/push      send them now; accepts filters so the operator
                           chooses what leaves the plant
  POST /api/sync/auto      turn the 4-hourly timer on/off for this process

Auto-sync is off unless PPE_AUTO_SYNC says otherwise, so the normal flow is
that a human looks at the queue and presses the button. /api/sync/auto toggles
the running timer only — it does not rewrite .env, so a restart returns to
whatever the installed configuration says. That asymmetry is intentional: a
temporary "yes, sync tonight" should not silently become permanent.
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from app.core.db import SessionLocal
from app.services import push_service

router = APIRouter(prefix="/api/sync", tags=["sync"])


def _parse_dt(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        d = datetime.fromisoformat(s)
    except ValueError:
        raise HTTPException(422, f"invalid datetime '{s}' (expected ISO-8601)")
    return d.replace(tzinfo=timezone.utc) if d.tzinfo is None else d


@router.get("/status")
async def sync_status() -> dict:
    out = push_service.status()
    async with SessionLocal() as session:
        out["pending"] = await push_service.pending_count(session)
    return out


@router.get("/pending")
async def sync_pending(
    camera_id: str | None = None,
    rule_type: str | None = None,
    since: str | None = None,
    until: str | None = None,
    preview: int = 20,
) -> dict:
    """Count + a small preview, so the operator can see what they are about to
    send before they send it rather than after."""
    from app.models.domain import ViolationEvent

    filters = {
        "camera_id": camera_id,
        "rule_type": rule_type,
        "since": _parse_dt(since),
        "until": _parse_dt(until),
    }
    async with SessionLocal() as session:
        count = await push_service.pending_count(session, **filters)
        stmt = await push_service.pending_query(session, **filters)
        rows = (await session.execute(
            stmt.limit(max(0, min(preview, 200))))).scalars().all()
        items = [
            {
                "id": ev.id,
                "camera_id": ev.camera_id,
                "rule_type": ev.rule_type,
                "gear": ev.gear,
                "confidence": ev.confidence,
                "occurred_at": ev.occurred_at.isoformat() if ev.occurred_at else None,
            }
            for ev in rows
        ]
    return {"pending": count, "preview": items}


class PushIn(BaseModel):
    camera_id: str | None = None
    rule_type: str | None = None
    since: str | None = None
    until: str | None = None
    # A ceiling on one press. Useful on a metered or slow plant uplink, where
    # sending four hours of backlog in one go is not what the operator wants.
    limit: int | None = None
    dry_run: bool = False


@router.post("/push")
async def sync_push(payload: PushIn | None = None) -> dict:
    p = payload or PushIn()
    return await push_service.push_now(
        limit=p.limit,
        dry_run=p.dry_run,
        camera_id=p.camera_id,
        rule_type=p.rule_type,
        since=_parse_dt(p.since),
        until=_parse_dt(p.until),
    )


class AutoIn(BaseModel):
    enabled: bool


@router.post("/auto")
async def sync_auto(payload: AutoIn) -> dict:
    """Toggle the timer for this process only (see the module docstring)."""
    if payload.enabled:
        from app.core.config import get_settings

        s = get_settings()
        if not s.SYNC_URL:
            raise HTTPException(422, "sync is not configured; set PPE_SYNC_URL")
        # get_settings is lru_cached, so flipping the attribute is what makes
        # start_auto_sync agree to run without a restart.
        s.AUTO_SYNC = True
        started = push_service.start_auto_sync()
        return {"auto_sync": started, "interval_s": s.SYNC_INTERVAL_S}

    from app.core.config import get_settings

    get_settings().AUTO_SYNC = False
    push_service.stop_auto_sync()
    return {"auto_sync": False}


@router.get("/history")
async def sync_history(limit: int = 50) -> dict:
    """Recently pushed violations -- the audit trail of what left the plant."""
    from app.models.domain import ViolationEvent

    async with SessionLocal() as session:
        rows = (await session.execute(
            select(ViolationEvent)
            .where(ViolationEvent.synced_at.is_not(None))
            .order_by(ViolationEvent.synced_at.desc())
            .limit(max(1, min(limit, 500)))
        )).scalars().all()
    return {
        "items": [
            {
                "id": ev.id,
                "camera_id": ev.camera_id,
                "rule_type": ev.rule_type,
                "gear": ev.gear,
                "occurred_at": ev.occurred_at.isoformat() if ev.occurred_at else None,
                "synced_at": ev.synced_at.isoformat() if ev.synced_at else None,
            }
            for ev in rows
        ]
    }
