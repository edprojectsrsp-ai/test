"""
Project Brain — Plan Engine API Router (GOD MODE v2.1)
Sprint 2: Master Plan Engine

Handles:
  - Progress plans (create / lock / supersede)
  - Plan activities (rows in the planner grid)
  - Monthly plan entries (the actual cells of the planner grid)
  - Daily actuals submission (site-engineer entry)
  - Calculation engine: planned %, actual %, deviation per package & per scheme

Place at: project-brain-backend/app/api/v1/plan_engine.py
"""

from datetime import date, datetime, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text, and_, func
from app.core.database import get_db

router = APIRouter()


# ============================================================================
# HELPER UTILITIES
# ============================================================================
def _date(d):
    return d.isoformat() if d else None


def _num(n):
    return float(n) if n is not None else None


def _month_range(start: date, end: date):
    """Yield first-of-month dates from start to end inclusive."""
    if not start or not end:
        return
    cur = date(start.year, start.month, 1)
    end_m = date(end.year, end.month, 1)
    while cur <= end_m:
        yield cur
        # advance one month
        if cur.month == 12:
            cur = date(cur.year + 1, 1, 1)
        else:
            cur = date(cur.year, cur.month + 1, 1)


# ============================================================================
# 1) GET /packages/{package_id}/plans  → list all plans for a package
# ============================================================================
@router.get("/packages/{package_id}/plans")
def list_plans(package_id: int, db: Session = Depends(get_db)):
    """Return all progress plans for a package, with activity counts."""
    sql = text("""
        SELECT
            pp.progress_plan_id,
            pp.package_id,
            pp.plan_name,
            pp.plan_version,
            pp.financial_year,
            pp.plan_status,
            pp.is_locked,
            pp.contract_start_month,
            pp.expected_completion_month,
            pp.effective_month,
            pp.created_at,
            pp.locked_at,
            COUNT(pa.plan_activity_id) AS activity_count,
            COALESCE(SUM(pa.weightage), 0) AS total_weightage
        FROM progress_plans pp
        LEFT JOIN plan_activities pa ON pa.progress_plan_id = pp.progress_plan_id
        WHERE pp.package_id = :pkg_id
        GROUP BY pp.progress_plan_id
        ORDER BY pp.created_at DESC
    """)
    rows = db.execute(sql, {"pkg_id": package_id}).fetchall()

    return [{
        "progress_plan_id": r.progress_plan_id,
        "package_id": r.package_id,
        "plan_name": r.plan_name,
        "plan_version": r.plan_version,
        "financial_year": r.financial_year,
        "plan_status": r.plan_status,
        "is_locked": r.is_locked,
        "contract_start_month": _date(r.contract_start_month),
        "expected_completion_month": _date(r.expected_completion_month),
        "effective_month": _date(r.effective_month),
        "created_at": _date(r.created_at) if r.created_at else None,
        "locked_at": _date(r.locked_at) if r.locked_at else None,
        "activity_count": r.activity_count or 0,
        "total_weightage": float(r.total_weightage or 0),
        "weightage_ok": abs(float(r.total_weightage or 0) - 100.0) < 0.01,
    } for r in rows]


# ============================================================================
# 2) POST /packages/{package_id}/plans  → create a new plan
# ============================================================================
@router.post("/packages/{package_id}/plans")
def create_plan(package_id: int, data: dict, db: Session = Depends(get_db)):
    """Create a new progress plan for a package."""
    try:
        # Auto-increment plan_version
        max_v = db.execute(
            text("SELECT COALESCE(MAX(plan_version), 0) FROM progress_plans WHERE package_id = :pid"),
            {"pid": package_id}
        ).scalar()

        plan_name = data.get("plan_name") or f"Plan v{int(max_v) + 1}"

        sql = text("""
            INSERT INTO progress_plans (
                package_id, plan_name, plan_version, financial_year, plan_status,
                contract_start_month, expected_completion_month, effective_month,
                created_by, created_at
            ) VALUES (
                :pid, :name, :ver, :fy, 'draft',
                :start_m, :end_m, :eff_m,
                :uid, CURRENT_TIMESTAMP
            )
            RETURNING progress_plan_id
        """)
        result = db.execute(sql, {
            "pid": package_id,
            "name": plan_name,
            "ver": int(max_v) + 1,
            "fy": data.get("financial_year"),
            "start_m": data.get("contract_start_month"),
            "end_m": data.get("expected_completion_month"),
            "eff_m": data.get("effective_month") or data.get("contract_start_month"),
            "uid": 1,
        })
        new_id = result.scalar()
        db.commit()

        return {"progress_plan_id": new_id, "plan_name": plan_name, "plan_version": int(max_v) + 1}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Plan creation failed: {e}")


