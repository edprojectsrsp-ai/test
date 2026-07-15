"""
flow_rollup.py — Package S-curve + weighted scheme rollup (pure, DB-free).

Matches app/api/v1/s_curve.py exactly:
  package:  denom = Σ(weight_pct × scope_qty)
            cum%[m] = min(100, 100 × Σ_{m'≤m} Σ_act(weight_pct × qty) / denom)
  scheme:   each package's cum% combined by package weight
            (scheme_rollup_weight → package_value_cr → package_estimate_cr → 1.0)
"""
from __future__ import annotations
from collections import defaultdict
from dataclasses import dataclass


def _mkey(d) -> str:
    s = str(d)
    return s[:7] if len(s) >= 7 else s


@dataclass
class Curve:
    months: list           # ['YYYY-MM', ...] sorted
    planned_cum: dict      # month -> cum %
    actual_cum: dict       # month -> cum %


def package_curve(activities: list, planned: list, actual: list) -> Curve:
    """activities: [{activity_id, weight_pct, scope_qty}]
       planned/actual: [{activity_id, month, qty}]  (month any YYYY-MM[-DD])"""
    weight, denom = {}, 0.0
    for a in activities:
        w = float(a.get("weight_pct") or 0)
        s = float(a.get("scope_qty") or 0)
        weight[a["activity_id"]] = w
        denom += w * s
    if denom <= 0:
        return Curve([], {}, {})

    p_month, a_month = defaultdict(float), defaultdict(float)
    for r in planned:
        p_month[_mkey(r["month"])] += weight.get(r["activity_id"], 0) * float(r.get("qty") or 0)
    for r in actual:
        a_month[_mkey(r["month"])] += weight.get(r["activity_id"], 0) * float(r.get("qty") or 0)

    months = sorted(set(p_month) | set(a_month))
    p_cum, a_cum = {}, {}
    rp = ra = 0.0
    for m in months:
        rp += p_month.get(m, 0.0)
        ra += a_month.get(m, 0.0)
        p_cum[m] = min(100.0, round(100.0 * rp / denom, 2))
        a_cum[m] = min(100.0, round(100.0 * ra / denom, 2))
    return Curve(months, p_cum, a_cum)


def package_weight(pkg: dict) -> float:
    """scheme_rollup_weight → package_value_cr → package_estimate_cr → 1.0
    (mirrors s_curve._package_weight)."""
    ef = pkg.get("extra_fields") or {}
    srw = ef.get("scheme_rollup_weight")
    if srw not in (None, ""):
        try:
            w = float(srw)
            if w > 0:
                return w
        except (TypeError, ValueError):
            pass
    if pkg.get("package_value_cr"):
        return float(pkg["package_value_cr"])
    if pkg.get("package_estimate_cr"):
        return float(pkg["package_estimate_cr"])
    return 1.0


def scheme_curve(packages: list) -> Curve:
    """packages: [{..weight source.., 'curve': Curve}]. Weighted combine across
    the union of all months; weights normalised so a complete scheme = 100%."""
    weights = [package_weight(p) for p in packages]
    total_w = sum(weights) or 1.0
    all_months = sorted({m for p in packages for m in p["curve"].months})
    p_cum, a_cum = {}, {}
    for m in all_months:
        sp = sa = 0.0
        for p, w in zip(packages, weights):
            c: Curve = p["curve"]
            sp += (w / total_w) * _last_at_or_before(c.planned_cum, c.months, m)
            sa += (w / total_w) * _last_at_or_before(c.actual_cum, c.months, m)
        p_cum[m] = round(min(100.0, sp), 2)
        a_cum[m] = round(min(100.0, sa), 2)
    return Curve(all_months, p_cum, a_cum)


def _last_at_or_before(cum: dict, months: list, m: str) -> float:
    """Cumulative value carried forward (step function) at month m."""
    val = 0.0
    for mm in months:
        if mm <= m:
            val = cum.get(mm, val)
        else:
            break
    return val
