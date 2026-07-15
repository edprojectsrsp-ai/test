"""MoS-format portfolio reports, ported from the friend's report_routes.py.

Two endpoints:

  GET /reports-mos/capex-summary   — the "MoS CAPEX Format" categorized rows:
        1   Being Implemented from Last FY        (1.1 Corporate / 1.2 Plant)
        2   Implementation Started During FY      (2.1 / 2.2)
        3   Total Ongoing projects                (+ On Time / <1yr / >1yr)
            Milestone payments in completed projects (MEP / Corporate / Plant)
        3a  New Projects under tendering / Stage-II award
        3b  New Projects under Stage-1 approval
            Total New projects (3a+3b)
            Spares & Capital Repairs   (from the CAPEX plan header row)
            Total

  GET /reports-mos/pmc-board?month=YYYY-MM — "FORMAT FOR PROJECTS-PMC":
        one block per corporate package (leaf), with agency/contract dates,
        delay status, completion dates, physical progress (i. last-FY actual %,
        ii. current-FY plan %, iii. current-FY actual %) and month manpower.

Category rules mirror the source implementation:
  * ongoing  = scheme_status in (ongoing, on_hold), bucketed by implementation
    start date (package planned_start_date, else scheme planned_start_date):
    before FY start -> "last FY", inside FY -> "current FY", else yet-to-start.
  * completed = status closed;  dropped is excluded everywhere.
  * 3a = corporate under_tendering / under_stage2 + plant yet-to-start.
  * 3b = corporate under_formulation / under_stage1.
  * delay bucket vs packages.planned_end_date: On Time / Delay < 1 Yr. / > 1 Yr.
  * financials per scheme from the FY's CAPEX plan (BE) rows.
"""

from __future__ import annotations

import calendar
from datetime import date, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.services.friend_parity import _capex as friend_capex
from app.services.friend_parity import archive_available, capex_detail_model, mos_model

router = APIRouter(prefix="/reports-mos", tags=["MoS Reports"])

FY_ORDER = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3]


def _fy_bounds(today: date) -> tuple[date, date, str]:
    start_year = today.year if today.month >= 4 else today.year - 1
    fy_start = date(start_year, 4, 1)
    fy_end = date(start_year + 1, 3, 31)
    return fy_start, fy_end, f"{start_year}-{str(start_year + 1)[2:]}"


def _delay_bucket(planned_end, today: date) -> str:
    if not planned_end or planned_end >= today:
        return "On Time"
    months_late = (today - planned_end).days / 30.0
    return "Delay < 1 Yr." if months_late <= 12 else "Delay > 1 Yr."


def _capex_financials(db: Session, fy_label: str, upto_month: int | None = None) -> dict[int, dict]:
    """scheme_id -> {gross, last_fy, be_fy, actual_fy} from the FY CAPEX plan.

    upto_month, if given, is a calendar month number (Apr=4..Mar=3) and caps
    actual_fy / be_fy to "till this report month" instead of the whole FY —
    capex_month_values/capex_actuals key on calendar month numbers, see
    dpr.py's progress-summary endpoint for the same convention.
    """
    months_filter = ""
    params: dict = {"fy": fy_label}
    if upto_month is not None:
        elapsed = FY_ORDER[: FY_ORDER.index(upto_month) + 1]
        months_filter = "AND cmv.month_no = ANY(:months)"
        params["months"] = elapsed

    rows = db.execute(text(f"""
        SELECT cpr.scheme_id,
               COALESCE(SUM(cpv.gross_cost), 0)                  AS gross,
               COALESCE(SUM(cpv.cumulative_exp_till_last_fy), 0) AS last_fy,
               COALESCE(SUM(cpv.be_fy), 0)                       AS be_fy_field,
               COALESCE(SUM(mv.be_sum), 0)                       AS be_month_sum,
               COALESCE(SUM(mv.actual_sum), 0)                   AS actual_fy
        FROM capex_plan_rows cpr
        JOIN capex_plan_header cph ON cph.id = cpr.plan_id
        LEFT JOIN capex_plan_values cpv ON cpv.plan_row_id = cpr.id
        LEFT JOIN (
            SELECT plan_row_id,
                   SUM(COALESCE(be_amount, 0))     AS be_sum,
                   SUM(COALESCE(actual_amount, 0)) AS actual_sum
            FROM capex_month_values cmv
            WHERE 1=1 {months_filter}
            GROUP BY plan_row_id
        ) mv ON mv.plan_row_id = cpr.id
        WHERE cph.fy_year = :fy AND cph.plan_status != 'Archived'
          AND cpr.scheme_id IS NOT NULL
          AND cpr.row_level IN ('Item', 'Package')
        GROUP BY cpr.scheme_id
    """), params).mappings().all()
    out = {}
    for r in rows:
        be = float(r["be_fy_field"]) or float(r["be_month_sum"])
        out[int(r["scheme_id"])] = {
            "gross": float(r["gross"]), "last_fy": float(r["last_fy"]),
            "be_fy": be, "actual_fy": float(r["actual_fy"]),
        }
    return out


