"""Report Template Designer API (C4) — WYSIWYG templates stored as block lists,
plus the live data context the blocks bind to (all pulled from the unified
progress service so designer output always matches the DPR/dashboard numbers).

  GET    /report-templates                     list
  POST   /report-templates                     create {name, description, blocks}
  GET    /report-templates/{id}                one
  PUT    /report-templates/{id}                update
  DELETE /report-templates/{id}
  GET    /report-templates-data?scheme_id=&month=   data context for binding

Block shape (stored as JSONB, rendered by the frontend):
  {id, type: heading|paragraph|kpis|table|chart|statics|pagebreak,
   props: {text?, source?, columns?, chartKind?, level?}}
Data sources exposed: summary_rows, totals, capex_monthly, pmc_activities,
manpower, scurve_trend, delay, meta.
"""

from __future__ import annotations

import json
from datetime import date, datetime
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.services import delay_analysis as DA
from app.services import manpower as mp
from app.services import progress_summary as ps

router = APIRouter(tags=["Report Templates"])


def _ensure_table(db):
    db.execute(text("""
        CREATE TABLE IF NOT EXISTS report_templates (
            template_id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT DEFAULT '',
            blocks JSONB NOT NULL DEFAULT '[]'::jsonb,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """))
    db.commit()


class TemplateIn(BaseModel):
    name: str
    description: Optional[str] = ""
    blocks: List[Any] = []


@router.get("/report-templates")
def list_templates(db: Session = Depends(get_db)):
    _ensure_table(db)
    rows = db.execute(text("""
        SELECT template_id, name, description,
               jsonb_array_length(blocks) AS block_count, updated_at
        FROM report_templates ORDER BY updated_at DESC
    """)).mappings().all()
    return {"templates": [dict(r) for r in rows]}


@router.post("/report-templates")
def create_template(payload: TemplateIn, db: Session = Depends(get_db)):
    _ensure_table(db)
    row = db.execute(text("""
        INSERT INTO report_templates (name, description, blocks)
        VALUES (:n, :d, CAST(:b AS jsonb)) RETURNING template_id
    """), {"n": payload.name.strip() or "Untitled", "d": payload.description or "",
           "b": json.dumps(payload.blocks)}).mappings().first()
    db.commit()
    return {"ok": True, "template_id": row["template_id"]}


@router.get("/report-templates/{template_id}")
def get_template(template_id: int, db: Session = Depends(get_db)):
    _ensure_table(db)
    row = db.execute(text("""
        SELECT template_id, name, description, blocks, updated_at
        FROM report_templates WHERE template_id = :tid
    """), {"tid": template_id}).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="template not found")
    return dict(row)


@router.put("/report-templates/{template_id}")
def update_template(template_id: int, payload: TemplateIn, db: Session = Depends(get_db)):
    _ensure_table(db)
    res = db.execute(text("""
        UPDATE report_templates
        SET name = :n, description = :d, blocks = CAST(:b AS jsonb),
            updated_at = CURRENT_TIMESTAMP
        WHERE template_id = :tid
    """), {"tid": template_id, "n": payload.name.strip() or "Untitled",
           "d": payload.description or "", "b": json.dumps(payload.blocks)})
    db.commit()
    if res.rowcount == 0:
        raise HTTPException(status_code=404, detail="template not found")
    return {"ok": True}


@router.delete("/report-templates/{template_id}")
def delete_template(template_id: int, db: Session = Depends(get_db)):
    _ensure_table(db)
    db.execute(text("DELETE FROM report_templates WHERE template_id = :tid"), {"tid": template_id})
    db.commit()
    return {"ok": True}


# ─────────────────────────── data context ───────────────────────────────────

def _parse_month(value: Optional[str]) -> date:
    if not value:
        return date.today()
    try:
        parsed = datetime.strptime(value[:7] + "-01", "%Y-%m-%d").date()
    except ValueError:
        return date.today()
    today = date.today()
    return today if (parsed.year, parsed.month) == (today.year, today.month) else ps.month_end(parsed)


def build_report_context(db, scheme_id: int, report_date: date):
    """One data bundle every designer block can bind to — same services as the
    DPR summary / dashboards / statics report, so numbers always agree."""
    scheme = db.execute(text("""
        SELECT scheme_id, scheme_name, scheme_code,
               COALESCE(sanctioned_cost_cr, estimated_cost_cr, 0) AS gross_cost
        FROM scheme_master WHERE scheme_id = :sid
    """), {"sid": scheme_id}).mappings().first()
    if not scheme:
        raise HTTPException(status_code=404, detail="scheme not found")

    summary = ps.scheme_progress_summary(db, scheme_id, report_date)
    fy_year = ps.fy_start_year_for(report_date)
    month_lbl = ps.month_label(report_date)
    month_values = ps.scheme_physical_progress_by_month(db, scheme_id, fy_year)
    cap = ps.scheme_capex_financials(db, scheme_id, fy_year)
    fy_order = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3]
    labels = ps.fiscal_month_labels(fy_year)
    capex_monthly = [{"month": lbl, "plan": cap["monthly_plan"].get(no, 0.0),
                      "actual": cap["monthly_actual"].get(no, 0.0)}
                     for lbl, no in zip(labels, fy_order)]

    delay = {}
    scurve_trend = []
    try:
        model = DA.build_schedule_model(db, scheme_id)
        if model["activities"]:
            apab = DA.as_planned_vs_as_built(model["activities"], model["asBuilt"], model["startFloor"])
            delay = {"plannedFinishDay": apab["plannedFinish"], "forecastFinishDay": apab["asBuiltFinish"],
                     "projectSlipDays": apab["projectSlip"],
                     "drivingChain": [next((a["name"] for a in model["activities"] if a["id"] == c), c)
                                      for c in apab["drivingChain"]],
                     "origin": model["meta"]["origin"]}
    except Exception:
        delay = {}
    try:
        sc = ps.scheme_scurve_plans(db, scheme_id)
        active = next((p for p in sc.get("plans", []) if p.get("isActive")), None) or \
                 (sc.get("plans", [None]) or [None])[0]
        if active:
            scurve_trend = active["trend"]
    except Exception:
        scurve_trend = []

    return {
        "meta": {
            "schemeId": scheme_id, "schemeName": scheme["scheme_name"],
            "schemeCode": scheme["scheme_code"], "grossCostCr": float(scheme["gross_cost"] or 0),
            "month": month_lbl, "asOf": report_date.isoformat(),
            "financialYear": summary["financialYear"],
            "plannedPercent": summary["plannedPercent"], "actualPercent": summary["actualPercent"],
        },
        "totals": summary["summary"]["totals"],
        "summary_rows": summary["summary"]["summaryRows"],
        "capex_monthly": capex_monthly,
        "capex": {"grossCost": cap["gross_cost"], "expLastFy": cap["exp_last_fy"],
                  "beFy": cap["be_fy"], "reFy": cap["re_fy"]},
        "pmc_activities": (month_values.get(month_lbl) or {}).get("activityRows", []),
        "physical_by_month": {m: {"text": v["text"]} for m, v in month_values.items()},
        "manpower": mp.manpower_month_average_table(db, scheme_id, report_date),
        "scurve_trend": scurve_trend,
        "delay": delay,
    }


@router.get("/report-templates-data")
def template_data(scheme_id: int = Query(...), month: Optional[str] = None,
                  db: Session = Depends(get_db)):
    report_date = _parse_month(month)
    return build_report_context(db, scheme_id, report_date)
