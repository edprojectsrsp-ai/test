"""Earned Value Management engine.

Owner-side EVM computed monthly over a financial year (Apr..Mar), built ON TOP
of the already-verified fetchers in progress_summary.py — no new raw-table SQL:

  PV(m)  Planned Value   = exp_last_fy + Σ monthly_plan[Apr..m]        (Cr)
  AC(m)  Actual Cost     = exp_last_fy + Σ monthly_actual[Apr..m]      (Cr)
  EV(m)  Earned Value    = physical cumulative % complete at m × BAC   (Cr)
         physical cum% = lastFyActualPercent + currentFyActualPercent
         (weighted activity roll-up from scheme_physical_progress_by_month)
  BAC    Budget At Completion = gross_cost of the effective CAPEX plan (Cr)

Derived (all standard PMI/AACE definitions):
  SV = EV − PV        SPI = EV / PV
  CV = EV − AC        CPI = EV / AC
  EAC  = BAC / CPI                       (CPI-driven, default forecast)
  EAC_ac = AC + (BAC − EV)               (atypical-variance forecast)
  EAC_scr = AC + (BAC − EV) / (CPI·SPI)  (schedule-adjusted, worst case)
  ETC = EAC − AC      VAC = BAC − EAC
  TCPI = (BAC − EV) / (BAC − AC)         (efficiency needed to finish on BAC)

Months with no physical data yield EV=None and metrics degrade gracefully —
a scheme without a locked progress plan still gets its PV/AC curves.
"""
from __future__ import annotations

from datetime import date
from typing import Any, Optional

from app.services.progress_summary import (
    fiscal_month_dates,
    month_label,
    scheme_capex_financials,
    scheme_physical_progress_by_month,
)

# FY calendar month order: Apr..Dec, Jan..Mar
FY_MONTH_NOS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3]


def _r(v: Optional[float], nd: int = 4) -> Optional[float]:
    return None if v is None else round(float(v), nd)


def _div(a: Optional[float], b: Optional[float]) -> Optional[float]:
    if a is None or b is None or not b:
        return None
    return a / b


def health(cpi: Optional[float], spi: Optional[float]) -> str:
    """Traffic-light off the worse of the two indices (PSU review convention)."""
    worst = min(x for x in (cpi, spi) if x is not None) if (cpi or spi) else None
    if worst is None:
        return "unknown"
    if worst >= 0.95:
        return "green"
    if worst >= 0.85:
        return "amber"
    return "red"


def compute_series(
    bac: float,
    exp_last_fy: float,
    monthly_plan: dict[int, float],
    monthly_actual: dict[int, float],
    phys_cum_pct: dict[int, Optional[float]],
    upto_month_no: Optional[int] = None,
) -> list[dict[str, Any]]:
    """Pure EVM math — unit-testable without a database.

    monthly_plan / monthly_actual keyed by calendar month_no; phys_cum_pct is
    CUMULATIVE physical % complete (whole-project) keyed by month_no.
    upto_month_no truncates AC/EV metrics after the current data month so the
    tail of the FY doesn't read as CPI collapse.
    """
    out: list[dict[str, Any]] = []
    cum_plan = cum_act = 0.0
    reached_cutoff = False
    for mn in FY_MONTH_NOS:
        cum_plan += float(monthly_plan.get(mn, 0.0) or 0.0)
        pv = exp_last_fy + cum_plan

        if reached_cutoff:
            out.append({"month_no": mn, "pv": _r(pv), "ac": None, "ev": None,
                        "sv": None, "cv": None, "spi": None, "cpi": None,
                        "eac": None, "eac_ac": None, "eac_scr": None,
                        "etc": None, "vac": None, "tcpi": None,
                        "pct_planned": _r(_div(pv, bac) and _div(pv, bac) * 100, 2),
                        "pct_complete": None, "future": True})
            continue

        cum_act += float(monthly_actual.get(mn, 0.0) or 0.0)
        ac = exp_last_fy + cum_act
        pct = phys_cum_pct.get(mn)
        ev = (pct / 100.0) * bac if (pct is not None and bac) else None

        spi = _div(ev, pv)
        cpi = _div(ev, ac)
        eac = _div(bac, cpi)
        eac_ac = (ac + (bac - ev)) if ev is not None else None
        scr = (cpi * spi) if (cpi is not None and spi is not None) else None
        eac_scr = (ac + _div(bac - ev, scr)) if (ev is not None and scr) else None
        out.append({
            "month_no": mn,
            "pv": _r(pv), "ac": _r(ac), "ev": _r(ev),
            "sv": _r(ev - pv) if ev is not None else None,
            "cv": _r(ev - ac) if ev is not None else None,
            "spi": _r(spi), "cpi": _r(cpi),
            "eac": _r(eac), "eac_ac": _r(eac_ac), "eac_scr": _r(eac_scr),
            "etc": _r(eac - ac) if eac is not None else None,
            "vac": _r(bac - eac) if eac is not None else None,
            "tcpi": _r(_div(bac - ev, bac - ac)) if ev is not None else None,
            "pct_planned": _r(_div(pv, bac) and _div(pv, bac) * 100, 2),
            "pct_complete": _r(pct, 2),
            "future": False,
        })
        if upto_month_no is not None and mn == upto_month_no:
            reached_cutoff = True
    return out


