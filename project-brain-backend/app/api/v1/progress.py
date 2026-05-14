from typing import List

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.progress import ProgressEntry

router = APIRouter(prefix="/progress", tags=["Progress"])


class ProgressUpdate(BaseModel):
    month: str
    planned_pct: float
    actual_pct: float


@router.get("/{scheme_id}/{fy}")
def get_progress(scheme_id: int, fy: str, db: Session = Depends(get_db)):
    """Fetch progress data for a specific scheme and financial year."""
    records = (
        db.query(ProgressEntry)
        .filter(
            ProgressEntry.scheme_id == scheme_id,
            ProgressEntry.financial_year == fy,
        )
        .all()
    )

    months = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"]

    result = []
    for month in months:
        record = next((item for item in records if item.month == month), None)
        result.append(
            {
                "month": month,
                "planned_pct": record.planned_pct if record else 0.0,
                "actual_pct": record.actual_pct if record else 0.0,
            }
        )

    return result


@router.post("/{scheme_id}/{fy}")
def update_progress(scheme_id: int, fy: str, payload: List[ProgressUpdate], db: Session = Depends(get_db)):
    """Bulk update planned and actual physical progress."""
    for item in payload:
        record = (
            db.query(ProgressEntry)
            .filter(
                ProgressEntry.scheme_id == scheme_id,
                ProgressEntry.financial_year == fy,
                ProgressEntry.month == item.month,
            )
            .first()
        )

        if record:
            record.planned_pct = item.planned_pct
            record.actual_pct = item.actual_pct
        else:
            db.add(
                ProgressEntry(
                    scheme_id=scheme_id,
                    financial_year=fy,
                    month=item.month,
                    planned_pct=item.planned_pct,
                    actual_pct=item.actual_pct,
                )
            )

    db.commit()
    return {"status": "success"}
