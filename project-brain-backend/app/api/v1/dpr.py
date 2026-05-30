"""DPR API — Daily Progress Reports (t5 schema).

Maps to live t5 tables:
  daily_actuals        — activity-level quantity entries (one row per activity per date)
  field_observations   — geotagged site notes, issues, photos

Note: plan_activities.uom_id → uom_master.uom_code (no direct uom column).
      All date parameters use CAST(:param AS date) to avoid SQLAlchemy parsing
      the PostgreSQL :: cast after a bind param.
"""

from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db

router = APIRouter(prefix="/dpr", tags=["DPR"])

# Shared UoM join fragment reused in multiple queries
_UOM_JOIN = "LEFT JOIN uom_master um ON um.uom_id = pa.uom_id"
_UOM_COL  = "COALESCE(um.uom_code, '') AS uom"


# ─────────────────────── Scheme → packages ───────────────────────────────────

@router.get("/scheme/{scheme_id}/packages")
def get_scheme_packages(scheme_id: int, db: Session = Depends(get_db)):
    """Return packages for a scheme with their locked-plan status."""
    rows = db.execute(text("""
        SELECT
            p.package_id,
            p.package_name,
            p.package_value_cr,
            p.planned_end_date,
            CASE WHEN pp.plan_id IS NOT NULL THEN TRUE ELSE FALSE END AS has_active_plan,
            pp.plan_name,
            pp.plan_id
        FROM packages p
        LEFT JOIN progress_plans pp
               ON pp.package_id = p.package_id
              AND pp.is_locked   = TRUE
              AND pp.is_current  = TRUE
        WHERE p.scheme_id = :s_id
          AND NOT p.is_deleted
        ORDER BY p.package_id
    """), {"s_id": scheme_id}).mappings().all()
    return [dict(r) for r in rows]


# ─────────────────────── Plan activities list ────────────────────────────────

@router.get("/packages/{package_id}/activities")
def get_package_activities(package_id: int, db: Session = Depends(get_db)):
    """Return plan activities from the locked plan for this package."""
    rows = db.execute(text("""
        SELECT
            pa.activity_id,
            pa.activity_name,
            COALESCE(um.uom_code, '') AS uom,
            pa.scope_qty,
            pa.planned_start_date,
            pa.planned_finish_date,
            pa.weight_pct,
            pa.sort_order,
            pp.plan_id,
            pp.plan_name
        FROM plan_activities pa
        JOIN progress_plans pp ON pa.plan_id = pp.plan_id
        LEFT JOIN uom_master um ON um.uom_id = pa.uom_id
        WHERE pp.package_id = :pkg_id
          AND pp.is_locked  = TRUE
          AND pp.is_current = TRUE
          AND NOT pa.is_deleted
        ORDER BY pa.sort_order, pa.activity_id
    """), {"pkg_id": package_id}).mappings().all()
    return [dict(r) for r in rows]


# ─────────────────────── Get actuals for a package ───────────────────────────

@router.get("/actuals/{package_id}")
def get_actuals(
    package_id: int,
    date_from: Optional[str] = Query(None, alias="from"),
    date_to: Optional[str] = Query(None, alias="to"),
    db: Session = Depends(get_db),
):
    """List daily_actuals rows for a package, optionally filtered by date range."""
    rows = db.execute(text("""
        SELECT
            da.daily_actual_id,
            da.activity_id,
            da.actual_date,
            da.actual_qty,
            da.area_of_work,
            da.manpower_count,
            da.equipment_deployed,
            da.weather_conditions,
            da.remarks,
            da.entered_via,
            da.location_lat,
            da.location_lng,
            pa.activity_name,
            COALESCE(um.uom_code, '') AS uom,
            pa.scope_qty,
            pa.sort_order
        FROM daily_actuals da
        JOIN plan_activities  pa ON da.activity_id = pa.activity_id
        JOIN progress_plans   pp ON pa.plan_id      = pp.plan_id
        LEFT JOIN uom_master  um ON um.uom_id        = pa.uom_id
        WHERE pp.package_id = :pkg_id
          AND (:d_from IS NULL OR da.actual_date >= CAST(:d_from AS date))
          AND (:d_to   IS NULL OR da.actual_date <= CAST(:d_to   AS date))
        ORDER BY da.actual_date DESC, pa.sort_order
    """), {
        "pkg_id": package_id,
        "d_from": date_from,
        "d_to":   date_to,
    }).mappings().all()
    return [dict(r) for r in rows]


# ─────────────────────── Get actuals for one date ────────────────────────────

