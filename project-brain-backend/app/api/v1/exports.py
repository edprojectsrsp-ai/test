"""Export API (Sprint 1) — one-click PDF / DOCX / PPTX / XLSX for
Dashboard, Statics, MoS CAPEX, and PMC reports.

  POST /api/v1/exports/render              raw payload → file
  GET  /api/v1/exports/dashboard           live dashboard pack
  GET  /api/v1/exports/statics             statics / board summary grid
  GET  /api/v1/exports/mos-capex           MoS CAPEX statement
  GET  /api/v1/exports/pmc                 PMC physical progress pack
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.security.auth import require_user
from app.services import export_engine as EE

# Sprint 0 — exports are sensitive (board packs).
router = APIRouter(
    prefix="/exports",
    tags=["Exports"],
    dependencies=[Depends(require_user)],
)


# ── request models ───────────────────────────────────────────────────────────

class RenderBody(BaseModel):
    format: str = "pdf"
    filename_stem: Optional[str] = None
    payload: Dict[str, Any] = Field(default_factory=dict)


# ── helpers ──────────────────────────────────────────────────────────────────

def _file_response(data: bytes, mime: str, filename: str) -> Response:
    return Response(
        content=data,
        media_type=mime,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
        },
    )


def _render(payload: Dict[str, Any], fmt: str, stem: str) -> Response:
    try:
        data, mime, ext = EE.render(payload, fmt)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"Export failed: {e}")
    return _file_response(data, mime, EE.safe_filename(stem, ext))


def _fmt_cr(v: Any) -> str:
    try:
        return f"₹{float(v):,.2f} Cr"
    except Exception:
        return str(v or "—")


def _fmt_n(v: Any, d: int = 2) -> str:
    try:
        return f"{float(v):,.{d}f}"
    except Exception:
        return str(v or "—")


def _month_label(ym: str) -> str:
    try:
        y, m = ym.split("-")
        return date(int(y), int(m), 1).strftime("%b-%Y")
    except Exception:
        return ym or "—"


# ── raw render ───────────────────────────────────────────────────────────────

@router.post("/render")
def render_payload(body: RenderBody):
    stem = body.filename_stem or body.payload.get("title") or "export"
    return _render(body.payload, body.format, str(stem))


# ── dashboard ────────────────────────────────────────────────────────────────

@router.get("/dashboard")
def export_dashboard(
    format: str = Query("pdf", alias="format"),
    scheme_id: Optional[int] = None,
    month: Optional[str] = None,
    fy: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Build executive dashboard pack from live summary + optional scheme slice."""
    month = month or date.today().strftime("%Y-%m")
    payload = _build_dashboard_payload(db, scheme_id=scheme_id, month=month, fy=fy)
    stem = f"Dashboard_{(payload.get('project_label') or 'Portfolio').replace(' ', '_')}_{month}"
    return _render(payload, format, stem)


