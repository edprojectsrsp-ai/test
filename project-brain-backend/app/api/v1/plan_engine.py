"""
Project Brain — Plan Engine API Router — REWRITTEN against LIVE t5 schema.

The previous version used t3 columns that do not exist in t5
(progress_plan_id, plan_status, weightage, plan_activity_id,
contract_start_month, expected_completion_month, effective_month, locked_at,
locked_by, activity_start_date, activity_finish_date, display_order,
plan_month, daily_actuals.package_id/submitted_by). Every query would error.

t5 mapping (old -> real):
  progress_plan_id        -> plan_id
  plan_status             -> is_current/is_locked (no status column; we expose
                             a synthetic "plan_status" string for the frontend:
                             'locked' if is_locked else 'draft')
  weightage               -> weight_pct
  plan_activity_id        -> activity_id
  contract_start_month    -> plan_start_date
  expected_completion_month -> plan_end_date
  effective_month         -> stored in extra_fields['effective_month']
  locked_at / locked_by   -> not in t5; locked_at synthesised from updated_at
  activity_start_date     -> planned_start_date
  activity_finish_date    -> planned_finish_date
  display_order           -> sort_order
  plan_month              -> month_date  (MUST be first-of-month; enforced)
  daily_actuals.package_id/submitted_by -> entered_by / entered_via (no pkg col)
  uom (text)              -> uom_id (we keep a text 'uom' in the response from
                             extra_fields or null; the planner shows it as label)

RESPONSE COMPATIBILITY: every response still returns the OLD field names the
existing frontend expects (progress_plan_id, weightage, plan_activity_id,
plan_status, contract_start_month, etc.) as ALIASES, so app/progress/plan-engine/
page.tsx keeps working unchanged. New t5 names are included alongside.

Mounted at /api/v1/plan-engine (see main.py).
Place at: project-brain-backend/app/api/v1/plan_engine.py
"""

import json
from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text
from app.core.database import get_db

router = APIRouter()


def _date(d):
    return d.isoformat() if d else None


def _num(n):
    return float(n) if n is not None else None


def _first_of_month(s):
    """Coerce 'YYYY-MM-01' or 'YYYY-MM-DD' to first-of-month date."""
    if not s:
        return None
    if isinstance(s, date):
        return date(s.year, s.month, 1)
    d = date.fromisoformat(str(s)[:10])
    return date(d.year, d.month, 1)


def _month_range(start: date, end: date):
    if not start or not end:
        return
    cur = date(start.year, start.month, 1)
    end_m = date(end.year, end.month, 1)
    while cur <= end_m:
        yield cur
        cur = date(cur.year + 1, 1, 1) if cur.month == 12 else date(cur.year, cur.month + 1, 1)


def _status_of(is_locked):
    return "locked" if is_locked else "draft"


# ============================================================================
# 1) GET /packages/{package_id}/plans
# ============================================================================
@router.get("/packages/{package_id}/plans")
def list_plans(package_id: int, db: Session = Depends(get_db)):
    sql = text("""
        SELECT
            pp.plan_id, pp.package_id, pp.plan_name, pp.plan_version,
            pp.financial_year, pp.is_current, pp.is_locked,
            pp.plan_start_date, pp.plan_end_date, pp.extra_fields,
            pp.created_at, pp.updated_at,
            COUNT(pa.activity_id) AS activity_count,
            COALESCE(SUM(pa.weight_pct), 0) AS total_weightage
        FROM progress_plans pp
        LEFT JOIN plan_activities pa
               ON pa.plan_id = pp.plan_id AND pa.is_deleted = FALSE
        WHERE pp.package_id = :pkg_id AND pp.is_deleted = FALSE
        GROUP BY pp.plan_id
        ORDER BY pp.is_current DESC, pp.created_at DESC
    """)
    rows = db.execute(sql, {"pkg_id": package_id}).fetchall()

    out = []
    for r in rows:
        ef = r.extra_fields or {}
        out.append({
            # legacy aliases
            "progress_plan_id": r.plan_id,
            "plan_status": _status_of(r.is_locked),
            "contract_start_month": _date(r.plan_start_date),
            "expected_completion_month": _date(r.plan_end_date),
            "effective_month": ef.get("effective_month") or _date(r.plan_start_date),
            "locked_at": _date(r.updated_at) if r.is_locked else None,
            "total_weightage": float(r.total_weightage or 0),
            "weightage_ok": abs(float(r.total_weightage or 0) - 100.0) < 0.01,
            # t5 names
            "plan_id": r.plan_id,
            "package_id": r.package_id,
            "plan_name": r.plan_name,
            "plan_version": r.plan_version,
            "financial_year": r.financial_year,
            "is_current": r.is_current,
            "is_locked": r.is_locked,
            "plan_start_date": _date(r.plan_start_date),
            "plan_end_date": _date(r.plan_end_date),
            "created_at": _date(r.created_at),
            "activity_count": r.activity_count or 0,
        })
    return out


