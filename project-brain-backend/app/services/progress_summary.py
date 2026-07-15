"""Unified physical-progress computation service (t5 schema).

Single source of truth for the DPR summary, dashboard physical-progress views
and the MoS / PMC reports so every screen shows the same numbers — mirrors the
reference implementation's `daily_progress()` / `build_dpr_summary_model()`
math exactly:

  * per-activity FTM / current-FY / cumulative plan-vs-actual with weighted
    overall row (weight_pct; scope-proportional when no weights)
  * actuals fallback chain: activity_id → exact activity_name → normalized
    activity_name across ALL plans of the scheme (so revised plans keep old
    actuals)
  * a Capex row appended to the summary (excluded from physical weighting)
  * per-month physical progress lookup for reports:
      i.  actual % till previous FY
      ii. planned % during current FY (full-year plan)
      iii.actual % till selected month
  * per-month PMC activity rows (overall target / cumulative / month target /
    next-month target / achievement)
  * monthly remarks keyword scan (started / completed / under progress)
  * multi-version S-curve trend model (Original Plan vs Revisions overlay)
"""

from __future__ import annotations

import calendar
import re
from datetime import date, timedelta

from sqlalchemy import text

MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
              "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


# ─────────────────────────── date / label helpers ───────────────────────────

def normalize_activity_text(value) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").strip().lower()).strip()


def month_label(d: date) -> str:
    return f"{MONTH_ABBR[d.month - 1]}-{str(d.year)[2:]}"


def month_label_date(label: str):
    try:
        mon, yy = str(label or "").strip().split("-")
        return date(2000 + int(yy), MONTH_ABBR.index(mon) + 1, 1)
    except (ValueError, IndexError):
        return None


def fy_start_year_for(d: date) -> int:
    return d.year if d.month >= 4 else d.year - 1


def fy_label_for(d: date) -> str:
    y = fy_start_year_for(d)
    return f"{y}-{str(y + 1)[2:]}"


def fiscal_month_dates(fy_start_year: int):
    """First-of-month dates Apr..Mar of the financial year."""
    return ([date(fy_start_year, m, 1) for m in range(4, 13)]
            + [date(fy_start_year + 1, m, 1) for m in range(1, 4)])


def fiscal_month_labels(fy_start_year: int):
    return [month_label(d) for d in fiscal_month_dates(fy_start_year)]


def month_end(d: date) -> date:
    return date(d.year, d.month, calendar.monthrange(d.year, d.month)[1])


def _f(value) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


# ─────────────────────────── data loading ────────────────────────────────────

def scheme_current_activities(db, scheme_id: int, package_id: int | None = None):
    """Leaf activities of the locked+current plan of every package of the scheme
    (optionally restricted to one package)."""
    pkg_sql = "AND pkg.package_id = :pkg" if package_id else ""
    rows = db.execute(text(f"""
        SELECT pa.activity_id, pa.activity_name, pa.activity_category,
               COALESCE(um.uom_code, '')            AS uom,
               COALESCE(pa.scope_qty, 0)            AS scope_qty,
               COALESCE(pa.weight_pct, 0)           AS weight_pct,
               COALESCE(pa.actuals_till_last_fy, 0) AS actuals_till_last_fy,
               pa.planned_start_date, pa.planned_finish_date,
               pa.expected_finish_date, pa.sort_order,
               pp.plan_id, pp.package_id, pkg.package_name
        FROM plan_activities pa
        JOIN progress_plans pp ON pp.plan_id = pa.plan_id
        JOIN packages pkg      ON pkg.package_id = pp.package_id
        LEFT JOIN uom_master um ON um.uom_id = pa.uom_id
        WHERE pkg.scheme_id = :sid
          AND pp.is_locked = TRUE AND pp.is_current = TRUE
          AND NOT pp.is_deleted AND NOT pa.is_deleted AND NOT pkg.is_deleted
          {pkg_sql}
        ORDER BY pp.package_id, pa.sort_order, pa.activity_id
    """), {"sid": scheme_id, "pkg": package_id}).mappings().all()
    return [dict(r) for r in rows]


