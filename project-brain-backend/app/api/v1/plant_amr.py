"""
Project Brain — Plant Level AMR dashboard (Sprint 17, t5-corrected)

A plant-level AMR "project" = a package whose parent scheme has
scheme_type = 'PLANT'.

Read-only over t5 tables — only NEW schema object is contracts.expected_completion_date
(added by 2026_05_22_contracts_expected_date.sql).

Data sources (t5 actual column names):
  packages                  → project list (filtered to PLANT schemes)
  contracts                 → effective_date, schedule_completion_date,
                              expected_completion_date (NEW), contractor_name,
                              contract_value_cr
  packages.completion_date_actual / scheme_master.actual_completion_date → completion
  plant_progress_monthly    → cumulative_actual_pct (latest), month_date
  capex_month_values + capex_actuals → monthly BE/RE/Actual, via capex_plan_rows.scheme_id

Delay logic (per spec):
  expected = contracts.expected_completion_date OR schedule_completion_date (default)
  no expected date            → On Time (unless as_on already past schedule)
  delay_days = expected - schedule
  0 < delay <= 365            → "Delay < 1 Yr"
  delay > 365                 → "Delay > 1 Yr"
  completed                   → "Completed"
  not started / no schedule   → "Yet to Start"

Endpoints (mount under /api/v1):
  GET /plant-amr/dashboard?financial_year=2026-27[&as_on=YYYY-MM-DD]
  GET /plant-amr/project/{package_id}
"""
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db

router = APIRouter(prefix="/plant-amr", tags=["Plant AMR"])

FY_MONTHS = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"]
FY_MONTH_NO = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3]
RE_MONTHS = {"Oct", "Nov", "Dec", "Jan", "Feb", "Mar"}
STATUS_LABELS = ["Yet to Start", "On Time", "Delay < 1 Yr", "Delay > 1 Yr", "Completed"]


def _fy_bounds(fy: Optional[str]) -> tuple[date, date, int]:
    today = date.today()
    default_start = today.year if today.month >= 4 else today.year - 1
    start_year = default_start
    if fy:
        try:
            start_year = int(fy.replace("FY", "").strip().split("-")[0])
        except (ValueError, IndexError):
            start_year = default_start
    return date(start_year, 4, 1), date(start_year + 1, 3, 31), start_year


def _delay_bucket(days: int) -> str:
    if days <= 0:
        return "On Time"
    if days <= 365:
        return "Delay < 1 Yr"
    return "Delay > 1 Yr"


def _has_column(db: Session, table: str, column: str) -> bool:
    try:
        return db.execute(text("""
            SELECT 1 FROM information_schema.columns
            WHERE table_schema='public' AND table_name=:t AND column_name=:c LIMIT 1
        """), {"t": table, "c": column}).first() is not None
    except Exception:
        return False


def _classify(row: dict, as_on: date) -> dict:
    schedule = row.get("schedule_completion_date")
    expected_raw = row.get("expected_completion_date")
    expected = expected_raw or schedule
    completion = row.get("actual_completion_date")
    started = row.get("effective_date") or row.get("start_date_actual")
    physical = float(row.get("physical_pct") or 0)

    if (completion and as_on >= completion) or physical >= 100:
        return {"status": "Completed", "delay_days": 0}
    if not started or (started and started > as_on):
        return {"status": "Yet to Start", "delay_days": 0}
    if not schedule:
        return {"status": "On Time", "delay_days": 0}

    if not expected_raw:
        # No expected date → on time, unless as_on already blew past schedule
        if as_on > schedule:
            d = (as_on - schedule).days
            return {"status": _delay_bucket(d), "delay_days": d}
        return {"status": "On Time", "delay_days": 0}

    delay_days = (expected - schedule).days if (expected and schedule) else 0
    if delay_days <= 0:
        return {"status": "On Time", "delay_days": 0}
    return {"status": _delay_bucket(delay_days), "delay_days": delay_days}


