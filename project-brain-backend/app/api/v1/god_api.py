"""
PROJECT BRAIN — GOD MODE API ENDPOINTS
"""

from datetime import date, datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, desc
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.god_models import (
    GodActivity as Activity, Appendix2, AuditLog, BillingSchedule, DailyActual,
    ExecutionChecklist, MonthlyPlan, Notification, Plan, PlanStatus, TOD,
)
from app.models.scheme import SchemeMaster
from app.utils.fy import (
    fy_label, fy_options, overall_progress, build_s_curve, classify_delay, variance,
)

router = APIRouter()


# ── PYDANTIC SCHEMAS ─────────────────────────────────────────────────────────

class PlanCreate(BaseModel):
    scheme_id: int
    plan_name: str
    financial_year: str
    plan_version: str = "Original Plan"
    plan_type: str = "BE"
    created_by: Optional[str] = None

class PlanActivate(BaseModel):
    plan_id: int

class PlanLock(BaseModel):
    plan_id: int

class ActivityCreate(BaseModel):
    scheme_id: int
    plan_id: Optional[int] = None
    activity_name: str
    uom: str = ""
    scope_qty: float = 0
    weightage: float = 10
    actuals_till_last_fy: float = 0
    start_date: Optional[date] = None
    finish_date: Optional[date] = None

class ActivityUpdate(BaseModel):
    activity_name: Optional[str] = None
    uom: Optional[str] = None
    scope_qty: Optional[float] = None
    weightage: Optional[float] = None
    actuals_till_last_fy: Optional[float] = None
    start_date: Optional[date] = None
    finish_date: Optional[date] = None

class MonthlyPlanEntry(BaseModel):
    activity_id: int
    plan_month: date
    planned_qty: float

class MonthlyPlanBulk(BaseModel):
    scheme_id: int
    entries: List[MonthlyPlanEntry]

class DailyActualEntry(BaseModel):
    activity_id: int
    actual_date: date
    actual_qty: float
    remarks: Optional[str] = None

class DPRSubmit(BaseModel):
    scheme_id: int
    submitted_by: str
    entries: List[DailyActualEntry]

class TODCreate(BaseModel):
    scheme_id: int
    tod_number: int
    expected_date: Optional[date] = None
    actual_date: Optional[date] = None
    tod_value_cr: Optional[float] = None
    remarks: Optional[str] = None

class BillingEntry(BaseModel):
    scheme_id: int
    billing_month: date
    planned_billing_cr: float = 0
    actual_billing_cr: float = 0
    remarks: Optional[str] = None

class MilestoneCreate(BaseModel):
    scheme_id: int
    milestone_name: str
    category: Optional[str] = None
    planned_date: Optional[date] = None
    responsible_person: Optional[str] = None

class MilestoneUpdate(BaseModel):
    actual_date: Optional[date] = None
    is_completed: Optional[bool] = None
    completion_pct: Optional[float] = None
    remarks: Optional[str] = None

class Appendix2Entry(BaseModel):
    s_no: str = ""
    category: str = ""
    item: str = ""
    commencement_months: Optional[int] = None
    completion_months: Optional[int] = None
    schedule_start: Optional[date] = None
    schedule_finish: Optional[date] = None

class Appendix2Bulk(BaseModel):
    scheme_id: int
    rows: List[Appendix2Entry]


# ── PLAN MANAGEMENT ──────────────────────────────────────────────────────────

@router.get("/plans/fy-options", tags=["Plans"])
def get_fy_options():
    return {"options": fy_options(5), "current": fy_label()}


@router.post("/plans/create", tags=["Plans"])
def create_plan(payload: PlanCreate, db: Session = Depends(get_db)):
    existing = db.query(Plan).filter(
        Plan.scheme_id == payload.scheme_id,
        Plan.plan_name == payload.plan_name,
    ).first()
    if existing:
        raise HTTPException(400, "Plan name already exists for this scheme")
    plan = Plan(**payload.dict())
    db.add(plan)
    db.commit()
    db.refresh(plan)
    return {"plan_id": plan.id, "message": f"Plan '{plan.plan_name}' created"}


