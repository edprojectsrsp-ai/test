"""CPM-driven delay analysis — retrospective attribution + prospective TIA/EOT.

Runs on the *real* CPM network (cpm_activities + cpm_dependencies, imported from
P6 .xer / MS-Project .mpp / .csv), so criticality and float are computed by the
forward/backward pass in cpm_engine — not inferred from discipline ordering.

  GET  /cpm-delay/{schedule_id}/attribution   retrospective: baseline vs actual
        slips, which are on the critical path (driving the project finish) vs
        absorbed by float, party attribution, and the total project slip.

  POST /cpm-delay/{schedule_id}/tia           prospective Time Impact Analysis:
        insert a delay (fragnet) of N days on one activity at the data date,
        recompute the network non-destructively, and return the forecast finish
        shift = Extension of Time (EOT) entitlement.
"""
from __future__ import annotations

import os
from datetime import date
from typing import Optional

import psycopg2
import psycopg2.extras
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.services.cpm_engine import CPMEngine, run_cpm, _date_diff_days

router = APIRouter(prefix="/cpm-delay", tags=["CPM Delay Analysis"])

DB_URL = os.environ.get("PROJECT_BRAIN_DB_URL",
                        "postgresql://postgres:postgres@127.0.0.1:5432/project_brain")


def _schedule(db: Session, schedule_id: int) -> dict:
    row = db.execute(text(
        "SELECT schedule_id, schedule_name, package_id, data_date, project_finish_date "
        "FROM cpm_schedules WHERE schedule_id=:s AND NOT is_deleted"
    ), {"s": schedule_id}).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Schedule not found")
    return dict(row)


# --------------------------------------------------------------------------- #
#  Retrospective — critical-path delay attribution                            #
# --------------------------------------------------------------------------- #
@router.get("/{schedule_id}/attribution")
def attribution(schedule_id: int, db: Session = Depends(get_db)):
    sched = _schedule(db, schedule_id)
    # Refresh CPM so is_critical / total_float reflect current durations & logic.
    cpm = run_cpm(schedule_id, DB_URL)
    if cpm.get("error"):
        raise HTTPException(status_code=400, detail=cpm["error"])

    rows = db.execute(text("""
        SELECT a.activity_id, a.activity_code, a.activity_name,
               a.activity_status::text AS status,
               a.baseline_finish_date, a.actual_finish_date, a.forecast_finish_date,
               a.early_finish_date, a.is_critical, a.total_float_days,
               a.physical_pct_complete,
               da.delay_cause, da.delay_attributable_to, da.cost_impact_cr, da.remarks
        FROM cpm_activities a
        LEFT JOIN LATERAL (
            SELECT delay_cause, delay_attributable_to, cost_impact_cr, remarks
            FROM cpm_delay_analysis d WHERE d.activity_id = a.activity_id
            ORDER BY d.analysis_date DESC LIMIT 1
        ) da ON TRUE
        WHERE a.schedule_id = :s AND NOT a.is_deleted
        ORDER BY a.early_finish_date NULLS LAST, a.activity_id
    """), {"s": schedule_id}).mappings().all()

    activities, driving, absorbed = [], [], []
    party_days: dict[str, float] = {}
    for r in rows:
        bl = r["baseline_finish_date"]
        cur_finish = r["actual_finish_date"] or r["forecast_finish_date"] or r["early_finish_date"]
        slip = _date_diff_days(cur_finish, bl) if (bl and cur_finish) else 0.0
        slip = round(slip, 1)
        flt = float(r["total_float_days"] or 0)
        crit = bool(r["is_critical"])
        # A slip drives the project when it is on the critical path, or when it
        # exceeds the activity's available float (thereby becoming critical).
        is_driving = slip > 0 and (crit or slip > flt)
        item = {
            "activity_id": r["activity_id"], "activity_code": r["activity_code"],
            "activity_name": r["activity_name"], "status": r["status"],
            "baseline_finish": bl.isoformat() if bl else None,
            "current_finish": cur_finish.isoformat() if cur_finish else None,
            "slip_days": slip, "total_float_days": flt, "is_critical": crit,
            "driving": is_driving,
            "pct_complete": float(r["physical_pct_complete"] or 0),
            "party": r["delay_attributable_to"], "cause": r["delay_cause"],
            "cost_impact_cr": float(r["cost_impact_cr"]) if r["cost_impact_cr"] is not None else None,
            "remarks": r["remarks"],
        }
        activities.append(item)
        if is_driving:
            driving.append(item)
            party = (r["delay_attributable_to"] or "unattributed").lower()
            party_days[party] = round(party_days.get(party, 0.0) + slip, 1)
        elif slip > 0:
            absorbed.append(item)

    # project-level slip: baseline project finish vs current forecast finish
    baseline_finish = max([r["baseline_finish_date"] for r in rows if r["baseline_finish_date"]], default=None)
    forecast_finish = cpm.get("project_finish")
    project_slip = None
    if baseline_finish and forecast_finish:
        project_slip = round(_date_diff_days(date.fromisoformat(forecast_finish), baseline_finish), 1)

    driving.sort(key=lambda x: x["slip_days"], reverse=True)
    narrative = _attribution_narrative(project_slip, driving, party_days, forecast_finish)

    return {
        "schedule_id": schedule_id, "schedule_name": sched["schedule_name"],
        "project": {
            "baseline_finish": baseline_finish.isoformat() if baseline_finish else None,
            "forecast_finish": forecast_finish,
            "project_slip_days": project_slip,
            "critical_path": cpm.get("critical_path", []),
        },
        "party_days": party_days,
        "driving_delays": driving,
        "absorbed_delays": absorbed,
        "activities": activities,
        "narrative": narrative,
    }


