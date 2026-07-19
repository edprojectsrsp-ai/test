"""QSRA API — Monte Carlo schedule risk.

  GET  /qsra/{schedule_id}/estimates       activities + 3-point estimates (defaults shown)
  PUT  /qsra/{schedule_id}/estimates       bulk upsert 3-point estimates
  POST /qsra/{schedule_id}/run             run simulation (result + stored summary)
  GET  /qsra/{schedule_id}/history         past run summaries (P80 trend)
"""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.security.auth import require_user

router = APIRouter(prefix="/qsra", tags=["QSRA"], dependencies=[Depends(require_user)])


def _raw_conn(db: Session):
    return db.connection().connection.driver_connection


def _ensure_tables(db: Session) -> None:
    db.execute(text(
        "CREATE TABLE IF NOT EXISTS cpm_risk_estimates ("
        " activity_id INTEGER PRIMARY KEY,"
        " optimistic_days NUMERIC(10,2), most_likely_days NUMERIC(10,2),"
        " pessimistic_days NUMERIC(10,2), note TEXT,"
        " updated_by VARCHAR(100), updated_at TIMESTAMPTZ NOT NULL DEFAULT now())"))
    db.execute(text(
        "CREATE TABLE IF NOT EXISTS qsra_runs ("
        " run_id SERIAL PRIMARY KEY, schedule_id INTEGER NOT NULL,"
        " iterations INTEGER NOT NULL, seed BIGINT,"
        " deterministic_finish DATE, p50_finish DATE, p80_finish DATE, p90_finish DATE,"
        " prob_meet_det_pct NUMERIC(6,2), std_dev_days NUMERIC(10,1),"
        " run_by VARCHAR(100), created_at TIMESTAMPTZ NOT NULL DEFAULT now())"))
    db.commit()


class EstimateIn(BaseModel):
    activity_id: int
    optimistic_days: Optional[float] = None
    most_likely_days: Optional[float] = None
    pessimistic_days: Optional[float] = None
    note: Optional[str] = None


class EstimatesIn(BaseModel):
    estimates: list[EstimateIn]


class RunIn(BaseModel):
    iterations: int = 2000
    seed: Optional[int] = None
    default_optimistic_pct: float = 90.0
    default_pessimistic_pct: float = 130.0


@router.get("/{schedule_id}/estimates")
def get_estimates(schedule_id: int, db: Session = Depends(get_db)):
    _ensure_tables(db)
    rows = db.execute(text("""
        SELECT a.activity_id, a.activity_code, a.activity_name,
               COALESCE(a.estimated_duration_days, a.planned_duration_days,
                        a.baseline_duration_days, 0) AS deterministic_days,
               a.activity_status::text AS status,
               e.optimistic_days, e.most_likely_days, e.pessimistic_days, e.note
        FROM cpm_activities a
        LEFT JOIN cpm_risk_estimates e ON e.activity_id = a.activity_id
        WHERE a.schedule_id = :s AND NOT a.is_deleted
        ORDER BY a.activity_id
    """), {"s": schedule_id}).mappings().all()
    return {"schedule_id": schedule_id, "activities": [dict(r) for r in rows]}


@router.put("/{schedule_id}/estimates")
def put_estimates(schedule_id: int, payload: EstimatesIn, db: Session = Depends(get_db)):
    _ensure_tables(db)
    valid = {int(r[0]) for r in db.execute(text(
        "SELECT activity_id FROM cpm_activities WHERE schedule_id = :s AND NOT is_deleted"),
        {"s": schedule_id}).all()}
    n = 0
    for e in payload.estimates:
        if e.activity_id not in valid:
            raise HTTPException(400, f"Activity {e.activity_id} not in schedule {schedule_id}")
        o, m, p = e.optimistic_days, e.most_likely_days, e.pessimistic_days
        if o is not None and m is not None and o > m:
            raise HTTPException(400, f"Activity {e.activity_id}: optimistic > most likely")
        if p is not None and m is not None and p < m:
            raise HTTPException(400, f"Activity {e.activity_id}: pessimistic < most likely")
        db.execute(text("""
            INSERT INTO cpm_risk_estimates
              (activity_id, optimistic_days, most_likely_days, pessimistic_days, note, updated_at)
            VALUES (:a, :o, :m, :p, :n, now())
            ON CONFLICT (activity_id) DO UPDATE SET
              optimistic_days = EXCLUDED.optimistic_days,
              most_likely_days = EXCLUDED.most_likely_days,
              pessimistic_days = EXCLUDED.pessimistic_days,
              note = EXCLUDED.note, updated_at = now()
        """), {"a": e.activity_id, "o": o, "m": m, "p": p, "n": e.note})
        n += 1
    db.commit()
    return {"updated": n}


@router.post("/{schedule_id}/run")
def run(schedule_id: int, payload: RunIn, db: Session = Depends(get_db)):
    _ensure_tables(db)
    from app.services.qsra_engine import QSRAEngine
    try:
        result = QSRAEngine(
            schedule_id, _raw_conn(db),
            iterations=payload.iterations, seed=payload.seed,
            default_optimistic_pct=payload.default_optimistic_pct,
            default_pessimistic_pct=payload.default_pessimistic_pct,
        ).run()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"QSRA failed: {str(e)[:300]}")
    if result.get("error"):
        raise HTTPException(status_code=400, detail=result["error"])
    db.execute(text("""
        INSERT INTO qsra_runs (schedule_id, iterations, seed, deterministic_finish,
                               p50_finish, p80_finish, p90_finish,
                               prob_meet_det_pct, std_dev_days)
        VALUES (:s, :i, :seed, :det, :p50, :p80, :p90, :prob, :std)
    """), {"s": schedule_id, "i": result["iterations"], "seed": payload.seed,
           "det": result["deterministic_finish"],
           "p50": result["percentiles"]["p50"], "p80": result["percentiles"]["p80"],
           "p90": result["percentiles"]["p90"],
           "prob": result["prob_meet_deterministic"], "std": result["std_dev_days"]})
    db.commit()
    return result


@router.get("/{schedule_id}/history")
def history(schedule_id: int, db: Session = Depends(get_db)):
    _ensure_tables(db)
    rows = db.execute(text(
        "SELECT * FROM qsra_runs WHERE schedule_id = :s ORDER BY created_at DESC LIMIT 50"),
        {"s": schedule_id}).mappings().all()
    return {"runs": [dict(r) for r in rows]}
