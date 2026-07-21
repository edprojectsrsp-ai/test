"""DPR file-ingestion API — upload a contractor's daily-report Excel, parse it
(three real format families auto-detected), auto-match rows to the scheme's
plan activities with confidence scores, preview, then commit as daily_actuals
+ manpower.

  POST /dpr-ingest/parse    multipart: file + scheme_id [+ package_id, report_date]
        → parsed rows, match candidates, suggested day-quantities
  POST /dpr-ingest/commit   JSON: confirmed entries + manpower
        → upserts daily_actuals (activity_id, actual_date) and the day's
          daily_progress_manpower rows
"""

from __future__ import annotations

import re
from datetime import date, datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.services import dpr_ingest as DI
from app.services import dpr_teach as DT
from app.services import manpower as mp

router = APIRouter(prefix="/dpr-ingest", tags=["DPR Ingest"])


def _parse_day(value) -> date:
    if not value:
        return date.today()
    try:
        return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Bad date: {value}")


def _date_from_filename(name: str):
    """Report dates live in the filenames: 01-07-2026 / 01.07.26 / 01_07_2026."""
    m = re.search(r"(\d{1,2})[-._](\d{1,2})[-._](\d{2,4})", name or "")
    if not m:
        return None
    d, mth, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if y < 100:
        y += 2000
    try:
        return date(y, mth, d)
    except ValueError:
        return None


def _db_cumulative(db, activity_ids):
    """actuals_till_last_fy + sum(daily_actuals) per activity — used to derive a
    suggested day quantity when a file only carries cumulative figures."""
    if not activity_ids:
        return {}
    rows = db.execute(text("""
        SELECT pa.activity_id,
               COALESCE(pa.actuals_till_last_fy, 0)
             + COALESCE((SELECT SUM(da.actual_qty) FROM daily_actuals da
                         WHERE da.activity_id = pa.activity_id), 0) AS cum
        FROM plan_activities pa WHERE pa.activity_id = ANY(:ids)
    """), {"ids": list(activity_ids)}).mappings().all()
    return {int(r["activity_id"]): float(r["cum"] or 0) for r in rows}


@router.post("/parse")
async def parse_file(
    file: UploadFile = File(...),
    scheme_id: int = Form(...),
    package_id: Optional[int] = Form(None),
    report_date: Optional[str] = Form(None),
    db: Session = Depends(get_db),
):
    name = file.filename or "upload.xlsx"
    if not name.lower().endswith((".xlsx", ".xlsm", ".xls")):
        raise HTTPException(status_code=400,
                            detail="Only Excel DPR files are supported for parsing "
                                   "(PDF DPRs: upload to Document Vault instead).")
    content = await file.read()
    try:
        parsed = DI.parse_dpr_file(content)
    except Exception as error:
        raise HTTPException(status_code=422, detail=f"Could not parse workbook: {error}")

    # rows to match: the group rows; if a format only has detail rows
    # (site_progress), aggregate details per work type into synthetic groups
    groups = [a for a in parsed["activities"] if a["kind"] == "group"]
    if not groups:
        by_wt = {}
        for a in parsed["activities"]:
            g = by_wt.setdefault(a["workType"] or "Work", {
                "workType": a["workType"], "activity": a["workType"] or "Work",
                "area": "", "kind": "group", "scope": 0.0, "uom": a["uom"],
                "actualTillLastFy": None, "cumPlanLastMonth": None,
                "cumActualLastMonth": 0.0, "ftmPlan": 0.0, "dayPlan": 0.0,
                "dayActual": 0.0, "cumPlanToDate": None, "cumActualToDate": 0.0,
                "remarks": "", "detailCount": 0,
            })
            for key in ("scope", "cumActualLastMonth", "ftmPlan", "dayPlan", "dayActual", "cumActualToDate"):
                if a.get(key) is not None:
                    g[key] = (g[key] or 0.0) + a[key]
            g["detailCount"] += 1
        groups = list(by_wt.values())

    matches = DI.match_activities(db, scheme_id, groups, package_id)
    # DPR-2: force matches the user has taught for this scheme
    matches = DT.apply_activity_overrides(db, scheme_id, groups, matches)
    # DPR-2: apply learned column overrides (per-scheme over template-global)
    col_overrides = DT.load_column_map(db, parsed["format"], scheme_id)
    if col_overrides:
        DT.apply_column_overrides(groups, col_overrides)
    cum = _db_cumulative(db, [m["matchedActivityId"] for m in matches if m["matchedActivityId"]])

    rows = []
    for g, m in zip(groups, matches):
        aid = m["matchedActivityId"]
        day_qty = g.get("dayActual")
        suggested = day_qty
        basis = "day_actual"
        if (suggested is None or suggested == 0) and g.get("cumActualToDate") and aid:
            delta = float(g["cumActualToDate"]) - cum.get(aid, 0.0)
            if delta > 0:
                suggested, basis = round(delta, 3), "cumulative_delta"
        rows.append({
            **g,
            "matchedActivityId": aid,
            "confidence": m["confidence"],
            "candidates": m["candidates"],
            "suggestedQty": suggested if suggested and suggested > 0 else (day_qty or 0),
            "qtyBasis": basis,
            "srcRow": g.get("_srcRow"),
            "provenance": DT.provenance(g),
            "qtyCell": (DT.provenance(g) or {}).get("dayActual")
                       if basis == "day_actual" else (DT.provenance(g) or {}).get("cumActualToDate"),
            "learned": m.get("learned", False),
        })

    detected = _date_from_filename(name)
    return {
        "fileName": name,
        "format": parsed["format"],
        "schemeId": scheme_id,
        "projectName": parsed["projectName"],
        "reportDate": (report_date or parsed.get("reportDate")
                       or (detected.isoformat() if detected else date.today().isoformat())),
        "rows": rows,
        "manpower": parsed["manpower"],
        "equipment": parsed["equipment"],
        "detailRows": [a for a in parsed["activities"] if a["kind"] == "detail"][:200],
    }


