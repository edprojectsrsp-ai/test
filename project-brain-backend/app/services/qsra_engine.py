"""QSRA — Quantitative Schedule Risk Analysis (Monte Carlo).

Runs N simulations of the schedule through the existing clean-room CPM engine,
sampling each incomplete activity's duration from a triangular distribution
(3-point estimate: optimistic / most-likely / pessimistic). Per-activity
estimates come from cpm_risk_estimates; activities without one fall back to
±(default_optimistic_pct / default_pessimistic_pct) around the deterministic
duration. Completed activities keep their actual dates.

Outputs (the Primavera Risk / Safran result set):
  · Finish-date distribution: P10 / P50 / P80 / P90, mean, std dev
  · Histogram (weekly buckets) + cumulative probability S-curve
  · Probability of meeting the deterministic finish date
  · Criticality index per activity (share of iterations on the critical path)
  · Tornado / sensitivity: Pearson correlation of each activity's sampled
    duration against project finish — the true schedule drivers

Deterministic when seeded — identical inputs + seed reproduce results exactly.
"""
from __future__ import annotations

import math
import random
from datetime import date, timedelta
from typing import Any, Optional

import psycopg2.extras

from app.services.cpm_engine import CPMEngine, _date_diff_days


def _percentile(sorted_vals: list[float], p: float) -> float:
    """Linear-interpolated percentile on a pre-sorted list (numpy 'linear')."""
    if not sorted_vals:
        return 0.0
    if len(sorted_vals) == 1:
        return sorted_vals[0]
    k = (len(sorted_vals) - 1) * (p / 100.0)
    f, c = math.floor(k), math.ceil(k)
    if f == c:
        return sorted_vals[int(k)]
    return sorted_vals[f] + (sorted_vals[c] - sorted_vals[f]) * (k - f)


def _pearson(xs: list[float], ys: list[float]) -> float:
    n = len(xs)
    if n < 2:
        return 0.0
    mx, my = sum(xs) / n, sum(ys) / n
    sx = math.sqrt(sum((x - mx) ** 2 for x in xs))
    sy = math.sqrt(sum((y - my) ** 2 for y in ys))
    if not sx or not sy:
        return 0.0
    return sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / (sx * sy)


