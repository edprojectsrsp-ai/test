"""P1 — Multi-named schedule baselines + variance + Primavera XER export.

Baselines (P6-style, but unlimited): a named, immutable snapshot of every
activity's dates/duration/float/criticality at capture time. Variance compares
the CURRENT schedule against any baseline at activity level — start/finish/
duration slippage in days, float erosion, criticality flips, activities added
or removed — plus the project-finish variance that goes on the cover page.

XER export writes the tables our own importer (and Primavera P6) reads:
ERMHDR, PROJECT, CALENDAR, PROJWBS, TASK, TASKPRED — durations/lags in hours
(8-hour day, matching the importer), dates as 'YYYY-MM-DD HH:MM'. Round-trip
(export → XERParser) is part of the verification suite.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any, Optional

import psycopg2.extras


# ───────────────────────────────────────────────── baselines

def _dictcur(conn):
    return conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)


def ensure_tables(conn) -> None:
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS cpm_baselines (
                baseline_id SERIAL PRIMARY KEY,
                schedule_id INTEGER NOT NULL,
                name        TEXT NOT NULL,
                note        TEXT,
                project_finish DATE,
                created_by  VARCHAR(100),
                created_at  TIMESTAMPTZ NOT NULL DEFAULT now());
            CREATE TABLE IF NOT EXISTS cpm_baseline_activities (
                id SERIAL PRIMARY KEY,
                baseline_id INTEGER NOT NULL REFERENCES cpm_baselines(baseline_id) ON DELETE CASCADE,
                activity_id INTEGER NOT NULL,
                activity_code TEXT, activity_name TEXT,
                duration_days NUMERIC,
                early_start DATE, early_finish DATE,
                late_start DATE, late_finish DATE,
                total_float_days NUMERIC, is_critical BOOLEAN);
            CREATE INDEX IF NOT EXISTS idx_bl_acts ON cpm_baseline_activities(baseline_id);
        """)
    conn.commit()


