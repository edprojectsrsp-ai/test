"""Progress Board API — friend-parity endpoints, all derived from the unified
progress service (app/services/progress_summary.py) so the DPR screen, the
dashboards and the reports always show the same numbers.

Endpoints:
  GET /board/scheme-summary/{scheme_id}?month=YYYY-MM
  GET /board/physical-progress-summary?as_of=YYYY-MM-DD      (portfolio)
  GET /board/project-details/{scheme_id}?month=Mon-YY        (drill-down)
  GET /board/daily-report/{scheme_id}                        (date × activity matrix)
  GET /board/manpower/{scheme_id}?date=YYYY-MM-DD
  PUT /board/manpower/{scheme_id}
  POST/DELETE /board/manpower/{scheme_id}/contractors
  GET /board/reports-summary?fy=YYYY                         (MoS / PMC month lookup)
"""

from __future__ import annotations

from datetime import date, datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.security.auth import require_user
from app.services import manpower as mp
from app.services import progress_summary as ps

# Sprint 0 — board routes require auth.
router = APIRouter(
    prefix="/board",
    tags=["Progress Board"],
    dependencies=[Depends(require_user)],
)


def _parse_day(value: Optional[str]) -> date:
    if not value:
        return date.today()
    try:
        return datetime.strptime(value[:10], "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Bad date: {value}")


def _parse_month(value: Optional[str]) -> date:
    """Accept YYYY-MM or Mon-YY; returns the month-end date (report as-of)."""
    if not value:
        return date.today()
    parsed = ps.month_label_date(value)
    if parsed is None:
        try:
            parsed = datetime.strptime(value[:7] + "-01", "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Bad month: {value}")
    today = date.today()
    end = ps.month_end(parsed)
    # current month reports run "as of today", past months as of month end
    return today if (parsed.year, parsed.month) == (today.year, today.month) else end


# ─────────────────────────── scheme summary ─────────────────────────────────

@router.get("/scheme-summary/{scheme_id}")
def scheme_summary(scheme_id: int, month: Optional[str] = None,
                   package_id: Optional[int] = None, db: Session = Depends(get_db)):
    report_date = _parse_month(month)
    payload = ps.scheme_progress_summary(db, scheme_id, report_date, package_id=package_id)
    payload["manpowerDeploymentSummary"] = mp.manpower_month_average_table(db, scheme_id, report_date)
    return payload


# ─────────────────────── portfolio physical progress ────────────────────────

@router.get("/physical-progress-summary")
def physical_progress_summary(as_of: Optional[str] = None, db: Session = Depends(get_db)):
    report_date = _parse_day(as_of)
    schemes = db.execute(text("""
        SELECT DISTINCT s.scheme_id, s.scheme_name, s.scheme_code,
               COALESCE(s.sanctioned_cost_cr, s.estimated_cost_cr, 0) AS gross_cost
        FROM scheme_master s
        JOIN packages p       ON p.scheme_id = s.scheme_id AND NOT p.is_deleted
        JOIN progress_plans pp ON pp.package_id = p.package_id
                               AND pp.is_locked = TRUE AND pp.is_current = TRUE
                               AND NOT pp.is_deleted
        WHERE s.current_status = 'ongoing' AND NOT s.is_deleted
        ORDER BY s.scheme_id
    """)).mappings().all()

    projects = []
    for s in schemes:
        sid = int(s["scheme_id"])
        try:
            summary = ps.scheme_progress_summary(db, sid, report_date)
        except Exception as error:  # keep the portfolio view alive per-project
            projects.append({
                "id": sid, "projectName": s["scheme_name"], "uniqueId": s["scheme_code"],
                "grossCost": ps._f(s["gross_cost"]), "plannedPercent": 0, "actualPercent": 0,
                "summaryRows": [], "error": str(error),
            })
            continue
        rows = summary["summary"]["summaryRows"]
        activity_rows = [r for r in rows if not r.get("overall") and r.get("source") != "capex"]
        if not activity_rows:
            continue
        overall_rows = [{**r, "category": "Overall Physical Progress"} for r in rows if r.get("overall")]
        projects.append({
            "id": sid,
            "projectName": s["scheme_name"], "uniqueId": s["scheme_code"],
            "grossCost": ps._f(s["gross_cost"]),
            "plannedPercent": summary["plannedPercent"],
            "actualPercent": summary["actualPercent"],
            "planMonth": summary["planMonth"], "nextPlanMonth": summary["nextPlanMonth"],
            "summaryRows": [*activity_rows, *overall_rows],
            "manpowerPmcTable": mp.manpower_month_average_table(db, sid, report_date),
            "error": "",
        })
    return {
        "asOf": report_date.isoformat(),
        "financialYear": ps.fy_label_for(report_date),
        "projects": projects,
    }


# ─────────────────────────── project drill-down ─────────────────────────────

