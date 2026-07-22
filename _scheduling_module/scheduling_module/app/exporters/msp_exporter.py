"""
MS Project XML (MSPDI) exporter — the return leg of importers/msp_importer.py.

Writes the Microsoft Project Data Interchange schema that MS Project, and most
other planning tools, open natively. This is the practical route to .mpp
round-tripping: .mpp itself is a proprietary binary OLE format with no reliable
pure-Python writer, so we emit XML and let MS Project save as .mpp. (If a true
.mpp writer is ever required, MPXJ via JPype is the industry-standard bridge —
the same library the .mpp importer already uses.)

Durations are written as ISO-8601 PTxxH0M0S against an 8-hour day, matching how
the importer reads them back.
"""
from __future__ import annotations

import xml.etree.ElementTree as ET
from datetime import date, datetime
from xml.dom import minidom

from ..importers.base import ImportedSchedule

_NS = "http://schemas.microsoft.com/project"

# inverse of the importer's maps
_REL_OUT = {"FF": "0", "FS": "1", "SF": "2", "SS": "3"}
_CONSTRAINT_OUT = {
    "ASAP": "0", "ALAP": "1", "MSO": "2", "MFO": "3",
    "SNET": "4", "SNLT": "5", "FNET": "6", "FNLT": "7",
}
HOURS_PER_DAY = 8


def _dt(value: date | None) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%dT%H:%M:%S")
    return f"{value.isoformat()}T08:00:00"


def _dur(days: int) -> str:
    return f"PT{int(days or 0) * HOURS_PER_DAY}H0M0S"


def _sub(parent: ET.Element, tag: str, text) -> ET.Element:
    el = ET.SubElement(parent, tag)
    el.text = "" if text is None else str(text)
    return el


