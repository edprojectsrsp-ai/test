"""Corporate AMR Master API — live-computed from t5 schema.

Correct column names (verified):
  scheme_master:   sanctioned_cost_cr, planned_completion_date, scheme_owner_name
  tender_cycles:   cycle_status, awarded_value_cr, estimated_value_cr (keyed by package_id)
  contracts:       contract_no, effective_date, contract_value_cr (keyed by package_id)
  packages:        planned_end_date, expected_completion_date
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.orm import Session
from typing import Optional

from app.core.database import get_db

router = APIRouter()


@router.get("/corporate/amr")
def get_corporate_amr(
    scheme_type: Optional[str] = Query(None, description="plant|corporate|dummy"),
    db: Session = Depends(get_db),
):
    """Corporate AMR grid — one row per scheme."""
    rows = db.execute(text("""
        WITH scheme_phy AS (
            SELECT
                p.scheme_id,
                ROUND(AVG(
                    COALESCE(
                        da_sum.actual_qty / NULLIF(pa_sum.scope_total, 0) * 100, 0
                    )
                ), 1) AS avg_physical_pct
            FROM packages p
            JOIN progress_plans pp ON pp.package_id = p.package_id
                AND pp.is_locked = TRUE AND pp.is_current = TRUE
            LEFT JOIN LATERAL (
                SELECT SUM(scope_qty) AS scope_total
                FROM plan_activities
                WHERE plan_id = pp.plan_id AND NOT is_deleted AND scope_qty > 0
            ) pa_sum ON TRUE
            LEFT JOIN LATERAL (
                SELECT SUM(da.actual_qty) AS actual_qty
                FROM daily_actuals da
                JOIN plan_activities pa2 ON da.activity_id = pa2.activity_id
                WHERE pa2.plan_id = pp.plan_id AND NOT pa2.is_deleted AND pa2.scope_qty > 0
            ) da_sum ON TRUE
            WHERE NOT p.is_deleted
            GROUP BY p.scheme_id
        ),
        scheme_plant_phy AS (
            -- Fallback for plant AMR schemes tracked via the simplified
            -- monthly grid (no locked activity plan): latest cumulative %.
            SELECT DISTINCT ON (p.scheme_id)
                p.scheme_id,
                ppm.cumulative_actual_pct
            FROM plant_progress_monthly ppm
            JOIN packages p ON p.package_id = ppm.package_id
            WHERE NOT p.is_deleted
            ORDER BY p.scheme_id, ppm.month_date DESC
        ),
        latest_contract AS (
            SELECT DISTINCT ON (p.scheme_id)
                p.scheme_id,
                c.contractor_name,
                c.loa_date,
                c.effective_date,
                c.contract_value_cr
            FROM contracts c
            JOIN packages p ON c.package_id = p.package_id
            WHERE NOT c.is_deleted
            ORDER BY p.scheme_id, c.contract_id DESC
        ),
        latest_tender AS (
            SELECT DISTINCT ON (p.scheme_id)
                p.scheme_id,
                tc.cycle_status,
                tc.awarded_value_cr,
                tc.estimated_value_cr,
                tc.nit_date
            FROM tender_cycles tc
            JOIN packages p ON tc.package_id = p.package_id
            WHERE NOT tc.is_deleted
            ORDER BY p.scheme_id, tc.cycle_no DESC
        )
        SELECT
            sm.scheme_id,
            sm.scheme_name,
            sm.scheme_type,
            sm.current_status,
            COALESCE(sm.sanctioned_cost_cr, sm.estimated_cost_cr, sm.anticipated_cost_cr, 0) AS total_cost_cr,
            sm.planned_completion_date,
            sm.scheme_owner_name,
            ROUND(
                ((CURRENT_DATE - sm.planned_completion_date)::float / 30.0)::numeric, 1
            ) AS delay_months,
            COALESCE(sp.avg_physical_pct, spp.cumulative_actual_pct, 0) AS physical_pct,
            lc.contractor_name,
            lc.loa_date,
            lc.contract_value_cr,
            lt.cycle_status        AS tender_status,
            lt.awarded_value_cr,
            lt.estimated_value_cr
        FROM scheme_master sm
        LEFT JOIN scheme_phy       sp  ON sp.scheme_id = sm.scheme_id
        LEFT JOIN scheme_plant_phy spp ON spp.scheme_id = sm.scheme_id
        LEFT JOIN latest_contract  lc ON lc.scheme_id = sm.scheme_id
        LEFT JOIN latest_tender    lt ON lt.scheme_id = sm.scheme_id
        WHERE NOT sm.is_deleted
          AND (:s_type IS NULL OR sm.scheme_type = :s_type)
        ORDER BY sm.scheme_name
    """), {"s_type": scheme_type}).mappings().all()

    result = []
    for r in rows:
        d = dict(r)
        delay = float(d.get("delay_months") or 0)
        d["delay_category"] = (
            "on_time"  if delay <= 0 else
            "minor"    if delay <= 3 else
            "moderate" if delay <= 6 else
            "critical"
        )
        d["delay_color"] = {
            "on_time":  "#16a34a",
            "minor":    "#f59e0b",
            "moderate": "#f97316",
            "critical": "#dc2626",
        }[d["delay_category"]]
        result.append(d)
    return result


@router.get("/corporate/scheme/{scheme_id}")
def get_scheme_detail(scheme_id: int, db: Session = Depends(get_db)):
    """Full detail for one scheme: packages, tender cycles, contract."""
    scheme = db.execute(text("""
        SELECT scheme_id, scheme_name, scheme_type, current_status,
               COALESCE(sanctioned_cost_cr, estimated_cost_cr, 0) AS total_cost_cr,
               planned_completion_date, scheme_owner_name
        FROM scheme_master WHERE scheme_id = :s_id AND NOT is_deleted
    """), {"s_id": scheme_id}).mappings().first()

    if not scheme:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Scheme not found")

    packages = db.execute(text("""
        SELECT p.package_id, p.package_name, p.package_value_cr,
               p.planned_end_date,
               c.contractor_name, c.loa_date, c.effective_date,
               c.contract_value_cr,
               CASE WHEN pp.plan_id IS NOT NULL THEN TRUE ELSE FALSE END AS has_plan
        FROM packages p
        LEFT JOIN contracts c ON c.package_id = p.package_id AND NOT c.is_deleted
        LEFT JOIN progress_plans pp ON pp.package_id = p.package_id
            AND pp.is_locked = TRUE AND pp.is_current = TRUE
        WHERE p.scheme_id = :s_id AND NOT p.is_deleted
        ORDER BY p.package_id
    """), {"s_id": scheme_id}).mappings().all()

    tenders = db.execute(text("""
        SELECT tc.cycle_no, tc.cycle_status, tc.estimated_value_cr, tc.awarded_value_cr,
               tc.nit_date, tc.tod_original_date, tc.nit_number,
               p.package_name
        FROM tender_cycles tc
        JOIN packages p ON tc.package_id = p.package_id
        WHERE p.scheme_id = :s_id AND NOT tc.is_deleted
        ORDER BY tc.cycle_no
    """), {"s_id": scheme_id}).mappings().all()

    return {
        "scheme":   dict(scheme),
        "packages": [dict(r) for r in packages],
        "tenders":  [dict(r) for r in tenders],
    }


@router.get("/corporate/kpis")
def get_corporate_kpis(db: Session = Depends(get_db)):
    """High-level KPIs: counts, cost, avg delay."""
    row = db.execute(text("""
        SELECT
            COUNT(*)                                                              AS total_schemes,
            COUNT(*) FILTER (WHERE current_status = 'ongoing')                   AS ongoing,
            COUNT(*) FILTER (WHERE current_status = 'under_tendering')           AS under_tendering,
            COUNT(*) FILTER (WHERE current_status = 'closed')                    AS closed,
            ROUND(SUM(COALESCE(sanctioned_cost_cr, estimated_cost_cr, 0)), 2)    AS total_cost_cr,
            ROUND(
                AVG(
                    CASE
                        WHEN planned_completion_date IS NOT NULL
                         AND planned_completion_date < CURRENT_DATE
                        THEN (CURRENT_DATE - planned_completion_date)::float / 30.0
                        ELSE 0
                    END
                )::numeric, 1
            ) AS avg_delay_months
        FROM scheme_master
        WHERE NOT is_deleted
    """)).mappings().first()
    return dict(row) if row else {}
