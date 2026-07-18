from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db

router = APIRouter()


class PlantActualPayload(BaseModel):
    scheme_id: int
    progress_month: date
    cumulative_progress_percent: float
    progress_remark: str


@router.post("/plant/save-actual")
def save_plant_actual(payload: PlantActualPayload, db: Session = Depends(get_db)):
    """MVP Logic: Ensure Plant actual is >= previous month and <= 100"""
    if payload.cumulative_progress_percent < 0 or payload.cumulative_progress_percent > 100:
        raise HTTPException(status_code=400, detail="Progress must be between 0 and 100.")

    prev_sql = text(
        """
        SELECT cumulative_actual_pct FROM plant_progress_monthly
        WHERE package_id = :pkg_id AND month_date < :p_month
        ORDER BY month_date DESC LIMIT 1
        """
    )
    prev_val = db.execute(prev_sql, {"pkg_id": payload.scheme_id, "p_month": payload.progress_month}).scalar()

    if prev_val is not None and payload.cumulative_progress_percent < float(prev_val):
        raise HTTPException(
            status_code=400,
            detail=(
                f"Actual ({payload.cumulative_progress_percent}%) cannot be less than previous month ({prev_val}%)."
            ),
        )

    upsert_sql = text(
        """
        INSERT INTO plant_progress_monthly
          (package_id, month_date, actual_progress_pct, cumulative_actual_pct, notes, computed_at)
        VALUES
          (:pkg_id, :p_month, :pct, :pct, :rem, CURRENT_TIMESTAMP)
        ON CONFLICT (package_id, month_date)
        DO UPDATE SET
          actual_progress_pct = EXCLUDED.actual_progress_pct,
          cumulative_actual_pct = EXCLUDED.cumulative_actual_pct,
          notes = EXCLUDED.notes,
          computed_at = CURRENT_TIMESTAMP
        """
    )
    db.execute(
        upsert_sql,
        {
            "pkg_id": payload.scheme_id,
            "p_month": payload.progress_month,
            "pct": payload.cumulative_progress_percent,
            "rem": payload.progress_remark,
        },
    )
    db.commit()
    return {"status": "success"}
