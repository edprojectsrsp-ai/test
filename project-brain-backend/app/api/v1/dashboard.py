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
from app.services.friend_parity import archive_available, dashboard_model

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
        if archive_available(db):
            parity = dashboard_model(db)
            cards = parity["cards"]
            kpis = parity["kpis"]
            status = {row["label"]: row["value"] for row in parity["statusRows"]}
            return {
                "total_schemes": cards["totalProjects"],
                "total_cost_cr": cards["totalProjectCost"],
                "by_status": {
                    "ongoing": cards["ongoingProjects"],
                    "completed": cards["completedProjects"],
                    "dropped": cards["droppedProjects"],
                },
                "by_type": {
                    "corporate": kpis["corporateProjects"],
                    "plant": kpis["plantLevelProjects"],
                },
                "delay_summary": {
                    "on_time": status.get("On Time", 0),
                    "delay_lt_1y": status.get("Delay < 1 Year", 0),
                    "delay_gt_1y": status.get("Delay > 1 Year", 0),
                    "completed_this_fy": status.get("Completed this FY", 0),
                    # Retain old keys for older clients during rollout.
                    "minor": status.get("Delay < 1 Year", 0),
                    "moderate": 0,
                    "critical": status.get("Delay > 1 Year", 0),
                },
                "current_fy": parity["financialYear"],
                "parity": parity,
            }

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

        # Sum across all Item rows for this scheme (get most recent plan's values)
        be_row = db.execute(text("""
            SELECT
                COALESCE(SUM(v.cumulative_exp_till_last_fy), 0) AS cumulative_exp_till_last_fy,
                COALESCE(SUM(v.be_fy), 0) AS be_fy,
                COALESCE(SUM(v.re_fy), 0) AS re_fy
            FROM capex_plan_rows r
            JOIN capex_plan_header h ON h.id = r.plan_id
            JOIN capex_plan_values v ON v.plan_row_id = r.id
            WHERE r.scheme_id = :sid AND r.row_level = 'Item'
        """), {"sid": scheme_id}).first()

        # Current FY actuals for this scheme
        from datetime import date as _date
        _today = _date.today()
        _cur_fy = f"{_today.year}-{(_today.year + 1) % 100:02d}" if _today.month >= 4 else f"{_today.year - 1}-{_today.year % 100:02d}"
        actuals_sum = db.execute(text("""
            SELECT COALESCE(SUM(a.amount), 0) AS total_actuals
            FROM capex_actuals a
            JOIN capex_plan_rows r ON r.id = a.plan_row_id
            WHERE r.scheme_id = :sid AND a.fy_year = :fy
        """), {"sid": scheme_id, "fy": _cur_fy}).scalar() or 0

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


