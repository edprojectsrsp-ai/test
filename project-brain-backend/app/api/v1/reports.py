from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.progress import (
    CorporateActualDaily,
    CorporatePlanActivity,
    CorporatePlanHeader,
    CorporatePlanMonthly,
)

router = APIRouter()


def _month_label(month_date):
    return month_date.strftime("%b-%y") if month_date else ""


@router.get("/s-curve/{scheme_id}")
def get_s_curve(scheme_id: int, db: Session = Depends(get_db)):
    planned_rows = (
        db.query(
            CorporatePlanMonthly.plan_month.label("month_date"),
            func.sum(CorporatePlanMonthly.planned_qty).label("val"),
        )
        .join(
            CorporatePlanActivity,
            CorporatePlanActivity.plan_activity_id == CorporatePlanMonthly.plan_activity_id,
        )
        .join(
            CorporatePlanHeader,
            CorporatePlanHeader.plan_id == CorporatePlanActivity.plan_id,
        )
        .filter(CorporatePlanHeader.scheme_id == scheme_id)
        .group_by(CorporatePlanMonthly.plan_month)
        .all()
    )

    actual_rows = (
        db.query(
            CorporateActualDaily.entry_date.label("month_date"),
            func.sum(CorporateActualDaily.actual_qty).label("val"),
        )
        .filter(CorporateActualDaily.scheme_id == scheme_id)
        .group_by(CorporateActualDaily.entry_date)
        .all()
    )

    month_data = {}
    for month_date, value in planned_rows:
        month_data.setdefault(month_date, {"month_label": _month_label(month_date), "planned": 0, "actual": 0})
        month_data[month_date]["planned"] = float(value or 0)

    for month_date, value in actual_rows:
        month_data.setdefault(month_date, {"month_label": _month_label(month_date), "planned": 0, "actual": 0})
        month_data[month_date]["actual"] = float(value or 0)

    return [month_data[key] for key in sorted(month_data)]
