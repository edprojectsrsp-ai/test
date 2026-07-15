"""
Service layer. Loads a project's activities/relationships/calendar from the
database, maps them onto the engine dataclasses, runs CPM / DCMA / delay
analysis, and writes the computed fields back.

DB rows are loaded with sql_text() async queries (matching the host project's
conventions). Activity codes are used as the engine's string ids so the engine
stays DB-agnostic; a code<->uuid map translates results back for persistence.
"""
from __future__ import annotations

from datetime import date
from typing import Optional

from sqlalchemy import text as sql_text
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.calendar import WorkCalendar, calendar_from_spec, DEFAULT_CALENDAR
from ..core.cpm import (CPMEngine, CPMActivity, CPMRelationship, RelType,
                        Constraint, CPMResult)
from ..core.dcma import DCMAAssessor
from ..core.delay_analysis import (DelayAnalyzer, BaselineActivity)
from ..core import reports


async def _load_project(session: AsyncSession, project_id: int):
    row = (await session.execute(
        sql_text("SELECT id, name, start_date, data_date "
                 "FROM projects WHERE id = :pid"),
        {"pid": int(project_id)})).mappings().first()
    if not row:
        raise ValueError("Project not found")
    return row


async def _load_calendar(session: AsyncSession, project_id: int) -> WorkCalendar:
    row = (await session.execute(
        sql_text("SELECT c.name, c.working_weekdays, c.holidays "
                 "FROM calendars c JOIN projects p "
                 "ON p.default_calendar_id = c.id WHERE p.id = :pid"),
        {"pid": int(project_id)})).mappings().first()
    if not row:
        return DEFAULT_CALENDAR
    return calendar_from_spec({
        "name": row["name"],
        "working_weekdays": row["working_weekdays"],
        "holidays": row["holidays"],
    })


async def _load_activities(session: AsyncSession, project_id: int):
    rows = (await session.execute(
        sql_text("""
            SELECT id, code, name, duration, remaining_duration,
                   percent_complete, is_milestone, actual_start, actual_finish,
                   constraint_type, constraint_date, agency, discipline,
                   package, area
            FROM activities WHERE project_id = :pid
        """), {"pid": int(project_id)})).mappings().all()
    return rows


async def _load_relationships(session: AsyncSession, project_id: int):
    rows = (await session.execute(
        sql_text("""
            SELECT r.rel_type, r.lag, p.code AS pred_code, s.code AS succ_code
            FROM relationships r
            JOIN activities p ON p.id = r.predecessor_id
            JOIN activities s ON s.id = r.successor_id
            WHERE r.project_id = :pid
        """), {"pid": int(project_id)})).mappings().all()
    return rows


def _to_cpm_activities(rows) -> tuple[list[CPMActivity], dict[str, int]]:
    acts, code_to_uuid = [], {}
    for r in rows:
        code_to_uuid[r["code"]] = int(r["id"])
        acts.append(CPMActivity(
            id=r["code"], name=r["name"], duration=int(r["duration"] or 0),
            remaining_duration=r["remaining_duration"],
            percent_complete=float(r["percent_complete"] or 0),
            is_milestone=bool(r["is_milestone"]),
            actual_start=r["actual_start"], actual_finish=r["actual_finish"],
            constraint_type=Constraint(r["constraint_type"] or "NONE"),
            constraint_date=r["constraint_date"],
        ))
    return acts, code_to_uuid


async def run_cpm(session: AsyncSession, project_id: int,
                  persist: bool = True) -> CPMResult:
    project_id = int(project_id)
    proj = await _load_project(session, project_id)
    cal = await _load_calendar(session, project_id)
    act_rows = await _load_activities(session, project_id)
    rel_rows = await _load_relationships(session, project_id)

    acts, code_to_uuid = _to_cpm_activities(act_rows)
    rels = [CPMRelationship(r["pred_code"], r["succ_code"],
                            RelType(r["rel_type"]), int(r["lag"] or 0))
            for r in rel_rows]

    result = CPMEngine(acts, rels, proj["start_date"], cal,
                       proj["data_date"]).run()

    if persist:
        for code, a in result.activities.items():
            await session.execute(sql_text("""
                UPDATE activities SET
                  early_start=:es, early_finish=:ef,
                  late_start=:ls, late_finish=:lf,
                  total_float=:tf, free_float=:ff, is_critical=:crit
                WHERE id=:id
            """), {"es": a.es, "ef": a.ef, "ls": a.ls, "lf": a.lf,
                   "tf": a.total_float, "ff": a.free_float,
                   "crit": a.is_critical, "id": int(code_to_uuid[code])})
        await session.commit()
    return result


