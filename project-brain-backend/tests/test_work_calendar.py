"""Work-calendar math tests.

2026-01-01 is a Thursday. Weekends and holidays are skipped by working-day
calendars. The 7-day calendar is a no-op (every day works) so it must match
naive calendar arithmetic — that's what keeps the CPM engine's behaviour
unchanged when no calendar is assigned.
"""
from datetime import date

from app.services.work_calendar import WorkCalendar, SEVEN_DAY, SIX_DAY

# Reference dates (2026):
#   Jan 1 Thu, Jan 2 Fri, Jan 3 Sat, Jan 4 Sun, Jan 5 Mon, Jan 6 Tue
FRI = date(2026, 1, 2)
SAT = date(2026, 1, 3)
SUN = date(2026, 1, 4)
MON = date(2026, 1, 5)


def test_seven_day_is_naive():
    """All-days-work calendar matches plain calendar arithmetic."""
    assert SEVEN_DAY.add_working_days(date(2026, 1, 1), 5) == date(2026, 1, 6)
    assert SEVEN_DAY.finish_from_start(date(2026, 1, 1), 3) == date(2026, 1, 3)
    assert SEVEN_DAY.working_days_between(date(2026, 1, 1), date(2026, 1, 10)) == 9


def test_five_day_skips_weekend():
    cal = WorkCalendar(working_weekdays=range(5), name="5-day")  # Mon–Fri
    # Fri + 1 working day -> Mon (skips Sat, Sun)
    assert cal.add_working_days(FRI, 1) == MON
    # a task Fri, duration 2 -> Fri then Mon
    assert cal.finish_from_start(FRI, 2) == MON
    # start snapped forward: Saturday is not a working day
    assert cal.next_working(SAT) == MON
    assert cal.prev_working(SAT) == FRI


def test_six_day_skips_only_sunday():
    # Sat is a working day in the 6-day calendar; Sun is not.
    assert SIX_DAY.is_working(SAT)
    assert not SIX_DAY.is_working(SUN)
    # Sat + 1 working day -> Mon (skip Sun)
    assert SIX_DAY.add_working_days(SAT, 1) == MON


def test_holiday_is_skipped():
    cal = WorkCalendar(working_weekdays=range(7), holidays={date(2026, 1, 2)}, name="hol")
    # Jan 1 Thu + 1 working day should skip the Jan 2 holiday -> Jan 3
    assert cal.add_working_days(date(2026, 1, 1), 1) == date(2026, 1, 3)
    assert not cal.is_working(date(2026, 1, 2))


def test_finish_one_day_task_same_day():
    cal = WorkCalendar(working_weekdays=range(5))
    assert cal.finish_from_start(date(2026, 1, 5), 1) == date(2026, 1, 5)  # Mon


def test_start_from_finish_inverts():
    cal = WorkCalendar(working_weekdays=range(5))
    start = date(2026, 1, 5)  # Mon
    fin = cal.finish_from_start(start, 4)      # Mon..Thu
    assert cal.start_from_finish(fin, 4) == start


def test_working_days_between_skips_weekend():
    cal = WorkCalendar(working_weekdays=range(5))
    # Mon Jan 5 -> Mon Jan 12 spans one weekend: 5 working days between
    assert cal.working_days_between(date(2026, 1, 5), date(2026, 1, 12)) == 5
    # negative direction
    assert cal.working_days_between(date(2026, 1, 12), date(2026, 1, 5)) == -5