def _build_dashboard_payload(
    db: Session,
    scheme_id: Optional[int] = None,
    month: Optional[str] = None,
    fy: Optional[str] = None,
) -> Dict[str, Any]:
    from app.api.v1.dashboard import get_summary, get_scheme_cards
    from app.services.friend_parity import archive_available, dashboard_model

    summary = get_summary(db)
    cards = get_scheme_cards(db)
    month = month or date.today().strftime("%Y-%m")
    fy_label = fy or summary.get("current_fy") or "—"

    parity = summary.get("parity") or {}
    if not parity and archive_available(db):
        try:
            parity = dashboard_model(db)
        except Exception:
            parity = {}

    ds = summary.get("delay_summary") or {}
    status_lines = [
        f"On Time: {ds.get('on_time', 0)}",
        f"Delay < 1 Year: {ds.get('delay_lt_1y', ds.get('minor', 0))}",
        f"Delay > 1 Year: {ds.get('delay_gt_1y', ds.get('critical', 0))}",
        f"Completed this FY: {ds.get('completed_this_fy', 0)}",
    ]

    stage_text = "\n".join(status_lines)
    if parity.get("stageRows"):
        stage_text = "\n".join(
            f"{r.get('stage')}: {r.get('projects')} projects · {_fmt_cr(r.get('cost'))}"
            for r in parity["stageRows"]
        )

    capex_text = (
        f"Total CAPEX: {_fmt_cr(summary.get('total_cost_cr'))}\n"
        f"Total schemes: {summary.get('total_schemes')}"
    )
    if parity.get("capexSummary"):
        cs = parity["capexSummary"]
        capex_text = (
            f"BE/RE total: {_fmt_cr(cs.get('totalBeRe'))}\n"
            f"Actual: {_fmt_cr(cs.get('totalActual'))}\n"
            f"Variance: {_fmt_cr(cs.get('variance'))} "
            f"({_fmt_n(cs.get('variancePercent'))}%)"
        )
    elif parity.get("kpis"):
        k = parity["kpis"]
        capex_text = (
            f"Total CAPEX: {_fmt_cr(k.get('totalCapex'))}\n"
            f"Actual CAPEX: {_fmt_cr(k.get('actualCapex'))}\n"
            f"Achievement: {_fmt_n(k.get('achievementPercent'))}%"
        )

    # portfolio physical snapshot from scheme cards
    delayed = sum(1 for c in cards if (c.get("delay") or {}).get("delay_category") not in ("on_time", None)
                  and (c.get("delay") or {}).get("delay_months", 0) > 0)
    physical_text = (
        f"Portfolio projects: {len(cards)}\n"
        f"Ongoing: {(parity.get('cards') or {}).get('ongoingProjects', summary.get('by_status', {}).get('ongoing', '—'))}\n"
        f"Delayed (any): {delayed}\n"
        f"Total cost: {_fmt_cr(summary.get('total_cost_cr'))}"
    )

    header_lines = [
        "Rourkela Steel Plant — Project Department",
        f"As on {_month_label(month)}",
        f"Generated {datetime.now().strftime('%d-%b-%Y %H:%M')}",
    ]

    project_label = "Full Portfolio"
    dpr_summary: List[str] = []
    critical_rows: List[List[str]] = []
    table_sections: List[Dict[str, Any]] = []

    # scheme-level enrichment
    if scheme_id:
        try:
            from app.api.v1.dashboard import (
                get_scheme_detail, get_physical_financial,
                get_capex_snapshot, get_dpr_summary,
            )
            detail = get_scheme_detail(scheme_id=scheme_id, db=db)
            project_label = detail.get("scheme_name") or f"Scheme {scheme_id}"
            header_lines = [
                f"Scheme: {project_label}",
                f"Type: {detail.get('scheme_type') or '—'} · Status: {detail.get('current_status') or '—'}",
                f"Contractor: {detail.get('contractor') or '—'}",
                f"WBS: {detail.get('wbs_element') or '—'} · AMR: {detail.get('amr_no') or '—'}",
                f"Scheduled completion: {detail.get('schedule_completion_date') or detail.get('planned_completion_date') or '—'}",
                f"Delay days: {detail.get('delay_days', 0)} · {detail.get('status_text') or ''}",
            ]
            physical_text = (
                f"Status: {detail.get('status_text') or detail.get('current_status')}\n"
                f"Est. cost: {_fmt_cr(detail.get('estimated_cost_cr'))}\n"
                f"Sanctioned: {_fmt_cr(detail.get('sanctioned_cost_cr'))}\n"
                f"Contract value: {_fmt_cr(detail.get('contract_value_cr'))}"
            )

            pf = get_physical_financial(scheme_id=scheme_id, month=month, db=db)
            acts = pf.get("activities") or []
            if acts:
                rows = []
                for a in acts[:40]:
                    rows.append([
                        a.get("activity_name") or "",
                        _fmt_n(a.get("scope")),
                        _fmt_n(a.get("mtd_plan")),
                        _fmt_n(a.get("mtd_act")),
                        _fmt_n(a.get("fy_plan")),
                        _fmt_n(a.get("fy_act")),
                        _fmt_n(a.get("cum_act")),
                    ])
                table_sections.append({
                    "title": "Physical-Financial (activity)",
                    "headers": ["Activity", "Scope", "MTD Plan", "MTD Act", "FY Plan", "FY Act", "Cum Act"],
                    "rows": rows,
                })
                tot = pf.get("total") or {}
                physical_text += (
                    f"\nMTD plan/act: {_fmt_n(tot.get('mtd_plan'))} / {_fmt_n(tot.get('mtd_act'))}"
                    f"\nFY plan/act: {_fmt_n(tot.get('fy_plan'))} / {_fmt_n(tot.get('fy_act'))}"
                )

            try:
                cs = get_capex_snapshot(scheme_id=scheme_id, db=db)
                capex_text = "\n".join(f"{k}: {v}" for k, v in (cs or {}).items() if not str(k).startswith("_"))
            except Exception:
                pass

            try:
                dpr = get_dpr_summary(scheme_id=scheme_id, db=db)
                if isinstance(dpr, list):
                    for row in dpr[:8]:
                        if isinstance(row, dict):
                            dpr_summary.append(
                                f"{row.get('date') or ''}: "
                                f"{row.get('activity_name') or ''} "
                                f"qty={row.get('actual_qty', '')} "
                                f"{row.get('remarks') or ''}".strip()
                            )
                        else:
                            dpr_summary.append(str(row))
            except Exception:
                pass

            try:
                from app.api.v1 import delay as delay_api
                sch = delay_api.schedule(scheme_id=scheme_id, db=db)
                for r in (sch.get("rows") or [])[:15]:
                    if r.get("slipDays") and r.get("slipDays") > 0:
                        critical_rows.append([
                            r.get("name") or "",
                            r.get("plannedStartDate") or "",
                            r.get("plannedFinishDate") or "",
                            r.get("expectedFinishDate") or "",
                            f"{r.get('slipDays')}d",
                        ])
            except Exception:
                pass
        except Exception as e:
            header_lines.append(f"(scheme enrich partial: {e})")

    # portfolio table of delayed schemes
    delayed_rows = []
    for c in cards:
        d = c.get("delay") or {}
        if (d.get("delay_months") or 0) > 0:
            delayed_rows.append([
                c.get("name") or "",
                c.get("type") or "",
                c.get("scheduled_completion") or "—",
                f"{d.get('delay_months')} mo ({d.get('delay_category')})",
            ])
    if delayed_rows and not scheme_id:
        table_sections.append({
            "title": "Delayed Schemes",
            "headers": ["Scheme", "Type", "Scheduled Completion", "Delay"],
            "rows": delayed_rows[:50],
        })

    kpi_rows = [
        ["Total Projects", summary.get("total_schemes")],
        ["Total CAPEX", _fmt_cr(summary.get("total_cost_cr"))],
        ["On Time", ds.get("on_time", 0)],
        ["Delay < 1 Year", ds.get("delay_lt_1y", ds.get("minor", 0))],
        ["Delay > 1 Year", ds.get("delay_gt_1y", ds.get("critical", 0))],
        ["Completed This FY", ds.get("completed_this_fy", 0)],
    ]

    return {
        "title": "Executive Summary Dashboard",
        "project_label": project_label,
        "fy_label": fy_label,
        "month_label": _month_label(month),
        "status_text": "Live portfolio" if not scheme_id else header_lines[1] if len(header_lines) > 1 else "—",
        "header_lines": header_lines,
        "physical_text": physical_text,
        "stage_text": stage_text,
        "capex_text": capex_text,
        "dpr_summary": dpr_summary or ["No recent DPR lines for this selection."],
        "critical_rows": critical_rows,
        "missed_rows": [],
        "kpi_rows": kpi_rows,
        "table_sections": table_sections,
    }