@router.get("/actuals/{package_id}/date/{actual_date}")
def get_actuals_for_date(
    package_id: int,
    actual_date: str,
    db: Session = Depends(get_db),
):
    """Return actuals + cumulative for a specific date (prefills entry form)."""
    rows = db.execute(text("""
        SELECT
            pa.activity_id,
            pa.activity_name,
            COALESCE(um.uom_code, '') AS uom,
            pa.scope_qty,
            pa.sort_order,
            COALESCE(da.actual_qty, 0)         AS actual_qty,
            COALESCE(da.manpower_count, 0)      AS manpower_count,
            COALESCE(da.weather_conditions, '') AS weather_conditions,
            COALESCE(da.area_of_work, '')       AS area_of_work,
            COALESCE(da.remarks, '')            AS remarks,
            COALESCE(
                (SELECT SUM(da2.actual_qty)
                 FROM daily_actuals da2
                 WHERE da2.activity_id = pa.activity_id
                   AND da2.actual_date < CAST(:the_date AS date)
                ), 0
            ) AS cumulative_before,
            COALESCE(
                (SELECT SUM(mpe.planned_qty)
                 FROM monthly_plan_entries mpe
                 WHERE mpe.activity_id = pa.activity_id
                   AND mpe.month_date = DATE_TRUNC('month', CAST(:the_date AS date))::date
                ), 0
            ) AS month_plan_qty
        FROM plan_activities pa
        JOIN progress_plans pp ON pa.plan_id = pp.plan_id
        LEFT JOIN uom_master um ON um.uom_id  = pa.uom_id
        LEFT JOIN daily_actuals da
               ON da.activity_id = pa.activity_id
              AND da.actual_date  = CAST(:the_date AS date)
        WHERE pp.package_id = :pkg_id
          AND pp.is_locked  = TRUE
          AND pp.is_current = TRUE
          AND NOT pa.is_deleted
        ORDER BY pa.sort_order, pa.activity_id
    """), {"pkg_id": package_id, "the_date": actual_date}).mappings().all()
    return [dict(r) for r in rows]


# ─────────────────────── Upsert actuals ──────────────────────────────────────

class ActualEntry(BaseModel):
    activity_id: int
    actual_date: str
    actual_qty: float
    area_of_work: Optional[str] = None
    manpower_count: Optional[int] = None
    equipment_deployed: Optional[str] = None
    weather_conditions: Optional[str] = None
    remarks: Optional[str] = None
    entered_via: str = "web"
    location_lat: Optional[float] = None
    location_lng: Optional[float] = None


class DailySubmission(BaseModel):
    package_id: int
    entries: List[ActualEntry]


@router.post("/actuals")
def upsert_actuals(payload: DailySubmission, db: Session = Depends(get_db)):
    """Upsert daily_actuals rows — one per (activity_id, actual_date)."""
    upserted = 0
    for e in payload.entries:
        db.execute(text("""
            INSERT INTO daily_actuals
                (activity_id, actual_date, actual_qty, area_of_work,
                 manpower_count, equipment_deployed, weather_conditions,
                 remarks, entered_via, location_lat, location_lng)
            VALUES
                (:act_id, CAST(:act_date AS date), :qty, :area,
                 :manpower, :equip, :weather,
                 :remarks, :via, :lat, :lng)
            ON CONFLICT (activity_id, actual_date) DO UPDATE SET
                actual_qty         = EXCLUDED.actual_qty,
                area_of_work       = COALESCE(EXCLUDED.area_of_work,       daily_actuals.area_of_work),
                manpower_count     = COALESCE(EXCLUDED.manpower_count,     daily_actuals.manpower_count),
                equipment_deployed = COALESCE(EXCLUDED.equipment_deployed, daily_actuals.equipment_deployed),
                weather_conditions = COALESCE(EXCLUDED.weather_conditions, daily_actuals.weather_conditions),
                remarks            = COALESCE(EXCLUDED.remarks,            daily_actuals.remarks),
                entered_via        = EXCLUDED.entered_via,
                updated_at         = CURRENT_TIMESTAMP
        """), {
            "act_id":   e.activity_id,
            "act_date": e.actual_date,
            "qty":      e.actual_qty,
            "area":     e.area_of_work,
            "manpower": e.manpower_count,
            "equip":    e.equipment_deployed,
            "weather":  e.weather_conditions,
            "remarks":  e.remarks,
            "via":      e.entered_via,
            "lat":      e.location_lat,
            "lng":      e.location_lng,
        })
        upserted += 1
    db.commit()
    return {"ok": True, "upserted": upserted}


