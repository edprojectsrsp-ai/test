"""
Sprint 9B — CPM Schedule Engine Router
Mount under /api/v1/cpm in main FastAPI app.

Endpoints:
  POST /api/v1/cpm/schedule                  - Create manual schedule
  POST /api/v1/cpm/schedule/import           - Upload .xer / .mpp / .csv
  GET  /api/v1/cpm/schedule                  - List all schedules
  GET  /api/v1/cpm/schedule/{id}             - Full schedule with activities + deps
  GET  /api/v1/cpm/schedule/{id}/summary     - Summary stats only
  PUT  /api/v1/cpm/activity/{id}             - Update activity (triggers CPM rerun)
  POST /api/v1/cpm/activity                  - Add new activity manually
  POST /api/v1/cpm/dependency                - Add a predecessor link
  DELETE /api/v1/cpm/dependency/{id}         - Remove a link
  POST /api/v1/cpm/baseline/save/{schedule_id} - Freeze current as baseline
  POST /api/v1/cpm/run/{schedule_id}         - Force CPM recalc
  GET  /api/v1/cpm/critical-path/{schedule_id}
  GET  /api/v1/cpm/delays/{schedule_id}      - Variance analysis
  POST /api/v1/cpm/delay-analysis            - Record a delay attribution
"""
import os, sys, tempfile
from datetime import date, datetime
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session
from app.db import get_db

# Make CPM engine importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "cpm"))
from cpm_engine import run_cpm  # noqa: E402
from importers import (         # noqa: E402
    XERParser, CSVScheduleParser, load_schedule_to_db
)

router = APIRouter(prefix="/api/v1/cpm", tags=["cpm"])

DB_URL = os.environ.get("PROJECT_BRAIN_DB_URL",
                       "postgresql://postgres:abc123@127.0.0.1:5433/project_brain")


# ============================================================================
# SCHEMAS
# ============================================================================

class ScheduleCreate(BaseModel):
    package_id: int
    schedule_name: str = Field(..., max_length=200)
    description: Optional[str] = None
    project_start_date: Optional[date] = None
    user_id: int = 1   # TODO from auth


class ActivityCreate(BaseModel):
    schedule_id: int
    activity_code: str = Field(..., max_length=50)
    activity_name: str = Field(..., max_length=500)
    activity_type: str = "task"
    planned_duration_days: Optional[float] = None
    planned_start_date: Optional[date] = None
    planned_finish_date: Optional[date] = None
    wbs_code: Optional[str] = None
    parent_activity_id: Optional[int] = None
    cost_estimate_cr: Optional[float] = None


class ActivityUpdate(BaseModel):
    activity_name: Optional[str] = None
    activity_type: Optional[str] = None
    # All 7 date dimensions editable
    planned_start_date: Optional[date] = None
    planned_finish_date: Optional[date] = None
    baseline_start_date: Optional[date] = None
    baseline_finish_date: Optional[date] = None
    estimated_start_date: Optional[date] = None
    estimated_finish_date: Optional[date] = None
    actual_start_date: Optional[date] = None
    actual_finish_date: Optional[date] = None
    forecast_start_date: Optional[date] = None
    forecast_finish_date: Optional[date] = None
    # Durations
    planned_duration_days: Optional[float] = None
    estimated_duration_days: Optional[float] = None
    remaining_duration_days: Optional[float] = None
    actual_duration_days: Optional[float] = None
    # Progress / status
    physical_pct_complete: Optional[float] = None
    activity_status: Optional[str] = None
    constraint_type: Optional[str] = None
    constraint_date: Optional[date] = None
    notes: Optional[str] = None
    cost_actual_cr: Optional[float] = None


class DependencyCreate(BaseModel):
    predecessor_id: int
    successor_id: int
    dependency_type: str = "FS"   # FS, SS, FF, SF
    lag_days: float = 0.0
    notes: Optional[str] = None


class DelayAnalysisCreate(BaseModel):
    schedule_id: int
    activity_id: Optional[int] = None
    analysis_date: Optional[date] = None
    delay_cause: Optional[str] = None
    delay_attributable_to: Optional[str] = None  # owner/contractor/external/force_majeure/joint
    cost_impact_cr: Optional[float] = None
    remarks: Optional[str] = None
    user_id: int = 1