# ============================================================================
# 3) GET /plans/{plan_id}/full  → full planner grid (activities + monthly + actuals)
# ============================================================================
@router.get("/plans/{plan_id}/full")
def get_plan_full(plan_id: int, db: Session = Depends(get_db)):
    """
    Returns full planner grid:
      - plan header
      - activities (rows)
      - monthly columns
      - monthly_plan_entries (cells)
      - daily actuals aggregated by activity-month (filled-in cells)
    """
    # ---- 1. plan header ----
    header_sql = text("""
        SELECT progress_plan_id, package_id, plan_name, plan_version,
               financial_year, plan_status, is_locked,
               contract_start_month, expected_completion_month, effective_month,
               created_at, locked_at
        FROM progress_plans
        WHERE progress_plan_id = :pid
    """)
    h = db.execute(header_sql, {"pid": plan_id}).first()
    if not h:
        raise HTTPException(status_code=404, detail="Plan not found")

    # ---- 2. activities ----
    act_sql = text("""
        SELECT plan_activity_id, activity_name, uom, scope_qty, weightage,
               actuals_till_last_fy, activity_start_date, activity_finish_date,
               display_order
        FROM plan_activities
        WHERE progress_plan_id = :pid
        ORDER BY display_order, plan_activity_id
    """)
    activities = db.execute(act_sql, {"pid": plan_id}).fetchall()

    # ---- 3. month columns from plan range ----
    months = []
    if h.contract_start_month and h.expected_completion_month:
        months = [m.isoformat() for m in _month_range(h.contract_start_month, h.expected_completion_month)]

    # ---- 4. monthly planned cells ----
    mp_sql = text("""
        SELECT plan_activity_id, plan_month, planned_qty
        FROM monthly_plan_entries
        WHERE plan_activity_id IN (
            SELECT plan_activity_id FROM plan_activities WHERE progress_plan_id = :pid
        )
    """)
    monthly_cells = {}
    for row in db.execute(mp_sql, {"pid": plan_id}).fetchall():
        key = f"{row.plan_activity_id}|{row.plan_month.isoformat()}"
        monthly_cells[key] = float(row.planned_qty or 0)

    # ---- 5. actuals aggregated to month ----
    act_sum_sql = text("""
        SELECT
            plan_activity_id,
            DATE_TRUNC('month', actual_date)::date AS actual_month,
            SUM(actual_qty) AS month_actual
        FROM daily_actuals
        WHERE plan_activity_id IN (
            SELECT plan_activity_id FROM plan_activities WHERE progress_plan_id = :pid
        )
        GROUP BY plan_activity_id, DATE_TRUNC('month', actual_date)
    """)
    actual_cells = {}
    for row in db.execute(act_sum_sql, {"pid": plan_id}).fetchall():
        key = f"{row.plan_activity_id}|{row.actual_month.isoformat()}"
        actual_cells[key] = float(row.month_actual or 0)

    return {
        "header": {
            "progress_plan_id": h.progress_plan_id,
            "package_id": h.package_id,
            "plan_name": h.plan_name,
            "plan_version": h.plan_version,
            "financial_year": h.financial_year,
            "plan_status": h.plan_status,
            "is_locked": h.is_locked,
            "contract_start_month": _date(h.contract_start_month),
            "expected_completion_month": _date(h.expected_completion_month),
            "effective_month": _date(h.effective_month),
            "created_at": _date(h.created_at) if h.created_at else None,
            "locked_at": _date(h.locked_at) if h.locked_at else None,
        },
        "activities": [{
            "plan_activity_id": a.plan_activity_id,
            "activity_name": a.activity_name,
            "uom": a.uom,
            "scope_qty": float(a.scope_qty or 0),
            "weightage": float(a.weightage or 0),
            "actuals_till_last_fy": float(a.actuals_till_last_fy or 0),
            "activity_start_date": _date(a.activity_start_date),
            "activity_finish_date": _date(a.activity_finish_date),
            "display_order": a.display_order or 0,
        } for a in activities],
        "months": months,
        "monthly_cells": monthly_cells,
        "actual_cells": actual_cells,
    }


