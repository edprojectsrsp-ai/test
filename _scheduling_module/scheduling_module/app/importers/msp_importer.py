"""
MS Project importers.

xml_importer  : native parser for the MS Project XML interchange format
                (Microsoft Project Plan, *.xml) using stdlib ElementTree.
mpp_importer  : *.mpp is a proprietary binary OLE format with no reliable
                pure-Python reader. The robust, industry-standard route is the
                MPXJ Java library bridged via JPype. This adapter uses MPXJ when
                available and otherwise raises a clear, actionable error.
"""
from __future__ import annotations

import xml.etree.ElementTree as ET
from datetime import date, datetime
from typing import Optional

from .base import (ImportedSchedule, ImpActivity, ImpRelationship, ImpWBS)

_NS = {"ms": "http://schemas.microsoft.com/project"}

# MSP relationship Type codes: 0=FF 1=FS 2=SF 3=SS
_MSP_REL = {"0": "FF", "1": "FS", "2": "SF", "3": "SS"}
# MSP ConstraintType: 0 ASAP,1 ALAP,2 MSO,3 MFO,4 SNET,5 SNLT,6 FNET,7 FNLT
# NB: codes 2 and 3 are the mandatory constraints. They were previously mapped
# to SNET/SNLT, which silently downgraded a Must-Start-On to a soft "no earlier
# than" and let the scheduler move work P6/MSP would have pinned.
_MSP_CONSTRAINT = {"0": "ASAP", "1": "ALAP", "2": "MSO", "3": "MFO",
                   "4": "SNET", "5": "SNLT", "6": "FNET", "7": "FNLT"}


def _txt(el, path: str) -> str:
    f = el.find(path, _NS)
    return f.text.strip() if f is not None and f.text else ""


def _pdate(s: str) -> Optional[date]:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s).date()
    except ValueError:
        try:
            return datetime.strptime(s[:10], "%Y-%m-%d").date()
        except ValueError:
            return None


def _duration_to_days(iso_dur: str) -> int:
    """MSP durations are ISO-8601 like 'PT40H0M0S'. 8h = 1 working day."""
    if not iso_dur or not iso_dur.startswith("PT"):
        return 0
    hours = 0.0
    num = ""
    for ch in iso_dur[2:]:
        if ch.isdigit() or ch == ".":
            num += ch
        else:
            v = float(num or 0)
            if ch == "H":
                hours += v
            elif ch == "M":
                hours += v / 60
            num = ""
    return max(int(round(hours / 8.0)), 0)


def parse_msp_xml(text: str) -> ImportedSchedule:
    sched = ImportedSchedule(source_format="xml")
    root = ET.fromstring(text)
    sched.project_name = _txt(root, "ms:Name") or _txt(root, "ms:Title") \
        or "MS Project Import"
    sched.project_start = _pdate(_txt(root, "ms:StartDate"))
    sched.data_date = _pdate(_txt(root, "ms:StatusDate")) \
        or _pdate(_txt(root, "ms:CurrentDate"))

    uid_to_code: dict[str, str] = {}

    tasks_el = root.find("ms:Tasks", _NS)
    if tasks_el is not None:
        for t in tasks_el.findall("ms:Task", _NS):
            uid = _txt(t, "ms:UID")
            if uid == "0":      # project summary task
                continue
            code = _txt(t, "ms:ID") or uid
            uid_to_code[uid] = uid    # we key by UID internally
            is_ms = _txt(t, "ms:Milestone") == "1"
            outline = _txt(t, "ms:OutlineLevel")
            summary = _txt(t, "ms:Summary") == "1"
            if summary:
                # treat summary tasks as WBS nodes
                sched.wbs.append(ImpWBS(
                    src_id=uid, parent_src_id=None,
                    code=_txt(t, "ms:OutlineNumber") or code,
                    name=_txt(t, "ms:Name")))
                continue
            pct = float(_txt(t, "ms:PercentComplete") or 0)
            sched.activities.append(ImpActivity(
                src_id=uid, code=code, name=_txt(t, "ms:Name"),
                duration=_duration_to_days(_txt(t, "ms:Duration")),
                is_milestone=is_ms,
                percent_complete=pct,
                actual_start=_pdate(_txt(t, "ms:ActualStart")),
                actual_finish=_pdate(_txt(t, "ms:ActualFinish")),
                constraint_type=_MSP_CONSTRAINT.get(
                    _txt(t, "ms:ConstraintType"), "NONE"),
                constraint_date=_pdate(_txt(t, "ms:ConstraintDate")),
            ))
            # predecessors are nested in the successor task
            for pl in t.findall("ms:PredecessorLink", _NS):
                pred_uid = _txt(pl, "ms:PredecessorUID")
                rtype = _MSP_REL.get(_txt(pl, "ms:Type"), "FS")
                # LinkLag is in tenths of a minute by default; convert to days
                lag_raw = float(_txt(pl, "ms:LinkLag") or 0)
                lag_fmt = _txt(pl, "ms:LagFormat")
                lag_days = _msp_lag_to_days(lag_raw, lag_fmt)
                sched.relationships.append(ImpRelationship(
                    pred_src_id=pred_uid, succ_src_id=uid,
                    rel_type=rtype, lag=lag_days))

    if not sched.activities:
        sched.warnings.append("No tasks parsed from MS Project XML.")
    return sched