# ============================================================================
# SCHEDULE CRUD
# ============================================================================

@router.post("/schedule")
def create_schedule(p: ScheduleCreate, db: Session = Depends(get_db)):
    """Create a new (empty) schedule manually."""
    row = db.execute(text("""
        INSERT INTO cpm_schedules(package_id, schedule_name, description,
            project_start_date, data_date, source, status, created_by)
        VALUES (:pid, :name, :desc, :start, COALESCE(:start, CURRENT_DATE),
                'manual'::schedule_source_enum, 'active'::schedule_status_enum, :uid)
        RETURNING schedule_id, schedule_name
    """), {"pid": p.package_id, "name": p.schedule_name, "desc": p.description,
           "start": p.project_start_date, "uid": p.user_id}).mappings().first()
    db.commit()
    return {"schedule_id": row['schedule_id'], "schedule_name": row['schedule_name']}


@router.post("/schedule/import")
async def import_schedule(
    file: UploadFile = File(...),
    package_id: int = Form(...),
    schedule_name: str = Form(...),
    user_id: int = Form(1),
):
    """Upload .xer / .mpp / .csv schedule file. Auto-detects format."""
    ext = file.filename.lower().rsplit('.', 1)[-1]
    if ext not in ('xer', 'mpp', 'csv'):
        raise HTTPException(400, f"Unsupported format: .{ext}. Use .xer, .mpp, or .csv")

    # Save to temp
    with tempfile.NamedTemporaryFile(delete=False, suffix=f".{ext}") as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name

    try:
        warnings = []
        if ext == 'csv':
            parser = CSVScheduleParser(tmp_path)
            activities, deps = parser.parse()
            result = load_schedule_to_db(
                package_id, schedule_name, activities, deps,
                'csv_import', file.filename, user_id, DB_URL, warnings
            )
        elif ext == 'xer':
            parser = XERParser(tmp_path)
            parser.parse()
            activities = parser.get_activities()
            deps_xer = parser.get_dependencies()
            task_id_to_code = {a.get('_xer_task_id'): a['activity_code']
                              for a in activities if a.get('_xer_task_id')}
            deps = []
            for d in deps_xer:
                pc = task_id_to_code.get(d['predecessor_xer_id'])
                sc = task_id_to_code.get(d['successor_xer_id'])
                if pc and sc:
                    deps.append({'predecessor_code': pc, 'successor_code': sc,
                                'dependency_type': d['dependency_type'],
                                'lag_days': d['lag_days']})
            result = load_schedule_to_db(
                package_id, schedule_name, activities, deps,
                'xer_import', file.filename, user_id, DB_URL, warnings
            )
        elif ext == 'mpp':
            try:
                from importers import parse_mpp
                activities, deps = parse_mpp(tmp_path)
                result = load_schedule_to_db(
                    package_id, schedule_name, activities, deps,
                    'mpp_import', file.filename, user_id, DB_URL, warnings
                )
            except ImportError as e:
                raise HTTPException(400, str(e))

        # Run CPM
        cpm_result = run_cpm(result['schedule_id'], DB_URL)
        result['cpm'] = cpm_result
        return result
    finally:
        os.unlink(tmp_path)


@router.get("/schedule")
def list_schedules(package_id: Optional[int] = None, db: Session = Depends(get_db)):
    """List all schedules (optionally filtered by package)."""
    conds = ["NOT s.is_deleted"]
    params: dict = {}
    if package_id:
        conds.append("s.package_id = :pid")
        params["pid"] = package_id

    sql = f"""
        SELECT s.*, p.package_name, sm.scheme_name, sm.scheme_code,
               (SELECT COUNT(*) FROM cpm_activities a WHERE a.schedule_id=s.schedule_id AND NOT a.is_deleted) AS activity_count
        FROM cpm_schedules s
        LEFT JOIN packages p ON p.package_id = s.package_id
        LEFT JOIN scheme_master sm ON sm.scheme_id = p.scheme_id
        WHERE {' AND '.join(conds)}
        ORDER BY s.created_at DESC
    """
    rows = db.execute(text(sql), params).mappings().all()
    return {"schedules": [dict(r) for r in rows]}