def scheme_daily_actuals(db, scheme_id: int, upto: date | None = None,
                         package_id: int | None = None):
    """All daily actuals of the scheme across EVERY plan version, with the
    activity name they were recorded against (for the fallback chain).
    Optionally restricted to one package so a package-filtered summary never
    picks up same-named activities from sibling packages."""
    date_sql = "AND da.actual_date <= CAST(:upto AS date)" if upto else ""
    pkg_sql = "AND pkg.package_id = :pkg" if package_id else ""
    params = {"sid": scheme_id, "pkg": package_id}
    if upto:
        params["upto"] = upto
    rows = db.execute(text(f"""
        SELECT da.activity_id, da.actual_date, COALESCE(da.actual_qty, 0) AS actual_qty,
               pa.activity_name, COALESCE(pa.activity_category, '') AS activity_category
        FROM daily_actuals da
        JOIN plan_activities pa ON pa.activity_id = da.activity_id
        JOIN progress_plans pp  ON pp.plan_id = pa.plan_id
        JOIN packages pkg       ON pkg.package_id = pp.package_id
        WHERE pkg.scheme_id = :sid {date_sql} {pkg_sql}
    """), params).mappings().all()
    return [dict(r) for r in rows]


class ActualsIndex:
    """Sums actuals by activity_id and by normalized activity name so a revised
    plan's activities still pick up quantities recorded against earlier plans."""

    def __init__(self, actual_rows):
        self.by_id = {}          # activity_id -> {date: qty}
        self.by_name = {}        # normalized name -> {date: qty}
        for r in actual_rows:
            d = r["actual_date"]
            qty = _f(r["actual_qty"])
            self.by_id.setdefault(int(r["activity_id"]), {})
            self.by_id[int(r["activity_id"])][d] = self.by_id[int(r["activity_id"])].get(d, 0.0) + qty
            key = self.activity_key(r.get("activity_category"), r["activity_name"])
            self.by_name.setdefault(key, {})
            self.by_name[key][d] = self.by_name[key].get(d, 0.0) + qty

    @staticmethod
    def activity_key(activity_category: str, activity_name: str) -> str:
        return normalize_activity_text(f"{activity_category} -> {activity_name}")

    def _sum(self, bucket, start=None, end=None):
        if not bucket:
            return 0.0
        return sum(q for d, q in bucket.items()
                   if (start is None or d >= start) and (end is None or d <= end))

    def sum_for(self, activity_id: int, activity_name: str, activity_category: str = "",
                start=None, end=None) -> float:
        direct = self._sum(self.by_id.get(int(activity_id)), start, end)
        if direct:
            return direct
        key = self.activity_key(activity_category, activity_name)
        return self._sum(self.by_name.get(key), start, end)

    def monthly_for(self, activity_id: int, activity_name: str):
        bucket = self.by_id.get(int(activity_id))
        if not bucket:
            bucket = self.by_name.get(normalize_activity_text(activity_name)) or {}
        out = {}
        for d, q in bucket.items():
            lbl = month_label(d)
            out[lbl] = out.get(lbl, 0.0) + q
        return out


def scheme_monthly_plans(db, scheme_id: int, plan_ids=None):
    """monthly_plan_entries grouped by activity_id → {month_date: qty}."""
    plan_sql = "AND pa.plan_id = ANY(:plan_ids)" if plan_ids else \
               "AND pp.is_locked = TRUE AND pp.is_current = TRUE"
    params = {"sid": scheme_id}
    if plan_ids:
        params["plan_ids"] = list(plan_ids)
    rows = db.execute(text(f"""
        SELECT mpe.activity_id, mpe.month_date, COALESCE(SUM(mpe.planned_qty), 0) AS planned_qty
        FROM monthly_plan_entries mpe
        JOIN plan_activities pa ON pa.activity_id = mpe.activity_id
        JOIN progress_plans pp  ON pp.plan_id = pa.plan_id
        JOIN packages pkg       ON pkg.package_id = pp.package_id
        WHERE pkg.scheme_id = :sid
          AND NOT pa.is_deleted AND NOT pp.is_deleted
          {plan_sql}
        GROUP BY mpe.activity_id, mpe.month_date
    """), params).mappings().all()
    out = {}
    for r in rows:
        out.setdefault(int(r["activity_id"]), {})[r["month_date"]] = _f(r["planned_qty"])
    return out


