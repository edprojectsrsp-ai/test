"""
Project Brain — Plan Engine SEED extensions (Sprint 16, t5-corrected)

S-Curve seed helpers built on the REAL t5 schema:
  progress_plans(plan_id, package_id, plan_name, plan_version, financial_year,
                 plan_status?, is_locked, ...)
  plan_activities(activity_id, plan_id, activity_master_id, activity_name,
                  uom_id, scope_qty, weight_pct, planned_start_date,
                  planned_finish_date, actuals_till_last_fy, sort_order, is_deleted)
  monthly_plan_entries(monthly_entry_id, activity_id, month_date, planned_qty)
  daily_actuals(daily_actual_id, activity_id, actual_date, actual_qty)
  activity_master_global(activity_master_id, activity_name, default_uom_id,
                         default_weightage, is_active)
  uom_master(uom_id, uom_code, uom_name)

Note vs the earlier (t3) version:
  * plan_activities has NO package_id — it belongs to a plan, package is via plan
  * weightage → weight_pct, display_order → sort_order
  * uom is a FK (uom_id), not free text
  * monthly_plan_entries.month_date is a DATE not a month number
  * progress_plans has no plan_status column in t5 — lock state is is_locked

Endpoints (mount under /api/v1):
  GET  /plan-seed/sources/{package_id}
  POST /plan-seed/plans/{plan_id}/seed-master
  POST /plan-seed/plans/{plan_id}/seed-prior
  GET  /plan-seed/plans/{plan_id}/fy-cumulative
"""
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db

router = APIRouter(prefix="/plan-seed", tags=["Plan Seed"])


def _fy_bounds(fy: Optional[str]) -> tuple[date, date]:
    today = date.today()
    default_start = today.year if today.month >= 4 else today.year - 1
    start_year = default_start
    if fy:
        try:
            start_year = int(fy.replace("FY", "").strip().split("-")[0])
        except (ValueError, IndexError):
            start_year = default_start
    return date(start_year, 4, 1), date(start_year + 1, 3, 31)


@router.get("/sources/{package_id}")
def seed_sources(package_id: int, db: Session = Depends(get_db)):
    master_count = db.execute(
        text("SELECT COUNT(*) FROM activity_master_global WHERE is_active = TRUE")
    ).scalar()

    prior = db.execute(text("""
        SELECT pp.plan_id, pp.plan_name, pp.plan_version, pp.financial_year,
               pp.is_locked, COUNT(pa.activity_id) AS activity_count
        FROM progress_plans pp
        LEFT JOIN plan_activities pa
               ON pa.plan_id = pp.plan_id AND NOT pa.is_deleted
        WHERE pp.package_id = :pkg AND NOT pp.is_deleted
        GROUP BY
            pp.plan_id, pp.plan_name, pp.plan_version, pp.financial_year, pp.is_locked
        HAVING COUNT(pa.activity_id) > 0
        ORDER BY pp.financial_year DESC, pp.plan_id DESC
    """), {"pkg": package_id}).fetchall()

    return {
        "package_id": package_id,
        "master_activity_count": int(master_count or 0),
        "prior_plans": [
            {"plan_id": r.plan_id, "plan_name": r.plan_name,
             "plan_version": r.plan_version, "financial_year": r.financial_year,
             "is_locked": r.is_locked, "activity_count": int(r.activity_count or 0)}
            for r in prior
        ],
    }


def _plan_or_404(db: Session, plan_id: int):
    p = db.execute(text("""
        SELECT plan_id, package_id, is_locked, financial_year
        FROM progress_plans WHERE plan_id = :pid AND NOT is_deleted
    """), {"pid": plan_id}).first()
    if not p:
        raise HTTPException(404, "Plan not found")
    return p


def _existing_names(db: Session, plan_id: int) -> set[str]:
    return {
        r[0].strip().lower()
        for r in db.execute(
            text("SELECT activity_name FROM plan_activities WHERE plan_id = :pid AND NOT is_deleted"),
            {"pid": plan_id},
        ).fetchall()
    }