@router.get("/plans/{scheme_id}", tags=["Plans"])
def get_plans(scheme_id: int, db: Session = Depends(get_db)):
    plans = db.query(Plan).filter(Plan.scheme_id == scheme_id).order_by(Plan.created_at.desc()).all()
    return [
        {
            "id": p.id,
            "plan_name": p.plan_name,
            "financial_year": p.financial_year,
            "plan_version": p.plan_version,
            "plan_type": p.plan_type,
            "status": p.status,
            "is_locked": p.is_locked,
            "created_at": p.created_at,
        }
        for p in plans
    ]


@router.put("/plans/activate", tags=["Plans"])
def activate_plan(payload: PlanActivate, db: Session = Depends(get_db)):
    plan = db.query(Plan).get(payload.plan_id)
    if not plan:
        raise HTTPException(404, "Plan not found")
    db.query(Plan).filter(
        Plan.scheme_id == plan.scheme_id,
        Plan.id != plan.id,
    ).update({"status": PlanStatus.SUPERSEDED.value})
    plan.status = PlanStatus.ACTIVE.value
    db.commit()
    return {"message": f"Plan '{plan.plan_name}' is now active"}


@router.put("/plans/lock", tags=["Plans"])
def lock_plan(payload: PlanLock, db: Session = Depends(get_db)):
    plan = db.query(Plan).get(payload.plan_id)
    if not plan:
        raise HTTPException(404, "Plan not found")
    plan.is_locked = True
    plan.status = PlanStatus.LOCKED.value
    plan.locked_at = datetime.utcnow()
    db.commit()
    return {"message": f"Plan '{plan.plan_name}' locked"}


# ── ACTIVITIES ────────────────────────────────────────────────────────────────

@router.post("/activities/create", tags=["Activities"])
def create_activity(payload: ActivityCreate, db: Session = Depends(get_db)):
    act = Activity(**payload.dict())
    db.add(act)
    db.commit()
    db.refresh(act)
    return {"activity_id": act.id}


@router.get("/activities/{scheme_id}", tags=["Activities"])
def get_activities(scheme_id: int, plan_id: Optional[int] = None, db: Session = Depends(get_db)):
    q = db.query(Activity).filter(Activity.scheme_id == scheme_id)
    if plan_id:
        q = q.filter(Activity.plan_id == plan_id)
    activities = q.order_by(Activity.display_order).all()

    result = []
    for act in activities:
        total_actual = db.query(func.sum(DailyActual.actual_qty)).filter(
            DailyActual.activity_id == act.id
        ).scalar() or 0

        scope = act.scope_qty or 0
        cum = (act.actuals_till_last_fy or 0) + total_actual
        pct = round((cum / scope * 100), 2) if scope > 0 else 0

        result.append({
            "id": act.id,
            "activity_name": act.activity_name,
            "uom": act.uom,
            "scope_qty": scope,
            "weightage": act.weightage,
            "actuals_till_last_fy": act.actuals_till_last_fy,
            "current_fy_actual": total_actual,
            "cumulative": cum,
            "progress_pct": pct,
            "start_date": act.start_date,
            "finish_date": act.finish_date,
        })
    return result


@router.put("/activities/{activity_id}", tags=["Activities"])
def update_activity(activity_id: int, payload: ActivityUpdate, db: Session = Depends(get_db)):
    act = db.query(Activity).get(activity_id)
    if not act:
        raise HTTPException(404, "Activity not found")
    for k, v in payload.dict(exclude_unset=True).items():
        setattr(act, k, v)
    db.commit()
    return {"message": "Activity updated"}


@router.delete("/activities/{activity_id}", tags=["Activities"])
def delete_activity(activity_id: int, db: Session = Depends(get_db)):
    act = db.query(Activity).get(activity_id)
    if not act:
        raise HTTPException(404, "Activity not found")
    db.delete(act)
    db.commit()
    return {"message": "Activity deleted"}


