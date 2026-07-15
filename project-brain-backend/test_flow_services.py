"""Tests for the remaining flow services. Run: pytest -q"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "app", "services"))
import flow_rollup as fr
import flow_revision as frev
import flow_dpr as fd


# ----------------------------- ROLLUP ----------------------------- #
def test_package_curve_reaches_100_when_complete():
    acts = [{"activity_id": 1, "weight_pct": 60, "scope_qty": 100},
            {"activity_id": 2, "weight_pct": 40, "scope_qty": 50}]
    planned = [{"activity_id": 1, "month": "2025-04", "qty": 100},
               {"activity_id": 2, "month": "2025-05", "qty": 50}]
    actual = [{"activity_id": 1, "month": "2025-04", "qty": 50}]
    c = fr.package_curve(acts, planned, actual)
    # denom = 60*100 + 40*50 = 8000
    assert c.planned_cum["2025-04"] == 75.0     # 60*100/8000*100
    assert c.planned_cum["2025-05"] == 100.0    # +40*50/8000 → 100
    assert c.actual_cum["2025-04"] == 37.5      # 60*50/8000*100


def test_package_weight_precedence():
    assert fr.package_weight({"extra_fields": {"scheme_rollup_weight": 3}, "package_value_cr": 99}) == 3.0
    assert fr.package_weight({"package_value_cr": 50, "package_estimate_cr": 10}) == 50.0
    assert fr.package_weight({"package_estimate_cr": 10}) == 10.0
    assert fr.package_weight({}) == 1.0


def test_scheme_rollup_weighted():
    cA = fr.Curve(["2025-04"], {"2025-04": 80.0}, {"2025-04": 60.0})
    cB = fr.Curve(["2025-04"], {"2025-04": 40.0}, {"2025-04": 20.0})
    pkgs = [{"extra_fields": {"scheme_rollup_weight": 60}, "curve": cA},
            {"extra_fields": {"scheme_rollup_weight": 40}, "curve": cB}]
    sc = fr.scheme_curve(pkgs)
    # planned: 0.6*80 + 0.4*40 = 64 ; actual: 0.6*60 + 0.4*20 = 44
    assert sc.planned_cum["2025-04"] == 64.0
    assert sc.actual_cum["2025-04"] == 44.0


def test_scheme_rollup_carries_steps_across_months():
    cA = fr.Curve(["2025-04", "2025-06"], {"2025-04": 50.0, "2025-06": 100.0}, {"2025-04": 50.0, "2025-06": 100.0})
    cB = fr.Curve(["2025-05"], {"2025-05": 100.0}, {"2025-05": 0.0})
    pkgs = [{"extra_fields": {"scheme_rollup_weight": 50}, "curve": cA},
            {"extra_fields": {"scheme_rollup_weight": 50}, "curve": cB}]
    sc = fr.scheme_curve(pkgs)
    # 2025-05: A carried 50, B 100 → 0.5*50 + 0.5*100 = 75
    assert sc.planned_cum["2025-05"] == 75.0


# ----------------------------- REVISION ----------------------------- #
def test_open_revision_preserves_prior_and_sets_balance():
    rev = frev.open_revision(
        prev_rev_no=0, effective_month="2025-11-01",
        activities=[{"activity_id": 1, "scope_qty": 100, "frozen_actual_to_prev_month": 40,
                     "scheduled_finish": "2026-01-01", "expected_finish": "2026-03-01"}],
    )
    assert rev.label == "R1"
    a = rev.activities[0]
    assert a.prior_actual == 40
    assert a.balance_scope == 60         # only 60 plannable
    assert "2026-03" in a.plannable_months   # expected extends window


def test_revision_submittable_only_when_exactly_balanced():
    rev = frev.open_revision(
        prev_rev_no=None, effective_month="2025-11-01",
        activities=[{"activity_id": 1, "scope_qty": 100, "frozen_actual_to_prev_month": 40,
                     "scheduled_finish": "2026-01-01", "expected_finish": "2026-01-01"}],
    )
    short = frev.validate_revision_plan(rev, {1: {"2025-11": 30}})   # 40+30=70 ≠ 100
    assert short["submittable"] is False
    full = frev.validate_revision_plan(rev, {1: {"2025-11": 30, "2025-12": 30}})  # 40+60=100
    assert full["ok"] is True and full["submittable"] is True


# ----------------------------- DPR ----------------------------- #
def test_aggregate_daily_to_monthly():
    daily = [{"activity_id": 1, "actual_date": "2026-04-03", "actual_qty": 10},
             {"activity_id": 1, "actual_date": "2026-04-19", "actual_qty": 15},
             {"activity_id": 2, "actual_date": "2026-04-10", "actual_qty": 5},
             {"activity_id": 1, "actual_date": "2026-05-02", "actual_qty": 99}]
    m = fd.aggregate_daily_to_monthly(daily, "2026-04")
    assert m[1] == 25 and m[2] == 5 and 1 in m


def test_freeze_caps_at_scope():
    frozen = fd.freeze_month(prior_cumulative={1: 90}, month_qty={1: 30}, scope={1: 100})
    assert frozen[1] == 100   # 90+30 capped at scope 100


# ----------------------------- CAPEX ROLLOVER ----------------------------- #
def test_rollover_inherits_cumulative_and_balance():
    nxt = fd.rollover_capex_to_next_fy([
        {"row_id": 7, "scheme_id": 1, "name": "COB-7", "gross": 2840, "cumLast": 1180, "actual_total_fy": 563.65},
    ])
    r = nxt[0]
    assert r["cumLast"] == 1743.65            # 1180 + 563.65
    assert r["balance_to_plan"] == round(2840 - 1743.65, 2)
    assert r["beFY"] == 0.0                    # reset, ready to plan