@router.get("/schedule/{schedule_id}")
def get_schedule(schedule_id: int, db: Session = Depends(get_db)):
    """Full schedule details: activities + dependencies + computed CPM data."""
    sched = db.execute(text("""
        SELECT s.*, p.package_name, sm.scheme_name, sm.scheme_code
        FROM cpm_schedules s
        LEFT JOIN packages p ON p.package_id = s.package_id
        LEFT JOIN scheme_master sm ON sm.scheme_id = p.scheme_id
        WHERE s.schedule_id = :id AND NOT s.is_deleted
    """), {"id": schedule_id}).mappings().first()
    if not sched:
        raise HTTPException(404, "Schedule not found")

    activities = db.execute(text("""
        SELECT * FROM v_cpm_activities_with_delays
        WHERE schedule_id = :id
        ORDER BY COALESCE(planned_start_date, early_start_date), activity_code
    """), {"id": schedule_id}).mappings().all()

    deps = db.execute(text("""
        SELECT d.*, pa.activity_code AS predecessor_code, sa.activity_code AS successor_code
        FROM cpm_dependencies d
        JOIN cpm_activities pa ON pa.activity_id = d.predecessor_id
        JOIN cpm_activities sa ON sa.activity_id = d.successor_id
        WHERE pa.schedule_id = :id
    """), {"id": schedule_id}).mappings().all()

    return {
        "schedule": dict(sched),
        "activities": [dict(a) for a in activities],
        "dependencies": [dict(d) for d in deps],
    }


@router.get("/schedule/{schedule_id}/summary")
def get_schedule_summary(schedule_id: int, db: Session = Depends(get_db)):
    """Quick summary - useful for dashboards."""
    row = db.execute(text("""
        SELECT * FROM v_cpm_schedule_summary WHERE schedule_id = :id
    """), {"id": schedule_id}).mappings().first()
    if not row:
        raise HTTPException(404, "Schedule not found")
    return dict(row)


# ============================================================================
# ACTIVITY CRUD
# ============================================================================

@router.post("/activity")
def create_activity(p: ActivityCreate, db: Session = Depends(get_db)):
    """Add an activity manually."""
    row = db.execute(text("""
        INSERT INTO cpm_activities(
            schedule_id, activity_code, activity_name, activity_type,
            planned_duration_days, planned_start_date, planned_finish_date,
            wbs_code, parent_activity_id, cost_estimate_cr
        ) VALUES (:sid, :code, :name, :type::cpm_activity_type_enum,
                  :dur, :ps, :pf, :wbs, :parent, :cost)
        RETURNING activity_id
    """), {"sid": p.schedule_id, "code": p.activity_code, "name": p.activity_name,
           "type": p.activity_type, "dur": p.planned_duration_days,
           "ps": p.planned_start_date, "pf": p.planned_finish_date,
           "wbs": p.wbs_code, "parent": p.parent_activity_id,
           "cost": p.cost_estimate_cr}).mappings().first()
    db.commit()
    return {"activity_id": row['activity_id']}


@router.put("/activity/{activity_id}")
def update_activity(activity_id: int, p: ActivityUpdate, db: Session = Depends(get_db)):
    """Update activity. ANY change triggers a CPM rerun.

    All 7 date dimensions editable. Use null to keep existing value."""
    updates = {}
    for field, val in p.dict(exclude_unset=True).items():
        updates[field] = val
    if not updates:
        raise HTTPException(400, "No fields provided")

    # Build dynamic SQL
    type_casts = {
        'activity_type': '::cpm_activity_type_enum',
        'activity_status': '::cpm_activity_status_enum',
        'constraint_type': '::cpm_constraint_type_enum',
    }
    set_clauses = []
    for k in updates:
        cast = type_casts.get(k, '')
        set_clauses.append(f"{k} = :{k}{cast}")

    sql = f"""UPDATE cpm_activities SET {', '.join(set_clauses)}
              WHERE activity_id = :aid
              RETURNING schedule_id"""
    updates["aid"] = activity_id
    row = db.execute(text(sql), updates).mappings().first()
    if not row:
        raise HTTPException(404, "Activity not found")
    db.commit()

    # Rerun CPM
    cpm = run_cpm(row['schedule_id'], DB_URL)
    return {"activity_id": activity_id, "cpm": cpm}