# ============================================================================
# 2) POST /packages/{package_id}/plans
# ============================================================================
@router.post("/packages/{package_id}/plans")
def create_plan(package_id: int, data: dict, db: Session = Depends(get_db)):
    try:
        max_v = db.execute(
            text("SELECT COALESCE(MAX(plan_version::int), 0) FROM progress_plans WHERE package_id = :pid"),
            {"pid": package_id}
        ).scalar()
        new_v = int(max_v or 0) + 1

        # Default plan name to the financial year if provided, else version.
        fy = data.get("financial_year")
        plan_name = data.get("plan_name") or (f"FY{fy}" if fy else f"Plan v{new_v}")

        # de-current siblings so the new one is the live plan
        db.execute(text("""
            UPDATE progress_plans SET is_current = FALSE
            WHERE package_id = :pid AND is_current = TRUE AND is_deleted = FALSE
        """), {"pid": package_id})

        ef = {}
        if data.get("effective_month") or data.get("contract_start_month"):
            ef["effective_month"] = data.get("effective_month") or data.get("contract_start_month")

        new_id = db.execute(text("""
            INSERT INTO progress_plans (
                package_id, plan_name, plan_type, plan_version, financial_year,
                is_current, is_locked, plan_start_date, plan_end_date,
                extra_fields, is_deleted, created_by, created_at, updated_at
            ) VALUES (
                :pid, :name, 'execution', :ver, :fy,
                TRUE, FALSE, :start_m, :end_m,
                CAST(:ef AS jsonb), FALSE, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            )
            RETURNING plan_id
        """), {
            "pid": package_id, "name": plan_name, "ver": str(new_v), "fy": fy,
            "start_m": data.get("contract_start_month") or data.get("plan_start_date"),
            "end_m": data.get("expected_completion_month") or data.get("plan_end_date"),
            "ef": json.dumps(ef),
        }).scalar()
        db.commit()
        return {"progress_plan_id": new_id, "plan_id": new_id,
                "plan_name": plan_name, "plan_version": new_v}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Plan creation failed: {e}")


