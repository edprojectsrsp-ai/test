"""
Analytics API -- the data behind the dashboard tiles.

Reads the durable ViolationEvent / Alert / CameraRecord tables (written by the
pipeline via PersistenceService) plus the model registry, and returns the
aggregates the dashboard needs: KPI summary, violation time-series, repeat
offenders, department / contractor / shift breakdowns, camera health, a spatial
heat-map, and model-accuracy history.

All read-only. Every aggregate is computed in SQL where possible so it stays
fast as the tables grow.
"""
from __future__ import annotations

import json
import os
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.db import get_session
from app.models.domain import Alert, CameraRecord, ViolationEvent, ViolationStatus

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


def _now() -> datetime:
    return datetime.now(timezone.utc)


@router.get("/summary")
async def summary(session: AsyncSession = Depends(get_session)) -> dict:
    total = await session.scalar(select(func.count()).select_from(ViolationEvent))
    open_ct = await session.scalar(
        select(func.count()).select_from(ViolationEvent).where(
            ViolationEvent.status == ViolationStatus.open
        )
    )
    since = _now() - timedelta(hours=24)
    today = await session.scalar(
        select(func.count()).select_from(ViolationEvent).where(
            ViolationEvent.occurred_at >= since
        )
    )
    alerts = await session.scalar(select(func.count()).select_from(Alert))
    # by rule type
    rows = await session.execute(
        select(ViolationEvent.rule_type, func.count()).group_by(ViolationEvent.rule_type)
    )
    by_rule = {r[0]: r[1] for r in rows.all()}
    return {
        "total_violations": total or 0,
        "open_violations": open_ct or 0,
        "violations_24h": today or 0,
        "alerts_total": alerts or 0,
        "by_rule_type": by_rule,
    }


@router.get("/timeseries")
async def timeseries(days: int = 30, session: AsyncSession = Depends(get_session)) -> dict:
    since = _now() - timedelta(days=days)
    rows = await session.execute(
        select(ViolationEvent.occurred_at, ViolationEvent.rule_type).where(
            ViolationEvent.occurred_at >= since
        )
    )
    per_day: dict[str, int] = Counter()
    per_day_rule: dict[str, Counter] = {}
    for occurred_at, rule in rows.all():
        day = occurred_at.date().isoformat() if occurred_at else "unknown"
        per_day[day] += 1
        per_day_rule.setdefault(day, Counter())[rule] += 1
    series = [
        {"date": d, "count": per_day[d], "by_rule": dict(per_day_rule.get(d, {}))}
        for d in sorted(per_day)
    ]
    return {"days": days, "series": series}


@router.get("/repeat-offenders")
async def repeat_offenders(limit: int = 20, session: AsyncSession = Depends(get_session)) -> dict:
    """Rank by track_id where an employee isn't matched, else by employee_id."""
    rows = await session.execute(
        select(ViolationEvent.employee_id, ViolationEvent.track_id,
               ViolationEvent.camera_id, func.count().label("n"))
        .group_by(ViolationEvent.employee_id, ViolationEvent.track_id, ViolationEvent.camera_id)
        .order_by(func.count().desc())
        .limit(limit)
    )
    out = []
    for emp, track, cam, n in rows.all():
        out.append({
            "identity": emp or (f"track:{track}" if track is not None else "unknown"),
            "employee_id": emp, "track_id": track, "camera_id": cam, "count": n,
        })
    return {"offenders": out}


async def _group_count(session: AsyncSession, column) -> dict:
    rows = await session.execute(select(column, func.count()).group_by(column))
    return {(r[0] or "unassigned"): r[1] for r in rows.all()}


@router.get("/by-department")
async def by_department(session: AsyncSession = Depends(get_session)) -> dict:
    return {"by_department": await _group_count(session, ViolationEvent.department)}


@router.get("/by-shift")
async def by_shift(session: AsyncSession = Depends(get_session)) -> dict:
    return {"by_shift": await _group_count(session, ViolationEvent.shift)}


@router.get("/camera-health")
async def camera_health(session: AsyncSession = Depends(get_session)) -> dict:
    rows = await session.execute(select(CameraRecord))
    cams = []
    now = _now()
    for c in rows.scalars().all():
        stale = True
        if c.last_seen_at is not None:
            age = (now - c.last_seen_at.replace(tzinfo=timezone.utc)).total_seconds()
            stale = age > 120
        cams.append({
            "camera_id": c.id, "name": c.name, "state": c.last_state,
            "mode": c.mode, "enabled": c.enabled, "location": c.location,
            "last_seen_at": c.last_seen_at.isoformat() if c.last_seen_at else None,
            "last_error": c.last_error, "healthy": (c.last_state == "running" and not stale),
        })
    return {"cameras": cams, "count": len(cams)}


@router.get("/heatmap")
async def heatmap(camera_id: str | None = None, grid: int = 12,
                  session: AsyncSession = Depends(get_session)) -> dict:
    """Spatial density of violations: person-box centers binned into a grid,
    normalized 0..1 so the frontend can overlay it on any resolution."""
    q = select(ViolationEvent.person_box, ViolationEvent.camera_id)
    if camera_id:
        q = q.where(ViolationEvent.camera_id == camera_id)
    rows = await session.execute(q)
    cells: Counter = Counter()
    total = 0
    for box, cam in rows.all():
        if not box or len(box) < 4:
            continue
        # normalize by a nominal frame; if boxes are absolute px we still get a
        # stable relative heat-map because all boxes share the camera's frame.
        cx = (box[0] + box[2]) / 2.0
        cy = (box[1] + box[3]) / 2.0
        # assume max dimension ~ box coordinates; scale into grid using max seen
        cells[(cx, cy)] += 1
        total += 1
    # bin into grid using observed extents
    pts = list(cells.items())
    if pts:
        xs = [p[0][0] for p in pts]
        ys = [p[0][1] for p in pts]
        minx, maxx = min(xs), max(xs) or 1
        miny, maxy = min(ys), max(ys) or 1
        binned: Counter = Counter()
        for (cx, cy), n in pts:
            gx = int((cx - minx) / ((maxx - minx) or 1) * (grid - 1))
            gy = int((cy - miny) / ((maxy - miny) or 1) * (grid - 1))
            binned[(gx, gy)] += n
        cells_out = [{"x": x, "y": y, "count": n} for (x, y), n in binned.items()]
    else:
        cells_out = []
    return {"camera_id": camera_id, "grid": grid, "total": total, "cells": cells_out}


@router.get("/model-accuracy")
async def model_accuracy() -> dict:
    """Model-version accuracy history from the training registry."""
    s = get_settings()
    reg_path = Path(os.getenv("PPE_REGISTRY", str(s.WEIGHTS_DIR / "registry.json")))
    if not reg_path.exists():
        return {"active": None, "versions": []}
    with open(reg_path) as f:
        reg = json.load(f)
    versions = [
        {
            "version": v["version"],
            "metrics": v.get("metrics", {}),
            "note": v.get("note", ""),
            "gate": v.get("gate"),
            "is_active": v["version"] == reg.get("active"),
        }
        for v in sorted(reg.get("versions", []), key=lambda x: x["version"])
    ]
    return {"active": reg.get("active"), "versions": versions}
