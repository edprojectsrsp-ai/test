"""CPM engine math tests — pure forward/backward/float, no database.

CPMEngine's load()/persist() touch Postgres, but forward_pass /
backward_pass / compute_float operate purely on in-memory CPMActivity
objects. We build networks by hand, wire the graph, run the passes, and
assert against hand-calculated Early/Late dates, float and criticality.
These are the values a scheduler (P6 / Synchro) would compute for the
same network, so they lock in the engine's correctness.
"""
from datetime import date

from app.services.cpm_engine import CPMActivity, CPMEngine
from app.services.work_calendar import SEVEN_DAY, WorkCalendar


def _engine(project_start: date, activities: list[CPMActivity], calendar=SEVEN_DAY) -> CPMEngine:
    eng = CPMEngine.__new__(CPMEngine)          # skip __init__ (no DB)
    eng.schedule_id = 0
    eng.conn = None
    eng.warnings = []
    eng.project_start = project_start
    eng.project_finish = None
    eng.activities = {a.activity_id: a for a in activities}
    eng.calendar = calendar
    return eng


def _act(aid: int, code: str, dur: float) -> CPMActivity:
    return CPMActivity({"activity_id": aid, "activity_code": code,
                        "activity_name": code, "planned_duration_days": dur})


def _link(pred: CPMActivity, succ: CPMActivity, dep_type: str = "FS", lag: float = 0):
    pred.successors.append((succ, dep_type, lag))
    succ.predecessors.append((pred, dep_type, lag))


def _run(eng: CPMEngine):
    eng.forward_pass()
    eng.backward_pass()
    eng.compute_float()


def test_diamond_network_fs():
    """A3 -> B4 -> D2 and A3 -> C2 -> D2, start 2026-01-01.

    Critical path is A,B,D (finish 01-10, 9 days). C carries 2 days float.
    """
    A, B, C, D = _act(1, "A", 3), _act(2, "B", 4), _act(3, "C", 2), _act(4, "D", 2)
    _link(A, B); _link(A, C); _link(B, D); _link(C, D)
    eng = _engine(date(2026, 1, 1), [A, B, C, D])
    _run(eng)

    assert (A.early_start, A.early_finish) == (date(2026, 1, 1), date(2026, 1, 4))
    assert (B.early_start, B.early_finish) == (date(2026, 1, 4), date(2026, 1, 8))
    assert (C.early_start, C.early_finish) == (date(2026, 1, 4), date(2026, 1, 6))
    assert (D.early_start, D.early_finish) == (date(2026, 1, 8), date(2026, 1, 10))

    assert eng.project_finish == date(2026, 1, 10)
    assert A.total_float == 0 and B.total_float == 0 and D.total_float == 0
    assert C.total_float == 2
    assert A.is_critical and B.is_critical and D.is_critical
    assert not C.is_critical


def test_free_float_serial_chain():
    """A5 -> B2, B2 -> C3 with C also fed by a longer path forces B to hold
    free float distinct from total float."""
    A, B, C, X = _act(1, "A", 5), _act(2, "B", 2), _act(3, "C", 3), _act(4, "X", 10)
    _link(A, B); _link(B, C); _link(X, C)   # X(10) drives C, so B's finish has slack before C starts
    eng = _engine(date(2026, 1, 1), [A, B, C, X])
    _run(eng)

    # X finishes 01-11, C starts 01-11. B finishes 01-08 -> free float = 3 days.
    assert X.early_finish == date(2026, 1, 11)
    assert C.early_start == date(2026, 1, 11)
    assert B.early_finish == date(2026, 1, 8)
    assert B.free_float == 3
    assert X.is_critical and C.is_critical
    assert not B.is_critical


def test_ss_dependency_with_lag():
    """Start-to-Start with 2-day lag: B starts 2 days after A starts."""
    A, B = _act(1, "A", 6), _act(2, "B", 4)
    _link(A, B, "SS", 2)
    eng = _engine(date(2026, 1, 1), [A, B])
    _run(eng)

    assert A.early_start == date(2026, 1, 1)
    assert B.early_start == date(2026, 1, 3)          # A start + 2 lag
    assert B.early_finish == date(2026, 1, 7)
    # A finishes 01-07, B finishes 01-07 -> project finish 01-07
    assert eng.project_finish == date(2026, 1, 7)


def test_calendar_skips_weekend_in_forward_pass():
    """Same A3->B4 chain, but a Mon–Fri calendar pushes dates across weekends.

    Start Thu 2026-01-01 (a working day). A dur 3 working days: Thu, Fri, then
    skip Sat/Sun -> Mon. Engine convention EF = ES + 3 working days.
    """
    cal = WorkCalendar(working_weekdays=range(5), name="5-day")  # Mon–Fri
    A, B = _act(1, "A", 3), _act(2, "B", 4)
    _link(A, B)
    eng = _engine(date(2026, 1, 1), [A, B], calendar=cal)
    eng.forward_pass()
    # A starts Thu 01-01; +3 working days (Fri, Mon, Tue) -> EF 01-06 (skips weekend)
    assert A.early_start == date(2026, 1, 1)
    assert A.early_finish == date(2026, 1, 6)
    # B starts at A.EF, +4 working days -> lands mid next week, never on a weekend
    assert B.early_start == date(2026, 1, 6)
    assert B.early_finish.weekday() < 5           # finish is a weekday
    # every computed date is a working day
    for a in (A, B):
        assert cal.is_working(a.early_start)
        assert cal.is_working(a.early_finish)


def test_circular_dependency_is_reported_not_crashed():
    """A cycle must be caught as a warning, never infinite-loop."""
    A, B = _act(1, "A", 2), _act(2, "B", 2)
    _link(A, B); _link(B, A)                          # cycle
    eng = _engine(date(2026, 1, 1), [A, B])
    _run(eng)                                         # must return, not hang
    assert any("Circular" in w for w in eng.warnings)
