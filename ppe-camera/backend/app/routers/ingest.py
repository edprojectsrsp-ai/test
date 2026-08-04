"""
Sync receiver (cloud role only) -- where pushed violations land.

  POST /api/sync/violations   agent pushes a batch; upserted by violation id
  GET  /api/sync/agents       registered plant PCs + when each last reported
  POST /api/sync/prune        drop cloud rows past the retention window

This is the ONLY write path from the plant into the cloud, and it is the only
endpoint that accepts an agent credential. Everything else here is read-only
dashboard traffic, which is the point: the cloud cannot command the plant, it
can only be told things by it.

Idempotency comes free. Violation ids are uuid4s minted on the agent, so a
batch that half-succeeded before the uplink dropped can be pushed again and
lands as an update rather than a duplicate. The response says exactly which ids
were accepted, and the agent stamps only those — anything unacknowledged stays
in its queue instead of vanishing.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import re
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete as sa_delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.db import SessionLocal
from app.models.domain import AgentRecord, ViolationEvent, ViolationStatus

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/sync", tags=["sync"])


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


async def seed_agents() -> int:
    """Reconcile sync_agents with PPE_SYNC_AGENTS. Called once at cloud boot."""
    s = get_settings()
    if not s.SYNC_AGENTS:
        return 0
    seeded = 0
    async with SessionLocal() as session:
        for entry in s.SYNC_AGENTS.split(","):
            entry = entry.strip()
            if not entry or ":" not in entry:
                continue
            agent_id, _, token = entry.partition(":")
            agent_id, token = agent_id.strip(), token.strip()
            if not agent_id or not token:
                continue
            rec = await session.get(AgentRecord, agent_id)
            if rec is None:
                rec = AgentRecord(id=agent_id, name=agent_id)
                session.add(rec)
            # Re-hash every boot so rotating the env var actually rotates the
            # credential, and re-enable: an operator who edits the variable
            # means for that agent to work.
            rec.token_hash = _hash(token)
            rec.enabled = True
            seeded += 1
        await session.commit()
    log.info("seeded %d sync agent(s)", seeded)
    return seeded


async def _require_agent(session: AsyncSession, agent_id: str | None,
                         token: str | None) -> AgentRecord:
    if not agent_id or not token:
        raise HTTPException(401, "missing X-Agent-Id / X-Agent-Token")
    rec = await session.get(AgentRecord, agent_id)
    # Compare in constant time, and against a dummy hash when the agent does not
    # exist so the unknown-agent path costs the same as the wrong-token path.
    # One error message for both: distinct ones let an attacker enumerate valid
    # agent ids one request at a time.
    expected = (rec.token_hash if rec is not None else "") or _hash("\x00-absent")
    if not hmac.compare_digest(_hash(token), expected) or rec is None:
        raise HTTPException(401, "invalid agent credentials")
    if not rec.enabled:
        raise HTTPException(403, "agent disabled")
    return rec


class EnrollIn(BaseModel):
    code: str
    name: str = ""
    hostname: str = ""


@router.post("/enroll")
async def enroll(payload: EnrollIn) -> dict:
    """Exchange a join code for this agent's own credentials.

    The alternative was making the operator invent an agent id, generate a
    token, type both into the installer AND add the matching pair to a Render
    environment variable before the first push would work. Four steps across two
    systems, any one of which silently produces a 401 later. This is one code.

    The returned token is shown exactly once -- only its hash is stored.
    """
    s = get_settings()
    if not s.ENROLL_CODE:
        raise HTTPException(
            503, "enrollment is not enabled on this server (set PPE_ENROLL_CODE)")
    if not hmac.compare_digest(payload.code.strip(), s.ENROLL_CODE):
        raise HTTPException(401, "invalid join code")

    name = (payload.name or payload.hostname or "plant-pc").strip()
    slug = re.sub(r"[^a-z0-9-]+", "-", name.lower()).strip("-")[:40] or "agent"

    async with SessionLocal() as session:
        # Re-enrolling the same machine rotates its token rather than
        # accumulating a new agent per reinstall -- otherwise the fleet list
        # fills with dead entries and nobody can tell which one is live.
        existing = await session.get(AgentRecord, slug)
        agent_id = slug
        if existing is not None and existing.token_hash:
            suffix = secrets.token_hex(3)
            agent_id = f"{slug}-{suffix}"

        token = secrets.token_urlsafe(32)
        rec = await session.get(AgentRecord, agent_id)
        if rec is None:
            rec = AgentRecord(id=agent_id)
            session.add(rec)
        rec.name = name
        rec.token_hash = _hash(token)
        rec.enabled = True
        await session.commit()

    log.info("enrolled agent %s (%s)", agent_id, name)
    return {"agent_id": agent_id, "agent_token": token,
            "sync_url": "", "message": "store these; the token is not shown again"}


class ViolationIn(BaseModel):
    id: str
    camera_id: str = ""
    rule_type: str = "ppe"
    gear: str = ""
    track_id: int | None = None
    person_key: str = ""
    confidence: float = 0.0
    person_box: list = Field(default_factory=list)
    department: str = ""
    shift: str = ""
    status: str = "open"
    occurred_at: str | None = None
    thumb_b64: str | None = None
    # accountability (owned by the agent; the cloud mirrors it)
    assigned_to: str = ""
    assigned_to_id: str | None = None
    contractor_id: str | None = None
    assigned_by: str = ""
    assigned_at: str | None = None
    due_at: str | None = None
    assignment_note: str = ""
    resolution_note: str = ""
    resolved_by: str = ""
    resolved_at: str | None = None


class BatchIn(BaseModel):
    agent_id: str = ""
    violations: list[ViolationIn] = Field(default_factory=list)


def _parse_dt(s: str | None) -> datetime:
    if not s:
        return _now()
    try:
        d = datetime.fromisoformat(s)
    except ValueError:
        return _now()
    return d.replace(tzinfo=timezone.utc) if d.tzinfo is None else d


def _opt_dt(s: str | None) -> datetime | None:
    """Nullable variant: "not assigned" and "assigned just now" are different
    facts, so an absent timestamp must stay absent rather than become now()."""
    if not s:
        return None
    try:
        d = datetime.fromisoformat(s)
    except ValueError:
        return None
    return d.replace(tzinfo=timezone.utc) if d.tzinfo is None else d


@router.post("/violations")
async def receive_violations(
    payload: BatchIn,
    x_agent_id: str | None = Header(default=None, alias="X-Agent-Id"),
    x_agent_token: str | None = Header(default=None, alias="X-Agent-Token"),
) -> dict:
    async with SessionLocal() as session:
        agent = await _require_agent(session, x_agent_id, x_agent_token)

        accepted: list[str] = []
        rejected: list[dict] = []
        for v in payload.violations:
            try:
                thumb = base64.b64decode(v.thumb_b64) if v.thumb_b64 else None
            except Exception:  # noqa: BLE001 - one bad image is not a bad batch
                thumb = None
            try:
                status = ViolationStatus(v.status)
            except ValueError:
                status = ViolationStatus.open

            try:
                ev = await session.get(ViolationEvent, v.id)
                if ev is None:
                    ev = ViolationEvent(id=v.id)
                    session.add(ev)
                ev.camera_id = v.camera_id
                ev.rule_type = v.rule_type
                ev.gear = v.gear
                ev.track_id = v.track_id
                ev.person_key = v.person_key
                ev.confidence = float(v.confidence or 0.0)
                ev.person_box = list(v.person_box or [])
                ev.department = v.department
                ev.shift = v.shift
                ev.status = status
                ev.occurred_at = _parse_dt(v.occurred_at)
                ev.assigned_to = v.assigned_to
                ev.assigned_to_id = v.assigned_to_id
                ev.contractor_id = v.contractor_id
                ev.assigned_by = v.assigned_by
                ev.assigned_at = _opt_dt(v.assigned_at)
                ev.due_at = _opt_dt(v.due_at)
                ev.assignment_note = v.assignment_note
                ev.resolution_note = v.resolution_note
                ev.resolved_by = v.resolved_by
                ev.resolved_at = _opt_dt(v.resolved_at)
                ev.agent_id = agent.id
                ev.synced_at = _now()
                # Never blank an image we already hold. A re-push whose
                # thumbnail failed to build on the agent (deleted local file,
                # say) must not erase the evidence the cloud already has.
                if thumb is not None:
                    ev.thumb_jpeg = thumb
                accepted.append(v.id)
            except Exception as exc:  # noqa: BLE001
                log.warning("rejected violation %s: %s", v.id, exc)
                rejected.append({"id": v.id, "error": str(exc)})

        agent.last_seen_at = _now()
        agent.last_push_count = len(accepted)
        agent.total_pushed = (agent.total_pushed or 0) + len(accepted)
        await session.commit()

    return {"ok": True, "accepted": accepted, "rejected": rejected,
            "count": len(accepted)}


@router.get("/agents")
async def list_agents() -> dict:
    """Fleet of plant PCs. Never returns token hashes."""
    async with SessionLocal() as session:
        rows = (await session.execute(
            select(AgentRecord).order_by(AgentRecord.id))).scalars().all()
    return {
        "items": [
            {
                "id": a.id,
                "name": a.name,
                "enabled": a.enabled,
                "last_seen_at": a.last_seen_at.isoformat() if a.last_seen_at else None,
                "last_push_count": a.last_push_count,
                "total_pushed": a.total_pushed,
            }
            for a in rows
        ]
    }


@router.post("/prune")
async def prune(days: int | None = None) -> dict:
    """Delete cloud violations older than the retention window.

    Safe because the cloud is a dashboard, not an archive: the agent keeps the
    full-resolution still, the evidence GIF and the video clip indefinitely, and
    that is the copy anyone would produce in a dispute. Free Postgres is ~1 GB,
    which is roughly 20k thumbnails, so something has to give and it should be
    the copy that is not the system of record.
    """
    s = get_settings()
    window = days if days is not None else s.CLOUD_RETENTION_DAYS
    cutoff = _now() - timedelta(days=max(1, window))
    async with SessionLocal() as session:
        n = await session.execute(
            select(func.count()).select_from(ViolationEvent)
            .where(ViolationEvent.occurred_at < cutoff))
        count = int(n.scalar() or 0)
        await session.execute(
            sa_delete(ViolationEvent).where(ViolationEvent.occurred_at < cutoff))
        await session.commit()
    return {"deleted": count, "older_than_days": window,
            "cutoff": cutoff.isoformat()}