# ---------------------------------------------------------------------------
# 6. GET /scheme-detail  — project identity + contractor + stage milestones
# ---------------------------------------------------------------------------
@router.get("/scheme-detail")
def get_scheme_detail(scheme_id: int, db: Session = Depends(get_db)):
    try:
        scheme = db.execute(text("""
            SELECT scheme_id, scheme_name, scheme_type, current_status,
                   estimated_cost_cr, sanctioned_cost_cr, wbs_element, amr_no,
                   planned_start_date, planned_completion_date,
                   actual_start_date, actual_completion_date
            FROM scheme_master
            WHERE scheme_id = :sid AND is_deleted = FALSE
        """), {"sid": scheme_id}).first()

        if not scheme:
            raise HTTPException(404, "Scheme not found")

        # Latest active contract
        contract = db.execute(text("""
            SELECT c.contract_no, c.contractor_name, c.contract_value_cr,
                   c.effective_date, c.schedule_completion_date, p.package_name
            FROM contracts c
            JOIN packages p ON p.package_id = c.package_id
            WHERE p.scheme_id = :sid
              AND c.is_active = TRUE AND c.is_deleted = FALSE
            ORDER BY c.contract_id DESC LIMIT 1
        """), {"sid": scheme_id}).first()

        # Stage-1 approval milestones
        s1 = db.execute(text("""
            SELECT cod_date, corporate_pag_date, chairman_approval_date,
                   sail_board_date, sanction_date, order_date, cost_gross_cr
            FROM stage1_approvals
            WHERE scheme_id = :sid AND is_deleted = FALSE AND is_current = TRUE
            ORDER BY stage1_id DESC LIMIT 1
        """), {"sid": scheme_id}).first()

        # Stage-2 approval milestones
        s2 = db.execute(text("""
            SELECT cod_date, pag_date, chairman_approval_date,
                   sail_board_date, empowered_committee_date,
                   sanction_date, order_date, firmed_up_cost_gross_cr
            FROM stage2_approvals
            WHERE scheme_id = :sid AND is_deleted = FALSE AND is_current = TRUE
            ORDER BY stage2_id DESC LIMIT 1
        """), {"sid": scheme_id}).first()

        # Tender cycle — NIT + TOD
        tender = db.execute(text("""
            SELECT tc.nit_date, tc.tod_original_date, tc.awarded_value_cr, tc.cycle_status
            FROM tender_cycles tc
            JOIN packages p ON p.package_id = tc.package_id
            WHERE p.scheme_id = :sid AND tc.is_current = TRUE AND tc.is_deleted = FALSE
            ORDER BY tc.tender_cycle_id DESC LIMIT 1
        """), {"sid": scheme_id}).first()

        # Delay
        today = date.today()
        sched_date = None
        if contract and contract.schedule_completion_date:
            sched_date = contract.schedule_completion_date
        elif scheme.planned_completion_date:
            sched_date = scheme.planned_completion_date

        delay_days = max(0, (today - sched_date).days) if sched_date else 0
        if delay_days <= 0:
            status_key, status_text, status_color = "on_track", "On Track", "green"
        elif delay_days <= 90:
            status_key, status_text, status_color = "at_risk", "At Risk", "yellow"
        else:
            status_key, status_text, status_color = "delayed", "Delayed", "red"

        def _d(v):
            return v.isoformat() if v else None

        return {
            "scheme_id": scheme.scheme_id,
            "scheme_name": scheme.scheme_name,
            "scheme_type": scheme.scheme_type,
            "current_status": scheme.current_status,
            "estimated_cost_cr": float(scheme.estimated_cost_cr) if scheme.estimated_cost_cr else None,
            "sanctioned_cost_cr": float(scheme.sanctioned_cost_cr) if scheme.sanctioned_cost_cr else None,
            "wbs_element": scheme.wbs_element,
            "amr_no": scheme.amr_no,
            "planned_start_date": _d(scheme.planned_start_date),
            "planned_completion_date": _d(scheme.planned_completion_date),
            "actual_start_date": _d(scheme.actual_start_date),
            "contractor": contract.contractor_name if contract else None,
            "contract_no": contract.contract_no if contract else None,
            "contract_value_cr": float(contract.contract_value_cr) if contract and contract.contract_value_cr else None,
            "effective_date": _d(contract.effective_date) if contract else None,
            "schedule_completion_date": _d(contract.schedule_completion_date) if contract else None,
            "delay_days": delay_days,
            "status_key": status_key,
            "status_text": status_text,
            "status_color": status_color,
            "stage1": {
                "cod_date": _d(s1.cod_date),
                "corporate_pag_date": _d(s1.corporate_pag_date),
                "chairman_approval_date": _d(s1.chairman_approval_date),
                "sail_board_date": _d(s1.sail_board_date),
                "sanction_date": _d(s1.sanction_date),
                "order_date": _d(s1.order_date),
                "cost_gross_cr": float(s1.cost_gross_cr) if s1.cost_gross_cr else None,
            } if s1 else None,
            "stage2": {
                "cod_date": _d(s2.cod_date),
                "pag_date": _d(s2.pag_date),
                "chairman_approval_date": _d(s2.chairman_approval_date),
                "sail_board_date": _d(s2.sail_board_date),
                "empowered_committee_date": _d(s2.empowered_committee_date),
                "sanction_date": _d(s2.sanction_date),
                "order_date": _d(s2.order_date),
                "firmed_up_cost_gross_cr": float(s2.firmed_up_cost_gross_cr) if s2.firmed_up_cost_gross_cr else None,
            } if s2 else None,
            "tender": {
                "nit_date": _d(tender.nit_date),
                "tod_original_date": _d(tender.tod_original_date),
                "awarded_value_cr": float(tender.awarded_value_cr) if tender.awarded_value_cr else None,
                "cycle_status": tender.cycle_status,
            } if tender else None,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Scheme detail failed: {e}")


# ---------------------------------------------------------------------------
# 7. GET /corporate-capex  — all-schemes CAPEX summary
# ---------------------------------------------------------------------------
@router.get("/corporate-capex")
def get_corporate_capex(db: Session = Depends(get_db)):
    try:
        rows = db.execute(text("""
            SELECT
                s.scheme_id, s.scheme_name, s.scheme_type,
                COALESCE(s.sanctioned_cost_cr, s.estimated_cost_cr, 0) AS sanctioned,
                COALESCE(SUM(v.cumulative_exp_till_last_fy), 0)         AS cum_last,
                COALESCE(SUM(v.be_fy), 0)                               AS be_fy,
                COALESCE(SUM(v.re_fy), 0)                               AS re_fy,
                COALESCE((
                    SELECT SUM(a.amount)
                    FROM capex_actuals a
                    JOIN capex_plan_rows r2 ON r2.id = a.plan_row_id
                    WHERE r2.scheme_id = s.scheme_id
                ), 0) AS actuals_fy
            FROM scheme_master s
            LEFT JOIN capex_plan_rows r
                   ON r.scheme_id = s.scheme_id AND r.row_level = 'Item'
            LEFT JOIN capex_plan_header h ON h.id = r.plan_id
            LEFT JOIN capex_plan_values v ON v.plan_row_id = r.id
            WHERE s.is_deleted = FALSE
            GROUP BY s.scheme_id, s.scheme_name, s.scheme_type,
                     s.sanctioned_cost_cr, s.estimated_cost_cr
            ORDER BY s.scheme_id
        """)).fetchall()

        schemes = []
        for r in rows:
            sanctioned = float(r.sanctioned or 0)
            cum = float(r.cum_last or 0)
            be = float(r.be_fy or 0)
            re = float(r.re_fy or 0)
            act = float(r.actuals_fy or 0)
            total_spent = cum + act
            pct = round(total_spent / sanctioned * 100, 1) if sanctioned > 0 else 0.0
            schemes.append({
                "scheme_id": r.scheme_id,
                "scheme_name": r.scheme_name,
                "scheme_type": r.scheme_type,
                "sanctioned_cost_cr": round(sanctioned, 2),
                "cum_last_fy": round(cum, 2),
                "be_fy": round(be, 2),
                "re_fy": round(re, 2),
                "actuals_fy": round(act, 2),
                "total_spent": round(total_spent, 2),
                "pct_spent": pct,
                "variance_be": round(act - be, 2),
            })

        total = {
            "sanctioned_cost_cr": round(sum(x["sanctioned_cost_cr"] for x in schemes), 2),
            "cum_last_fy": round(sum(x["cum_last_fy"] for x in schemes), 2),
            "be_fy": round(sum(x["be_fy"] for x in schemes), 2),
            "re_fy": round(sum(x["re_fy"] for x in schemes), 2),
            "actuals_fy": round(sum(x["actuals_fy"] for x in schemes), 2),
            "total_spent": round(sum(x["total_spent"] for x in schemes), 2),
        }

        return {"schemes": schemes, "total": total}
    except Exception as e:
        raise HTTPException(500, f"Corporate CAPEX failed: {e}")