def _load_schemes(db: Session):
    return db.execute(text("""
        SELECT s.scheme_id, s.scheme_name, s.scheme_type, s.current_status,
               s.estimated_cost_cr,
               MIN(p.planned_start_date)  AS pkg_start,
               MAX(p.planned_end_date)    AS pkg_end,
               s.planned_start_date       AS scheme_start,
               s.planned_completion_date  AS scheme_end
        FROM scheme_master s
        LEFT JOIN packages p ON p.scheme_id = s.scheme_id AND NOT p.is_deleted
        WHERE NOT s.is_deleted AND s.current_status != 'dropped'
        GROUP BY s.scheme_id
    """)).mappings().all()


@router.get("/capex-summary")
def mos_capex_summary(
    report_month: str | None = Query(None, description="Report month YYYY-MM"),
    db: Session = Depends(get_db),
):
    if archive_available(db):
        return mos_model(db, report_month)

    today = date.today()
    fy_start, fy_end, fy_label = _fy_bounds(today)
    fin = _capex_financials(db, fy_label)
    schemes = _load_schemes(db)

    def enrich(s):
        f = fin.get(s["scheme_id"], {})
        gross = f.get("gross") or float(s["estimated_cost_cr"] or 0)
        start = s["pkg_start"] or s["scheme_start"]
        end = s["pkg_end"] or s["scheme_end"]
        return {
            "scheme_id": s["scheme_id"], "name": s["scheme_name"],
            "type": s["scheme_type"], "status": s["current_status"],
            "gross": round(gross, 2),
            "last_fy": round(f.get("last_fy", 0.0), 2),
            "be_fy": round(f.get("be_fy", 0.0), 2),
            "actual_fy": round(f.get("actual_fy", 0.0), 2),
            "total_exp": round(f.get("last_fy", 0.0) + f.get("actual_fy", 0.0), 2),
            "start": start, "end": end,
            "delay": _delay_bucket(end, today),
        }

    rows_all = [enrich(s) for s in schemes]
    ongoing = [r for r in rows_all if r["status"] in ("ongoing", "on_hold")]
    completed = [r for r in rows_all if r["status"] == "closed"]

    def bucket(r):
        if r["start"] and r["start"] < fy_start:
            return "last_fy"
        if r["start"] and fy_start <= r["start"] <= fy_end:
            return "current_fy"
        return "yet_to_start"

    last_fy_rows = [r for r in ongoing if bucket(r) == "last_fy"]
    current_fy_rows = [r for r in ongoing if bucket(r) == "current_fy"]
    # ongoing without a start date still count as ongoing (his report keeps
    # them under the last-FY spillover group rather than dropping them)
    undated = [r for r in ongoing if bucket(r) == "yet_to_start"]
    last_fy_rows += undated
    report_ongoing = last_fy_rows + current_fy_rows

    corp_tendering = [r for r in rows_all if r["type"] == "corporate" and r["status"] == "under_tendering"]
    corp_stage2 = [r for r in rows_all if r["type"] == "corporate" and r["status"] == "under_stage2"]
    plant_yts = [r for r in rows_all if r["type"] == "plant" and r["status"] in ("under_tendering", "under_stage2")]
    corp_stage1 = [r for r in rows_all if r["type"] == "corporate" and r["status"] in ("under_formulation", "under_stage1")]
    new_tendering = corp_tendering + corp_stage2 + plant_yts
    new_stage1 = corp_stage1

    def summarize(no, category, rows, tone="", section=False):
        groups = {"On Time": {"count": 0, "cost": 0.0},
                  "Delay < 1 Yr.": {"count": 0, "cost": 0.0},
                  "Delay > 1 Yr.": {"count": 0, "cost": 0.0}}
        out = {"no": no, "category": category, "tone": tone, "section": section,
               "projects": len(rows),
               "totalCost": round(sum(r["gross"] for r in rows), 2),
               "expenditureLastFy": round(sum(r["last_fy"] for r in rows), 2),
               "capexCurrentFy": round(sum(r["be_fy"] for r in rows), 2),
               "expenditureCurrentFy": round(sum(r["actual_fy"] for r in rows), 2),
               "totalExpenditure": round(sum(r["total_exp"] for r in rows), 2),
               "childRows": [], "statusGroups": []}
        for r in rows:
            groups[r["delay"]]["count"] += 1
            groups[r["delay"]]["cost"] += r["gross"]
        out["statusGroups"] = [
            {"label": k, "count": v["count"], "cost": round(v["cost"], 2)}
            for k, v in groups.items() if v["count"]
        ]
        return out

    def with_children(summary, child_rows):
        summary["childRows"] = child_rows
        return summary

    rows = []
    rows.append(summarize("1", "Being Implemented from Last FY", last_fy_rows, "blue", True))
    rows.append(summarize("1.1", "Corporate AMR", [r for r in last_fy_rows if r["type"] == "corporate"]))
    rows.append(summarize("1.2", "Plant Level AMR (<30 Cr.)", [r for r in last_fy_rows if r["type"] == "plant"]))
    rows.append(summarize("2", f"Implementation Started During FY {fy_label}", current_fy_rows, "teal", True))
    rows.append(summarize("2.1", "Corporate AMR", [r for r in current_fy_rows if r["type"] == "corporate"]))
    rows.append(summarize("2.2", "Plant Level AMR (<30 Cr.)", [r for r in current_fy_rows if r["type"] == "plant"]))
    total_ongoing = summarize("3", "Total Ongoing projects", report_ongoing, "purple", True)
    total_ongoing["point3Rows"] = [
        summarize("", label, [r for r in report_ongoing if r["delay"] == label])
        for label in ("On Time", "Delay < 1 Yr.", "Delay > 1 Yr.")
    ]
    rows.append(total_ongoing)

    completed_mep = [r for r in completed if "mep" in r["name"].lower()]
    completed_corp = [r for r in completed if "mep" not in r["name"].lower() and r["type"] != "plant"]
    completed_plant = [r for r in completed if r["type"] == "plant"]
    completed_summary = with_children(
        summarize("", "Milestone payments in completed projects incl. MEP",
                  completed, "soft-purple"),
        [summarize("", "MEP", completed_mep),
         summarize("", "Corporate AMR Schemes", completed_corp),
         summarize("", "Plant AMR(<30 Cr.)-Completed/ EDC", completed_plant)])
    rows.append(completed_summary)

    row3a = with_children(
        summarize("3a", "New Projects under tendering/ final approval and contract award",
                  new_tendering, "soft-blue"),
        [summarize("", "Corporate AMR - under tendering", corp_tendering),
         summarize("", "Corporate AMR - under final approval and contract award (Stage-II)", corp_stage2),
         summarize("", "Plant AMR(<30 Cr.)", plant_yts)])
    rows.append(row3a)
    row3b = with_children(
        summarize("3b", "New Projects under Stage-1 approval", new_stage1, "soft-green"),
        [summarize("", "Corporate AMR - up to Stage-1 approval", corp_stage1)])
    rows.append(row3b)
    total_new = summarize("", "Total New projects under consideration (3a+3b)",
                          new_tendering + new_stage1, "soft-orange")
    rows.append(total_new)

    # Spares & Capital Repairs from the CAPEX plan header row
    spares = db.execute(text("""
        SELECT COALESCE(cpv.be_fy, 0) AS be_fy,
               COALESCE(cpv.cumulative_exp_till_last_fy, 0) AS last_fy,
               COALESCE((SELECT SUM(COALESCE(actual_amount, 0))
                         FROM capex_month_values WHERE plan_row_id = cpr.id), 0) AS actual_fy
        FROM capex_plan_rows cpr
        JOIN capex_plan_header cph ON cph.id = cpr.plan_id
        LEFT JOIN capex_plan_values cpv ON cpv.plan_row_id = cpr.id
        WHERE cph.fy_year = :fy AND cph.plan_status != 'Archived'
          AND cpr.row_name ILIKE '%repair%' AND cpr.row_name ILIKE '%spare%'
        LIMIT 1
    """), {"fy": fy_label}).mappings().first()
    spares_row = {"no": "", "category": "Spares & Capital Repairs", "tone": "soft-red",
                  "section": False, "projects": 0,
                  "totalCost": round(float(spares["be_fy"]), 2) if spares else 0,
                  "expenditureLastFy": round(float(spares["last_fy"]), 2) if spares else 0,
                  "capexCurrentFy": round(float(spares["be_fy"]), 2) if spares else 0,
                  "expenditureCurrentFy": round(float(spares["actual_fy"]), 2) if spares else 0,
                  "totalExpenditure": round(float(spares["last_fy"]) + float(spares["actual_fy"]), 2) if spares else 0,
                  "childRows": [], "statusGroups": []}
    rows.append(spares_row)

    grand_sources = [total_ongoing, completed_summary, total_new, spares_row]
    rows.append({
        "no": "", "category": "Total", "tone": "total", "section": True,
        "projects": sum(r["projects"] for r in grand_sources),
        "totalCost": round(sum(r["totalCost"] for r in grand_sources), 2),
        "expenditureLastFy": round(sum(r["expenditureLastFy"] for r in grand_sources), 2),
        "capexCurrentFy": round(sum(r["capexCurrentFy"] for r in grand_sources), 2),
        "expenditureCurrentFy": round(sum(r["expenditureCurrentFy"] for r in grand_sources), 2),
        "totalExpenditure": round(sum(r["totalExpenditure"] for r in grand_sources), 2),
        "childRows": [], "statusGroups": [],
    })

    return {"financialYear": fy_label, "asOn": today.isoformat(), "rows": rows}