# ── MONTHLY PLANS ─────────────────────────────────────────────────────────────

@router.post("/monthly-plans/save", tags=["Monthly Plans"])
def save_monthly_plans(payload: MonthlyPlanBulk, db: Session = Depends(get_db)):
    for entry in payload.entries:
        existing = db.query(MonthlyPlan).filter(
            MonthlyPlan.activity_id == entry.activity_id,
            MonthlyPlan.plan_month == entry.plan_month,
        ).first()
        if existing:
            existing.planned_qty = entry.planned_qty
        else:
            mp = MonthlyPlan(
                activity_id=entry.activity_id,
                scheme_id=payload.scheme_id,
                plan_month=entry.plan_month,
                planned_qty=entry.planned_qty,
            )
            db.add(mp)
    db.commit()
    return {"message": f"Saved {len(payload.entries)} entries"}


@router.get("/monthly-plans/{scheme_id}", tags=["Monthly Plans"])
def get_monthly_plans(scheme_id: int, db: Session = Depends(get_db)):
    plans = db.query(MonthlyPlan).filter(MonthlyPlan.scheme_id == scheme_id).order_by(MonthlyPlan.plan_month).all()
    return [{"id": p.id, "activity_id": p.activity_id, "plan_month": p.plan_month, "planned_qty": p.planned_qty} for p in plans]


# ── DAILY ACTUALS / DPR ───────────────────────────────────────────────────────

@router.post("/daily-actuals/submit", tags=["DPR"])
def submit_daily_actuals(payload: DPRSubmit, db: Session = Depends(get_db)):
    for entry in payload.entries:
        da = DailyActual(
            activity_id=entry.activity_id,
            scheme_id=payload.scheme_id,
            actual_date=entry.actual_date,
            actual_qty=entry.actual_qty,
            remarks=entry.remarks,
            submitted_by=payload.submitted_by,
        )
        db.add(da)
    db.commit()
    return {"message": f"DPR submitted: {len(payload.entries)} entries"}


@router.get("/daily-actuals/{scheme_id}", tags=["DPR"])
def get_daily_actuals(
    scheme_id: int,
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    db: Session = Depends(get_db),
):
    q = db.query(DailyActual).filter(DailyActual.scheme_id == scheme_id)
    if from_date:
        q = q.filter(DailyActual.actual_date >= from_date)
    if to_date:
        q = q.filter(DailyActual.actual_date <= to_date)
    rows = q.order_by(desc(DailyActual.actual_date)).limit(500).all()
    return [
        {
            "id": r.id,
            "activity_id": r.activity_id,
            "actual_date": r.actual_date,
            "actual_qty": r.actual_qty,
            "remarks": r.remarks,
            "submitted_by": r.submitted_by,
        }
        for r in rows
    ]


# ── VARIANCE ANALYSIS ─────────────────────────────────────────────────────────

@router.get("/progress-analysis/{scheme_id}", tags=["Analysis"])
def get_progress_analysis(scheme_id: int, db: Session = Depends(get_db)):
    activities = db.query(Activity).filter(Activity.scheme_id == scheme_id).all()
    if not activities:
        raise HTTPException(404, "No activities found for this scheme")

    activity_data = []
    for act in activities:
        total_planned = db.query(func.sum(MonthlyPlan.planned_qty)).filter(
            MonthlyPlan.activity_id == act.id
        ).scalar() or 0
        total_actual = db.query(func.sum(DailyActual.actual_qty)).filter(
            DailyActual.activity_id == act.id
        ).scalar() or 0

        scope = act.scope_qty or 0
        cum_actual = (act.actuals_till_last_fy or 0) + total_actual
        v_pct, v_status = variance(total_planned, cum_actual, scope)

        activity_data.append({
            "activity_id": act.id,
            "activity_name": act.activity_name,
            "uom": act.uom,
            "scope_qty": scope,
            "weightage": act.weightage,
            "planned_qty": total_planned,
            "actual_qty": cum_actual,
            "planned_pct": round((total_planned / scope * 100), 2) if scope > 0 else 0,
            "actual_pct": round((cum_actual / scope * 100), 2) if scope > 0 else 0,
            "variance_pct": v_pct,
            "status": v_status,
        })

    op = overall_progress([
        {"scope_qty": a["scope_qty"], "weightage": a["weightage"],
         "planned_qty": a["planned_qty"], "actuals_till_last_fy": 0, "current_fy_actual": a["actual_qty"]}
        for a in activity_data
    ])
    return {
        "scheme_id": scheme_id,
        "overall": op,
        "activities": activity_data,
        "behind_count": sum(1 for a in activity_data if a["status"] == "Behind"),
        "on_track_count": sum(1 for a in activity_data if a["status"] == "On Track"),
        "ahead_count": sum(1 for a in activity_data if a["status"] == "Ahead"),
    }