# ============================================================================
# 3) GET /plans/{plan_id}/full
# ============================================================================
@router.get("/plans/{plan_id}/full")
def get_plan_full(plan_id: int, db: Session = Depends(get_db)):
    h = db.execute(text("""
        SELECT plan_id, package_id, plan_name, plan_version, financial_year,
               is_current, is_locked, plan_start_date, plan_end_date,
               extra_fields, created_at, updated_at
        FROM progress_plans WHERE plan_id = :pid
    """), {"pid": plan_id}).first()
    if not h:
        raise HTTPException(status_code=404, detail="Plan not found")

    activities = db.execute(text("""
        SELECT pa.activity_id, pa.activity_name, pa.uom_id, u.uom_name,
               pa.scope_qty, pa.weight_pct, pa.actuals_till_last_fy,
               pa.planned_start_date, pa.planned_finish_date,
               pa.expected_finish_date, pa.sort_order, pa.appendix2_item_id
        FROM plan_activities pa
        LEFT JOIN uom_master u ON u.uom_id = pa.uom_id
        WHERE pa.plan_id = :pid AND pa.is_deleted = FALSE
        ORDER BY pa.sort_order, pa.activity_id
    """), {"pid": plan_id}).fetchall()

    months = []
    if h.plan_start_date and h.plan_end_date:
        months = [m.isoformat() for m in _month_range(h.plan_start_date, h.plan_end_date)]

    # planned cells (row_type='plan')
    monthly_cells = {}
    for row in db.execute(text("""
        SELECT activity_id, month_date, planned_qty
        FROM monthly_plan_entries
        WHERE activity_id IN (SELECT activity_id FROM plan_activities WHERE plan_id = :pid)
          AND row_type = 'plan'
    """), {"pid": plan_id}).fetchall():
        monthly_cells[f"{row.activity_id}|{row.month_date.isoformat()}"] = float(row.planned_qty or 0)

    # actuals aggregated to month
    actual_cells = {}
    for row in db.execute(text("""
        SELECT activity_id, DATE_TRUNC('month', actual_date)::date AS am,
               SUM(actual_qty) AS q
        FROM daily_actuals
        WHERE activity_id IN (SELECT activity_id FROM plan_activities WHERE plan_id = :pid)
        GROUP BY activity_id, DATE_TRUNC('month', actual_date)
    """), {"pid": plan_id}).fetchall():
        actual_cells[f"{row.activity_id}|{row.am.isoformat()}"] = float(row.q or 0)

    ef = h.extra_fields or {}
    return {
        "header": {
            "progress_plan_id": h.plan_id, "plan_id": h.plan_id,
            "package_id": h.package_id, "plan_name": h.plan_name,
            "plan_version": h.plan_version, "financial_year": h.financial_year,
            "plan_status": _status_of(h.is_locked), "is_locked": h.is_locked,
            "is_current": h.is_current,
            "contract_start_month": _date(h.plan_start_date),
            "expected_completion_month": _date(h.plan_end_date),
            "plan_start_date": _date(h.plan_start_date),
            "plan_end_date": _date(h.plan_end_date),
            "effective_month": ef.get("effective_month") or _date(h.plan_start_date),
            "created_at": _date(h.created_at),
            "locked_at": _date(h.updated_at) if h.is_locked else None,
        },
        "activities": [{
            "plan_activity_id": a.activity_id, "activity_id": a.activity_id,
            "activity_name": a.activity_name,
            "uom": a.uom_name or "", "uom_id": a.uom_id,
            "scope_qty": float(a.scope_qty or 0),
            "weightage": float(a.weight_pct or 0), "weight_pct": float(a.weight_pct or 0),
            "actuals_till_last_fy": float(a.actuals_till_last_fy or 0),
            "activity_start_date": _date(a.planned_start_date),
            "activity_finish_date": _date(a.planned_finish_date),
            "planned_start_date": _date(a.planned_start_date),
            "planned_finish_date": _date(a.planned_finish_date),
            "expected_finish_date": _date(a.expected_finish_date),
            "appendix2_item_id": a.appendix2_item_id,
            "display_order": a.sort_order or 0, "sort_order": a.sort_order or 0,
        } for a in activities],
        "months": months,
        "monthly_cells": monthly_cells,
        "actual_cells": actual_cells,
    }


# ============================================================================
# 4) POST /plans/{plan_id}/activities
# ============================================================================
@router.post("/plans/{plan_id}/activities")
def add_activity(plan_id: int, data: dict, db: Session = Depends(get_db)):
    try:
        plan = db.execute(text("SELECT is_locked FROM progress_plans WHERE plan_id = :pid"),
                          {"pid": plan_id}).first()
        if not plan:
            raise HTTPException(status_code=404, detail="Plan not found")
        if plan.is_locked:
            raise HTTPException(status_code=403, detail="Plan is locked. Create a new version.")

        max_order = db.execute(
            text("SELECT COALESCE(MAX(sort_order),0) FROM plan_activities WHERE plan_id = :pid"),
            {"pid": plan_id}).scalar()

        new_id = db.execute(text("""
            INSERT INTO plan_activities (
                plan_id, activity_name, scope_qty, weight_pct, actuals_till_last_fy,
                planned_start_date, planned_finish_date, sort_order, is_deleted,
                extra_fields, created_at, updated_at
            ) VALUES (
                :pid, :name, :qty, :wt, :last_fy,
                :start, :finish, :order, FALSE, '{}'::jsonb,
                CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            )
            RETURNING activity_id
        """), {
            "pid": plan_id,
            "name": data.get("activity_name", "New Activity"),
            "qty": data.get("scope_qty", 0),
            "wt": data.get("weightage", data.get("weight_pct", 10)),
            "last_fy": data.get("actuals_till_last_fy", 0),
            "start": data.get("activity_start_date") or data.get("planned_start_date"),
            "finish": data.get("activity_finish_date") or data.get("planned_finish_date"),
            "order": int(max_order or 0) + 10,
        }).scalar()
        db.commit()
        return {"plan_activity_id": new_id, "activity_id": new_id}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Add activity failed: {e}")