@router.get("/project-details/{scheme_id}")
def project_details(scheme_id: int, month: Optional[str] = None, db: Session = Depends(get_db)):
    report_date = _parse_month(month)
    fy_year = ps.fy_start_year_for(report_date)
    fiscal_labels = ps.fiscal_month_labels(fy_year)
    selected_month = ps.month_label(report_date)

    scurve = ps.scheme_scurve_plans(db, scheme_id)
    remarks = ps.scheme_remarks_month_summary(db, scheme_id, fy_year)
    dpr = ps.scheme_progress_summary(db, scheme_id, report_date)
    cap = ps.scheme_capex_financials(db, scheme_id, fy_year)

    fy_order = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3]
    capex_monthly = [{
        "month": lbl.split("-")[0], "monthKey": lbl,
        "plan": cap["monthly_plan"].get(no, 0.0),
        "actual": cap["monthly_actual"].get(no, 0.0),
    } for lbl, no in zip(fiscal_labels, fy_order)]

    selected = next((r for r in remarks if r["month"] == selected_month), None)
    return {
        "projectId": scheme_id,
        "financialYear": ps.fy_label_for(report_date),
        "selectedMonth": selected_month,
        "selectedMonthDate": report_date.isoformat(),
        "capex": {
            "grossCost": cap["gross_cost"],
            "actualTillLastFy": cap["exp_last_fy"],
            "beCurrentFy": cap["be_fy"], "reCurrentFy": cap["re_fy"],
            "monthly": capex_monthly,
        },
        "scurve": scurve,
        "monthlyRemarkSummary": remarks,
        "selectedMonthRemarks": (selected or {}).get("remarks", []),
        "dprSummary": dpr["summary"],
        "dprScopeRows": dpr["scopeRows"],
        "plannedPercent": dpr["plannedPercent"],
        "actualPercent": dpr["actualPercent"],
        "manpowerPmcTable": mp.manpower_month_average_table(db, scheme_id, report_date),
    }


# ─────────────────────── DPR daily report (matrix) ──────────────────────────

@router.get("/daily-report/{scheme_id}")
def daily_report(scheme_id: int, db: Session = Depends(get_db)):
    activities = ps.scheme_current_activities(db, scheme_id)
    columns = [{
        "id": int(a["activity_id"]),
        "label": a["activity_name"],
        "category": a["activity_category"] or "",
        "uom": a["uom"], "scope": ps._f(a["scope_qty"]),
        "package": a["package_name"],
    } for a in activities]

    activity_ids = [c["id"] for c in columns]
    by_date: dict = {}
    if activity_ids:
        rows = db.execute(text("""
            SELECT da.actual_date, da.activity_id,
                   COALESCE(SUM(da.actual_qty), 0) AS actual_qty
            FROM daily_actuals da
            WHERE da.activity_id = ANY(:ids)
            GROUP BY da.actual_date, da.activity_id
            ORDER BY da.actual_date DESC
        """), {"ids": activity_ids}).mappings().all()
        for r in rows:
            by_date.setdefault(r["actual_date"], {})[str(int(r["activity_id"]))] = ps._f(r["actual_qty"])

    mp.ensure_manpower_tables(db)
    manpower_records = db.execute(text("""
        SELECT report_date,
               COALESCE(SUM(CASE WHEN section_name = :rsp AND category_name = 'Executives' THEN qty ELSE 0 END), 0)  AS rsp_executive,
               COALESCE(SUM(CASE WHEN section_name = :rsp AND category_name = 'Non-Executives' THEN qty ELSE 0 END), 0) AS rsp_non_executive,
               COALESCE(SUM(CASE WHEN category_name = 'Contractor' AND LOWER(COALESCE(role_name, '')) LIKE '%supervisor%' THEN qty ELSE 0 END), 0) AS contractor_supervisor,
               COALESCE(SUM(CASE WHEN category_name = 'Contractor' AND LOWER(COALESCE(role_name, '')) NOT LIKE '%supervisor%' THEN qty ELSE 0 END), 0) AS contractor_labour,
               COALESCE(SUM(CASE WHEN section_name = :agency THEN qty ELSE 0 END), 0) AS executing_agency
        FROM daily_progress_manpower
        WHERE scheme_id = :sid
        GROUP BY report_date
        ORDER BY report_date DESC
    """), {"sid": scheme_id, "rsp": mp.RSP_SECTION, "agency": mp.AGENCY_SECTION}).mappings().all()

    return {
        "activityReportColumns": columns,
        "activityReportRows": [
            {"date": d.isoformat(), "values": by_date[d]}
            for d in sorted(by_date.keys(), reverse=True)
        ],
        "manpowerRecords": [{
            "report_date": r["report_date"].isoformat(),
            "rsp_executive": ps._f(r["rsp_executive"]),
            "rsp_non_executive": ps._f(r["rsp_non_executive"]),
            "contractor_supervisor": ps._f(r["contractor_supervisor"]),
            "contractor_labour": ps._f(r["contractor_labour"]),
            "executing_agency": ps._f(r["executing_agency"]),
        } for r in manpower_records],
    }


# ─────────────────────────── manpower matrix ────────────────────────────────