def _max_order(db: Session, plan_id: int) -> int:
    return int(db.execute(
        text("SELECT COALESCE(MAX(sort_order), 0) FROM plan_activities WHERE plan_id = :pid"),
        {"pid": plan_id},
    ).scalar() or 0)


@router.post("/plans/{plan_id}/seed-master")
def seed_from_master(plan_id: int, data: dict = None, db: Session = Depends(get_db)):
    data = data or {}
    plan = _plan_or_404(db, plan_id)
    if plan.is_locked:
        raise HTTPException(403, "Plan is locked. Create a new version before seeding.")

    activity_ids = data.get("activity_ids")
    base_sql = """
        SELECT amg.activity_master_id, amg.activity_name, amg.default_weightage,
               amg.default_uom_id
        FROM activity_master_global amg
        WHERE amg.is_active = TRUE
    """
    if activity_ids:
        rows = db.execute(text(base_sql + " AND amg.activity_master_id = ANY(:ids) ORDER BY amg.activity_name"),
                          {"ids": activity_ids}).fetchall()
    else:
        rows = db.execute(text(base_sql + " ORDER BY amg.activity_name")).fetchall()
    if not rows:
        return {"ok": True, "inserted": 0, "skipped": 0, "note": "No master activities matched."}

    existing = _existing_names(db, plan_id)
    order = _max_order(db, plan_id)
    inserted, skipped = 0, 0
    for r in rows:
        if r.activity_name.strip().lower() in existing:
            skipped += 1
            continue
        order += 10
        db.execute(text("""
            INSERT INTO plan_activities (
                plan_id, activity_master_id, activity_name, uom_id, scope_qty,
                weight_pct, actuals_till_last_fy, sort_order, is_deleted
            ) VALUES (
                :pid, :amid, :name, :uom, 0, :wt, 0, :order, FALSE
            )
        """), {
            "pid": plan_id, "amid": r.activity_master_id, "name": r.activity_name,
            "uom": r.default_uom_id, "wt": float(r.default_weightage or 10), "order": order,
        })
        inserted += 1
    db.commit()
    return {"ok": True, "inserted": inserted, "skipped": skipped,
            "note": f"Seeded {inserted} activities from master ({skipped} duplicates skipped)."}


@router.post("/plans/{plan_id}/seed-prior")
def seed_from_prior(plan_id: int, data: dict, db: Session = Depends(get_db)):
    source_plan_id = data.get("source_plan_id")
    if not source_plan_id:
        raise HTTPException(400, "source_plan_id is required")
    carry = data.get("carry_actuals_till_last_fy", True)

    plan = _plan_or_404(db, plan_id)
    if plan.is_locked:
        raise HTTPException(403, "Plan is locked. Create a new version before seeding.")

    src = db.execute(text("""
        SELECT activity_id, activity_name, activity_master_id, uom_id, scope_qty,
               weight_pct, actuals_till_last_fy, planned_start_date,
               planned_finish_date, sort_order
        FROM plan_activities
        WHERE plan_id = :sid AND NOT is_deleted
        ORDER BY sort_order, activity_id
    """), {"sid": source_plan_id}).fetchall()
    if not src:
        raise HTTPException(404, "Source plan has no activities")

    fy_start, _ = _fy_bounds(plan.financial_year)
    last_fy_end = date(fy_start.year, 3, 31)
    carried: dict[int, float] = {}
    if carry:
        src_ids = [a.activity_id for a in src]
        for r in db.execute(text("""
            SELECT activity_id, COALESCE(SUM(actual_qty),0) AS total
            FROM daily_actuals
            WHERE activity_id = ANY(:ids) AND actual_date <= :cutoff
            GROUP BY activity_id
        """), {"ids": src_ids, "cutoff": last_fy_end}).fetchall():
            carried[r.activity_id] = float(r.total or 0)

    existing = _existing_names(db, plan_id)
    order = _max_order(db, plan_id)
    inserted, skipped = 0, 0
    for a in src:
        if a.activity_name.strip().lower() in existing:
            skipped += 1
            continue
        order += 10
        new_last_fy = float(a.actuals_till_last_fy or 0) + (carried.get(a.activity_id, 0.0) if carry else 0.0)
        db.execute(text("""
            INSERT INTO plan_activities (
                plan_id, activity_master_id, activity_name, uom_id, scope_qty,
                weight_pct, actuals_till_last_fy, planned_start_date,
                planned_finish_date, sort_order, is_deleted
            ) VALUES (
                :pid, :amid, :name, :uom, :qty, :wt, :last_fy, :start, :finish, :order, FALSE
            )
        """), {
            "pid": plan_id, "amid": a.activity_master_id, "name": a.activity_name,
            "uom": a.uom_id, "qty": float(a.scope_qty or 0), "wt": float(a.weight_pct or 10),
            "last_fy": new_last_fy, "start": a.planned_start_date,
            "finish": a.planned_finish_date, "order": order,
        })
        inserted += 1
    db.commit()
    return {"ok": True, "inserted": inserted, "skipped": skipped,
            "carried_actuals": carry, "last_fy_cutoff": last_fy_end.isoformat(),
            "note": f"Copied {inserted} activities from plan {source_plan_id} "
                    f"({skipped} duplicates skipped)."
                    + (" Actuals till last FY carried forward." if carry else "")}


