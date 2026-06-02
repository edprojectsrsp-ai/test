"""
Plant Progress router — t5 schema (rewritten from t3).

plant_progress_monthly in t5 is keyed by (package_id, month_date) and stores
planned_progress_pct / actual_progress_pct / cumulative_planned_pct / cumulative_actual_pct / risk_level.

Endpoints:
  GET  /plant/workspace?year=&month=          — bulk-edit grid for all plant schemes
  POST /plant/save-workspace                  — upsert progress for a month
  GET  /plant/monthly-trend?package_id=       — last 12 months trend for one package
"""

from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db

router = APIRouter()


class PlantGridRow(BaseModel):
    package_id: int
    planned_pct: float = 0.0
    actual_pct: float = 0.0
    cumulative_planned_pct: float = 0.0
    cumulative_actual_pct: float = 0.0
    risk_level: str = "unknown"
    notes: Optional[str] = None


class PlantWorkspaceSave(BaseModel):
    progress_month: date       # first day of the month: YYYY-MM-01
    rows: List[PlantGridRow]


# ---------------------------------------------------------------------------
# GET /plant/workspace
# ---------------------------------------------------------------------------
@router.get("/workspace")
def load_plant_workspace(year: int, month: int, db: Session = Depends(get_db)):
    target_date = date(year, month, 1)

    prev_month = 12 if month == 1 else month - 1
    prev_year = year - 1 if month == 1 else year
    prev_date = date(prev_year, prev_month, 1)

    rows = db.execute(text("""
        SELECT
            s.scheme_id, s.scheme_name, s.scheme_type, s.current_status,
            s.estimated_cost_cr,
            s.planned_start_date, s.planned_completion_date, s.actual_completion_date,
            p.package_id, p.package_name,
            p.planned_start_date   AS pkg_start,
            p.planned_end_date     AS pkg_end,
            p.completion_date_actual AS pkg_actual_end,

            -- current month
            cur.planned_progress_pct,
            cur.actual_progress_pct,
            cur.cumulative_planned_pct,
            cur.cumulative_actual_pct,
            cur.risk_level,
            cur.notes,

            -- previous month carryover
            prev.cumulative_actual_pct  AS prev_cum_actual,
            prev.actual_progress_pct    AS prev_actual

        FROM scheme_master s
        JOIN packages p
               ON p.scheme_id = s.scheme_id AND p.is_deleted = FALSE
        LEFT JOIN plant_progress_monthly cur
               ON cur.package_id = p.package_id AND cur.month_date = :curr_date
        LEFT JOIN plant_progress_monthly prev
               ON prev.package_id = p.package_id AND prev.month_date = :prev_date
        WHERE s.scheme_type = 'plant'
          AND s.current_status IN ('ongoing', 'closed', 'under_execution')
          AND s.is_deleted = FALSE
        ORDER BY CASE WHEN s.current_status = 'ongoing' THEN 0 WHEN s.current_status = 'under_execution' THEN 1 ELSE 2 END,
                 s.scheme_name
    """), {"curr_date": target_date, "prev_date": prev_date}).fetchall()

    result = []
    for r in rows:
        result.append({
            "scheme_id": r.scheme_id,
            "scheme_name": r.scheme_name,
            "scheme_type": r.scheme_type,
            "master_status": r.current_status,
            "estimated_cost_cr": float(r.estimated_cost_cr) if r.estimated_cost_cr else None,
            "planned_start_date": r.planned_start_date.isoformat() if r.planned_start_date else None,
            "planned_completion_date": r.planned_completion_date.isoformat() if r.planned_completion_date else None,
            "actual_completion_date": r.actual_completion_date.isoformat() if r.actual_completion_date else None,
            "package_id": r.package_id,
            "package_name": r.package_name,
            "pkg_start": r.pkg_start.isoformat() if r.pkg_start else None,
            "pkg_end": r.pkg_end.isoformat() if r.pkg_end else None,
            "pkg_actual_end": r.pkg_actual_end.isoformat() if r.pkg_actual_end else None,
            # current month values (may be None if not yet entered)
            "planned_pct": float(r.planned_progress_pct) if r.planned_progress_pct is not None else 0.0,
            "actual_pct": float(r.actual_progress_pct) if r.actual_progress_pct is not None else 0.0,
            "cumulative_planned_pct": float(r.cumulative_planned_pct) if r.cumulative_planned_pct is not None else 0.0,
            "cumulative_actual_pct": float(r.cumulative_actual_pct) if r.cumulative_actual_pct is not None else 0.0,
            "risk_level": r.risk_level or "unknown",
            "notes": r.notes,
            # previous month carryover for display
            "prev_cum_actual": float(r.prev_cum_actual) if r.prev_cum_actual is not None else 0.0,
            "prev_actual": float(r.prev_actual) if r.prev_actual is not None else 0.0,
        })

    return result


# ---------------------------------------------------------------------------
# POST /plant/save-workspace
# ---------------------------------------------------------------------------
@router.post("/save-workspace")
def save_plant_workspace(payload: PlantWorkspaceSave, db: Session = Depends(get_db)):
    try:
        for row in payload.rows:
            db.execute(text("""
                INSERT INTO plant_progress_monthly
                    (package_id, month_date, planned_progress_pct, actual_progress_pct,
                     cumulative_planned_pct, cumulative_actual_pct, risk_level, notes, computed_at)
                VALUES
                    (:pkg_id, :month, :plan_pct, :act_pct,
                     :cum_plan, :cum_act, :risk, :notes, CURRENT_TIMESTAMP)
                ON CONFLICT (package_id, month_date) DO UPDATE SET
                    planned_progress_pct   = EXCLUDED.planned_progress_pct,
                    actual_progress_pct    = EXCLUDED.actual_progress_pct,
                    cumulative_planned_pct = EXCLUDED.cumulative_planned_pct,
                    cumulative_actual_pct  = EXCLUDED.cumulative_actual_pct,
                    risk_level             = EXCLUDED.risk_level,
                    notes                  = EXCLUDED.notes,
                    computed_at            = CURRENT_TIMESTAMP
            """), {
                "pkg_id": row.package_id,
                "month": payload.progress_month,
                "plan_pct": row.planned_pct,
                "act_pct": row.actual_pct,
                "cum_plan": row.cumulative_planned_pct,
                "cum_act": row.cumulative_actual_pct,
                "risk": row.risk_level,
                "notes": row.notes,
            })
        db.commit()
        return {"status": "success", "saved": len(payload.rows)}
    except Exception as e:
        db.rollback()
        raise HTTPException(500, str(e))


# ---------------------------------------------------------------------------
# GET /plant/monthly-trend?package_id=
# ---------------------------------------------------------------------------
@router.get("/monthly-trend")
def monthly_trend(package_id: int, months: int = 12, db: Session = Depends(get_db)):
    rows = db.execute(text("""
        SELECT month_date, planned_progress_pct, actual_progress_pct,
               cumulative_planned_pct, cumulative_actual_pct, risk_level
        FROM plant_progress_monthly
        WHERE package_id = :pkg_id
        ORDER BY month_date DESC
        LIMIT :lim
    """), {"pkg_id": package_id, "lim": months}).fetchall()

    return [
        {
            "month": r.month_date.isoformat(),
            "planned_pct": float(r.planned_progress_pct or 0),
            "actual_pct": float(r.actual_progress_pct or 0),
            "cumulative_planned_pct": float(r.cumulative_planned_pct or 0),
            "cumulative_actual_pct": float(r.cumulative_actual_pct or 0),
            "risk_level": r.risk_level,
        }
        for r in rows
    ]