@router.get("/pmc-board")
def pmc_board(
    month: str | None = Query(None, description="Report month YYYY-MM (default: current)"),
    db: Session = Depends(get_db),
):
    today = date.today()
    if month:
        year, mon = int(month[:4]), int(month[5:7])
    else:
        year, mon = today.year, today.month
        month = f"{year:04d}-{mon:02d}"
    m_start = date(year, mon, 1)
    m_end = date(year, mon, calendar.monthrange(year, mon)[1])
    fy_start, fy_end, fy_label = _fy_bounds(m_start)
    fin = _capex_financials(db, fy_label)
    archived_fin = friend_capex(db)["financials"] if archive_available(db) else {}

    pkgs = db.execute(text("""
        SELECT p.package_id, p.package_name, p.scheme_id, p.executing_agency, p.extra_fields,
               p.project_manager_name, p.planned_start_date, p.planned_end_date,
               p.is_scheme_mirror,
               s.scheme_name, s.current_status, s.estimated_cost_cr,
               s.planned_completion_date AS scheme_end,
               st2.sanction_date AS stage2_sanction, st2.order_date AS stage2_order,
               st1.sanction_date AS stage1_sanction,
               c.contractor_name AS contract_agency, c.loa_date, c.effective_date,
               c.schedule_completion_date, c.expected_completion_date
        FROM packages p
        JOIN scheme_master s ON s.scheme_id = p.scheme_id
        LEFT JOIN LATERAL (
            SELECT contractor_name, loa_date, effective_date,
                   schedule_completion_date, expected_completion_date
            FROM contracts
            WHERE package_id = p.package_id AND is_active AND NOT is_deleted
            ORDER BY effective_date DESC NULLS LAST LIMIT 1) c ON TRUE
        LEFT JOIN LATERAL (
            SELECT sanction_date, order_date FROM stage2_approvals
            WHERE scheme_id = s.scheme_id AND is_current AND NOT is_deleted
            ORDER BY revision_no DESC LIMIT 1) st2 ON TRUE
        LEFT JOIN LATERAL (
            SELECT sanction_date FROM stage1_approvals
            WHERE scheme_id = s.scheme_id AND is_current AND NOT is_deleted
            ORDER BY revision_no DESC LIMIT 1) st1 ON TRUE
        WHERE s.scheme_type = 'corporate'
          AND NOT s.is_deleted AND s.current_status NOT IN ('dropped')
          AND NOT p.is_deleted
        ORDER BY s.scheme_id, p.package_no
    """)).mappings().all()

    pkg_ids = [r["package_id"] for r in pkgs]

    # physical progress per package from the locked plan (weighted like the
    # DPR board): i. last-FY actual %, ii. FY plan-till-month %, iii. FY actual %
    phys_rows = db.execute(text("""
        SELECT pp.package_id, pa.activity_id,
               COALESCE(pa.scope_qty, 0)            AS scope,
               COALESCE(pa.weight_pct, 0)           AS w,
               COALESCE(pa.actuals_till_last_fy, 0) AS last_fy,
               COALESCE((SELECT SUM(mpe.planned_qty) FROM monthly_plan_entries mpe
                         WHERE mpe.activity_id = pa.activity_id
                           AND mpe.month_date BETWEEN CAST(:fy_start AS date)
                                                  AND CAST(:fy_end AS date)), 0) AS fy_plan,
               COALESCE((SELECT SUM(da.actual_qty) FROM daily_actuals da
                         WHERE da.activity_id = pa.activity_id
                           AND da.actual_date BETWEEN CAST(:fy_start AS date)
                                                  AND LEAST(
                                                      CAST(:m_end AS date),
                                                      (SELECT MAX(actual_date::date)
                                                       FROM friend_archive.daily_actuals)
                                                  )), 0) AS fy_actual
        FROM plan_activities pa
        JOIN progress_plans pp ON pa.plan_id = pp.plan_id
        WHERE pp.package_id = ANY(:pkg_ids)
          AND pp.is_locked AND pp.is_current AND NOT pa.is_deleted
    """), {"pkg_ids": pkg_ids, "fy_start": fy_start, "fy_end": fy_end,
           "m_start": m_start,
           "m_end": m_end}).mappings().all()

    phys: dict[int, dict] = {}
    by_pkg: dict[int, list] = {}
    for r in phys_rows:
        by_pkg.setdefault(r["package_id"], []).append(r)
    for pid, acts in by_pkg.items():
        explicit_w = sum(float(a["w"]) for a in acts)
        scope_total = sum(float(a["scope"]) for a in acts) or 1.0
        agg = {"last_fy": 0.0, "fy_plan": 0.0, "fy_actual": 0.0}
        for a in acts:
            scope = float(a["scope"])
            share = (float(a["w"]) / 100.0 if explicit_w > 0
                     else scope / scope_total)
            if scope:
                agg["last_fy"] += float(a["last_fy"]) / scope * 100 * share
                agg["fy_plan"] += float(a["fy_plan"]) / scope * 100 * share
                agg["fy_actual"] += float(a["fy_actual"]) / scope * 100 * share
        phys[pid] = {k: round(v, 2) for k, v in agg.items()}

    # manpower: average daily manpower_count over DPR-filled days in month
    mp_rows = db.execute(text("""
        SELECT pp.package_id,
               COUNT(DISTINCT da.actual_date)     AS dpr_days,
               COALESCE(SUM(da.manpower_count), 0) AS mp_sum,
               COUNT(da.manpower_count)            AS mp_entries
        FROM daily_actuals da
        JOIN plan_activities pa ON pa.activity_id = da.activity_id
        JOIN progress_plans pp ON pp.plan_id = pa.plan_id
        WHERE pp.package_id = ANY(:pkg_ids)
          AND da.actual_date BETWEEN CAST(:m_start AS date) AND CAST(:m_end AS date)
        GROUP BY pp.package_id
    """), {"pkg_ids": pkg_ids, "m_start": m_start, "m_end": m_end}).mappings().all()
    manpower = {r["package_id"]: r for r in mp_rows}

    multi_pkg_schemes = {}
    for r in pkgs:
        multi_pkg_schemes[r["scheme_id"]] = multi_pkg_schemes.get(r["scheme_id"], 0) + 1

    blocks = []
    for r in pkgs:
        display = (r["scheme_name"] if multi_pkg_schemes[r["scheme_id"]] == 1
                   else f"{r['scheme_name']} — {r['package_name']}")
        f = fin.get(r["scheme_id"], {})
        extra = r.get("extra_fields") or {}
        if isinstance(extra, str):
            import json
            extra = json.loads(extra)
        source_ids = [int(value) for value in (extra.get("friend_project_ids") or [])]
        source_id = next((value for value in reversed(source_ids) if value in archived_fin), None)
        source_fin = archived_fin.get(source_id, {}) if source_id else {}
        original_end = r["schedule_completion_date"] or r["planned_end_date"]
        anticipated_end = (r["expected_completion_date"] or r["schedule_completion_date"]
                           or r["scheme_end"] or r["planned_end_date"])
        end = anticipated_end or r["scheme_end"]
        mp = manpower.get(r["package_id"])
        blocks.append({
            "schemeId": r["scheme_id"], "packageId": r["package_id"],
            "projectName": display,
            "agency": r["contract_agency"] or r["executing_agency"] or "-",
            "projectManager": r["project_manager_name"] or "-",
            "effectiveDate": r["effective_date"] or r["planned_start_date"],
            "approvalDate": r["stage2_sanction"] or r["stage1_sanction"],
            # friend's rule: award date = effective date of contract
            "awardDate": r["effective_date"] or r["loa_date"] or r["stage2_order"],
            "originalCompletionDate": original_end,
            "anticipatedCompletionDate": anticipated_end,
            "status": _delay_bucket(end, today),
            "grossCost": round(source_fin.get("gross_cost", 0) or f.get("gross", 0) or float(r["estimated_cost_cr"] or 0), 2),
            "cumulativeExpenditure": round(
                source_fin.get("actual_till_date", 0)
                or f.get("last_fy", 0) + f.get("actual_fy", 0), 2),
            "physical": phys.get(r["package_id"]),
            "manpower": ({
                "dprDays": int(mp["dpr_days"]),
                "avgPerDay": round(float(mp["mp_sum"]) / max(int(mp["mp_entries"]), 1), 0),
            } if mp else None),
        })

    return {"month": month, "financialYear": fy_label, "blocks": blocks}


