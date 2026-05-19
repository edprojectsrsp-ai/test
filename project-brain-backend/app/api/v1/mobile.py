"""
Sprint 6 — Mobile Site Diary PWA backend

Endpoints live under `/api/v1/mobile/*` because:
 - main.py will include this router with prefix="/api/v1"
 - this router uses prefix="/mobile"
"""

from __future__ import annotations

import hashlib
import os
from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, UploadFile
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db

router = APIRouter(prefix="/mobile", tags=["Mobile"])


class DiaryEntryOut(BaseModel):
    daily_actual_id: int
    activity_id: int
    actual_date: date
    actual_qty: float
    area_of_work: Optional[str]
    manpower_count: Optional[int]
    photo_urls: list[str] = []
    location_lat: Optional[float]
    location_lng: Optional[float]


@router.get("/packages-for-me")
def my_packages(user_id: int, db: Session = Depends(get_db)):
    """Packages assigned to a user (PM, scheme access, or admin/manager)."""
    rows = (
        db.execute(
            text(
                """
                SELECT DISTINCT p.package_id, p.package_name, sm.scheme_name, p.site_location
                FROM packages p JOIN scheme_master sm ON sm.scheme_id=p.scheme_id
                LEFT JOIN user_scheme_access usa ON usa.scheme_id=sm.scheme_id
                WHERE NOT p.is_deleted
                  AND (p.project_manager_id=:uid OR usa.user_id=:uid OR
                       EXISTS (SELECT 1 FROM users WHERE user_id=:uid AND role IN ('admin','manager')))
                ORDER BY sm.scheme_name, p.package_no
                """
            ),
            {"uid": user_id},
        )
        .mappings()
        .all()
    )
    return {"packages": [dict(r) for r in rows]}


@router.get("/activities/{package_id}")
def activities_for_package(package_id: int, db: Session = Depends(get_db)):
    """Active plan activities for entering daily progress."""
    rows = (
        db.execute(
            text(
                """
                SELECT pa.activity_id, pa.activity_name, pa.activity_category,
                       u.uom_code, pa.scope_qty, pa.planned_start_date, pa.planned_finish_date,
                       COALESCE(SUM(da.actual_qty), 0) AS cum_actual_qty
                FROM plan_activities pa
                JOIN progress_plans pp ON pp.plan_id=pa.plan_id
                LEFT JOIN uom_master u ON u.uom_id=pa.uom_id
                LEFT JOIN daily_actuals da ON da.activity_id=pa.activity_id
                WHERE pp.package_id=:pid AND pp.is_current=TRUE AND NOT pa.is_deleted
                GROUP BY pa.activity_id, pa.activity_name, pa.activity_category, u.uom_code,
                         pa.scope_qty, pa.planned_start_date, pa.planned_finish_date
                ORDER BY pa.sort_order
                """
            ),
            {"pid": package_id},
        )
        .mappings()
        .all()
    )
    return {"activities": [dict(r) for r in rows]}