# ============================================================================
# 5) PUT /activities/{activity_id}
# ============================================================================
@router.put("/activities/{activity_id}")
def update_activity(activity_id: int, data: dict, db: Session = Depends(get_db)):
    try:
        lock = db.execute(text("""
            SELECT pp.is_locked FROM plan_activities pa
            JOIN progress_plans pp ON pp.plan_id = pa.plan_id
            WHERE pa.activity_id = :id
        """), {"id": activity_id}).scalar()
        if lock:
            raise HTTPException(status_code=403, detail="Plan is locked")

        # map legacy -> t5 columns
        field_map = {
            "activity_name": "activity_name",
            "scope_qty": "scope_qty",
            "weightage": "weight_pct", "weight_pct": "weight_pct",
            "actuals_till_last_fy": "actuals_till_last_fy",
            "activity_start_date": "planned_start_date", "planned_start_date": "planned_start_date",
            "activity_finish_date": "planned_finish_date", "planned_finish_date": "planned_finish_date",
            "expected_finish_date": "expected_finish_date",
            "display_order": "sort_order", "sort_order": "sort_order",
        }
        sets, params, seen = [], {"id": activity_id}, set()
        for incoming, col in field_map.items():
            if incoming in data and col not in seen:
                sets.append(f"{col} = :{col}")
                params[col] = data[incoming]
                seen.add(col)
        if not sets:
            return {"ok": True, "noop": True}
        sets.append("updated_at = CURRENT_TIMESTAMP")
        db.execute(text(f"UPDATE plan_activities SET {', '.join(sets)} WHERE activity_id = :id"), params)
        db.commit()
        return {"ok": True, "plan_activity_id": activity_id, "activity_id": activity_id}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Update activity failed: {e}")


# ============================================================================
# 6) DELETE /activities/{activity_id}  (soft delete)
# ============================================================================
@router.delete("/activities/{activity_id}")
def delete_activity(activity_id: int, db: Session = Depends(get_db)):
    try:
        lock = db.execute(text("""
            SELECT pp.is_locked FROM plan_activities pa
            JOIN progress_plans pp ON pp.plan_id = pa.plan_id
            WHERE pa.activity_id = :id
        """), {"id": activity_id}).scalar()
        if lock:
            raise HTTPException(status_code=403, detail="Plan is locked")
        db.execute(text("UPDATE plan_activities SET is_deleted = TRUE WHERE activity_id = :id"),
                   {"id": activity_id})
        db.commit()
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Delete activity failed: {e}")


# ============================================================================
# 7) PUT /plans/{plan_id}/cells  → upsert monthly_plan_entries (row_type='plan')
# ============================================================================
@router.put("/plans/{plan_id}/cells")
def update_cells(plan_id: int, data: dict, db: Session = Depends(get_db)):
    try:
        plan = db.execute(text("SELECT is_locked FROM progress_plans WHERE plan_id = :pid"),
                          {"pid": plan_id}).first()
        if not plan:
            raise HTTPException(status_code=404, detail="Plan not found")
        if plan.is_locked:
            raise HTTPException(status_code=403, detail="Plan is locked. Create a new version to edit.")

        cells = data.get("cells", [])
        if not isinstance(cells, list):
            raise HTTPException(status_code=400, detail="`cells` must be a list")

        upsert = text("""
            INSERT INTO monthly_plan_entries (activity_id, month_date, planned_qty, row_type, created_at, updated_at)
            VALUES (:aid, :month, :qty, 'plan', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON CONFLICT (activity_id, month_date, row_type)
            DO UPDATE SET planned_qty = EXCLUDED.planned_qty, updated_at = CURRENT_TIMESTAMP
        """)
        written = 0
        for c in cells:
            aid = c.get("plan_activity_id") or c.get("activity_id")
            month = _first_of_month(c.get("plan_month") or c.get("month_date"))
            db.execute(upsert, {"aid": aid, "month": month.isoformat() if month else None,
                                "qty": float(c.get("planned_qty") or 0)})
            written += 1
        db.commit()
        return {"ok": True, "cells_written": written}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Update cells failed: {e}")