# ── statics ──────────────────────────────────────────────────────────────────

@router.get("/statics")
def export_statics(
    scheme_id: int = Query(...),
    month: Optional[str] = None,
    package_id: Optional[int] = None,
    format: str = Query("xlsx"),
    db: Session = Depends(get_db),
):
    month = month or date.today().strftime("%Y-%m")
    data: Dict[str, Any] = {}
    try:
        from app.api.v1.progress_board import scheme_summary
        data = scheme_summary(scheme_id=scheme_id, month=month, package_id=package_id, db=db)
    except Exception:
        data = _statics_fallback(db, scheme_id, month, package_id)

    if not data:
        data = _statics_fallback(db, scheme_id, month, package_id)

    scheme_name = (
        data.get("schemeName")
        or data.get("scheme_name")
        or db.execute(text("SELECT scheme_name FROM scheme_master WHERE scheme_id=:s"),
                      {"s": scheme_id}).scalar()
        or f"Scheme {scheme_id}"
    )
    summary = (data.get("summary") or {})
    rows = summary.get("summaryRows") or data.get("summaryRows") or data.get("scopeRows") or []

    headers = [
        "Activity", "Scope", "UoM",
        "Till Last FY", "FTM Plan", "FTM Actual",
        "FY Plan", "FY Actual", "Cum Plan", "Cum Actual",
        "Cum Plan %", "Cum Actual %",
    ]
    grid = []
    for r in rows:
        grid.append([
            r.get("activity") or r.get("category") or ("OVERALL" if r.get("overall") else ""),
            r.get("scope"),
            r.get("uom") or "",
            r.get("lastFyActual"),
            r.get("ftmPlan"),
            r.get("ftmActual"),
            r.get("currentFyPlan"),
            r.get("currentFyActual"),
            r.get("cumulativePlan"),
            r.get("cumulativeActual"),
            r.get("cumulativePlanPercent"),
            r.get("cumulativeActualPercent"),
        ])

    planned = data.get("plannedPercent") or summary.get("plannedPercent")
    actual = data.get("actualPercent") or summary.get("actualPercent")

    payload = {
        "title": "Statics Report — DPR Progress Summary",
        "project_label": scheme_name,
        "fy_label": data.get("financialYear") or "—",
        "month_label": _month_label(month),
        "status_text": f"Plan { _fmt_n(planned) }% · Actual { _fmt_n(actual) }%",
        "header_lines": [
            f"Scheme #{scheme_id}: {scheme_name}",
            f"Package: {package_id or 'All'}",
            f"As of {data.get('asOf') or month}",
        ],
        "physical_text": f"Planned: {_fmt_n(planned)}%\nActual: {_fmt_n(actual)}%\nRows: {len(grid)}",
        "stage_text": "",
        "capex_text": "",
        "dpr_summary": [],
        "kpi_rows": [
            ["Planned %", planned],
            ["Actual %", actual],
            ["Activity rows", len(grid)],
        ],
        "table_sections": [{
            "title": "DPR Summary Grid",
            "headers": headers,
            "rows": grid,
        }],
    }
    stem = f"Statics_{scheme_id}_{month}"
    return _render(payload, format, stem)


