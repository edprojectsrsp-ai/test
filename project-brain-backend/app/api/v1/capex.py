"""CAPEX router — Sprint 15.5 (Half A).

Endpoints (all under /api/v1/capex once mounted via /api/v1):
    GET    /capex/ping                                 cheap connectivity check
    GET    /capex/plans?plan_type=BE&fy_year=2026-27   filter the plan list
    GET    /capex/plans/{plan_id}                      load one plan in UI shape
    POST   /capex/plans                                create new plan
    PUT    /capex/plans/{plan_id}                      replace plan contents (Draft only)
    POST   /capex/plans/{plan_id}/approve              flip to Approved
    POST   /capex/plans/{plan_id}/unlock               admin-only
    DELETE /capex/plans/{plan_id}                      admin-only

NEW in Sprint 15.5:
    GET    /capex/actuals?fy_year=2026-27[&scheme_id=N]
                                                       grid of per-row, per-month actuals
    PUT    /capex/actuals/cell                         upsert one cell (refuses if month locked)
    GET    /capex/locks?fy_year=2026-27                list locked months
    POST   /capex/locks                                admin: lock a month
    DELETE /capex/locks/{fy_year}/{month_no}           admin: unlock a month

Deprecated:
    POST   /capex/plan/save_hierarchy                  HTTP 410, see Sprint 15.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import desc, func
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.capex import (
    ActualsMonthLock,
    CapexActual,
    CapexMonthValue,
    CapexPlanHeader,
    CapexPlanRow,
    CapexPlanValue,
)
from app.security.auth import optional_user, require_role

router = APIRouter(prefix="/capex", tags=["CAPEX"])


# ---------------------------------------------------------------------------
# Payload schemas
# ---------------------------------------------------------------------------
class MonthValueIn(BaseModel):
    be: float = 0.0
    re: float = 0.0
    actual: float = 0.0   # accepted but ignored from PUT plans — actuals are separate


class RowIn(BaseModel):
    id: Optional[str] = None
    name: str
    level: str
    indent: int = 0
    gross: float = 0.0
    cumLast: float = 0.0
    beFY: float = 0.0
    reFY: float = 0.0
    actualFY: float = 0.0
    scheme_id: Optional[int] = None
    months: dict[str, MonthValueIn] = Field(default_factory=dict)


class PlanBodyIn(BaseModel):
    fy: str
    planType: str = "BE"
    planVersion: Optional[str] = "v1"
    status: Optional[str] = "Draft"
    effMonth: Optional[int] = None
    rows: list[RowIn] = Field(default_factory=list)


class ActualCellIn(BaseModel):
    plan_row_id: int
    month_no: int                # 1..12
    amount: float
    fy_year: str


class MonthLockIn(BaseModel):
    fy_year: str
    month_no: int
    note: Optional[str] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _serialize_header(header: CapexPlanHeader, row_count: int) -> dict:
    return {
        "id": header.id,
        "fy_year": header.fy_year,
        "plan_type": header.plan_type,
        "plan_version": header.plan_version,
        "plan_status": header.plan_status,
        "is_effective": bool(header.is_effective),
        "effective_from_month": header.effective_from_month,
        "created_by": header.created_by,
        "created_at": header.created_at.isoformat() if header.created_at else None,
        "row_count": row_count,
    }


def _serialize_plan_full(header: CapexPlanHeader, db: Session) -> dict:
    rows = (
        db.query(CapexPlanRow)
        .filter(CapexPlanRow.plan_id == header.id)
        .order_by(CapexPlanRow.display_order)
        .all()
    )
    serialized = []
    for r in rows:
        months = {}
        for mv in r.months:
            months[str(mv.month_no)] = {
                "be": float(mv.be_amount or 0),
                "re": float(mv.re_amount or 0),
                "actual": float(mv.actual_amount or 0),
            }
        v = r.values
        serialized.append({
            "id": f"sch_{r.scheme_id}" if r.scheme_id else f"row_{r.id}",
            "row_id": r.id,                   # client needs the real id for actuals
            "name": r.row_name,
            "level": r.row_level,
            "indent": r.indent_level,
            "scheme_id": r.scheme_id,
            "gross": float(v.gross_cost) if v else 0.0,
            "cumLast": float(v.cumulative_exp_till_last_fy) if v else 0.0,
            "beFY": float(v.be_fy) if v else 0.0,
            "reFY": float(v.re_fy) if v else 0.0,
            "actualFY": 0.0,
            "months": months,
            "isEditable": r.row_level == "Item",
        })
    return {
        "header": _serialize_header(header, len(rows)),
        "fy": header.fy_year,
        "planType": header.plan_type,
        "planVersion": header.plan_version,
        "status": header.plan_status,
        "effMonth": header.effective_from_month,
        "rows": serialized,
    }


def _replace_rows(plan_id: int, rows: list[RowIn], db: Session) -> None:
    row_ids = [r.id for r in db.query(CapexPlanRow.id).filter(CapexPlanRow.plan_id == plan_id).all()]
    if row_ids:
        db.query(CapexMonthValue).filter(CapexMonthValue.plan_row_id.in_(row_ids)).delete(synchronize_session=False)
        db.query(CapexPlanValue).filter(CapexPlanValue.plan_row_id.in_(row_ids)).delete(synchronize_session=False)
        # NOTE: we deliberately don't blow away CapexActual rows on plan PUT —
        # actuals belong to the row even when the plan structure is replaced.
        # If a row is removed from the plan, the cascade on row delete (below)
        # cleans up its actuals.
        db.query(CapexPlanRow).filter(CapexPlanRow.plan_id == plan_id).delete(synchronize_session=False)

    parent_by_indent: dict[int, int] = {}
    for display_order, row in enumerate(rows):
        parent_id = parent_by_indent.get(row.indent - 1) if row.indent > 0 else None
        db_row = CapexPlanRow(
            plan_id=plan_id,
            parent_row_id=parent_id,
            scheme_id=row.scheme_id,
            row_name=row.name,
            row_level=row.level,
            indent_level=row.indent,
            display_order=display_order,
            is_imported=int(bool(row.scheme_id)),
        )
        db.add(db_row)
        db.flush()
        parent_by_indent[row.indent] = db_row.id
        for stale in [k for k in parent_by_indent if k > row.indent]:
            parent_by_indent.pop(stale, None)

        if row.level == "Item":
            db.add(CapexPlanValue(
                plan_row_id=db_row.id,
                gross_cost=row.gross,
                cumulative_exp_till_last_fy=row.cumLast,
                be_fy=row.beFY,
                re_fy=row.reFY,
            ))
            for m_key, m_val in (row.months or {}).items():
                try:
                    m_no = int(m_key)
                except (TypeError, ValueError):
                    continue
                if m_val.be == 0 and m_val.re == 0 and m_val.actual == 0:
                    continue
                db.add(CapexMonthValue(
                    plan_row_id=db_row.id,
                    month_no=m_no,
                    be_amount=m_val.be,
                    re_amount=m_val.re,
                    actual_amount=m_val.actual,
                ))


def _username(user):
    if not user:
        return None
    return user.get("username") or str(user.get("user_id") or "")


# ---------------------------------------------------------------------------
# Diagnostic
# ---------------------------------------------------------------------------
@router.get("/ping")
def ping():
    """Cheap 'is the backend reachable' check. Useful when chasing 'fail to fetch'."""
    return {"ok": True, "service": "capex", "sprint": "15.5"}


# ---------------------------------------------------------------------------
# Plans
# ---------------------------------------------------------------------------
@router.get("/plans")
def list_plans(
    fy_year: Optional[str] = None,
    plan_type: Optional[str] = None,
    db: Session = Depends(get_db),
):
    q = db.query(CapexPlanHeader)
    if fy_year:
        q = q.filter(CapexPlanHeader.fy_year == fy_year)
    if plan_type:
        q = q.filter(CapexPlanHeader.plan_type == plan_type)
    plans = q.order_by(desc(CapexPlanHeader.created_at), desc(CapexPlanHeader.id)).all()
    if not plans:
        return []
    counts = dict(
        db.query(CapexPlanRow.plan_id, func.count(CapexPlanRow.id))
        .filter(CapexPlanRow.plan_id.in_([p.id for p in plans]))
        .group_by(CapexPlanRow.plan_id).all()
    )
    return [_serialize_header(p, counts.get(p.id, 0)) for p in plans]


@router.get("/plans/{plan_id}")
def get_plan(plan_id: int, db: Session = Depends(get_db)):
    h = db.query(CapexPlanHeader).filter(CapexPlanHeader.id == plan_id).first()
    if not h:
        raise HTTPException(404, "Plan not found")
    return _serialize_plan_full(h, db)


@router.post("/plans")
def create_plan(
    body: PlanBodyIn,
    db: Session = Depends(get_db),
    user=Depends(optional_user),
):
    plan_type = (body.planType or "BE").upper()
    if plan_type not in ("BE", "RE"):
        raise HTTPException(400, f"Invalid plan_type: {plan_type}")
    h = CapexPlanHeader(
        fy_year=body.fy,
        plan_type=plan_type,
        plan_version=body.planVersion or "v1",
        plan_status="Draft",
        effective_from_month=body.effMonth if plan_type == "RE" else None,
        created_by=_username(user),
    )
    db.add(h); db.flush()
    _replace_rows(h.id, body.rows, db)
    db.commit(); db.refresh(h)
    return _serialize_plan_full(h, db)


@router.put("/plans/{plan_id}")
def update_plan(
    plan_id: int,
    body: PlanBodyIn,
    db: Session = Depends(get_db),
    user=Depends(optional_user),
):
    h = db.query(CapexPlanHeader).filter(CapexPlanHeader.id == plan_id).first()
    if not h:
        raise HTTPException(404, "Plan not found")
    if h.plan_status != "Draft":
        raise HTTPException(
            status_code=423,
            detail=f"Plan is {h.plan_status}, not editable. Ask an admin to unlock it.",
        )
    # plan_type and fy_year are immutable on a saved plan; effMonth and version can change.
    if h.plan_type == "RE":
        h.effective_from_month = body.effMonth
    if body.planVersion:
        h.plan_version = body.planVersion
    _replace_rows(plan_id, body.rows, db)
    db.commit(); db.refresh(h)
    return _serialize_plan_full(h, db)


@router.post("/plans/{plan_id}/approve")
def approve_plan(plan_id: int, db: Session = Depends(get_db)):
    h = db.query(CapexPlanHeader).filter(CapexPlanHeader.id == plan_id).first()
    if not h:
        raise HTTPException(404, "Plan not found")
    if h.plan_status == "Approved":
        return {"ok": True, "status": "Approved", "noop": True}
    if h.plan_status != "Draft":
        raise HTTPException(409, f"Cannot approve a plan in status '{h.plan_status}'")
    h.plan_status = "Approved"; db.commit()
    return {"ok": True, "status": "Approved", "plan_id": plan_id}


@router.post("/plans/{plan_id}/unlock")
def unlock_plan(plan_id: int, db: Session = Depends(get_db), user=Depends(require_role("admin"))):
    h = db.query(CapexPlanHeader).filter(CapexPlanHeader.id == plan_id).first()
    if not h:
        raise HTTPException(404, "Plan not found")
    h.plan_status = "Draft"; db.commit()
    return {"ok": True, "status": "Draft", "unlocked_by": _username(user)}


@router.delete("/plans/{plan_id}")
def delete_plan(plan_id: int, db: Session = Depends(get_db), user=Depends(require_role("admin"))):
    h = db.query(CapexPlanHeader).filter(CapexPlanHeader.id == plan_id).first()
    if not h:
        raise HTTPException(404, "Plan not found")
    db.delete(h); db.commit()
    return {"ok": True, "deleted_id": plan_id}


# ---------------------------------------------------------------------------
# Actuals — Sprint 15.5
# ---------------------------------------------------------------------------
@router.get("/actuals")
def list_actuals(
    fy_year: str,
    scheme_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    """Return a per-row, per-month grid of actuals for the FY.

    Shape:
        {
          "fy_year": "2026-27",
          "rows": [
             {"row_id": 12, "row_name": "...", "scheme_id": 7,
              "plan_id": 4, "plan_version": "v1", "plan_type": "BE",
              "months": {"4": 12.5, "5": 8.2, ...}}
          ],
          "locked_months": [4, 5]
        }
    """
    # Pick the most recent BE plan for this FY (actuals are scoped to FY,
    # not to a specific plan; we just need rows to attach to. BE plan is the
    # canonical structure; if no BE exists, fall back to the newest RE plan.)
    plan_q = (
        db.query(CapexPlanHeader)
        .filter(CapexPlanHeader.fy_year == fy_year)
        .order_by(
            # BE first then RE
            (CapexPlanHeader.plan_type != "BE"),
            desc(CapexPlanHeader.created_at),
        )
    )
    plan = plan_q.first()
    if not plan:
        return {"fy_year": fy_year, "rows": [], "locked_months": [],
                "note": "No CAPEX plan exists for this FY yet. Create a BE plan first."}

    row_q = (
        db.query(CapexPlanRow)
        .filter(
            CapexPlanRow.plan_id == plan.id,
            CapexPlanRow.row_level == "Item",
        )
        .order_by(CapexPlanRow.display_order)
    )
    if scheme_id is not None:
        row_q = row_q.filter(CapexPlanRow.scheme_id == scheme_id)
    rows = row_q.all()

    # Bulk-fetch actuals for these rows
    actuals_by_row: dict[int, dict[int, float]] = {}
    if rows:
        actuals = (
            db.query(CapexActual)
            .filter(
                CapexActual.plan_row_id.in_([r.id for r in rows]),
                CapexActual.fy_year == fy_year,
            )
            .all()
        )
        for a in actuals:
            actuals_by_row.setdefault(a.plan_row_id, {})[a.month_no] = float(a.amount or 0)

    locks = (
        db.query(ActualsMonthLock)
        .filter(ActualsMonthLock.fy_year == fy_year)
        .all()
    )

    return {
        "fy_year": fy_year,
        "plan_id": plan.id,
        "plan_version": plan.plan_version,
        "plan_type": plan.plan_type,
        "rows": [
            {
                "row_id": r.id,
                "row_name": r.row_name,
                "scheme_id": r.scheme_id,
                "indent": r.indent_level,
                "months": {str(m): actuals_by_row.get(r.id, {}).get(m, 0.0)
                           for m in range(1, 13)},
            }
            for r in rows
        ],
        "locked_months": sorted({l.month_no for l in locks}),
    }


@router.put("/actuals/cell")
def upsert_actual_cell(
    body: ActualCellIn,
    db: Session = Depends(get_db),
    user=Depends(optional_user),
):
    """Upsert one (row, month) actual. Refuses if that month is locked."""
    if not (1 <= body.month_no <= 12):
        raise HTTPException(400, f"Invalid month_no: {body.month_no}")
    row = db.query(CapexPlanRow).filter(CapexPlanRow.id == body.plan_row_id).first()
    if not row:
        raise HTTPException(404, f"Plan row {body.plan_row_id} not found")
    if row.row_level != "Item":
        raise HTTPException(400, "Actuals can only be set on Item-level rows")

    locked = (
        db.query(ActualsMonthLock)
        .filter(
            ActualsMonthLock.fy_year == body.fy_year,
            ActualsMonthLock.month_no == body.month_no,
        )
        .first()
    )
    if locked:
        raise HTTPException(
            status_code=423,
            detail=f"Month {body.month_no} of {body.fy_year} is locked. Ask an admin to unlock.",
        )

    existing = (
        db.query(CapexActual)
        .filter(
            CapexActual.plan_row_id == body.plan_row_id,
            CapexActual.month_no == body.month_no,
        )
        .first()
    )
    username = _username(user)
    if existing:
        existing.amount = body.amount
        existing.fy_year = body.fy_year
        existing.updated_by = username
    else:
        db.add(CapexActual(
            plan_row_id=body.plan_row_id,
            month_no=body.month_no,
            fy_year=body.fy_year,
            amount=body.amount,
            created_by=username,
            updated_by=username,
        ))
    db.commit()
    return {"ok": True, "plan_row_id": body.plan_row_id, "month_no": body.month_no,
            "amount": body.amount}


# ---------------------------------------------------------------------------
# Month locks
# ---------------------------------------------------------------------------
@router.get("/locks")
def list_locks(fy_year: str, db: Session = Depends(get_db)):
    locks = (
        db.query(ActualsMonthLock)
        .filter(ActualsMonthLock.fy_year == fy_year)
        .order_by(ActualsMonthLock.month_no)
        .all()
    )
    return [
        {"fy_year": l.fy_year, "month_no": l.month_no,
         "locked_by": l.locked_by,
         "locked_at": l.locked_at.isoformat() if l.locked_at else None,
         "note": l.note}
        for l in locks
    ]


@router.post("/locks")
def add_lock(
    body: MonthLockIn,
    db: Session = Depends(get_db),
    user=Depends(require_role("admin")),
):
    if not (1 <= body.month_no <= 12):
        raise HTTPException(400, f"Invalid month_no: {body.month_no}")
    existing = (
        db.query(ActualsMonthLock)
        .filter(
            ActualsMonthLock.fy_year == body.fy_year,
            ActualsMonthLock.month_no == body.month_no,
        )
        .first()
    )
    if existing:
        return {"ok": True, "noop": True, "month_no": body.month_no}
    db.add(ActualsMonthLock(
        fy_year=body.fy_year, month_no=body.month_no,
        locked_by=_username(user), note=body.note,
    ))
    db.commit()
    return {"ok": True, "fy_year": body.fy_year, "month_no": body.month_no}


@router.delete("/locks/{fy_year}/{month_no}")
def remove_lock(
    fy_year: str,
    month_no: int,
    db: Session = Depends(get_db),
    user=Depends(require_role("admin")),
):
    lock = (
        db.query(ActualsMonthLock)
        .filter(
            ActualsMonthLock.fy_year == fy_year,
            ActualsMonthLock.month_no == month_no,
        )
        .first()
    )
    if not lock:
        return {"ok": True, "noop": True}
    db.delete(lock); db.commit()
    return {"ok": True, "fy_year": fy_year, "month_no": month_no}


# ---------------------------------------------------------------------------
# Deprecated
# ---------------------------------------------------------------------------
@router.post("/plan/save_hierarchy", deprecated=True)
def deprecated_save_hierarchy():
    raise HTTPException(
        status_code=410,
        detail="Removed in Sprint 15. Use POST/PUT /api/v1/capex/plans instead.",
    )