def scheme_capex_financials(db, scheme_id: int, fy_start_year: int,
                            package_id: int | None = None):
    """Scheme CAPEX: gross cost, last-FY expenditure, monthly plan/actual by
    calendar month number (Apr=4..Mar=3) for the given FY."""
    fy = f"{fy_start_year}-{str(fy_start_year + 1)[2:]}"
    if package_id:
        stored = db.execute(text("""
            SELECT extra_fields->'friend_capex_by_fy'->:fy AS capex
            FROM packages WHERE package_id = :pkg AND NOT is_deleted
        """), {"fy": fy, "pkg": package_id}).scalar()
        if not stored:
            return None
        return {
            "gross_cost": _f(stored.get("gross_cost")),
            "exp_last_fy": _f(stored.get("exp_last_fy")),
            "be_fy": 0.0,
            "re_fy": 0.0,
            "monthly_plan": {int(k): _f(v) for k, v in (stored.get("monthly_plan") or {}).items()},
            "monthly_actual": {int(k): _f(v) for k, v in (stored.get("monthly_actual") or {}).items()},
        }
    head = db.execute(text("""
        SELECT COALESCE(SUM(v.gross_cost), 0)                   AS gross_cost,
               COALESCE(SUM(v.cumulative_exp_till_last_fy), 0)  AS exp_last_fy,
               COALESCE(SUM(v.be_fy), 0) AS be_fy, COALESCE(SUM(v.re_fy), 0) AS re_fy
        FROM capex_plan_rows r
        JOIN capex_plan_header h ON h.id = r.plan_id
        LEFT JOIN capex_plan_values v ON v.plan_row_id = r.id
        WHERE r.scheme_id = :sid AND h.fy_year = :fy
          AND (h.is_effective = 1 OR NOT EXISTS (
                SELECT 1 FROM capex_plan_header h2
                WHERE h2.fy_year = :fy AND h2.is_effective = 1))
    """), {"sid": scheme_id, "fy": fy}).mappings().first() or {}

    plan_rows = db.execute(text("""
        SELECT cmv.month_no,
               COALESCE(SUM(CASE WHEN h.plan_type = 'RE' THEN cmv.re_amount
                                 ELSE cmv.be_amount END), 0) AS planned
        FROM capex_month_values cmv
        JOIN capex_plan_rows r ON r.id = cmv.plan_row_id
        JOIN capex_plan_header h ON h.id = r.plan_id
        WHERE r.scheme_id = :sid AND h.fy_year = :fy
          AND (h.is_effective = 1 OR NOT EXISTS (
                SELECT 1 FROM capex_plan_header h2
                WHERE h2.fy_year = :fy AND h2.is_effective = 1))
        GROUP BY cmv.month_no
    """), {"sid": scheme_id, "fy": fy}).mappings().all()
    monthly_plan = {int(r["month_no"]): _f(r["planned"]) for r in plan_rows}

    act_rows = db.execute(text("""
        SELECT a.month_no, COALESCE(SUM(a.amount), 0) AS actual
        FROM capex_actuals a
        JOIN capex_plan_rows r ON r.id = a.plan_row_id
        WHERE r.scheme_id = :sid AND a.fy_year = :fy
        GROUP BY a.month_no
    """), {"sid": scheme_id, "fy": fy}).mappings().all()
    monthly_actual = {int(r["month_no"]): _f(r["actual"]) for r in act_rows}

    return {
        "gross_cost": _f(head.get("gross_cost")),
        "exp_last_fy": _f(head.get("exp_last_fy")),
        "be_fy": _f(head.get("be_fy")),
        "re_fy": _f(head.get("re_fy")),
        "monthly_plan": monthly_plan,      # keyed by calendar month number
        "monthly_actual": monthly_actual,
    }


# ─────────────────────────── DPR summary model ───────────────────────────────

