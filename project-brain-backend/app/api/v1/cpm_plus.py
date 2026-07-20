"""P1 API — schedule baselines, variance, XER export.

  POST /cpm/baselines/{schedule_id}                 capture named baseline
  GET  /cpm/baselines/{schedule_id}                 list
  GET  /cpm/baselines/{schedule_id}/{baseline_id}/variance
  GET  /cpm/export-xer/{schedule_id}                Primavera P6 .xer download
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.security.auth import require_user
from app.services import cpm_baselines as CB

router = APIRouter(prefix="/cpm", tags=["CPM Baselines"],
                   dependencies=[Depends(require_user)])


def _raw_conn(db: Session):
    return db.connection().connection.driver_connection


class BaselineIn(BaseModel):
    name: str
    note: Optional[str] = None
    created_by: Optional[str] = None
    run_cpm_first: bool = True


@router.post("/baselines/{schedule_id}")
def capture(schedule_id: int, payload: BaselineIn, db: Session = Depends(get_db)):
    conn = _raw_conn(db)
    try:
        if payload.run_cpm_first:
            from app.services.cpm_engine import CPMEngine
            CPMEngine(schedule_id, conn).run()   # persists fresh early/late dates
        return CB.capture_baseline(conn, schedule_id, payload.name,
                                   payload.note, payload.created_by)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/baselines/{schedule_id}")
def baselines(schedule_id: int, db: Session = Depends(get_db)):
    return {"baselines": CB.list_baselines(_raw_conn(db), schedule_id)}


@router.get("/baselines/{schedule_id}/{baseline_id}/variance")
def baseline_variance(schedule_id: int, baseline_id: int,
                      recalculate: bool = True, db: Session = Depends(get_db)):
    conn = _raw_conn(db)
    try:
        if recalculate:
            from app.services.cpm_engine import CPMEngine
            CPMEngine(schedule_id, conn).run()
        return CB.variance(conn, schedule_id, baseline_id)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/export-xer/{schedule_id}")
def export_xer(schedule_id: int, db: Session = Depends(get_db)):
    conn = _raw_conn(db)
    try:
        content = CB.export_xer(conn, schedule_id)
    except ValueError as e:
        raise HTTPException(404, str(e))
    return Response(
        content, media_type="application/octet-stream",
        headers={"Content-Disposition":
                 f'attachment; filename="schedule_{schedule_id}.xer"'})