@router.get("/capex-detail")
def capex_project_detail(
    month: str | None = Query(None, description="Report month YYYY-MM (default: current)"),
    db: Session = Depends(get_db),
):
    """Project-wise CAPEX progress detail, matching the friend's
    'Physical and Financial Progress Report of CAPEX Projects' drill-down:
      A. Projects >= Rs 50 Cr. — one row each, with physical progress
         (i. till last FY, ii. planned during current FY, iii. total till
         report month), approval/award/completion dates, and CAPEX
         last-FY / current-FY-target / current-FY-expenditure / cumulative.
      Projects < Rs. 50 Cr. — grouped into a single summary row.
    Restricted to ongoing Corporate + Plant AMR schemes (matches "Total
    Ongoing projects" in the MoS summary — completed/dropped excluded).
    """
    if archive_available(db):
        return capex_detail_model(db, month)

    today = date.today()
    if month:
        year, mon = int(month[:4]), int(month[5:7])
    else:
        year, mon = today.year, today.month
        month = f"{year:04d}-{mon:02d}"
    m_start = date(year, mon, 1)
    m_end = date(year, mon, calendar.monthrange(year, mon)[1])
    fy_start, _fy_end, fy_label = _fy_bounds(m_start)
    fin = _capex_financials(db, fy_label, upto_month=mon)

    schemes = db.execute(text("""
        SELECT s.scheme_id, s.scheme_name, s.scheme_type, s.current_status,
               s.estimated_cost_cr,
               MIN(p.planned_start_date) AS pkg_start,
               MAX(p.planned_end_date)   AS pkg_end
        FROM scheme_master s
        LEFT JOIN packages p ON p.scheme_id = s.scheme_id AND NOT p.is_deleted
        WHERE NOT s.is_deleted
          AND s.current_status IN ('ongoing', 'on_hold')
        GROUP BY s.scheme_id
    """)).mappings().all()
    scheme_ids = [s["scheme_id"] for s in schemes]

    # physical progress per scheme: i. till last FY, ii. FY plan-to-date, iii. FY actual-to-date
    phys_rows = db.execute(text("""
        SELECT p.scheme_id,
               COALESCE(pa.scope_qty, 0)            AS scope,
               COALESCE(pa.weight_pct, 0)           AS w,
               COALESCE(pa.actuals_till_last_fy, 0) AS last_fy,
               COALESCE((SELECT SUM(mpe.planned_qty) FROM monthly_plan_entries mpe
                         WHERE mpe.activity_id = pa.activity_id
                           AND mpe.month_date BETWEEN CAST(:fy_start AS date)
                                                  AND CAST(:m_start AS date)), 0) AS fy_plan,
               COALESCE((SELECT SUM(da.actual_qty) FROM daily_actuals da
                         WHERE da.activity_id = pa.activity_id
                           AND da.actual_date BETWEEN CAST(:fy_start AS date)
                                                  AND CAST(:m_end AS date)), 0)   AS fy_actual
        FROM plan_activities pa
        JOIN progress_plans pp ON pa.plan_id = pp.plan_id
        JOIN packages p ON p.package_id = pp.package_id
        WHERE p.scheme_id = ANY(:scheme_ids)
          AND pp.is_locked AND pp.is_current AND NOT pa.is_deleted
    """), {"scheme_ids": scheme_ids, "fy_start": fy_start, "m_start": m_start,
           "m_end": m_end}).mappings().all()

    # unified-service weighted percentages (same math + actuals fallback chain
    # as the DPR summary and dashboards, so all screens agree)
    from app.services import progress_summary as ps_svc
    month_lbl = ps_svc.month_label(m_start)
    scheme_ids_with_plans = sorted({r["scheme_id"] for r in phys_rows})
    phys: dict[int, dict] = {}
    for sid in scheme_ids_with_plans:
        month_values = ps_svc.scheme_physical_progress_by_month(db, sid, fy_start.year)
        v = month_values.get(month_lbl) or {}
        if v:
            phys[sid] = {
                "last_fy": v.get("lastFyActualPercent", 0.0),
                "fy_plan": v.get("currentFyPlanPercent", 0.0),
                "fy_actual": v.get("currentFyActualPercent", 0.0),
            }

    # approval / award dates from stage approvals + contracts
    meta_rows = db.execute(text("""
        SELECT s.scheme_id,
               COALESCE(st2.sanction_date, st1.sanction_date) AS approval_date,
               COALESCE(c.effective_date, c.loa_date, st2.order_date) AS award_date,
               c.schedule_completion_date, c.expected_completion_date
        FROM scheme_master s
        LEFT JOIN LATERAL (SELECT sanction_date, order_date FROM stage2_approvals
                           WHERE scheme_id = s.scheme_id AND is_current AND NOT is_deleted
                           ORDER BY revision_no DESC LIMIT 1) st2 ON TRUE
        LEFT JOIN LATERAL (SELECT sanction_date FROM stage1_approvals
                           WHERE scheme_id = s.scheme_id AND is_current AND NOT is_deleted
                           ORDER BY revision_no DESC LIMIT 1) st1 ON TRUE
        LEFT JOIN LATERAL (SELECT c2.effective_date, c2.loa_date, c2.schedule_completion_date, c2.expected_completion_date
                           FROM contracts c2
                           JOIN packages p2 ON p2.package_id = c2.package_id
                           WHERE p2.scheme_id = s.scheme_id AND c2.is_active AND NOT c2.is_deleted
                           ORDER BY c2.contract_value_cr DESC NULLS LAST,
                                    c2.effective_date ASC NULLS LAST LIMIT 1) c ON TRUE
        WHERE s.scheme_id = ANY(:sids)
    """), {"sids": scheme_ids}).mappings().all()
    meta = {int(r["scheme_id"]): dict(r) for r in meta_rows}

    high_cost, low_cost = [], []
    for s in schemes:
        f = fin.get(s["scheme_id"], {})
        gross = f.get("gross") or float(s["estimated_cost_cr"] or 0)
        end = s["pkg_end"]
        m = meta.get(int(s["scheme_id"]), {})
        row = {
            "schemeId": s["scheme_id"], "name": s["scheme_name"],
            "totalCost": round(gross, 2),
            "approvalDate": m.get("approval_date"),
            "awardDate": m.get("award_date"),
            "originalCompletionDate": m.get("schedule_completion_date") or s["pkg_end"],
            "revisedCompletionDate": m.get("expected_completion_date"),
            "anticipatedCompletionDate": m.get("expected_completion_date")
                                          or m.get("schedule_completion_date") or s["pkg_end"],
            "expenditureLastFy": round(f.get("last_fy", 0.0), 2),
            "capexCurrentFy": round(f.get("be_fy", 0.0), 2),
            "expenditureCurrentFy": round(f.get("actual_fy", 0.0), 2),
            "cumulativeExpenditure": round(f.get("last_fy", 0.0) + f.get("actual_fy", 0.0), 2),
            "physical": phys.get(s["scheme_id"]),
        }
        (high_cost if gross >= 50 or gross == 0 else low_cost).append(row)

    high_cost.sort(key=lambda r: r["totalCost"], reverse=True)
    low_cost_summary = {
        "count": len(low_cost),
        "totalCost": round(sum(r["totalCost"] for r in low_cost), 2),
        "expenditureLastFy": round(sum(r["expenditureLastFy"] for r in low_cost), 2),
        "capexCurrentFy": round(sum(r["capexCurrentFy"] for r in low_cost), 2),
        "expenditureCurrentFy": round(sum(r["expenditureCurrentFy"] for r in low_cost), 2),
        "cumulativeExpenditure": round(sum(r["cumulativeExpenditure"] for r in low_cost), 2),
    }

    return {
        "month": month, "financialYear": fy_label,
        "highCostProjects": high_cost,
        "lowCostSummary": low_cost_summary,
    }


