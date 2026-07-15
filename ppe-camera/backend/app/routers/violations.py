"""
Violations / Alerts API -- the evidence gallery behind the "Alerts" tab.

Each fired violation was already persisted (ViolationEvent) with the frame image
captured to disk. This surfaces them as a browsable, classified feed: photo +
what type of violation (No Helmet / No Vest / Smoking / Fall / ...), which camera,
when, and how confident.

  GET    /api/violations              recent violations (filter: type/category/
                                       camera/status/date_from/date_to/hours)
  GET    /api/violations/types         counts per classification (filter chips)
  GET    /api/violations/{id}/image    evidence photo WITH the red violation box
  POST   /api/violations/{id}/status   acknowledge / resolve / mark false-alarm
  DELETE /api/violations               clear all (or a filtered subset)
  DELETE /api/violations/{id}          delete one
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel
from sqlalchemy import delete as sa_delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.models.domain import ViolationEvent, ViolationStatus

router = APIRouter(prefix="/api/violations", tags=["violations"])


def _parse_date(s: str | None, end: bool = False):
    """Parse YYYY-MM-DD (or ISO) into a tz-aware datetime; end=True -> end of day."""
    if not s:
        return None
    try:
        d = datetime.fromisoformat(s)
    except ValueError:
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    if end and len(s) <= 10:  # date-only -> include the whole day
        d = d.replace(hour=23, minute=59, second=59)
    return d


# Human-readable classification for the badge on each photo.
_HAZARD_LABELS = {
    "smoking": "Smoking", "mobile_phone": "Mobile Phone", "fire": "Fire",
    "smoke": "Smoke", "restricted_area": "Restricted Area",
    "fall": "Fall Detected", "near_miss": "Near Miss",
}


def classify(rule_type: str, gear: str) -> dict:
    """-> {label, category, severity} for the UI badge."""
    if rule_type == "ppe":
        item = (gear or "PPE").replace("_", " ").title()
        return {"label": f"No {item}", "category": gear or "ppe", "severity": "high"}
    label = _HAZARD_LABELS.get(rule_type, rule_type.replace("_", " ").title())
    sev = "critical" if rule_type in ("fire", "fall", "smoke") else "high"
    return {"label": label, "category": rule_type, "severity": sev}


def _to_out(ev: ViolationEvent) -> dict:
    cls = classify(ev.rule_type, ev.gear)
    return {
        "id": ev.id,
        "rule_type": ev.rule_type,
        "gear": ev.gear,
        **cls,  # label, category, severity
        "camera_id": ev.camera_id,
        "confidence": round(ev.confidence or 0.0, 3),
        "track_id": ev.track_id,
        "department": ev.department,
        "shift": ev.shift,
        "status": ev.status.value if hasattr(ev.status, "value") else ev.status,
        "occurred_at": ev.occurred_at.isoformat() if ev.occurred_at else None,
        "image_url": f"/api/violations/{ev.id}/image",
        "has_image": bool(ev.image_path),
    }


@router.get("")
async def list_violations(
    rule_type: str | None = None,
    category: str | None = None,
    camera_id: str | None = None,
    status: str | None = None,
    hours: int | None = None,
    date_from: str | None = None,   # YYYY-MM-DD
    date_to: str | None = None,     # YYYY-MM-DD (inclusive)
    limit: int = 60,
    session: AsyncSession = Depends(get_session),
) -> dict:
    q = select(ViolationEvent).order_by(ViolationEvent.occurred_at.desc())
    if rule_type:
        q = q.where(ViolationEvent.rule_type == rule_type)
    if camera_id:
        q = q.where(ViolationEvent.camera_id == camera_id)
    if status:
        q = q.where(ViolationEvent.status == status)
    if hours:
        q = q.where(ViolationEvent.occurred_at >= datetime.now(timezone.utc) - timedelta(hours=hours))
    df = _parse_date(date_from)
    dt = _parse_date(date_to, end=True)
    if df:
        q = q.where(ViolationEvent.occurred_at >= df)
    if dt:
        q = q.where(ViolationEvent.occurred_at <= dt)
    q = q.limit(max(1, min(limit, 500)))
    rows = (await session.execute(q)).scalars().all()
    items = [_to_out(ev) for ev in rows]
    # `category` filters on the derived classification (e.g. helmet, smoking)
    if category:
        items = [it for it in items if it["category"] == category]
    return {"count": len(items), "violations": items}


@router.get("/export.csv")
async def export_csv(
    camera_id: str | None = None,
    status: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    hours: int | None = 24 * 30,
    session: AsyncSession = Depends(get_session),
):
    """CSV export for PPE violation reports (Excel / audit packs)."""
    import csv
    import io
    from fastapi.responses import StreamingResponse

    q = select(ViolationEvent).order_by(ViolationEvent.occurred_at.desc())
    if camera_id:
        q = q.where(ViolationEvent.camera_id == camera_id)
    if status:
        q = q.where(ViolationEvent.status == status)
    if hours:
        q = q.where(ViolationEvent.occurred_at >= datetime.now(timezone.utc) - timedelta(hours=hours))
    df = _parse_date(date_from)
    dt = _parse_date(date_to, end=True)
    if df:
        q = q.where(ViolationEvent.occurred_at >= df)
    if dt:
        q = q.where(ViolationEvent.occurred_at <= dt)
    q = q.limit(5000)
    rows = (await session.execute(q)).scalars().all()

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow([
        "id", "occurred_at", "camera_id", "label", "category", "severity",
        "rule_type", "gear", "confidence", "status", "track_id", "department", "shift",
    ])
    for ev in rows:
        cls = classify(ev.rule_type, ev.gear)
        st = ev.status.value if hasattr(ev.status, "value") else ev.status
        w.writerow([
            ev.id,
            ev.occurred_at.isoformat() if ev.occurred_at else "",
            ev.camera_id,
            cls["label"],
            cls["category"],
            cls["severity"],
            ev.rule_type,
            ev.gear,
            round(ev.confidence or 0.0, 3),
            st,
            ev.track_id if ev.track_id is not None else "",
            ev.department or "",
            ev.shift or "",
        ])
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=ppe_violations_report.csv"},
    )


@router.get("/types")
async def violation_types(session: AsyncSession = Depends(get_session)) -> dict:
    """Counts per classification -- powers the filter chips + summary tiles."""
    rows = await session.execute(
        select(ViolationEvent.rule_type, ViolationEvent.gear, func.count())
        .group_by(ViolationEvent.rule_type, ViolationEvent.gear)
    )
    buckets: dict[str, dict] = {}
    total = 0
    for rule_type, gear, n in rows.all():
        cls = classify(rule_type, gear)
        key = cls["category"]
        b = buckets.setdefault(key, {"category": key, "label": cls["label"],
                                     "severity": cls["severity"], "count": 0})
        b["count"] += n
        total += n
    ordered = sorted(buckets.values(), key=lambda b: -b["count"])
    return {"total": total, "types": ordered}


def _annotate(path: Path, ev: ViolationEvent, predictions: list | None) -> bytes | None:
    """Draw the red violation box(es) + label on the frame. Returns JPEG bytes,
    or None if we can't (caller falls back to the raw file)."""
    try:
        import cv2
        import numpy as np  # noqa: F401

        img = cv2.imread(str(path))
        if img is None:
            return None
        RED = (0, 0, 255)
        cls = classify(ev.rule_type, ev.gear)
        # industrial-style chip: "No Cap" / "No Safety Jacket"
        label = f"{cls['label']}  {int(round((ev.confidence or 0) * 100))}%"

        # 1) the offending person -> thick red rectangle
        box = ev.person_box
        if box and len(box) >= 4:
            x1, y1, x2, y2 = (int(v) for v in box[:4])
            cv2.rectangle(img, (x1, y1), (x2, y2), RED, 3)
            (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 2)
            ly = max(0, y1 - th - 10)
            cv2.rectangle(img, (x1, ly), (x1 + tw + 10, ly + th + 10), RED, -1)
            cv2.putText(img, label, (x1 + 5, ly + th + 3),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)

        # 2) the exact missing-PPE detection(s) -> a red circle on the spot
        want = ev.gear if ev.rule_type == "ppe" else None
        for p in (predictions or []):
            c = str(p.get("cls", ""))
            xy = p.get("xyxy") or []
            if len(xy) >= 4 and (c == f"no_{want}" or (want and c == want) or
                                 (ev.rule_type != "ppe" and c == ev.rule_type)):
                cx, cy = int((xy[0] + xy[2]) / 2), int((xy[1] + xy[3]) / 2)
                r = max(10, int((xy[2] - xy[0]) / 2))
                cv2.circle(img, (cx, cy), r, RED, 3)
        ok, buf = cv2.imencode(".jpg", img)
        return buf.tobytes() if ok else None
    except Exception:
        return None


