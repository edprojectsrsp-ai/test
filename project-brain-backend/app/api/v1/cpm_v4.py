"""
Sprint 9B - CPM Engine v4 router (minimal integration).

This is mounted under /api/v1/cpm and co-exists with the existing /cpm/analyze endpoint.
"""
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db

router = APIRouter(prefix="/api/v1/cpm", tags=["cpm"])


class ScheduleCreate(BaseModel):
    package_id: int
    schedule_name: str = Field(..., max_length=200)
    description: Optional[str] = None
    project_start_date: Optional[date] = None
    user_id: int = 1


@router.post("/schedule")
def create_schedule(p: ScheduleCreate, db: Session = Depends(get_db)):
    row = db.execute(text("""
        INSERT INTO cpm_schedules(
            package_id, schedule_name, description,
            project_start_date, data_date, source, status, created_by
        ) VALUES (
            :pid, :name, :desc,
            :start, COALESCE(:start, CURRENT_DATE),
            'manual'::schedule_source_enum, 'active'::schedule_status_enum, :uid
        )
        RETURNING schedule_id
    """), {"pid": p.package_id, "name": p.schedule_name, "desc": p.description,
           "start": p.project_start_date, "uid": p.user_id}).mappings().first()
    db.commit()
    return {"schedule_id": row["schedule_id"]}


@router.get("/schedule")
def list_schedules(limit: int = 50, db: Session = Depends(get_db)):
    rows = db.execute(text("""
        SELECT s.schedule_id, s.package_id, s.schedule_name, s.description,
               s.project_start_date, s.data_date,
               s.source::text AS source, s.status::text AS status,
               s.created_at
        FROM cpm_schedules s
        WHERE NOT s.is_deleted
        ORDER BY s.created_at DESC
        LIMIT :limit
    """), {"limit": limit}).mappings().all()
    return {"items": [dict(r) for r in rows]}


@router.get("/schedule/{schedule_id}")
def get_schedule(schedule_id: int, db: Session = Depends(get_db)):
    s = db.execute(text("""
        SELECT s.schedule_id, s.package_id, s.schedule_name, s.description,
               s.project_start_date, s.data_date,
               s.source::text AS source, s.status::text AS status,
               s.created_at
        FROM cpm_schedules s
        WHERE s.schedule_id=:id AND NOT s.is_deleted
    """), {"id": schedule_id}).mappings().first()
    if not s:
        raise HTTPException(404, "Schedule not found")
    acts = db.execute(text("""
        SELECT activity_id, activity_code, activity_name,
               planned_start_date, planned_finish_date,
               early_start_date, early_finish_date,
               late_start_date, late_finish_date,
               total_float_days, is_critical
        FROM cpm_activities
        WHERE schedule_id=:id AND NOT is_deleted
        ORDER BY activity_code
    """), {"id": schedule_id}).mappings().all()
    deps = db.execute(text("""
        SELECT dependency_id, predecessor_activity_id, successor_activity_id,
               dependency_type::text AS dependency_type, lag_days
        FROM cpm_dependencies
        WHERE schedule_id=:id AND NOT is_deleted
        ORDER BY dependency_id
    """), {"id": schedule_id}).mappings().all()
    return {"schedule": dict(s), "activities": [dict(a) for a in acts], "dependencies": [dict(d) for d in deps]}

