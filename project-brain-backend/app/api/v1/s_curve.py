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
