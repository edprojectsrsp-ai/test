"""CAPEX router — Sprint 15.5 B+C.

Adds on top of Half A:
  * Single BE + single RE per FY enforcement (DB unique + friendly error)
  * Override unlock (no auth — just a button click)
  * GET /capex/fy-options              available FYs for the dropdown
  * GET /capex/rollover/{fy_year}      previous-FY actuals + cum, by scheme
  * Package-level rows in plans (row_level = 'Package') — backend just persists
  * RE auto-fill: pre-effective-month RE cells get the corresponding Actual
    value automatically (read-side overlay; user can also persist explicitly)
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import desc, func
from sqlalchemy.exc import IntegrityError
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
from app.models.scheme import Scheme, Package
from app.security.auth import optional_user
from app.services.flow_balance import capex_row_balance, next_fy_cum_last, validate_capex_plan

router = APIRouter(prefix="/capex", tags=["CAPEX"])

VALID_ROW_LEVELS = {"Header", "SubHeader", "Item", "Package"}
ARCHIVED_STATUS = "Archived"


# ---------------------------------------------------------------------------
# Payload schemas
# ---------------------------------------------------------------------------
class MonthValueIn(BaseModel):
    be: float = 0.0
    re: float = 0.0
    actual: float = 0.0


class RowIn(BaseModel):
    id: Optional[str] = None
    name: str
    level: str                                # Header | SubHeader | Item | Package
    indent: int = 0
    gross: float = 0.0
    cumLast: float = 0.0
    beFY: float = 0.0
    reFY: float = 0.0
    actualFY: float = 0.0
    scheme_id: Optional[int] = None
    package_id: Optional[int] = None          # set on Package-level rows
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
    month_no: int
    amount: float
    fy_year: str


class MonthLockIn(BaseModel):
    fy_year: str
    month_no: int
    note: Optional[str] = None


# ---------------------------------------------------------------------------
# Serialization
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
    """Return plan in UI shape.

    For RE plans, the months dict is overlaid with auto-filled RE values for
    pre-effective months (= the corresponding actual). The user still sees
    the original re_amount column in the DB, but the API serves the overlay
    so the UI shows the rule applied immediately.
    """
    rows = (
        db.query(CapexPlanRow)
        .filter(CapexPlanRow.plan_id == header.id)
        .order_by(CapexPlanRow.display_order)
        .all()
    )

    # Pre-fetch actuals for all Item/Package rows (RE overlay needs them)
    actuals_lookup: dict[int, dict[int, float]] = {}
    if header.plan_type == "RE" and rows:
        leaf_ids = [r.id for r in rows if r.row_level in ("Item", "Package")]
        if leaf_ids:
            acts = (
                db.query(CapexActual)
                .filter(
                    CapexActual.plan_row_id.in_(leaf_ids),
                    CapexActual.fy_year == header.fy_year,
                )
                .all()
            )
            for a in acts:
                actuals_lookup.setdefault(a.plan_row_id, {})[a.month_no] = float(a.amount or 0)

    serialized = []
    for r in rows:
        months: dict[str, dict] = {}
        for mv in r.months:
            months[str(mv.month_no)] = {
                "be": float(mv.be_amount or 0),
                "re": float(mv.re_amount or 0),
                "actual": float(mv.actual_amount or 0),
            }
        # RE overlay: for leaf rows in an RE plan, pre-effective-month RE
        # auto-fills from the actual (if any). User-typed RE is preserved if
        # the user set it explicitly. The simple rule: pre-effective RE =
        # actual; post-effective RE = whatever's stored.
        if (
            header.plan_type == "RE"
            and header.effective_from_month is not None
            and r.row_level in ("Item", "Package")
        ):
            eff = header.effective_from_month
            for m_no in range(1, 13):
                key = str(m_no)
                in_pre_eff = _is_pre_effective(m_no, eff)
                if in_pre_eff:
                    actual_amt = actuals_lookup.get(r.id, {}).get(m_no, 0.0)
                    cell = months.setdefault(key, {"be": 0, "re": 0, "actual": 0})
                    cell["re"] = actual_amt
                    cell["actual"] = actual_amt
                    cell["_re_auto_filled"] = True   # UI uses this to dim/lock

        v = r.values
        row_out = {
            "id": (f"sch_{r.scheme_id}" if r.scheme_id and r.row_level == "Item"
                   else f"pkg_{r.scheme_id}_{r.row_name}" if r.row_level == "Package"
                   else f"row_{r.id}"),
            "row_id": r.id,
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
            # Editable from the UI's perspective. Item/Package = editable;
            # Header/SubHeader = roll-up only.
            "isEditable": r.row_level in ("Item", "Package"),
        }
        if r.row_level in ("Item", "Package"):
            balance = capex_row_balance(
                gross=float(v.gross_cost or 0) if v else 0.0,
                cum_last=float(v.cumulative_exp_till_last_fy or 0) if v else 0.0,
                months=months,
                plan_type=header.plan_type,
                effective_month=header.effective_from_month,
                sanctioned=float((v.re_fy or v.be_fy) or 0) if v else 0.0,
            )
            row_out["balance"] = balance.balance
            row_out["cumulative_actual"] = balance.cumulative_actual
            row_out["within_sanction"] = balance.within_sanction
        serialized.append(row_out)
    return {
        "header": _serialize_header(header, len(rows)),
        "fy": header.fy_year,
        "planType": header.plan_type,
        "planVersion": header.plan_version,
        "status": header.plan_status,
        "effMonth": header.effective_from_month,
        "rows": serialized,
    }


def _is_pre_effective(month_no: int, effective_month: int) -> bool:
    """A month is 'pre-effective' if it occurs before the effective month
    within the same FY. FY runs Apr(4)..Mar(3), so the comparison wraps."""
    fy_order = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3]
    try:
        m_idx = fy_order.index(month_no)
        e_idx = fy_order.index(effective_month)
    except ValueError:
        return False
    return m_idx < e_idx


def _replace_rows(plan_id: int, rows: list[RowIn], db: Session) -> None:
    """Wipe & re-insert plan rows + values + months.
    Validates row_level. Does NOT touch capex_actuals (those belong to row
    cascade — if a row is replaced with a new id, its actuals are lost.
    That's acceptable because actuals are linked by row_id, and the user is
    explicitly re-doing the plan structure)."""
    for r in rows:
        if r.level not in VALID_ROW_LEVELS:
            raise HTTPException(400, f"Invalid row level: {r.level}")

    header = db.query(CapexPlanHeader).filter(CapexPlanHeader.id == plan_id).first()
    if not header:
        raise HTTPException(404, "CAPEX plan not found")

    validation_rows = [
        {
            "gross": r.gross,
            "cumLast": r.cumLast,
            "sanctioned": (r.reFY or r.beFY),
            "months": {
                int(k): {"be": v.be, "re": v.re, "actual": v.actual}
                for k, v in (r.months or {}).items()
            },
        }
        for r in rows
        if r.level in ("Item", "Package")
    ]
    validation = validate_capex_plan(validation_rows, header.plan_type, header.effective_from_month)
    if not validation["ok"]:
        raise HTTPException(status_code=422, detail={"detail": "CAPEX exceeds sanction", "errors": validation["errors"]})

    row_ids = [r.id for r in db.query(CapexPlanRow.id).filter(CapexPlanRow.plan_id == plan_id).all()]
    if row_ids:
        db.query(CapexMonthValue).filter(CapexMonthValue.plan_row_id.in_(row_ids)).delete(synchronize_session=False)
        db.query(CapexPlanValue).filter(CapexPlanValue.plan_row_id.in_(row_ids)).delete(synchronize_session=False)
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

        if row.level in ("Item", "Package"):
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
# Diagnostics
# ---------------------------------------------------------------------------
@router.get("/ping")
def ping():
    return {"ok": True, "service": "capex", "sprint": "15.5-bc"}


@router.get("/fy-options")
def fy_options(db: Session = Depends(get_db)):
    """Distinct FYs that have a plan, plus a couple of forward FYs so the
    user can create a new BE without one existing yet. Returned sorted
    descending (newest first) — the dropdown expects this order."""
    fys_with_plans = [
        row[0]
        for row in db.query(CapexPlanHeader.fy_year)
        .distinct()
        .filter(CapexPlanHeader.plan_status != ARCHIVED_STATUS)
        .all()
    ]
    # Heuristic: also include the obvious "current FY + next" so a fresh DB
    # doesn't show an empty dropdown. Apr boundary aware.
    from datetime import date
    today = date.today()
    start_year = today.year if today.month >= 4 else today.year - 1
    forward = [f"{y}-{(y+1) % 100:02d}" for y in range(start_year - 1, start_year + 3)]
    combined = sorted(set(fys_with_plans + forward), reverse=True)
    return {"fy_options": combined}


# ---------------------------------------------------------------------------
# Plans
# ---------------------------------------------------------------------------
@router.get("/plans")
def list_plans(
    fy_year: Optional[str] = None,
    plan_type: Optional[str] = None,
    include_archived: bool = False,
    db: Session = Depends(get_db),
):
    q = db.query(CapexPlanHeader)
    if fy_year:
        q = q.filter(CapexPlanHeader.fy_year == fy_year)
    if plan_type:
        q = q.filter(CapexPlanHeader.plan_type == plan_type)
    if not include_archived:
        q = q.filter(CapexPlanHeader.plan_status != ARCHIVED_STATUS)
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
def create_plan(body: PlanBodyIn, db: Session = Depends(get_db), user=Depends(optional_user)):
    plan_type = (body.planType or "BE").upper()
    if plan_type not in ("BE", "RE"):
        raise HTTPException(400, f"Invalid plan_type: {plan_type}")
    # Single-BE/RE-per-FY check (more friendly error than letting DB throw)
    existing = (
        db.query(CapexPlanHeader)
        .filter(
            CapexPlanHeader.fy_year == body.fy,
            CapexPlanHeader.plan_type == plan_type,
            CapexPlanHeader.plan_status != ARCHIVED_STATUS,
        )
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=409,
            detail=(
                f"A {plan_type} plan already exists for FY {body.fy} "
                f"(id={existing.id}, status={existing.plan_status}). "
                f"Edit it instead, or archive it from the admin panel."
            ),
        )
    h = CapexPlanHeader(
        fy_year=body.fy,
        plan_type=plan_type,
        plan_version=body.planVersion or "v1",
        plan_status="Draft",
        effective_from_month=body.effMonth if plan_type == "RE" else None,
        created_by=_username(user),
    )
    db.add(h)
    try:
        db.flush()
    except IntegrityError as e:
        db.rollback()
        raise HTTPException(409, f"Could not create plan: {e.orig}")
    _replace_rows(h.id, body.rows, db)
    db.commit()
    db.refresh(h)
    return _serialize_plan_full(h, db)


@router.put("/plans/{plan_id}")
def update_plan(plan_id: int, body: PlanBodyIn, db: Session = Depends(get_db), user=Depends(optional_user)):
    h = db.query(CapexPlanHeader).filter(CapexPlanHeader.id == plan_id).first()
    if not h:
        raise HTTPException(404, "Plan not found")
    if h.plan_status not in ("Draft",):
        raise HTTPException(
            status_code=423,
            detail=f"Plan is {h.plan_status}, not editable. Use the Override Unlock button.",
        )
    if h.plan_type == "RE":
        h.effective_from_month = body.effMonth
    if body.planVersion:
        h.plan_version = body.planVersion
    _replace_rows(plan_id, body.rows, db)
    db.commit()
    db.refresh(h)
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
    h.plan_status = "Approved"
    db.commit()
    return {"ok": True, "status": "Approved", "plan_id": plan_id}


@router.post("/plans/{plan_id}/unlock")
def unlock_plan(plan_id: int, db: Session = Depends(get_db)):
    """Override unlock — no auth check per current spec.

    Important: this is intentionally insecure for the demo phase. Future
    sprint should restore role-based auth or password protection.
    """
    h = db.query(CapexPlanHeader).filter(CapexPlanHeader.id == plan_id).first()
    if not h:
        raise HTTPException(404, "Plan not found")
    h.plan_status = "Draft"
    db.commit()
    return {"ok": True, "status": "Draft", "note": "override unlock (no auth)"}


@router.delete("/plans/{plan_id}")
def delete_plan(plan_id: int, db: Session = Depends(get_db)):
    """Override delete — no auth check per current spec."""
    h = db.query(CapexPlanHeader).filter(CapexPlanHeader.id == plan_id).first()
    if not h:
        raise HTTPException(404, "Plan not found")
    db.delete(h)
    db.commit()
    return {"ok": True, "deleted_id": plan_id}


# ---------------------------------------------------------------------------
# Actuals
# ---------------------------------------------------------------------------
@router.get("/actuals")
def list_actuals(fy_year: str, scheme_id: Optional[int] = None, db: Session = Depends(get_db)):
    plan = (
        db.query(CapexPlanHeader)
        .filter(
            CapexPlanHeader.fy_year == fy_year,
            CapexPlanHeader.plan_status != ARCHIVED_STATUS,
        )
        .order_by(
            (CapexPlanHeader.plan_type != "BE"),
            desc(CapexPlanHeader.created_at),
        )
        .first()
    )
    if not plan:
        return {"fy_year": fy_year, "rows": [], "locked_months": [],
                "note": "No CAPEX plan exists for this FY yet. Create a BE plan first."}

    row_q = (
        db.query(CapexPlanRow)
        .filter(
            CapexPlanRow.plan_id == plan.id,
            CapexPlanRow.row_level.in_(["Item", "Package"]),
        )
        .order_by(CapexPlanRow.display_order)
    )
    if scheme_id is not None:
        row_q = row_q.filter(CapexPlanRow.scheme_id == scheme_id)
    rows = row_q.all()

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
                "row_level": r.row_level,
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
def upsert_actual_cell(body: ActualCellIn, db: Session = Depends(get_db), user=Depends(optional_user)):
    if not (1 <= body.month_no <= 12):
        raise HTTPException(400, f"Invalid month_no: {body.month_no}")
    row = db.query(CapexPlanRow).filter(CapexPlanRow.id == body.plan_row_id).first()
    if not row:
        raise HTTPException(404, f"Plan row {body.plan_row_id} not found")
    if row.row_level not in ("Item", "Package"):
        raise HTTPException(400, "Actuals can only be set on Item/Package-level rows")

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
            detail=f"Month {body.month_no} of {body.fy_year} is locked. Click 'Unlock month'.",
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
# Month locks (no auth)
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
def add_lock(body: MonthLockIn, db: Session = Depends(get_db), user=Depends(optional_user)):
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
def remove_lock(fy_year: str, month_no: int, db: Session = Depends(get_db)):
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
    db.delete(lock)
    db.commit()
    return {"ok": True, "fy_year": fy_year, "month_no": month_no}


# ---------------------------------------------------------------------------
# Cross-FY rollover
# ---------------------------------------------------------------------------
def _prev_fy(fy_year: str) -> Optional[str]:
    """'2027-28' → '2026-27'. Returns None if format unrecognized."""
    try:
        parts = fy_year.replace("FY", "").strip().split("-")
        if len(parts) != 2:
            return None
        start = int(parts[0])
        return f"{start - 1}-{(start) % 100:02d}"
    except (ValueError, IndexError):
        return None


@router.get("/rollover/{fy_year}")
def fy_rollover_preview(fy_year: str, db: Session = Depends(get_db)):
    """Compute what 'Cumulative till Last FY' should be for each scheme/package
    when starting a new FY's BE plan.

    Formula:  for each scheme/package leaf row in the PREVIOUS FY's plan,
              new_cum_till_last_fy = old_cum_till_last_fy + sum(actuals for prev FY)

    Returns a dict keyed by scheme_id (and package_id) so the frontend can
    auto-fill matching rows when importing schemes.
    """
    prev = _prev_fy(fy_year)
    if not prev:
        return {"prev_fy": None, "by_scheme": {}, "by_package": {},
                "note": f"Could not derive previous FY from '{fy_year}'."}

    prev_plan = (
        db.query(CapexPlanHeader)
        .filter(
            CapexPlanHeader.fy_year == prev,
            CapexPlanHeader.plan_status != ARCHIVED_STATUS,
        )
        .order_by(
            (CapexPlanHeader.plan_type != "BE"),
            desc(CapexPlanHeader.created_at),
        )
        .first()
    )
    if not prev_plan:
        return {"prev_fy": prev, "by_scheme": {}, "by_package": {},
                "note": f"No plan in {prev} to roll over from."}

    leaf_rows = (
        db.query(CapexPlanRow)
        .filter(
            CapexPlanRow.plan_id == prev_plan.id,
            CapexPlanRow.row_level.in_(["Item", "Package"]),
        )
        .all()
    )
    if not leaf_rows:
        return {"prev_fy": prev, "by_scheme": {}, "by_package": {},
                "note": f"Plan {prev_plan.id} has no leaf rows."}

    values_by_row: dict[int, CapexPlanValue] = {
        v.plan_row_id: v
        for v in db.query(CapexPlanValue)
        .filter(CapexPlanValue.plan_row_id.in_([r.id for r in leaf_rows]))
        .all()
    }
    actual_totals = dict(
        db.query(CapexActual.plan_row_id, func.coalesce(func.sum(CapexActual.amount), 0))
        .filter(
            CapexActual.plan_row_id.in_([r.id for r in leaf_rows]),
            CapexActual.fy_year == prev,
        )
        .group_by(CapexActual.plan_row_id)
        .all()
    )

    by_scheme: dict[str, float] = {}
    by_package: dict[str, float] = {}
    for r in leaf_rows:
        v = values_by_row.get(r.id)
        old_cum = float(v.cumulative_exp_till_last_fy or 0) if v else 0.0
        prev_actual_total = float(actual_totals.get(r.id, 0) or 0)
        new_cum = next_fy_cum_last(old_cum, prev_actual_total)
        if r.row_level == "Item" and r.scheme_id is not None:
            by_scheme[str(r.scheme_id)] = round(new_cum, 4)
        elif r.row_level == "Package":
            # Use the row_name as a stable key — frontend can match by name
            # when importing packages. (Package rows don't carry package_id
            # in this schema, just the name.)
            by_package[f"{r.scheme_id or 0}::{r.row_name}"] = round(new_cum, 4)

    return {
        "prev_fy": prev,
        "prev_plan_id": prev_plan.id,
        "by_scheme": by_scheme,
        "by_package": by_package,
        "note": f"Rolled over from {prev} plan id={prev_plan.id} "
                f"({len(by_scheme)} schemes, {len(by_package)} packages).",
    }


# ---------------------------------------------------------------------------
# Schemes + packages for import
# ---------------------------------------------------------------------------
@router.get("/import-source")
def import_source(db: Session = Depends(get_db)):
    """One-shot endpoint for the 'Import Schemes' button.

    Returns all non-deleted schemes plus their packages, in a shape the
    frontend can immediately turn into hierarchical rows under the right
    A./B1-B3/C/D1-D4 headers.

    Doing this server-side avoids two round-trips per import.
    """
    schemes = (
        db.query(Scheme)
        .filter(Scheme.is_deleted == False)   # noqa: E712
        .all()
    )
    pkgs = (
        db.query(Package)
        .filter(Package.is_deleted == False, Package.is_scheme_mirror == False)   # noqa: E712
        .all()
    )
    pkg_by_scheme: dict[int, list] = {}
    for p in pkgs:
        pkg_by_scheme.setdefault(p.scheme_id, []).append({
            "package_id": p.package_id,
            "package_no": p.package_no,
            "package_name": p.package_name,
            "package_value_cr": float(p.package_value_cr or 0),
            "package_estimate_cr": float(p.package_estimate_cr or 0),
            "package_status": p.package_status,
        })
    return {
        "schemes": [
            {
                "scheme_id": s.scheme_id,
                "scheme_name": s.scheme_name,
                "scheme_type": s.scheme_type,
                "current_status": s.current_status,
                "estimated_cost_cr": float(s.estimated_cost_cr or 0),
                "sanctioned_cost_cr": float(s.sanctioned_cost_cr or 0),
                "has_multiple_packages": bool(getattr(s, "has_multiple_packages", False)),
                "packages": pkg_by_scheme.get(s.scheme_id, []),
            }
            for s in schemes
        ],
    }


@router.get("/projects")
def capex_projects(fy_year: str, db: Session = Depends(get_db)):
    """Report-friendly CAPEX rows grouped by scheme for the furnace reports."""
    be_plan = (
        db.query(CapexPlanHeader)
        .filter(
            CapexPlanHeader.fy_year == fy_year,
            CapexPlanHeader.plan_type == "BE",
            CapexPlanHeader.plan_status != ARCHIVED_STATUS,
        )
        .order_by(desc(CapexPlanHeader.created_at), desc(CapexPlanHeader.id))
        .first()
    )
    re_plan = (
        db.query(CapexPlanHeader)
        .filter(
            CapexPlanHeader.fy_year == fy_year,
            CapexPlanHeader.plan_type == "RE",
            CapexPlanHeader.plan_status != ARCHIVED_STATUS,
        )
        .order_by(desc(CapexPlanHeader.created_at), desc(CapexPlanHeader.id))
        .first()
    )
    base_plan = re_plan or be_plan
    if not base_plan:
        return []

    def _leaf_rows(plan_id: int | None):
        if not plan_id:
            return []
        rows = (
            db.query(CapexPlanRow)
            .filter(
                CapexPlanRow.plan_id == plan_id,
                CapexPlanRow.row_level.in_(["Item", "Package"]),
            )
            .order_by(CapexPlanRow.display_order, CapexPlanRow.id)
            .all()
        )
        parent_ids = {row.parent_row_id for row in rows if row.parent_row_id}
        return [row for row in rows if row.id not in parent_ids and row.scheme_id]

    base_rows = _leaf_rows(base_plan.id)
    be_rows = _leaf_rows(be_plan.id if be_plan else None)
    re_rows = _leaf_rows(re_plan.id if re_plan else None)

    if not base_rows:
        return []

    scheme_ids = sorted({r.scheme_id for r in base_rows if r.scheme_id})
    schemes = {
        s.scheme_id: s
        for s in db.query(Scheme).filter(Scheme.scheme_id.in_(scheme_ids)).all()
    } if scheme_ids else {}

    def _values_map(rows: list[CapexPlanRow]):
        row_ids = [r.id for r in rows]
        value_map = {
            v.plan_row_id: v
            for v in db.query(CapexPlanValue).filter(CapexPlanValue.plan_row_id.in_(row_ids)).all()
        } if row_ids else {}
        month_map: dict[int, dict[int, dict[str, float]]] = {}
        if row_ids:
            for mv in db.query(CapexMonthValue).filter(CapexMonthValue.plan_row_id.in_(row_ids)).all():
                month_map.setdefault(mv.plan_row_id, {})[mv.month_no] = {
                    "be": float(mv.be_amount or 0),
                    "re": float(mv.re_amount or 0),
                    "actual": float(mv.actual_amount or 0),
                }
        return value_map, month_map

    base_values, _base_months = _values_map(base_rows)
    _be_values, be_months = _values_map(be_rows)
    _re_values, re_months = _values_map(re_rows)

    def _project_key(row: CapexPlanRow) -> tuple[str, int]:
        return ("scheme", int(row.scheme_id)) if row.scheme_id else ("row", int(row.id))

    def _monthly_by_project(rows, month_map, field: str):
        totals: dict[tuple[str, int], list[float]] = {}
        month_order = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3]
        for row in rows:
            key = _project_key(row)
            values = totals.setdefault(key, [0.0] * 12)
            for idx, month_no in enumerate(month_order):
                values[idx] += float(month_map.get(row.id, {}).get(month_no, {}).get(field, 0) or 0)
        return totals

    be_by_project = _monthly_by_project(be_rows, be_months, "be")
    re_by_project = _monthly_by_project(re_rows, re_months, "re")

    # Actuals can remain attached to BE rows after an RE plan is created. Query
    # every row participating in the FY and aggregate using the semantic scheme.
    all_rows_by_id = {r.id: r for r in [*base_rows, *be_rows, *re_rows]}
    all_row_ids = list(all_rows_by_id)
    actuals_by_project: dict[tuple[str, int], list[float]] = {}
    if all_row_ids:
        for actual in (
            db.query(CapexActual)
            .filter(
                CapexActual.plan_row_id.in_(all_row_ids),
                CapexActual.fy_year == fy_year,
            )
            .all()
        ):
            row = all_rows_by_id.get(actual.plan_row_id)
            if not row:
                continue
            key = _project_key(row)
            values = actuals_by_project.setdefault(key, [0.0] * 12)
            month_index = {4: 0, 5: 1, 6: 2, 7: 3, 8: 4, 9: 5, 10: 6, 11: 7, 12: 8, 1: 9, 2: 10, 3: 11}.get(actual.month_no)
            if month_index is not None:
                values[month_index] += float(actual.amount or 0)

    projects: dict[tuple[str, int], dict] = {}
    order_keys: list[tuple[str, int]] = []

    for row in base_rows:
        key = _project_key(row)
        if key not in projects:
            scheme = schemes.get(row.scheme_id) if row.scheme_id else None
            bucket = "Corporate AMR" if (scheme and (scheme.scheme_type or "").lower().startswith("corporate")) else "Plant Level AMR"
            label = scheme.scheme_name if scheme else row.row_name
            projects[key] = {
                "project_id": row.scheme_id or row.id,
                "label": label,
                "bucket": bucket,
                "gross_cost": 0.0,
                "expenditure_last_fy": 0.0,
                "months": [{"be": 0.0, "actual": 0.0, "re": None} for _ in range(12)],
            }
            for idx in range(12):
                projects[key]["months"][idx]["be"] = be_by_project.get(key, [0.0] * 12)[idx]
                re_value = re_by_project.get(key, [0.0] * 12)[idx]
                projects[key]["months"][idx]["re"] = re_value if key in re_by_project else None
                projects[key]["months"][idx]["actual"] = actuals_by_project.get(key, [0.0] * 12)[idx]
            order_keys.append(key)

        entry = projects[key]
        values = base_values.get(row.id)
        entry["gross_cost"] += float(values.gross_cost or 0) if values else 0.0
        entry["expenditure_last_fy"] += float(values.cumulative_exp_till_last_fy or 0) if values else 0.0

    return [projects[key] for key in order_keys]


# ---------------------------------------------------------------------------
# Deprecated
# ---------------------------------------------------------------------------
@router.post("/plan/save_hierarchy", deprecated=True)
def deprecated_save_hierarchy():
    raise HTTPException(
        status_code=410,
        detail="Removed in Sprint 15. Use POST/PUT /api/v1/capex/plans.",
    )