class ManpowerRowPayload(BaseModel):
    category: str
    contractorName: Optional[str] = ""
    trade: Optional[str] = ""
    lastMonth: Optional[float] = 0
    today: Optional[float] = 0
    monthTarget: Optional[str] = ""
    remarks: Optional[str] = ""


class ManpowerSavePayload(BaseModel):
    report_date: str
    rows: List[ManpowerRowPayload]


class ContractorPayload(BaseModel):
    contractorName: str


@router.get("/manpower/{scheme_id}")
def get_manpower(scheme_id: int, date_: Optional[str] = Query(None, alias="date"),
                 db: Session = Depends(get_db)):
    report_date = _parse_day(date_)
    rows, agency = mp.load_manpower_rows(db, scheme_id, report_date)
    return {
        "reportDate": report_date.isoformat(),
        "agencyName": agency,
        "rows": rows,
        "contractors": mp.known_contractors(db, scheme_id),
        "monthAverage": mp.manpower_month_average_table(db, scheme_id, report_date, agency),
    }


@router.put("/manpower/{scheme_id}")
def put_manpower(scheme_id: int, payload: ManpowerSavePayload, db: Session = Depends(get_db)):
    report_date = _parse_day(payload.report_date)
    mp.save_manpower_rows(db, scheme_id, report_date, [r.dict() for r in payload.rows])
    return {"ok": True, "saved": len(payload.rows), "reportDate": report_date.isoformat()}


@router.post("/manpower/{scheme_id}/contractors")
def add_contractor(scheme_id: int, payload: ContractorPayload, db: Session = Depends(get_db)):
    name = payload.contractorName.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Contractor name is required")
    mp.ensure_manpower_tables(db)
    db.execute(text("""
        INSERT INTO daily_progress_manpower_contractors (scheme_id, contractor_name, is_active)
        VALUES (:sid, :name, TRUE)
        ON CONFLICT (scheme_id, contractor_name)
        DO UPDATE SET is_active = TRUE, updated_at = CURRENT_TIMESTAMP
    """), {"sid": scheme_id, "name": name})
    db.commit()
    return {"ok": True, "contractors": mp.known_contractors(db, scheme_id)}


@router.delete("/manpower/{scheme_id}/contractors")
def remove_contractor(scheme_id: int, contractorName: str, db: Session = Depends(get_db)):
    mp.ensure_manpower_tables(db)
    db.execute(text("""
        INSERT INTO daily_progress_manpower_contractors (scheme_id, contractor_name, is_active)
        VALUES (:sid, :name, FALSE)
        ON CONFLICT (scheme_id, contractor_name)
        DO UPDATE SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP
    """), {"sid": scheme_id, "name": contractorName.strip()})
    db.commit()
    return {"ok": True, "contractors": mp.known_contractors(db, scheme_id)}


# ─────────────────────── reports month lookup (MoS / PMC) ────────────────────

@router.get("/reports-summary")
def reports_summary(fy: Optional[int] = None, scheme_id: Optional[int] = None,
                    db: Session = Depends(get_db)):
    fy_year = int(fy) if fy else ps.fy_start_year_for(date.today())
    labels = ps.fiscal_month_labels(fy_year)

    filter_sql = "AND s.scheme_id = :one" if scheme_id else ""
    params = {"one": scheme_id} if scheme_id else {}
    schemes = db.execute(text(f"""
        SELECT DISTINCT s.scheme_id, s.scheme_name, s.scheme_code, s.current_status,
               COALESCE(s.sanctioned_cost_cr, s.estimated_cost_cr, 0) AS gross_cost,
               s.planned_completion_date
        FROM scheme_master s
        JOIN packages p        ON p.scheme_id = s.scheme_id AND NOT p.is_deleted
        JOIN progress_plans pp ON pp.package_id = p.package_id
                               AND pp.is_locked = TRUE AND NOT pp.is_deleted
        WHERE NOT s.is_deleted {filter_sql}
        ORDER BY s.scheme_id
    """), params).mappings().all()

    out = []
    for s in schemes:
        sid = int(s["scheme_id"])
        month_values = ps.scheme_physical_progress_by_month(db, sid, fy_year)
        if not month_values:
            continue
        out.append({
            "schemeId": sid,
            "projectName": s["scheme_name"], "uniqueId": s["scheme_code"],
            "status": s["current_status"],
            "grossCost": ps._f(s["gross_cost"]),
            "physicalProgressByMonth": {m: v["text"] for m, v in month_values.items()},
            "physicalProgressValuesByMonth": {
                m: {k: v[k] for k in ("lastFyActualPercent", "currentFyPlanPercent", "currentFyActualPercent")}
                for m, v in month_values.items()
            },
            "physicalActivityProgressByMonth": {m: v["activityRows"] for m, v in month_values.items()},
            "manpowerPmcTableByMonth": mp.manpower_pmc_by_month(db, sid, fy_year),
        })
    return {"financialYear": f"{fy_year}-{str(fy_year + 1)[2:]}", "reportMonths": labels, "projects": out}