def _current_fy_start_year(today: Optional[date] = None) -> int:
    d = today or date.today()
    return d.year if d.month >= 4 else d.year - 1


def _default_upto_month(fy_start_year: int, today: Optional[date] = None) -> Optional[int]:
    """Last complete data month of the FY: current month if the FY is the
    running one, all 12 months if it is a past FY, none if future."""
    d = today or date.today()
    cur = _current_fy_start_year(d)
    if fy_start_year < cur:
        return 3          # whole FY closed
    if fy_start_year > cur:
        return None       # future FY — PV only
    return d.month


def scheme_evm(db, scheme_id: int, fy_start_year: Optional[int] = None,
               today: Optional[date] = None) -> dict[str, Any]:
    """Full EVM package for one scheme over one FY."""
    fy_start_year = fy_start_year or _current_fy_start_year(today)
    fin = scheme_capex_financials(db, scheme_id, fy_start_year) or {}
    bac = float(fin.get("gross_cost") or 0.0)
    exp_last_fy = float(fin.get("exp_last_fy") or 0.0)

    phys = scheme_physical_progress_by_month(db, scheme_id, fy_start_year) or {}
    labels = {month_label(d): d.month for d in fiscal_month_dates(fy_start_year)}
    phys_cum: dict[int, Optional[float]] = {}
    for lbl, mn in labels.items():
        mv = phys.get(lbl)
        if mv is None:
            phys_cum[mn] = None
        else:
            phys_cum[mn] = float(mv.get("lastFyActualPercent") or 0.0) + \
                           float(mv.get("currentFyActualPercent") or 0.0)

    upto = _default_upto_month(fy_start_year, today)
    series = compute_series(bac, exp_last_fy, fin.get("monthly_plan") or {},
                            fin.get("monthly_actual") or {}, phys_cum, upto)

    latest = next((s for s in reversed(series)
                   if not s["future"] and s["ac"] is not None), None)
    return {
        "scheme_id": scheme_id,
        "fy": f"{fy_start_year}-{str(fy_start_year + 1)[2:]}",
        "bac": _r(bac), "exp_last_fy": _r(exp_last_fy),
        "be_fy": _r(fin.get("be_fy")), "re_fy": _r(fin.get("re_fy")),
        "has_physical": any(v is not None for v in phys_cum.values()),
        "series": series,
        "latest": latest,
        "health": health(latest and latest["cpi"], latest and latest["spi"]) if latest else "unknown",
    }


def portfolio_evm(db, fy_start_year: Optional[int] = None,
                  today: Optional[date] = None,
                  scheme_ids: Optional[list[int]] = None) -> dict[str, Any]:
    """Latest-month EVM snapshot for every active scheme (or a given subset),
    sorted worst-health first — the review-meeting exception list."""
    from sqlalchemy import text
    fy_start_year = fy_start_year or _current_fy_start_year(today)
    if scheme_ids is None:
        rows = db.execute(text(
            "SELECT scheme_id, scheme_name FROM scheme_master "
            "WHERE NOT COALESCE(is_deleted, FALSE) "
            "AND COALESCE(current_status, '') NOT IN ('Completed', 'Closed', 'Dropped') "
            "ORDER BY scheme_id")).mappings().all()
    else:
        rows = db.execute(text(
            "SELECT scheme_id, scheme_name FROM scheme_master "
            "WHERE scheme_id = ANY(:ids)"), {"ids": scheme_ids}).mappings().all()

    items = []
    for r in rows:
        e = scheme_evm(db, int(r["scheme_id"]), fy_start_year, today)
        latest = e["latest"] or {}
        if not e["bac"] and not latest:
            continue  # nothing planned, nothing spent — skip noise
        items.append({
            "scheme_id": int(r["scheme_id"]), "scheme_name": r["scheme_name"],
            "bac": e["bac"], "health": e["health"],
            "has_physical": e["has_physical"],
            **{k: latest.get(k) for k in
               ("month_no", "pv", "ev", "ac", "spi", "cpi", "eac", "vac", "tcpi",
                "pct_planned", "pct_complete")},
        })
    order = {"red": 0, "amber": 1, "unknown": 2, "green": 3}
    items.sort(key=lambda x: (order.get(x["health"], 2),
                              x["spi"] if x["spi"] is not None else 9))
    counts = {"red": 0, "amber": 0, "green": 0, "unknown": 0}
    for it in items:
        counts[it["health"]] = counts.get(it["health"], 0) + 1
    return {"fy": f"{fy_start_year}-{str(fy_start_year + 1)[2:]}",
            "counts": counts, "schemes": items}