# ── S-CURVE ───────────────────────────────────────────────────────────────────

@router.get("/s-curve-data/{scheme_id}", tags=["S-Curve"])
def get_s_curve_data(scheme_id: int, db: Session = Depends(get_db)):
    activities = db.query(Activity).filter(Activity.scheme_id == scheme_id).all()
    if not activities:
        return {"points": [], "total_scope": 0}

    total_scope = sum((a.scope_qty or 0) * (a.weightage or 0) / 100 for a in activities)
    act_ids = [a.id for a in activities]

    planned_rows = (
        db.query(MonthlyPlan.plan_month, func.sum(MonthlyPlan.planned_qty))
        .filter(MonthlyPlan.activity_id.in_(act_ids))
        .group_by(MonthlyPlan.plan_month)
        .order_by(MonthlyPlan.plan_month)
        .all()
    )
    monthly_planned = {r[0].strftime("%b-%y"): r[1] for r in planned_rows}

    actual_rows = (
        db.query(
            func.date_trunc("month", DailyActual.actual_date).label("m"),
            func.sum(DailyActual.actual_qty),
        )
        .filter(DailyActual.activity_id.in_(act_ids))
        .group_by("m")
        .order_by("m")
        .all()
    )
    monthly_actual = {r[0].strftime("%b-%y"): r[1] for r in actual_rows}

    points = build_s_curve(monthly_planned, monthly_actual, total_scope if total_scope > 0 else 1)
    return {"points": points, "total_scope": total_scope}


# ── DASHBOARD ─────────────────────────────────────────────────────────────────

@router.get("/dashboard/summary", tags=["Dashboard"])
def dashboard_summary(db: Session = Depends(get_db)):
    total = db.query(func.count(SchemeMaster.id)).filter(SchemeMaster.is_active == True).scalar()
    by_status = (
        db.query(SchemeMaster.status, func.count(SchemeMaster.id))
        .filter(SchemeMaster.is_active == True)
        .group_by(SchemeMaster.status)
        .all()
    )
    by_type = (
        db.query(SchemeMaster.scheme_type, func.count(SchemeMaster.id))
        .filter(SchemeMaster.is_active == True)
        .group_by(SchemeMaster.scheme_type)
        .all()
    )
    total_cost = db.query(func.sum(SchemeMaster.total_cost)).filter(SchemeMaster.is_active == True).scalar() or 0

    schemes = db.query(SchemeMaster).filter(
        SchemeMaster.is_active == True,
        SchemeMaster.status == "ongoing",
    ).all()
    delays = [classify_delay(s.scheduled_completion, s.expected_completion) for s in schemes]
    delay_summary = {
        "on_time": sum(1 for d in delays if d["delay_category"] == "On Time"),
        "minor": sum(1 for d in delays if d["delay_category"] == "Minor Delay"),
        "moderate": sum(1 for d in delays if d["delay_category"] == "Moderate Delay"),
        "critical": sum(1 for d in delays if d["delay_category"] == "Critical Delay"),
    }

    return {
        "total_schemes": total,
        "total_cost_cr": round(total_cost, 2),
        "by_status": {str(s): c for s, c in by_status},
        "by_type": {str(t): c for t, c in by_type},
        "delay_summary": delay_summary,
        "current_fy": fy_label(),
    }


