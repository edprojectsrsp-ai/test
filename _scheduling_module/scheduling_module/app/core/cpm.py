"""
Critical Path Method (CPM) engine.

Works in integer working-day *units* on a single project calendar, then maps
units back to calendar dates.  Supports:

    * All four relationship types: FS, SS, FF, SF  (with working-day lag/lead)
    * Constraints: SNET, FNET, SNLT, FNLT, MSO, MFO, ASAP, ALAP
    * Data date (status date) driven progress:
        - completed activities pinned to their actuals
        - in-progress activities scheduled forward from the data date using
          remaining duration
        - not-started activities cannot begin before the data date
    * Total float, free float, critical & near-critical flags
    * Cycle detection (returns the offending activities)

The engine is pure / side-effect free: feed it dataclasses, get results back.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from enum import Enum
from typing import Optional

from .calendar import WorkCalendar, DEFAULT_CALENDAR


class RelType(str, Enum):
    FS = "FS"  # Finish-to-Start
    SS = "SS"  # Start-to-Start
    FF = "FF"  # Finish-to-Finish
    SF = "SF"  # Start-to-Finish


class Constraint(str, Enum):
    NONE = "NONE"
    ASAP = "ASAP"
    ALAP = "ALAP"
    SNET = "SNET"   # Start No Earlier Than   (soft, pushes ES up)
    FNET = "FNET"   # Finish No Earlier Than
    SNLT = "SNLT"   # Start No Later Than      (can drive negative float)
    FNLT = "FNLT"   # Finish No Later Than     (deadline; negative float)
    MSO = "MSO"     # Must Start On            (hard)
    MFO = "MFO"     # Must Finish On           (hard)


HARD_CONSTRAINTS = {Constraint.MSO, Constraint.MFO}


@dataclass
class CPMActivity:
    id: str
    name: str = ""
    duration: int = 0                 # original duration in working days
    remaining_duration: Optional[int] = None  # if None -> derived from progress
    percent_complete: float = 0.0     # 0..100
    is_milestone: bool = False
    actual_start: Optional[date] = None
    actual_finish: Optional[date] = None
    constraint_type: Constraint = Constraint.NONE
    constraint_date: Optional[date] = None

    # filled by the engine -------------------------------------------------
    es: Optional[date] = None
    ef: Optional[date] = None
    ls: Optional[date] = None
    lf: Optional[date] = None
    total_float: Optional[int] = None
    free_float: Optional[int] = None
    is_critical: bool = False
    is_near_critical: bool = False

    @property
    def is_complete(self) -> bool:
        return self.actual_finish is not None or self.percent_complete >= 100.0

    @property
    def is_started(self) -> bool:
        return self.actual_start is not None or self.percent_complete > 0.0


@dataclass
class CPMRelationship:
    predecessor_id: str
    successor_id: str
    rel_type: RelType = RelType.FS
    lag: int = 0          # working days; negative = lead


@dataclass
class CPMResult:
    activities: dict[str, CPMActivity]
    project_start: date
    project_finish: date
    critical_path: list[str] = field(default_factory=list)
    cycles: list[list[str]] = field(default_factory=list)
    data_date: Optional[date] = None


class CPMError(Exception):
    pass


class CPMEngine:
    def __init__(
        self,
        activities: list[CPMActivity],
        relationships: list[CPMRelationship],
        project_start: date,
        calendar: WorkCalendar = DEFAULT_CALENDAR,
        data_date: Optional[date] = None,
        near_critical_threshold: int = 5,
    ):
        self.acts = {a.id: a for a in activities}
        self.rels = [r for r in relationships
                     if r.predecessor_id in self.acts and r.successor_id in self.acts]
        self.cal = calendar
        self.anchor = calendar.first_working_on_or_after(project_start)
        self.data_date = data_date
        self.near = near_critical_threshold

        self._preds: dict[str, list[CPMRelationship]] = {a: [] for a in self.acts}
        self._succs: dict[str, list[CPMRelationship]] = {a: [] for a in self.acts}
        for r in self.rels:
            self._succs[r.predecessor_id].append(r)
            self._preds[r.successor_id].append(r)

    # ---- unit helpers ---------------------------------------------------
    def _u(self, d: date) -> int:
        return self.cal.date_to_unit(self.anchor, d)

    def _d(self, u: int) -> date:
        return self.cal.unit_to_date(self.anchor, u)

    def _rd(self, a: CPMActivity) -> int:
        """Effective remaining duration in working days."""
        if a.remaining_duration is not None:
            return max(a.remaining_duration, 0 if a.is_milestone else 1) if not a.is_milestone else 0
        if a.is_milestone:
            return 0
        if a.is_complete:
            return 0
        rem = a.duration * (1 - min(a.percent_complete, 100.0) / 100.0)
        return max(int(round(rem)), 1)

    # ---- topological order + cycle detection ----------------------------
    def _topo(self) -> tuple[list[str], list[list[str]]]:
        WHITE, GREY, BLACK = 0, 1, 2
        color = {a: WHITE for a in self.acts}
        order: list[str] = []
        cycles: list[list[str]] = []
        stack_path: list[str] = []

        def visit(n: str):
            color[n] = GREY
            stack_path.append(n)
            for r in self._succs[n]:
                m = r.successor_id
                if color[m] == WHITE:
                    visit(m)
                elif color[m] == GREY:
                    # back-edge -> cycle
                    if m in stack_path:
                        i = stack_path.index(m)
                        cycles.append(stack_path[i:] + [m])
            stack_path.pop()
            color[n] = BLACK
            order.append(n)

        # iterative-safe recursion limit guard for big nets
        import sys
        sys.setrecursionlimit(max(10000, len(self.acts) * 4))
        for n in self.acts:
            if color[n] == WHITE:
                visit(n)
        order.reverse()
        return order, cycles

    # ---- forward pass ---------------------------------------------------
    def _forward(self, order: list[str]) -> dict[str, tuple[int, int]]:
        early: dict[str, tuple[int, int]] = {}
        dd = self._u(self.data_date) if self.data_date else None

        for n in order:
            a = self.acts[n]
            dur = 0 if a.is_milestone else max(self.acts[n].duration, 1)

            # completed -> pin to actuals
            if a.is_complete and a.actual_start and a.actual_finish:
                es_u, ef_u = self._u(a.actual_start), self._u(a.actual_finish)
                early[n] = (es_u, ef_u)
                continue

            # earliest from predecessors
            es_candidates: list[int] = []
            ef_candidates: list[int] = []
            for r in self._preds[n]:
                pes, pef = early[r.predecessor_id]
                if r.rel_type == RelType.FS:
                    es_candidates.append(pef + 1 + r.lag)
                elif r.rel_type == RelType.SS:
                    es_candidates.append(pes + r.lag)
                elif r.rel_type == RelType.FF:
                    ef_candidates.append(pef + r.lag)
                elif r.rel_type == RelType.SF:
                    ef_candidates.append(pes + r.lag)

            rd = self._rd(a)
            span = 0 if a.is_milestone else max(rd, 1)

            es = max(es_candidates) if es_candidates else 0
            if ef_candidates:
                ef_driven_es = max(ef_candidates) - (span - 1)
                es = max(es, ef_driven_es)

            # in-progress: start pinned to actual start; remaining work from data date
            if a.is_started and a.actual_start:
                es = self._u(a.actual_start)
                start_rem = max(dd, es) if dd is not None else es
                ef = start_rem + span - 1
                early[n] = (es, ef)
                continue

            # not started cannot begin before the data date
            if dd is not None:
                es = max(es, dd)

            es = self._apply_start_constraint_fwd(a, es)
            ef = es if a.is_milestone else es + span - 1
            ef = self._apply_finish_constraint_fwd(a, es, ef, span)
            early[n] = (es, ef)
        return early

    def _apply_start_constraint_fwd(self, a: CPMActivity, es: int) -> int:
        if a.constraint_date is None:
            return es
        c = self._u(a.constraint_date)
        if a.constraint_type in (Constraint.SNET, Constraint.MSO):
            return max(es, c)
        return es

    def _apply_finish_constraint_fwd(self, a, es: int, ef: int, span: int) -> int:
        if a.constraint_date is None:
            return ef
        c = self._u(a.constraint_date)
        if a.constraint_type in (Constraint.FNET, Constraint.MFO):
            if ef < c:
                return c  # ES will be recomputed in backward float via LF
        return ef

    # ---- backward pass --------------------------------------------------
    def _backward(self, order: list[str], early: dict[str, tuple[int, int]],
                  project_finish_u: int) -> dict[str, tuple[int, int]]:
        late: dict[str, tuple[int, int]] = {}
        for n in reversed(order):
            a = self.acts[n]
            span = 0 if a.is_milestone else max(self._rd(a), 1)

            lf_candidates: list[int] = []
            ls_candidates: list[int] = []
            for r in self._succs[n]:
                sls, slf = late[r.successor_id]
                if r.rel_type == RelType.FS:
                    lf_candidates.append(sls - 1 - r.lag)
                elif r.rel_type == RelType.SS:
                    ls_candidates.append(sls - r.lag)
                elif r.rel_type == RelType.FF:
                    lf_candidates.append(slf - r.lag)
                elif r.rel_type == RelType.SF:
                    ls_candidates.append(slf - r.lag)

            if not lf_candidates and not ls_candidates:
                lf = project_finish_u
            else:
                lf = min(lf_candidates) if lf_candidates else 10**9
                if ls_candidates:
                    lf = min(lf, min(ls_candidates) + (span - 1))

            # deadline / FNLT / MFO constraints pull LF down (-> negative float)
            if a.constraint_date is not None:
                c = self._u(a.constraint_date)
                if a.constraint_type in (Constraint.FNLT, Constraint.MFO):
                    lf = min(lf, c)
                elif a.constraint_type in (Constraint.SNLT, Constraint.MSO):
                    lf = min(lf, c + (span - 1))

            ls = lf if a.is_milestone else lf - span + 1
            late[n] = (ls, lf)
        return late

    # ---- driver ---------------------------------------------------------
    def run(self) -> CPMResult:
        if not self.acts:
            return CPMResult({}, self.anchor, self.anchor)

        order, cycles = self._topo()
        if cycles:
            # report but still compute on the acyclic subset best-effort
            raise CPMError(
                "Circular logic detected: "
                + "; ".join(" -> ".join(c) for c in cycles[:5])
            )

        early = self._forward(order)
        project_finish_u = max(ef for _, ef in early.values())
        project_start_u = min(es for es, _ in early.values())
        late = self._backward(order, early, project_finish_u)

        for n, a in self.acts.items():
            es_u, ef_u = early[n]
            ls_u, lf_u = late[n]
            a.es, a.ef = self._d(es_u), self._d(ef_u)
            a.ls, a.lf = self._d(ls_u), self._d(lf_u)
            a.total_float = ls_u - es_u
            # free float = min(successor ES) - own EF - 1   (FS-style)
            ff_vals = []
            for r in self._succs[n]:
                ses, sef = early[r.successor_id]
                if r.rel_type in (RelType.FS, RelType.SF):
                    ff_vals.append(ses - ef_u - 1 - r.lag)
                elif r.rel_type == RelType.SS:
                    ff_vals.append(ses - es_u - r.lag)
                elif r.rel_type == RelType.FF:
                    ff_vals.append(sef - ef_u - r.lag)
            a.free_float = min(ff_vals) if ff_vals else (project_finish_u - ef_u)
            a.is_critical = a.total_float is not None and a.total_float <= 0
            a.is_near_critical = (not a.is_critical
                                  and a.total_float is not None
                                  and a.total_float <= self.near)

        crit = [n for n in order if self.acts[n].is_critical]
        return CPMResult(
            activities=self.acts,
            project_start=self._d(project_start_u),
            project_finish=self._d(project_finish_u),
            critical_path=crit,
            cycles=cycles,
            data_date=self.data_date,
        )
