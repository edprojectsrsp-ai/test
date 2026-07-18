"""Report Studio API — self-service KPI / metric builder.

  GET    /report-studio/datasets            curated dataset registry (fields + measures)
  POST   /report-studio/query               run an ad-hoc structured query
  GET    /report-studio/metrics             list saved metrics
  POST   /report-studio/metrics             save a metric (query spec + viz)
  GET    /report-studio/metrics/{id}        fetch one
  PUT    /report-studio/metrics/{id}        update
  DELETE /report-studio/metrics/{id}        delete
  POST   /report-studio/metrics/{id}/run    execute a saved metric

All queries are compiled to safe parameterized SQL against the dataset registry
(app/services/report_studio.py). No raw user SQL is accepted or executed.
"""
from __future__ import annotations

import json
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.security.auth import require_user
from app.services import report_studio as RS

router = APIRouter(
    prefix="/report-studio",
    tags=["Report Studio"],
    dependencies=[Depends(require_user)],
)


def _run_query(db: Session, q: RS.QueryIn) -> dict[str, Any]:
    try:
        sql, params, columns = RS.compile_query(q)
    except RS.CompileError as e:
        raise HTTPException(status_code=400, detail=str(e))
    try:
        rows = db.execute(text(sql), params).mappings().all()
    except Exception as e:  # surface SQL errors as 400 (bad query), not 500
        raise HTTPException(status_code=400, detail=f"Query failed: {str(e)[:300]}")
    # jsonify (dates, Decimals) — mappings() already gives dict-likes; coerce values
    out_rows = []
    for r in rows:
        row = {}
        for k, v in dict(r).items():
            if hasattr(v, "isoformat"):
                row[k] = v.isoformat()
            elif isinstance(v, (int, float, str, bool)) or v is None:
                row[k] = v
            else:
                row[k] = float(v)  # Decimal
        out_rows.append(row)
    columns, out_rows = RS.apply_postprocess(q, columns, out_rows)
    return {"columns": columns, "rows": out_rows, "sql": sql, "row_count": len(out_rows)}


@router.get("/datasets")
def datasets():
    return {"datasets": RS.registry_public()}


@router.post("/query")
def run_query(q: RS.QueryIn, db: Session = Depends(get_db)):
    return _run_query(db, q)


@router.get("/field-values")
def field_values(dataset: str, field: str, search: Optional[str] = None,
                 limit: int = 200, db: Session = Depends(get_db)):
    """Distinct values of a dimension — powers the filter member-picker."""
    try:
        sql, params = RS.compile_field_values(dataset, field, search, limit)
    except RS.CompileError as e:
        raise HTTPException(status_code=400, detail=str(e))
    try:
        rows = db.execute(text(sql), params).all()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Lookup failed: {str(e)[:200]}")
    vals = []
    for (v,) in rows:
        if v is None:
            continue
        vals.append(v.isoformat() if hasattr(v, "isoformat") else v)
    return {"dataset": dataset, "field": field, "values": vals}


# ---------------------------------------------------------------- saved metrics

class MetricIn(BaseModel):
    name: str
    description: Optional[str] = None
    dataset: str
    spec: RS.QueryIn
    viz: str = "kpi"
    folder: Optional[str] = None
    is_pinned: bool = False


