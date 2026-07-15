"""Fail fast when a dashboard/report calculation drifts from the source app.

Run from project-brain-backend with:
    .venv/Scripts/python tools/verify_friend_parity.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.database import SessionLocal
from app.api.v1.mos_reports import pmc_board
from app.services.friend_parity import capex_detail_model, dashboard_model, mos_model


def main() -> None:
    with SessionLocal() as db:
        dashboard = dashboard_model(db)
        mos = mos_model(db, "2026-07")
        detail = capex_detail_model(db, "2026-07")
        pmc = pmc_board("2026-07", db)

    assert dashboard["cards"] == {
        "totalProjects": 81,
        "ongoingProjects": 27,
        "completedProjects": 6,
        "droppedProjects": 0,
        "totalProjectCost": 12301.99,
    }
    assert dashboard["capexSummary"] == {
        "totalBe": 2150.01,
        "totalRe": 0.0,
        "totalBeRe": 2150.01,
        "effectivePlanType": "BE",
        "effectivePlanName": "FY 2026-2027 | Original Plan | BE",
        "totalActual": 264.51,
        "variance": 1885.5,
        "variancePercent": 87.7,
    }
    assert [(r["label"], r["value"], r["cost"]) for r in dashboard["statusRows"]] == [
        ("On Time", 45, 5725.19),
        ("Delay < 1 Year", 1, 0.0),
        ("Delay > 1 Year", 0, 0),
        ("Completed this FY", 3, 17.45),
    ]
    assert dashboard["upcomingRows"] == [
        {"type": "Corporate AMR", "value": 3, "cost": 490.42},
        {"type": "Plant Level AMR", "value": 23, "cost": 157.96},
    ]
    assert dashboard["scheduleCompletionRows"] == [
        {"type": "Corporate AMR", "value": 6, "cost": 424.01},
        {"type": "Plant Level AMR", "value": 0, "cost": 0},
    ]
    assert [(r["projects"], r["totalCost"], r["capexCurrentFy"],
             r["expenditureCurrentFy"], r["totalExpenditure"]) for r in mos["rows"]] == [
        (37, 5678.52, 1507.38, 185.35, 1278.59),
        (10, 5368.3, 1357.0, 160.92, 1169.31),
        (27, 310.22, 150.38, 24.43, 109.28),
        (15, 554.54, 12.64, 0.85, 1.59),
        (3, 490.42, 0.0, 0.0, 0.74),
        (12, 64.12, 12.64, 0.85, 0.85),
        (52, 6233.06, 1520.02, 186.2, 1280.18),
        (9, 5963.01, 270.07, 79.99, 5931.86),
        (24, 525.11, 32.4, 0.0, 0.74),
        (2, 123.27, 0.0, 0.0, 0.0),
        (26, 648.38, 32.4, 0.0, 0.74),
        (0, 334.8, 334.8, 0.0, 0.0),
        (0, 0.0, 0.0, 0.0, 0.0),
        (78, 7216.24, 2157.29, 266.19, 7212.78),
    ]
    assert detail["detailProjectCount"] == 52
    assert len(detail["highCostProjects"]) == 10
    assert detail["lowCostSummary"] == {
        "count": 42, "totalCost": 374.34, "expenditureLastFy": 84.85,
        "capexCurrentFy": 163.02, "expenditureCurrentFy": 25.28,
        "cumulativeExpenditure": 110.13,
    }
    assert len(pmc["blocks"]) == 19
    cob7 = {row["packageId"]: row for row in pmc["blocks"] if row["packageId"] in {74, 75, 76}}
    assert [(cob7[key]["grossCost"], cob7[key]["cumulativeExpenditure"])
            for key in (74, 75, 76)] == [(2584.41, 853.93), (1064.55, 36.66), (1140.07, 100.33)]
    print("Friend parity verified: dashboard + MoS + 52 details + 19 PMC packages")


if __name__ == "__main__":
    main()