def _attribution_narrative(project_slip, driving, party_days, forecast_finish) -> list[str]:
    out = []
    if project_slip is None:
        out.append("Set a baseline (POST /cpm/baseline/save) to measure slip against.")
        return out
    if project_slip <= 0:
        out.append("Project is tracking on or ahead of the baseline finish.")
    else:
        out.append(f"Forecast finish {forecast_finish} — the project is *{project_slip:g} day(s)* "
                   f"behind the baseline.")
    if driving:
        top = driving[0]
        out.append(f"The largest critical-path driver is *{top['activity_name']}* "
                   f"(+{top['slip_days']:g}d, {top['party'] or 'unattributed'}).")
    if party_days:
        parts = ", ".join(f"{k} {v:g}d" for k, v in sorted(party_days.items(), key=lambda x: -x[1]))
        out.append(f"Critical-path slip by party: {parts}.")
    return out


# --------------------------------------------------------------------------- #
#  Prospective — Time Impact Analysis / EOT                                    #
# --------------------------------------------------------------------------- #
class TIAIn(BaseModel):
    activity_id: Optional[int] = None
    activity_code: Optional[str] = None
    added_days: float
    description: Optional[str] = None


@router.post("/{schedule_id}/tia")
def time_impact_analysis(schedule_id: int, payload: TIAIn, db: Session = Depends(get_db)):
    _schedule(db, schedule_id)
    if payload.added_days <= 0:
        raise HTTPException(status_code=400, detail="added_days must be positive")

    conn = psycopg2.connect(DB_URL)
    try:
        engine = CPMEngine(schedule_id, conn)
        engine.load()
        if not engine.activities:
            raise HTTPException(status_code=400, detail="Schedule has no activities")

        # locate the target activity
        target = None
        for a in engine.activities.values():
            if (payload.activity_id and a.activity_id == payload.activity_id) or \
               (payload.activity_code and a.activity_code == payload.activity_code):
                target = a
                break
        if not target:
            raise HTTPException(status_code=404, detail="Target activity not found in schedule")

        # baseline forecast (before the impact)
        engine.forward_pass()
        before_finish = engine.project_finish
        target_float = None
        # need late dates for the target's float → full pass once
        engine.backward_pass()
        engine.compute_float()
        target_float = target.total_float

        # apply the fragnet non-destructively and re-run the forward pass
        target.duration += float(payload.added_days)
        engine.forward_pass()
        after_finish = engine.project_finish

        eot = round(_date_diff_days(after_finish, before_finish), 1)
        absorbed = round(float(payload.added_days) - eot, 1)
        is_critical = eot > 0
    finally:
        conn.close()

    return {
        "schedule_id": schedule_id,
        "target": {"activity_id": target.activity_id, "activity_code": target.activity_code,
                   "activity_name": target.activity_name, "total_float_days": target_float},
        "added_days": payload.added_days,
        "forecast_finish_before": before_finish.isoformat() if before_finish else None,
        "forecast_finish_after": after_finish.isoformat() if after_finish else None,
        "eot_days": eot,
        "absorbed_by_float_days": max(0.0, absorbed),
        "is_on_critical_path": is_critical,
        "narrative": (
            f"A {payload.added_days:g}-day delay on {target.activity_name} "
            + (f"entitles *{eot:g} day(s)* Extension of Time — it drives the project finish "
               f"from {before_finish} to {after_finish}."
               if is_critical else
               f"is fully absorbed by {target_float:g} day(s) of float — no Extension of Time.")
        ),
    }
