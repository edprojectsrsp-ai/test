from datetime import date

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.dpr import DPREntry

router = APIRouter(prefix="/dpr", tags=["DPR"])


class DPRCreate(BaseModel):
    report_date: date
    weather: str
    manpower: int
    work_done: str
    issues: str


@router.get("/{scheme_id}")
def get_dprs(scheme_id: int, db: Session = Depends(get_db)):
    """Fetch the last 30 daily reports for a scheme."""
    return (
        db.query(DPREntry)
        .filter(DPREntry.scheme_id == scheme_id)
        .order_by(DPREntry.report_date.desc())
        .limit(30)
        .all()
    )


@router.post("/{scheme_id}")
def create_or_update_dpr(scheme_id: int, dpr: DPRCreate, db: Session = Depends(get_db)):
    """Log today's DPR. If one exists for this date, update it."""
    existing = (
        db.query(DPREntry)
        .filter(
            DPREntry.scheme_id == scheme_id,
            DPREntry.report_date == dpr.report_date,
        )
        .first()
    )

    if existing:
        existing.weather = dpr.weather
        existing.manpower = dpr.manpower
        existing.work_done = dpr.work_done
        existing.issues = dpr.issues
        db.commit()
        db.refresh(existing)
        return existing

    new_dpr = DPREntry(scheme_id=scheme_id, **dpr.model_dump())
    db.add(new_dpr)
    db.commit()
    db.refresh(new_dpr)
    return new_dpr