# ============================================================================
# 4) POST /plans/{plan_id}/activities  → add an activity row
# ============================================================================
@router.post("/plans/{plan_id}/activities")
def add_activity(plan_id: int, data: dict, db: Session = Depends(get_db)):
    try:
        plan = db.execute(
            text("SELECT package_id, is_locked FROM progress_plans WHERE progress_plan_id = :pid"),
            {"pid": plan_id}
        ).first()
        if not plan:
            raise HTTPException(status_code=404, detail="Plan not found")
        if plan.is_locked:
            raise HTTPException(status_code=403, detail="Plan is locked. Create a new version.")

        # Auto display_order
        max_order = db.execute(
            text("SELECT COALESCE(MAX(display_order), 0) FROM plan_activities WHERE progress_plan_id = :pid"),
            {"pid": plan_id}
        ).scalar()

        sql = text("""
            INSERT INTO plan_activities (
                progress_plan_id, package_id, activity_name, uom, scope_qty,
                weightage, actuals_till_last_fy, activity_start_date,
                activity_finish_date, display_order
            ) VALUES (
                :pid, :pkg, :name, :uom, :qty, :wt, :last_fy, :start, :finish, :order
            )
            RETURNING plan_activity_id
        """)
        new_id = db.execute(sql, {
            "pid": plan_id,
            "pkg": plan.package_id,
            "name": data.get("activity_name", "New Activity"),
            "uom": data.get("uom", "Nos"),
            "qty": data.get("scope_qty", 0),
            "wt": data.get("weightage", 10),
            "last_fy": data.get("actuals_till_last_fy", 0),
            "start": data.get("activity_start_date"),
            "finish": data.get("activity_finish_date"),
            "order": int(max_order) + 10,
        }).scalar()
        db.commit()
        return {"plan_activity_id": new_id}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Add activity failed: {e}")


# ============================================================================
# 5) PUT /activities/{activity_id}  → update activity row
# ============================================================================
@router.put("/activities/{activity_id}")
def update_activity(activity_id: int, data: dict, db: Session = Depends(get_db)):
    try:
        # check lock
        lock = db.execute(text("""
            SELECT pp.is_locked
            FROM plan_activities pa
            JOIN progress_plans pp ON pp.progress_plan_id = pa.progress_plan_id
            WHERE pa.plan_activity_id = :id
        """), {"id": activity_id}).scalar()
        if lock:
            raise HTTPException(status_code=403, detail="Plan is locked")

        updatable = [
            "activity_name", "uom", "scope_qty", "weightage",
            "actuals_till_last_fy", "activity_start_date",
            "activity_finish_date", "display_order"
        ]
        sets = []
        params = {"id": activity_id}
        for k in updatable:
            if k in data:
                sets.append(f"{k} = :{k}")
                params[k] = data[k]
        if not sets:
            return {"ok": True, "noop": True}

        db.execute(text(f"UPDATE plan_activities SET {', '.join(sets)} WHERE plan_activity_id = :id"), params)
        db.commit()
        return {"ok": True, "plan_activity_id": activity_id}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Update activity failed: {e}")


# ============================================================================
# 6) DELETE /activities/{activity_id}
# ============================================================================
@router.delete("/activities/{activity_id}")
def delete_activity(activity_id: int, db: Session = Depends(get_db)):
    try:
        lock = db.execute(text("""
            SELECT pp.is_locked
            FROM plan_activities pa
            JOIN progress_plans pp ON pp.progress_plan_id = pa.progress_plan_id
            WHERE pa.plan_activity_id = :id
        """), {"id": activity_id}).scalar()
        if lock:
            raise HTTPException(status_code=403, detail="Plan is locked")

        db.execute(text("DELETE FROM plan_activities WHERE plan_activity_id = :id"), {"id": activity_id})
        db.commit()
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Delete activity failed: {e}")


# ============================================================================
# 7) PUT /plans/{plan_id}/cells  → bulk update monthly_plan_entries
# ============================================================================
@router.put("/plans/{plan_id}/cells")
def update_cells(plan_id: int, data: dict, db: Session = Depends(get_db)):
    """
    Bulk update planner grid cells.
    Payload: { cells: [ {plan_activity_id, plan_month: "YYYY-MM-01", planned_qty: float}, ... ] }
    Upserts each cell.
    """
    try:
        plan = db.execute(
            text("SELECT package_id, is_locked FROM progress_plans WHERE progress_plan_id = :pid"),
            {"pid": plan_id}
        ).first()
        if not plan:
            raise HTTPException(status_code=404, detail="Plan not found")
        if plan.is_locked:
            raise HTTPException(status_code=403, detail="Plan is locked. Create a new version to edit.")

        cells = data.get("cells", [])
        if not isinstance(cells, list):
            raise HTTPException(status_code=400, detail="`cells` must be a list")

        upsert_sql = text("""
            INSERT INTO monthly_plan_entries (plan_activity_id, package_id, plan_month, planned_qty)
            VALUES (:aid, :pkg, :month, :qty)
            ON CONFLICT (plan_activity_id, plan_month)
            DO UPDATE SET planned_qty = EXCLUDED.planned_qty
        """)
        written = 0
        for c in cells:
            qty = float(c.get("planned_qty") or 0)
            db.execute(upsert_sql, {
                "aid": c["plan_activity_id"],
                "pkg": plan.package_id,
                "month": c["plan_month"],
                "qty": qty,
            })
            written += 1

        db.commit()
        return {"ok": True, "cells_written": written}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Update cells failed: {e}")