@router.get("/dashboard/scheme-cards", tags=["Dashboard"])
def dashboard_scheme_cards(db: Session = Depends(get_db)):
    schemes = (
        db.query(SchemeMaster)
        .filter(SchemeMaster.is_active == True)
        .filter(SchemeMaster.status.in_(["ongoing", "under_stage2"]))
        .order_by(SchemeMaster.scheme_name)
        .all()
    )
    cards = []
    for s in schemes:
        delay = classify_delay(s.scheduled_completion, s.expected_completion)
        cards.append({
            "id": s.id,
            "name": s.scheme_name,
            "type": str(s.scheme_type).replace("SchemeType.", ""),
            "status": str(s.status).replace("SchemeStatus.", ""),
            "cost_cr": s.total_cost,
            "scheduled_completion": s.scheduled_completion.strftime("%d %b %Y") if s.scheduled_completion else None,
            "expected_completion": s.expected_completion.strftime("%d %b %Y") if s.expected_completion else None,
            "delay": delay,
        })
    return cards


# ── TOD ───────────────────────────────────────────────────────────────────────

@router.post("/tods/create", tags=["TOD"])
def create_tod(payload: TODCreate, db: Session = Depends(get_db)):
    tod = TOD(**payload.dict())
    db.add(tod)
    db.commit()
    db.refresh(tod)
    return {"tod_id": tod.id}


@router.get("/tods/{scheme_id}", tags=["TOD"])
def get_tods(scheme_id: int, db: Session = Depends(get_db)):
    tods = db.query(TOD).filter(TOD.scheme_id == scheme_id).order_by(TOD.tod_number).all()
    return [
        {
            "id": t.id,
            "tod_number": t.tod_number,
            "expected_date": t.expected_date,
            "actual_date": t.actual_date,
            "tod_value_cr": t.tod_value_cr,
            "remarks": t.remarks,
            "is_received": t.is_received,
        }
        for t in tods
    ]


@router.put("/tods/{tod_id}/receive", tags=["TOD"])
def mark_tod_received(tod_id: int, actual_date: date, db: Session = Depends(get_db)):
    tod = db.query(TOD).get(tod_id)
    if not tod:
        raise HTTPException(404, "TOD not found")
    tod.actual_date = actual_date
    tod.is_received = True
    db.commit()
    return {"message": f"TOD-{tod.tod_number} marked as received"}


# ── BILLING ───────────────────────────────────────────────────────────────────

@router.post("/billing/save", tags=["Billing"])
def save_billing(payload: BillingEntry, db: Session = Depends(get_db)):
    existing = db.query(BillingSchedule).filter(
        BillingSchedule.scheme_id == payload.scheme_id,
        BillingSchedule.billing_month == payload.billing_month,
    ).first()
    if existing:
        existing.planned_billing_cr = payload.planned_billing_cr
        existing.actual_billing_cr = payload.actual_billing_cr
        existing.remarks = payload.remarks
    else:
        bs = BillingSchedule(**payload.dict())
        db.add(bs)
    db.commit()
    return {"message": "Billing saved"}


@router.get("/billing/{scheme_id}", tags=["Billing"])
def get_billing(scheme_id: int, db: Session = Depends(get_db)):
    rows = db.query(BillingSchedule).filter(BillingSchedule.scheme_id == scheme_id).order_by(BillingSchedule.billing_month).all()
    cum = 0.0
    result = []
    for r in rows:
        cum += r.actual_billing_cr or 0
        result.append({
            "id": r.id,
            "billing_month": r.billing_month,
            "planned": r.planned_billing_cr,
            "actual": r.actual_billing_cr,
            "cumulative": round(cum, 2),
            "remarks": r.remarks,
        })
    return result


# ── EXECUTION CHECKLIST ───────────────────────────────────────────────────────