def build_dpr_summary_model(scope_rows, report_date: date):
    """Weighted summary — port of the reference build_dpr_summary_model."""
    def percent(numerator, denominator):
        denominator = _f(denominator)
        return round((_f(numerator) / denominator) * 100, 2) if denominator else 0.0

    rows = []
    total_scope = total_weighted_plan = total_weighted_actual = 0.0
    total_cumulative_plan = total_cumulative_actual = 0.0
    # weighted column totals for the statics-report Over All row
    weighted_cols = {"lastFyActualPercent": 0.0, "ftmPlanPercent": 0.0,
                     "ftmActualPercent": 0.0, "currentFyPlanPercent": 0.0,
                     "currentFyActualPercent": 0.0}

    for source in scope_rows or []:
        row = dict(source or {})
        scope = _f(row.get("scope"))
        weight = _f(row.get("weightPercent"))
        weight_fraction = weight / 100 if weight > 1 else (weight if weight > 0 else 0)
        cumulative_plan = _f(row.get("cumulativePlan"))
        cumulative_actual = _f(row.get("cumulativeActual"))
        row.update({
            "lastFyActualPercent": percent(row.get("lastFyActual"), scope),
            "ftmPlanPercent": percent(row.get("ftmPlan"), scope),
            "ftmActualPercent": percent(row.get("ftmActual"), scope),
            "currentFyPlanPercent": percent(row.get("currentFyPlan"), scope),
            "currentFyActualPercent": percent(row.get("currentFyActual"), scope),
            "cumulativePlanPercent": percent(cumulative_plan, scope),
            "cumulativeActualPercent": percent(cumulative_actual, scope),
        })
        rows.append(row)
        if row.get("source") != "capex":
            total_scope += scope
            total_weighted_plan += weight_fraction * row["cumulativePlanPercent"]
            total_weighted_actual += weight_fraction * row["cumulativeActualPercent"]
            total_cumulative_plan += cumulative_plan
            total_cumulative_actual += cumulative_actual
            for key in weighted_cols:
                weighted_cols[key] += weight_fraction * row[key]

    if not any(_f(row.get("weightPercent")) for row in rows if row.get("source") != "capex") and total_scope:
        total_weighted_plan = percent(total_cumulative_plan, total_scope)
        total_weighted_actual = percent(total_cumulative_actual, total_scope)
        qty_keys = {"lastFyActualPercent": "lastFyActual", "ftmPlanPercent": "ftmPlan",
                    "ftmActualPercent": "ftmActual", "currentFyPlanPercent": "currentFyPlan",
                    "currentFyActualPercent": "currentFyActual"}
        for pct_key, qty_key in qty_keys.items():
            qty_total = sum(_f(row.get(qty_key)) for row in rows if row.get("source") != "capex")
            weighted_cols[pct_key] = percent(qty_total, total_scope)

    overall_row = {
        "id": "overall", "overall": True,
        "category": "Overall Progress", "activity": "Overall Progress",
        "scope": round(total_scope, 2),
        "cumulativePlan": round(total_cumulative_plan, 2),
        "cumulativeActual": round(total_cumulative_actual, 2),
        "cumulativePlanPercent": round(total_weighted_plan, 2),
        "cumulativeActualPercent": round(total_weighted_actual, 2),
        **{key: round(value, 2) for key, value in weighted_cols.items()},
    }
    fy_start = fy_start_year_for(report_date)
    return {
        "selectedMonthEnd": report_date.isoformat(),
        "financialYear": fy_label_for(report_date),
        "financialYearLabel": f"FY {fy_start}-{fy_start + 1}",
        "totals": {
            "scope": round(total_scope, 2),
            "plannedPercent": round(total_weighted_plan, 2),
            "actualPercent": round(total_weighted_actual, 2),
            "cumulativePlan": round(total_cumulative_plan, 2),
            "cumulativeActual": round(total_cumulative_actual, 2),
        },
        "summaryRows": [overall_row] + rows,
    }