@router.post("/diary", response_model=DiaryEntryOut)
async def post_diary_entry(
    activity_id: int = Form(...),
    actual_date: date = Form(...),
    actual_qty: float = Form(...),
    area_of_work: Optional[str] = Form(None),
    manpower_count: Optional[int] = Form(None),
    location_lat: Optional[float] = Form(None),
    location_lng: Optional[float] = Form(None),
    remarks: Optional[str] = Form(None),
    user_id: int = Form(...),
    weather_conditions: Optional[str] = Form(None),
    photos: list[UploadFile] = File(default=[]),
    db: Session = Depends(get_db),
):
    """Submit a site diary entry with photos and GPS."""
    upload_dir = os.environ.get("UPLOAD_DIR", "/var/lib/project_brain/uploads")
    os.makedirs(upload_dir, exist_ok=True)

    photo_urls: list[str] = []
    for upl in photos:
        if not upl.filename:
            continue
        data = await upl.read()
        if not data:
            continue
        h = hashlib.sha256(data).hexdigest()[:16]
        ext = os.path.splitext(upl.filename)[1] or ".jpg"
        fname = f"{actual_date.isoformat()}_{activity_id}_{h}{ext}"
        fpath = os.path.join(upload_dir, fname)
        with open(fpath, "wb") as f:
            f.write(data)
        photo_urls.append(f"/uploads/{fname}")

    row = (
        db.execute(
            text(
                """
                INSERT INTO daily_actuals
                    (activity_id, actual_date, actual_qty, area_of_work, manpower_count,
                     weather_conditions, remarks, entered_by, entered_via,
                     location_lat, location_lng, photo_urls)
                VALUES (:aid, :d, :q, :area, :mp, :w, :rem, :uid, 'mobile', :lat, :lng, :ph)
                ON CONFLICT (activity_id, actual_date) DO UPDATE SET
                    actual_qty=EXCLUDED.actual_qty, area_of_work=EXCLUDED.area_of_work,
                    manpower_count=EXCLUDED.manpower_count, weather_conditions=EXCLUDED.weather_conditions,
                    remarks=EXCLUDED.remarks, location_lat=EXCLUDED.location_lat,
                    location_lng=EXCLUDED.location_lng,
                    photo_urls=ARRAY(
                        SELECT unnest(daily_actuals.photo_urls)
                        UNION
                        SELECT unnest(EXCLUDED.photo_urls)
                    )
                RETURNING daily_actual_id, activity_id, actual_date, actual_qty, area_of_work,
                          manpower_count, photo_urls, location_lat, location_lng
                """
            ),
            {
                "aid": activity_id,
                "d": actual_date,
                "q": actual_qty,
                "area": area_of_work,
                "mp": manpower_count,
                "w": weather_conditions,
                "rem": remarks,
                "uid": user_id,
                "lat": location_lat,
                "lng": location_lng,
                "ph": photo_urls,
            },
        )
        .mappings()
        .first()
    )
    db.commit()
    out = dict(row)
    out["photo_urls"] = list(out.get("photo_urls") or [])
    return DiaryEntryOut(**out)


@router.post("/observation")
async def quick_observation(
    package_id: int = Form(...),
    observation_type: str = Form("note"),
    title: Optional[str] = Form(None),
    description: str = Form(...),
    severity: Optional[str] = Form(None),
    location_lat: Optional[float] = Form(None),
    location_lng: Optional[float] = Form(None),
    user_id: int = Form(...),
    photos: list[UploadFile] = File(default=[]),
    db: Session = Depends(get_db),
):
    upload_dir = os.environ.get("UPLOAD_DIR", "/var/lib/project_brain/uploads")
    os.makedirs(upload_dir, exist_ok=True)

    photo_urls: list[str] = []
    for upl in photos:
        if not upl.filename:
            continue
        data = await upl.read()
        if not data:
            continue
        h = hashlib.sha256(data).hexdigest()[:16]
        ext = os.path.splitext(upl.filename)[1] or ".jpg"
        fname = f"obs_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{h}{ext}"
        with open(os.path.join(upload_dir, fname), "wb") as f:
            f.write(data)
        photo_urls.append(f"/uploads/{fname}")

    row = (
        db.execute(
            text(
                """
                INSERT INTO field_observations
                    (package_id, observation_type, title, description, severity,
                     photo_urls, location_lat, location_lng, observed_by)
                VALUES (:pid, :t::observation_type_enum, :ti, :d,
                        NULLIF(:s,'')::risk_level_enum, :ph, :lat, :lng, :uid)
                RETURNING observation_id
                """
            ),
            {
                "pid": package_id,
                "t": observation_type,
                "ti": title,
                "d": description,
                "s": severity or "",
                "ph": photo_urls,
                "lat": location_lat,
                "lng": location_lng,
                "uid": user_id,
            },
        )
        .mappings()
        .first()
    )
    db.commit()
    return {"observation_id": row["observation_id"], "photo_urls": photo_urls}