@router.delete("/activity/{activity_id}")
def delete_activity(activity_id: int, db: Session = Depends(get_db)):
    """Soft-delete an activity. Triggers CPM rerun."""
    row = db.execute(text("""
        UPDATE cpm_activities SET is_deleted = TRUE WHERE activity_id = :aid
        RETURNING schedule_id
    """), {"aid": activity_id}).mappings().first()
    if not row:
        raise HTTPException(404, "Activity not found")
    db.commit()
    cpm = run_cpm(row['schedule_id'], DB_URL)
    return {"ok": True, "cpm": cpm}


# ============================================================================
# DEPENDENCIES
# ============================================================================

@router.post("/dependency")
def create_dependency(p: DependencyCreate, db: Session = Depends(get_db)):
    """Add a predecessor link between activities. Triggers CPM rerun."""
    row = db.execute(text("""
        INSERT INTO cpm_dependencies(predecessor_id, successor_id, dependency_type, lag_days, notes)
        VALUES (:pred, :succ, :type::cpm_dependency_type_enum, :lag, :notes)
        ON CONFLICT (predecessor_id, successor_id) DO UPDATE
          SET dependency_type = EXCLUDED.dependency_type,
              lag_days = EXCLUDED.lag_days,
              notes = EXCLUDED.notes
        RETURNING dependency_id
    """), {"pred": p.predecessor_id, "succ": p.successor_id,
           "type": p.dependency_type, "lag": p.lag_days, "notes": p.notes}).mappings().first()
    sid = db.execute(text("SELECT schedule_id FROM cpm_activities WHERE activity_id=:id"),
                    {"id": p.predecessor_id}).mappings().first()
    db.commit()
    cpm = run_cpm(sid['schedule_id'], DB_URL) if sid else None
    return {"dependency_id": row['dependency_id'], "cpm": cpm}


@router.delete("/dependency/{dependency_id}")
def delete_dependency(dependency_id: int, db: Session = Depends(get_db)):
    sid = db.execute(text("""
        SELECT pa.schedule_id FROM cpm_dependencies d
        JOIN cpm_activities pa ON pa.activity_id = d.predecessor_id
        WHERE d.dependency_id = :id
    """), {"id": dependency_id}).mappings().first()
    db.execute(text("DELETE FROM cpm_dependencies WHERE dependency_id = :id"),
              {"id": dependency_id})
    db.commit()
    cpm = run_cpm(sid['schedule_id'], DB_URL) if sid else None
    return {"ok": True, "cpm": cpm}


# ============================================================================
# CPM OPERATIONS
# ============================================================================

@router.post("/run/{schedule_id}")
def force_cpm_run(schedule_id: int):
    """Manually trigger CPM recalculation."""
    result = run_cpm(schedule_id, DB_URL)
    return result


@router.get("/critical-path/{schedule_id}")
def get_critical_path(schedule_id: int, db: Session = Depends(get_db)):
    """Return only critical path activities."""
    rows = db.execute(text("""
        SELECT * FROM v_cpm_critical_path WHERE schedule_id = :id
    """), {"id": schedule_id}).mappings().all()
    return {"critical_path": [dict(r) for r in rows]}


# ============================================================================
# BASELINE
# ============================================================================

@router.post("/baseline/save/{schedule_id}")
def save_baseline(schedule_id: int, snapshot_name: Optional[str] = None,
                  user_id: int = 1, db: Session = Depends(get_db)):
    """Freeze current planned dates as baseline. Stores both per-activity baseline
    columns AND a JSONB snapshot for full historical record."""
    # Copy planned → baseline on all activities
    db.execute(text("""
        UPDATE cpm_activities SET
            baseline_start_date = COALESCE(planned_start_date, early_start_date),
            baseline_finish_date = COALESCE(planned_finish_date, early_finish_date),
            baseline_duration_days = COALESCE(planned_duration_days, estimated_duration_days)
        WHERE schedule_id = :sid AND NOT is_deleted
    """), {"sid": schedule_id})

    # Snapshot to JSONB
    snap_data = db.execute(text("""
        SELECT json_agg(json_build_object(
            'activity_id', activity_id, 'activity_code', activity_code,
            'baseline_start', baseline_start_date,
            'baseline_finish', baseline_finish_date,
            'baseline_duration', baseline_duration_days
        )) AS snap
        FROM cpm_activities WHERE schedule_id = :sid AND NOT is_deleted
    """), {"sid": schedule_id}).mappings().first()

    name = snapshot_name or f"Baseline {datetime.now().strftime('%Y-%m-%d %H:%M')}"
    db.execute(text("""
        INSERT INTO cpm_baseline_snapshots(schedule_id, snapshot_name, activities_snapshot, created_by)
        VALUES (:sid, :name, :data, :uid)
    """), {"sid": schedule_id, "name": name, "data": str(snap_data['snap']).replace("'", '"'), "uid": user_id})

    # Mark schedule as baselined
    db.execute(text("""
        UPDATE cpm_schedules SET baseline_set_at = CURRENT_TIMESTAMP,
            baseline_set_by = :uid, is_current_baseline = TRUE,
            status = 'baselined'::schedule_status_enum
        WHERE schedule_id = :sid
    """), {"uid": user_id, "sid": schedule_id})
    db.commit()
    return {"ok": True, "snapshot_name": name}