def _statics_fallback(db: Session, scheme_id: int, month: str, package_id: Optional[int]) -> Dict[str, Any]:
    try:
        from app.services import progress_summary as ps
        from datetime import datetime as _dt
        report_date = _dt.strptime(month[:7] + "-01", "%Y-%m-%d").date()
        report_date = ps.month_end(report_date)
        return ps.scheme_progress_summary(db, scheme_id, report_date, package_id=package_id)
    except Exception:
        pass
    name = db.execute(text(
        "SELECT scheme_name FROM scheme_master WHERE scheme_id=:s"
    ), {"s": scheme_id}).scalar()
    return {
        "schemeName": name or f"Scheme {scheme_id}",
        "financialYear": "—",
        "summary": {"summaryRows": []},
        "plannedPercent": 0,
        "actualPercent": 0,
    }


# ── MoS CAPEX ────────────────────────────────────────────────────────────────

@router.get("/mos-capex")
def export_mos_capex(
    report_month: Optional[str] = None,
    format: str = Query("xlsx"),
    db: Session = Depends(get_db),
):
    report_month = report_month or date.today().strftime("%Y-%m")
    try:
        from app.api.v1.mos_reports import mos_capex_summary
        data = mos_capex_summary(report_month=report_month, db=db)
    except Exception as e:
        raise HTTPException(500, f"MoS CAPEX load failed: {e}")

    if not data:
        raise HTTPException(404, "No MoS CAPEX data")

    rows_in = data.get("rows") or []
    headers = [
        "No", "Category", "Projects", "Total Cost",
        "Exp Last FY", "CAPEX Current FY", "Exp Current FY", "Total Exp",
    ]
    grid = []
    for r in rows_in:
        grid.append([
            r.get("no"),
            r.get("category"),
            r.get("projects"),
            r.get("totalCost"),
            r.get("expenditureLastFy"),
            r.get("capexCurrentFy"),
            r.get("expenditureCurrentFy"),
            r.get("totalExpenditure"),
        ])
        for ch in r.get("childRows") or []:
            grid.append([
                ch.get("no"),
                "  " + str(ch.get("category") or ""),
                ch.get("projects"),
                ch.get("totalCost"),
                ch.get("expenditureLastFy"),
                ch.get("capexCurrentFy"),
                ch.get("expenditureCurrentFy"),
                ch.get("totalExpenditure"),
            ])

    payload = {
        "title": "MoS CAPEX Statement",
        "project_label": "Corporate Portfolio",
        "fy_label": data.get("financialYear") or "—",
        "month_label": _month_label(report_month),
        "status_text": f"As on {data.get('asOn') or report_month}",
        "header_lines": [
            "Ministry of Steel — CAPEX Format",
            f"Financial Year: {data.get('financialYear') or '—'}",
            f"As on: {data.get('asOn') or report_month}",
        ],
        "physical_text": "",
        "stage_text": "",
        "capex_text": f"{len(rows_in)} category rows",
        "dpr_summary": [],
        "kpi_rows": [["Categories", len(rows_in)], ["As on", data.get("asOn")]],
        "table_sections": [{
            "title": "MoS CAPEX",
            "headers": headers,
            "rows": grid,
        }],
    }
    return _render(payload, format, f"MoS_CAPEX_{report_month}")


