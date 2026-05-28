"""
Dashboard API — Sprint 4
Provides:
  GET /summary              — KPI overview (total schemes, CAPEX, delay buckets)
  GET /scheme-cards         — Per-scheme cards with delay classification
  GET /physical-financial   — 9-column physical-financial table (the core Sprint 4 feature)
  GET /capex-snapshot       — CAPEX snapshot for a single scheme
  GET /dpr-summary          — Last 5 DPR entries for a scheme
"""

from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.core.database import get_db

router = APIRouter()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _current_fy() -> str:
    today = date.today()
    if today.month >= 4:
        return f"{today.year}-{today.year + 1}"
    return f"{today.year - 1}-{today.year}"


def _fy_start(month_str: str) -> date:
    """Given 'YYYY-MM', return the April-1 that starts the FY containing that month."""
    yr, mo = int(month_str[:4]), int(month_str[5:7])
    fy_yr = yr if mo >= 4 else yr - 1
    return date(fy_yr, 4, 1)


def _first_of_month(month_str: str) -> date:
    """'YYYY-MM' → date(YYYY, MM, 1)"""
    yr, mo = int(month_str[:4]), int(month_str[5:7])
    return date(yr, mo, 1)


def _delay_category(months_late: float):
    if months_late <= 0:
        return ("on_time", "green")
    if months_late <= 3:
        return ("minor", "yellow")
    if months_late <= 6:
        return ("moderate", "orange")
    return ("critical", "red")


