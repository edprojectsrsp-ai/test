"""
Primavera P6 .XER exporter — the return leg of importers/xer_importer.py.

XER is a tab-delimited table dump:

    ERMHDR\t<version>\t<date>\t<project>\t<user>\t...
    %T\tTABLE_NAME
    %F\tfield1\tfield2\t...
    %R\tval1\tval2\t...
    %E

We emit PROJECT, CALENDAR, PROJWBS, TASK and TASKPRED — the five tables P6
needs to reconstruct a network. Anything we did not import (resources, cost
accounts, UDFs) is deliberately omitted rather than faked; P6 tolerates their
absence, whereas invented rows corrupt the import.

Round-trip guarantee: parse_xer(write_xer(s)) preserves activity codes, names,
durations, milestone flags, % complete, actual dates, constraints, WBS
structure and every relationship with its type and lag. That property is
covered by tests/test_exporters.py.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Iterable

from ..importers.base import ImportedSchedule, ImpActivity

XER_VERSION = "19.12"

# inverse of the importer's maps
_REL_OUT = {"FS": "PR_FS", "SS": "PR_SS", "FF": "PR_FF", "SF": "PR_SF"}
_CONSTRAINT_OUT = {
    "MSO": "CS_MANDSTART", "MFO": "CS_MANDFIN",
    "SNET": "CS_MSOB", "SNLT": "CS_MSOA",
    "FNET": "CS_MEOB", "FNLT": "CS_MEOA",
    "ALAP": "CS_ALAP",
}


def _d(value: date | None) -> str:
    """XER dates are 'YYYY-MM-DD HH:MM'; empty string for null."""
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d %H:%M")
    return f"{value.isoformat()} 00:00"


def _clean(value) -> str:
    """Tabs and newlines are the record separators — they cannot survive in a field."""
    if value is None:
        return ""
    return str(value).replace("\t", " ").replace("\r", " ").replace("\n", " ")


def _table(name: str, fields: list[str], rows: Iterable[dict]) -> list[str]:
    out = [f"%T\t{name}", "%F\t" + "\t".join(fields)]
    for row in rows:
        out.append("%R\t" + "\t".join(_clean(row.get(f, "")) for f in fields))
    return out


def _task_type(act: ImpActivity) -> str:
    if act.is_milestone:
        # a milestone with no predecessors reads as a start milestone in P6
        return "TT_Mile"
    return "TT_Task"


def _status(act: ImpActivity) -> str:
    if act.actual_finish or (act.percent_complete or 0) >= 100:
        return "TK_Complete"
    if act.actual_start or (act.percent_complete or 0) > 0:
        return "TK_Active"
    return "TK_NotStart"


def write_xer(sched: ImportedSchedule, *, project_id: int = 1,
              user: str = "ProjectBrain") -> str:
    """Serialise a normalized schedule to XER text."""
    today = date.today()
    proj_short = (sched.project_name or "PROJ")[:20]

    lines: list[str] = [
        "\t".join(["ERMHDR", XER_VERSION, today.isoformat(), "Project",
                   user, user, "ProjectBrain", "Project Management", "USD"]),
    ]

    # ---- PROJECT -------------------------------------------------------------
    lines += _table("PROJECT",
        ["proj_id", "proj_short_name", "plan_start_date", "last_recalc_date",
         "clndr_id", "export_flag"],
        [{
            "proj_id": project_id,
            "proj_short_name": proj_short,
            "plan_start_date": _d(sched.project_start),
            "last_recalc_date": _d(sched.data_date or sched.project_start),
            "clndr_id": (sched.calendars[0].src_id if sched.calendars else "1"),
            "export_flag": "Y",
        }])

    # ---- CALENDAR ------------------------------------------------------------
    calendars = sched.calendars or []
    if calendars:
        lines += _table("CALENDAR",
            ["clndr_id", "clndr_name", "default_flag", "day_hr_cnt"],
            [{"clndr_id": c.src_id, "clndr_name": c.name,
              "default_flag": "Y" if i == 0 else "N", "day_hr_cnt": 8}
             for i, c in enumerate(calendars)])
    default_clndr = calendars[0].src_id if calendars else "1"

    # ---- PROJWBS -------------------------------------------------------------
    if sched.wbs:
        lines += _table("PROJWBS",
            ["wbs_id", "proj_id", "parent_wbs_id", "wbs_short_name", "wbs_name",
             "proj_node_flag"],
            [{"wbs_id": w.src_id, "proj_id": project_id,
              "parent_wbs_id": w.parent_src_id or "",
              "wbs_short_name": w.code, "wbs_name": w.name,
              "proj_node_flag": "N"} for w in sched.wbs])

    # ---- TASK ----------------------------------------------------------------
    lines += _table("TASK",
        ["task_id", "proj_id", "wbs_id", "clndr_id", "task_code", "task_name",
         "task_type", "status_code", "target_drtn_hr_cnt", "remain_drtn_hr_cnt",
         "phys_complete_pct", "act_start_date", "act_end_date",
         "cstr_type", "cstr_date"],
        [{
            "task_id": a.src_id,
            "proj_id": project_id,
            "wbs_id": a.wbs_src_id or "",
            "clndr_id": a.calendar_src_id or default_clndr,
            "task_code": a.code,
            "task_name": a.name,
            "task_type": _task_type(a),
            "status_code": _status(a),
            # P6 stores duration in hours against an 8h day
            "target_drtn_hr_cnt": (a.duration or 0) * 8,
            "remain_drtn_hr_cnt": round(
                (a.duration or 0) * 8 * (1 - (a.percent_complete or 0) / 100), 2),
            "phys_complete_pct": a.percent_complete or 0,
            "act_start_date": _d(a.actual_start),
            "act_end_date": _d(a.actual_finish),
            "cstr_type": _CONSTRAINT_OUT.get(a.constraint_type or "NONE", ""),
            "cstr_date": _d(a.constraint_date),
        } for a in sched.activities])

    # ---- TASKPRED ------------------------------------------------------------
    if sched.relationships:
        lines += _table("TASKPRED",
            ["task_pred_id", "task_id", "pred_task_id", "proj_id", "pred_proj_id",
             "pred_type", "lag_hr_cnt"],
            [{"task_pred_id": i + 1,
              "task_id": r.succ_src_id, "pred_task_id": r.pred_src_id,
              "proj_id": project_id, "pred_proj_id": project_id,
              "pred_type": _REL_OUT.get(r.rel_type, "PR_FS"),
              "lag_hr_cnt": (r.lag or 0) * 8}
             for i, r in enumerate(sched.relationships)])

    lines.append("%E")
    return "\n".join(lines) + "\n"
