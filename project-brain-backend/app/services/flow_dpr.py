"""
flow_dpr.py — DPR daily→monthly aggregation & month freeze (pure, DB-free).

daily_actuals (activity_id, actual_date, actual_qty) → monthly actual per
activity → freeze → cumulative baseline that feeds the next revision's
prior_actual.
"""
from __future__ import annotations


def _mkey(d) -> str:
    return str(d)[:7]


def aggregate_daily_to_monthly(daily: list, month: str) -> dict:
    """daily: [{activity_id, actual_date, actual_qty}]. month: 'YYYY-MM'.
    Returns {activity_id: summed actual_qty for that month}."""
    out: dict = {}
    for e in daily:
        if _mkey(e["actual_date"]) != month:
            continue
        out[e["activity_id"]] = out.get(e["activity_id"], 0.0) + float(e.get("actual_qty") or 0)
    return out


def freeze_month(prior_cumulative: dict, month_qty: dict, scope: dict) -> dict:
    """Freeze a month → new cumulative baseline per activity, capped at scope.
    prior_cumulative / month_qty / scope are {activity_id: value}."""
    frozen = {}
    for aid in set(prior_cumulative) | set(month_qty) | set(scope):
        cum = float(prior_cumulative.get(aid, 0)) + float(month_qty.get(aid, 0))
        cap = float(scope.get(aid, cum))
        frozen[aid] = min(cum, cap) if cap else cum
    return frozen


# =========================================================================== #
"""
flow_capex_rollover.py logic (kept in same module for packaging simplicity).
Multi-year carry: succeeding FY BE inherits cumulative actual to prior-FY close.
"""


def rollover_capex_to_next_fy(prev_rows: list) -> list:
    """prev_rows: [{row_id, scheme_id, name, gross, cumLast, actual_total_fy}].
    Returns next-FY seed rows where cumLast = prev cumLast + prev FY actual total,
    BE/RE reset to 0 (to be planned), gross carried."""
    out = []
    for r in prev_rows:
        new_cum = round(float(r.get("cumLast") or 0) + float(r.get("actual_total_fy") or 0), 2)
        out.append({
            "row_id": r.get("row_id"), "scheme_id": r.get("scheme_id"), "name": r.get("name"),
            "gross": float(r.get("gross") or 0), "cumLast": new_cum,
            "balance_to_plan": round(float(r.get("gross") or 0) - new_cum, 2),
            "beFY": 0.0, "reFY": 0.0, "months": {},
        })
    return out