def _metric_row(db: Session, metric_id: int) -> dict:
    row = db.execute(
        text("SELECT * FROM rs_metrics WHERE metric_id = :m"), {"m": metric_id}
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Metric not found")
    return dict(row)


@router.get("/metrics")
def list_metrics(db: Session = Depends(get_db)):
    rows = db.execute(text(
        "SELECT metric_id, name, description, dataset, viz, folder, is_pinned, updated_at "
        "FROM rs_metrics ORDER BY is_pinned DESC, updated_at DESC"
    )).mappings().all()
    return {"metrics": [dict(r) for r in rows]}


@router.post("/metrics")
def create_metric(payload: MetricIn, db: Session = Depends(get_db)):
    if payload.dataset not in RS.DATASETS:
        raise HTTPException(status_code=400, detail=f"Unknown dataset '{payload.dataset}'")
    # validate the spec compiles before saving
    try:
        RS.compile_query(payload.spec)
    except RS.CompileError as e:
        raise HTTPException(status_code=400, detail=f"Invalid metric spec: {e}")
    mid = db.execute(text(
        "INSERT INTO rs_metrics (name, description, dataset, spec, viz, folder, is_pinned) "
        "VALUES (:n, :d, :ds, CAST(:spec AS jsonb), :viz, :folder, :pin) RETURNING metric_id"
    ), {
        "n": payload.name, "d": payload.description, "ds": payload.dataset,
        "spec": payload.spec.model_dump_json(), "viz": payload.viz,
        "folder": payload.folder, "pin": payload.is_pinned,
    }).scalar()
    db.commit()
    return {"metric_id": mid}


@router.get("/metrics/{metric_id}")
def get_metric(metric_id: int, db: Session = Depends(get_db)):
    row = _metric_row(db, metric_id)
    if isinstance(row.get("spec"), str):
        row["spec"] = json.loads(row["spec"])
    return row


@router.put("/metrics/{metric_id}")
def update_metric(metric_id: int, payload: MetricIn, db: Session = Depends(get_db)):
    _metric_row(db, metric_id)
    try:
        RS.compile_query(payload.spec)
    except RS.CompileError as e:
        raise HTTPException(status_code=400, detail=f"Invalid metric spec: {e}")
    db.execute(text(
        "UPDATE rs_metrics SET name=:n, description=:d, dataset=:ds, spec=CAST(:spec AS jsonb), "
        "viz=:viz, folder=:folder, is_pinned=:pin, updated_at=now() WHERE metric_id=:m"
    ), {
        "n": payload.name, "d": payload.description, "ds": payload.dataset,
        "spec": payload.spec.model_dump_json(), "viz": payload.viz,
        "folder": payload.folder, "pin": payload.is_pinned, "m": metric_id,
    })
    db.commit()
    return {"ok": True}


@router.delete("/metrics/{metric_id}")
def delete_metric(metric_id: int, db: Session = Depends(get_db)):
    _metric_row(db, metric_id)
    db.execute(text("DELETE FROM rs_metrics WHERE metric_id = :m"), {"m": metric_id})
    db.commit()
    return {"ok": True}


@router.post("/metrics/{metric_id}/run")
def run_metric(metric_id: int, db: Session = Depends(get_db)):
    row = _metric_row(db, metric_id)
    spec = row["spec"]
    if isinstance(spec, str):
        spec = json.loads(spec)
    q = RS.QueryIn(**spec)
    result = _run_query(db, q)
    result["metric"] = {"metric_id": metric_id, "name": row["name"], "viz": row["viz"]}
    return result


# ---------------------------------------------------------------- custom reports
# A custom report = an ordered list of sections, each a full Report Studio
# query spec (dimensions/measures/formulas/filters/pivot/totals) + a title.
# Runs live against the semantic layer; exports to XLSX and DOCX.

class SectionIn(BaseModel):
    title: str
    note: Optional[str] = None
    spec: RS.QueryIn


class ReportIn(BaseModel):
    name: str
    description: Optional[str] = None
    category: Optional[str] = None
    sections: list[SectionIn]


def _ensure_reports_table(db: Session):
    db.execute(text(
        "CREATE TABLE IF NOT EXISTS rs_reports ("
        " report_id SERIAL PRIMARY KEY,"
        " name VARCHAR(200) NOT NULL,"
        " description TEXT,"
        " category VARCHAR(80),"
        " sections JSONB NOT NULL DEFAULT '[]'::jsonb,"
        " created_at TIMESTAMP NOT NULL DEFAULT now(),"
        " updated_at TIMESTAMP NOT NULL DEFAULT now())"
    ))
    db.commit()


def _validate_sections(payload: ReportIn):
    if not payload.sections:
        raise HTTPException(status_code=400, detail="A report needs at least one section")
    for s in payload.sections:
        try:
            RS.compile_query(s.spec)
        except RS.CompileError as e:
            raise HTTPException(status_code=400, detail=f"Section '{s.title}': {e}")


def _report_row(db: Session, report_id: int) -> dict:
    row = db.execute(text("SELECT * FROM rs_reports WHERE report_id = :r"),
                     {"r": report_id}).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Report not found")
    out = dict(row)
    if isinstance(out.get("sections"), str):
        out["sections"] = json.loads(out["sections"])
    return out


@router.get("/reports")
def list_reports(category: Optional[str] = None, db: Session = Depends(get_db)):
    _ensure_reports_table(db)
    where = "WHERE category = :cat" if category else ""
    rows = db.execute(text(
        "SELECT report_id, name, description, category, "
        "       jsonb_array_length(sections) AS section_count, updated_at "
        f"FROM rs_reports {where} ORDER BY updated_at DESC"
    ), {"cat": category} if category else {}).mappings().all()
    return {"reports": [dict(r) for r in rows]}


@router.post("/reports")
def create_report(payload: ReportIn, db: Session = Depends(get_db)):
    _ensure_reports_table(db)
    _validate_sections(payload)
    rid = db.execute(text(
        "INSERT INTO rs_reports (name, description, category, sections) "
        "VALUES (:n, :d, :c, CAST(:s AS jsonb)) RETURNING report_id"
    ), {"n": payload.name, "d": payload.description, "c": payload.category,
        "s": json.dumps([s.model_dump(mode="json") for s in payload.sections])}).scalar()
    db.commit()
    return {"report_id": rid}


@router.get("/reports/{report_id}")
def get_report(report_id: int, db: Session = Depends(get_db)):
    _ensure_reports_table(db)
    return _report_row(db, report_id)


@router.put("/reports/{report_id}")
def update_report(report_id: int, payload: ReportIn, db: Session = Depends(get_db)):
    _ensure_reports_table(db)
    _report_row(db, report_id)
    _validate_sections(payload)
    db.execute(text(
        "UPDATE rs_reports SET name=:n, description=:d, category=:c, "
        "sections=CAST(:s AS jsonb), updated_at=now() WHERE report_id=:r"
    ), {"n": payload.name, "d": payload.description, "c": payload.category,
        "s": json.dumps([s.model_dump(mode="json") for s in payload.sections]),
        "r": report_id})
    db.commit()
    return {"ok": True}


@router.delete("/reports/{report_id}")
def delete_report(report_id: int, db: Session = Depends(get_db)):
    _ensure_reports_table(db)
    _report_row(db, report_id)
    db.execute(text("DELETE FROM rs_reports WHERE report_id = :r"), {"r": report_id})
    db.commit()
    return {"ok": True}


def _run_report(db: Session, report: dict) -> dict[str, Any]:
    sections_out = []
    for s in report["sections"]:
        q = RS.QueryIn(**s["spec"])
        res = _run_query(db, q)
        sections_out.append({
            "title": s.get("title") or "Section",
            "note": s.get("note"),
            "columns": res["columns"],
            "rows": res["rows"],
        })
    return {
        "report_id": report["report_id"], "name": report["name"],
        "description": report.get("description"), "category": report.get("category"),
        "sections": sections_out,
    }


@router.post("/reports/{report_id}/run")
def run_report(report_id: int, db: Session = Depends(get_db)):
    _ensure_reports_table(db)
    return _run_report(db, _report_row(db, report_id))


# ---------------------------------------------------------------- export

def _fmt_cell(v: Any) -> Any:
    if isinstance(v, float):
        return round(v, 2)
    return v


@router.get("/reports/{report_id}/export")
def export_report(report_id: int, fmt: str = "xlsx", db: Session = Depends(get_db)):
    import io

    from fastapi.responses import StreamingResponse

    _ensure_reports_table(db)
    data = _run_report(db, _report_row(db, report_id))
    stem = "".join(c if c.isalnum() or c in " -_" else "_" for c in data["name"]).strip()[:80] or "report"

    if fmt == "xlsx":
        from openpyxl import Workbook
        from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

        wb = Workbook()
        wb.remove(wb.active)
        thin = Side(style="thin", color="999999")
        border = Border(left=thin, right=thin, top=thin, bottom=thin)
        head_fill = PatternFill("solid", fgColor="0B3D91")
        head_font = Font(bold=True, color="FFFFFF", size=10)
        title_font = Font(bold=True, size=13, color="0B3D91")
        used_names: set[str] = set()
        for i, sec in enumerate(data["sections"], 1):
            base = "".join(c for c in sec["title"] if c not in "[]:*?/\\")[:28] or f"Section {i}"
            name = base
            n = 1
            while name in used_names:
                n += 1
                name = f"{base[:25]} {n}"
            used_names.add(name)
            ws = wb.create_sheet(title=name)
            cols = sec["columns"]
            ws.cell(row=1, column=1, value=sec["title"]).font = title_font
            if sec.get("note"):
                ws.cell(row=2, column=1, value=sec["note"]).font = Font(italic=True, size=9, color="666666")
            hr = 3
            for ci, c in enumerate(cols, 1):
                cell = ws.cell(row=hr, column=ci, value=c["label"])
                cell.font = head_font
                cell.fill = head_fill
                cell.border = border
                cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
                ws.column_dimensions[cell.column_letter].width = max(11, min(38, len(c["label"]) + 4))
            for ri, r in enumerate(sec["rows"], hr + 1):
                is_total = bool(r.get("__total__"))
                for ci, c in enumerate(cols, 1):
                    cell = ws.cell(row=ri, column=ci, value=_fmt_cell(r.get(c["key"])))
                    cell.border = border
                    if c["type"] in ("int", "number", "money"):
                        cell.number_format = "#,##0.00" if c["type"] != "int" else "#,##0"
                    if is_total:
                        cell.font = Font(bold=True)
                        cell.fill = PatternFill("solid", fgColor="E8EEF9")
            ws.freeze_panes = ws.cell(row=hr + 1, column=2)
        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)
        return StreamingResponse(
            buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{stem}.xlsx"'})

    if fmt == "docx":
        from docx import Document
        from docx.enum.section import WD_ORIENT
        from docx.enum.text import WD_ALIGN_PARAGRAPH
        from docx.shared import Pt

        doc = Document()
        sec0 = doc.sections[0]
        sec0.orientation = WD_ORIENT.LANDSCAPE
        sec0.page_width, sec0.page_height = sec0.page_height, sec0.page_width
        h = doc.add_heading(data["name"], level=0)
        h.alignment = WD_ALIGN_PARAGRAPH.CENTER
        if data.get("description"):
            p = doc.add_paragraph(data["description"])
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        for sec in data["sections"]:
            doc.add_heading(sec["title"], level=2)
            if sec.get("note"):
                doc.add_paragraph(sec["note"]).runs[0].font.size = Pt(8)
            cols = sec["columns"]
            table = doc.add_table(rows=1, cols=len(cols))
            table.style = "Table Grid"
            hdr = table.rows[0].cells
            for ci, c in enumerate(cols):
                hdr[ci].text = c["label"]
                for run in hdr[ci].paragraphs[0].runs:
                    run.font.bold = True
                    run.font.size = Pt(8)
            for r in sec["rows"]:
                cells = table.add_row().cells
                for ci, c in enumerate(cols):
                    v = _fmt_cell(r.get(c["key"]))
                    cells[ci].text = "" if v is None else (f"{v:,.2f}" if isinstance(v, float) else str(v))
                    for run in cells[ci].paragraphs[0].runs:
                        run.font.size = Pt(8)
                        if r.get("__total__"):
                            run.font.bold = True
        buf = io.BytesIO()
        doc.save(buf)
        buf.seek(0)
        return StreamingResponse(
            buf, media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={"Content-Disposition": f'attachment; filename="{stem}.docx"'})

    raise HTTPException(status_code=400, detail="fmt must be xlsx or docx")


# ---------------------------------------------------------------- seed: CAPEX pack

CAPEX_PACK = "capex-pack"


def _capex_pack_defs() -> list[dict]:
    from datetime import date
    today = date.today()
    fy_year = today.year if today.month >= 4 else today.year - 1
    fy_label = f"{fy_year}-{str(fy_year + 1)[2:]}"
    money = ["gross", "exp_last_fy", "be_fy", "actual_fy", "total_exp"]

    def ms(fields):
        return [{"field": f} for f in fields]

    r1 = {
        "name": f"Physical & Financial Progress of CAPEX Projects — FY {fy_label}",
        "description": "MoS format: quarterly CAPEX overview, category summary, "
                       "project-wise ongoing detail and new projects under consideration. "
                       "All figures in Rs Cr.",
        "category": CAPEX_PACK,
        "sections": [
            {"title": "Overview of CAPEX Progress — BE vs Actual by Month",
             "note": "All figures in Rs. crs. Quarter totals and annual total computed live.",
             "spec": {"dataset": "capex_monthly", "dimensions": ["month_label"],
                      "measures": ms(["be", "actual"]),
                      "pivot": {"on": "month_label", "row_total": True, "quarter_totals": True},
                      "limit": 5000}},
            {"title": "Overview of CAPEX Projects by Category",
             "spec": {"dataset": "pf_projects", "dimensions": ["mos_category"],
                      "measures": ms(["project_count"] + money),
                      "sort": [{"by": "mos_category", "dir": "asc"}],
                      "grand_total": True, "limit": 100}},
            {"title": "Ongoing Projects >= Rs 50 Cr — Physical & Financial Progress",
             "note": "Physical %: i. till last FY / ii. FY plan / iii. FY actual (weighted).",
             "spec": {"dataset": "pf_projects",
                      "dimensions": ["scheme_name", "approval_date", "award_date",
                                     "original_completion", "anticipated_completion", "reason"],
                      "measures": ms(["gross", "phys_last_fy", "phys_fy_plan", "phys_fy_actual",
                                      "exp_last_fy", "be_fy", "actual_fy", "total_exp"]),
                      "filters": {"op": "AND", "conditions": [
                          {"field": "status", "op": "in", "value": ["ongoing", "on_hold"]},
                          {"field": "cost_band", "op": "starts_with", "value": "A"}]},
                      "sort": [{"by": "gross", "dir": "desc"}], "limit": 200}},
            {"title": "Projects < Rs 50 Cr (grouped)",
             "spec": {"dataset": "pf_projects", "dimensions": ["cost_band"],
                      "measures": ms(["project_count"] + money),
                      "filters": {"op": "AND", "conditions": [
                          {"field": "status", "op": "in", "value": ["ongoing", "on_hold"]},
                          {"field": "cost_band", "op": "starts_with", "value": "B"}]},
                      "limit": 10}},
            {"title": "New CAPEX Projects Under Consideration",
             "spec": {"dataset": "pf_projects",
                      "dimensions": ["mos_category", "scheme_name", "approval_date", "award_date"],
                      "measures": ms(["gross", "be_fy", "actual_fy"]),
                      "filters": {"op": "AND", "conditions": [
                          {"field": "mos_category", "op": "starts_with", "value": "3"}]},
                      "sort": [{"by": "mos_category", "dir": "asc"}],
                      "grand_total": True, "limit": 200}},
        ],
    }

    r2 = {
        "name": f"CAPEX Monitoring — Month-wise (FY {fy_label})",
        "description": "Scheme/head rows with BE, RE and Actual spread across the 12 FY months "
                       "plus row totals — the month-wise monitoring format.",
        "category": CAPEX_PACK,
        "sections": [
            {"title": "CAPEX Month-wise — BE / RE / Actual by Row",
             "note": "Rs in crore. Columns: month x (BE, RE, Actual); Total = full-year sum.",
             "spec": {"dataset": "capex_monthly", "dimensions": ["row_name", "month_label"],
                      "measures": ms(["be", "re", "actual"]),
                      "pivot": {"on": "month_label", "row_total": True},
                      "grand_total": True, "limit": 5000}},
            {"title": "Physical Progress Month-wise (Weighted %)",
             "note": "Weighted plan vs actual % per scheme per month, current plans.",
             "spec": {"dataset": "physical_monthly", "dimensions": ["scheme_name", "month_label"],
                      "measures": ms(["plan_pct_w", "actual_pct_w"]),
                      "filters": {"op": "AND", "conditions": [
                          {"field": "fy", "op": "=", "value": fy_year}]},
                      "pivot": {"on": "month_label", "row_total": True}, "limit": 5000}},
        ],
    }

    r3 = {
        "name": f"CAPEX Status of Projects — Sanctioned & New (MoS Backup, FY {fy_label})",
        "description": "MoS presentation backup: per-category and per-scheme sanctioned cost, "
                       "expenditure till last FY, BE/RE, FY expenditure and balance for completion.",
        "category": CAPEX_PACK,
        "sections": [
            {"title": "CAPEX Status by Category & Scheme",
             "note": "balance_for_completion = Total cost - Cumulative expenditure.",
             "spec": {"dataset": "pf_projects", "dimensions": ["mos_category", "scheme_name"],
                      "measures": ms(["gross", "exp_last_fy", "be_fy", "re_fy", "actual_fy", "total_exp"]),
                      "computed": [{"alias": "balance_for_completion",
                                    "expression": "gross - exp_last_fy - actual_fy"}],
                      "sort": [{"by": "mos_category", "dir": "asc"}],
                      "grand_total": True, "limit": 500}},
            {"title": "Quarterly Expenditure — BE / RE / Actual",
             "spec": {"dataset": "capex_monthly", "dimensions": ["quarter"],
                      "measures": ms(["be", "re", "actual"]),
                      "pivot": {"on": "quarter", "row_total": True}, "limit": 100}},
            {"title": "Delay Profile of Ongoing Projects",
             "spec": {"dataset": "pf_projects", "dimensions": ["delay_bucket"],
                      "measures": ms(["project_count", "gross", "total_exp"]),
                      "filters": {"op": "AND", "conditions": [
                          {"field": "status", "op": "in", "value": ["ongoing", "on_hold"]}]},
                      "sort": [{"by": "delay_bucket", "dir": "asc"}],
                      "grand_total": True, "limit": 10}},
        ],
    }
    return [r1, r2, r3]


@router.post("/reports/seed-capex-pack")
def seed_capex_pack(db: Session = Depends(get_db)):
    """(Re)create the 3 standard CAPEX physical-financial reports. Idempotent."""
    _ensure_reports_table(db)
    created = []
    for d in _capex_pack_defs():
        payload = ReportIn(**d)
        _validate_sections(payload)
        existing = db.execute(text(
            "SELECT report_id FROM rs_reports WHERE name = :n AND category = :c"),
            {"n": d["name"], "c": CAPEX_PACK}).scalar()
        sections_json = json.dumps([s.model_dump(mode="json") for s in payload.sections])
        if existing:
            db.execute(text(
                "UPDATE rs_reports SET description=:d, sections=CAST(:s AS jsonb), "
                "updated_at=now() WHERE report_id=:r"),
                {"d": d["description"], "s": sections_json, "r": existing})
            created.append({"report_id": existing, "name": d["name"], "updated": True})
        else:
            rid = db.execute(text(
                "INSERT INTO rs_reports (name, description, category, sections) "
                "VALUES (:n, :d, :c, CAST(:s AS jsonb)) RETURNING report_id"),
                {"n": d["name"], "d": d["description"], "c": CAPEX_PACK,
                 "s": sections_json}).scalar()
            created.append({"report_id": rid, "name": d["name"], "updated": False})
    db.commit()
    return {"reports": created}


# ================================================================ dashboards
# Power BI-style dashboard canvas: pages of visuals + slicers, persisted as
# query specs (never raw SQL, never frozen numbers). Rendered client-side via
# POST /query/batch so a whole page refreshes in a single round trip.

class DashLayout(BaseModel):
    x: int = 0
    y: int = 0
    w: int = 6
    h: int = 5


class DashVisual(BaseModel):
    id: str
    title: str = ""
    dataset: str
    viz: str = "bar"                 # table|bar|stackedbar|line|area|pie|donut|kpi
    spec: RS.QueryIn
    layout: DashLayout = DashLayout()
    options: dict[str, Any] = {}


class DashSlicer(BaseModel):
    id: str
    dataset: str
    field: str
    label: str = ""
    type: str = "list"               # list | daterange


class DashPage(BaseModel):
    id: str
    title: str = "Page"
    slicers: list[DashSlicer] = []
    visuals: list[DashVisual] = []


class DashboardIn(BaseModel):
    name: str
    description: Optional[str] = None
    pages: list[DashPage] = []
    is_pinned: bool = False


def _ensure_dashboards_table(db: Session) -> None:
    db.execute(text(
        "CREATE TABLE IF NOT EXISTS rs_dashboards ("
        " dashboard_id SERIAL PRIMARY KEY,"
        " name TEXT NOT NULL,"
        " description TEXT,"
        " pages JSONB NOT NULL DEFAULT '[]'::jsonb,"
        " is_pinned BOOLEAN NOT NULL DEFAULT FALSE,"
        " created_by INTEGER,"
        " created_at TIMESTAMPTZ NOT NULL DEFAULT now(),"
        " updated_at TIMESTAMPTZ NOT NULL DEFAULT now())"
    ))
    db.commit()


def _validate_dashboard(payload: DashboardIn) -> None:
    """Every visual spec must compile; every slicer field must exist."""
    for pg in payload.pages:
        for v in pg.visuals:
            if v.spec.dataset != v.dataset:
                raise HTTPException(400, f"Visual '{v.title or v.id}': spec dataset mismatch")
            try:
                RS.compile_query(v.spec)
            except RS.CompileError as e:
                raise HTTPException(400, f"Visual '{v.title or v.id}': {e}")
        for s in pg.slicers:
            try:
                RS.compile_field_values(s.dataset, s.field, None, 1)
            except RS.CompileError as e:
                raise HTTPException(400, f"Slicer '{s.label or s.field}': {e}")


def _dashboard_row(db: Session, dashboard_id: int) -> dict:
    row = db.execute(text(
        "SELECT * FROM rs_dashboards WHERE dashboard_id = :d"), {"d": dashboard_id}
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Dashboard not found")
    out = dict(row)
    if isinstance(out.get("pages"), str):
        out["pages"] = json.loads(out["pages"])
    return out


@router.get("/dashboards")
def list_dashboards(db: Session = Depends(get_db)):
    _ensure_dashboards_table(db)
    rows = db.execute(text(
        "SELECT dashboard_id, name, description, is_pinned, "
        "       jsonb_array_length(pages) AS page_count, updated_at "
        "FROM rs_dashboards ORDER BY is_pinned DESC, updated_at DESC"
    )).mappings().all()
    return {"dashboards": [dict(r) for r in rows]}


@router.post("/dashboards")
def create_dashboard(payload: DashboardIn, db: Session = Depends(get_db)):
    _ensure_dashboards_table(db)
    _validate_dashboard(payload)
    did = db.execute(text(
        "INSERT INTO rs_dashboards (name, description, pages, is_pinned) "
        "VALUES (:n, :d, CAST(:p AS jsonb), :pin) RETURNING dashboard_id"
    ), {"n": payload.name, "d": payload.description, "pin": payload.is_pinned,
        "p": json.dumps([p.model_dump(mode="json") for p in payload.pages])}).scalar()
    db.commit()
    return {"dashboard_id": did}


@router.get("/dashboards/{dashboard_id}")
def get_dashboard(dashboard_id: int, db: Session = Depends(get_db)):
    _ensure_dashboards_table(db)
    return _dashboard_row(db, dashboard_id)


@router.put("/dashboards/{dashboard_id}")
def update_dashboard(dashboard_id: int, payload: DashboardIn, db: Session = Depends(get_db)):
    _ensure_dashboards_table(db)
    _dashboard_row(db, dashboard_id)
    _validate_dashboard(payload)
    db.execute(text(
        "UPDATE rs_dashboards SET name=:n, description=:d, is_pinned=:pin, "
        "pages=CAST(:p AS jsonb), updated_at=now() WHERE dashboard_id=:r"
    ), {"n": payload.name, "d": payload.description, "pin": payload.is_pinned,
        "p": json.dumps([p.model_dump(mode="json") for p in payload.pages]),
        "r": dashboard_id})
    db.commit()
    return {"ok": True}


@router.delete("/dashboards/{dashboard_id}")
def delete_dashboard(dashboard_id: int, db: Session = Depends(get_db)):
    _ensure_dashboards_table(db)
    _dashboard_row(db, dashboard_id)
    db.execute(text("DELETE FROM rs_dashboards WHERE dashboard_id = :d"), {"d": dashboard_id})
    db.commit()
    return {"ok": True}


@router.post("/dashboards/{dashboard_id}/duplicate")
def duplicate_dashboard(dashboard_id: int, db: Session = Depends(get_db)):
    _ensure_dashboards_table(db)
    src = _dashboard_row(db, dashboard_id)
    did = db.execute(text(
        "INSERT INTO rs_dashboards (name, description, pages) "
        "VALUES (:n, :d, CAST(:p AS jsonb)) RETURNING dashboard_id"
    ), {"n": f"{src['name']} (copy)", "d": src.get("description"),
        "p": json.dumps(src["pages"])}).scalar()
    db.commit()
    return {"dashboard_id": did}


# ---------------------------------------------------------------- batch query

class BatchQueryIn(BaseModel):
    queries: list[RS.QueryIn]


@router.post("/query/batch")
def run_query_batch(payload: BatchQueryIn, db: Session = Depends(get_db)):
    """Run up to 24 structured queries in one call — powers dashboard page
    rendering (all visuals refresh in a single round trip). Per-query errors
    are returned inline so one bad visual never blanks the whole page."""
    if len(payload.queries) > 24:
        raise HTTPException(400, "Batch limited to 24 queries")
    results: list[dict[str, Any]] = []
    for q in payload.queries:
        try:
            results.append({"ok": True, **_run_query(db, q)})
        except HTTPException as e:
            results.append({"ok": False, "error": str(e.detail),
                            "columns": [], "rows": [], "row_count": 0})
    return {"results": results}