def capture_baseline(conn, schedule_id: int, name: str,
                     note: Optional[str] = None,
                     created_by: Optional[str] = None) -> dict[str, Any]:
    """Snapshot the schedule as computed NOW (run CPM first for fresh dates)."""
    ensure_tables(conn)
    with _dictcur(conn) as cur:
        cur.execute("""
            SELECT activity_id, activity_code, activity_name,
                   COALESCE(estimated_duration_days, planned_duration_days,
                            baseline_duration_days, 0) AS duration_days,
                   early_start_date, early_finish_date,
                   late_start_date, late_finish_date,
                   total_float_days, is_critical
            FROM cpm_activities
            WHERE schedule_id = %s AND NOT is_deleted
            ORDER BY activity_id""", (schedule_id,))
        acts = cur.fetchall()
    if not acts:
        raise ValueError("Schedule has no activities")
    finish = max((a["early_finish_date"] for a in acts if a["early_finish_date"]),
                 default=None)
    with _dictcur(conn) as cur:
        cur.execute("""
            INSERT INTO cpm_baselines (schedule_id, name, note, project_finish, created_by)
            VALUES (%s, %s, %s, %s, %s) RETURNING baseline_id""",
            (schedule_id, name, note, finish, created_by))
        bid = cur.fetchone()["baseline_id"]
        for a in acts:
            cur.execute("""
                INSERT INTO cpm_baseline_activities
                  (baseline_id, activity_id, activity_code, activity_name,
                   duration_days, early_start, early_finish, late_start,
                   late_finish, total_float_days, is_critical)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                (bid, a["activity_id"], a["activity_code"], a["activity_name"],
                 a["duration_days"], a["early_start_date"], a["early_finish_date"],
                 a["late_start_date"], a["late_finish_date"],
                 a["total_float_days"], a["is_critical"]))
    conn.commit()
    return {"baseline_id": bid, "name": name, "activities": len(acts),
            "project_finish": finish.isoformat() if finish else None}


def list_baselines(conn, schedule_id: int) -> list[dict]:
    ensure_tables(conn)
    with _dictcur(conn) as cur:
        cur.execute("""
            SELECT b.baseline_id, b.name, b.note, b.project_finish, b.created_by,
                   b.created_at, COUNT(a.id) AS activity_count
            FROM cpm_baselines b
            LEFT JOIN cpm_baseline_activities a ON a.baseline_id = b.baseline_id
            WHERE b.schedule_id = %s
            GROUP BY b.baseline_id ORDER BY b.created_at DESC""", (schedule_id,))
        return [dict(r) for r in cur.fetchall()]


def _days(a: Optional[date], b: Optional[date]) -> Optional[int]:
    if a is None or b is None:
        return None
    return (a - b).days


def variance(conn, schedule_id: int, baseline_id: int) -> dict[str, Any]:
    """Current schedule vs baseline: per-activity slippage + summary."""
    ensure_tables(conn)
    with _dictcur(conn) as cur:
        cur.execute("SELECT * FROM cpm_baselines WHERE baseline_id=%s AND schedule_id=%s",
                    (baseline_id, schedule_id))
        bl = cur.fetchone()
        if not bl:
            raise ValueError("Baseline not found for this schedule")
        cur.execute("SELECT * FROM cpm_baseline_activities WHERE baseline_id=%s",
                    (baseline_id,))
        base = {r["activity_id"]: r for r in cur.fetchall()}
        cur.execute("""
            SELECT activity_id, activity_code, activity_name,
                   COALESCE(estimated_duration_days, planned_duration_days,
                            baseline_duration_days, 0) AS duration_days,
                   early_start_date, early_finish_date, total_float_days, is_critical
            FROM cpm_activities WHERE schedule_id=%s AND NOT is_deleted
            ORDER BY activity_id""", (schedule_id,))
        cur_acts = {r["activity_id"]: r for r in cur.fetchall()}

    rows, slipped, crit_gained = [], 0, []
    for aid, c in cur_acts.items():
        b = base.get(aid)
        if not b:
            rows.append({"activity_id": aid, "code": c["activity_code"],
                         "name": c["activity_name"], "status": "added",
                         "finish_var_days": None})
            continue
        fv = _days(c["early_finish_date"], b["early_finish"])
        sv = _days(c["early_start_date"], b["early_start"])
        dv = (float(c["duration_days"] or 0) - float(b["duration_days"] or 0))
        flv = (float(c["total_float_days"] or 0) - float(b["total_float_days"] or 0))
        went_critical = bool(c["is_critical"]) and not bool(b["is_critical"])
        if went_critical:
            crit_gained.append(c["activity_code"])
        if (fv or 0) > 0:
            slipped += 1
        rows.append({
            "activity_id": aid, "code": c["activity_code"], "name": c["activity_name"],
            "status": "changed" if (fv or sv or dv or flv or went_critical) else "unchanged",
            "baseline_start": b["early_start"].isoformat() if b["early_start"] else None,
            "current_start": c["early_start_date"].isoformat() if c["early_start_date"] else None,
            "start_var_days": sv,
            "baseline_finish": b["early_finish"].isoformat() if b["early_finish"] else None,
            "current_finish": c["early_finish_date"].isoformat() if c["early_finish_date"] else None,
            "finish_var_days": fv,
            "duration_var_days": dv,
            "float_var_days": flv,
            "baseline_critical": bool(b["is_critical"]),
            "current_critical": bool(c["is_critical"]),
            "went_critical": went_critical,
        })
    for aid, b in base.items():
        if aid not in cur_acts:
            rows.append({"activity_id": aid, "code": b["activity_code"],
                         "name": b["activity_name"], "status": "removed",
                         "finish_var_days": None})

    cur_finish = max((c["early_finish_date"] for c in cur_acts.values()
                      if c["early_finish_date"]), default=None)
    pf_var = _days(cur_finish, bl["project_finish"])
    rows.sort(key=lambda r: -(r.get("finish_var_days") or 0))
    return {
        "baseline": {"baseline_id": baseline_id, "name": bl["name"],
                     "project_finish": bl["project_finish"].isoformat()
                     if bl["project_finish"] else None,
                     "created_at": str(bl["created_at"])},
        "current_project_finish": cur_finish.isoformat() if cur_finish else None,
        "project_finish_variance_days": pf_var,
        "slipped_activities": slipped,
        "went_critical": crit_gained,
        "added": [r["code"] for r in rows if r["status"] == "added"],
        "removed": [r["code"] for r in rows if r["status"] == "removed"],
        "activities": rows,
    }


# ───────────────────────────────────────────────── XER export

def _xer_date(d: Optional[date]) -> str:
    return f"{d.isoformat()} 08:00" if d else ""


def export_xer(conn, schedule_id: int) -> str:
    """P6-compatible XER text for the schedule (tables our importer reads)."""
    with _dictcur(conn) as cur:
        cur.execute("SELECT * FROM cpm_schedules WHERE schedule_id=%s", (schedule_id,))
        sched = cur.fetchone()
        if not sched:
            raise ValueError("Schedule not found")
        cur.execute("""
            SELECT * FROM cpm_activities
            WHERE schedule_id=%s AND NOT is_deleted ORDER BY activity_id""",
            (schedule_id,))
        acts = cur.fetchall()
        cur.execute("""
            SELECT d.* FROM cpm_dependencies d
            JOIN cpm_activities p ON p.activity_id = d.predecessor_id
            WHERE p.schedule_id=%s""", (schedule_id,))
        deps = cur.fetchall()

    today = datetime.now().strftime("%Y-%m-%d")
    proj_id = 1000 + int(schedule_id)
    L: list[str] = []
    L.append(f"ERMHDR\t19.12\t{today}\tProject\tBrain\tProject Brain\tdbxDatabaseNoName\tProject Management\tINR")
    L.append("%T\tPROJECT")
    L.append("%F\tproj_id\tproj_short_name\tplan_start_date\tplan_end_date")
    L.append(f"%R\t{proj_id}\t{(sched['schedule_name'] or 'SCHED')[:20]}"
             f"\t{_xer_date(sched['project_start_date'])}"
             f"\t{_xer_date(sched.get('project_finish_date'))}")
    L.append("%T\tCALENDAR")
    L.append("%F\tclndr_id\tclndr_name\tday_hr_cnt")
    L.append("%R\t1\tStandard 8h\t8")
    L.append("%T\tPROJWBS")
    L.append("%F\twbs_id\tproj_id\twbs_short_name\twbs_name")
    L.append(f"%R\t{proj_id * 10}\t{proj_id}\tROOT\t{(sched['schedule_name'] or 'Schedule')}")
    L.append("%T\tTASK")
    L.append("%F\ttask_id\tproj_id\twbs_id\tclndr_id\ttask_code\ttask_name"
             "\tstatus_code\ttarget_drtn_hr_cnt\ttarget_start_date\ttarget_end_date"
             "\tact_start_date\tact_end_date\tphys_complete_pct")
    status_map = {"not_started": "TK_NotStart", "in_progress": "TK_Active",
                  "completed": "TK_Complete"}
    for a in acts:
        dur = float(a.get("estimated_duration_days")
                    or a.get("planned_duration_days")
                    or a.get("baseline_duration_days") or 0)
        L.append("%R\t" + "\t".join([
            str(a["activity_id"]), str(proj_id), str(proj_id * 10), "1",
            a["activity_code"] or f"A{a['activity_id']}",
            a["activity_name"] or "",
            status_map.get(str(a.get("activity_status") or "not_started"), "TK_NotStart"),
            f"{dur * 8:.1f}",
            _xer_date(a.get("early_start_date") or a.get("planned_start_date")),
            _xer_date(a.get("early_finish_date") or a.get("planned_finish_date")),
            _xer_date(a.get("actual_start_date")),
            _xer_date(a.get("actual_finish_date")),
            "0",
        ]))
    L.append("%T\tTASKPRED")
    L.append("%F\ttask_pred_id\ttask_id\tpred_task_id\tproj_id\tpred_proj_id\tpred_type\tlag_hr_cnt")
    for i, d in enumerate(deps, start=1):
        L.append("%R\t" + "\t".join([
            str(i), str(d["successor_id"]), str(d["predecessor_id"]),
            str(proj_id), str(proj_id),
            f"PR_{d['dependency_type'] or 'FS'}",
            f"{float(d['lag_days'] or 0) * 8:.1f}",
        ]))
    L.append("%E")
    return "\n".join(L) + "\n"