@router.get("/pmc-detail/{scheme_id}")
def pmc_project_detail(
    scheme_id: int,
    month: str | None = Query(None, description="Report month YYYY-MM (default: current)"),
    db: Session = Depends(get_db),
):
    """Single-project PMC drill-down, matching the friend's
    'Physical Progress of Different Project on Monthly Basis' report:
    contract meta (agency / LOA / effective date), an 11-column details row
    (approval/award/completion dates, time overrun, cost overrun, cumulative
    expenditure), a per-activity physical-progress table (overall target /
    cumulative previous / month target / month achievement), and monthly
    manpower deployment averaged over DPR-filled days.
    """
    today = date.today()
    if month:
        year, mon = int(month[:4]), int(month[5:7])
    else:
        year, mon = today.year, today.month
        month = f"{year:04d}-{mon:02d}"
    m_start = date(year, mon, 1)
    m_end = date(year, mon, calendar.monthrange(year, mon)[1])
    prev_end = m_start - timedelta(days=1)
    fy_start, _fy_end, fy_label = _fy_bounds(m_start)
    fin = _capex_financials(db, fy_label, upto_month=mon).get(scheme_id, {})

    scheme = db.execute(text("""
        SELECT s.scheme_id, s.scheme_name, s.estimated_cost_cr,
               MIN(p.planned_start_date) AS start_date,
               MAX(p.planned_end_date)   AS end_date,
               MAX(p.executing_agency)   AS agency,
               MAX(p.project_manager_name) AS pm
        FROM scheme_master s
        JOIN packages p ON p.scheme_id = s.scheme_id AND NOT p.is_deleted
        WHERE s.scheme_id = :sid AND NOT s.is_deleted
        GROUP BY s.scheme_id
    """), {"sid": scheme_id}).mappings().first()
    if not scheme:
        return {"error": "scheme not found"}

    pkg_ids_rows = db.execute(text(
        "SELECT package_id FROM packages WHERE scheme_id = :sid AND NOT is_deleted"),
        {"sid": scheme_id}).all()
    pkg_ids = [r[0] for r in pkg_ids_rows]

    acts = db.execute(text("""
        SELECT pa.activity_id, pa.activity_name, pa.activity_category,
               COALESCE(pa.scope_qty, 0)            AS scope,
               COALESCE(pa.weight_pct, 0)           AS w,
               COALESCE(pa.actuals_till_last_fy, 0) AS last_fy,
               COALESCE((SELECT SUM(mpe.planned_qty) FROM monthly_plan_entries mpe
                         WHERE mpe.activity_id = pa.activity_id
                           AND mpe.month_date BETWEEN CAST(:fy_start AS date)
                                                  AND CAST(:m_start AS date)), 0) AS fy_plan_to_month,
               COALESCE((SELECT SUM(da.actual_qty) FROM daily_actuals da
                         WHERE da.activity_id = pa.activity_id
                           AND da.actual_date <= CAST(:prev_end AS date)), 0)     AS actual_till_prev,
               COALESCE((SELECT SUM(mpe.planned_qty) FROM monthly_plan_entries mpe
                         WHERE mpe.activity_id = pa.activity_id
                           AND mpe.month_date = CAST(:m_start AS date)), 0)      AS month_plan,
               COALESCE((SELECT SUM(da.actual_qty) FROM daily_actuals da
                         WHERE da.activity_id = pa.activity_id
                           AND da.actual_date BETWEEN CAST(:m_start AS date)
                                                  AND CAST(:m_end AS date)), 0)   AS month_actual
        FROM plan_activities pa
        JOIN progress_plans pp ON pa.plan_id = pp.plan_id
        WHERE pp.package_id = ANY(:pkg_ids)
          AND pp.is_locked AND pp.is_current AND NOT pa.is_deleted
        ORDER BY pa.sort_order
    """), {"pkg_ids": pkg_ids, "fy_start": fy_start, "m_start": m_start,
           "m_end": m_end, "prev_end": prev_end}).mappings().all()

    # per-activity rows from the unified service (same math as DPR/dashboard,
    # includes the actuals fallback chain and next-month target)
    from app.services import manpower as mp_svc
    from app.services import progress_summary as ps_svc
    fy_start_year = fy_start.year
    month_lbl = ps_svc.month_label(m_start)
    month_values = ps_svc.scheme_physical_progress_by_month(db, scheme_id, fy_start_year)
    activity_rows = (month_values.get(month_lbl) or {}).get("activityRows", [])
    _ = acts  # legacy per-activity query kept for backward-compatible callers

    # contract meta + approval/award dates from live stage approvals & contracts
    contract = db.execute(text("""
        SELECT c.contractor_name, c.loa_date, c.effective_date,
               c.schedule_completion_date, c.expected_completion_date,
               c.contract_value_cr
        FROM contracts c
        JOIN packages p ON p.package_id = c.package_id
        WHERE p.scheme_id = :sid AND c.is_active AND NOT c.is_deleted
        ORDER BY c.contract_value_cr DESC NULLS LAST, c.effective_date ASC NULLS LAST
        LIMIT 1
    """), {"sid": scheme_id}).mappings().first() or {}
    stage2 = db.execute(text("""
        SELECT sanction_date, order_date, firmed_up_cost_gross_cr
        FROM stage2_approvals
        WHERE scheme_id = :sid AND is_current AND NOT is_deleted
        ORDER BY revision_no DESC LIMIT 1
    """), {"sid": scheme_id}).mappings().first() or {}
    stage1 = db.execute(text("""
        SELECT sanction_date, order_date, cost_gross_cr
        FROM stage1_approvals
        WHERE scheme_id = :sid AND is_current AND NOT is_deleted
        ORDER BY revision_no DESC LIMIT 1
    """), {"sid": scheme_id}).mappings().first() or {}

    def months_between(a, b):
        if not a or not b or b <= a:
            return None
        return (b.year - a.year) * 12 + (b.month - a.month)

    gross = fin.get("gross") or float(scheme["estimated_cost_cr"] or 0)
    original_cost = float(stage1.get("cost_gross_cr") or 0) or gross
    revised_cost = float(stage2.get("firmed_up_cost_gross_cr") or 0) or gross
    original_completion = contract.get("schedule_completion_date") or scheme["end_date"]
    anticipated_completion = contract.get("expected_completion_date") or original_completion
    manpower_table = mp_svc.manpower_month_average_table(
        db, scheme_id, m_end, scheme["agency"] or contract.get("contractor_name") or "")
    return {
        "schemeId": scheme_id, "projectName": scheme["scheme_name"],
        "month": month, "financialYear": fy_label,
        "contractMeta": {
            "agency": contract.get("contractor_name") or scheme["agency"] or "-",
            "loaDate": contract.get("loa_date"),
            "effectiveDate": contract.get("effective_date") or scheme["start_date"],
        },
        "details": {
            "approvalDate": stage2.get("sanction_date") or stage1.get("sanction_date"),
            # friend's rule: award date = effective date of contract
            "awardDate": contract.get("effective_date") or contract.get("loa_date") or stage2.get("order_date"),
            "originalCompletionDate": original_completion,
            "revisedCompletionDate": contract.get("expected_completion_date"),
            "anticipatedCompletionDate": anticipated_completion,
            "timeOverrunMonths": months_between(original_completion, anticipated_completion),
            "originalCostCr": original_cost, "revisedCostCr": revised_cost,
            "anticipatedCostCr": revised_cost,
            "costOverrunCr": round(max(0.0, revised_cost - original_cost), 2),
            "cumulativeExpenditureCr": round(fin.get("last_fy", 0.0) + fin.get("actual_fy", 0.0), 2),
        },
        "physicalProgress": activity_rows,
        "manpower": manpower_table,
    }
