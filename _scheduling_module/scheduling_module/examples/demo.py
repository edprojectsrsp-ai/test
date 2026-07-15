"""
demo.py — end-to-end demonstration with NO database required.

Builds a small but realistic project network in memory, runs the CPM, DCMA and
delay engines, prints a summary, and writes the three report formats
(CSV / Excel / PDF) into ./demo_output/.

Run:
    pip install -r requirements.txt
    python examples/demo.py
"""
from __future__ import annotations

import os
import sys
from datetime import date, timedelta

# allow running from repo root or from examples/
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.cpm import CPMEngine, CPMActivity, CPMRelationship, RelType
from app.core.calendar import DEFAULT_CALENDAR
from app.core.delay_analysis import DelayAnalyzer, BaselineActivity
from app.core.dcma import DCMAAssessor
from app.core import reports


def build_network():
    acts = [
        CPMActivity("A", "Site mobilization", 5),
        CPMActivity("B", "Excavation", 10),
        CPMActivity("C", "Foundation", 8),
        CPMActivity("M1", "Foundation complete", 0, is_milestone=True),
        CPMActivity("D", "Structure erection", 15),
        CPMActivity("E", "MEP rough-in", 12),
        CPMActivity("F", "Finishes & handover", 6),
    ]
    rels = [
        CPMRelationship("A", "B", RelType.FS),
        CPMRelationship("B", "C", RelType.FS),
        CPMRelationship("C", "M1", RelType.FS),
        CPMRelationship("M1", "D", RelType.FS),
        CPMRelationship("C", "D", RelType.SS, lag=2),
        CPMRelationship("D", "E", RelType.SS, lag=5),
        CPMRelationship("D", "F", RelType.FS),
        CPMRelationship("E", "F", RelType.FS),
    ]
    return acts, rels


def main():
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "demo_output")
    os.makedirs(out, exist_ok=True)

    acts, rels = build_network()
    start = date(2026, 6, 22)  # a Monday

    # --- CPM -------------------------------------------------------------
    res = CPMEngine(acts, rels, start, DEFAULT_CALENDAR).run()
    print(f"CPM      : {res.project_start} -> {res.project_finish}")
    print(f"           critical path: {' -> '.join(res.critical_path)}")

    # --- Delay vs an (earlier) baseline ---------------------------------
    baseline = [
        BaselineActivity("A", date(2026, 6, 22), date(2026, 6, 26), 5),
        BaselineActivity("B", date(2026, 6, 29), date(2026, 7, 10), 10),
        BaselineActivity("C", date(2026, 7, 13), date(2026, 7, 22), 8),
        BaselineActivity("D", date(2026, 7, 23), date(2026, 8, 12), 15),
        BaselineActivity("E", date(2026, 7, 30), date(2026, 8, 14), 12),
        BaselineActivity("F", date(2026, 8, 17), date(2026, 8, 24), 6),
    ]
    delay = DelayAnalyzer(
        list(res.activities.values()), baseline, DEFAULT_CALENDAR,
        baseline_project_finish=date(2026, 8, 24),
        current_project_finish=res.project_finish,
    ).analyze()
    print(f"Delay    : finish variance {delay.project_finish_variance_wd} wd, "
          f"{delay.delayed_count} delayed, {delay.critical_delay_count} critical")

    # --- DCMA ------------------------------------------------------------
    dcma = DCMAAssessor(acts, rels, start, DEFAULT_CALENDAR).assess()
    print(f"DCMA     : {dcma.score:.0f}% "
          f"({dcma.passed_count}/{dcma.applicable_count} applicable checks)")

    # --- Reports ---------------------------------------------------------
    tables = reports.build_report_pack(
        result=res, delay=delay, dcma=dcma,
        look_ahead_window=(start, start + timedelta(days=30)),
    )
    with open(os.path.join(out, "report.csv"), "w", newline="") as f:
        f.write(reports.tables_to_csv(tables))
    reports.tables_to_excel(tables, os.path.join(out, "report.xlsx"))
    reports.tables_to_pdf(tables, os.path.join(out, "report.pdf"),
                          document_title="Demo Project — Schedule Control Report")
    print(f"Reports  : wrote report.csv / report.xlsx / report.pdf -> {out}")


if __name__ == "__main__":
    main()
