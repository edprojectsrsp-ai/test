"""Licence administration: issue registration codes, and revoke them.

Cloud-side only, and behind the Project Brain login (see core/admin_auth.py) --
these endpoints mint the codes that let a machine enrol, so an unauthenticated
one would hand anybody a working licence.

Deliberately no delete. A code that enrolled three plant PCs is the only record
of why those three agents exist; removing the row turns their provenance into a
gap. Switching a code off stops it enrolling anything new and leaves the machines
it already registered running -- pulling a customer's cameras offline because
their licence lapsed is a safety decision, not a billing one, and it is not this
endpoint's to make.
"""
from __future__ import annotations

import logging
import secrets
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from app.core.admin_auth import require_admin
from app.core.db import SessionLocal
from app.models.domain import AgentRecord, LicenceCode

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin", tags=["admin"])

# No 0/O/1/I/l. These get read down a phone line and typed by someone standing
# at a plant PC; a code that is ambiguous in a sans-serif font costs a support
# call for every unit shipped.
_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


def _generate(groups: int = 3, size: int = 4) -> str:
    return "-".join(
        "".join(secrets.choice(_ALPHABET) for _ in range(size))
        for _ in range(groups)
    )


class CodeIn(BaseModel):
    customer: str = Field(default="", max_length=64)
    label: str = Field(default="", max_length=128)
    notes: str = Field(default="", max_length=2000)


class ToggleIn(BaseModel):
    active: bool


def _as_dict(c: LicenceCode) -> dict:
    return {
        "code": c.code,
        "customer": c.customer or "",
        "label": c.label or "",
        "active": bool(c.active),
        "activations": c.activations or 0,
        "last_used_at": c.last_used_at.isoformat() if c.last_used_at else None,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "created_by": c.created_by or "",
        "notes": c.notes or "",
    }


@router.get("/codes")
async def list_codes(_admin: dict = Depends(require_admin)) -> dict:
    async with SessionLocal() as session:
        rows = (await session.execute(
            select(LicenceCode).order_by(LicenceCode.created_at.desc())
        )).scalars().all()
        # Which machines each code actually brought in. The count on the row is
        # a tally; this is the list an admin needs when a customer asks which of
        # their PCs are registered.
        agents = (await session.execute(select(AgentRecord))).scalars().all()

    by_customer: dict[str, list] = {}
    for a in agents:
        by_customer.setdefault((a.customer or "").lower(), []).append({
            "id": a.id,
            "name": a.name or "",
            "enabled": bool(a.enabled),
            "last_seen_at": a.last_seen_at.isoformat() if a.last_seen_at else None,
            "total_pushed": a.total_pushed or 0,
        })

    items = []
    for c in rows:
        d = _as_dict(c)
        d["agents"] = by_customer.get((c.customer or "").lower(), [])
        items.append(d)
    return {"items": items}


@router.post("/codes")
async def create_code(payload: CodeIn,
                      admin: dict = Depends(require_admin)) -> dict:
    async with SessionLocal() as session:
        # Retry rather than trusting 31^12 to never collide: the primary key
        # would raise on insert, and a 500 on "generate a code" is a worse
        # outcome than one extra round trip.
        for _ in range(8):
            code = _generate()
            if await session.get(LicenceCode, code) is None:
                break
        else:
            raise HTTPException(500, "could not allocate a unique code")

        row = LicenceCode(
            code=code,
            customer=payload.customer.strip().lower(),
            label=payload.label.strip(),
            notes=payload.notes.strip(),
            created_by=str(admin.get("user_id") or ""),
            active=True,
        )
        session.add(row)
        await session.commit()
        await session.refresh(row)
        result = _as_dict(row)

    log.info("licence code issued for %r by user %s",
             result["customer"] or "-", admin.get("user_id"))
    return result


@router.post("/codes/{code}/active")
async def set_code_active(code: str, payload: ToggleIn,
                          admin: dict = Depends(require_admin)) -> dict:
    async with SessionLocal() as session:
        row = await session.get(LicenceCode, code)
        if row is None:
            raise HTTPException(404, "no such code")
        row.active = bool(payload.active)
        await session.commit()
        await session.refresh(row)
        result = _as_dict(row)

    log.info("licence code %s set active=%s by user %s",
             code, payload.active, admin.get("user_id"))
    return result


@router.get("/agents")
async def list_agents(_admin: dict = Depends(require_admin)) -> dict:
    """Every registered plant PC. Token hashes are never returned."""
    async with SessionLocal() as session:
        rows = (await session.execute(
            select(AgentRecord).order_by(AgentRecord.id))).scalars().all()
    return {
        "items": [
            {
                "id": a.id,
                "name": a.name or "",
                "customer": a.customer or "",
                "enabled": bool(a.enabled),
                "last_seen_at": a.last_seen_at.isoformat() if a.last_seen_at else None,
                "last_push_count": a.last_push_count or 0,
                "total_pushed": a.total_pushed or 0,
            }
            for a in rows
        ]
    }


@router.post("/agents/{agent_id}/enabled")
async def set_agent_enabled(agent_id: str, payload: ToggleIn,
                            admin: dict = Depends(require_admin)) -> dict:
    """Stop (or resume) accepting pushes from one plant PC.

    The agent keeps recording locally either way -- this only closes the door on
    the cloud side. Its already-pushed violations stay: they are part of a safety
    record, and deleting them to tidy up a fleet list would be destroying
    evidence.
    """
    async with SessionLocal() as session:
        row = await session.get(AgentRecord, agent_id)
        if row is None:
            raise HTTPException(404, "no such agent")
        row.enabled = bool(payload.active)
        await session.commit()
        enabled = bool(row.enabled)

    log.info("agent %s set enabled=%s by user %s", agent_id, enabled,
             admin.get("user_id"))
    return {"id": agent_id, "enabled": enabled}