@router.get("/plans/{plan_id}/fy-cumulative")
def fy_cumulative(plan_id: int, db: Session = Depends(get_db)):
    plan = _plan_or_404(db, plan_id)
    fy_start, fy_end = _fy_bounds(plan.financial_year)

    activities = db.execute(text("""
        SELECT pa.activity_id, pa.activity_name, pa.scope_qty, pa.weight_pct,
               pa.actuals_till_last_fy, um.uom_name
        FROM plan_activities pa
        LEFT JOIN uom_master um ON um.uom_id = pa.uom_id
        WHERE pa.plan_id = :pid AND NOT pa.is_deleted
        ORDER BY pa.sort_order, pa.activity_id
    """), {"pid": plan_id}).fetchall()
    if not activities:
        return {"plan_id": plan_id, "financial_year": plan.financial_year, "activities": []}

    ids = [a.activity_id for a in activities]
    actual_this_fy = {
        r.activity_id: float(r.total or 0)
        for r in db.execute(text("""
            SELECT activity_id, COALESCE(SUM(actual_qty),0) AS total
            FROM daily_actuals
            WHERE activity_id = ANY(:ids) AND actual_date >= :s AND actual_date <= :e
            GROUP BY activity_id
        """), {"ids": ids, "s": fy_start, "e": fy_end}).fetchall()
    }
    planned_this_fy = {
        r.activity_id: float(r.total or 0)
        for r in db.execute(text("""
            SELECT activity_id, COALESCE(SUM(planned_qty),0) AS total
            FROM monthly_plan_entries
            WHERE activity_id = ANY(:ids) AND month_date >= :s AND month_date <= :e
            GROUP BY activity_id
        """), {"ids": ids, "s": fy_start, "e": fy_end}).fetchall()
    }

    total_weight = sum(float(a.weight_pct or 0) for a in activities) or 1.0
    weighted = 0.0
    out = []
    for a in activities:
        scope = float(a.scope_qty or 0)
        last_fy = float(a.actuals_till_last_fy or 0)
        this_fy = actual_this_fy.get(a.activity_id, 0.0)
        cum = last_fy + this_fy
        pct = (cum / scope * 100) if scope > 0 else 0.0
        weighted += pct * (float(a.weight_pct or 0) / total_weight)
        out.append({
            "activity_id": a.activity_id, "activity_name": a.activity_name,
            "uom": a.uom_name, "scope_qty": scope, "weight_pct": float(a.weight_pct or 0),
            "actuals_till_last_fy": last_fy, "actual_this_fy": this_fy,
            "cumulative_actual": cum, "planned_this_fy": planned_this_fy.get(a.activity_id, 0.0),
            "cumulative_pct": round(pct, 2),
        })
    return {
        "plan_id": plan_id, "financial_year": plan.financial_year,
        "fy_start": fy_start.isoformat(), "fy_end": fy_end.isoformat(),
        "package_weighted_cumulative_pct": round(weighted, 2),
        "activities": out,
    }
