"""Billing Schedule API — milestone-based billing & payment tracking.

Table: billing_schedules (package_id, milestone_no, description,
       scheduled_amount_cr, scheduled_date, actual_amount_cr,
       actual_billed_date, payment_received_date, is_billed, is_paid, ...)
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db

router = APIRouter(prefix="/billing", tags=["Billing Schedule"])


# ─────────────────────── Scheme → packages ───────────────────────────────────

@router.get("/scheme/{scheme_id}/packages")
def get_scheme_packages(scheme_id: int, db: Session = Depends(get_db)):
    """Return packages with billing summary for a scheme."""
    rows = db.execute(text("""
        SELECT
            p.package_id,
            p.package_name,
            p.package_value_cr,
            COUNT(bs.billing_schedule_id)                                 AS milestone_count,
            COALESCE(SUM(bs.scheduled_amount_cr), 0)                      AS scheduled_cr,
            COALESCE(SUM(CASE WHEN bs.is_billed THEN bs.actual_amount_cr END), 0) AS billed_cr,
            COALESCE(SUM(CASE WHEN bs.is_paid   THEN bs.actual_amount_cr END), 0) AS paid_cr
        FROM packages p
        LEFT JOIN billing_schedules bs
               ON bs.package_id = p.package_id AND NOT bs.is_deleted
        WHERE p.scheme_id  = :s_id
          AND NOT p.is_deleted
        GROUP BY p.package_id, p.package_name, p.package_value_cr
        ORDER BY p.package_id
    """), {"s_id": scheme_id}).mappings().all()
    return [dict(r) for r in rows]


# ─────────────────────── List milestones for package ─────────────────────────

@router.get("/packages/{package_id}")
def get_milestones(package_id: int, db: Session = Depends(get_db)):
    """List all billing milestones for a package."""
    rows = db.execute(text("""
        SELECT
            bs.billing_schedule_id,
            bs.package_id,
            bs.milestone_no,
            bs.description,
            bs.scheduled_amount_cr,
            bs.scheduled_date,
            bs.actual_amount_cr,
            bs.actual_billed_date,
            bs.payment_received_date,
            bs.is_billed,
            bs.is_paid,
            bs.remarks,
            bs.appendix2_item_id,
            ai.item_name                                                   AS appendix2_item_name,
            CASE
                WHEN bs.is_paid   THEN 'paid'
                WHEN bs.is_billed THEN 'billed'
                WHEN bs.scheduled_date IS NOT NULL
                 AND bs.scheduled_date < CURRENT_DATE THEN 'overdue'
                ELSE 'pending'
            END AS status
        FROM billing_schedules bs
        LEFT JOIN appendix2_items ai ON bs.appendix2_item_id = ai.item_id
        WHERE bs.package_id = :pkg_id
          AND NOT bs.is_deleted
        ORDER BY bs.milestone_no
    """), {"pkg_id": package_id}).mappings().all()
    return [dict(r) for r in rows]


# ─────────────────────── Package summary KPIs ────────────────────────────────

@router.get("/packages/{package_id}/summary")
def get_billing_summary(package_id: int, db: Session = Depends(get_db)):
    """Billing KPI card data for a package."""
    pkg = db.execute(text("""
        SELECT
            p.package_name,
            p.package_value_cr,
            c.contract_no  AS loa_number,
            c.contractor_name,
            c.loa_date,
            c.effective_date AS effective_start_date
        FROM packages p
        LEFT JOIN contracts c ON c.package_id = p.package_id
        WHERE p.package_id = :pkg_id
    """), {"pkg_id": package_id}).mappings().first()

    agg = db.execute(text("""
        SELECT
            COUNT(*)                                                               AS total_milestones,
            COALESCE(SUM(scheduled_amount_cr), 0)                                  AS schedule_total_cr,
            COALESCE(SUM(CASE WHEN is_billed THEN actual_amount_cr END), 0)        AS billed_cr,
            COALESCE(SUM(CASE WHEN is_paid   THEN actual_amount_cr END), 0)        AS paid_cr,
            COUNT(CASE WHEN is_billed THEN 1 END)                                  AS billed_count,
            COUNT(CASE WHEN is_paid   THEN 1 END)                                  AS paid_count,
            COUNT(CASE WHEN NOT is_billed
                            AND scheduled_date IS NOT NULL
                            AND scheduled_date < CURRENT_DATE THEN 1 END)          AS overdue_count
        FROM billing_schedules
        WHERE package_id = :pkg_id AND NOT is_deleted
    """), {"pkg_id": package_id}).mappings().first()

    p = dict(pkg) if pkg else {}
    a = dict(agg) if agg else {}

    contract_cr = float(p.get("package_value_cr") or 0)
    billed      = float(a.get("billed_cr") or 0)
    paid        = float(a.get("paid_cr") or 0)

    return {
        "package_name":       p.get("package_name"),
        "contractor_name":    p.get("contractor_name"),
        "loa_number":         p.get("loa_number"),
        "loa_date":           str(p["loa_date"]) if p.get("loa_date") else None,
        "effective_start_date": str(p["effective_start_date"]) if p.get("effective_start_date") else None,
        "contract_value_cr":  contract_cr,
        "schedule_total_cr":  float(a.get("schedule_total_cr") or 0),
        "billed_cr":          billed,
        "paid_cr":            paid,
        "balance_cr":         round(contract_cr - billed, 4),
        "billed_pct":         round(billed / contract_cr * 100, 1) if contract_cr else 0.0,
        "paid_pct":           round(paid   / contract_cr * 100, 1) if contract_cr else 0.0,
        "total_milestones":   int(a.get("total_milestones") or 0),
        "billed_count":       int(a.get("billed_count") or 0),
        "paid_count":         int(a.get("paid_count") or 0),
        "overdue_count":      int(a.get("overdue_count") or 0),
    }


# ─────────────────────── Create milestone ────────────────────────────────────

class MilestoneCreate(BaseModel):
    milestone_no: int
    description: str
    scheduled_amount_cr: float
    scheduled_date: Optional[str] = None
    appendix2_item_id: Optional[int] = None
    remarks: Optional[str] = None


@router.post("/packages/{package_id}")
def create_milestone(
    package_id: int,
    payload: MilestoneCreate,
    db: Session = Depends(get_db),
):
    row = db.execute(text("""
        INSERT INTO billing_schedules
            (package_id, milestone_no, description, scheduled_amount_cr,
             scheduled_date, appendix2_item_id, remarks)
        VALUES
            (:pkg_id, :ms_no, :desc, :amt,
             CAST(:s_date AS date), :a2_id, :remarks)
        RETURNING billing_schedule_id
    """), {
        "pkg_id":  package_id,
        "ms_no":   payload.milestone_no,
        "desc":    payload.description,
        "amt":     payload.scheduled_amount_cr,
        "s_date":  payload.scheduled_date,
        "a2_id":   payload.appendix2_item_id,
        "remarks": payload.remarks,
    }).mappings().first()
    db.commit()
    return {"ok": True, "billing_schedule_id": row["billing_schedule_id"]}


# ─────────────────────── Update milestone ────────────────────────────────────

class MilestoneUpdate(BaseModel):
    description: Optional[str] = None
    scheduled_amount_cr: Optional[float] = None
    scheduled_date: Optional[str] = None
    actual_amount_cr: Optional[float] = None
    actual_billed_date: Optional[str] = None
    payment_received_date: Optional[str] = None
    is_billed: Optional[bool] = None
    is_paid: Optional[bool] = None
    remarks: Optional[str] = None


@router.put("/milestones/{milestone_id}")
def update_milestone(
    milestone_id: int,
    payload: MilestoneUpdate,
    db: Session = Depends(get_db),
):
    existing = db.execute(text(
        "SELECT billing_schedule_id FROM billing_schedules "
        "WHERE billing_schedule_id = :id AND NOT is_deleted"
    ), {"id": milestone_id}).first()
    if not existing:
        raise HTTPException(status_code=404, detail="Milestone not found")

    fields = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not fields:
        return {"ok": True, "message": "Nothing to update"}

    # Cast date strings to date type in SQL
    date_cols = {"scheduled_date", "actual_billed_date", "payment_received_date"}
    set_clauses = []
    for k in fields:
        if k in date_cols:
            set_clauses.append(f"{k} = :{k}::date")
        else:
            set_clauses.append(f"{k} = :{k}")
    set_clauses.append("updated_at = CURRENT_TIMESTAMP")

    fields["id"] = milestone_id
    db.execute(text(
        f"UPDATE billing_schedules SET {', '.join(set_clauses)} "
        f"WHERE billing_schedule_id = :id"
    ), fields)
    db.commit()
    return {"ok": True}


# ─────────────────────── Delete milestone ────────────────────────────────────

@router.delete("/milestones/{milestone_id}")
def delete_milestone(milestone_id: int, db: Session = Depends(get_db)):
    """Soft-delete a billing milestone."""
    db.execute(text(
        "UPDATE billing_schedules SET is_deleted = TRUE "
        "WHERE billing_schedule_id = :id"
    ), {"id": milestone_id})
    db.commit()
    return {"ok": True}


# ─────────────────────── Appendix-2 items for a package ──────────────────────

@router.get("/packages/{package_id}/appendix2-items")
def get_appendix2_items(package_id: int, db: Session = Depends(get_db)):
    """Return leaf appendix2_items for this package (for milestone linking)."""
    rows = db.execute(text("""
        SELECT
            ai.item_id,
            ai.item_name,
            ai.commencement_months,
            ai.completion_months,
            cat.item_name AS category_name
        FROM appendix2_items ai
        JOIN appendix2_revisions rev ON ai.revision_id = rev.revision_id
        LEFT JOIN appendix2_items cat ON ai.parent_item_id = cat.item_id
        WHERE rev.package_id = :pkg_id
          AND ai.is_category = FALSE
        ORDER BY ai.sort_order, ai.item_id
    """), {"pkg_id": package_id}).mappings().all()
    return [dict(r) for r in rows]
