"""
FastAPI routes. Grouped by capability; each delegates to the service layer or
an engine. Bodies are intentionally compact — the heavy logic lives in core/.
"""
from __future__ import annotations

from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import text as sql_text
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_session
from ..services import cpm_service
from ..importers.xer_importer import parse_xer
from ..importers.msp_importer import parse_msp_xml, parse_mpp, MPPImportError
from ..core.cpm import CPMEngine
from ..core.alerts import generate_alerts
from fastapi.responses import FileResponse
import tempfile, os

router = APIRouter(prefix="/api/scheduling", tags=["scheduling"])

_MEDIA = {
    "csv": "text/csv",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "pdf": "application/pdf",
}


# ---- schemas ---------------------------------------------------------------
class ProjectIn(BaseModel):
    name: str
    code: Optional[str] = None
    start_date: Optional[date] = None
    data_date: Optional[date] = None


class ActivityIn(BaseModel):
    code: str
    name: str
    duration: int = 0
    is_milestone: bool = False
    wbs_code: Optional[str] = None
    constraint_type: str = "NONE"
    constraint_date: Optional[date] = None


class ProgressIn(BaseModel):
    actual_start: Optional[date] = None
    actual_finish: Optional[date] = None
    percent_complete: Optional[float] = None
    remaining_duration: Optional[int] = None
    remarks: Optional[str] = None
    changed_by: Optional[str] = None


# ---- projects --------------------------------------------------------------
@router.get("/projects")
async def list_projects(s: AsyncSession = Depends(get_session)):
    rows = (await s.execute(sql_text("""
        SELECT id, name, code, start_date, data_date
        FROM projects
        ORDER BY id DESC
    """))).mappings().all()
    return [{"id": str(r["id"]), "name": r["name"], "code": r["code"],
             "start_date": r["start_date"].isoformat() if r["start_date"] else None,
             "data_date": r["data_date"].isoformat() if r["data_date"] else None}
            for r in rows]


@router.post("/projects")
async def create_project(body: ProjectIn, s: AsyncSession = Depends(get_session)):
    start_date = body.start_date or date.today()
    row = (await s.execute(sql_text("""
        INSERT INTO projects (name, code, start_date, data_date)
        VALUES (:name, :code, :start, :dd) RETURNING id
    """), {"name": body.name, "code": body.code,
           "start": start_date, "dd": body.data_date})).scalar()
    await s.commit()
    return {"id": str(row)}


@router.get("/projects/{project_id}/schedule")
async def get_schedule(project_id: str, s: AsyncSession = Depends(get_session)):
    pid = int(project_id)
    proj = (await s.execute(sql_text("""
        SELECT id, name, start_date, data_date
        FROM projects WHERE id = :pid
    """), {"pid": pid})).mappings().first()
    if not proj:
        raise HTTPException(404, "Project not found")

    await cpm_service.run_cpm(s, pid, persist=True)
    act_rows = (await s.execute(sql_text("""
        SELECT id, code, name, wbs_id, duration, remaining_duration,
               percent_complete, is_milestone, status, actual_start,
               actual_finish, early_start, early_finish, late_start, late_finish,
               total_float, free_float, is_critical, constraint_type,
               constraint_date, agency, discipline, package, area
        FROM activities
        WHERE project_id = :pid
        ORDER BY code
    """), {"pid": pid})).mappings().all()
    rel_rows = (await s.execute(sql_text("""
        SELECT p.code AS predecessor, s.code AS successor, r.rel_type, r.lag
        FROM relationships r
        JOIN activities p ON p.id = r.predecessor_id
        JOIN activities s ON s.id = r.successor_id
        WHERE r.project_id = :pid
        ORDER BY p.code, s.code
    """), {"pid": pid})).mappings().all()
    wbs_rows = (await s.execute(sql_text("""
        SELECT id, code, name, parent_id, seq
        FROM wbs
        WHERE project_id = :pid
        ORDER BY seq, code
    """), {"pid": pid})).mappings().all()

    return {
        "project": {
            "id": str(proj["id"]),
            "name": proj["name"],
            "start_date": proj["start_date"].isoformat() if proj["start_date"] else None,
            "data_date": proj["data_date"].isoformat() if proj["data_date"] else None,
        },
        "wbs": [
            {
                "id": str(r["id"]),
                "code": r["code"],
                "name": r["name"],
                "parent_id": str(r["parent_id"]) if r["parent_id"] else None,
                "seq": int(r["seq"] or 0),
            }
            for r in wbs_rows
        ],
        "activities": [
            {
                "id": str(r["id"]),
                "code": r["code"],
                "name": r["name"],
                "wbs_id": str(r["wbs_id"]) if r["wbs_id"] else None,
                "duration": int(r["duration"] or 0),
                "remaining_duration": r["remaining_duration"],
                "percent_complete": float(r["percent_complete"] or 0),
                "is_milestone": bool(r["is_milestone"]),
                "status": r["status"],
                "actual_start": r["actual_start"].isoformat() if r["actual_start"] else None,
                "actual_finish": r["actual_finish"].isoformat() if r["actual_finish"] else None,
                "early_start": r["early_start"].isoformat() if r["early_start"] else None,
                "early_finish": r["early_finish"].isoformat() if r["early_finish"] else None,
                "late_start": r["late_start"].isoformat() if r["late_start"] else None,
                "late_finish": r["late_finish"].isoformat() if r["late_finish"] else None,
                "total_float": r["total_float"],
                "free_float": r["free_float"],
                "is_critical": bool(r["is_critical"]),
                "constraint_type": r["constraint_type"],
                "constraint_date": r["constraint_date"].isoformat() if r["constraint_date"] else None,
                "agency": r["agency"],
                "discipline": r["discipline"],
                "package": r["package"],
                "area": r["area"],
            }
            for r in act_rows
        ],
        "relationships": [
            {
                "predecessor": r["predecessor"],
                "successor": r["successor"],
                "rel_type": r["rel_type"],
                "lag": int(r["lag"] or 0),
            }
            for r in rel_rows
        ],
    }