# ============================================================================
# DELAY ANALYSIS
# ============================================================================

@router.get("/delays/{schedule_id}")
def get_delays(schedule_id: int, db: Session = Depends(get_db)):
    """Variance analysis - activities with delays vs baseline.
    Returns activities sorted by impact."""
    rows = db.execute(text("""
        SELECT
            a.activity_id, a.activity_code, a.activity_name,
            a.activity_status::text AS activity_status,
            a.baseline_start_date, a.baseline_finish_date,
            a.actual_start_date, a.actual_finish_date,
            a.forecast_start_date, a.forecast_finish_date,
            a.physical_pct_complete, a.is_critical,
            a.total_float_days,
            CASE WHEN a.actual_finish_date IS NOT NULL AND a.baseline_finish_date IS NOT NULL
                 THEN a.actual_finish_date - a.baseline_finish_date END AS delay_vs_baseline_days,
            CASE WHEN a.actual_start_date IS NOT NULL AND a.baseline_start_date IS NOT NULL
                 THEN a.actual_start_date - a.baseline_start_date END AS start_delay_days,
            CASE WHEN a.forecast_finish_date IS NOT NULL AND a.baseline_finish_date IS NOT NULL
                 THEN a.forecast_finish_date - a.baseline_finish_date END AS forecast_slip_days,
            -- Get any recorded delay analyses
            (SELECT json_agg(json_build_object(
                'cause', delay_cause, 'attributable_to', delay_attributable_to,
                'cost_impact_cr', cost_impact_cr, 'remarks', remarks,
                'analysis_date', analysis_date
            )) FROM cpm_delay_analysis da WHERE da.activity_id = a.activity_id) AS attributions
        FROM cpm_activities a
        WHERE a.schedule_id = :id AND NOT a.is_deleted
          AND (
            (a.actual_finish_date IS NOT NULL AND a.actual_finish_date > a.baseline_finish_date)
            OR (a.actual_start_date IS NOT NULL AND a.actual_start_date > a.baseline_start_date)
            OR (a.forecast_finish_date IS NOT NULL AND a.forecast_finish_date > a.baseline_finish_date)
          )
        ORDER BY
            a.is_critical DESC,
            COALESCE(a.actual_finish_date - a.baseline_finish_date,
                    a.forecast_finish_date - a.baseline_finish_date, 0) DESC
    """), {"id": schedule_id}).mappings().all()
    return {"delays": [dict(r) for r in rows]}


@router.post("/delay-analysis")
def record_delay_analysis(p: DelayAnalysisCreate, db: Session = Depends(get_db)):
    """Record attribution for a delay (cause, who's responsible, cost impact)."""
    row = db.execute(text("""
        INSERT INTO cpm_delay_analysis(
            schedule_id, activity_id, analysis_date,
            delay_cause, delay_attributable_to, cost_impact_cr,
            remarks, analyzed_by
        ) VALUES (:sid, :aid, COALESCE(:date, CURRENT_DATE),
                  :cause, :who, :cost, :remarks, :uid)
        RETURNING analysis_id
    """), {"sid": p.schedule_id, "aid": p.activity_id, "date": p.analysis_date,
           "cause": p.delay_cause, "who": p.delay_attributable_to,
           "cost": p.cost_impact_cr, "remarks": p.remarks, "uid": p.user_id}).mappings().first()
    db.commit()
    return {"analysis_id": row['analysis_id']}
