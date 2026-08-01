"""Work calendars for the CPM engine.

A schedule's durations are expressed in *working days*. Without a calendar
the engine treats every calendar day as a working day (the historical
behaviour). A WorkCalendar lets non-working days — weekends and holidays —
be skipped, exactly as Primavera P6 / Synchro do, so computed Early/Late
dates land on real working days and durations mean "N days of work".

Duration convention (matches P6): an activity with duration D that starts on
working day S finishes at the end of the (S + D - 1)-th working day. So a
1-day task starts and finishes the same working day; add_working_days(start, 0)
== start (snapped forward to a working day), and a task's finish is
add_working_days(start, duration - 1).

The default calendar (`SEVEN_DAY`) treats all days as working, which keeps
the engine's behaviour identical to before calendars existed.
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Iterable, Optional


class WorkCalendar:
    """Working-day calendar.

    working_weekdays: set of Python weekday() ints that are working days
        (Mon=0 .. Sun=6). Default Mon–Sat (P6's common 6-day construction week).
    holidays: set of specific dates that are non-working regardless of weekday.
    """

    def __init__(self, working_weekdays: Optional[Iterable[int]] = None,
                 holidays: Optional[Iterable[date]] = None,
                 name: str = "calendar"):
        self.name = name
        self.working_weekdays = set(
            working_weekdays if working_weekdays is not None else range(6)  # Mon–Sat
        )
        if not self.working_weekdays:
            raise ValueError("A calendar must have at least one working weekday")
        self.holidays = set(holidays or ())

    # ── predicates ────────────────────────────────────────────────
    def is_working(self, d: date) -> bool:
        return d.weekday() in self.working_weekdays and d not in self.holidays

    def next_working(self, d: date) -> date:
        """First working day on or after d."""
        cur = d
        # bounded loop: at most 7 + a holiday run; guard at 400 to be safe
        for _ in range(400):
            if self.is_working(cur):
                return cur
            cur += timedelta(days=1)
        raise ValueError(f"No working day found within 400 days of {d} in calendar {self.name}")

    def prev_working(self, d: date) -> date:
        """Last working day on or before d."""
        cur = d
        for _ in range(400):
            if self.is_working(cur):
                return cur
            cur -= timedelta(days=1)
        raise ValueError(f"No working day found within 400 days before {d} in calendar {self.name}")

    # ── arithmetic ────────────────────────────────────────────────
    def add_working_days(self, d: date, working_days: float) -> date:
        """Advance `working_days` working days from d.

        The start day itself is snapped forward to a working day, then we step
        forward. add_working_days(d, 0) == next_working(d). Negative counts step
        backward (used by finish-driven dependency math)."""
        n = int(round(working_days))
        cur = self.next_working(d) if n >= 0 else self.prev_working(d)
        step = 1 if n >= 0 else -1
        remaining = abs(n)
        while remaining > 0:
            cur += timedelta(days=step)
            if self.is_working(cur):
                remaining -= 1
        return cur

    def finish_from_start(self, start: date, duration_days: float) -> date:
        """Finish date for a task starting `start` with `duration_days` of work.

        1-day task -> finishes same working day. duration D -> start + (D-1)
        working days, on a working day."""
        dur = max(int(round(duration_days)), 1)
        return self.add_working_days(self.next_working(start), dur - 1)

    def start_from_finish(self, finish: date, duration_days: float) -> date:
        """Inverse of finish_from_start: latest start given a finish + duration."""
        dur = max(int(round(duration_days)), 1)
        return self.add_working_days(self.prev_working(finish), -(dur - 1))

    def working_days_between(self, start: date, end: date) -> int:
        """Count working days in [start, end] inclusive of both ends when working.

        Returns a signed count consistent with float math: if end < start the
        result is negative. Used for float = LS - ES in working days."""
        if start == end:
            return 0
        sign = 1 if end >= start else -1
        lo, hi = (start, end) if sign > 0 else (end, start)
        # count working days strictly after lo up to and including hi
        count, cur = 0, lo
        while cur < hi:
            cur += timedelta(days=1)
            if self.is_working(cur):
                count += 1
        return sign * count


# All days work — preserves the engine's pre-calendar behaviour exactly.
SEVEN_DAY = WorkCalendar(working_weekdays=range(7), name="7-day")

# Common Indian construction 6-day week (Sunday off), no holidays by default.
SIX_DAY = WorkCalendar(working_weekdays=range(6), name="6-day")