class QSRAEngine:
    def __init__(self, schedule_id: int, conn,
                 iterations: int = 2000,
                 seed: Optional[int] = None,
                 default_optimistic_pct: float = 90.0,
                 default_pessimistic_pct: float = 130.0):
        self.schedule_id = schedule_id
        self.conn = conn
        self.iterations = max(100, min(int(iterations), 20000))
        self.seed = seed
        self.opt_f = default_optimistic_pct / 100.0
        self.pess_f = default_pessimistic_pct / 100.0
        self.cpm = CPMEngine(schedule_id, conn)
        self.estimates: dict[int, tuple[float, float, float]] = {}  # aid -> (o,m,p)

    # ------------------------------------------------------------------ load

    def load(self):
        self.cpm.load()
        cur = self.conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""
            SELECT e.activity_id, e.optimistic_days, e.most_likely_days, e.pessimistic_days
            FROM cpm_risk_estimates e
            JOIN cpm_activities a ON a.activity_id = e.activity_id
            WHERE a.schedule_id = %s AND NOT a.is_deleted
        """, (self.schedule_id,))
        stored = {int(r["activity_id"]): r for r in cur.fetchall()}
        for aid, act in self.cpm.activities.items():
            r = stored.get(aid)
            m = float(r["most_likely_days"]) if r and r["most_likely_days"] is not None else act.duration
            o = float(r["optimistic_days"]) if r and r["optimistic_days"] is not None else m * self.opt_f
            p = float(r["pessimistic_days"]) if r and r["pessimistic_days"] is not None else m * self.pess_f
            o, p = min(o, m), max(p, m)  # enforce o ≤ m ≤ p
            self.estimates[aid] = (o, m, p)

    # -------------------------------------------------------------- one pass

    def _reset_computed(self):
        for a in self.cpm.activities.values():
            a.early_start = a.early_finish = None
            a.late_start = a.late_finish = None
            a.total_float = a.free_float = 0.0
            a.is_critical = False

    def _cpm_pass(self) -> Optional[date]:
        self._reset_computed()
        self.cpm.forward_pass()
        self.cpm.backward_pass()
        self.cpm.compute_float()
        return self.cpm.project_finish

    # ------------------------------------------------------------------- run

    def run(self) -> dict[str, Any]:
        self.load()
        if not self.cpm.activities:
            return {"error": "No activities in schedule"}

        acts = self.cpm.activities
        base_dur = {aid: a.duration for aid, a in acts.items()}
        sampled_ids = [aid for aid, a in acts.items() if not a.actual_finish]

        # deterministic pass (most-likely durations)
        for aid in sampled_ids:
            acts[aid].duration = self.estimates[aid][1]
        det_finish = self._cpm_pass()
        det_critical = {aid for aid, a in acts.items() if a.is_critical}
        origin = self.cpm.project_start

        rng = random.Random(self.seed)
        finishes: list[float] = []                       # days from project start
        crit_count = {aid: 0 for aid in acts}
        dur_samples: dict[int, list[float]] = {aid: [] for aid in sampled_ids}

        for _ in range(self.iterations):
            for aid in sampled_ids:
                o, m, p = self.estimates[aid]
                d = m if (p - o) < 1e-9 else rng.triangular(o, p, m)
                acts[aid].duration = d
                dur_samples[aid].append(d)
            fin = self._cpm_pass()
            finishes.append(_date_diff_days(fin, origin))
            for aid, a in acts.items():
                if a.is_critical:
                    crit_count[aid] += 1

        # restore deterministic durations in memory (nothing persisted)
        for aid, d in base_dur.items():
            acts[aid].duration = d

        finishes_sorted = sorted(finishes)
        n = len(finishes_sorted)
        mean = sum(finishes_sorted) / n
        std = math.sqrt(sum((x - mean) ** 2 for x in finishes_sorted) / n)
        det_days = _date_diff_days(det_finish, origin)
        prob_det = sum(1 for x in finishes_sorted if x <= det_days + 1e-9) / n

        def as_date(days: float) -> str:
            return (origin + timedelta(days=round(days))).isoformat()

        # weekly histogram + cumulative S-curve
        lo, hi = finishes_sorted[0], finishes_sorted[-1]
        span = max(hi - lo, 1.0)
        bucket_w = max(7.0, span / 24.0)  # ≥ 1 week, ≤ ~24 bars
        buckets: dict[int, int] = {}
        for x in finishes_sorted:
            buckets[int((x - lo) // bucket_w)] = buckets.get(int((x - lo) // bucket_w), 0) + 1
        histogram = [{"date": as_date(lo + (b + 0.5) * bucket_w),
                      "count": c, "pct": round(c / n * 100, 2)}
                     for b, c in sorted(buckets.items())]
        cum, s_curve = 0, []
        for h in histogram:
            cum += h["count"]
            s_curve.append({"date": h["date"], "cum_pct": round(cum / n * 100, 2)})

        # sensitivity + criticality
        tornado = []
        for aid in sampled_ids:
            r = _pearson(dur_samples[aid], finishes)
            tornado.append({"activity_id": aid,
                            "code": acts[aid].activity_code,
                            "name": acts[aid].activity_name,
                            "correlation": round(r, 4)})
        tornado.sort(key=lambda t: -abs(t["correlation"]))

        criticality = [{"activity_id": aid,
                        "code": acts[aid].activity_code,
                        "name": acts[aid].activity_name,
                        "criticality_index": round(crit_count[aid] / n, 4),
                        "deterministic_critical": aid in det_critical,
                        "o": round(self.estimates[aid][0], 1) if aid in self.estimates else None,
                        "m": round(self.estimates[aid][1], 1) if aid in self.estimates else None,
                        "p": round(self.estimates[aid][2], 1) if aid in self.estimates else None}
                       for aid in acts]
        criticality.sort(key=lambda c: -c["criticality_index"])

        return {
            "schedule_id": self.schedule_id,
            "iterations": n,
            "seed": self.seed,
            "project_start": origin.isoformat() if origin else None,
            "deterministic_finish": det_finish.isoformat() if det_finish else None,
            "prob_meet_deterministic": round(prob_det * 100, 2),
            "percentiles": {
                "p10": as_date(_percentile(finishes_sorted, 10)),
                "p50": as_date(_percentile(finishes_sorted, 50)),
                "p80": as_date(_percentile(finishes_sorted, 80)),
                "p90": as_date(_percentile(finishes_sorted, 90)),
            },
            "mean_finish": as_date(mean),
            "std_dev_days": round(std, 1),
            "histogram": histogram,
            "s_curve": s_curve,
            "tornado": tornado[:15],
            "criticality": criticality,
        }


def run_qsra(schedule_id: int, conn, **kw) -> dict[str, Any]:
    return QSRAEngine(schedule_id, conn, **kw).run()
