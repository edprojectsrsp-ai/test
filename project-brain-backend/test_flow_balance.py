"""Tests proving the balance gate. Run: pytest -q"""
from datetime import date
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "app", "services"))
import flow_balance as fb


# --------------------------- PHYSICAL --------------------------- #
def test_physical_balanced_prior_plus_plan_equals_scope():
    b = fb.activity_balance(
        activity_id=1, scope_qty=100, prior_actual=40,
        planned_cells={"2025-11": 20, "2025-12": 25, "2026-01": 15},
        effective_month="2025-11-01", scheduled_finish="2026-01-01", expected_finish="2026-01-01",
    )
    assert b.prior_actual == 40
    assert b.planned_balance == 60
    assert b.total == 100
    assert b.balanced is True
    assert b.within_scope is True
    assert b.remaining == 60
    assert b.progress_pct == 100.0


def test_physical_exceeds_scope_is_flagged():
    b = fb.activity_balance(
        activity_id=2, scope_qty=100, prior_actual=70,
        planned_cells={"2025-11": 20, "2025-12": 25},  # 70+45 = 115
        effective_month="2025-11-01", scheduled_finish="2025-12-01", expected_finish="2025-12-01",
    )
    assert b.within_scope is False
    assert round(b.over_by, 2) == 15.0
    assert b.remaining == 30  # only 30 may legally be planned


def test_physical_expected_extends_window_beyond_scheduled():
    # Scheduled finish March; Expected extended to May → May must be permitted.
    b = fb.activity_balance(
        activity_id=3, scope_qty=100, prior_actual=0,
        planned_cells={"2026-03": 50, "2026-05": 50},
        effective_month="2026-01-01", scheduled_finish="2026-03-01", expected_finish="2026-05-01",
    )
    assert "2026-05" in b.window_months
    assert b.window_violations == []  # May allowed because Expected extends to May


def test_physical_plan_outside_window_is_violation():
    b = fb.activity_balance(
        activity_id=4, scope_qty=100, prior_actual=0,
        planned_cells={"2026-03": 50, "2026-06": 50},  # June beyond both finishes
        effective_month="2026-01-01", scheduled_finish="2026-03-01", expected_finish="2026-05-01",
    )
    assert "2026-06" in b.window_violations


def test_validate_physical_collects_errors():
    res = fb.validate_physical_plan([
        {"activity_id": 1, "scope_qty": 100, "actuals_till_last_fy": 90,
         "planned_cells": {"2026-02": 30}, "effective_month": "2026-02-01",
         "expected_completion_month": "2026-02-01"},
    ])
    assert res["ok"] is False
    assert any(e["code"] == "EXCEEDS_SCOPE" for e in res["errors"])


def test_weighted_progress_matches_formula():
    rows = [
        {"weight_pct": 60, "scope_qty": 100, "actual": 50},   # 0.6 * 0.5 = .30
        {"weight_pct": 40, "scope_qty": 200, "actual": 100},  # 0.4 * 0.5 = .20
    ]
    assert fb.weighted_progress_percent(rows, "actual") == 50.0


def test_scheme_rollup_weighted_mean():
    pkgs = [{"weight": 40, "actual_pct": 66}, {"weight": 35, "actual_pct": 45}, {"weight": 25, "actual_pct": 29}]
    # (40*66 + 35*45 + 25*29) / 100 = (2640+1575+725)/100 = 49.4
    assert fb.scheme_rollup_percent(pkgs) == 49.4


# --------------------------- CAPEX --------------------------- #
def _months(seq):  # seq of (month_no, be, re, actual)
    return {m: {"be": be, "re": re, "actual": ac} for (m, be, re, ac) in seq}


def test_capex_re_overlay_pre_effective_uses_actual():
    # effective = Jul(7). Apr/May/Jun are pre-effective → plan = actual.
    months = _months([(4, 100, None, 120), (5, 100, None, 110), (6, 100, None, 90),
                      (7, 100, 130, 0), (8, 100, 130, 0)])
    b = fb.capex_row_balance(gross=2840, cum_last=1180, months=months,
                             plan_type="RE", effective_month=7)
    # pre-effective plan months equal actuals
    assert b.monthly_plan[4] == 120 and b.monthly_plan[5] == 110 and b.monthly_plan[6] == 90
    # post-effective uses RE
    assert b.monthly_plan[7] == 130 and b.monthly_plan[8] == 130


def test_capex_balance_equals_sanctioned_minus_cumulative():
    months = _months([(4, 0, None, 200), (5, 0, None, 150)])
    b = fb.capex_row_balance(gross=1000, cum_last=300, months=months, plan_type="BE", sanctioned=1000)
    assert b.cumulative_actual == 300 + 350   # cumLast + actual
    assert b.balance == 1000 - 650            # sanctioned - cumulative


def test_capex_over_sanction_flagged():
    # cumulative 900, remaining plan 200 → 1100 > sanctioned 1000
    months = _months([(4, 0, None, 400), (7, 300, None, 0), (8, 300, None, 0)])
    b = fb.capex_row_balance(gross=1000, cum_last=500, months=months,
                             plan_type="BE", effective_month=7, sanctioned=1000)
    assert b.within_sanction is False
    assert b.over_by > 0


def test_next_fy_carry_inherits_prior_close():
    assert fb.next_fy_cum_last(prev_cum_last=1180, prev_fy_actual_total=563.65) == 1743.65


def test_validate_capex_collects_errors():
    rows = [{"gross": 1000, "cumLast": 500, "sanctioned": 1000,
             "months": _months([(4, 0, None, 400), (7, 300, None, 0), (8, 300, None, 0)])}]
    res = fb.validate_capex_plan(rows, plan_type="BE", effective_month=7)
    assert res["ok"] is False
    assert res["errors"][0]["code"] == "EXCEEDS_SANCTION"