# ============================================================================
# 8) POST /plans/{plan_id}/lock  → lock the plan as baseline
# ============================================================================
@router.post("/plans/{plan_id}/lock")
def lock_plan(plan_id: int, db: Session = Depends(get_db)):
    """Lock a plan. Validates weightages sum to 100."""
    try:
        total_wt = db.execute(
            text("SELECT COALESCE(SUM(weightage), 0) FROM plan_activities WHERE progress_plan_id = :pid"),
            {"pid": plan_id}
        ).scalar()

        if abs(float(total_wt or 0) - 100.0) > 0.01:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot lock: weightages sum to {total_wt}, not 100"
            )

        db.execute(text("""
            UPDATE progress_plans
            SET is_locked = TRUE,
                plan_status = 'locked',
                locked_at = CURRENT_TIMESTAMP,
                locked_by = 1
            WHERE progress_plan_id = :pid
        """), {"pid": plan_id})
        db.commit()
        return {"ok": True, "is_locked": True, "locked_at": datetime.utcnow().isoformat()}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Lock failed: {e}")


# ============================================================================
# 9) POST /plans/{plan_id}/unlock  → admin re-open
# ============================================================================
@router.post("/plans/{plan_id}/unlock")
def unlock_plan(plan_id: int, db: Session = Depends(get_db)):
    try:
        db.execute(text("""
            UPDATE progress_plans
            SET is_locked = FALSE, plan_status = 'draft', locked_at = NULL, locked_by = NULL
            WHERE progress_plan_id = :pid
        """), {"pid": plan_id})
        db.commit()
        return {"ok": True, "is_locked": False}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# 10) POST /activities/{activity_id}/daily-actual  → site engineer entry
# ============================================================================
@router.post("/activities/{activity_id}/daily-actual")
def add_daily_actual(activity_id: int, data: dict, db: Session = Depends(get_db)):
    """Site engineer enters today's actual quantity."""
    try:
        # Get package_id
        pkg = db.execute(
            text("SELECT package_id FROM plan_activities WHERE plan_activity_id = :id"),
            {"id": activity_id}
        ).scalar()
        if not pkg:
            raise HTTPException(status_code=404, detail="Activity not found")

        sql = text("""
            INSERT INTO daily_actuals (plan_activity_id, package_id, actual_date, actual_qty, remarks, submitted_by)
            VALUES (:aid, :pkg, :dt, :qty, :rmk, :uid)
            RETURNING daily_actual_id
        """)
        new_id = db.execute(sql, {
            "aid": activity_id,
            "pkg": pkg,
            "dt": data.get("actual_date", date.today().isoformat()),
            "qty": float(data.get("actual_qty", 0)),
            "rmk": data.get("remarks"),
            "uid": 1,
        }).scalar()
        db.commit()
        return {"daily_actual_id": new_id, "ok": True}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Daily actual failed: {e}")


