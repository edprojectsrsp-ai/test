"""
flow_revision.py — Physical plan revision lifecycle (pure, DB-free).

Spec: multiple revisions R0,R1,R2… each with an Effective Month. On opening a
revision, actual progress up to the month BEFORE the effective month is
preserved read-only; only the balance scope is planjable from the effective
month on. Builds on flow_balance for the per-activity gate.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from datetime import date
from typing import Optional

try:
    from .flow_balance import activity_balance, _to_date, TOL
except ImportError:  # pragma: no cover - test helper path
    from flow_balance import activity_balance, _to_date, TOL


def revision_label(n: int) -> str:
    return f"R{n}"


@dataclass
class RevisionActivity:
    activity_id: int
    scope_qty: float
    prior_actual: float          # frozen cumulative actual to month before effective
    balance_scope: float         # scope - prior_actual (the only plannable qty)
    plannable_months: list       # window from effective month → later(scheduled,expected)
    locked_before: str           # 'YYYY-MM' months strictly before effective are read-only


@dataclass
class Revision:
    rev_no: int
    label: str
    effective_month: str
    activities: list             # list[RevisionActivity]
    based_on_rev: Optional[int]


def open_revision(
    prev_rev_no: Optional[int],
    effective_month,
    activities: list,            # [{activity_id, scope_qty, frozen_actual_to_prev_month,
                                 #   scheduled_finish, expected_finish}]
) -> Revision:
    """Create the next revision. frozen_actual_to_prev_month is the baseline that
    becomes read-only prior_actual (from the DPR freeze of the month before
    effective)."""
    new_no = 0 if prev_rev_no is None else prev_rev_no + 1
    eff = _to_date(effective_month)
    eff_key = f"{eff.year:04d}-{eff.month:02d}" if eff else ""
    out = []
    for a in activities:
        scope = float(a["scope_qty"] or 0)
        prior = float(a.get("frozen_actual_to_prev_month") or 0)
        bal = activity_balance(
            a["activity_id"], scope, prior, planned_cells={},
            effective_month=effective_month,
            scheduled_finish=a.get("scheduled_finish"),
            expected_finish=a.get("expected_finish"),
            weight_pct=a.get("weight_pct", 0),
        )
        out.append(RevisionActivity(
            activity_id=a["activity_id"], scope_qty=scope, prior_actual=prior,
            balance_scope=max(0.0, scope - prior),
            plannable_months=bal.window_months, locked_before=eff_key,
        ))
    return Revision(rev_no=new_no, label=revision_label(new_no),
                    effective_month=eff_key, activities=out, based_on_rev=prev_rev_no)


def validate_revision_plan(revision: Revision, planned_cells_by_activity: dict) -> dict:
    """Re-runs the balance gate for a populated revision. planned_cells_by_activity:
    {activity_id: {month: qty}}. Returns {ok, errors, submittable}.
    submittable == every activity exactly balanced (prior+planned == scope)."""
    try:
        from .flow_balance import validate_physical_plan
    except ImportError:  # pragma: no cover - test helper path
        from flow_balance import validate_physical_plan
    acts = []
    for ra in revision.activities:
        acts.append({
            "activity_id": ra.activity_id, "scope_qty": ra.scope_qty,
            "actuals_till_last_fy": ra.prior_actual,
            "planned_cells": planned_cells_by_activity.get(ra.activity_id, {}),
            "effective_month": revision.effective_month + "-01",
            "expected_completion_month": ra.plannable_months[-1] + "-01" if ra.plannable_months else None,
        })
    res = validate_physical_plan(acts)
    submittable = res["ok"] and all(b.balanced for b in res["balances"])
    res["submittable"] = submittable
    return res
