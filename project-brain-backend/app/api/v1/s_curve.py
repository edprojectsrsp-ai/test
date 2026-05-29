"""
S-Curve router — rewritten against the LIVE t5 progress chain (Sprint 0 Chunk 2).

Data model (t5):
    progress_plans (per PACKAGE, is_current flags the live plan)
      -> plan_activities (weight_pct within the package)
           -> monthly_plan_entries (planned_qty, by month_date)  [PLANNED]
           -> daily_actuals       (actual_qty, by actual_date)   [ACTUAL]

Endpoints (mounted at /api/v1/s-curve):
    GET /{scheme_id}            -> scheme-level curve, rolled up across all the
                                   scheme's packages using a CUSTOM package weight.
    GET /package/{package_id}   -> single-package curve.

Curve math:
    * Within a package, each activity contributes (weight_pct/100) * (qty as % of
      its own scope). We express monthly planned/actual as a % of total package
      scope-weight, then accumulate into a cumulative S-curve (0..100).
    * Across packages (scheme level), each package's cumulative % is combined
      using its package weight:
          weight = packages.extra_fields['scheme_rollup_weight']   (if set)
                   else package_value_cr
                   else package_estimate_cr
                   else equal weight (1.0)
      Result is a single 0..100 scheme curve.

Backward compatibility:
    The previous route GET /{scheme_id} is preserved (same path, same
    {"planned":[...], "actual":[...]} shape) so the existing frontend keeps
    working. A richer payload is returned alongside under extra keys; old keys
    are untouched.
"""

from collections import defaultdict
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.progress import (
    ProgressPlan,
    PlanActivity,
    MonthlyPlanEntry,
    DailyActual,
)
from app.models.scheme import Package

router = APIRouter(tags=["S-Curve"])

_MONTH_LABEL = {
    1: "Jan", 2: "Feb", 3: "Mar", 4: "Apr", 5: "May", 6: "Jun",
    7: "Jul", 8: "Aug", 9: "Sep", 10: "Oct", 11: "Nov", 12: "Dec",
}


def _month_first(d: date) -> date:
    return date(d.year, d.month, 1)


def _month_label(d: date) -> str:
    return f"{_MONTH_LABEL.get(d.month, d.month)}-{str(d.year)[2:]}"


def _current_plan_for_package(db: Session, package_id: int):
    """The single current, non-deleted plan for a package (latest if several)."""
    return (
        db.query(ProgressPlan)
        .filter(
            ProgressPlan.package_id == package_id,
            ProgressPlan.is_current.is_(True),
            ProgressPlan.is_deleted.is_(False),
        )
        .order_by(ProgressPlan.plan_id.desc())
        .first()
    )


def _package_curve(db: Session, package_id: int):
    """
    Build a single package's monthly planned & actual cumulative %-complete.
    Returns (months_sorted, planned_cum{month->pct}, actual_cum{month->pct},
             has_plan: bool).
    Percentages are of the package's total scope-weight (sum of activity scope*weight).
    """
    plan = _current_plan_for_package(db, package_id)
    if not plan:
        return [], {}, {}, False

    activities = (
        db.query(PlanActivity)
        .filter(
            PlanActivity.plan_id == plan.plan_id,
            PlanActivity.is_deleted.is_(False),
        )
        .all()
    )
    if not activities:
        return [], {}, {}, True

    # Per-activity scope & weight. Denominator = sum(weight_pct * scope_qty),
    # so a fully-completed plan reaches 100%.
    act_scope = {}
    act_weight = {}
    denom = 0.0
    for a in activities:
        w = float(a.weight_pct or 0)
        s = float(a.scope_qty or 0)
        act_weight[a.activity_id] = w
        act_scope[a.activity_id] = s
        denom += w * s
    if denom <= 0:
        # No usable scope/weight -> cannot compute a meaningful %; treat as empty.
        return [], {}, {}, True

    act_ids = list(act_scope.keys())

    # ---- PLANNED: monthly_plan_entries.planned_qty per activity per month ----
    planned_rows = (
        db.query(
            MonthlyPlanEntry.activity_id,
            MonthlyPlanEntry.month_date,
            func.sum(MonthlyPlanEntry.planned_qty).label("qty"),
        )
        .filter(MonthlyPlanEntry.activity_id.in_(act_ids))
        .group_by(MonthlyPlanEntry.activity_id, MonthlyPlanEntry.month_date)
        .all()
    )

    # ---- ACTUAL: daily_actuals.actual_qty bucketed to month ------------------
    actual_rows = (
        db.query(
            DailyActual.activity_id,
            DailyActual.actual_date,
            func.sum(DailyActual.actual_qty).label("qty"),
        )
        .filter(DailyActual.activity_id.in_(act_ids))
        .group_by(DailyActual.activity_id, DailyActual.actual_date)
        .all()
    )

    planned_month = defaultdict(float)   # month -> weighted contribution
    actual_month = defaultdict(float)

    for activity_id, m, qty in planned_rows:
        if m is None:
            continue
        mkey = _month_first(m)
        contrib = act_weight.get(activity_id, 0) * float(qty or 0)
        planned_month[mkey] += contrib

    for activity_id, d, qty in actual_rows:
        if d is None:
            continue
        mkey = _month_first(d)
        contrib = act_weight.get(activity_id, 0) * float(qty or 0)
        actual_month[mkey] += contrib

    all_months = sorted(set(planned_month) | set(actual_month))

    planned_cum, actual_cum = {}, {}
    run_p = run_a = 0.0
    for m in all_months:
        run_p += planned_month.get(m, 0.0)
        run_a += actual_month.get(m, 0.0)
        planned_cum[m] = min(100.0, round(100.0 * run_p / denom, 2))
        actual_cum[m] = min(100.0, round(100.0 * run_a / denom, 2))

    return all_months, planned_cum, actual_cum, True