# ============================================================================
# 11) GET /packages/{package_id}/progress  → calculation engine
# ============================================================================
@router.get("/packages/{package_id}/progress")
def get_package_progress(package_id: int, as_of: Optional[str] = None, db: Session = Depends(get_db)):
    """
    The MOS calculation engine.
    For the active locked plan, returns:
      - planned %    = weighted sum of (planned-to-date / scope_qty)
      - actual %     = weighted sum of (actuals-to-date / scope_qty)
      - deviation    = planned - actual
      - per-activity breakdown
    """
    as_of_date = date.fromisoformat(as_of) if as_of else date.today()

    # Find active locked plan
    plan = db.execute(text("""
        SELECT progress_plan_id, plan_name, plan_version
        FROM progress_plans
        WHERE package_id = :pid AND is_locked = TRUE AND plan_status = 'locked'
        ORDER BY plan_version DESC LIMIT 1
    """), {"pid": package_id}).first()

    if not plan:
        return {
            "package_id": package_id,
            "has_active_plan": False,
            "message": "No locked plan for this package",
            "planned_pct": 0, "actual_pct": 0, "deviation_pct": 0,
            "activities": [],
        }

    # Per-activity: planned and actual qty as of date
    sql = text("""
        SELECT
            pa.plan_activity_id, pa.activity_name, pa.uom,
            pa.scope_qty, pa.weightage, pa.actuals_till_last_fy,
            COALESCE((
                SELECT SUM(planned_qty) FROM monthly_plan_entries
                WHERE plan_activity_id = pa.plan_activity_id
                  AND plan_month <= :as_of
            ), 0) AS planned_qty_to_date,
            COALESCE((
                SELECT SUM(actual_qty) FROM daily_actuals
                WHERE plan_activity_id = pa.plan_activity_id
                  AND actual_date <= :as_of
            ), 0) AS actual_qty_to_date
        FROM plan_activities pa
        WHERE pa.progress_plan_id = :pid
        ORDER BY pa.display_order
    """)
    rows = db.execute(sql, {"pid": plan.progress_plan_id, "as_of": as_of_date}).fetchall()

    activities = []
    weighted_plan = 0.0
    weighted_actual = 0.0

    for r in rows:
        scope = float(r.scope_qty or 0)
        wt = float(r.weightage or 0)
        plan_qty = float(r.planned_qty_to_date or 0)
        act_qty = float(r.actual_qty_to_date or 0) + float(r.actuals_till_last_fy or 0)

        plan_pct = (plan_qty / scope * 100) if scope > 0 else 0
        act_pct = (act_qty / scope * 100) if scope > 0 else 0
        plan_pct = min(plan_pct, 100)
        act_pct = min(act_pct, 100)

        weighted_plan += plan_pct * (wt / 100)
        weighted_actual += act_pct * (wt / 100)

        activities.append({
            "plan_activity_id": r.plan_activity_id,
            "activity_name": r.activity_name,
            "uom": r.uom,
            "scope_qty": scope,
            "weightage": wt,
            "planned_qty_to_date": plan_qty,
            "actual_qty_to_date": act_qty,
            "planned_pct": round(plan_pct, 2),
            "actual_pct": round(act_pct, 2),
            "deviation_pct": round(plan_pct - act_pct, 2),
        })

    return {
        "package_id": package_id,
        "has_active_plan": True,
        "plan_name": plan.plan_name,
        "plan_version": plan.plan_version,
        "as_of": as_of_date.isoformat(),
        "planned_pct": round(weighted_plan, 2),
        "actual_pct": round(weighted_actual, 2),
        "deviation_pct": round(weighted_plan - weighted_actual, 2),
        "status": "ahead" if weighted_actual > weighted_plan else ("on_track" if abs(weighted_plan - weighted_actual) < 2 else "behind"),
        "activities": activities,
    }


# ============================================================================
# 12) GET /schemes/{scheme_id}/progress  → roll up to scheme level
# ============================================================================
@router.get("/schemes/{scheme_id}/progress")
def get_scheme_progress(scheme_id: int, as_of: Optional[str] = None, db: Session = Depends(get_db)):
    """
    Roll up package progress to scheme level using package_value_cr as weight.
    """
    as_of_date = date.fromisoformat(as_of) if as_of else date.today()

    packages = db.execute(text("""
        SELECT package_id, package_name, package_value_cr, is_scheme_mirror
        FROM packages WHERE scheme_id = :sid AND is_deleted = FALSE
    """), {"sid": scheme_id}).fetchall()

    if not packages:
        return {"scheme_id": scheme_id, "has_packages": False, "packages": []}

    total_value = sum(float(p.package_value_cr or 0) for p in packages)
    pkg_results = []
    weighted_plan = 0.0
    weighted_actual = 0.0

    for p in packages:
        prog = get_package_progress(p.package_id, as_of_date.isoformat(), db)
        wt = (float(p.package_value_cr or 0) / total_value * 100) if total_value > 0 else (100.0 / len(packages))

        pkg_results.append({
            "package_id": p.package_id,
            "package_name": p.package_name,
            "package_value_cr": float(p.package_value_cr or 0),
            "weight_in_scheme": round(wt, 2),
            "planned_pct": prog["planned_pct"],
            "actual_pct": prog["actual_pct"],
            "deviation_pct": prog["deviation_pct"],
            "has_plan": prog["has_active_plan"],
        })

        if prog["has_active_plan"]:
            weighted_plan += prog["planned_pct"] * (wt / 100)
            weighted_actual += prog["actual_pct"] * (wt / 100)

    return {
        "scheme_id": scheme_id,
        "has_packages": True,
        "as_of": as_of_date.isoformat(),
        "scheme_planned_pct": round(weighted_plan, 2),
        "scheme_actual_pct": round(weighted_actual, 2),
        "scheme_deviation_pct": round(weighted_plan - weighted_actual, 2),
        "packages": pkg_results,
    }