def write_msp_xml(sched: ImportedSchedule, *, pretty: bool = True) -> str:
    """Serialise a normalized schedule to MS Project XML."""
    ET.register_namespace("", _NS)
    root = ET.Element(f"{{{_NS}}}Project")

    _sub(root, f"{{{_NS}}}Name", sched.project_name or "Project")
    _sub(root, f"{{{_NS}}}Title", sched.project_name or "Project")
    _sub(root, f"{{{_NS}}}Author", "Project Brain")
    _sub(root, f"{{{_NS}}}CreationDate", _dt(date.today()))
    if sched.project_start:
        _sub(root, f"{{{_NS}}}StartDate", _dt(sched.project_start))
    if sched.data_date:
        _sub(root, f"{{{_NS}}}StatusDate", _dt(sched.data_date))
    _sub(root, f"{{{_NS}}}ScheduleFromStart", "1")
    _sub(root, f"{{{_NS}}}MinutesPerDay", HOURS_PER_DAY * 60)
    _sub(root, f"{{{_NS}}}MinutesPerWeek", HOURS_PER_DAY * 60 * 5)
    _sub(root, f"{{{_NS}}}DaysPerMonth", "20")

    # ---- calendars -----------------------------------------------------------
    cals = ET.SubElement(root, f"{{{_NS}}}Calendars")
    for i, cal in enumerate(sched.calendars or []):
        c = ET.SubElement(cals, f"{{{_NS}}}Calendar")
        _sub(c, f"{{{_NS}}}UID", i + 1)
        _sub(c, f"{{{_NS}}}Name", cal.name)
        _sub(c, f"{{{_NS}}}IsBaseCalendar", "1")
        weekdays = ET.SubElement(c, f"{{{_NS}}}WeekDays")
        for dow in range(1, 8):           # MSP DayType 1=Sunday .. 7=Saturday
            wd = ET.SubElement(weekdays, f"{{{_NS}}}WeekDay")
            _sub(wd, f"{{{_NS}}}DayType", dow)
            # ImpCalendar.working_weekdays is ISO 1=Mon..7=Sun
            iso = 7 if dow == 1 else dow - 1
            _sub(wd, f"{{{_NS}}}DayWorking", "1" if iso in cal.working_weekdays else "0")

    # ---- tasks ---------------------------------------------------------------
    # WBS entries become summary tasks so the outline survives the round trip.
    uid_of: dict[str, int] = {}
    next_uid = 1
    tasks = ET.SubElement(root, f"{{{_NS}}}Tasks")

    wbs_by_id = {w.src_id: w for w in (sched.wbs or [])}

    def wbs_depth(src_id: str) -> int:
        depth, seen = 1, set()
        node = wbs_by_id.get(src_id)
        while node and node.parent_src_id and node.parent_src_id not in seen:
            seen.add(node.parent_src_id)
            node = wbs_by_id.get(node.parent_src_id)
            depth += 1
        return depth

    for w in sched.wbs or []:
        uid_of[f"wbs:{w.src_id}"] = next_uid
        t = ET.SubElement(tasks, f"{{{_NS}}}Task")
        _sub(t, f"{{{_NS}}}UID", next_uid)
        _sub(t, f"{{{_NS}}}ID", next_uid)
        _sub(t, f"{{{_NS}}}Name", w.name)
        _sub(t, f"{{{_NS}}}WBS", w.code)
        _sub(t, f"{{{_NS}}}OutlineLevel", wbs_depth(w.src_id))
        _sub(t, f"{{{_NS}}}Summary", "1")
        _sub(t, f"{{{_NS}}}Type", "1")
        next_uid += 1

    leaf_level_base = 1 if not sched.wbs else 2
    for a in sched.activities:
        uid_of[a.src_id] = next_uid
        t = ET.SubElement(tasks, f"{{{_NS}}}Task")
        _sub(t, f"{{{_NS}}}UID", next_uid)
        _sub(t, f"{{{_NS}}}ID", next_uid)
        _sub(t, f"{{{_NS}}}Name", a.name)
        _sub(t, f"{{{_NS}}}WBS", a.code)
        _sub(t, f"{{{_NS}}}OutlineLevel",
             leaf_level_base + (wbs_depth(a.wbs_src_id) - 1 if a.wbs_src_id else 0))
        _sub(t, f"{{{_NS}}}Summary", "0")
        _sub(t, f"{{{_NS}}}Milestone", "1" if a.is_milestone else "0")
        _sub(t, f"{{{_NS}}}Duration", _dur(a.duration))
        _sub(t, f"{{{_NS}}}DurationFormat", "7")   # days
        _sub(t, f"{{{_NS}}}PercentComplete", int(a.percent_complete or 0))
        if a.actual_start:
            _sub(t, f"{{{_NS}}}ActualStart", _dt(a.actual_start))
        if a.actual_finish:
            _sub(t, f"{{{_NS}}}ActualFinish", _dt(a.actual_finish))
        ctype = _CONSTRAINT_OUT.get(a.constraint_type or "ASAP")
        if ctype and ctype != "0":
            _sub(t, f"{{{_NS}}}ConstraintType", ctype)
            if a.constraint_date:
                _sub(t, f"{{{_NS}}}ConstraintDate", _dt(a.constraint_date))
        next_uid += 1

    # ---- relationships (written onto the successor) --------------------------
    for a in sched.activities:
        preds = [r for r in sched.relationships if r.succ_src_id == a.src_id]
        if not preds:
            continue
        task_el = None
        target_uid = uid_of[a.src_id]
        for t in tasks.findall(f"{{{_NS}}}Task"):
            uid_el = t.find(f"{{{_NS}}}UID")
            if uid_el is not None and uid_el.text == str(target_uid):
                task_el = t
                break
        if task_el is None:
            continue
        for r in preds:
            pred_uid = uid_of.get(r.pred_src_id)
            if pred_uid is None:
                continue
            link = ET.SubElement(task_el, f"{{{_NS}}}PredecessorLink")
            _sub(link, f"{{{_NS}}}PredecessorUID", pred_uid)
            _sub(link, f"{{{_NS}}}Type", _REL_OUT.get(r.rel_type, "1"))
            _sub(link, f"{{{_NS}}}LinkLag", int(r.lag or 0) * HOURS_PER_DAY * 600)
            _sub(link, f"{{{_NS}}}LagFormat", "7")   # days

    raw = ET.tostring(root, encoding="unicode", xml_declaration=False)
    xml = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n{raw}'
    if pretty:
        try:
            xml = minidom.parseString(xml).toprettyxml(indent="  ")
        except Exception:
            pass  # pretty printing is cosmetic; never fail an export over it
    return xml