def _fetch_projects(db: Session, as_on: date):
    has_expected = _has_column(db, "contracts", "expected_completion_date")
    expected_select = "c.expected_completion_date" if has_expected else "NULL::date AS expected_completion_date"

    rows = db.execute(text(f"""
        SELECT
            p.package_id, p.package_no, p.package_name, p.package_status,
            p.package_value_cr, p.package_estimate_cr, p.project_manager_name,
            p.start_date_actual, p.completion_date_actual,
            p.scheme_id, sm.scheme_name, sm.amr_no, sm.actual_completion_date AS scheme_completion,
            c.contractor_name, c.contract_no, c.effective_date,
            c.schedule_completion_date, {expected_select},
            c.contract_value_cr,
            pp.cumulative_actual_pct AS physical_pct,
            pp.month_date AS physical_as_of,
            pp.variance_pct, pp.risk_level
        FROM packages p
        JOIN scheme_master sm ON sm.scheme_id = p.scheme_id
        LEFT JOIN LATERAL (
            SELECT * FROM contracts c2
            WHERE c2.package_id = p.package_id AND NOT c2.is_deleted
            ORDER BY c2.created_at DESC NULLS LAST, c2.contract_id DESC
            LIMIT 1
        ) c ON TRUE
        LEFT JOIN LATERAL (
            SELECT * FROM plant_progress_monthly ppm
            WHERE ppm.package_id = p.package_id
            ORDER BY ppm.month_date DESC
            LIMIT 1
        ) pp ON TRUE
        WHERE sm.scheme_type::text = 'plant'
          AND NOT p.is_deleted AND NOT sm.is_deleted
          AND NOT p.is_scheme_mirror
        ORDER BY sm.scheme_name, p.package_no
    """)).mappings().all()

    out = []
    for r in rows:
        d = dict(r)
        d["actual_completion_date"] = d.get("completion_date_actual") or d.get("scheme_completion")
        ctx = _classify(d, as_on)
        schedule = d.get("schedule_completion_date")
        expected = d.get("expected_completion_date") or schedule
        out.append({
            "package_id": d["package_id"], "scheme_id": d["scheme_id"],
            "scheme_name": d["scheme_name"], "amr_no": d.get("amr_no"),
            "project_name": d["package_name"], "package_no": d["package_no"],
            "contractor_name": d.get("contractor_name"), "contract_no": d.get("contract_no"),
            "gross_cost_cr": round(float(d.get("contract_value_cr") or d.get("package_value_cr") or 0), 2),
            "effective_date": d["effective_date"].isoformat() if d.get("effective_date") else None,
            "scheduled_completion_date": schedule.isoformat() if schedule else None,
            "expected_completion_date": expected.isoformat() if expected else None,
            "actual_completion_date": d["actual_completion_date"].isoformat() if d.get("actual_completion_date") else None,
            "physical_progress_percent": round(float(d.get("physical_pct") or 0), 2),
            "physical_as_of": d["physical_as_of"].isoformat() if d.get("physical_as_of") else None,
            "variance_pct": round(float(d["variance_pct"]), 2) if d.get("variance_pct") is not None else None,
            "risk_level": d.get("risk_level"),
            "status": ctx["status"], "delay_days": ctx["delay_days"],
            "delay_category": ctx["status"] if ctx["delay_days"] > 0 else "",
            "project_manager_name": d.get("project_manager_name"),
            "package_status": d.get("package_status"),
        })
    return out


def _monthly_capex(db: Session, scheme_ids: list[int], fy_year: str):
    """Per-scheme month→{be,re,actual} from the LIVE capex schema:
       capex_plan_rows.scheme_id → capex_month_values (be/re) + capex_actuals (actual).
       Month numbering is calendar (1..12); we map into FY order labels."""
    if not scheme_ids:
        return {}

    # BE/RE planned per month — from capex_month_values via plan rows of BE/RE plans for this FY
    plan_rows = db.execute(text("""
        SELECT cpr.scheme_id, cmv.month_no, cph.plan_type,
               COALESCE(SUM(cmv.be_amount),0) AS be, COALESCE(SUM(cmv.re_amount),0) AS re
        FROM capex_month_values cmv
        JOIN capex_plan_rows cpr ON cpr.id = cmv.plan_row_id
        JOIN capex_plan_header cph ON cph.id = cpr.plan_id
        WHERE cpr.scheme_id = ANY(:ids) AND cph.fy_year = :fy
          AND cph.plan_status <> 'Archived'
        GROUP BY cpr.scheme_id, cmv.month_no, cph.plan_type
    """), {"ids": scheme_ids, "fy": fy_year}).mappings().all()

    # Actuals — from capex_actuals via plan rows
    actual_rows = db.execute(text("""
        SELECT cpr.scheme_id, ca.month_no, COALESCE(SUM(ca.amount),0) AS actual
        FROM capex_actuals ca
        JOIN capex_plan_rows cpr ON cpr.id = ca.plan_row_id
        WHERE cpr.scheme_id = ANY(:ids) AND ca.fy_year = :fy
        GROUP BY cpr.scheme_id, ca.month_no
    """), {"ids": scheme_ids, "fy": fy_year}).mappings().all()

    by_scheme: dict[int, dict[str, dict]] = {}
    def slot(sid):
        if sid not in by_scheme:
            by_scheme[sid] = {m: {"be": 0.0, "re": 0.0, "actual": 0.0} for m in FY_MONTHS}
        return by_scheme[sid]

    def label(month_no):
        try:
            return FY_MONTHS[FY_MONTH_NO.index(month_no)]
        except ValueError:
            return None

    for r in plan_rows:
        lbl = label(r["month_no"])
        if not lbl:
            continue
        s = slot(r["scheme_id"])[lbl]
        if (r["plan_type"] or "").upper() == "RE":
            s["re"] += float(r["re"] or 0) or float(r["be"] or 0)
        else:
            s["be"] += float(r["be"] or 0)
    for r in actual_rows:
        lbl = label(r["month_no"])
        if lbl:
            slot(r["scheme_id"])[lbl]["actual"] += float(r["actual"] or 0)
    return by_scheme