def _package_weight(pkg: Package) -> float:
    """Custom rollup weight: extra_fields override -> value -> estimate -> 1.0."""
    ef = pkg.extra_fields or {}
    if isinstance(ef, dict) and ef.get("scheme_rollup_weight") not in (None, ""):
        try:
            w = float(ef["scheme_rollup_weight"])
            if w > 0:
                return w
        except (TypeError, ValueError):
            pass
    if pkg.package_value_cr:
        return float(pkg.package_value_cr)
    if pkg.package_estimate_cr:
        return float(pkg.package_estimate_cr)
    return 1.0


def _serialize_curve(months, planned_cum, actual_cum):
    planned = [{"month": _month_label(m), "value": planned_cum.get(m, 0.0)} for m in months]
    actual = [{"month": _month_label(m), "value": actual_cum.get(m, 0.0)} for m in months]
    return planned, actual


@router.get("/package/{package_id}")
def get_package_s_curve(package_id: int, db: Session = Depends(get_db)):
    """Single-package S-curve (planned vs actual cumulative %-complete)."""
    pkg = db.query(Package).filter(Package.package_id == package_id).first()
    if not pkg:
        raise HTTPException(status_code=404, detail="Package not found")

    months, planned_cum, actual_cum, has_plan = _package_curve(db, package_id)
    if not has_plan:
        raise HTTPException(status_code=404, detail="No current plan for this package")

    planned, actual = _serialize_curve(months, planned_cum, actual_cum)
    return {
        "package_id": package_id,
        "package_name": pkg.package_name,
        "planned": planned,
        "actual": actual,
    }


