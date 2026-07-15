"""Verification tests for the CPM engine. Run: python -m tests.test_cpm"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from datetime import date
from app.core.cpm import CPMEngine, CPMActivity, CPMRelationship, RelType, Constraint
from app.core.calendar import WorkCalendar


def classic_network():
    """A-B-D-F critical (len 16wd). C float 2, E float 5. Hand-verified."""
    acts = [
        CPMActivity("A", "A", 3),
        CPMActivity("B", "B", 4),
        CPMActivity("C", "C", 2),
        CPMActivity("D", "D", 5),
        CPMActivity("E", "E", 2),
        CPMActivity("F", "F", 4),
    ]
    rels = [
        CPMRelationship("A", "B", RelType.FS),
        CPMRelationship("A", "C", RelType.FS),
        CPMRelationship("B", "D", RelType.FS),
        CPMRelationship("C", "D", RelType.FS),
        CPMRelationship("C", "E", RelType.FS),
        CPMRelationship("D", "F", RelType.FS),
        CPMRelationship("E", "F", RelType.FS),
    ]
    return acts, rels


def test_classic():
    acts, rels = classic_network()
    eng = CPMEngine(acts, rels, project_start=date(2026, 6, 22))  # a Monday
    res = eng.run()
    a = res.activities

    # expected total floats (working days)
    exp_tf = {"A": 0, "B": 0, "C": 2, "D": 0, "E": 5, "F": 0}
    for k, v in exp_tf.items():
        assert a[k].total_float == v, f"TF[{k}]={a[k].total_float} expected {v}"

    # critical path
    assert res.critical_path == ["A", "B", "D", "F"], res.critical_path

    # free floats
    exp_ff = {"A": 0, "B": 0, "C": 0, "D": 0, "E": 5, "F": 0}
    for k, v in exp_ff.items():
        assert a[k].free_float == v, f"FF[{k}]={a[k].free_float} expected {v}"

    # date checks (Mon-Fri calendar, anchor Mon 2026-06-22)
    assert a["A"].es == date(2026, 6, 22)
    assert a["A"].ef == date(2026, 6, 24)        # 3 working days Mon-Wed
    assert a["F"].ef == res.project_finish
    # F occupies units 12..15 -> dates
    assert a["F"].es == date(2026, 7, 8)
    assert a["F"].ef == date(2026, 7, 13)
    print("  classic FS network ...................... OK")
    print(f"  project: {res.project_start} -> {res.project_finish}")


def test_relationship_types():
    # SS with lag 2: B starts 2 wd after A starts
    acts = [CPMActivity("A", "A", 5), CPMActivity("B", "B", 3)]
    rels = [CPMRelationship("A", "B", RelType.SS, lag=2)]
    res = CPMEngine(acts, rels, date(2026, 6, 22)).run()
    a = res.activities
    # SS lag 2: B starts 2 working days after A (A es unit0 -> B es unit2)
    assert a["B"].es == date(2026, 6, 24), a["B"].es

    # FF: successor finishes when predecessor finishes
    acts2 = [CPMActivity("A", "A", 5), CPMActivity("B", "B", 2)]
    rels2 = [CPMRelationship("A", "B", RelType.FF)]
    res2 = CPMEngine(acts2, rels2, date(2026, 6, 22)).run()
    assert res2.activities["A"].ef == res2.activities["B"].ef
    print("  SS lag + FF relationships ............... OK")


def test_negative_float_deadline():
    # impose a finish deadline earlier than the natural finish -> negative float
    acts, rels = classic_network()
    for a in acts:
        if a.id == "F":
            a.constraint_type = Constraint.FNLT
            a.constraint_date = date(2026, 7, 6)   # before natural 2026-07-13
    res = CPMEngine(acts, rels, date(2026, 6, 22)).run()
    assert res.activities["F"].total_float < 0, res.activities["F"].total_float
    assert res.activities["A"].total_float < 0
    print(f"  deadline -> negative float (F TF={res.activities['F'].total_float}) OK")


def test_data_date_progress():
    # A complete, B in progress; data date set; not-started can't precede it
    acts, rels = classic_network()
    for a in acts:
        if a.id == "A":
            a.actual_start = date(2026, 6, 22)
            a.actual_finish = date(2026, 6, 24)
            a.percent_complete = 100
        if a.id == "B":
            a.actual_start = date(2026, 6, 25)
            a.percent_complete = 50
            a.remaining_duration = 2
    res = CPMEngine(acts, rels, date(2026, 6, 22),
                    data_date=date(2026, 6, 29)).run()
    # C/E not started -> ES >= data date
    assert res.activities["C"].es >= date(2026, 6, 29)
    print("  data-date / progress scheduling ........ OK")


def test_cycle_detection():
    acts = [CPMActivity("X", "X", 1), CPMActivity("Y", "Y", 1)]
    rels = [CPMRelationship("X", "Y", RelType.FS),
            CPMRelationship("Y", "X", RelType.FS)]
    try:
        CPMEngine(acts, rels, date(2026, 6, 22)).run()
        assert False, "expected CPMError"
    except Exception as e:
        assert "Circular" in str(e)
    print("  circular-logic detection ............... OK")


if __name__ == "__main__":
    print("Running CPM engine tests:")
    test_classic()
    test_relationship_types()
    test_negative_float_deadline()
    test_data_date_progress()
    test_cycle_detection()
    print("\nALL CPM TESTS PASSED ✓")
