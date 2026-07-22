"""Round-trip tests: export -> re-import must preserve the network.

An exporter that produces a file P6 or MS Project silently mangles is worse
than no exporter, so every check here re-parses its own output with the
existing importer rather than asserting on strings.
"""
from __future__ import annotations

from datetime import date

import pytest

from app.exporters import write_csv, write_msp_xml, write_xer
from app.importers.base import (ImpActivity, ImpCalendar, ImpRelationship,
                                ImportedSchedule, ImpWBS)
from app.importers.msp_importer import parse_msp_xml
from app.importers.xer_importer import parse_xer


@pytest.fixture
def sched() -> ImportedSchedule:
    return ImportedSchedule(
        project_name="COB-7 Battery Proper",
        project_start=date(2026, 1, 1),
        data_date=date(2026, 7, 22),
        source_format="fixture",
        calendars=[ImpCalendar(src_id="1", name="Standard 5-Day")],
        wbs=[
            ImpWBS(src_id="W1", parent_src_id=None, code="CIV", name="Civil"),
            ImpWBS(src_id="W2", parent_src_id="W1", code="CIV.FDN", name="Foundations"),
        ],
        activities=[
            ImpActivity(src_id="T1", code="A010", name="Mobilisation", duration=30,
                        wbs_src_id="W1", calendar_src_id="1", percent_complete=100.0,
                        actual_start=date(2026, 1, 1), actual_finish=date(2026, 2, 10)),
            ImpActivity(src_id="T2", code="A020", name="Battery Foundation", duration=90,
                        wbs_src_id="W2", calendar_src_id="1", percent_complete=45.0,
                        actual_start=date(2026, 2, 11)),
            ImpActivity(src_id="T3", code="A030", name="Steel Erection", duration=100,
                        wbs_src_id="W2", calendar_src_id="1",
                        constraint_type="SNET", constraint_date=date(2026, 9, 1)),
            ImpActivity(src_id="T4", code="M100", name="Foundation Complete",
                        duration=0, is_milestone=True, wbs_src_id="W2"),
        ],
        relationships=[
            ImpRelationship("T1", "T2", "FS", 0),
            ImpRelationship("T2", "T3", "SS", 15),
            ImpRelationship("T2", "T4", "FF", -5),
        ],
    )


# ---- XER --------------------------------------------------------------------

def test_xer_structure(sched):
    text = write_xer(sched)
    assert text.startswith("ERMHDR\t")
    assert text.rstrip().endswith("%E")
    for table in ("PROJECT", "CALENDAR", "PROJWBS", "TASK", "TASKPRED"):
        assert f"%T\t{table}" in text


def test_xer_roundtrip_activities(sched):
    back = parse_xer(write_xer(sched))
    assert len(back.activities) == len(sched.activities)
    by_code = {a.code: a for a in back.activities}
    assert set(by_code) == {"A010", "A020", "A030", "M100"}
    assert by_code["A020"].name == "Battery Foundation"
    assert by_code["A020"].duration == 90
    assert by_code["M100"].is_milestone is True


def test_xer_roundtrip_progress_and_actuals(sched):
    by_code = {a.code: a for a in parse_xer(write_xer(sched)).activities}
    assert by_code["A010"].percent_complete == pytest.approx(100.0)
    assert by_code["A010"].actual_start == date(2026, 1, 1)
    assert by_code["A010"].actual_finish == date(2026, 2, 10)
    assert by_code["A020"].actual_finish is None


def test_xer_roundtrip_relationships(sched):
    back = parse_xer(write_xer(sched))
    code = {a.src_id: a.code for a in back.activities}
    rels = {(code[r.pred_src_id], code[r.succ_src_id]): (r.rel_type, r.lag)
            for r in back.relationships}
    assert rels[("A010", "A020")] == ("FS", 0)
    assert rels[("A020", "A030")] == ("SS", 15)
    assert rels[("A020", "M100")] == ("FF", -5)


def test_xer_roundtrip_wbs(sched):
    back = parse_xer(write_xer(sched))
    assert len(back.wbs) == 2
    child = next(w for w in back.wbs if w.code == "CIV.FDN")
    parent = next(w for w in back.wbs if w.code == "CIV")
    assert child.parent_src_id == parent.src_id


def test_xer_roundtrip_constraint(sched):
    by_code = {a.code: a for a in parse_xer(write_xer(sched)).activities}
    assert by_code["A030"].constraint_type == "SNET"
    assert by_code["A030"].constraint_date == date(2026, 9, 1)


