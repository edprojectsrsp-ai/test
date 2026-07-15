"""
Primavera P6 .XER importer.

XER is a documented tab-delimited export. Structure:

    ERMHDR\t<version>\t<date>\t...
    %T\tTABLE_NAME
    %F\tfield1\tfield2\t...
    %R\tval1\tval2\t...
    %R\t...
    %T\tNEXT_TABLE
    ...
    %E

We parse TASK (activities), TASKPRED (relationships), PROJWBS (WBS),
CALENDAR and PROJECT tables into the normalized ImportedSchedule.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from .base import (ImportedSchedule, ImpActivity, ImpRelationship, ImpWBS,
                   ImpCalendar)

# XER task_type / status mappings
_MILESTONE_TYPES = {"TT_Mile", "TT_FinMile", "TT_StartMile"}
_REL_MAP = {"PR_FS": "FS", "PR_SS": "SS", "PR_FF": "FF", "PR_SF": "SF"}
_CONSTRAINT_MAP = {
    "CS_MSO": "MSO", "CS_MEO": "MFO", "CS_MEOA": "FNLT", "CS_MEOB": "FNET",
    "CS_ALAP": "ALAP", "CS_MANDSTART": "MSO", "CS_MANDFIN": "MFO",
    "CS_MSOA": "SNLT", "CS_MSOB": "SNET",
}


def _parse_date(s: str) -> Optional[date]:
    if not s or not s.strip():
        return None
    s = s.strip()
    for fmt in ("%Y-%m-%d %H:%M", "%Y-%m-%d", "%d-%b-%y %H:%M", "%d-%b-%y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def parse_xer(text: str) -> ImportedSchedule:
    sched = ImportedSchedule(source_format="xer")
    tables: dict[str, list[dict]] = {}
    cur_table: Optional[str] = None
    cur_fields: list[str] = []

    for line in text.splitlines():
        if not line:
            continue
        parts = line.split("\t")
        tag = parts[0]
        if tag == "%T":
            cur_table = parts[1]
            tables[cur_table] = []
            cur_fields = []
        elif tag == "%F":
            cur_fields = parts[1:]
        elif tag == "%R" and cur_table is not None:
            row = dict(zip(cur_fields, parts[1:]))
            tables[cur_table].append(row)
        elif tag == "ERMHDR":
            sched.warnings.append(f"XER version {parts[1] if len(parts)>1 else '?'}")

    # PROJECT
    for p in tables.get("PROJECT", []):
        sched.project_name = p.get("proj_short_name") or sched.project_name
        sched.project_start = _parse_date(p.get("plan_start_date", ""))
        sched.data_date = _parse_date(p.get("last_recalc_date", "")) \
            or _parse_date(p.get("cur_data_date", ""))

    # CALENDAR (minimal — weekday mask parsing is vendor-specific; default 5-day)
    for c in tables.get("CALENDAR", []):
        sched.calendars.append(ImpCalendar(
            src_id=c.get("clndr_id", ""),
            name=c.get("clndr_name", "Calendar"),
        ))

    # PROJWBS
    for w in tables.get("PROJWBS", []):
        sched.wbs.append(ImpWBS(
            src_id=w.get("wbs_id", ""),
            parent_src_id=w.get("parent_wbs_id") or None,
            code=w.get("wbs_short_name", ""),
            name=w.get("wbs_name", ""),
        ))

    # TASK
    for t in tables.get("TASK", []):
        ttype = t.get("task_type", "")
        rem = t.get("remain_drtn_hr_cnt", "")
        tgt = t.get("target_drtn_hr_cnt", "")
        # P6 stores duration in hours; convert with 8h/day fallback
        dur_hr = _to_float(tgt) or _to_float(rem) or 0.0
        dur = max(int(round(dur_hr / 8.0)), 0)
        pct = _to_float(t.get("phys_complete_pct", "")) or 0.0
        sched.activities.append(ImpActivity(
            src_id=t.get("task_id", ""),
            code=t.get("task_code", t.get("task_id", "")),
            name=t.get("task_name", ""),
            duration=dur,
            is_milestone=ttype in _MILESTONE_TYPES,
            wbs_src_id=t.get("wbs_id") or None,
            calendar_src_id=t.get("clndr_id") or None,
            percent_complete=pct,
            actual_start=_parse_date(t.get("act_start_date", "")),
            actual_finish=_parse_date(t.get("act_end_date", "")),
            constraint_type=_CONSTRAINT_MAP.get(t.get("cstr_type", ""), "NONE"),
            constraint_date=_parse_date(t.get("cstr_date", "")),
        ))

    # TASKPRED
    for r in tables.get("TASKPRED", []):
        lag_hr = _to_float(r.get("lag_hr_cnt", "")) or 0.0
        sched.relationships.append(ImpRelationship(
            pred_src_id=r.get("pred_task_id", ""),
            succ_src_id=r.get("task_id", ""),
            rel_type=_REL_MAP.get(r.get("pred_type", "PR_FS"), "FS"),
            lag=int(round(lag_hr / 8.0)),
        ))

    if not sched.activities:
        sched.warnings.append("No TASK rows found in XER.")
    return sched


def _to_float(s: str) -> Optional[float]:
    try:
        return float(s)
    except (TypeError, ValueError):
        return None