# ---------------------------------------------------------------------------
# 1. GET /summary
# ---------------------------------------------------------------------------
@router.get("/summary")
def get_summary(db: Session = Depends(get_db)):
    try:
        # Total schemes + CAPEX
        totals = db.execute(text("""
            SELECT
                COUNT(*) FILTER (WHERE is_deleted = FALSE)                AS total_schemes,
                COALESCE(SUM(estimated_cost_cr) FILTER (WHERE is_deleted = FALSE), 0) AS total_cost_cr
            FROM scheme_master
        """)).first()

        # By status
        by_status_rows = db.execute(text("""
            SELECT current_status, COUNT(*) AS cnt
            FROM scheme_master
            WHERE is_deleted = FALSE
            GROUP BY current_status
        """)).fetchall()
        by_status = {r.current_status: r.cnt for r in by_status_rows}

        # By type
        by_type_rows = db.execute(text("""
            SELECT scheme_type, COUNT(*) AS cnt
            FROM scheme_master
            WHERE is_deleted = FALSE
            GROUP BY scheme_type
        """)).fetchall()
        by_type = {r.scheme_type: r.cnt for r in by_type_rows}

        # Delay classification based on packages.planned_end_date
        delay_rows = db.execute(text("""
            SELECT
                (CURRENT_DATE - p.planned_end_date)::float / 30.0 AS months_late
            FROM packages p
            JOIN scheme_master s ON s.scheme_id = p.scheme_id
            WHERE p.is_deleted = FALSE
              AND s.is_deleted = FALSE
              AND p.planned_end_date IS NOT NULL
              AND s.current_status != 'closed'
        """)).fetchall()

        delay_summary = {"on_time": 0, "minor": 0, "moderate": 0, "critical": 0}
        for r in delay_rows:
            cat, _ = _delay_category(float(r.months_late or 0))
            delay_summary[cat] += 1

        return {
            "total_schemes": int(totals.total_schemes),
            "total_cost_cr": float(totals.total_cost_cr),
            "by_status": by_status,
            "by_type": by_type,
            "delay_summary": delay_summary,
            "current_fy": _current_fy(),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Summary failed: {e}")


# ---------------------------------------------------------------------------
# 2. GET /scheme-cards
# ---------------------------------------------------------------------------
@router.get("/scheme-cards")
def get_scheme_cards(db: Session = Depends(get_db)):
    try:
        rows = db.execute(text("""
            SELECT
                s.scheme_id,
                s.scheme_name,
                s.scheme_type,
                s.current_status,
                s.estimated_cost_cr,
                s.sanctioned_cost_cr,
                MIN(p.planned_start_date)   AS scheduled_start,
                MAX(p.planned_end_date)     AS scheduled_completion,
                MAX(p.completion_date_actual) AS expected_completion
            FROM scheme_master s
            LEFT JOIN packages p ON p.scheme_id = s.scheme_id AND p.is_deleted = FALSE
            WHERE s.is_deleted = FALSE
            GROUP BY s.scheme_id, s.scheme_name, s.scheme_type, s.current_status,
                     s.estimated_cost_cr, s.sanctioned_cost_cr
            ORDER BY s.scheme_id DESC
        """)).fetchall()

        cards = []
        today = date.today()
        for r in rows:
            months_late = 0.0
            if r.scheduled_completion:
                months_late = (today - r.scheduled_completion).days / 30.0
            cat, color = _delay_category(months_late)
            cards.append({
                "id": r.scheme_id,
                "name": r.scheme_name,
                "type": r.scheme_type,
                "status": r.current_status,
                "cost_cr": float(r.estimated_cost_cr) if r.estimated_cost_cr else None,
                "sanctioned_cost_cr": float(r.sanctioned_cost_cr) if r.sanctioned_cost_cr else None,
                "scheduled_completion": r.scheduled_completion.isoformat() if r.scheduled_completion else None,
                "expected_completion": r.expected_completion.isoformat() if r.expected_completion else None,
                "delay": {
                    "delay_months": round(months_late, 1),
                    "delay_category": cat,
                    "color": color,
                },
            })
        return cards
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Scheme cards failed: {e}")


# ---------------------------------------------------------------------------
# 3. GET /physical-financial  (Sprint 4 core)
# ---------------------------------------------------------------------------
@router.get("/physical-financial")
def get_physical_financial(
    scheme_id: int,
    month: Optional[str] = None,    # 'YYYY-MM'; defaults to current month
    db: Session = Depends(get_db),
):
    try:
        if not month:
            today = date.today()
            month = f"{today.year}-{today.month:02d}"

        selected_month = _first_of_month(month)
        fy_start = _fy_start(month)

        # Find all locked+current plans for this scheme's packages
        plan_rows = db.execute(text("""
            SELECT pp.plan_id, pp.package_id, p.package_name
            FROM progress_plans pp
            JOIN packages p ON p.package_id = pp.package_id
            WHERE p.scheme_id = :sid
              AND pp.is_locked = TRUE
              AND pp.is_current = TRUE
              AND pp.is_deleted = FALSE
              AND p.is_deleted = FALSE
        """), {"sid": scheme_id}).fetchall()

        if not plan_rows:
            return {
                "scheme_id": scheme_id,
                "month": month,
                "fy_start": fy_start.isoformat(),
                "has_active_plan": False,
                "activities": [],
                "total": None,
            }

        plan_ids = [r.plan_id for r in plan_rows]
        plan_id_list = ",".join(str(x) for x in plan_ids)

        # Get all leaf (non-category) activities for these plans
        activities = db.execute(text(f"""
            SELECT
                pa.activity_id,
                pa.activity_name,
                pa.scope_qty,
                pa.weight_pct,
                pa.actuals_till_last_fy,
                pp.package_id,
                pkg.package_name
            FROM plan_activities pa
            JOIN progress_plans pp ON pp.plan_id = pa.plan_id
            JOIN packages pkg ON pkg.package_id = pp.package_id
            WHERE pa.plan_id IN ({plan_id_list})
              AND pa.is_deleted = FALSE
            ORDER BY pp.package_id, pa.sort_order, pa.activity_id
        """)).fetchall()

        if not activities:
            return {
                "scheme_id": scheme_id,
                "month": month,
                "has_active_plan": True,
                "activities": [],
                "total": None,
            }

        act_ids = [a.activity_id for a in activities]
        act_id_list = ",".join(str(x) for x in act_ids)

        # MTD Plan: monthly_plan_entries for exactly selected_month
        mtd_plan_rows = db.execute(text(f"""
            SELECT activity_id, COALESCE(SUM(planned_qty), 0) AS qty
            FROM monthly_plan_entries
            WHERE activity_id IN ({act_id_list})
              AND month_date = :mo
              AND row_type = 'plan'
            GROUP BY activity_id
        """), {"mo": selected_month.isoformat()}).fetchall()
        mtd_plan = {r.activity_id: float(r.qty) for r in mtd_plan_rows}

        # FY Plan: monthly_plan_entries from fy_start to selected_month
        fy_plan_rows = db.execute(text(f"""
            SELECT activity_id, COALESCE(SUM(planned_qty), 0) AS qty
            FROM monthly_plan_entries
            WHERE activity_id IN ({act_id_list})
              AND month_date >= :fy_start
              AND month_date <= :mo
              AND row_type = 'plan'
            GROUP BY activity_id
        """), {"fy_start": fy_start.isoformat(), "mo": selected_month.isoformat()}).fetchall()
        fy_plan = {r.activity_id: float(r.qty) for r in fy_plan_rows}

        # MTD Actual: daily_actuals for the selected month
        mtd_act_rows = db.execute(text(f"""
            SELECT activity_id, COALESCE(SUM(actual_qty), 0) AS qty
            FROM daily_actuals
            WHERE activity_id IN ({act_id_list})
              AND DATE_TRUNC('month', actual_date)::date = :mo
            GROUP BY activity_id
        """), {"mo": selected_month.isoformat()}).fetchall()
        mtd_act = {r.activity_id: float(r.qty) for r in mtd_act_rows}

        # FY Actual: daily_actuals from fy_start to end of selected month
        import calendar
        last_day = calendar.monthrange(selected_month.year, selected_month.month)[1]
        fy_end_date = date(selected_month.year, selected_month.month, last_day)

        fy_act_rows = db.execute(text(f"""
            SELECT activity_id, COALESCE(SUM(actual_qty), 0) AS qty
            FROM daily_actuals
            WHERE activity_id IN ({act_id_list})
              AND actual_date >= :fy_start
              AND actual_date <= :fy_end
            GROUP BY activity_id
        """), {"fy_start": fy_start.isoformat(), "fy_end": fy_end_date.isoformat()}).fetchall()
        fy_act = {r.activity_id: float(r.qty) for r in fy_act_rows}

        # Build result rows
        result_activities = []
        totals = {
            "scope": 0.0, "till_last_fy": 0.0,
            "mtd_plan": 0.0, "mtd_act": 0.0,
            "fy_plan": 0.0, "fy_act": 0.0,
            "cum_plan": 0.0, "cum_act": 0.0,
        }

        for a in activities:
            aid = a.activity_id
            till_lfy = float(a.actuals_till_last_fy or 0)
            m_plan = mtd_plan.get(aid, 0.0)
            m_act = mtd_act.get(aid, 0.0)
            f_plan = fy_plan.get(aid, 0.0)
            f_act = fy_act.get(aid, 0.0)
            c_plan = till_lfy + f_plan
            c_act = till_lfy + f_act

            scope = float(a.scope_qty or 0)
            deviation = round(c_act - c_plan, 4)

            result_activities.append({
                "activity_id": aid,
                "activity_name": a.activity_name,
                "package_name": a.package_name,
                "scope": round(scope, 4),
                "till_last_fy": round(till_lfy, 4),
                "mtd_plan": round(m_plan, 4),
                "mtd_act": round(m_act, 4),
                "fy_plan": round(f_plan, 4),
                "fy_act": round(f_act, 4),
                "cum_plan": round(c_plan, 4),
                "cum_act": round(c_act, 4),
                "deviation": deviation,
                "deviation_pct": round((deviation / scope * 100) if scope > 0 else 0, 2),
            })

            totals["scope"] += scope
            totals["till_last_fy"] += till_lfy
            totals["mtd_plan"] += m_plan
            totals["mtd_act"] += m_act
            totals["fy_plan"] += f_plan
            totals["fy_act"] += f_act
            totals["cum_plan"] += c_plan
            totals["cum_act"] += c_act

        totals = {k: round(v, 4) for k, v in totals.items()}
        totals["deviation"] = round(totals["cum_act"] - totals["cum_plan"], 4)

        return {
            "scheme_id": scheme_id,
            "month": month,
            "fy_start": fy_start.isoformat(),
            "has_active_plan": True,
            "activities": result_activities,
            "total": totals,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Physical-financial failed: {e}")


# ---------------------------------------------------------------------------
# 4. GET /capex-snapshot
# ---------------------------------------------------------------------------
@router.get("/capex-snapshot")
def get_capex_snapshot(scheme_id: int, db: Session = Depends(get_db)):
    try:
        # Sanctioned cost from scheme_master
        scheme = db.execute(text("""
            SELECT sanctioned_cost_cr, estimated_cost_cr, scheme_name
            FROM scheme_master WHERE scheme_id = :sid
        """), {"sid": scheme_id}).first()

        if not scheme:
            raise HTTPException(status_code=404, detail="Scheme not found")

        # Get the most recent BE plan row for this scheme
        be_row = db.execute(text("""
            SELECT v.cumulative_exp_till_last_fy, v.be_fy, v.re_fy
            FROM capex_plan_rows r
            JOIN capex_plan_header h ON h.id = r.plan_id
            JOIN capex_plan_values v ON v.plan_row_id = r.id
            WHERE r.scheme_id = :sid
              AND r.row_level = 'Item'
            ORDER BY h.id DESC
            LIMIT 1
        """), {"sid": scheme_id}).first()

        # Sum actuals for this scheme
        actuals_sum = db.execute(text("""
            SELECT COALESCE(SUM(a.amount), 0) AS total_actuals
            FROM capex_actuals a
            JOIN capex_plan_rows r ON r.id = a.plan_row_id
            WHERE r.scheme_id = :sid
        """), {"sid": scheme_id}).scalar() or 0

        cum_last = float(be_row.cumulative_exp_till_last_fy) if be_row and be_row.cumulative_exp_till_last_fy else 0.0
        be_fy = float(be_row.be_fy) if be_row and be_row.be_fy else 0.0
        re_fy = float(be_row.re_fy) if be_row and be_row.re_fy else 0.0
        actuals_fy = float(actuals_sum)
        sanctioned = float(scheme.sanctioned_cost_cr or scheme.estimated_cost_cr or 0)
        pct_spent = round((cum_last + actuals_fy) / sanctioned * 100, 2) if sanctioned > 0 else 0

        return {
            "scheme_id": scheme_id,
            "scheme_name": scheme.scheme_name,
            "sanctioned_cost_cr": round(sanctioned, 4),
            "expenditure_till_last_fy": round(cum_last, 4),
            "be_current_fy": round(be_fy, 4),
            "re_current_fy": round(re_fy, 4),
            "actuals_current_fy": round(actuals_fy, 4),
            "total_spent": round(cum_last + actuals_fy, 4),
            "pct_spent": pct_spent,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"CAPEX snapshot failed: {e}")


# ---------------------------------------------------------------------------
# 5. GET /dpr-summary
# ---------------------------------------------------------------------------
@router.get("/dpr-summary")
def get_dpr_summary(scheme_id: int, limit: int = 5, db: Session = Depends(get_db)):
    try:
        rows = db.execute(text("""
            SELECT
                da.actual_date,
                pa.activity_name,
                da.area_of_work,
                da.remarks,
                da.weather_conditions,
                da.actual_qty,
                pkg.package_name
            FROM daily_actuals da
            JOIN plan_activities pa ON pa.activity_id = da.activity_id
            JOIN progress_plans pp ON pp.plan_id = pa.plan_id
            JOIN packages pkg ON pkg.package_id = pp.package_id
            WHERE pkg.scheme_id = :sid
            ORDER BY da.actual_date DESC, da.daily_actual_id DESC
            LIMIT :lim
        """), {"sid": scheme_id, "lim": limit}).fetchall()

        return [
            {
                "date": r.actual_date.isoformat() if r.actual_date else None,
                "activity_name": r.activity_name,
                "package_name": r.package_name,
                "area_of_work": r.area_of_work,
                "actual_qty": float(r.actual_qty or 0),
                "remarks": r.remarks,
                "weather": r.weather_conditions,
            }
            for r in rows
        ]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DPR summary failed: {e}")
