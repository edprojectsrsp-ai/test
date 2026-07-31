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
    """Who offends repeatedly — grouped by person, not by tracker fragment.

    This used to group by (employee_id, track_id, camera_id). Since employee_id
    is never populated and a ByteTrack id resets every time somebody walks
    behind a column or crosses to another camera, it was counting track
    fragments: one worker with six violations in a shift appeared as six
    separate one-time offenders, and the table's whole purpose — spotting the
    person who keeps doing it — was defeated.

    Anonymous re-ID gives a stable per-person key that survives occlusion and
    crosses cameras (see app/ml/reid.py), stored on the violation as
    `person_key`. Rows still carrying only a track id are reported separately
    rather than blended in, so the number is never quietly half-wrong.
    """
    rows = await session.execute(
        select(ViolationEvent.employee_id, ViolationEvent.person_key,
               ViolationEvent.track_id, ViolationEvent.camera_id,
               ViolationEvent.gear, ViolationEvent.occurred_at)
    )
    from collections import defaultdict

    groups: dict = defaultdict(lambda: {"count": 0, "cameras": set(),
                                        "gears": defaultdict(int),
                                        "first": None, "last": None,
                                        "basis": "track"})
    unresolved = 0
    for emp, pkey, track, cam, gear, at in rows.all():
        if emp:
            key, basis = f"emp:{emp}", "employee"
        elif pkey:
            key, basis = f"person:{pkey}", "appearance"
        elif track is not None:
            key, basis = f"track:{cam}:{track}", "track"
            unresolved += 1
        else:
            key, basis = "unknown", "none"
            unresolved += 1
        g = groups[key]
        g["count"] += 1
        g["basis"] = basis
        g["cameras"].add(cam)
        g["gears"][gear or "?"] += 1
        if at and (g["first"] is None or at < g["first"]):
            g["first"] = at
        if at and (g["last"] is None or at > g["last"]):
            g["last"] = at

    out = [{
        "identity": k,
        "count": v["count"],
        "basis": v["basis"],
        "cameras": sorted(v["cameras"]),
        "cross_camera": len(v["cameras"]) > 1,
        "by_gear": dict(v["gears"]),
        "first_seen": v["first"].isoformat() if v["first"] else None,
        "last_seen": v["last"].isoformat() if v["last"] else None,
    } for k, v in groups.items()]
    out.sort(key=lambda r: -r["count"])
    return {
        "offenders": out[:limit],
        "grouped_by_appearance": sum(1 for r in out if r["basis"] == "appearance"),
        "unresolved_events": unresolved,
        "note": ("Rows with basis 'track' could not be resolved to a person — "
                 "they are tracker fragments and undercount. Enable re-ID "
                 "(PPE_REID=1) so violations carry a stable person key."),
    }


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