# ---- import ----------------------------------------------------------------
@router.post("/projects/{project_id}/import")
async def import_schedule(project_id: str, file: UploadFile = File(...),
                          s: AsyncSession = Depends(get_session)):
    pid = int(project_id)
    raw = await file.read()
    name = (file.filename or "").lower()
    try:
        if name.endswith(".xer"):
            sched = parse_xer(raw.decode("utf-8", errors="replace"))
        elif name.endswith(".xml"):
            sched = parse_msp_xml(raw.decode("utf-8", errors="replace"))
        elif name.endswith(".mpp"):
            import tempfile, os
            with tempfile.NamedTemporaryFile(suffix=".mpp", delete=False) as f:
                f.write(raw); tmp = f.name
            try:
                sched = parse_mpp(tmp)
            finally:
                os.unlink(tmp)
        else:
            raise HTTPException(415, "Unsupported format. Use .xer, .xml or .mpp")
    except MPPImportError as e:
        raise HTTPException(422, str(e))

    # persist (codes assumed unique within project)
    inserted = 0
    code_to_id: dict[str, int] = {}
    for a in sched.activities:
        rid = (await s.execute(sql_text("""
            INSERT INTO activities (project_id, code, name, duration,
                is_milestone, percent_complete, actual_start, actual_finish,
                constraint_type, constraint_date)
            VALUES (:pid,:code,:name,:dur,:ms,:pct,:as,:af,:ct,:cd)
            ON CONFLICT (project_id, code) DO UPDATE SET name=EXCLUDED.name
            RETURNING id
        """), {"pid": pid, "code": a.code, "name": a.name,
               "dur": a.duration, "ms": a.is_milestone,
               "pct": a.percent_complete, "as": a.actual_start,
               "af": a.actual_finish, "ct": a.constraint_type,
               "cd": a.constraint_date})).scalar()
        code_to_id[a.src_id] = int(rid)
        inserted += 1
    for r in sched.relationships:
        if r.pred_src_id in code_to_id and r.succ_src_id in code_to_id:
            await s.execute(sql_text("""
                INSERT INTO relationships (project_id, predecessor_id,
                    successor_id, rel_type, lag)
                VALUES (:pid,:p,:su,:rt,:lag)
                ON CONFLICT DO NOTHING
            """), {"pid": pid, "p": int(code_to_id[r.pred_src_id]),
                   "su": int(code_to_id[r.succ_src_id]), "rt": r.rel_type,
                   "lag": r.lag})
    await s.execute(sql_text("""
        INSERT INTO schedule_imports (project_id, file_name, file_format,
            activities_count, relationships_count, warnings)
        VALUES (:pid,:fn,:fmt,:ac,:rc,:w)
    """), {"pid": pid, "fn": file.filename, "fmt": sched.source_format,
           "ac": len(sched.activities), "rc": len(sched.relationships),
           "w": __import__("json").dumps(sched.warnings)})
    await s.commit()
    return {"imported": sched.summary(), "activities_persisted": inserted}


# ---- CPM -------------------------------------------------------------------
@router.post("/projects/{project_id}/cpm/run")
async def cpm_run(project_id: str, s: AsyncSession = Depends(get_session)):
    res = await cpm_service.run_cpm(s, int(project_id), persist=True)
    return {
        "project_start": res.project_start.isoformat(),
        "project_finish": res.project_finish.isoformat(),
        "critical_path": res.critical_path,
        "activity_count": len(res.activities),
    }