@router.get("/{violation_id}/image")
async def violation_image(
    violation_id: str, raw: bool = False, session: AsyncSession = Depends(get_session)
):
    ev = await session.get(ViolationEvent, violation_id)
    if ev is None:
        raise HTTPException(404, "violation not found")
    predictions = None
    path = Path(ev.image_path) if ev.image_path else None
    # Pull the linked capture for its stored predictions (and a fallback image).
    if ev.capture_id:
        from app.models.review import CaptureItem
        cap = await session.get(CaptureItem, ev.capture_id)
        if cap:
            predictions = cap.predictions
            if (path is None or not path.exists()) and cap.image_path:
                path = Path(cap.image_path)
    if path is None or not path.exists():
        raise HTTPException(404, "evidence image missing")
    if not raw:
        annotated = _annotate(path, ev, predictions)
        if annotated is not None:
            return Response(content=annotated, media_type="image/jpeg")
    return FileResponse(str(path), media_type="image/jpeg")


class StatusIn(BaseModel):
    status: str  # acknowledged | resolved | false_alarm | open


@router.post("/{violation_id}/status")
async def set_status(
    violation_id: str, payload: StatusIn, session: AsyncSession = Depends(get_session)
) -> dict:
    ev = await session.get(ViolationEvent, violation_id)
    if ev is None:
        raise HTTPException(404, "violation not found")
    try:
        ev.status = ViolationStatus(payload.status)
    except ValueError:
        raise HTTPException(422, f"invalid status '{payload.status}'")
    await session.commit()
    return {"id": violation_id, "status": ev.status.value}


