"""
flow_balance.py — Balance & revision gate for Project Brain (pure, DB-free).

Implements the spec's hard balance rules so they can be enforced at the API
boundary and unit-tested independently:

  PHYSICAL (per activity, per plan revision):
    actuals_till_last_fy  +  sum(planned cells from effective month on)  =  scope_qty
    - prior actuals are read-only and preserved
    - planning is permitted ONLY in the activity's permissible window
      (effective month .. expected_completion_month, where Expected may extend
       beyond Scheduled finish)
    - planning may never exceed scope (100%)

  CAPEX (per row, per BE/RE revision):
    cumulative_actual (cumLast + actual)  +  remaining_plan  <=  sanctioned (beFY/reFY)
    - pre-effective RE auto-fills from actual (read overlay)
    - next FY cumLast auto-inherits prior FY (cumLast + sum(actual))

Field names match the live routers (capex.py / plan_engine.py) so the dataclass
inputs map 1:1 onto what those endpoints already hold.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from datetime import date
from typing import Optional

TOL = 0.01
FY_ORDER = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3]  # Apr..Mar


# --------------------------------------------------------------------------- #
#  Month helpers (mirror capex._is_pre_effective)
# --------------------------------------------------------------------------- #
def fy_index(month_no: int) -> int:
    return FY_ORDER.index(month_no)


def is_pre_effective(month_no: int, effective_month: int) -> bool:
    try:
        return fy_index(month_no) < fy_index(effective_month)
    except ValueError:
        return False


def _ym(d) -> str:
    if isinstance(d, date):
        return f"{d.year:04d}-{d.month:02d}"
    return str(d)[:7]


# =========================================================================== #
#  PHYSICAL PROGRESS BALANCE
# =========================================================================== #
@dataclass
class ActivityBalance:
    activity_id: int
    scope_qty: float
    prior_actual: float                 # actuals_till_last_fy (read-only)
    planned_balance: float              # sum of planned cells from effective month on
    remaining: float                    # scope - prior_actual  (what may be planned)
    total: float                        # prior_actual + planned_balance
    over_by: float                      # > 0 means plan exceeds scope (illegal)
    balanced: bool                      # total == scope within tolerance
    within_scope: bool                  # total <= scope
    window_months: list                 # permissible YYYY-MM months
    window_violations: list             # planned months outside the window
    weight_pct: float = 0.0

    @property
    def progress_pct(self) -> float:
        return round((self.total / self.scope_qty) * 100, 2) if self.scope_qty else 0.0


def permissible_window(effective_month, scheduled_finish, expected_finish) -> list:
    """Months a planner may fill: from effective month to the LATER of scheduled
    and expected finish (Expected extends beyond Scheduled when work slips)."""
    start = _to_date(effective_month)
    sched = _to_date(scheduled_finish)
    exp = _to_date(expected_finish)
    ends = [d for d in (sched, exp) if d is not None]
    if start is None or not ends:
        return []
    end = max(ends)
    months, cur = [], date(start.year, start.month, 1)
    end = date(end.year, end.month, 1)
    while cur <= end:
        months.append(f"{cur.year:04d}-{cur.month:02d}")
        cur = date(cur.year + 1, 1, 1) if cur.month == 12 else date(cur.year, cur.month + 1, 1)
    return months


def _to_date(v) -> Optional[date]:
    if v is None:
        return None
    if isinstance(v, date):
        return v
    s = str(v)[:10]
    try:
        parts = s.split("-")
        return date(int(parts[0]), int(parts[1]), int(parts[2]) if len(parts) > 2 else 1)
    except (ValueError, IndexError):
        return None


def activity_balance(
    activity_id: int,
    scope_qty: float,
    prior_actual: float,                       # actuals_till_last_fy
    planned_cells: dict,                       # {month_date(str|date): planned_qty}
    effective_month,
    scheduled_finish=None,
    expected_finish=None,
    weight_pct: float = 0.0,
) -> ActivityBalance:
    scope_qty = float(scope_qty or 0)
    prior_actual = float(prior_actual or 0)
    window = permissible_window(effective_month, scheduled_finish, expected_finish)
    window_set = set(window)

    planned_balance = 0.0
    violations = []
    for m, qty in (planned_cells or {}).items():
        mkey = _ym(m)
        qv = float(qty or 0)
        planned_balance += qv
        if window and qv > 0 and mkey not in window_set:
            violations.append(mkey)

    total = prior_actual + planned_balance
    remaining = max(0.0, scope_qty - prior_actual)
    over_by = max(0.0, total - scope_qty)
    return ActivityBalance(
        activity_id=activity_id, scope_qty=scope_qty, prior_actual=prior_actual,
        planned_balance=planned_balance, remaining=remaining, total=total,
        over_by=over_by, balanced=abs(total - scope_qty) <= TOL,
        within_scope=total <= scope_qty + TOL, window_months=window,
        window_violations=violations, weight_pct=float(weight_pct or 0),
    )


def validate_physical_plan(activities: list) -> dict:
    """activities: list of dicts with keys matching activity_balance args.
    Returns {ok, errors[], balances[]}. ok == every activity within scope &
    no window violations (balanced is reported but not required until submit)."""
    balances, errors = [], []
    for a in activities:
        b = activity_balance(
            a["activity_id"], a["scope_qty"], a.get("prior_actual", a.get("actuals_till_last_fy", 0)),
            a.get("planned_cells", {}), a["effective_month"],
            a.get("scheduled_finish"), a.get("expected_finish", a.get("expected_completion_month")),
            a.get("weight_pct", 0),
        )
        balances.append(b)
        if not b.within_scope:
            errors.append({"activity_id": b.activity_id, "code": "EXCEEDS_SCOPE",
                           "msg": f"Plan exceeds scope by {round(b.over_by, 2)} (scope {b.scope_qty}, prior {b.prior_actual}).",
                           "over_by": round(b.over_by, 2)})
        if b.window_violations:
            errors.append({"activity_id": b.activity_id, "code": "OUTSIDE_WINDOW",
                           "msg": f"Planned in locked months: {', '.join(b.window_violations)}.",
                           "months": b.window_violations})
    return {"ok": len(errors) == 0, "errors": errors, "balances": balances}


def weighted_progress_percent(rows: list, value_key: str) -> float:
    """Σ (weight_fraction × qty/scope) × 100. Matches s_curve weighting &
    the competitor's weighted_progress_percent. Falls back to Σqty/Σscope."""
    weighted, has_weight = 0.0, False
    for r in rows:
        raw = float(r.get("weight_pct") or r.get("weightPercent") or 0)
        wf = raw / 100 if raw > 1 else raw
        if wf <= 0:
            continue
        has_weight = True
        scope = float(r.get("scope_qty") or r.get("scope") or 0)
        qty = float(r.get(value_key) or 0)
        if scope:
            weighted += wf * (qty / scope)
    if has_weight:
        return round(weighted * 100, 4)
    tot_scope = sum(float(r.get("scope_qty") or r.get("scope") or 0) for r in rows)
    tot_qty = sum(float(r.get(value_key) or 0) for r in rows)
    return round((tot_qty / tot_scope) * 100, 4) if tot_scope else 0.0