async def run_dcma(session: AsyncSession, project_id: int,
                   baseline_id: Optional[int] = None) -> dict:
    project_id = int(project_id)
    baseline_id = int(baseline_id) if baseline_id is not None else None
    proj = await _load_project(session, project_id)
    cal = await _load_calendar(session, project_id)
    act_rows = await _load_activities(session, project_id)
    rel_rows = await _load_relationships(session, project_id)
    acts, _ = _to_cpm_activities(act_rows)
    rels = [CPMRelationship(r["pred_code"], r["succ_code"],
                            RelType(r["rel_type"]), int(r["lag"] or 0))
            for r in rel_rows]

    bl_finish, bl_pf = {}, None
    if baseline_id is not None:
        bl_rows = (await session.execute(sql_text("""
            SELECT a.code, ba.bl_finish FROM baseline_activities ba
            JOIN activities a ON a.id = ba.activity_id
            WHERE ba.baseline_id = :bid
        """), {"bid": baseline_id})).mappings().all()
        bl_finish = {r["code"]: r["bl_finish"] for r in bl_rows if r["bl_finish"]}
        pf = (await session.execute(sql_text(
            "SELECT project_finish FROM baselines WHERE id=:bid"),
            {"bid": baseline_id})).scalar()
        bl_pf = pf

    report = DCMAAssessor(acts, rels, proj["start_date"], cal,
                          proj["data_date"], bl_finish, bl_pf).assess()

    await session.execute(sql_text("""
        INSERT INTO dcma_runs (project_id, score, passed_count,
                               applicable_count, detail)
        VALUES (:pid, :score, :passed, :applicable, :detail)
    """), {"pid": project_id, "score": report.score,
           "passed": report.passed_count,
           "applicable": report.applicable_count,
           "detail": __import__("json").dumps([c.__dict__ for c in report.checks])})
    await session.commit()
    return report.as_dict()


async def run_delay(session: AsyncSession, project_id: int,
                    baseline_id: int) -> dict:
    project_id = int(project_id)
    baseline_id = int(baseline_id)
    cpm = await run_cpm(session, project_id, persist=False)
    cal = await _load_calendar(session, project_id)

    bl_rows = (await session.execute(sql_text("""
        SELECT a.code, ba.bl_start, ba.bl_finish, ba.bl_duration
        FROM baseline_activities ba JOIN activities a ON a.id = ba.activity_id
        WHERE ba.baseline_id = :bid
    """), {"bid": baseline_id})).mappings().all()
    baseline = [BaselineActivity(r["code"], r["bl_start"], r["bl_finish"],
                                 r["bl_duration"]) for r in bl_rows]
    bl_pf = (await session.execute(sql_text(
        "SELECT project_finish FROM baselines WHERE id=:bid"),
        {"bid": baseline_id})).scalar()

    # grouping dimensions
    grp_rows = (await session.execute(sql_text(
        "SELECT code, agency, discipline, package, area "
        "FROM activities WHERE project_id=:pid"),
        {"pid": project_id})).mappings().all()
    groups = {r["code"]: {k: r[k] for k in
                          ("agency", "discipline", "package", "area") if r[k]}
              for r in grp_rows}

    report = DelayAnalyzer(
        list(cpm.activities.values()), baseline, cal,
        baseline_project_finish=bl_pf,
        current_project_finish=cpm.project_finish, groups=groups).analyze()

    return {
        "project_finish_variance_wd": report.project_finish_variance_wd,
        "delayed_count": report.delayed_count,
        "critical_delay_count": report.critical_delay_count,
        "rows": [
            {"activity_id": r.activity_id, "name": r.name,
             "bl_finish": r.bl_finish.isoformat() if r.bl_finish else None,
             "cur_finish": r.cur_finish.isoformat() if r.cur_finish else None,
             "finish_var_wd": r.finish_var_wd,
             "total_float": r.total_float,
             "classification": r.classification.value,
             "reason": r.reason}
            for r in report.rows],
    }

