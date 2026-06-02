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

    sql = text(
        """
        WITH PrevMonth AS (
            SELECT scheme_id, cumulative_progress_percent, progress_remark, scheme_status, expected_completion_date, closure_date
            FROM plant_progress_monthly WHERE progress_month = :prev_date
        ),
        CurrMonth AS (
            SELECT scheme_id, cumulative_progress_percent, progress_remark, scheme_status, expected_completion_date, closure_date
            FROM plant_progress_monthly WHERE progress_month = :curr_date
        )
        SELECT
            sm.scheme_id, sm.scheme_name, sm.total_cost, sm.start_date, sm.scheduled_completion_date,
            COALESCE(sm.expected_completion_date, sm.scheduled_completion_date) as master_expected_date,
            sm.current_status as master_status, sm.closure_date as master_closure, sm.remarks as master_remark,

            COALESCE(p.cumulative_progress_percent, 0.0) as prev_progress,
            COALESCE(p.scheme_status, 'ongoing') as prev_status,
            COALESCE(p.progress_remark, '') as prev_remark,

            c.cumulative_progress_percent as curr_progress,
            c.scheme_status as curr_status,
            c.progress_remark as curr_remark,
            c.expected_completion_date as curr_expected,
            c.closure_date as curr_closure

        FROM scheme_master sm
        LEFT JOIN PrevMonth p ON sm.scheme_id = p.scheme_id
        LEFT JOIN CurrMonth c ON sm.scheme_id = c.scheme_id
        WHERE sm.scheme_type = 'plant' AND sm.current_status IN ('ongoing', 'closed')
        ORDER BY CASE WHEN sm.current_status = 'ongoing' THEN 0 ELSE 1 END, sm.scheme_name
        """
    )

    results = db.execute(sql, {"prev_date": prev_date, "curr_date": target_date}).fetchall()

    workspace_data = []
    for r in results:
        current_progress = r.curr_progress if r.curr_progress is not None else r.prev_progress
        current_status = r.curr_status if r.curr_status is not None else r.prev_status
        current_remark = r.curr_remark if r.curr_remark is not None else r.prev_remark
        expected_date = r.curr_expected if r.curr_expected is not None else r.master_expected_date
        closure_date = r.curr_closure if r.curr_closure is not None else r.master_closure

        workspace_data.append(
            {
                "scheme_id": r.scheme_id,
                "scheme_name": r.scheme_name,
                "total_cost": r.total_cost,
                "scheduled_start": r.start_date,
                "scheduled_completion": r.scheduled_completion_date,
                "expected_completion_date": expected_date,
                "last_progress": r.prev_progress,
                "last_status_remark": f"{r.prev_status} | {r.prev_remark}",
                "current_progress": current_progress,
                "current_status": current_status,
                "current_remark": current_remark,
                "closure_date": closure_date,
                "master_status": r.master_status,
            }
        )

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
                (scheme_id, progress_month, cumulative_progress_percent, progress_remark, scheme_status, expected_completion_date, closure_date, updated_at)
                VALUES (:s_id, :p_month, :prog, :rem, :stat, :exp_date, :clos_date, CURRENT_TIMESTAMP)
                ON CONFLICT (scheme_id, progress_month)
                DO UPDATE SET
                    cumulative_progress_percent = EXCLUDED.cumulative_progress_percent,
                    progress_remark = EXCLUDED.progress_remark,
                    scheme_status = EXCLUDED.scheme_status,
                    expected_completion_date = EXCLUDED.expected_completion_date,
                    closure_date = EXCLUDED.closure_date,
                    updated_at = CURRENT_TIMESTAMP
                """
            )
            db.execute(
                upsert_progress_sql,
                {
                    "s_id": row.scheme_id,
                    "p_month": payload.progress_month,
                    "prog": row.current_progress,
                    "rem": row.current_remark,
                    "stat": row.current_status,
                    "exp_date": row.expected_completion_date,
                    "clos_date": row.closure_date,
                },
            )

            update_master_sql = text(
                """
                UPDATE scheme_master
                SET expected_completion_date = :exp_date, closure_date = :clos_date, current_status = :stat
                WHERE scheme_id = :s_id
                """
            )
            db.execute(
                update_master_sql,
                {
                    "exp_date": row.expected_completion_date,
                    "clos_date": row.closure_date,
                    "stat": row.current_status,
                    "s_id": row.scheme_id,
                },
            )

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