def scheme_progress_summary(db, scheme_id: int, report_date: date, include_capex: bool = True,
                            package_id: int | None = None):
    """The one summary every screen uses (DPR Summary tab, dashboards, reports).
    With package_id, only that package's activities are summarised. A package
    CAPEX row is included when an authoritative package snapshot is available."""
    activities = scheme_current_activities(db, scheme_id, package_id)
    fy_start_year = fy_start_year_for(report_date)
    fy_start = date(fy_start_year, 4, 1)
    m_start = report_date.replace(day=1)
    m_end = month_end(report_date)
    fiscal_labels = fiscal_month_labels(fy_start_year)
    active_label = month_label(report_date)
    active_index = fiscal_labels.index(active_label) if active_label in fiscal_labels else -1
    next_label = fiscal_labels[active_index + 1] if 0 <= active_index < len(fiscal_labels) - 1 else ""

    index = ActualsIndex(scheme_daily_actuals(db, scheme_id, package_id=package_id))
    monthly_plans = scheme_monthly_plans(db, scheme_id)

    scope_rows = []
    for a in activities:
        aid, name = int(a["activity_id"]), a["activity_name"]
        plan_by_month = monthly_plans.get(aid, {})
        ftm_plan = sum(q for d, q in plan_by_month.items() if d == m_start)
        next_month_start = ((m_start.replace(year=m_start.year + 1, month=1)
                             if m_start.month == 12 else m_start.replace(month=m_start.month + 1))
                            if next_label else None)
        next_month_plan = sum(q for d, q in plan_by_month.items() if d == next_month_start)
        current_fy_plan = sum(q for d, q in plan_by_month.items() if fy_start <= d <= m_start)
        stored_last_fy = _f(a["actuals_till_last_fy"])
        category = a["activity_category"] or ""
        last_fy_actual = stored_last_fy or index.sum_for(
            aid, name, category, None, fy_start - timedelta(days=1))
        current_fy_actual = index.sum_for(aid, name, category, fy_start, m_end)
        ftm_actual = index.sum_for(aid, name, category, m_start, m_end)
        scope_rows.append({
            "id": aid, "activity_id": aid,
            "parent": a["activity_category"] or "",
            "category": name, "activity": name,
            "package": a["package_name"],
            "scope": _f(a["scope_qty"]), "uom": a["uom"],
            "weightPercent": _f(a["weight_pct"]),
            "ftmPlan": ftm_plan, "ftmActual": ftm_actual,
            "nextMonthPlan": next_month_plan,
            "lastFyPlan": last_fy_actual, "lastFyActual": last_fy_actual,
            "currentFyPlan": current_fy_plan, "currentFyActual": current_fy_actual,
            "cumulativePlan": last_fy_actual + current_fy_plan,
            "cumulativeActual": last_fy_actual + current_fy_actual,
        })

    if include_capex:
        fy_order = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3]
        elapsed = fy_order[:active_index + 1] if active_index >= 0 else []
        cap = scheme_capex_financials(db, scheme_id, fy_start_year, package_id)
        if cap:
            month_no = report_date.month
            next_no = fy_order[active_index + 1] if 0 <= active_index < 11 else None
            cap_fy_plan = sum(cap["monthly_plan"].get(m, 0.0) for m in elapsed)
            cap_fy_actual = sum(cap["monthly_actual"].get(m, 0.0) for m in elapsed)
            scope_rows.append({
                "id": "capex", "category": "Capex", "activity": "Capex", "source": "capex",
                "scope": cap["gross_cost"], "uom": "Cr.", "weightPercent": 0,
                "ftmPlan": cap["monthly_plan"].get(month_no, 0.0),
                "ftmActual": cap["monthly_actual"].get(month_no, 0.0),
                "nextMonthPlan": cap["monthly_plan"].get(next_no, 0.0) if next_no else 0,
                "lastFyPlan": cap["exp_last_fy"], "lastFyActual": cap["exp_last_fy"],
                "currentFyPlan": cap_fy_plan, "currentFyActual": cap_fy_actual,
                "cumulativePlan": cap["exp_last_fy"] + cap_fy_plan,
                "cumulativeActual": cap["exp_last_fy"] + cap_fy_actual,
            })

    summary = build_dpr_summary_model(scope_rows, report_date)
    return {
        "schemeId": scheme_id,
        "planMonth": active_label,
        "nextPlanMonth": next_label,
        "financialYear": summary["financialYear"],
        "asOf": report_date.isoformat(),
        "scopeRows": summary["summaryRows"][1:],   # rows with % fields
        "summary": summary,
        "plannedPercent": summary["totals"]["plannedPercent"],
        "actualPercent": summary["totals"]["actualPercent"],
        "hasActivePlan": bool(activities),
    }


# ─────────────────────── reports: per-month physical lookup ──────────────────

def weighted_percent(activity_rows, value_key):
    """Reference weighted_percent: scope>0 rows; scope-proportional weights when
    none explicit; each activity capped at 100%."""
    scoped = [r for r in (activity_rows or []) if _f(r.get("scope")) > 0]
    if not scoped:
        return 0.0
    explicit = sum(_f(r.get("weightPercent")) for r in scoped)
    scope_total = sum(_f(r.get("scope")) for r in scoped)
    progress = 0.0
    for r in scoped:
        scope = _f(r.get("scope"))
        weight = _f(r.get("weightPercent"))
        if explicit <= 0 and scope_total > 0:
            weight = (scope / scope_total) * 100.0
        achieved = min(100.0, (_f(r.get(value_key)) / scope) * 100.0)
        progress += achieved * (weight / 100.0)
    return round(max(0.0, progress), 2)


def physical_progress_text(values):
    if not values:
        return "-"
    return "\n".join([
        f"i. {round(values.get('lastFyActualPercent', 0.0), 2):.2f}%",
        f"ii. {round(values.get('currentFyPlanPercent', 0.0), 2):.2f}%",
        f"iii. {round(values.get('currentFyActualPercent', 0.0), 2):.2f}%",
    ])