# ---------------------------------------------------------------------------
# report export
# ---------------------------------------------------------------------------
async def _delay_report_obj(session: AsyncSession, project_id: int,
                            baseline_id: int, cpm: CPMResult):
    """Build a DelayReport engine object (not the JSON dict) for export."""
    cal = await _load_calendar(session, project_id)
    bl_rows = (await session.execute(sql_text("""
        SELECT a.code, ba.bl_start, ba.bl_finish, ba.bl_duration
        FROM baseline_activities ba JOIN activities a ON a.id = ba.activity_id
        WHERE ba.baseline_id = :bid
    """), {"bid": baseline_id})).mappings().all()
    baseline = [BaselineActivity(r["code"], r["bl_start"], r["bl_finish"],
                                 r["bl_duration"]) for r in bl_rows]
    bl_pf = (await session.execute(sql_text(
        "SELECT project_finish FROM baselines WHERE id=:bid"),
        {"bid": baseline_id})).scalar()
    grp_rows = (await session.execute(sql_text(
        "SELECT code, agency, discipline, package, area "
        "FROM activities WHERE project_id=:pid"),
        {"pid": project_id})).mappings().all()
    groups = {r["code"]: {k: r[k] for k in
                          ("agency", "discipline", "package", "area") if r[k]}
              for r in grp_rows}
    return DelayAnalyzer(
        list(cpm.activities.values()), baseline, cal,
        baseline_project_finish=bl_pf,
        current_project_finish=cpm.project_finish, groups=groups).analyze()


async def export_reports(session: AsyncSession, project_id: int, fmt: str,
                         out_path: str, baseline_id: Optional[int] = None,
                         look_ahead_days: int = 0) -> str:
    """
    Build the full report pack for a project and write it to `out_path`
    in the requested format ('csv' | 'xlsx' | 'pdf'). Returns out_path.
    """
    proj = await _load_project(session, project_id)
    cpm = await run_cpm(session, project_id, persist=False)

    delay_obj = None
    if baseline_id:
        delay_obj = await _delay_report_obj(session, project_id, baseline_id, cpm)

    # DCMA engine object
    cal = await _load_calendar(session, project_id)
    act_rows = await _load_activities(session, project_id)
    rel_rows = await _load_relationships(session, project_id)
    acts, _ = _to_cpm_activities(act_rows)
    rels = [CPMRelationship(r["pred_code"], r["succ_code"],
                            RelType(r["rel_type"]), int(r["lag"] or 0))
            for r in rel_rows]
    dcma_obj = DCMAAssessor(acts, rels, proj["start_date"], cal,
                            proj["data_date"]).assess()

    window = None
    if look_ahead_days > 0 and cpm.project_start:
        from datetime import timedelta
        window = (cpm.project_start,
                  cpm.project_start + timedelta(days=look_ahead_days))

    tables = reports.build_report_pack(result=cpm, delay=delay_obj,
                                       dcma=dcma_obj, look_ahead_window=window)

    title = f"{proj['name']} — Schedule Control Report"
    if fmt == "csv":
        with open(out_path, "w", newline="") as f:
            f.write(reports.tables_to_csv(tables))
    elif fmt == "xlsx":
        reports.tables_to_excel(tables, out_path)
    elif fmt == "pdf":
        reports.tables_to_pdf(tables, out_path, document_title=title)
    else:
        raise ValueError(f"unsupported format: {fmt}")
    return out_path
    project_id = int(project_id)
    baseline_id = int(baseline_id) if baseline_id is not None else None