# ─────────────────────────── commit ─────────────────────────────────────────

class EntryIn(BaseModel):
    activity_id: int
    qty: float
    area_of_work: Optional[str] = ""
    remarks: Optional[str] = ""


class ManpowerIn(BaseModel):
    category: str
    trade: Optional[str] = ""
    ftd: float = 0


class CommitIn(BaseModel):
    scheme_id: int
    report_date: str
    source_file: Optional[str] = ""
    entries: List[EntryIn]
    manpower: List[ManpowerIn] = []


def _manpower_ui_rows(parsed_manpower, agency_name):
    """Map parsed contractor manpower categories onto the friend-style matrix
    rows (Executing Agency staff vs sub-contractor Supervisor/Labour)."""
    rows = []
    next_id = 1
    for m in parsed_manpower:
        label = f"{m.category} {m.trade or ''}".strip()
        low = label.lower()
        if "sub" in low and ("supervisor" in low or "engineer" in low):
            category, contractor, trade = "Contractor", agency_name or "Sub-contractor", "Supervisor"
        elif "sub" in low or "skilled" in low or "unskilled" in low or "labour" in low or "workmen" in low:
            category, contractor, trade = "Contractor", agency_name or "Sub-contractor", "Labour"
        else:
            category, contractor, trade = "Executing Agency", agency_name, (m.category or "Staff")[:60]
        rows.append({
            "id": next_id, "category": category, "contractorName": contractor,
            "trade": trade, "lastMonth": 0, "today": float(m.ftd or 0),
            "remarks": f"Imported: {label}"[:200],
        })
        next_id += 1
    return rows


@router.post("/commit")
def commit(payload: CommitIn, db: Session = Depends(get_db)):
    report_date = _parse_day(payload.report_date)
    saved = 0
    for e in payload.entries:
        if e.qty is None or e.qty <= 0:
            continue
        exists = db.execute(text(
            "SELECT 1 FROM plan_activities WHERE activity_id = :aid AND NOT is_deleted"),
            {"aid": e.activity_id}).first()
        if not exists:
            continue
        db.execute(text("""
            INSERT INTO daily_actuals
                (activity_id, actual_date, actual_qty, area_of_work, remarks,
                 entered_by, entered_via)
            VALUES (:aid, CAST(:d AS date), :qty, :area, :remarks, 1, 'dpr')
            ON CONFLICT (activity_id, actual_date) DO UPDATE SET
                actual_qty  = EXCLUDED.actual_qty,
                area_of_work = COALESCE(NULLIF(EXCLUDED.area_of_work, ''), daily_actuals.area_of_work),
                remarks     = COALESCE(NULLIF(EXCLUDED.remarks, ''), daily_actuals.remarks),
                updated_at  = CURRENT_TIMESTAMP
        """), {"aid": e.activity_id, "d": report_date, "qty": e.qty,
               "area": (e.area_of_work or "")[:500],
               "remarks": (f"{e.remarks or ''} [import: {payload.source_file}]").strip()[:500]})
        saved += 1

    manpower_saved = 0
    if payload.manpower:
        agency = mp.scheme_agency_name(db, payload.scheme_id)
        ui_rows = _manpower_ui_rows(payload.manpower, agency)
        if ui_rows:
            mp.save_manpower_rows(db, payload.scheme_id, report_date, ui_rows)
            manpower_saved = len(ui_rows)

    db.commit()
    return {"ok": True, "reportDate": report_date.isoformat(),
            "actualsSaved": saved, "manpowerSaved": manpower_saved}


# ─────────────────────────── DPR-2 teach endpoints ──────────────────────────

class TeachColumnIn(BaseModel):
    dpr_format: str
    field: str
    col_index: int
    scheme_id: Optional[int] = None   # None = template-global default
    updated_by: Optional[str] = None


class TeachActivityIn(BaseModel):
    scheme_id: int
    row_label: str
    activity_id: int
    updated_by: Optional[str] = None


@router.post("/teach/column")
def teach_column(payload: TeachColumnIn, db: Session = Depends(get_db)):
    """Correct which source column a field is read from. Saved per format
    (global) or per scheme (override). Reused on every future parse."""
    DT.save_column_map(db, payload.dpr_format, payload.scheme_id,
                       payload.field, payload.col_index, payload.updated_by)
    return {"ok": True, "cell_column": DT._col_letter(payload.col_index),
            "scope": "scheme" if payload.scheme_id else "template"}


@router.post("/teach/activity")
def teach_activity(payload: TeachActivityIn, db: Session = Depends(get_db)):
    """Correct which activity a DPR row maps to (per scheme). Reused next upload."""
    DT.save_activity_map(db, payload.scheme_id, payload.row_label,
                         payload.activity_id, payload.updated_by)
    return {"ok": True}


@router.get("/teach/maps/{scheme_id}")
def teach_maps(scheme_id: int, dpr_format: Optional[str] = None,
               db: Session = Depends(get_db)):
    """What has been taught for this scheme (+ optional format)."""
    acts = DT.load_activity_map(db, scheme_id)
    cols = DT.load_column_map(db, dpr_format, scheme_id) if dpr_format else {}
    return {"activity_maps": acts,
            "column_overrides": {f: {"col_index": ci, "cell_column": DT._col_letter(ci)}
                                 for f, ci in cols.items()}}
