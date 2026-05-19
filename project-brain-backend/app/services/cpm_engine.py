"""
CPM Engine — Critical Path Method calculation.

Algorithm:
  1. Forward pass:  compute Early Start (ES) and Early Finish (EF)
                    ES = max(EF of all predecessors + lag)
                    EF = ES + duration
  2. Backward pass: compute Late Finish (LF) and Late Start (LS)
                    LF = min(LS of successors - lag)
                    LS = LF - duration
  3. Float:         Total Float = LS - ES = LF - EF
                    Free Float  = (min ES of successors) - EF
  4. Critical:      activity is critical when Total Float ≤ 0

Handles all 4 dependency types (FS, SS, FF, SF) and lag/lead.

Usage:
    engine = CPMEngine(schedule_id=42, db_conn=conn)
    result = engine.run()
    # result = {'critical_path': [...], 'project_finish': date, ...}
"""
from __future__ import annotations
from datetime import date, timedelta
from typing import Optional
import logging
import psycopg2
import psycopg2.extras

logger = logging.getLogger(__name__)


class CPMActivity:
    """In-memory activity for CPM math."""
    def __init__(self, row: dict):
        self.activity_id: int = row['activity_id']
        self.activity_code: str = row.get('activity_code') or f"A{row['activity_id']}"
        self.activity_name: str = row['activity_name']
        # Use estimated > planned > baseline duration as best available
        self.duration: float = float(
            row.get('estimated_duration_days')
            or row.get('planned_duration_days')
            or row.get('baseline_duration_days')
            or 0
        )
        self.constraint_type: str = row.get('constraint_type') or 'none'
        self.constraint_date: Optional[date] = row.get('constraint_date')
        self.activity_status: str = row.get('activity_status') or 'not_started'
        self.actual_start: Optional[date] = row.get('actual_start_date')
        self.actual_finish: Optional[date] = row.get('actual_finish_date')

        # CPM-computed
        self.early_start: Optional[date] = None
        self.early_finish: Optional[date] = None
        self.late_start: Optional[date] = None
        self.late_finish: Optional[date] = None
        self.total_float: float = 0.0
        self.free_float: float = 0.0
        self.is_critical: bool = False

        # Graph
        self.predecessors: list[tuple['CPMActivity', str, float]] = []  # (act, type, lag)
        self.successors: list[tuple['CPMActivity', str, float]] = []


def _add_days(d: Optional[date], days: float) -> Optional[date]:
    if d is None: return None
    return d + timedelta(days=int(round(days)))


def _max_date(dates: list[Optional[date]]) -> Optional[date]:
    valid = [d for d in dates if d is not None]
    return max(valid) if valid else None


def _min_date(dates: list[Optional[date]]) -> Optional[date]:
    valid = [d for d in dates if d is not None]
    return min(valid) if valid else None


def _date_diff_days(d1: Optional[date], d2: Optional[date]) -> float:
    if d1 is None or d2 is None: return 0.0
    return float((d1 - d2).days)


