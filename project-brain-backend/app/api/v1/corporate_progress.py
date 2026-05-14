from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db

router = APIRouter()


class ActivityData(BaseModel):
    name: str
    uom: str
    scope: float
    weightage: float
    months: dict[str, float]


class PlanCreateRequest(BaseModel):
    scheme_id: int
    fy_year: str
    plan_name: str
    revision_number: str
    effective_month: str
    plan_status: str
    activities: list[ActivityData]


@router.post("/create")
def create_corporate_plan(payload: PlanCreateRequest, db: Session = Depends(get_db)):
    try:
        effective_month_map = {
            "Apr": "04",
            "April": "04",
            "May": "05",
            "Jun": "06",
            "June": "06",
            "Jul": "07",
            "July": "07",
            "Aug": "08",
            "August": "08",
            "Sep": "09",
            "September": "09",
            "Oct": "10",
            "October": "10",
            "Nov": "11",
            "November": "11",
            "Dec": "12",
            "December": "12",
            "Jan": "01",
            "January": "01",
            "Feb": "02",
            "February": "02",
            "Mar": "03",
            "March": "03",
        }
        eff_mm = effective_month_map.get(payload.effective_month)
        if not eff_mm:
            raise HTTPException(status_code=400, detail="Invalid effective_month value.")

        header_sql = text(
            """
            INSERT INTO corporate_plan_header
            (scheme_id, plan_name, financial_year, is_active, plan_status, version_no, effective_month)
            VALUES (:s_id, :name, :fy, true, :status, 1, :eff_month)
            RETURNING plan_id
            """
        )

        res = db.execute(
            header_sql,
            {
                "s_id": payload.scheme_id,
                "name": payload.plan_name,
                "fy": payload.fy_year,
                "status": payload.plan_status,
                "eff_month": f"2026-{eff_mm}-01",
            },
        )
        plan_id = res.scalar()

        for act in payload.activities:
            act_sql = text(
                """
                INSERT INTO corporate_plan_activities
                (plan_id, activity_name, uom, scope, weightage)
                VALUES (:p_id, :name, :uom, :scope, :weight)
                RETURNING plan_activity_id
                """
            )
            act_res = db.execute(
                act_sql,
                {
                    "p_id": plan_id,
                    "name": act.name,
                    "uom": act.uom,
                    "scope": act.scope,
                    "weight": act.weightage,
                },
            )
            act_id = act_res.scalar()

            for month_name, qty in act.months.items():
                if qty > 0:
                    month_sql = text(
                        """
                        INSERT INTO corporate_plan_monthly
                        (plan_id, plan_activity_id, plan_month, planned_qty)
                        VALUES (:p_id, :a_id, :m_date, :qty)
                        """
                    )
                    month_map = {
                        "Apr": "04",
                        "May": "05",
                        "Jun": "06",
                        "Jul": "07",
                        "Aug": "08",
                        "Sep": "09",
                        "Oct": "10",
                        "Nov": "11",
                        "Dec": "12",
                        "Jan": "01",
                        "Feb": "02",
                        "Mar": "03",
                    }
                    year = (
                        "2026"
                        if month_name
                        in ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
                        else "2027"
                    )

                    db.execute(
                        month_sql,
                        {
                            "p_id": plan_id,
                            "a_id": act_id,
                            "m_date": f"{year}-{month_map[month_name]}-01",
                            "qty": float(qty),
                        },
                    )

        db.commit()
        return {
            "status": "success",
            "message": f"Plan saved as {payload.plan_status}!",
            "plan_id": plan_id,
        }

    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