@router.delete("")
async def clear_violations(
    rule_type: str | None = None,
    category: str | None = None,
    camera_id: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Clear alerts. With no filters -> clears ALL. Only removes the alert log
    (ViolationEvent); the training-queue captures/images are left intact."""
    stmt = sa_delete(ViolationEvent)
    if rule_type:
        stmt = stmt.where(ViolationEvent.rule_type == rule_type)
    if camera_id:
        stmt = stmt.where(ViolationEvent.camera_id == camera_id)
    df = _parse_date(date_from)
    dt = _parse_date(date_to, end=True)
    if df:
        stmt = stmt.where(ViolationEvent.occurred_at >= df)
    if dt:
        stmt = stmt.where(ViolationEvent.occurred_at <= dt)
    # `category` is a derived label -> resolve to rule_type/gear in Python
    if category and not rule_type:
        rows = (await session.execute(select(ViolationEvent))).scalars().all()
        ids = [r.id for r in rows if classify(r.rule_type, r.gear)["category"] == category]
        if not ids:
            return {"deleted": 0}
        res = await session.execute(sa_delete(ViolationEvent).where(ViolationEvent.id.in_(ids)))
        await session.commit()
        return {"deleted": res.rowcount or len(ids)}
    res = await session.execute(stmt)
    await session.commit()
    return {"deleted": res.rowcount or 0}


@router.delete("/{violation_id}")
async def delete_violation(
    violation_id: str, session: AsyncSession = Depends(get_session)
) -> dict:
    ev = await session.get(ViolationEvent, violation_id)
    if ev is None:
        raise HTTPException(404, "violation not found")
    await session.delete(ev)
    await session.commit()
    return {"deleted": violation_id}