class CPMEngine:
    def __init__(self, schedule_id: int, conn):
        self.schedule_id = schedule_id
        self.conn = conn
        self.activities: dict[int, CPMActivity] = {}
        self.project_start: Optional[date] = None
        self.project_finish: Optional[date] = None
        self.warnings: list[str] = []

    def load(self):
        """Load activities + dependencies + schedule meta from DB."""
        cur = self.conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""
            SELECT project_start_date, data_date FROM cpm_schedules
            WHERE schedule_id=%s
        """, (self.schedule_id,))
        sched = cur.fetchone()
        if not sched:
            raise ValueError(f"Schedule {self.schedule_id} not found")
        self.project_start = sched['project_start_date'] or sched['data_date'] or date.today()

        cur.execute("""
            SELECT activity_id, activity_code, activity_name,
                   planned_duration_days, baseline_duration_days, estimated_duration_days,
                   constraint_type::text, constraint_date,
                   activity_status::text,
                   actual_start_date, actual_finish_date,
                   planned_start_date, planned_finish_date
            FROM cpm_activities
            WHERE schedule_id=%s AND NOT is_deleted
            ORDER BY activity_id
        """, (self.schedule_id,))
        for row in cur.fetchall():
            act = CPMActivity(dict(row))
            self.activities[act.activity_id] = act

        # Load dependencies
        cur.execute("""
            SELECT predecessor_id, successor_id, dependency_type::text, lag_days
            FROM cpm_dependencies d
            JOIN cpm_activities pa ON pa.activity_id = d.predecessor_id
            WHERE pa.schedule_id=%s
        """, (self.schedule_id,))
        for row in cur.fetchall():
            pred = self.activities.get(row['predecessor_id'])
            succ = self.activities.get(row['successor_id'])
            if not pred or not succ:
                self.warnings.append(f"Dependency references missing activity: {row}")
                continue
            dep_type = row['dependency_type'] or 'FS'
            lag = float(row['lag_days'] or 0)
            pred.successors.append((succ, dep_type, lag))
            succ.predecessors.append((pred, dep_type, lag))

    def _topological_order(self) -> list[CPMActivity]:
        """Return activities in topologically-sorted order (predecessors first)."""
        visited: set[int] = set()
        order: list[CPMActivity] = []
        recursion_guard: set[int] = set()

        def visit(act: CPMActivity):
            if act.activity_id in visited:
                return
            if act.activity_id in recursion_guard:
                self.warnings.append(f"Circular dependency detected at activity {act.activity_code}")
                return
            recursion_guard.add(act.activity_id)
            for pred, _, _ in act.predecessors:
                visit(pred)
            recursion_guard.discard(act.activity_id)
            visited.add(act.activity_id)
            order.append(act)

        for act in self.activities.values():
            visit(act)
        return order

    def forward_pass(self):
        """Compute Early Start and Early Finish for every activity."""
        for act in self._topological_order():
            # If activity has actual start, use it (in-progress activities)
            if act.actual_start:
                act.early_start = act.actual_start
            elif not act.predecessors:
                act.early_start = self.project_start
            else:
                candidates: list[date] = []
                for pred, dep_type, lag in act.predecessors:
                    if dep_type == 'FS' and pred.early_finish:
                        candidates.append(_add_days(pred.early_finish, lag))
                    elif dep_type == 'SS' and pred.early_start:
                        candidates.append(_add_days(pred.early_start, lag))
                    elif dep_type == 'FF' and pred.early_finish:
                        # Successor must finish at or after pred's EF + lag; back-calc start
                        ef_constraint = _add_days(pred.early_finish, lag)
                        candidates.append(_add_days(ef_constraint, -act.duration))
                    elif dep_type == 'SF' and pred.early_start:
                        sf_constraint = _add_days(pred.early_start, lag)
                        candidates.append(_add_days(sf_constraint, -act.duration))
                act.early_start = _max_date(candidates) or self.project_start

            # Apply constraints
            if act.constraint_type == 'start_no_earlier_than' and act.constraint_date:
                if act.early_start < act.constraint_date:
                    act.early_start = act.constraint_date
            elif act.constraint_type == 'must_start_on' and act.constraint_date:
                act.early_start = act.constraint_date

            # EF = ES + duration
            if act.actual_finish:
                act.early_finish = act.actual_finish
            else:
                act.early_finish = _add_days(act.early_start, act.duration)

        # Project finish = max EF
        self.project_finish = _max_date([a.early_finish for a in self.activities.values()])

    def backward_pass(self):
        """Compute Late Finish and Late Start, walking backward."""
        order = list(reversed(self._topological_order()))
        for act in order:
            if not act.successors:
                # Leaf node — LF = project finish (or actual finish if completed)
                act.late_finish = act.actual_finish or self.project_finish
            else:
                candidates: list[date] = []
                for succ, dep_type, lag in act.successors:
                    if dep_type == 'FS' and succ.late_start:
                        candidates.append(_add_days(succ.late_start, -lag))
                    elif dep_type == 'SS' and succ.late_start:
                        # Pred must start before succ start - lag, so latest pred finish is unconstrained
                        # but pred start ≤ succ.LS - lag. So pred LF = pred LS + dur = (succ.LS - lag) + dur
                        candidates.append(_add_days(succ.late_start, -lag + act.duration))
                    elif dep_type == 'FF' and succ.late_finish:
                        candidates.append(_add_days(succ.late_finish, -lag))
                    elif dep_type == 'SF' and succ.late_finish:
                        candidates.append(_add_days(succ.late_finish, -lag + act.duration))
                act.late_finish = _min_date(candidates) or self.project_finish

            # Apply constraints
            if act.constraint_type == 'finish_no_later_than' and act.constraint_date:
                if act.late_finish and act.late_finish > act.constraint_date:
                    act.late_finish = act.constraint_date
            elif act.constraint_type == 'must_finish_on' and act.constraint_date:
                act.late_finish = act.constraint_date

            act.late_start = _add_days(act.late_finish, -act.duration)

    def compute_float(self):
        """Compute total float and free float; mark critical."""
        for act in self.activities.values():
            # Total float = LS - ES (in days)
            act.total_float = _date_diff_days(act.late_start, act.early_start)

            # Free float = min(ES of successors via FS) - EF
            succ_es: list[date] = []
            for succ, dep_type, lag in act.successors:
                if dep_type == 'FS' and succ.early_start:
                    succ_es.append(_add_days(succ.early_start, -lag))
            min_succ_es = _min_date(succ_es)
            if min_succ_es and act.early_finish:
                act.free_float = float((min_succ_es - act.early_finish).days)
            else:
                act.free_float = act.total_float

            # Critical = total_float <= 0
            act.is_critical = act.total_float <= 0

    def persist(self):
        """Write computed values back to DB."""
        cur = self.conn.cursor()
        for act in self.activities.values():
            cur.execute("""
                UPDATE cpm_activities SET
                    early_start_date=%s, early_finish_date=%s,
                    late_start_date=%s, late_finish_date=%s,
                    total_float_days=%s, free_float_days=%s,
                    is_critical=%s, is_near_critical=%s
                WHERE activity_id=%s
            """, (
                act.early_start, act.early_finish,
                act.late_start, act.late_finish,
                act.total_float, act.free_float,
                act.is_critical, (0 < act.total_float <= 5),
                act.activity_id
            ))

        # Schedule-level
        critical_count = sum(1 for a in self.activities.values() if a.is_critical)
        cur.execute("""
            UPDATE cpm_schedules SET
                project_finish_date=%s,
                critical_path_length_days=%s,
                last_cpm_run_at=CURRENT_TIMESTAMP,
                last_cpm_run_status='success'
            WHERE schedule_id=%s
        """, (
            self.project_finish,
            int(_date_diff_days(self.project_finish, self.project_start)) if self.project_finish else None,
            self.schedule_id,
        ))
        self.conn.commit()

    def run(self) -> dict:
        """Full CPM run. Returns summary dict."""
        self.load()
        if not self.activities:
            return {"error": "No activities in schedule"}
        self.forward_pass()
        self.backward_pass()
        self.compute_float()
        self.persist()

        critical_activities = [a for a in self.activities.values() if a.is_critical]
        return {
            "schedule_id": self.schedule_id,
            "total_activities": len(self.activities),
            "critical_activities": len(critical_activities),
            "project_start": self.project_start.isoformat() if self.project_start else None,
            "project_finish": self.project_finish.isoformat() if self.project_finish else None,
            "project_duration_days": int(_date_diff_days(self.project_finish, self.project_start)) if self.project_finish else None,
            "critical_path": [
                {"activity_id": a.activity_id, "code": a.activity_code, "name": a.activity_name,
                 "early_start": a.early_start.isoformat() if a.early_start else None,
                 "early_finish": a.early_finish.isoformat() if a.early_finish else None,
                 "duration_days": a.duration, "total_float": a.total_float}
                for a in sorted(critical_activities, key=lambda x: x.early_start or date.max)
            ],
            "warnings": self.warnings,
        }


def run_cpm(schedule_id: int, db_url: str) -> dict:
    """Convenience function."""
    import os
    db_url = db_url or os.environ.get(
        "PROJECT_BRAIN_DB_URL", "postgresql://postgres:abc123@127.0.0.1:5433/project_brain")
    conn = psycopg2.connect(db_url)
    try:
        engine = CPMEngine(schedule_id, conn)
        return engine.run()
    finally:
        conn.close()


if __name__ == "__main__":
    import argparse, json
    p = argparse.ArgumentParser()
    p.add_argument("--schedule-id", type=int, required=True)
    p.add_argument("--db", default=None)
    args = p.parse_args()
    result = run_cpm(args.schedule_id, args.db)
    print(json.dumps(result, indent=2, default=str))
