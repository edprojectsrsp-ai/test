from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.progress import (
    CorporateActualDaily,
    CorporatePlanActivity,
    CorporatePlanHeader,
    CorporatePlanMonthly,
)

router = APIRouter(tags=["S-Curve"])

_MONTH_LABEL = {
    1: "Jan",
    2: "Feb",
    3: "Mar",
    4: "Apr",
    5: "May",
    6: "Jun",
    7: "Jul",
    8: "Aug",
    9: "Sep",
    10: "Oct",
    11: "Nov",
    12: "Dec",
}


def _month_key(d) -> str:
    return _MONTH_LABEL.get(d.month, str(d.month))


@router.get("/{scheme_id}")
def get_s_curve_data(scheme_id: int, db: Session = Depends(get_db)):
    """
    Returns weighted planned vs actual cumulative-style curves for the active corporate plan.
    Values are computed from raw monthly rows (planned_qty / actual_qty) and activity weightage.
    """
    plan_header = (
        db.query(CorporatePlanHeader)
        .filter(
            CorporatePlanHeader.scheme_id == scheme_id,
            CorporatePlanHeader.plan_status == "Active",
        )
        .order_by(CorporatePlanHeader.version_no.desc())
        .first()
    )

    if not plan_header:
        raise HTTPException(status_code=404, detail="No active plan found for this scheme")

    plan_id = plan_header.plan_id

    planned_rows = (
        db.query(
            CorporatePlanMonthly.plan_month,
            func.sum(
                (CorporatePlanActivity.weightage / 100.0) * CorporatePlanMonthly.planned_qty
            ).label("weighted_value"),
        )
        .join(
            CorporatePlanActivity,
            CorporatePlanActivity.plan_activity_id == CorporatePlanMonthly.plan_activity_id,
        )
        .filter(CorporatePlanActivity.plan_id == plan_id)
        .group_by(CorporatePlanMonthly.plan_month)
        .order_by(CorporatePlanMonthly.plan_month)
        .all()
    )

    actual_rows = (
        db.query(
            CorporateActualDaily.entry_date,
            func.sum(
                (CorporatePlanActivity.weightage / 100.0) * CorporateActualDaily.actual_qty
            ).label("weighted_value"),
        )
        .join(
            CorporatePlanActivity,
            CorporatePlanActivity.plan_activity_id == CorporateActualDaily.plan_activity_id,
        )
        .filter(
            CorporatePlanActivity.plan_id == plan_id,
            CorporateActualDaily.scheme_id == scheme_id,
        )
        .group_by(CorporateActualDaily.entry_date)
        .order_by(CorporateActualDaily.entry_date)
        .all()
    )

    def _serialize(rows):
        out = []
        for plan_month, val in rows:
            v = float(val or 0)
            if v > 100:
                v = 100.0
            out.append({"month": _month_key(plan_month), "value": round(v, 2)})
        return out

    return {
        "planned": _serialize(planned_rows),
        "actual": _serialize(actual_rows),
    }