# ── PMC ──────────────────────────────────────────────────────────────────────

@router.get("/pmc")
def export_pmc(
    scheme_id: int = Query(...),
    month: Optional[str] = None,
    format: str = Query("pdf"),
    db: Session = Depends(get_db),
):
    month = month or date.today().strftime("%Y-%m")
    try:
        from app.api.v1.mos_reports import pmc_project_detail
        data = pmc_project_detail(scheme_id=scheme_id, month=month, db=db)
    except Exception as e:
        raise HTTPException(500, f"PMC load failed: {e}")

    if not data:
        raise HTTPException(404, "No PMC data for scheme")

    details = data.get("details") or {}
    phys = data.get("physicalProgress") or []
    man = (data.get("manpower") or {}).get("rows") or []

    phys_rows = [[
        r.get("item"),
        r.get("overallTarget"),
        r.get("cumulativePrevious"),
        r.get("targetMonth"),
        r.get("achievementMonth"),
    ] for r in phys]

    man_rows = [[r.get("slNo"), r.get("agency"), r.get("manpower"), r.get("value")] for r in man]

    payload = {
        "title": "PMC — Physical Progress (Monthly)",
        "project_label": data.get("projectName") or f"Scheme {scheme_id}",
        "fy_label": data.get("financialYear") or "—",
        "month_label": _month_label(month),
        "status_text": f"Agency: {(data.get('contractMeta') or {}).get('agency') or '—'}",
        "header_lines": [
            f"Project: {data.get('projectName')}",
            f"Agency: {(data.get('contractMeta') or {}).get('agency')}",
            f"LOA: {(data.get('contractMeta') or {}).get('loaDate')}",
            f"Effective: {(data.get('contractMeta') or {}).get('effectiveDate')}",
            f"Approval: {details.get('approvalDate')} · Award: {details.get('awardDate')}",
            f"Original / Revised / Anticipated completion: "
            f"{details.get('originalCompletionDate')} / "
            f"{details.get('revisedCompletionDate')} / "
            f"{details.get('anticipatedCompletionDate')}",
            f"Time overrun (mo): {details.get('timeOverrunMonths')}",
            f"Cost orig/rev/ant: {details.get('originalCostCr')} / "
            f"{details.get('revisedCostCr')} / {details.get('anticipatedCostCr')} Cr",
            f"Cost overrun: {details.get('costOverrunCr')} Cr · "
            f"Cum exp: {details.get('cumulativeExpenditureCr')} Cr",
        ],
        "physical_text": "\n".join(
            f"{r.get('item')}: target {r.get('targetMonth')}% · ach {r.get('achievementMonth')}%"
            for r in phys[:12]
        ),
        "stage_text": f"Time overrun: {details.get('timeOverrunMonths')} months",
        "capex_text": (
            f"Original: {details.get('originalCostCr')} Cr\n"
            f"Revised: {details.get('revisedCostCr')} Cr\n"
            f"Anticipated: {details.get('anticipatedCostCr')} Cr\n"
            f"Cum expenditure: {details.get('cumulativeExpenditureCr')} Cr"
        ),
        "dpr_summary": [],
        "kpi_rows": [
            ["Original Cost (Cr)", details.get("originalCostCr")],
            ["Revised Cost (Cr)", details.get("revisedCostCr")],
            ["Cum Expenditure (Cr)", details.get("cumulativeExpenditureCr")],
            ["Time Overrun (mo)", details.get("timeOverrunMonths")],
        ],
        "table_sections": [
            {
                "title": "Physical Progress by Activity",
                "headers": ["Item", "Overall Target %", "Cumulative %", "Month Target %", "Achievement %"],
                "rows": phys_rows,
            },
            {
                "title": "Manpower Deployment",
                "headers": ["Sl", "Agency", "Manpower", "Value"],
                "rows": man_rows,
            },
        ],
    }
    return _render(payload, format, f"PMC_{scheme_id}_{month}")
