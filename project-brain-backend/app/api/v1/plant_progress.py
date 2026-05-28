from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db

router = APIRouter()


# --- PYDANTIC SCHEMAS ---
class PlantGridRow(BaseModel):
    scheme_id: int
    current_progress: float
    current_status: str
    current_remark: Optional[str] = ""
    expected_completion_date: Optional[date] = None
    closure_date: Optional[date] = None
    master_status: str


class PlantWorkspaceSave(BaseModel):
    progress_month: date
    rows: List[PlantGridRow]


# --- API ENDPOINTS ---
@router.get("/workspace")
def load_plant_workspace(year: int, month: int, db: Session = Depends(get_db)):
    """
    Fetches the bulk editing grid. Pulls all ongoing/closed Plant schemes,
    and cross-references the previous month's data for the auto-carryover logic.
    """
    target_date = date(year, month, 1)

    prev_month = 12 if month == 1 else month - 1
    prev_year = year - 1 if month == 1 else year
    prev_date = date(prev_year, prev_month, 1)

    sql = text(
        """
        WITH PrevMonth AS (
            SELECT package_id, cumulative_actual_pct, notes
            FROM plant_progress_monthly WHERE month_date = :prev_date
        ),
        CurrMonth AS (
            SELECT package_id, cumulative_actual_pct, notes
            FROM plant_progress_monthly WHERE month_date = :curr_date
        )
        SELECT
            sm.scheme_id, sm.scheme_name, sm.estimated_cost_cr AS total_cost, sm.planned_start_date AS start_date, sm.planned_completion_date AS scheduled_completion_date,
            COALESCE(sm.actual_completion_date, sm.planned_completion_date) as master_expected_date,
            sm.current_status as master_status, sm.actual_completion_date as master_closure, pkg.remarks as master_remark,

            COALESCE(p.cumulative_actual_pct, 0.0) as prev_progress,
            COALESCE(p.notes, '') as prev_remark,

            c.cumulative_actual_pct as curr_progress,
            c.notes as curr_remark

        FROM scheme_master sm
        LEFT JOIN packages pkg ON pkg.scheme_id = sm.scheme_id AND NOT pkg.is_deleted AND NOT pkg.is_scheme_mirror
        LEFT JOIN PrevMonth p ON pkg.package_id = p.package_id
        LEFT JOIN CurrMonth c ON pkg.package_id = c.package_id
        WHERE sm.scheme_type = 'plant' AND sm.current_status IN ('ongoing', 'closed')
        ORDER BY CASE WHEN sm.current_status = 'ongoing' THEN 0 ELSE 1 END, sm.scheme_name
        """
    )

    results = db.execute(sql, {"prev_date": prev_date, "curr_date": target_date}).fetchall()

    workspace_data = []
    for r in results:
        current_progress = r.curr_progress if r.curr_progress is not None else r.prev_progress
        current_status = r.master_status
        current_remark = r.curr_remark if r.curr_remark is not None else (r.prev_remark or r.master_remark)
        expected_date = r.master_expected_date
        closure_date = r.master_closure

        workspace_data.append(
            {
                "scheme_id": r.scheme_id,
                "scheme_name": r.scheme_name,
                "total_cost": r.total_cost,
                "scheduled_start": r.start_date,
                "scheduled_completion": r.scheduled_completion_date,
                "expected_completion_date": expected_date,
                "last_progress": r.prev_progress,
                "last_status_remark": f"{r.master_status} | {r.prev_remark}",
                "current_progress": current_progress,
                "current_status": current_status,
                "current_remark": current_remark,
                "closure_date": closure_date,
                "master_status": r.master_status,
            }
        )

    return workspace_data


@router.post("/save-workspace")
def save_plant_workspace(payload: PlantWorkspaceSave, db: Session = Depends(get_db)):
    """The dual-transaction: Saves the progress AND updates the Scheme Master lifecycle."""
    try:
        for row in payload.rows:
            upsert_progress_sql = text(
                """
                INSERT INTO plant_progress_monthly
                (package_id, month_date, cumulative_actual_pct, notes, computed_at)
                VALUES (:pkg_id, :p_month, :prog, :rem, CURRENT_TIMESTAMP)
                ON CONFLICT (package_id, month_date)
                DO UPDATE SET
                    cumulative_actual_pct = EXCLUDED.cumulative_actual_pct,
                    notes = EXCLUDED.notes,
                    computed_at = CURRENT_TIMESTAMP
                """
            )
            db.execute(
                upsert_progress_sql,
                {
                    "pkg_id": row.scheme_id,
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
                SET planned_completion_date = :exp_date, actual_completion_date = :clos_date, current_status = :stat
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
        return {"status": "success", "message": "Bulk Plant AMR Progress saved successfully!"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

