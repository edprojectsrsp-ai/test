from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.progress import (
    CorporateActualDaily,
    CorporatePlanActivity,
    CorporatePlanHeader,
    CorporatePlanMonthly,
)

router = APIRouter()


def _month_label(month_date):
    return month_date.strftime("%b-%y") if month_date else ""


@router.get("/s-curve/{scheme_id}")
def get_s_curve(scheme_id: int, db: Session = Depends(get_db)):
    planned_rows = (
        db.query(
            CorporatePlanMonthly.plan_month.label("month_date"),
            func.sum(CorporatePlanMonthly.planned_qty).label("val"),
        )
        .join(
            CorporatePlanActivity,
            CorporatePlanActivity.plan_activity_id == CorporatePlanMonthly.plan_activity_id,
        )
        .join(
            CorporatePlanHeader,
            CorporatePlanHeader.plan_id == CorporatePlanActivity.plan_id,
        )
        .filter(CorporatePlanHeader.scheme_id == scheme_id)
        .group_by(CorporatePlanMonthly.plan_month)
        .all()
    )

    actual_rows = (
        db.query(
            CorporateActualDaily.entry_date.label("month_date"),
            func.sum(CorporateActualDaily.actual_qty).label("val"),
        )
        .filter(CorporateActualDaily.scheme_id == scheme_id)
        .group_by(CorporateActualDaily.entry_date)
        .all()
    )

    month_data = {}
    for month_date, value in planned_rows:
        month_data.setdefault(month_date, {"month_label": _month_label(month_date), "planned": 0, "actual": 0})
        month_data[month_date]["planned"] = float(value or 0)

    for month_date, value in actual_rows:
        month_data.setdefault(month_date, {"month_label": _month_label(month_date), "planned": 0, "actual": 0})
        month_data[month_date]["actual"] = float(value or 0)

    return [month_data[key] for key in sorted(month_data)]


# ============================================================================
# EDITABLE REPORT DOCUMENTS (Package-N status report, etc.)
# Stores the document HTML in record_notes (note_type='report_doc'), keyed by a
# slug in extra_fields->>'doc_key'. No schema change needed.
# ============================================================================
from fastapi import Body
from sqlalchemy import text as _sql_text


@router.get("/doc/{doc_key}")
def get_report_doc(doc_key: str, db: Session = Depends(get_db)):
    row = db.execute(_sql_text("""
        SELECT body, updated_at
        FROM record_notes
        WHERE note_type = 'report_doc'
          AND extra_fields->>'doc_key' = :k
          AND is_deleted = FALSE
        ORDER BY updated_at DESC NULLS LAST, note_id DESC
        LIMIT 1
    """), {"k": doc_key}).first()
    if not row:
        # 404 → frontend falls back to the bundled default content
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="No saved version")
    return {"html": row.body, "updated_at": row.updated_at.isoformat() if row.updated_at else None}


@router.put("/doc/{doc_key}")
def save_report_doc(doc_key: str, payload: dict = Body(...), db: Session = Depends(get_db)):
    html = payload.get("html", "")
    if not html.strip():
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="Empty document")
    # upsert: update existing or insert new. scheme_id is required NOT NULL in
    # record_notes — use 74 (COB-7) as the owning scheme for portfolio reports,
    # or accept an optional scheme_id in the payload.
    scheme_id = int(payload.get("scheme_id", 74))
    existing = db.execute(_sql_text("""
        SELECT note_id FROM record_notes
        WHERE note_type='report_doc' AND extra_fields->>'doc_key' = :k AND is_deleted=FALSE
        LIMIT 1
    """), {"k": doc_key}).first()

    if existing:
        db.execute(_sql_text("""
            UPDATE record_notes
            SET body = :b, updated_at = CURRENT_TIMESTAMP
            WHERE note_id = :id
        """), {"b": html, "id": existing.note_id})
        note_id = existing.note_id
    else:
        note_id = db.execute(_sql_text("""
            INSERT INTO record_notes (scheme_id, note_type, title, body, extra_fields, is_deleted, created_by, created_at, updated_at)
            VALUES (:sid, 'report_doc', :title, :b, jsonb_build_object('doc_key', :k), FALSE, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            RETURNING note_id
        """), {"sid": scheme_id, "title": f"Report: {doc_key}", "b": html, "k": doc_key}).scalar()
    db.commit()
    from datetime import datetime
    return {"ok": True, "note_id": note_id, "updated_at": datetime.utcnow().isoformat()}