def scheme_physical_progress_by_month(db, scheme_id: int, fy_start_year: int):
    """For every FY month: i/ii/iii values + PMC activity rows — reference
    build_project_physical_progress_lookup, adapted per scheme."""
    activities = scheme_current_activities(db, scheme_id)
    if not activities:
        return {}
    fy_start = date(fy_start_year, 4, 1)
    months = fiscal_month_dates(fy_start_year)
    labels = [month_label(d) for d in months]
    index = ActualsIndex(scheme_daily_actuals(db, scheme_id))
    monthly_plans = scheme_monthly_plans(db, scheme_id)

    month_values = {}
    for i, m_date in enumerate(months):
        upto = set(months[:i + 1])
        before = set(months[:i])
        next_date = months[i + 1] if i + 1 < len(months) else None
        progress_rows, activity_rows = [], []
        for a in activities:
            aid, name = int(a["activity_id"]), a["activity_name"]
            scope = _f(a["scope_qty"])
            plan_by_month = monthly_plans.get(aid, {})
            monthly_actual = index.monthly_for(aid, name)
            last_fy_actual = _f(a["actuals_till_last_fy"]) or \
                index.sum_for(aid, name, None, fy_start - timedelta(days=1))
            current_fy_plan = sum(q for d, q in plan_by_month.items()
                                  if fy_start <= d <= months[-1])
            plan_upto = sum(q for d, q in plan_by_month.items() if d in upto)
            plan_for_month = plan_by_month.get(m_date, 0.0)
            plan_next = plan_by_month.get(next_date, 0.0) if next_date else 0.0
            actual_upto = sum(q for lbl, q in monthly_actual.items()
                              if month_label_date(lbl) in upto)
            actual_before = sum(q for lbl, q in monthly_actual.items()
                                if month_label_date(lbl) in before)
            actual_for_month = monthly_actual.get(month_label(m_date), 0.0)
            cat = a["activity_category"] or ""
            item = f"{cat} — {name}" if cat and cat != name else name
            progress_rows.append({
                "parent": cat, "category": name, "activity": name,
                "source": "physical", "scope": scope,
                "weightPercent": _f(a["weight_pct"]),
                "lastFyActual": last_fy_actual,
                "currentFyPlan": current_fy_plan,
                "currentFyActual": actual_upto,
            })
            activity_rows.append({
                "item": item, "parent": cat, "activity": name,
                "scope": scope, "uom": a["uom"],
                "lastFyActual": last_fy_actual,
                "planUptoMonth": plan_upto, "actualUptoMonth": actual_upto,
                "actualTillPreviousMonth": actual_before,
                "planForMonth": plan_for_month, "planForNextMonth": plan_next,
                "actualForMonth": actual_for_month,
                "overallTarget": round(((last_fy_actual + plan_upto) / scope * 100) if scope else 0.0, 2),
                "cumulativePrevious": round(((last_fy_actual + actual_upto) / scope * 100) if scope else 0.0, 2),
                "targetMonth": round((plan_for_month / scope * 100) if scope else 0.0, 2),
                "nextMonthTarget": round((plan_next / scope * 100) if scope else 0.0, 2),
                "achievementMonth": round((actual_for_month / plan_for_month * 100) if plan_for_month else 0.0, 2),
            })
        values = {
            "lastFyActualPercent": weighted_percent(progress_rows, "lastFyActual"),
            "currentFyPlanPercent": weighted_percent(progress_rows, "currentFyPlan"),
            "currentFyActualPercent": weighted_percent(progress_rows, "currentFyActual"),
        }
        month_values[labels[i]] = {
            **values,
            "activityRows": activity_rows,
            "text": physical_progress_text(values),
        }
    return month_values


# ─────────────────────── remarks keyword monthly scan ────────────────────────

REMARK_PATTERNS = {
    "started": re.compile(r"\bstart(?:ed|ing)?\b", re.IGNORECASE),
    "completed": re.compile(r"\bcompleted?\b|\bcomplete\b", re.IGNORECASE),
    "underProgress": re.compile(r"\bunder\s+progress\b|\bin\s+progress\b", re.IGNORECASE),
}


def scheme_remarks_month_summary(db, scheme_id: int, fy_start_year: int):
    fy_start = date(fy_start_year, 4, 1)
    fy_end = date(fy_start_year + 1, 4, 1)
    labels = fiscal_month_labels(fy_start_year)
    summary = {lbl: {"month": lbl, "started": 0, "completed": 0,
                     "underProgress": 0, "remarks": []} for lbl in labels}
    rows = db.execute(text("""
        SELECT da.actual_date, COALESCE(da.remarks, '') AS remarks,
               COALESCE(da.area_of_work, '') AS area_of_work,
               pa.activity_name
        FROM daily_actuals da
        JOIN plan_activities pa ON pa.activity_id = da.activity_id
        JOIN progress_plans pp  ON pp.plan_id = pa.plan_id
        JOIN packages pkg       ON pkg.package_id = pp.package_id
        WHERE pkg.scheme_id = :sid
          AND da.actual_date >= CAST(:fy_start AS date)
          AND da.actual_date <  CAST(:fy_end AS date)
          AND (COALESCE(da.remarks, '') <> '' OR COALESCE(da.area_of_work, '') <> '')
        ORDER BY da.actual_date DESC, pa.activity_name
    """), {"sid": scheme_id, "fy_start": fy_start, "fy_end": fy_end}).mappings().all()
    for r in rows:
        lbl = month_label(r["actual_date"])
        if lbl not in summary:
            continue
        remark = str(r["remarks"] or r["area_of_work"] or "").strip()
        if not remark:
            continue
        hits = [key for key, pat in REMARK_PATTERNS.items() if pat.search(remark)]
        for key in hits:
            summary[lbl][key] += 1
        if hits:
            summary[lbl]["remarks"].append({
                "date": r["actual_date"].isoformat(),
                "activity": r["activity_name"],
                "remark": remark, "matches": hits,
            })
    return [summary[lbl] for lbl in labels]


