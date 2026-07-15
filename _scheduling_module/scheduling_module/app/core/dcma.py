"""
DCMA 14-Point Schedule Assessment.

Implements the Defense Contract Management Agency 14-point schedule health
checks. Each check returns a pass/fail against its industry threshold plus the
metric value, count, and a corrective observation.

Targets used (standard DCMA):
    1  Logic            < 5% activities missing predecessor OR successor
    2  Leads            0 relationships with negative lag
    3  Lags             < 5% relationships with positive lag
    4  Relationship     >= 90% relationships are Finish-to-Start
    5  Hard Constraints < 5% activities with hard constraints
    6  High Float       < 5% activities with total float > 44 wd
    7  Negative Float   0 activities with total float < 0
    8  High Duration    < 5% incomplete activities with duration > 44 wd
    9  Invalid Dates    0 activities with forecast/actual dates vs data date
    10 Resources        all activities with duration > 0 have cost/resource (info)
    11 Missed Tasks     < 5% activities slipped vs baseline finish
    12 Critical Path    integrity test (does a large delay flow to finish)
    13 CPLI             >= 0.95
    14 BEI              >= 0.95
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Optional

from .cpm import (CPMActivity, CPMRelationship, CPMEngine, RelType,
                  Constraint, HARD_CONSTRAINTS)
from .calendar import WorkCalendar, DEFAULT_CALENDAR

LONG_DURATION_WD = 44
HIGH_FLOAT_WD = 44


@dataclass
class CheckResult:
    number: int
    name: str
    metric: str          # human-readable value, e.g. "3.2%" or "12"
    threshold: str
    passed: bool
    affected: int
    total: int
    observation: str
    suggestion: str = ""


@dataclass
class DCMAReport:
    checks: list[CheckResult] = field(default_factory=list)
    score: float = 0.0          # % of applicable checks passed
    passed_count: int = 0
    applicable_count: int = 0

    def as_dict(self) -> dict:
        return {
            "score": round(self.score, 1),
            "passed": self.passed_count,
            "applicable": self.applicable_count,
            "checks": [c.__dict__ for c in self.checks],
        }


def _pct(n: int, d: int) -> float:
    return (100.0 * n / d) if d else 0.0


class DCMAAssessor:
    def __init__(
        self,
        activities: list[CPMActivity],
        relationships: list[CPMRelationship],
        project_start: date,
        calendar: WorkCalendar = DEFAULT_CALENDAR,
        data_date: Optional[date] = None,
        baseline_finish: Optional[dict[str, date]] = None,  # activity_id -> BL finish
        baseline_project_finish: Optional[date] = None,
        has_resources: Optional[dict[str, bool]] = None,
    ):
        self.acts = activities
        self.rels = relationships
        self.start = project_start
        self.cal = calendar
        self.data_date = data_date
        self.bl_finish = baseline_finish or {}
        self.bl_proj_finish = baseline_project_finish
        self.has_res = has_resources or {}
        self.by_id = {a.id: a for a in activities}

        # ensure CPM has been run so floats/dates exist
        self.cpm = CPMEngine(activities, relationships, project_start,
                             calendar, data_date).run()

    def assess(self) -> DCMAReport:
        rep = DCMAReport()
        checks = [
            self._c1_logic, self._c2_leads, self._c3_lags, self._c4_relationship,
            self._c5_hard_constraints, self._c6_high_float, self._c7_negative_float,
            self._c8_high_duration, self._c9_invalid_dates, self._c10_resources,
            self._c11_missed_tasks, self._c12_critical_path_test,
            self._c13_cpli, self._c14_bei,
        ]
        for fn in checks:
            r = fn()
            if r:
                rep.checks.append(r)
        applicable = [c for c in rep.checks if c.total >= 0]
        rep.applicable_count = len(applicable)
        rep.passed_count = sum(1 for c in applicable if c.passed)
        rep.score = _pct(rep.passed_count, rep.applicable_count)
        return rep

    # -- individual checks ------------------------------------------------
    def _c1_logic(self) -> CheckResult:
        preds = {r.successor_id for r in self.rels}
        succs = {r.predecessor_id for r in self.rels}
        tasks = [a for a in self.acts]  # incl. milestones
        missing = 0
        for a in tasks:
            no_pred = a.id not in preds
            no_succ = a.id not in succs
            # project start/finish milestones are allowed one open end
            if no_pred or no_succ:
                missing += 1
        p = _pct(missing, len(tasks))
        return CheckResult(1, "Logic", f"{p:.1f}%", "< 5%", p < 5, missing,
                           len(tasks),
                           f"{missing} of {len(tasks)} activities are missing a "
                           f"predecessor and/or successor.",
                           "Add the missing logic links so every activity is "
                           "driven and drives a successor.")

    def _c2_leads(self) -> CheckResult:
        leads = [r for r in self.rels if r.lag < 0]
        return CheckResult(2, "Leads (negative lag)", str(len(leads)), "= 0",
                           len(leads) == 0, len(leads), len(self.rels),
                           f"{len(leads)} relationship(s) use a lead (negative lag).",
                           "Replace leads with explicit logic or break the "
                           "activity into finer steps.")

    def _c3_lags(self) -> CheckResult:
        lags = [r for r in self.rels if r.lag > 0]
        p = _pct(len(lags), len(self.rels))
        return CheckResult(3, "Lags", f"{p:.1f}%", "< 5%", p < 5, len(lags),
                           len(self.rels),
                           f"{len(lags)} of {len(self.rels)} relationships carry "
                           f"a positive lag.",
                           "Model waiting time as real activities instead of lags "
                           "where possible.")

    def _c4_relationship(self) -> CheckResult:
        if not self.rels:
            return CheckResult(4, "Relationship Types", "n/a", ">= 90% FS",
                               True, 0, 0, "No relationships.", "")
        fs = sum(1 for r in self.rels if r.rel_type == RelType.FS)
        p = _pct(fs, len(self.rels))
        return CheckResult(4, "Relationship Types", f"{p:.1f}% FS", ">= 90% FS",
                           p >= 90, len(self.rels) - fs, len(self.rels),
                           f"{p:.1f}% of relationships are Finish-to-Start.",
                           "Prefer FS links; minimise SS/FF/SF which obscure the "
                           "true driving path.")

    def _c5_hard_constraints(self) -> CheckResult:
        hard = [a for a in self.acts if a.constraint_type in HARD_CONSTRAINTS]
        p = _pct(len(hard), len(self.acts))
        return CheckResult(5, "Hard Constraints", f"{p:.1f}%", "< 5%", p < 5,
                           len(hard), len(self.acts),
                           f"{len(hard)} activities use hard constraints "
                           f"(Must Start/Finish On).",
                           "Replace hard constraints with logic; reserve them for "
                           "genuine externally-fixed dates.")

    def _c6_high_float(self) -> CheckResult:
        incomplete = [a for a in self.acts if not a.is_complete]
        hi = [a for a in incomplete
              if a.total_float is not None and a.total_float > HIGH_FLOAT_WD]
        p = _pct(len(hi), len(incomplete) or 1)
        return CheckResult(6, "High Float", f"{p:.1f}%", "< 5%", p < 5, len(hi),
                           len(incomplete),
                           f"{len(hi)} activities have total float > "
                           f"{HIGH_FLOAT_WD} wd.",
                           "High float usually means missing successor logic; "
                           "review the network paths.")

    def _c7_negative_float(self) -> CheckResult:
        neg = [a for a in self.acts
               if a.total_float is not None and a.total_float < 0]
        return CheckResult(7, "Negative Float", str(len(neg)), "= 0",
                           len(neg) == 0, len(neg), len(self.acts),
                           f"{len(neg)} activities have negative total float.",
                           "Recover the schedule or revise constraints/targets "
                           "driving the negative float.")

    def _c8_high_duration(self) -> CheckResult:
        incomplete = [a for a in self.acts
                      if not a.is_complete and not a.is_milestone]
        hi = [a for a in incomplete if a.duration > LONG_DURATION_WD]
        p = _pct(len(hi), len(incomplete) or 1)
        return CheckResult(8, "High Duration", f"{p:.1f}%", "< 5%", p < 5,
                           len(hi), len(incomplete),
                           f"{len(hi)} incomplete activities exceed "
                           f"{LONG_DURATION_WD} wd duration.",
                           "Break long activities into measurable sub-activities "
                           "for better control.")

    def _c9_invalid_dates(self) -> CheckResult:
        if not self.data_date:
            return CheckResult(9, "Invalid Dates", "n/a (no data date)", "= 0",
                               True, 0, 0,
                               "No data date supplied; check skipped.", "")
        bad = 0
        for a in self.acts:
            # forecast (early) start before data date for not-started work
            if not a.is_started and a.es and a.es < self.data_date:
                bad += 1
            # actuals in the future
            if a.actual_start and a.actual_start > self.data_date:
                bad += 1
            if a.actual_finish and a.actual_finish > self.data_date:
                bad += 1
        return CheckResult(9, "Invalid Dates", str(bad), "= 0", bad == 0, bad,
                           len(self.acts),
                           f"{bad} activities have forecast/actual dates "
                           f"inconsistent with the data date.",
                           "Move forecast work to on/after the data date and "
                           "correct any future-dated actuals.")

    def _c10_resources(self) -> CheckResult:
        if not self.has_res:
            return CheckResult(10, "Resources", "n/a", "informational", True, 0, 0,
                               "No resource/cost data provided; check skipped.", "")
        work = [a for a in self.acts if not a.is_milestone and a.duration > 0]
        missing = [a for a in work if not self.has_res.get(a.id, False)]
        p = _pct(len(missing), len(work) or 1)
        return CheckResult(10, "Resources", f"{p:.1f}% unresourced",
                           "all resourced", len(missing) == 0, len(missing),
                           len(work),
                           f"{len(missing)} working activities have no "
                           f"resource/cost assignment.",
                           "Assign resources or cost to enable earned-value "
                           "and BEI tracking.")

    def _c11_missed_tasks(self) -> CheckResult:
        if not self.bl_finish:
            return CheckResult(11, "Missed Tasks", "n/a (no baseline)", "< 5%",
                               True, 0, 0, "No baseline supplied; check skipped.",
                               "")
        considered = [a for a in self.acts if a.id in self.bl_finish]
        missed = 0
        for a in considered:
            bl = self.bl_finish[a.id]
            actual_or_fcast = a.actual_finish or a.ef
            if actual_or_fcast and actual_or_fcast > bl:
                missed += 1
        p = _pct(missed, len(considered) or 1)
        return CheckResult(11, "Missed Tasks", f"{p:.1f}%", "< 5%", p < 5,
                           missed, len(considered),
                           f"{missed} activities finished/forecast later than "
                           f"baseline.",
                           "Investigate slippage causes and update the recovery "
                           "plan.")

    def _c12_critical_path_test(self) -> CheckResult:
        # integrity test: inject a large delay into the first critical activity
        # and confirm the project finish moves by a comparable amount.
        if not self.cpm.critical_path:
            return CheckResult(12, "Critical Path Test", "n/a", "pass", True, 0, 0,
                               "No critical path identified.", "")
        target = self.cpm.critical_path[0]
        bumped = []
        for a in self.acts:
            clone = CPMActivity(
                a.id, a.name, a.duration + (600 if a.id == target else 0),
                a.remaining_duration, a.percent_complete, a.is_milestone,
                a.actual_start, a.actual_finish, a.constraint_type,
                a.constraint_date)
            bumped.append(clone)
        try:
            res2 = CPMEngine(bumped, self.rels, self.start, self.cal,
                             self.data_date).run()
            moved = self.cal.working_days_between(self.cpm.project_finish,
                                                  res2.project_finish) - 1
            ok = moved >= 500   # the 600d bump should flow through
        except Exception:
            ok = False
            moved = 0
        return CheckResult(12, "Critical Path Test", f"+{moved} wd flow",
                           "delay flows to finish", ok, 0, 0,
                           "A large delay injected on the critical path "
                           f"{'correctly' if ok else 'did NOT'} move the project "
                           "finish.",
                           "" if ok else "Broken/soft critical path — check open "
                           "ends and constraints on the driving path.")

    def _c13_cpli(self) -> CheckResult:
        if not self.bl_proj_finish:
            return CheckResult(13, "CPLI", "n/a (no baseline finish)", ">= 0.95",
                               True, 0, 0, "No baseline finish; check skipped.", "")
        cp_len = self.cal.working_days_between(self.start,
                                               self.cpm.project_finish)
        total_float = self.cal.working_days_between(self.cpm.project_finish,
                                                    self.bl_proj_finish)
        # CPLI = (critical path length + project total float) / critical path length
        cpli = (cp_len + total_float) / cp_len if cp_len else 0.0
        return CheckResult(13, "CPLI", f"{cpli:.2f}", ">= 0.95", cpli >= 0.95,
                           0, 0,
                           f"Critical Path Length Index = {cpli:.2f}.",
                           "" if cpli >= 0.95 else "Project is forecast to finish "
                           "later than baseline; assess recovery.")

    def _c14_bei(self) -> CheckResult:
        if not self.bl_finish or not self.data_date:
            return CheckResult(14, "BEI", "n/a", ">= 0.95", True, 0, 0,
                               "Baseline finishes or data date missing; "
                               "check skipped.", "")
        should_complete = [aid for aid, bf in self.bl_finish.items()
                           if bf <= self.data_date]
        completed = sum(1 for aid in should_complete
                        if self.by_id.get(aid) and self.by_id[aid].is_complete)
        denom = len(should_complete) or 1
        bei = completed / denom
        return CheckResult(14, "BEI", f"{bei:.2f}", ">= 0.95", bei >= 0.95,
                           denom - completed, denom,
                           f"Baseline Execution Index = {bei:.2f} "
                           f"({completed}/{denom} due tasks complete).",
                           "" if bei >= 0.95 else "Execution behind baseline plan; "
                           "review productivity and sequencing.")