def scheme_rollup_percent(packages: list, value_key: str = "actual_pct") -> float:
    """packages: [{weight, <value_key>}]. Weighted mean, weights normalised."""
    tot_w = sum(float(p.get("weight") or 0) for p in packages)
    if tot_w <= 0:
        return 0.0
    return round(sum(float(p.get("weight") or 0) * float(p.get(value_key) or 0) for p in packages) / tot_w, 2)


# =========================================================================== #
#  CAPEX BALANCE
# =========================================================================== #
@dataclass
class CapexRowBalance:
    sanctioned: float                  # approved BE or RE (the plan total)
    cum_last_fy: float                 # cumulative_exp_till_last_fy
    actual_current_fy: float
    cumulative_actual: float           # cum_last_fy + actual_current_fy
    remaining_plan: float              # planned spend from effective month on
    balance: float                     # sanctioned - cumulative_actual
    within_sanction: bool              # cumulative_actual + remaining_plan <= sanctioned
    over_by: float
    progress_pct: float
    monthly_plan: dict                 # {month_no: plan value (RE overlay applied)}
    monthly_actual: dict


def capex_row_balance(
    gross: float, cum_last: float,
    months: dict,                      # {month_no(int): {"be","re","actual"}}
    plan_type: str = "BE",
    effective_month: Optional[int] = None,
    sanctioned: Optional[float] = None,   # beFY/reFY; if None, derived from plan total
) -> CapexRowBalance:
    plan_type = (plan_type or "BE").upper()
    be_tot = re_tot = actual_tot = 0.0
    monthly_plan, monthly_actual = {}, {}
    for m_no, mv in (months or {}).items():
        m = int(m_no)
        be = float((mv or {}).get("be") or 0)
        re = (mv or {}).get("re")
        re = float(re) if re is not None else None
        actual = float((mv or {}).get("actual") or 0)
        be_tot += be
        actual_tot += actual
        if plan_type == "RE" and effective_month is not None:
            # pre-effective RE = actual (auto-fill); post-effective = stored RE
            plan_v = actual if is_pre_effective(m, effective_month) else (re or 0.0)
            re_tot += plan_v
        else:
            re_tot += re or 0.0
        plan_v = (actual if (plan_type == "RE" and effective_month is not None and is_pre_effective(m, effective_month))
                  else (re if (plan_type == "RE" and re is not None) else be))
        monthly_plan[m] = float(plan_v or 0)
        monthly_actual[m] = actual

    plan_total = re_tot if (plan_type == "RE") else be_tot
    sanc = float(sanctioned) if sanctioned is not None else plan_total
    cumulative_actual = float(cum_last or 0) + actual_tot
    remaining = sum(v for m, v in monthly_plan.items()
                    if effective_month is None or not is_pre_effective(m, effective_month))
    over_by = max(0.0, (cumulative_actual + remaining) - sanc)
    return CapexRowBalance(
        sanctioned=round(sanc, 2), cum_last_fy=float(cum_last or 0), actual_current_fy=round(actual_tot, 2),
        cumulative_actual=round(cumulative_actual, 2), remaining_plan=round(remaining, 2),
        balance=round(sanc - cumulative_actual, 2),
        within_sanction=(cumulative_actual + remaining) <= sanc + TOL, over_by=round(over_by, 2),
        progress_pct=round((actual_tot / plan_total) * 100, 2) if plan_total else 0.0,
        monthly_plan=monthly_plan, monthly_actual=monthly_actual,
    )


def next_fy_cum_last(prev_cum_last: float, prev_fy_actual_total: float) -> float:
    """Succeeding FY's cumLast auto-inherits prior FY close (spec: multi-year)."""
    return round(float(prev_cum_last or 0) + float(prev_fy_actual_total or 0), 2)


def validate_capex_plan(rows: list, plan_type: str, effective_month: Optional[int]) -> dict:
    """rows: [{gross, cumLast, months, sanctioned?}]. Returns ok/errors/balances."""
    balances, errors = [], []
    for i, r in enumerate(rows):
        b = capex_row_balance(r.get("gross", 0), r.get("cumLast", 0), r.get("months", {}),
                              plan_type, effective_month, r.get("sanctioned"))
        balances.append(b)
        if not b.within_sanction:
            errors.append({"row": i, "code": "EXCEEDS_SANCTION",
                           "msg": f"Cumulative actual + plan exceeds sanctioned by {b.over_by} "
                                  f"(sanctioned {b.sanctioned}).", "over_by": b.over_by})
    return {"ok": len(errors) == 0, "errors": errors, "balances": balances}
