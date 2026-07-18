from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text
from app.core.database import get_db

router = APIRouter()


@router.get("/all")
def get_all_schemes(db: Session = Depends(get_db)):
    """
    Fetches all schemes and applies the MVP Delay Classification Logic.
    """
    try:
        sql = text("""
            SELECT
                sm.scheme_id AS id,
                sm.scheme_name,
                sm.scheme_type,
                sm.current_status AS status,
                sm.estimated_cost_cr AS total_cost,
                MAX(COALESCE(c.expected_completion_date, c.schedule_completion_date)) AS expected_completion_date,
                MAX(c.schedule_completion_date) AS scheduled_completion_date
            FROM scheme_master sm
            LEFT JOIN packages p ON p.scheme_id = sm.scheme_id AND p.is_deleted = FALSE
            LEFT JOIN contracts c ON c.package_id = p.package_id AND c.is_deleted = FALSE
            WHERE sm.is_deleted = FALSE
            GROUP BY sm.scheme_id, sm.scheme_name, sm.scheme_type, sm.current_status, sm.estimated_cost_cr
            ORDER BY
                CASE sm.current_status
                    WHEN 'ongoing' THEN 1
                    WHEN 'under_stage2' THEN 2
                    WHEN 'under_tendering' THEN 3
                    WHEN 'under_stage1' THEN 4
                    WHEN 'under_formulation' THEN 5
                    ELSE 6
                END, sm.scheme_id DESC
        """)

        results = db.execute(sql).fetchall()

        scheme_list = []
        for r in results:
            # MVP Logic: Delay Classification
            delay_status = "N/A"
            delay_days = 0

            if r.scheduled_completion_date and r.expected_completion_date:
                delta = (r.expected_completion_date - r.scheduled_completion_date).days
                if delta <= 0:
                    delay_status = "On Time"
                elif delta < 365:
                    delay_status = "Delayed < 1 Year"
                else:
                    delay_status = "Delayed > 1 Year"
                delay_days = delta

            scheme_list.append({
                "id": r.id,
                "scheme_name": r.scheme_name,
                "scheme_type": r.scheme_type if r.scheme_type else "Unknown",
                "status": r.status if r.status else "Unknown",
                "estimated_cost": float(r.total_cost) if r.total_cost else 0.0,
                "scheduled_completion": r.scheduled_completion_date.strftime("%d %b %Y") if r.scheduled_completion_date else "TBD",
                "expected_completion": r.expected_completion_date.strftime("%d %b %Y") if r.expected_completion_date else "TBD",
                "delay_status": delay_status,
                "delay_days": delay_days
            })

        return scheme_list
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