# ─────────────────────── multi-version S-curve model ─────────────────────────

def scheme_scurve_plans(db, scheme_id: int):
    """Trend model per plan version (locked plans, active first) with per-activity
    trends and a weighted Overall trend — reference dashboard_project_details."""
    plan_rows = db.execute(text("""
        SELECT pp.plan_id, pp.plan_name, pp.financial_year, pp.plan_version,
               pp.is_current, pp.package_id, pkg.package_name
        FROM progress_plans pp
        JOIN packages pkg ON pkg.package_id = pp.package_id
        WHERE pkg.scheme_id = :sid AND pp.is_locked = TRUE AND NOT pp.is_deleted
        ORDER BY CASE WHEN pp.is_current THEN 0 ELSE 1 END, pp.updated_at DESC
    """), {"sid": scheme_id}).mappings().all()
    plan_rows = [dict(r) for r in plan_rows]
    if not plan_rows:
        return {"planName": "", "months": [], "activities": [], "trend": [], "plans": []}

    index = ActualsIndex(scheme_daily_actuals(db, scheme_id))
    plan_options = []
    current_option = None

    # group plans by (financial_year, plan_version) across packages so a scheme
    # rollup version appears as one S-curve line
    groups = {}
    for p in plan_rows:
        key = (str(p["financial_year"] or ""), str(p["plan_version"] or "v1"))
        groups.setdefault(key, []).append(p)

    for (fy, version), plans in groups.items():
        plan_ids = [p["plan_id"] for p in plans]
        is_active = any(p["is_current"] for p in plans)
        acts = db.execute(text("""
            SELECT pa.activity_id, pa.activity_name, pa.activity_category,
                   COALESCE(pa.scope_qty, 0) AS scope_qty,
                   COALESCE(pa.weight_pct, 0) AS weight_pct,
                   COALESCE(um.uom_code, '') AS uom,
                   pa.planned_start_date, pa.planned_finish_date, pa.expected_finish_date
            FROM plan_activities pa
            LEFT JOIN uom_master um ON um.uom_id = pa.uom_id
            WHERE pa.plan_id = ANY(:pids) AND NOT pa.is_deleted
            ORDER BY pa.sort_order, pa.activity_id
        """), {"pids": plan_ids}).mappings().all()
        acts = [dict(a) for a in acts]
        if not acts:
            continue
        monthly = scheme_monthly_plans(db, scheme_id, plan_ids=plan_ids)

        # month window: activity dates + plan months + actual months
        month_dates = []
        for a in acts:
            for d in (a["planned_start_date"], a["expected_finish_date"] or a["planned_finish_date"]):
                if d:
                    month_dates.append(date(d.year, d.month, 1))
        for m in monthly.values():
            month_dates.extend(date(d.year, d.month, 1) for d, q in m.items() if q)
        for a in acts:
            for lbl, q in index.monthly_for(int(a["activity_id"]), a["activity_name"]).items():
                d = month_label_date(lbl)
                if d and q:
                    month_dates.append(d)
        if not month_dates:
            fy_year = int(str(fy).split("-")[0]) if str(fy).split("-")[0].isdigit() else fy_start_year_for(date.today())
            month_dates = fiscal_month_dates(fy_year)
        cur, months = min(month_dates), []
        while cur <= max(month_dates):
            months.append(cur)
            cur = date(cur.year + 1, 1, 1) if cur.month == 12 else date(cur.year, cur.month + 1, 1)
        labels = [month_label(d) for d in months]

        def percent_trend(plan_by_month, actual_by_label, scope):
            safe = scope or 1.0
            cum_plan = cum_actual = 0.0
            first_plan = min((d for d, q in plan_by_month.items() if q > 0), default=None)
            rows = []
            for d, lbl in zip(months, labels):
                mp, ma = plan_by_month.get(d, 0.0), actual_by_label.get(lbl, 0.0)
                mp_pct, ma_pct = mp / safe * 100, ma / safe * 100
                cum_actual = min(100.0, cum_actual + ma_pct)
                if first_plan and d < first_plan:
                    mp, mp_pct, cum_plan = ma, ma_pct, cum_actual
                else:
                    cum_plan = min(100.0, cum_plan + mp_pct)
                rows.append({
                    "month": lbl,
                    "monthlyPlanQty": round(mp, 2), "monthlyActualQty": round(ma, 2),
                    "monthlyPlanPercent": round(mp_pct, 2), "monthlyActualPercent": round(ma_pct, 2),
                    "cumulativePlanPercent": round(cum_plan, 2),
                    "cumulativeActualPercent": round(cum_actual, 2),
                })
            return rows

        activity_trends, plan_totals, actual_totals = {}, {lbl: 0.0 for lbl in labels}, {lbl: 0.0 for lbl in labels}
        for a in acts:
            aid, name = int(a["activity_id"]), a["activity_name"]
            plan_by_month = monthly.get(aid, {})
            actual_by_label = index.monthly_for(aid, name)
            activity_trends[name] = percent_trend(plan_by_month, actual_by_label, _f(a["scope_qty"]))
            for d, lbl in zip(months, labels):
                plan_totals[lbl] += plan_by_month.get(d, 0.0)
                actual_totals[lbl] += actual_by_label.get(lbl, 0.0)

        weights = {a["activity_name"]: _f(a["weight_pct"]) for a in acts}
        total_w = sum(weights.values())
        scope_total = sum(_f(a["scope_qty"]) for a in acts) or 1.0
        trend_rows, prev_p, prev_a = [], 0.0, 0.0
        for i, lbl in enumerate(labels):
            cp = ca = 0.0
            for a in acts:
                name = a["activity_name"]
                w = weights[name] / 100.0 if total_w else (_f(a["scope_qty"]) / scope_total)
                t = activity_trends[name][i]
                cp += t["cumulativePlanPercent"] * w
                ca += t["cumulativeActualPercent"] * w
            cp, ca = min(100.0, cp), min(100.0, ca)
            trend_rows.append({
                "month": lbl,
                "monthlyPlanQty": round(plan_totals[lbl], 2),
                "monthlyActualQty": round(actual_totals[lbl], 2),
                "monthlyPlanPercent": round(max(0.0, cp - prev_p), 2),
                "monthlyActualPercent": round(max(0.0, ca - prev_a), 2),
                "cumulativePlanPercent": round(cp, 2),
                "cumulativeActualPercent": round(ca, 2),
            })
            prev_p, prev_a = cp, ca
        activity_trends["Overall"] = trend_rows

        option = {
            "planName": f"{fy} | {version}" if fy else version,
            "financialYear": fy, "planVersion": version,
            "isActive": is_active,
            "totalScope": round(sum(_f(a["scope_qty"]) for a in acts), 2),
            "months": labels,
            "trend": trend_rows,
            "activityOptions": ["Overall"] + [a["activity_name"] for a in acts],
            "activityTrends": activity_trends,
            "activities": [{
                "id": a["activity_id"], "activity_type": a["activity_name"],
                "parent": a["activity_category"] or "Other Activities",
                "child": a["activity_name"], "uom": a["uom"],
                "scope_qty": _f(a["scope_qty"]), "weight_percent": _f(a["weight_pct"]),
                "start_date": a["planned_start_date"].isoformat() if a["planned_start_date"] else None,
                "finish_date": a["planned_finish_date"].isoformat() if a["planned_finish_date"] else None,
                "expected_finish": (a["expected_finish_date"] or a["planned_finish_date"]).isoformat()
                                    if (a["expected_finish_date"] or a["planned_finish_date"]) else None,
            } for a in acts],
        }
        plan_options.append(option)
        if is_active and current_option is None:
            current_option = option

    current_option = current_option or (plan_options[0] if plan_options else None)
    if not current_option:
        return {"planName": "", "months": [], "activities": [], "trend": [], "plans": []}
    return {
        "planName": current_option["planName"],
        "financialYear": current_option["financialYear"],
        "months": current_option["months"],
        "activities": current_option["activities"],
        "trend": [{"month": r["month"], "plan": r["monthlyPlanQty"], "actual": r["monthlyActualQty"]}
                  for r in current_option["trend"]],
        "plans": plan_options,
    }
