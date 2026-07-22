"""Flat CSV export — one row per activity, predecessors collapsed into a
P6-style string ("A010, A020FS+5") so the file stays readable in Excel while
remaining machine-parseable."""
from __future__ import annotations

import csv
import io

from ..importers.base import ImportedSchedule

_HEADERS = [
    "Code", "Name", "WBS", "Duration (d)", "Milestone", "% Complete",
    "Actual Start", "Actual Finish", "Constraint", "Constraint Date",
    "Predecessors",
]


def _pred_string(sched: ImportedSchedule, src_id: str) -> str:
    code_of = {a.src_id: a.code for a in sched.activities}
    parts = []
    for r in sched.relationships:
        if r.succ_src_id != src_id:
            continue
        code = code_of.get(r.pred_src_id, r.pred_src_id)
        suffix = "" if r.rel_type == "FS" else r.rel_type
        lag = "" if not r.lag else (f"+{r.lag}" if r.lag > 0 else str(r.lag))
        parts.append(f"{code}{suffix}{lag}")
    return ", ".join(parts)


def write_csv(sched: ImportedSchedule) -> str:
    wbs_name = {w.src_id: w.code for w in (sched.wbs or [])}
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(_HEADERS)
    for a in sched.activities:
        writer.writerow([
            a.code, a.name, wbs_name.get(a.wbs_src_id or "", ""),
            a.duration, "Y" if a.is_milestone else "",
            a.percent_complete or 0,
            a.actual_start.isoformat() if a.actual_start else "",
            a.actual_finish.isoformat() if a.actual_finish else "",
            (a.constraint_type or "") if (a.constraint_type or "NONE") != "NONE" else "",
            a.constraint_date.isoformat() if a.constraint_date else "",
            _pred_string(sched, a.src_id),
        ])
    return buf.getvalue()