# ============================================================================
# 8) POST /plans/{plan_id}/lock
# ============================================================================
@router.post("/plans/{plan_id}/lock")
def lock_plan(plan_id: int, db: Session = Depends(get_db)):
    try:
        total_wt = db.execute(
            text("SELECT COALESCE(SUM(weight_pct),0) FROM plan_activities WHERE plan_id = :pid AND is_deleted = FALSE"),
            {"pid": plan_id}).scalar()
        if abs(float(total_wt or 0) - 100.0) > 0.01:
            raise HTTPException(status_code=400, detail=f"Cannot lock: weightages sum to {total_wt}, not 100")

        db.execute(text("""
            UPDATE progress_plans SET is_locked = TRUE, updated_at = CURRENT_TIMESTAMP
            WHERE plan_id = :pid
        """), {"pid": plan_id})
        db.commit()
        return {"ok": True, "is_locked": True, "plan_status": "locked",
                "locked_at": datetime.utcnow().isoformat()}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Lock failed: {e}")


# ============================================================================
# 9) POST /plans/{plan_id}/unlock
# ============================================================================
@router.post("/plans/{plan_id}/unlock")
def unlock_plan(plan_id: int, db: Session = Depends(get_db)):
    try:
        db.execute(text("""
            UPDATE progress_plans SET is_locked = FALSE, updated_at = CURRENT_TIMESTAMP
            WHERE plan_id = :pid
        """), {"pid": plan_id})
        db.commit()
        return {"ok": True, "is_locked": False, "plan_status": "draft"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# 10) POST /activities/{activity_id}/daily-actual
# ============================================================================
@router.post("/activities/{activity_id}/daily-actual")
def add_daily_actual(activity_id: int, data: dict, db: Session = Depends(get_db)):
    try:
        exists = db.execute(text("SELECT 1 FROM plan_activities WHERE activity_id = :id"),
                            {"id": activity_id}).scalar()
        if not exists:
            raise HTTPException(status_code=404, detail="Activity not found")

        new_id = db.execute(text("""
            INSERT INTO daily_actuals (activity_id, actual_date, actual_qty, remarks,
                                       entered_by, entered_via, created_at, updated_at)
            VALUES (:aid, :dt, :qty, :rmk, 1, :via, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            RETURNING daily_actual_id
        """), {
            "aid": activity_id,
            "dt": data.get("actual_date", date.today().isoformat()),
            "qty": float(data.get("actual_qty", 0)),
            "rmk": data.get("remarks"),
            "via": data.get("entered_via", "web"),
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
    as_of_date = date.fromisoformat(as_of) if as_of else date.today()

    plan = db.execute(text("""
        SELECT plan_id, plan_name, plan_version
        FROM progress_plans
        WHERE package_id = :pid AND is_locked = TRUE AND is_deleted = FALSE
        ORDER BY is_current DESC, updated_at DESC LIMIT 1
    """), {"pid": package_id}).first()

    if not plan:
        return {"package_id": package_id, "has_active_plan": False,
                "message": "No locked plan for this package",
                "planned_pct": 0, "actual_pct": 0, "deviation_pct": 0, "activities": []}

    rows = db.execute(text("""
        SELECT pa.activity_id, pa.activity_name, pa.scope_qty, pa.weight_pct,
               pa.actuals_till_last_fy,
               COALESCE((SELECT SUM(planned_qty) FROM monthly_plan_entries
                         WHERE activity_id = pa.activity_id AND row_type='plan'
                           AND month_date <= :as_of), 0) AS planned_qty_to_date,
               COALESCE((SELECT SUM(actual_qty) FROM daily_actuals
                         WHERE activity_id = pa.activity_id
                           AND actual_date <= :as_of), 0) AS actual_qty_to_date
        FROM plan_activities pa
        WHERE pa.plan_id = :pid AND pa.is_deleted = FALSE
        ORDER BY pa.sort_order
    """), {"pid": plan.plan_id, "as_of": as_of_date}).fetchall()

    activities, weighted_plan, weighted_actual = [], 0.0, 0.0
    for r in rows:
        scope = float(r.scope_qty or 0)
        wt = float(r.weight_pct or 0)
        plan_qty = float(r.planned_qty_to_date or 0)
        act_qty = float(r.actual_qty_to_date or 0) + float(r.actuals_till_last_fy or 0)
        plan_pct = min((plan_qty / scope * 100) if scope > 0 else 0, 100)
        act_pct = min((act_qty / scope * 100) if scope > 0 else 0, 100)
        weighted_plan += plan_pct * (wt / 100)
        weighted_actual += act_pct * (wt / 100)
        activities.append({
            "plan_activity_id": r.activity_id, "activity_id": r.activity_id,
            "activity_name": r.activity_name, "scope_qty": scope,
            "weightage": wt, "weight_pct": wt,
            "planned_qty_to_date": plan_qty, "actual_qty_to_date": act_qty,
            "planned_pct": round(plan_pct, 2), "actual_pct": round(act_pct, 2),
            "deviation_pct": round(plan_pct - act_pct, 2),
        })

    return {
        "package_id": package_id, "has_active_plan": True,
        "plan_name": plan.plan_name, "plan_version": plan.plan_version,
        "as_of": as_of_date.isoformat(),
        "planned_pct": round(weighted_plan, 2), "actual_pct": round(weighted_actual, 2),
        "deviation_pct": round(weighted_plan - weighted_actual, 2),
        "status": "ahead" if weighted_actual > weighted_plan else ("on_track" if abs(weighted_plan - weighted_actual) < 2 else "behind"),
        "activities": activities,
    }


# ============================================================================
# 12) GET /schemes/{scheme_id}/progress  → scheme rollup
# ============================================================================
@router.get("/schemes/{scheme_id}/progress")
def get_scheme_progress(scheme_id: int, as_of: Optional[str] = None, db: Session = Depends(get_db)):
    as_of_date = date.fromisoformat(as_of) if as_of else date.today()

    packages = db.execute(text("""
        SELECT package_id, package_name, package_value_cr, package_estimate_cr,
               extra_fields, is_scheme_mirror
        FROM packages WHERE scheme_id = :sid AND is_deleted = FALSE
    """), {"sid": scheme_id}).fetchall()

    if not packages:
        return {"scheme_id": scheme_id, "has_packages": False, "packages": []}

    def _wt(p):
        ef = p.extra_fields or {}
        if isinstance(ef, dict) and ef.get("scheme_rollup_weight") not in (None, ""):
            try:
                v = float(ef["scheme_rollup_weight"])
                if v > 0:
                    return v
            except (TypeError, ValueError):
                pass
        return float(p.package_value_cr or p.package_estimate_cr or 0)

    total_w = sum(_wt(p) for p in packages) or 0
    pkg_results, weighted_plan, weighted_actual = [], 0.0, 0.0
    for p in packages:
        prog = get_package_progress(p.package_id, as_of_date.isoformat(), db)
        w = _wt(p)
        share = (w / total_w * 100) if total_w > 0 else (100.0 / len(packages))
        pkg_results.append({
            "package_id": p.package_id, "package_name": p.package_name,
            "package_value_cr": float(p.package_value_cr or 0),
            "weight_in_scheme": round(share, 2),
            "planned_pct": prog["planned_pct"], "actual_pct": prog["actual_pct"],
            "deviation_pct": prog["deviation_pct"], "has_plan": prog["has_active_plan"],
        })
        if prog["has_active_plan"]:
            weighted_plan += prog["planned_pct"] * (share / 100)
            weighted_actual += prog["actual_pct"] * (share / 100)

    return {
        "scheme_id": scheme_id, "has_packages": True, "as_of": as_of_date.isoformat(),
        "scheme_planned_pct": round(weighted_plan, 2),
        "scheme_actual_pct": round(weighted_actual, 2),
        "scheme_deviation_pct": round(weighted_plan - weighted_actual, 2),
        "packages": pkg_results,
    }


# ============================================================================
# 13) POST /plans/{plan_id}/auto-distribute
#     Distribute scope_qty evenly across planned months per activity.
#     Uses commencement_months/completion_months from appendix2_items if linked,
#     otherwise spreads evenly across all plan months.
# ============================================================================
@router.post("/plans/{plan_id}/auto-distribute")
def auto_distribute(plan_id: int, db: Session = Depends(get_db)):
    try:
        plan = db.execute(text("""
            SELECT plan_id, is_locked, plan_start_date, plan_end_date
            FROM progress_plans WHERE plan_id = :pid
        """), {"pid": plan_id}).first()
        if not plan:
            raise HTTPException(status_code=404, detail="Plan not found")
        if plan.is_locked:
            raise HTTPException(status_code=403, detail="Plan is locked. Unlock before auto-distributing.")

        if not plan.plan_start_date:
            raise HTTPException(status_code=400, detail="Plan has no start date. Set plan dates first.")

        # Build list of all plan months (first-of-month dates)
        all_months = list(_month_range(plan.plan_start_date, plan.plan_end_date or plan.plan_start_date))

        # Get activities + their appendix2 link
        activities = db.execute(text("""
            SELECT pa.activity_id, pa.scope_qty, pa.appendix2_item_id
            FROM plan_activities pa
            WHERE pa.plan_id = :pid AND pa.is_deleted = FALSE
        """), {"pid": plan_id}).fetchall()

        if not activities:
            return {"ok": True, "activities_distributed": 0, "cells_written": 0}

        # Fetch commencement/completion months for linked appendix2 items
        item_ids = [a.appendix2_item_id for a in activities if a.appendix2_item_id]
        appendix2_meta = {}
        if item_ids:
            id_list = ",".join(str(x) for x in item_ids)
            rows = db.execute(text(f"""
                SELECT item_id, commencement_months, completion_months
                FROM appendix2_items WHERE item_id IN ({id_list})
            """)).fetchall()
            appendix2_meta = {r.item_id: r for r in rows}

        upsert = text("""
            INSERT INTO monthly_plan_entries
                (activity_id, month_date, planned_qty, row_type, created_at, updated_at)
            VALUES (:aid, :mo, :qty, 'plan', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON CONFLICT (activity_id, month_date, row_type)
            DO UPDATE SET planned_qty = EXCLUDED.planned_qty, updated_at = CURRENT_TIMESTAMP
        """)

        cells_written = 0
        distributed = 0

        update_scope = text("""
            UPDATE plan_activities SET scope_qty = 100, updated_at = CURRENT_TIMESTAMP
            WHERE activity_id = :aid AND (scope_qty IS NULL OR scope_qty = 0)
        """)

        for a in activities:
            scope = float(a.scope_qty or 0)
            if scope <= 0:
                # Default to 100% scale for weight-only activities
                db.execute(update_scope, {"aid": a.activity_id})
                scope = 100.0

            # Determine which months this activity spans
            if a.appendix2_item_id and a.appendix2_item_id in appendix2_meta:
                meta = appendix2_meta[a.appendix2_item_id]
                cm = int(meta.commencement_months or 0)
                comp = int(meta.completion_months or 0)
                if cm >= 0 and comp > cm and all_months:
                    start_idx = min(cm, len(all_months) - 1)
                    end_idx = min(comp, len(all_months) - 1)
                    activity_months = all_months[start_idx:end_idx + 1]
                else:
                    activity_months = all_months
            else:
                activity_months = all_months

            if not activity_months:
                continue

            qty_per_month = round(scope / len(activity_months), 6)
            last_idx = len(activity_months) - 1

            for i, mo in enumerate(activity_months):
                # Put any rounding remainder in the last month
                if i == last_idx:
                    already = qty_per_month * last_idx
                    qty = round(scope - already, 6)
                else:
                    qty = qty_per_month
                db.execute(upsert, {"aid": a.activity_id, "mo": mo.isoformat(), "qty": qty})
                cells_written += 1

            distributed += 1

        db.commit()
        return {"ok": True, "activities_distributed": distributed, "cells_written": cells_written}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Auto-distribute failed: {e}")