def test_xer_field_separators_are_stripped():
    s = ImportedSchedule(activities=[
        ImpActivity(src_id="T1", code="A\t010", name="Bad\nname", duration=1)])
    text = write_xer(s)
    task_rows = [ln for ln in text.splitlines()
                 if ln.startswith("%R") and "Bad" in ln]
    assert len(task_rows) == 1  # the newline did not split the record


# ---- MS Project XML ---------------------------------------------------------

def test_msp_roundtrip_activities(sched):
    back = parse_msp_xml(write_msp_xml(sched))
    names = {a.name for a in back.activities}
    for expected in ("Mobilisation", "Battery Foundation", "Steel Erection"):
        assert expected in names


def test_msp_roundtrip_durations(sched):
    back = parse_msp_xml(write_msp_xml(sched))
    by_name = {a.name: a for a in back.activities}
    assert by_name["Battery Foundation"].duration == 90
    assert by_name["Steel Erection"].duration == 100


def test_msp_roundtrip_relationships(sched):
    back = parse_msp_xml(write_msp_xml(sched))
    name = {a.src_id: a.name for a in back.activities}
    rels = {(name.get(r.pred_src_id), name.get(r.succ_src_id)): (r.rel_type, r.lag)
            for r in back.relationships}
    assert rels[("Mobilisation", "Battery Foundation")][0] == "FS"
    assert rels[("Battery Foundation", "Steel Erection")] == ("SS", 15)
    assert rels[("Battery Foundation", "Foundation Complete")] == ("FF", -5)


def test_msp_roundtrip_progress(sched):
    by_name = {a.name: a for a in parse_msp_xml(write_msp_xml(sched)).activities}
    assert by_name["Mobilisation"].percent_complete == pytest.approx(100.0)
    assert by_name["Mobilisation"].actual_finish == date(2026, 2, 10)


def test_msp_constraint_mapping_is_not_shifted(sched):
    """MSO must not come back as SNET — a mandatory constraint that degrades to
    'start no earlier than' silently changes the schedule."""
    s = ImportedSchedule(activities=[
        ImpActivity(src_id="T1", code="A1", name="Must Start On", duration=5,
                    constraint_type="MSO", constraint_date=date(2026, 5, 1)),
        ImpActivity(src_id="T2", code="A2", name="Finish No Later Than", duration=5,
                    constraint_type="FNLT", constraint_date=date(2026, 6, 1)),
    ])
    by_name = {a.name: a for a in parse_msp_xml(write_msp_xml(s)).activities}
    assert by_name["Must Start On"].constraint_type == "MSO"
    assert by_name["Finish No Later Than"].constraint_type == "FNLT"


def test_msp_is_valid_xml(sched):
    import xml.etree.ElementTree as ET
    ET.fromstring(write_msp_xml(sched))


# ---- CSV --------------------------------------------------------------------

def test_csv_rows_and_predecessor_notation(sched):
    text = write_csv(sched)
    rows = text.strip().split("\n")
    assert len(rows) == 5                      # header + 4 activities
    assert "A020SS+15" in text                 # P6-style relationship notation
    assert "A020FF-5" in text
    assert ",A010," in text or "A010" in rows[2]


def test_csv_is_parseable(sched):
    import csv as _csv
    import io
    rows = list(_csv.DictReader(io.StringIO(write_csv(sched))))
    assert len(rows) == 4
    assert rows[1]["Code"] == "A020"
    assert rows[1]["Duration (d)"] == "90"


# ---- cross-format -----------------------------------------------------------

def test_xer_to_msp_conversion(sched):
    """Import an XER, export it as MS Project XML: the usual P6 -> MSP hand-off."""
    from_xer = parse_xer(write_xer(sched))
    back = parse_msp_xml(write_msp_xml(from_xer))
    assert len(back.activities) == len(sched.activities)
    assert len(back.relationships) == len(sched.relationships)


def test_msp_lag_units_are_tenths_of_a_minute():
    """MSPDI LinkLag is always tenths of a minute; LagFormat is display only.
    A real MS Project file writes a 5-day lag as 24000."""
    from app.importers.msp_importer import _msp_lag_to_days
    assert _msp_lag_to_days(24000, "7") == 5
    assert _msp_lag_to_days(4800, "7") == 1
    assert _msp_lag_to_days(-24000, "7") == -5
    assert _msp_lag_to_days(0, "7") == 0