@router.post("/execution/create-from-template", tags=["Execution"])
def create_execution_from_template(scheme_id: int, db: Session = Depends(get_db)):
    from sqlalchemy import text
    template = db.execute(text("SELECT * FROM execution_template ORDER BY display_order")).fetchall()
    count = 0
    for row in template:
        ec = ExecutionChecklist(
            scheme_id=scheme_id,
            milestone_name=row.milestone_name,
            category=row.category,
            display_order=row.display_order,
        )
        db.add(ec)
        count += 1
    db.commit()
    return {"message": f"Created {count} milestones from template"}


@router.get("/execution/{scheme_id}", tags=["Execution"])
def get_execution(scheme_id: int, db: Session = Depends(get_db)):
    rows = (
        db.query(ExecutionChecklist)
        .filter(ExecutionChecklist.scheme_id == scheme_id)
        .order_by(ExecutionChecklist.display_order)
        .all()
    )
    return [
        {
            "id": r.id,
            "milestone_name": r.milestone_name,
            "category": r.category,
            "planned_date": r.planned_date,
            "actual_date": r.actual_date,
            "is_completed": r.is_completed,
            "completion_pct": r.completion_pct,
            "responsible_person": r.responsible_person,
            "remarks": r.remarks,
            "display_order": r.display_order,
        }
        for r in rows
    ]


@router.put("/execution/{milestone_id}", tags=["Execution"])
def update_milestone(milestone_id: int, payload: MilestoneUpdate, db: Session = Depends(get_db)):
    m = db.query(ExecutionChecklist).get(milestone_id)
    if not m:
        raise HTTPException(404, "Milestone not found")
    for k, v in payload.dict(exclude_unset=True).items():
        setattr(m, k, v)
    m.updated_at = datetime.utcnow()
    db.commit()
    return {"message": "Milestone updated"}


@router.post("/execution/add", tags=["Execution"])
def add_milestone(payload: MilestoneCreate, db: Session = Depends(get_db)):
    m = ExecutionChecklist(**payload.dict())
    db.add(m)
    db.commit()
    db.refresh(m)
    return {"milestone_id": m.id}


# ── APPENDIX-II ───────────────────────────────────────────────────────────────

@router.get("/appendix2/{scheme_id}", tags=["Appendix"])
def get_appendix2(scheme_id: int, db: Session = Depends(get_db)):
    rows = db.query(Appendix2).filter(Appendix2.scheme_id == scheme_id).order_by(Appendix2.display_order).all()
    return [
        {"id": r.id, "s_no": r.s_no, "category": r.category, "item": r.item,
         "commencement_months": r.commencement_months, "completion_months": r.completion_months,
         "schedule_start": r.schedule_start, "schedule_finish": r.schedule_finish}
        for r in rows
    ]


@router.post("/appendix2/save", tags=["Appendix"])
def save_appendix2(payload: Appendix2Bulk, db: Session = Depends(get_db)):
    db.query(Appendix2).filter(Appendix2.scheme_id == payload.scheme_id).delete()
    for i, row in enumerate(payload.rows):
        a = Appendix2(scheme_id=payload.scheme_id, display_order=i, **row.dict())
        db.add(a)
    db.commit()
    return {"message": f"Saved {len(payload.rows)} appendix rows"}


# ── NOTIFICATIONS ─────────────────────────────────────────────────────────────

@router.get("/notifications", tags=["Notifications"])
def get_notifications(user_id: Optional[int] = None, unread_only: bool = True, db: Session = Depends(get_db)):
    q = db.query(Notification)
    if user_id:
        q = q.filter(Notification.user_id == user_id)
    if unread_only:
        q = q.filter(Notification.is_read == False)
    rows = q.order_by(desc(Notification.created_at)).limit(50).all()
    return [{"id": r.id, "title": r.title, "message": r.message, "type": r.notification_type, "link": r.link} for r in rows]


@router.put("/notifications/{notif_id}/read", tags=["Notifications"])
def mark_read(notif_id: int, db: Session = Depends(get_db)):
    n = db.query(Notification).get(notif_id)
    if n:
        n.is_read = True
        db.commit()
    return {"ok": True}
