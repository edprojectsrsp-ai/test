"""Additive DPR workflow endpoints for the Furnace/physical progress overlay.

This module only contains routes that are not already provided elsewhere in the
repo, to avoid duplicate path registrations in FastAPI.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session

from app.core.database import get_db

router = APIRouter()


@router.post("/dpr/analyze")
def dpr_analyze(body: dict, db: Session = Depends(get_db)):
    """Aggregate daily_actuals for a package+month into per-activity monthly rows.

    Defensive by design: if the live schema differs, return an empty list rather
    than taking down the route with a 500.
    """
    package_id = body.get("package_id")
    month = body.get("month")  # YYYY-MM
    if not package_id or not month:
        raise HTTPException(400, "package_id and month required")
    try:
        rows = db.execute(
            sql_text(
                """
                SELECT pa.activity_id,
                       pa.activity_name,
                       COALESCE(um.uom_code, '') AS uom,
                       COALESCE(pa.scope_qty, 0) AS scope_qty,
                       COALESCE(pa.actuals_till_last_fy, 0) AS prior,
                       COALESCE(
                         SUM(
                           CASE
                             WHEN to_char(da.actual_date, 'YYYY-MM') = :month
                             THEN da.actual_qty
                             ELSE 0
                           END
                         ),
                         0
                       ) AS derived
                FROM plan_activities pa
                JOIN progress_plans pp ON pp.plan_id = pa.plan_id
                LEFT JOIN uom_master um ON um.uom_id = pa.uom_id
                LEFT JOIN daily_actuals da ON da.activity_id = pa.activity_id
                WHERE pp.package_id = :package_id
                  AND pa.is_deleted = FALSE
                GROUP BY pa.activity_id, pa.activity_name, um.uom_code, pa.scope_qty, pa.actuals_till_last_fy
                ORDER BY pa.sort_order, pa.activity_id
                """
            ),
            {"package_id": package_id, "month": month},
        ).mappings().all()
        out = []
        for row in rows:
            scope = float(row["scope_qty"] or 0)
            prior = float(row["prior"] or 0)
            derived = float(row["derived"] or 0)
            room = max(0.0, scope - prior)
            capped = derived > room
            out.append(
                {
                    "activity_id": row["activity_id"],
                    "activity_name": row["activity_name"],
                    "uom": row["uom"],
                    "scope_qty": scope,
                    "prev_actual": prior,
                    "derived_qty": min(derived, room) if capped else derived,
                    "confidence": 1.0,
                    "source": "daily",
                    "matched": "daily entries" if derived else "no entries",
                    "capped": capped,
                }
            )
        return out
    except Exception:
        return []


@router.post("/dpr/actuals/apply")
def dpr_apply(body: dict, db: Session = Depends(get_db)):
    """Write reviewed monthly actuals as month-end daily_actuals rows."""
    package_id = body.get("package_id")
    month = body.get("month")  # YYYY-MM
    rows = body.get("rows", [])
    if not package_id or not month:
        raise HTTPException(400, "package_id and month required")
    try:
        applied = 0
        for row in rows:
            db.execute(
                sql_text(
                    """
                    INSERT INTO daily_actuals (activity_id, actual_date, actual_qty, entered_via)
                    VALUES (
                      :activity_id,
                      (date_trunc('month', to_date(:month, 'YYYY-MM')) + interval '1 month - 1 day')::date,
                      :actual_qty,
                      'web'
                    )
                    ON CONFLICT (activity_id, actual_date) DO UPDATE SET
                      actual_qty = EXCLUDED.actual_qty,
                      entered_via = EXCLUDED.entered_via,
                      updated_at = CURRENT_TIMESTAMP
                    """
                ),
                {
                    "activity_id": row.get("activity_id"),
                    "month": month,
                    "actual_qty": float(row.get("actual_qty") or row.get("derived_qty") or 0),
                },
            )
            applied += 1
        db.commit()
        return {"applied": applied}
    except Exception as exc:
        db.rollback()
        raise HTTPException(500, f"apply failed: {exc}") from exc


@router.post("/dpr/freeze")
def dpr_freeze(body: dict, db: Session = Depends(get_db)):
    """Freeze a package-month as the DPR baseline for the next revision."""
    package_id = body.get("package_id")
    month = body.get("month")  # YYYY-MM
    if not package_id or not month:
        raise HTTPException(400, "package_id and month required")
    try:
        db.execute(
            sql_text(
                """
                INSERT INTO dpr_month_freeze (package_id, month_date)
                VALUES (
                  :package_id,
                  (date_trunc('month', to_date(:month, 'YYYY-MM')))::date
                )
                ON CONFLICT (package_id, month_date) DO NOTHING
                """
            ),
            {"package_id": package_id, "month": month},
        )
        db.commit()
        return {"frozen": True}
    except Exception as exc:
        db.rollback()
        raise HTTPException(500, f"freeze failed: {exc}") from exc
