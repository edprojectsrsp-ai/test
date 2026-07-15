"""
Working-time calendar engine.

The CPM engine works in integer *working-day units* on a single project
timeline, then maps unit indices <-> calendar dates through a WorkCalendar.
This keeps the network maths exact and lets the date conversion be the only
place that has to understand weekends/holidays.

Convention (P6 / MS Project compatible):
    * A "unit" is one whole working day.
    * An activity of duration D starting at unit s occupies units
      s, s+1, ..., s+D-1.  It starts on date(s) and finishes on date(s+D-1).
    * Therefore a 1-day task that starts Monday also finishes Monday.

Multi-calendar CPM (different calendars per activity driving the network) is a
documented Phase-2 enhancement; for the CPM pass a single project calendar is
used so that unit indices are comparable across activities.  Activity calendars
are still stored and used for duration spreading / resource loading.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta
from functools import lru_cache
from typing import Iterable


@dataclass
class WorkCalendar:
    """A simple working-time calendar.

    working_weekdays : ISO weekday numbers that are working days
                       (Mon=1 .. Sun=7).  Default = Mon–Fri.
    holidays         : set of specific non-working dates.
    exceptions_work  : set of dates forced to be WORKING even if weekend/holiday.
    """

    name: str = "Standard 5-Day"
    working_weekdays: frozenset[int] = field(
        default_factory=lambda: frozenset({1, 2, 3, 4, 5})
    )
    holidays: frozenset[date] = field(default_factory=frozenset)
    exceptions_work: frozenset[date] = field(default_factory=frozenset)

    # ---- basic predicate ------------------------------------------------
    def is_working_day(self, d: date) -> bool:
        if d in self.exceptions_work:
            return True
        if d in self.holidays:
            return False
        return d.isoweekday() in self.working_weekdays

    # ---- forward / backward stepping -----------------------------------
    def next_working_day(self, d: date) -> date:
        d += timedelta(days=1)
        while not self.is_working_day(d):
            d += timedelta(days=1)
        return d

    def prev_working_day(self, d: date) -> date:
        d -= timedelta(days=1)
        while not self.is_working_day(d):
            d -= timedelta(days=1)
        return d

    def first_working_on_or_after(self, d: date) -> date:
        while not self.is_working_day(d):
            d += timedelta(days=1)
        return d

    def first_working_on_or_before(self, d: date) -> date:
        while not self.is_working_day(d):
            d -= timedelta(days=1)
        return d

    # ---- unit <-> date mapping -----------------------------------------
    def add_working_days(self, start: date, n: int) -> date:
        """Return the date that is `n` working days from `start` (inclusive of
        start as unit 0). add_working_days(Mon, 0) == Mon; (Mon, 1) == Tue."""
        d = self.first_working_on_or_after(start)
        step = 1 if n >= 0 else -1
        for _ in range(abs(n)):
            d = self.next_working_day(d) if step > 0 else self.prev_working_day(d)
        return d

    def working_days_between(self, start: date, end: date) -> int:
        """Inclusive count of working days in [start, end]. Negative if reversed."""
        if start > end:
            return -self.working_days_between(end, start)
        d, count = self.first_working_on_or_after(start), 0
        while d <= end:
            count += 1
            d = self.next_working_day(d)
        return count

    # ---- project-anchored unit conversion ------------------------------
    def date_to_unit(self, anchor: date, d: date) -> int:
        """Working-day offset of d from the anchor (anchor == unit 0)."""
        d = self.first_working_on_or_after(d)
        return self.working_days_between(anchor, d) - 1

    def unit_to_date(self, anchor: date, unit: int) -> date:
        """Calendar date for a working-day unit index measured from anchor."""
        return self.add_working_days(anchor, unit)


DEFAULT_CALENDAR = WorkCalendar()


def calendar_from_spec(spec: dict | None) -> WorkCalendar:
    """Build a WorkCalendar from a JSON-ish dict (e.g. row from the DB)."""
    if not spec:
        return DEFAULT_CALENDAR
    wk = spec.get("working_weekdays") or [1, 2, 3, 4, 5]

    def _dates(key: str) -> frozenset[date]:
        vals: Iterable = spec.get(key) or []
        out = set()
        for v in vals:
            out.add(v if isinstance(v, date) else date.fromisoformat(str(v)))
        return frozenset(out)

    return WorkCalendar(
        name=spec.get("name", "Custom"),
        working_weekdays=frozenset(int(x) for x in wk),
        holidays=_dates("holidays"),
        exceptions_work=_dates("exceptions_work"),
    )
