"""
Delay analysis engine.

Compares the current (updated) schedule against a saved baseline and classifies
each activity's slippage, criticality and impact on project completion.
Supports grouping/roll-up by any dimension (WBS, agency, discipline, package,
area, milestone) supplied on the activity records.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from enum import Enum
from typing import Optional

from .calendar import WorkCalendar, DEFAULT_CALENDAR
from .cpm import CPMActivity


class DelayClass(str, Enum):
    ON_TRACK = "on_track"
    SLIPPING = "slipping"           # finish later than baseline, has float
    CRITICAL_DELAY = "critical_delay"   # later AND on/near critical path
    AHEAD = "ahead"


@dataclass
class BaselineActivity:
    id: str
    bl_start: Optional[date] = None
    bl_finish: Optional[date] = None
    bl_duration: Optional[int] = None


@dataclass
class DelayRow:
    activity_id: str
    name: str
    bl_start: Optional[date]
    bl_finish: Optional[date]
    cur_start: Optional[date]
    cur_finish: Optional[date]
    start_var_wd: Optional[int]
    finish_var_wd: Optional[int]      # +ve = late
    total_float: Optional[int]
    is_critical: bool
    classification: DelayClass
    reason: str = ""
    group: dict[str, str] = field(default_factory=dict)


@dataclass
class DelayReport:
    rows: list[DelayRow]
    project_finish_variance_wd: Optional[int]
    delayed_count: int
    critical_delay_count: int

    def group_summary(self, dimension: str) -> dict[str, dict]:
        out: dict[str, dict] = {}
        for r in self.rows:
            key = r.group.get(dimension, "Unassigned")
            g = out.setdefault(key, {"count": 0, "delayed": 0,
                                     "critical_delayed": 0,
                                     "max_finish_var": 0})
            g["count"] += 1
            if r.finish_var_wd and r.finish_var_wd > 0:
                g["delayed"] += 1
                g["max_finish_var"] = max(g["max_finish_var"], r.finish_var_wd)
            if r.classification == DelayClass.CRITICAL_DELAY:
                g["critical_delayed"] += 1
        return out


class DelayAnalyzer:
    def __init__(
        self,
        current: list[CPMActivity],          # CPM already run (es/ef/floats set)
        baseline: list[BaselineActivity],
        calendar: WorkCalendar = DEFAULT_CALENDAR,
        baseline_project_finish: Optional[date] = None,
        current_project_finish: Optional[date] = None,
        near_critical_threshold: int = 5,
        reasons: Optional[dict[str, str]] = None,   # activity_id -> reason text
        groups: Optional[dict[str, dict[str, str]]] = None,  # id -> {dim: val}
    ):
        self.cur = {a.id: a for a in current}
        self.bl = {b.id: b for b in baseline}
        self.cal = calendar
        self.bl_pf = baseline_project_finish
        self.cur_pf = current_project_finish
        self.near = near_critical_threshold
        self.reasons = reasons or {}
        self.groups = groups or {}

    def _var(self, base: Optional[date], cur: Optional[date]) -> Optional[int]:
        if not base or not cur:
            return None
        # +ve means current is later than baseline
        return self.cal.working_days_between(base, cur) - 1 if cur >= base \
            else -(self.cal.working_days_between(cur, base) - 1)

    def analyze(self) -> DelayReport:
        rows: list[DelayRow] = []
        delayed = crit_delayed = 0
        for aid, a in self.cur.items():
            b = self.bl.get(aid)
            bl_s = b.bl_start if b else None
            bl_f = b.bl_finish if b else None
            sv = self._var(bl_s, a.es)
            fv = self._var(bl_f, a.ef)
            is_crit = bool(a.is_critical) or (
                a.total_float is not None and a.total_float <= self.near)

            if fv is None:
                cls = DelayClass.ON_TRACK
            elif fv > 0 and (a.is_critical or
                             (a.total_float is not None and a.total_float <= 0)):
                cls = DelayClass.CRITICAL_DELAY
            elif fv > 0:
                cls = DelayClass.SLIPPING
            elif fv < 0:
                cls = DelayClass.AHEAD
            else:
                cls = DelayClass.ON_TRACK

            if fv and fv > 0:
                delayed += 1
            if cls == DelayClass.CRITICAL_DELAY:
                crit_delayed += 1

            rows.append(DelayRow(
                activity_id=aid, name=a.name,
                bl_start=bl_s, bl_finish=bl_f,
                cur_start=a.es, cur_finish=a.ef,
                start_var_wd=sv, finish_var_wd=fv,
                total_float=a.total_float, is_critical=bool(a.is_critical),
                classification=cls,
                reason=self.reasons.get(aid, ""),
                group=self.groups.get(aid, {}),
            ))

        rows.sort(key=lambda r: (r.finish_var_wd or 0), reverse=True)
        proj_var = self._var(self.bl_pf, self.cur_pf)
        return DelayReport(rows, proj_var, delayed, crit_delayed)