# 1 working day = 8h = 480 min = 4800 tenths of a minute
_TENTHS_PER_DAY = 8 * 60 * 10


def _msp_lag_to_days(raw: float, fmt: str) -> int:
    """Convert an MSPDI LinkLag value to whole working days.

    In the MSPDI schema LinkLag is *always* expressed in tenths of a minute;
    LagFormat only controls how MS Project displays it. Treating LagFormat=7
    ("days") as meaning the value itself was in days turned a real 5-day lag
    (LinkLag=24000) into a 24,000-day lag, which pushed successors ~65 years
    out and quietly destroyed the critical path on any imported MSP file that
    used lag at all.
    """
    return int(round(raw / _TENTHS_PER_DAY))


# ---------------------------------------------------------------------------
class MPPImportError(RuntimeError):
    pass


def parse_mpp(file_path: str) -> ImportedSchedule:
    """Read a binary .mpp via MPXJ (Java) bridged through JPype.

    Requires:  pip install JPype1   and   the MPXJ jars on the classpath
    (see docs/IMPORTERS.md). If unavailable, raises MPPImportError with guidance
    so the API can return a clean 422 instead of crashing.
    """
    try:
        import jpype
        import jpype.imports  # noqa: F401
    except Exception as e:    # pragma: no cover - optional dependency
        raise MPPImportError(
            "Reading .mpp requires JPype + MPXJ. Install with "
            "`pip install JPype1`, place mpxj.jar on MPXJ_CLASSPATH, then retry. "
            "Alternatively, ask the user to export the plan as XML or XER."
        ) from e

    import os
    classpath = os.environ.get("MPXJ_CLASSPATH")
    if not classpath:
        raise MPPImportError("Set MPXJ_CLASSPATH to the MPXJ jar(s).")
    if not jpype.isJVMStarted():
        jpype.startJVM(classpath=classpath.split(os.pathsep))

    from net.sf.mpxj.reader import UniversalProjectReader  # type: ignore

    reader = UniversalProjectReader()
    prj = reader.read(file_path)
    sched = ImportedSchedule(source_format="mpp")
    sched.project_name = str(prj.getProjectProperties().getName() or "MPP Import")

    for task in prj.getTasks():
        if task.getID() is None or task.getSummary():
            continue
        uid = str(task.getUniqueID())
        dur = task.getDuration()
        days = int(round(dur.getDuration())) if dur else 0
        sched.activities.append(ImpActivity(
            src_id=uid, code=str(task.getID()),
            name=str(task.getName() or ""),
            duration=days,
            is_milestone=bool(task.getMilestone()),
            percent_complete=float(task.getPercentageComplete() or 0),
        ))
        for rel in task.getPredecessors():
            sched.relationships.append(ImpRelationship(
                pred_src_id=str(rel.getTargetTask().getUniqueID()),
                succ_src_id=uid,
                rel_type=str(rel.getType())[:2],
                lag=int(round(rel.getLag().getDuration())) if rel.getLag() else 0,
            ))
    return sched