def _attach_monthly(projects, capex_by_scheme):
    for p in projects:
        sched = capex_by_scheme.get(p["scheme_id"], {m: {"be": 0, "re": 0, "actual": 0} for m in FY_MONTHS})
        p["monthly"] = [
            {"month": m, "be": round(sched[m]["be"], 2),
             "re": round(sched[m]["re"], 2) if m in RE_MONTHS else None,
             "actual": round(sched[m]["actual"], 2)}
            for m in FY_MONTHS
        ]


@router.get("/dashboard")
def dashboard(financial_year: Optional[str] = None, as_on: Optional[str] = None,
              db: Session = Depends(get_db)):
    fy_start, fy_end, start_year = _fy_bounds(financial_year)
    as_on_date = date.fromisoformat(as_on) if as_on else date.today()
    fy_label = financial_year or f"{start_year}-{(start_year + 1) % 100:02d}"

    projects = _fetch_projects(db, as_on_date)
    scheme_ids = list({p["scheme_id"] for p in projects})
    capex_by_scheme = _monthly_capex(db, scheme_ids, fy_label)
    _attach_monthly(projects, capex_by_scheme)

    total = len(projects)
    total_gross = round(sum(p["gross_cost_cr"] for p in projects), 2)
    status_counts = {s: 0 for s in STATUS_LABELS}
    status_gross = {s: 0.0 for s in STATUS_LABELS}
    for p in projects:
        status_counts[p["status"]] = status_counts.get(p["status"], 0) + 1
        status_gross[p["status"]] = status_gross.get(p["status"], 0.0) + p["gross_cost_cr"]
    overall = round(sum(p["physical_progress_percent"] for p in projects) / total, 2) if total else 0.0
    cum_be = round(sum(sum((m["be"] or 0) for m in p["monthly"]) for p in projects), 2)
    cum_re = round(sum(sum((m["re"] or 0) for m in p["monthly"]) for p in projects), 2)
    cum_actual = round(sum(sum((m["actual"] or 0) for m in p["monthly"]) for p in projects), 2)

    return {
        "as_on": as_on_date.isoformat(),
        "financial_year": fy_label,
        "financial_year_months": FY_MONTHS,
        "re_months": [m for m in FY_MONTHS if m in RE_MONTHS],
        "projects": projects,
        "summary": {
            "total_projects": total,
            "total_gross_cost_cr": total_gross,
            "status_counts": status_counts,
            "status_gross_cost_cr": {k: round(v, 2) for k, v in status_gross.items()},
            "status_percent": {k: round(v / total * 100, 2) if total else 0 for k, v in status_counts.items()},
            "overall_progress_percent": overall,
            "cumulative_be_cr": cum_be,
            "cumulative_re_cr": cum_re,
            "cumulative_actual_cr": cum_actual,
        },
    }


@router.get("/project/{package_id}")
def project_detail(package_id: int, financial_year: Optional[str] = None,
                   as_on: Optional[str] = None, db: Session = Depends(get_db)):
    _, _, start_year = _fy_bounds(financial_year)
    fy_label = financial_year or f"{start_year}-{(start_year + 1) % 100:02d}"
    as_on_date = date.fromisoformat(as_on) if as_on else date.today()

    projects = _fetch_projects(db, as_on_date)
    match = next((p for p in projects if p["package_id"] == package_id), None)
    if not match:
        return {"error": "Package not found among PLANT-type projects", "package_id": package_id}

    capex = _monthly_capex(db, [match["scheme_id"]], fy_label)
    _attach_monthly([match], capex)

    history = db.execute(text("""
        SELECT month_date, cumulative_actual_pct, cumulative_planned_pct,
               variance_pct, notes
        FROM plant_progress_monthly
        WHERE package_id = :pid
        ORDER BY month_date
    """), {"pid": package_id}).mappings().all()
    match["progress_history"] = [
        {"month": h["month_date"].isoformat() if h["month_date"] else None,
         "cumulative_actual_pct": float(h["cumulative_actual_pct"] or 0),
         "cumulative_planned_pct": float(h["cumulative_planned_pct"] or 0),
         "variance_pct": float(h["variance_pct"]) if h["variance_pct"] is not None else None,
         "note": h["notes"]}
        for h in history
    ]
    return match
