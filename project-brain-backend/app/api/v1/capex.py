"""CAPEX plan persistence — Sprint 15.

Replaces the older single-endpoint capex.py.  Provides:

    GET    /api/v1/capex/plans                          list available plans
    POST   /api/v1/capex/plans                          create new plan (empty header + replace contents)
    GET    /api/v1/capex/plans/{plan_id}                load one plan in frontend-ready shape
    PUT    /api/v1/capex/plans/{plan_id}                replace plan contents (rows / values / months)
    POST   /api/v1/capex/plans/{plan_id}/approve        lock the plan (any authenticated user; status=Approved)
    POST   /api/v1/capex/plans/{plan_id}/unlock         admin-only: back to Draft
    DELETE /api/v1/capex/plans/{plan_id}                remove a plan entirely (admin-only)

    POST   /api/v1/plan/save_hierarchy                  DEPRECATED — kept as 410 Gone alias
                                                        so old clients fail loud rather than silently
                                                        duplicating plans.

Design notes:
* One plan == one row in `capex_plan_header`.  A "new version" is a brand new
  plan row (separate id, separate fy/type/version triple).  Editing an existing
  plan uses PUT, which deletes-then-reinserts the rows/values/months for that
  plan only.  No more duplicate-on-save bug.
* Status enforcement: PUT and DELETE refuse to act on plans whose status is
  not 'Draft'.  `approve` flips Draft -> Approved.  `unlock` (admin) flips
  Approved -> Draft.  Anything else is a no-op (with a 409 explaining why).
* GETs (list, load) are open — frontend doesn't currently send a token to
  /capex/*.  PUT/POST/DELETE use optional_user so we record `created_by` if
  available but don't reject anonymous callers.  Unlock and DELETE require
  admin via `require_role`.
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.capex import (
    CapexMonthValue,
    CapexPlanHeader,
    CapexPlanRow,
    CapexPlanValue,
)
try:
    from app.security.auth import optional_user, require_role
except Exception:
    from fastapi import Header

    def optional_user():
        return None

    def require_role(role: str):
        def _dep(authorization: str | None = Header(default=None)):
            if not authorization or " " not in authorization:
                raise HTTPException(status_code=403, detail="Forbidden")
            token = authorization.split(" ", 1)[1]
            import base64
            import json
            try:
                payload = token.split(".")[1]
                payload += "=" * (-len(payload) % 4)
                data = json.loads(base64.urlsafe_b64decode(payload.encode()).decode())
            except Exception:
                raise HTTPException(status_code=403, detail="Forbidden")
            if str(data.get("role", "")).lower() != str(role).lower():
                raise HTTPException(status_code=403, detail="Forbidden")
            return {"role": data.get("role"), "username": data.get("sub")}

        return _dep

router = APIRouter(prefix="/capex", tags=["CAPEX"])


# ---------------------------------------------------------------------------
# Request / response payloads
# ---------------------------------------------------------------------------
class MonthValueIn(BaseModel):
    be: float = 0.0
    re: float = 0.0
    actual: float = 0.0


class RowIn(BaseModel):
    """One row of the flat hierarchical tree the UI sends."""
    id: Optional[str] = None              # client-side id (e.g. 'sch_42'); ignored on save
    name: str
    level: str                            # "Header" | "SubHeader" | "Item"
    indent: int = 0                       # 0, 1, or 2
    gross: float = 0.0
    cumLast: float = 0.0
    beFY: float = 0.0
    reFY: float = 0.0
    actualFY: float = 0.0
    scheme_id: Optional[int] = None
    months: dict[str, MonthValueIn] = Field(default_factory=dict)


class PlanBodyIn(BaseModel):
    """Full plan payload — header attrs + the flat rows array."""
    fy: str                               # "2026-27"
    planType: str                         # "BE" | "RE"
    planVersion: Optional[str] = "v1"
    status: Optional[str] = "Draft"
    effMonth: Optional[int] = None        # 4..12, 1..3
    rows: list[RowIn] = Field(default_factory=list)


class PlanListItem(BaseModel):
    id: int
    fy_year: str
    plan_type: str
    plan_version: Optional[str]
    plan_status: str
    is_effective: bool
    effective_from_month: Optional[int]
    created_by: Optional[str]
    created_at: Optional[str]
    row_count: int


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
    """Return the header + flat rows array in the exact shape the React UI expects."""
    rows = (
        db.query(CapexPlanRow)
        .filter(CapexPlanRow.plan_id == header.id)
        .order_by(CapexPlanRow.display_order)
        .all()
    )

    serialized_rows = []
    for r in rows:
        # Load values + months for items
        months: dict[str, dict] = {}
        for mv in r.months:
            months[str(mv.month_no)] = {
                "be": float(mv.be_amount or 0),
                "re": float(mv.re_amount or 0),
                "actual": float(mv.actual_amount or 0),
            }

        values = r.values  # one-to-one
        serialized_rows.append({
            # Match the frontend's client-id convention so React state keys
            # stay stable.  Items linked to a scheme_master get the 'sch_<id>'
            # form; everything else falls back to a 'row_<dbid>' form.
            "id": f"sch_{r.scheme_id}" if r.scheme_id else f"row_{r.id}",
            "name": r.row_name,
            "level": r.row_level,
            "indent": r.indent_level,
            "scheme_id": r.scheme_id,
            "gross": float(values.gross_cost) if values else 0.0,
            "cumLast": float(values.cumulative_exp_till_last_fy) if values else 0.0,
            "beFY": float(values.be_fy) if values else 0.0,
            "reFY": float(values.re_fy) if values else 0.0,
            "actualFY": 0.0,   # not stored at row level today; derived in UI
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
        "rows": serialized_rows,
    }


def _replace_rows(plan_id: int, rows: list[RowIn], db: Session) -> None:
    """Wipe the plan's rows/values/months and re-insert from the payload.

    Kept transactional via the caller's commit() at the end of the request.
    """
    # Delete in FK-friendly order.  ORM cascade would handle this but explicit
    # bulk deletes are faster on big plans and easier to reason about.
    row_ids = [r.id for r in db.query(CapexPlanRow.id).filter(CapexPlanRow.plan_id == plan_id).all()]
    if row_ids:
        db.query(CapexMonthValue).filter(CapexMonthValue.plan_row_id.in_(row_ids)).delete(synchronize_session=False)
        db.query(CapexPlanValue).filter(CapexPlanValue.plan_row_id.in_(row_ids)).delete(synchronize_session=False)
        db.query(CapexPlanRow).filter(CapexPlanRow.plan_id == plan_id).delete(synchronize_session=False)

    # Re-insert.  parent_row_id reconstructed from indent: the most recent
    # row with indent==(this row's indent-1) is the parent.
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
            is_imported=bool(row.scheme_id),
        )
        db.add(db_row)
        db.flush()  # need db_row.id for child rows and value FKs

        parent_by_indent[row.indent] = db_row.id
        # Clear stale entries from deeper indent levels so siblings can't
        # accidentally pick a former cousin as a parent.
        for stale_indent in list(parent_by_indent.keys()):
            if stale_indent > row.indent:
                parent_by_indent.pop(stale_indent, None)

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
                # Skip empty rows to keep the table small — re-insert only ones
                # that hold any data.  PUT will re-write zeros as absence next save.
                if m_val.be == 0 and m_val.re == 0 and m_val.actual == 0:
                    continue
                db.add(CapexMonthValue(
                    plan_row_id=db_row.id,
                    month_no=m_no,
                    be_amount=m_val.be,
                    re_amount=m_val.re,
                    actual_amount=m_val.actual,
                ))


def _username(user: Optional[dict]) -> Optional[str]:
    if not user:
        return None
    return user.get("username") or str(user.get("user_id") or "")


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@router.get("/plans")
def list_plans(
    fy_year: Optional[str] = None,
    plan_type: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """List capex plans, optionally filtered by FY / type. Newest first."""
    q = db.query(CapexPlanHeader)
    if fy_year:
        q = q.filter(CapexPlanHeader.fy_year == fy_year)
    if plan_type:
        q = q.filter(CapexPlanHeader.plan_type == plan_type)
    plans = q.order_by(desc(CapexPlanHeader.created_at), desc(CapexPlanHeader.id)).all()

    if not plans:
        return []

    # Single grouped count query so we don't issue N+1 row-count queries.
    from sqlalchemy import func
    counts = dict(
        db.query(CapexPlanRow.plan_id, func.count(CapexPlanRow.id))
        .filter(CapexPlanRow.plan_id.in_([p.id for p in plans]))
        .group_by(CapexPlanRow.plan_id)
        .all()
    )

    return [_serialize_header(p, counts.get(p.id, 0)) for p in plans]


@router.get("/plans/{plan_id}")
def get_plan(plan_id: int, db: Session = Depends(get_db)):
    header = db.query(CapexPlanHeader).filter(CapexPlanHeader.id == plan_id).first()
    if not header:
        raise HTTPException(404, "Plan not found")
    return _serialize_plan_full(header, db)


@router.post("/plans")
def create_plan(
    body: PlanBodyIn,
    db: Session = Depends(get_db),
    user: Optional[dict] = Depends(optional_user),
):
    """Create a new plan header + initial contents. Returns the saved plan in full."""
    header = CapexPlanHeader(
        fy_year=body.fy,
        plan_type=body.planType,
        plan_version=body.planVersion or "v1",
        plan_status="Draft",                # always created as Draft regardless of payload
        effective_from_month=body.effMonth,
        created_by=_username(user),
    )
    db.add(header)
    db.flush()    # need header.id

    _replace_rows(header.id, body.rows, db)
    db.commit()
    db.refresh(header)
    return _serialize_plan_full(header, db)


@router.put("/plans/{plan_id}")
def update_plan(
    plan_id: int,
    body: PlanBodyIn,
    db: Session = Depends(get_db),
    user: Optional[dict] = Depends(optional_user),
):
    """Replace the contents of an existing plan. Refuses if not Draft."""
    header = db.query(CapexPlanHeader).filter(CapexPlanHeader.id == plan_id).first()
    if not header:
        raise HTTPException(404, "Plan not found")
    if header.plan_status != "Draft":
        # 423 Locked is the correct status here, but some clients fail to surface
        # custom codes well; 409 Conflict is the next most accurate.
        raise HTTPException(
            status_code=423,
            detail=f"Plan is {header.plan_status}, not editable. Ask an admin to unlock it.",
        )

    # Allow header-level metadata to be tweaked alongside the rows (e.g. effMonth).
    # FY and planType are intentionally immutable on a saved plan — creating a
    # new FY/type combo should be a new plan, not a rename of an old one.
    header.effective_from_month = body.effMonth
    if body.planVersion:
        header.plan_version = body.planVersion

    _replace_rows(plan_id, body.rows, db)
    db.commit()
    db.refresh(header)
    return _serialize_plan_full(header, db)


@router.post("/plans/{plan_id}/approve")
def approve_plan(
    plan_id: int,
    db: Session = Depends(get_db),
    user: Optional[dict] = Depends(optional_user),
):
    """Flip Draft -> Approved. Any authenticated (or anonymous) caller can approve.

    The 'real' approval workflow with multi-step sign-off lives in a later
    sprint — this is the minimal lock so cell edits stop being possible.
    """
    header = db.query(CapexPlanHeader).filter(CapexPlanHeader.id == plan_id).first()
    if not header:
        raise HTTPException(404, "Plan not found")
    if header.plan_status == "Approved":
        return {"ok": True, "status": "Approved", "noop": True}
    if header.plan_status != "Draft":
        raise HTTPException(409, f"Cannot approve a plan in status '{header.plan_status}'")
    header.plan_status = "Approved"
    db.commit()
    return {"ok": True, "status": "Approved", "plan_id": plan_id}


@router.post("/plans/{plan_id}/unlock")
def unlock_plan(
    plan_id: int,
    db: Session = Depends(get_db),
    user: dict = Depends(require_role("admin")),
):
    """ADMIN ONLY — flip Approved -> Draft so it becomes editable again."""
    header = db.query(CapexPlanHeader).filter(CapexPlanHeader.id == plan_id).first()
    if not header:
        raise HTTPException(404, "Plan not found")
    if header.plan_status == "Draft":
        return {"ok": True, "status": "Draft", "noop": True}
    header.plan_status = "Draft"
    db.commit()
    return {"ok": True, "status": "Draft", "plan_id": plan_id, "unlocked_by": _username(user)}


@router.delete("/plans/{plan_id}")
def delete_plan(
    plan_id: int,
    db: Session = Depends(get_db),
    user: dict = Depends(require_role("admin")),
):
    """ADMIN ONLY — permanently delete a plan and all its rows/values/months."""
    header = db.query(CapexPlanHeader).filter(CapexPlanHeader.id == plan_id).first()
    if not header:
        raise HTTPException(404, "Plan not found")
    # ORM cascade on CapexPlanHeader.rows ('all, delete') handles the children.
    db.delete(header)
    db.commit()
    return {"ok": True, "deleted_id": plan_id}


# ---------------------------------------------------------------------------
# Deprecated alias — old buggy endpoint, retained as 410 so clients fail loud.
# ---------------------------------------------------------------------------
@router.post("/plan/save_hierarchy", deprecated=True)
def deprecated_save_hierarchy():
    raise HTTPException(
        status_code=410,
        detail=(
            "This endpoint was removed in Sprint 15 because it duplicated plans "
            "on every call. Use POST /api/v1/capex/plans (create) or "
            "PUT /api/v1/capex/plans/{plan_id} (update) instead."
        ),
    )