@router.get("/{scheme_id}")
def get_s_curve_data(scheme_id: int, db: Session = Depends(get_db)):
    """
    Scheme-level S-curve, rolled up across all the scheme's packages using a
    custom package weight. Preserves the legacy {"planned":[...], "actual":[...]}
    response shape; adds package breakdown under "packages".
    """
    packages = (
        db.query(Package)
        .filter(Package.scheme_id == scheme_id, Package.is_deleted.is_(False))
        .all()
    )
    if not packages:
        raise HTTPException(status_code=404, detail="No packages found for this scheme")

    # Compute each package's curve, collect the union of months.
    pkg_curves = []        # (package, months, planned_cum, actual_cum, weight)
    all_months = set()
    total_weight = 0.0
    for pkg in packages:
        months, planned_cum, actual_cum, has_plan = _package_curve(db, pkg.package_id)
        if not has_plan or not months:
            continue
        w = _package_weight(pkg)
        total_weight += w
        all_months |= set(months)
        pkg_curves.append((pkg, months, planned_cum, actual_cum, w))

    if not pkg_curves or total_weight <= 0:
        # No plan data anywhere yet -> empty curve rather than a hard error,
        # so the dashboard renders an empty chart instead of a 500.
        return {"planned": [], "actual": [], "packages": [], "note": "no plan data yet"}

    months_sorted = sorted(all_months)

    # Roll up: for each month, weighted average of each package's cumulative %.
    # A package that has not started by month m contributes its last-known cum
    # (0 before its first month), giving a correct blended scheme curve.
    def _cum_at(cum_map, month_list, m):
        last = 0.0
        for mm in month_list:
            if mm <= m:
                last = cum_map.get(mm, last)
            else:
                break
        return last

    planned_out, actual_out = [], []
    for m in months_sorted:
        wp = wa = 0.0
        for pkg, months, planned_cum, actual_cum, w in pkg_curves:
            wp += w * _cum_at(planned_cum, months, m)
            wa += w * _cum_at(actual_cum, months, m)
        planned_out.append({"month": _month_label(m), "value": round(wp / total_weight, 2)})
        actual_out.append({"month": _month_label(m), "value": round(wa / total_weight, 2)})

    package_breakdown = [
        {
            "package_id": pkg.package_id,
            "package_name": pkg.package_name,
            "weight": round(w, 4),
            "weight_source": (
                "custom" if (pkg.extra_fields or {}).get("scheme_rollup_weight")
                else "value" if pkg.package_value_cr
                else "estimate" if pkg.package_estimate_cr
                else "equal"
            ),
        }
        for pkg, _m, _p, _a, w in pkg_curves
    ]

    return {
        "planned": planned_out,
        "actual": actual_out,
        "packages": package_breakdown,
    }


# ─────────────── FY-filtered S-curve (Sprint 2) ───────────────────────────────

from fastapi import Query as _Query
from sqlalchemy import text as _text


def _fy_date_range(fy: str) -> tuple[date, date]:
    """Parse 'FY25-26' or '2025-26' → (2025-04-01, 2026-03-31)."""
    import re
    m = re.search(r"(\d{4})[-/](\d{2,4})", fy.replace("FY", ""))
    if m:
        y = int(m.group(1))
    else:
        y = date.today().year if date.today().month >= 4 else date.today().year - 1
    return date(y, 4, 1), date(y + 1, 3, 31)