# ─────────────────────── Monthly actuals summary ─────────────────────────────

@router.get("/summary/{package_id}")
def get_monthly_summary(
    package_id: int,
    month: str = Query(..., description="YYYY-MM"),
    db: Session = Depends(get_db),
):
    """Per-activity summary for a month: month_plan / month_actual / cumulative / progress_pct."""
    year, mon = month.split("-")
    month_start = f"{year}-{mon}-01"

    rows = db.execute(text("""
        SELECT
            pa.activity_id,
            pa.activity_name,
            COALESCE(um.uom_code, '') AS uom,
            pa.scope_qty,
            pa.sort_order,
            COALESCE(
                (SELECT SUM(mpe.planned_qty)
                 FROM monthly_plan_entries mpe
                 WHERE mpe.activity_id = pa.activity_id
                   AND mpe.month_date  = CAST(:m_start AS date)
                ), 0
            ) AS month_plan,
            COALESCE(
                (SELECT SUM(da.actual_qty)
                 FROM daily_actuals da
                 WHERE da.activity_id = pa.activity_id
                   AND DATE_TRUNC('month', da.actual_date) = CAST(:m_start AS date)
                ), 0
            ) AS month_actual,
            COALESCE(
                (SELECT SUM(da2.actual_qty)
                 FROM daily_actuals da2
                 WHERE da2.activity_id = pa.activity_id
                ), 0
            ) AS cum_actual
        FROM plan_activities pa
        JOIN progress_plans pp ON pa.plan_id = pp.plan_id
        LEFT JOIN uom_master um ON um.uom_id  = pa.uom_id
        WHERE pp.package_id = :pkg_id
          AND pp.is_locked  = TRUE
          AND pp.is_current = TRUE
          AND NOT pa.is_deleted
        ORDER BY pa.sort_order, pa.activity_id
    """), {"pkg_id": package_id, "m_start": month_start}).mappings().all()

    result = []
    for r in rows:
        d = dict(r)
        scope = float(d["scope_qty"] or 0)
        d["progress_pct"] = round(float(d["cum_actual"]) / scope * 100, 1) if scope > 0 else 0.0
        result.append(d)
    return result


# ─────────────────────── Field observations ──────────────────────────────────

class ObservationCreate(BaseModel):
    package_id: int
    activity_id: Optional[int] = None
    observation_type: str = "note"
    title: Optional[str] = None
    description: str
    severity: Optional[str] = None
    weather: Optional[str] = None
    location_lat: Optional[float] = None
    location_lng: Optional[float] = None
    location_label: Optional[str] = None
    observed_by: int = 1


@router.post("/observations")
def create_observation(payload: ObservationCreate, db: Session = Depends(get_db)):
    row = db.execute(text("""
        INSERT INTO field_observations
            (package_id, activity_id, observation_type, title, description,
             severity, weather, location_lat, location_lng, location_label,
             observed_by)
        VALUES
            (:pkg_id, :act_id, :obs_type, :title, :desc,
             :severity, :weather, :lat, :lng, :label, :obs_by)
        RETURNING observation_id
    """), {
        "pkg_id":   payload.package_id,
        "act_id":   payload.activity_id,
        "obs_type": payload.observation_type,
        "title":    payload.title,
        "desc":     payload.description,
        "severity": payload.severity,
        "weather":  payload.weather,
        "lat":      payload.location_lat,
        "lng":      payload.location_lng,
        "label":    payload.location_label,
        "obs_by":   payload.observed_by,
    }).mappings().first()
    db.commit()
    return {"ok": True, "observation_id": row["observation_id"]}


@router.get("/observations/{package_id}")
def get_observations(
    package_id: int,
    limit: int = Query(50),
    db: Session = Depends(get_db),
):
    rows = db.execute(text("""
        SELECT
            fo.observation_id,
            fo.package_id,
            fo.activity_id,
            fo.observation_type,
            fo.title,
            fo.description,
            fo.severity,
            fo.weather,
            fo.location_lat,
            fo.location_lng,
            fo.location_label,
            fo.photo_urls,
            fo.is_resolved,
            fo.observed_at,
            pa.activity_name
        FROM field_observations fo
        LEFT JOIN plan_activities pa ON fo.activity_id = pa.activity_id
        WHERE fo.package_id = :pkg_id
          AND NOT fo.is_deleted
        ORDER BY fo.observed_at DESC
        LIMIT :lim
    """), {"pkg_id": package_id, "lim": limit}).mappings().all()
    return [dict(r) for r in rows]
