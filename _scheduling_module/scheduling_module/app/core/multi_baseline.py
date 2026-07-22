"""
Multi-baseline comparison.

The existing variance path compares the live schedule against a single
baseline. P6 and SYNCHRO let a planner carry several (Original / Rebaseline-1 /
Current Approved / Client) and show them together, because the question at a
review is rarely "how far from one baseline" — it is "we have slipped against
the original, but are we holding the rebaseline the client accepted?".

This module produces one row per activity with a column per baseline, plus a
per-baseline summary of project-finish variance and slippage counts. It is
pure computation over already-loaded rows so it can be unit-tested without a
database.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Iterable, Optional


@dataclass(frozen=True)
class BaselineRef:
    baseline_id: int
    name: str
    project_finish: Optional[date] = None
    captured_at: Optional[date] = None


@dataclass(frozen=True)
class BaselineActivityRow:
    baseline_id: int
    code: str
    bl_start: Optional[date] = None
    bl_finish: Optional[date] = None
    bl_duration: Optional[int] = None
    bl_critical: bool = False


@dataclass(frozen=True)
class CurrentActivityRow:
    code: str
    name: str
    start: Optional[date] = None
    finish: Optional[date] = None
    duration: Optional[int] = None
    critical: bool = False
    percent_complete: float = 0.0


@dataclass
class CellVariance:
    baseline_id: int
    bl_start: Optional[date]
    bl_finish: Optional[date]
    start_var_days: Optional[int]
    finish_var_days: Optional[int]
    duration_var_days: Optional[int]
    went_critical: bool
    status: str                       # "on_track" | "slipped" | "ahead" | "added"


@dataclass
class ActivityComparison:
    code: str
    name: str
    current_start: Optional[date]
    current_finish: Optional[date]
    current_critical: bool
    percent_complete: float
    cells: dict[int, CellVariance] = field(default_factory=dict)
    worst_slip_days: int = 0          # largest finish slip across all baselines


@dataclass
class BaselineSummary:
    baseline_id: int
    name: str
    project_finish: Optional[date]
    current_project_finish: Optional[date]
    project_finish_variance_days: Optional[int]
    slipped: int
    ahead: int
    on_track: int
    added: int                        # in current, absent from this baseline
    removed: list[str]                # in this baseline, absent from current
    went_critical: list[str]


@dataclass
class MultiBaselineComparison:
    baselines: list[BaselineSummary]
    activities: list[ActivityComparison]

    def to_dict(self) -> dict:
        def d(v: Optional[date]) -> Optional[str]:
            return v.isoformat() if v else None
        return {
            "baselines": [{
                "baseline_id": b.baseline_id, "name": b.name,
                "project_finish": d(b.project_finish),
                "current_project_finish": d(b.current_project_finish),
                "project_finish_variance_days": b.project_finish_variance_days,
                "slipped": b.slipped, "ahead": b.ahead, "on_track": b.on_track,
                "added": b.added, "removed": b.removed,
                "went_critical": b.went_critical,
            } for b in self.baselines],
            "activities": [{
                "code": a.code, "name": a.name,
                "current_start": d(a.current_start),
                "current_finish": d(a.current_finish),
                "current_critical": a.current_critical,
                "percent_complete": a.percent_complete,
                "worst_slip_days": a.worst_slip_days,
                "cells": {str(bid): {
                    "bl_start": d(c.bl_start), "bl_finish": d(c.bl_finish),
                    "start_var_days": c.start_var_days,
                    "finish_var_days": c.finish_var_days,
                    "duration_var_days": c.duration_var_days,
                    "went_critical": c.went_critical,
                    "status": c.status,
                } for bid, c in a.cells.items()},
            } for a in self.activities],
        }


def _delta(current: Optional[date], baseline: Optional[date]) -> Optional[int]:
    """Positive = later than baseline (slip). None when either side is unknown."""
    if current is None or baseline is None:
        return None
    return (current - baseline).days


def compare_baselines(
    current: Iterable[CurrentActivityRow],
    baselines: Iterable[BaselineRef],
    baseline_rows: Iterable[BaselineActivityRow],
    current_project_finish: Optional[date] = None,
    slip_tolerance_days: int = 0,
) -> MultiBaselineComparison:
    """Compare the live schedule against every supplied baseline at once."""
    current_list = list(current)
    baseline_list = list(baselines)
    by_baseline: dict[int, dict[str, BaselineActivityRow]] = {
        b.baseline_id: {} for b in baseline_list}
    for row in baseline_rows:
        if row.baseline_id in by_baseline:
            by_baseline[row.baseline_id][row.code] = row

    if current_project_finish is None:
        finishes = [a.finish for a in current_list if a.finish]
        current_project_finish = max(finishes) if finishes else None

    comparisons: list[ActivityComparison] = []
    counters = {b.baseline_id: {"slipped": 0, "ahead": 0, "on_track": 0, "added": 0}
                for b in baseline_list}
    went_critical: dict[int, list[str]] = {b.baseline_id: [] for b in baseline_list}
    seen_codes: dict[int, set[str]] = {b.baseline_id: set() for b in baseline_list}

    for act in current_list:
        comp = ActivityComparison(
            code=act.code, name=act.name,
            current_start=act.start, current_finish=act.finish,
            current_critical=act.critical, percent_complete=act.percent_complete,
        )
        worst = 0
        for bl in baseline_list:
            row = by_baseline[bl.baseline_id].get(act.code)
            if row is None:
                comp.cells[bl.baseline_id] = CellVariance(
                    baseline_id=bl.baseline_id, bl_start=None, bl_finish=None,
                    start_var_days=None, finish_var_days=None,
                    duration_var_days=None, went_critical=False, status="added")
                counters[bl.baseline_id]["added"] += 1
                continue
            seen_codes[bl.baseline_id].add(act.code)
            fin_var = _delta(act.finish, row.bl_finish)
            crit_now = act.critical and not row.bl_critical
            if crit_now:
                went_critical[bl.baseline_id].append(act.code)
            if fin_var is None:
                status = "on_track"
                counters[bl.baseline_id]["on_track"] += 1
            elif fin_var > slip_tolerance_days:
                status = "slipped"
                counters[bl.baseline_id]["slipped"] += 1
                worst = max(worst, fin_var)
            elif fin_var < -slip_tolerance_days:
                status = "ahead"
                counters[bl.baseline_id]["ahead"] += 1
            else:
                status = "on_track"
                counters[bl.baseline_id]["on_track"] += 1
            comp.cells[bl.baseline_id] = CellVariance(
                baseline_id=bl.baseline_id,
                bl_start=row.bl_start, bl_finish=row.bl_finish,
                start_var_days=_delta(act.start, row.bl_start),
                finish_var_days=fin_var,
                duration_var_days=(
                    None if act.duration is None or row.bl_duration is None
                    else act.duration - row.bl_duration),
                went_critical=crit_now, status=status)
        comp.worst_slip_days = worst
        comparisons.append(comp)

    summaries: list[BaselineSummary] = []
    for bl in baseline_list:
        removed = sorted(set(by_baseline[bl.baseline_id]) - seen_codes[bl.baseline_id])
        c = counters[bl.baseline_id]
        summaries.append(BaselineSummary(
            baseline_id=bl.baseline_id, name=bl.name,
            project_finish=bl.project_finish,
            current_project_finish=current_project_finish,
            project_finish_variance_days=_delta(current_project_finish, bl.project_finish),
            slipped=c["slipped"], ahead=c["ahead"], on_track=c["on_track"],
            added=c["added"], removed=removed,
            went_critical=went_critical[bl.baseline_id],
        ))

    # worst slip first: a review wants the damage at the top
    comparisons.sort(key=lambda a: (-a.worst_slip_days, a.code))
    return MultiBaselineComparison(baselines=summaries, activities=comparisons)