@router.get("/fy/{scheme_id}")
def get_fy_s_curve(
    scheme_id: int,
    fy: str = _Query(..., description="Financial year, e.g. FY25-26 or 2025-26"),
    db: Session = Depends(get_db),
):
    """
    FY-filtered scheme S-curve with carry-forward.
    - Planned: monthly_plan_entries within the FY date range
    - Actual:  daily_actuals within the FY date range
    - Carry-forward offset: actuals_till_last_fy per activity (cumulative before this FY)
    Result curves start at the carry-forward % so the graph continues from where
    last FY ended, not from zero.
    """
    fy_start, fy_end = _fy_date_range(fy)

    rows = db.execute(_text("""
        WITH pkg_plans AS (
            SELECT pp.plan_id, p.package_id, p.package_name,
                   COALESCE(
                       CASE WHEN (p.extra_fields->>'scheme_rollup_weight') IS NOT NULL
                            AND (p.extra_fields->>'scheme_rollup_weight') != ''
                       THEN (p.extra_fields->>'scheme_rollup_weight')::float END,
                       p.package_value_cr, p.package_estimate_cr, 1.0
                   ) AS pkg_weight
            FROM progress_plans pp
            JOIN packages p ON pp.package_id = p.package_id
            WHERE p.scheme_id  = :s_id
              AND NOT p.is_deleted
              AND pp.is_current = TRUE
              AND NOT pp.is_deleted
        ),
        act_base AS (
            SELECT pa.activity_id, pa.plan_id, pa.weight_pct,
                   pa.scope_qty, pa.actuals_till_last_fy
            FROM plan_activities pa
            JOIN pkg_plans pp2 ON pa.plan_id = pp2.plan_id
            WHERE NOT pa.is_deleted AND pa.scope_qty > 0
        ),
        pkg_denom AS (
            SELECT ab.plan_id, SUM(ab.weight_pct * ab.scope_qty) AS denom
            FROM act_base ab
            GROUP BY ab.plan_id
        ),
        carry_forward AS (
            SELECT ab.plan_id,
                   SUM(ab.weight_pct * ab.actuals_till_last_fy) AS cf_contrib
            FROM act_base ab
            GROUP BY ab.plan_id
        ),
        monthly_planned AS (
            SELECT ab.plan_id,
                   DATE_TRUNC('month', mpe.month_date)::date AS mth,
                   SUM(ab.weight_pct * mpe.planned_qty) AS contrib
            FROM monthly_plan_entries mpe
            JOIN act_base ab ON mpe.activity_id = ab.activity_id
            WHERE mpe.month_date BETWEEN :fy_start AND :fy_end
            GROUP BY ab.plan_id, mth
        ),
        monthly_actual AS (
            SELECT ab.plan_id,
                   DATE_TRUNC('month', da.actual_date)::date AS mth,
                   SUM(ab.weight_pct * da.actual_qty) AS contrib
            FROM daily_actuals da
            JOIN act_base ab ON da.activity_id = ab.activity_id
            WHERE da.actual_date BETWEEN :fy_start AND :fy_end
            GROUP BY ab.plan_id, mth
        )
        SELECT
            pp2.package_id,
            pp2.package_name,
            pp2.pkg_weight,
            pd.denom,
            COALESCE(cf.cf_contrib, 0) AS cf_contrib,
            COALESCE(mp.mth, ma.mth) AS mth,
            COALESCE(mp.contrib, 0) AS plan_contrib,
            COALESCE(ma.contrib, 0) AS act_contrib
        FROM pkg_plans pp2
        JOIN pkg_denom  pd  ON pd.plan_id  = pp2.plan_id
        LEFT JOIN carry_forward cf ON cf.plan_id = pp2.plan_id
        FULL OUTER JOIN monthly_planned mp ON mp.plan_id = pp2.plan_id
        FULL OUTER JOIN monthly_actual  ma ON ma.plan_id = pp2.plan_id
                                           AND ma.mth = mp.mth
        ORDER BY pp2.package_id, mth
    """), {"s_id": scheme_id, "fy_start": fy_start, "fy_end": fy_end}).mappings().all()

    # Aggregate by month across packages
    from collections import defaultdict
    pkg_meta: dict = {}        # package_id -> {weight, denom, cf_contrib}
    pkg_monthly_plan: dict = defaultdict(dict)   # package_id -> {mth: contrib}
    pkg_monthly_act: dict  = defaultdict(dict)

    for r in rows:
        pid = r["package_id"]
        if pid not in pkg_meta:
            pkg_meta[pid] = {
                "name": r["package_name"],
                "weight": float(r["pkg_weight"] or 1),
                "denom":  float(r["denom"] or 1),
                "cf":     float(r["cf_contrib"] or 0),
            }
        if r["mth"]:
            m = r["mth"]
            pkg_monthly_plan[pid][m] = pkg_monthly_plan[pid].get(m, 0) + float(r["plan_contrib"] or 0)
            pkg_monthly_act[pid][m]  = pkg_monthly_act[pid].get(m, 0)  + float(r["act_contrib"]  or 0)

    if not pkg_meta:
        return {"planned": [], "actual": [], "fy": fy, "note": "No plan data for this FY"}

    total_weight = sum(m["weight"] for m in pkg_meta.values())
    all_months = sorted({m for pd in [*pkg_monthly_plan.values(), *pkg_monthly_act.values()] for m in pd})

    planned_out, actual_out = [], []
    for month in all_months:
        wp = wa = 0.0
        for pid, meta in pkg_meta.items():
            denom = meta["denom"]
            cf    = meta["cf"]
            w     = meta["weight"]
            # running cumulative plan up to this month
            run_p = cf + sum(v for m, v in pkg_monthly_plan[pid].items() if m <= month)
            run_a = cf + sum(v for m, v in pkg_monthly_act[pid].items()  if m <= month)
            pct_p = min(100.0, run_p / denom * 100) if denom > 0 else 0.0
            pct_a = min(100.0, run_a / denom * 100) if denom > 0 else 0.0
            wp += w * pct_p
            wa += w * pct_a
        planned_out.append({"month": _month_label(month), "value": round(wp / total_weight, 2)})
        actual_out.append({"month":  _month_label(month), "value": round(wa / total_weight, 2)})

    return {
        "planned": planned_out,
        "actual":  actual_out,
        "fy":      fy,
        "fy_start": fy_start.isoformat(),
        "fy_end":   fy_end.isoformat(),
        "packages": [
            {"package_id": pid, "package_name": m["name"], "weight": m["weight"],
             "carry_forward_pct": round(m["cf"] / m["denom"] * 100, 2) if m["denom"] > 0 else 0}
            for pid, m in pkg_meta.items()
        ],
    }