# ---- schedule updating -----------------------------------------------------
@router.patch("/activities/{activity_id}/progress")
async def update_progress(activity_id: str, body: ProgressIn,
                          s: AsyncSession = Depends(get_session)):
    cur = (await s.execute(sql_text(
        "SELECT project_id, actual_start, actual_finish, percent_complete, "
        "remaining_duration FROM activities WHERE id=:id"),
        {"id": activity_id})).mappings().first()
    if not cur:
        raise HTTPException(404, "Activity not found")

    changes = {k: v for k, v in body.model_dump().items()
               if v is not None and k in
               ("actual_start", "actual_finish", "percent_complete",
                "remaining_duration")}
    # write an update-log row per changed field
    for field, new_val in changes.items():
        await s.execute(sql_text("""
            INSERT INTO update_logs (project_id, activity_id, field_name,
                previous_value, revised_value, changed_by, remarks)
            VALUES (:pid,:aid,:f,:prev,:rev,:by,:rem)
        """), {"pid": int(cur["project_id"]), "aid": int(activity_id), "f": field,
               "prev": str(cur[field]), "rev": str(new_val),
               "by": body.changed_by, "rem": body.remarks})

    sets = ", ".join(f"{k} = :{k}" for k in changes)
    if sets:
        changes["id"] = int(activity_id)
        await s.execute(sql_text(
            f"UPDATE activities SET {sets} WHERE id = :id"), changes)
    await s.commit()
    # recompute schedule
    res = await cpm_service.run_cpm(s, int(cur["project_id"]), persist=True)
    return {"updated_fields": list(changes.keys()),
            "project_finish": res.project_finish.isoformat()}


# ---- baselines -------------------------------------------------------------
@router.post("/projects/{project_id}/baselines")
async def save_baseline(project_id: str, name: str,
                        s: AsyncSession = Depends(get_session)):
    pid = int(project_id)
    # snapshot current early dates as the baseline
    res = await cpm_service.run_cpm(s, pid, persist=True)
    bid = (await s.execute(sql_text("""
        INSERT INTO baselines (project_id, name, project_finish)
        VALUES (:pid,:n,:pf) RETURNING id
    """), {"pid": pid, "n": name,
           "pf": res.project_finish})).scalar()
    await s.execute(sql_text("""
        INSERT INTO baseline_activities (baseline_id, activity_id, bl_start,
            bl_finish, bl_duration, bl_total_float)
        SELECT :bid, id, early_start, early_finish, duration, total_float
        FROM activities WHERE project_id = :pid
    """), {"bid": bid, "pid": pid})
    await s.commit()
    return {"baseline_id": str(bid), "project_finish": res.project_finish.isoformat()}


# ---- delay analysis --------------------------------------------------------
@router.get("/projects/{project_id}/delay")
async def delay_analysis(project_id: str, baseline_id: str,
                         s: AsyncSession = Depends(get_session)):
    return await cpm_service.run_delay(s, int(project_id), int(baseline_id))


# ---- DCMA ------------------------------------------------------------------
@router.post("/projects/{project_id}/dcma")
async def dcma(project_id: str, baseline_id: Optional[str] = None,
               s: AsyncSession = Depends(get_session)):
    return await cpm_service.run_dcma(
        s, int(project_id), int(baseline_id) if baseline_id is not None else None)


# ---- alerts / dashboard ----------------------------------------------------
@router.get("/projects/{project_id}/dashboard")
async def dashboard(project_id: str, s: AsyncSession = Depends(get_session)):
    pid = int(project_id)
    res = await cpm_service.run_cpm(s, pid, persist=False)
    # relationships for logic checks
    rel_rows = (await s.execute(sql_text("""
        SELECT p.code AS pred, su.code AS succ, r.rel_type, r.lag
        FROM relationships r
        JOIN activities p ON p.id=r.predecessor_id
        JOIN activities su ON su.id=r.successor_id
        WHERE r.project_id=:pid"""), {"pid": pid})).mappings().all()
    from ..core.cpm import CPMRelationship, RelType
    rels = [CPMRelationship(r["pred"], r["succ"], RelType(r["rel_type"]),
                            int(r["lag"] or 0)) for r in rel_rows]
    alerts, cards = generate_alerts(res, rels, data_date=res.data_date)
    return {"cards": cards.__dict__,
            "alerts": [a.__dict__ for a in alerts][:200]}


# ---- reports / export ------------------------------------------------------
@router.get("/projects/{project_id}/reports/export")
async def export_reports(project_id: str, fmt: str = "xlsx",
                         baseline_id: Optional[str] = None,
                         look_ahead_days: int = 0,
                         s: AsyncSession = Depends(get_session)):
    """
    Export the full report pack (schedule summary, critical path, milestones,
    look-ahead, baseline variance, delay, DCMA) as csv / xlsx / pdf.
    """
    if fmt not in _MEDIA:
        raise HTTPException(400, f"fmt must be one of {list(_MEDIA)}")
    suffix = {"csv": ".csv", "xlsx": ".xlsx", "pdf": ".pdf"}[fmt]
    fd, path = tempfile.mkstemp(suffix=suffix, prefix=f"report_{project_id}_")
    os.close(fd)
    try:
        await cpm_service.export_reports(
            s, int(project_id), fmt, path,
            baseline_id=int(baseline_id) if baseline_id is not None else None,
            look_ahead_days=look_ahead_days)
    except Exception as e:
        raise HTTPException(500, f"report generation failed: {e}")
    return FileResponse(path, media_type=_MEDIA[fmt],
                        filename=f"schedule_report{suffix}")
