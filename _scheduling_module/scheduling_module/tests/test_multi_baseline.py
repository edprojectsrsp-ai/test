"""Multi-baseline comparison tests."""
from __future__ import annotations

from datetime import date

import pytest

from app.core.multi_baseline import (BaselineActivityRow, BaselineRef,
                                     CurrentActivityRow, compare_baselines)

D = date


@pytest.fixture
def scenario():
    """Two baselines: an original, and a rebaseline the client accepted.
    A020 has slipped hard against the original but is holding the rebaseline."""
    baselines = [
        BaselineRef(1, "Original", project_finish=D(2027, 6, 30)),
        BaselineRef(2, "Rebaseline-1 (client approved)", project_finish=D(2027, 12, 31)),
    ]
    bl_rows = [
        BaselineActivityRow(1, "A010", D(2026, 1, 1), D(2026, 2, 10), 40, False),
        BaselineActivityRow(1, "A020", D(2026, 2, 11), D(2026, 5, 11), 90, True),
        BaselineActivityRow(1, "A030", D(2026, 5, 12), D(2026, 8, 20), 100, True),
        BaselineActivityRow(1, "A099", D(2026, 9, 1), D(2026, 9, 30), 30, False),
        BaselineActivityRow(2, "A010", D(2026, 1, 1), D(2026, 2, 10), 40, False),
        BaselineActivityRow(2, "A020", D(2026, 2, 11), D(2026, 8, 11), 180, True),
        BaselineActivityRow(2, "A030", D(2026, 8, 12), D(2026, 11, 20), 100, True),
    ]
    current = [
        CurrentActivityRow("A010", "Mobilisation", D(2026, 1, 1), D(2026, 2, 10), 40, False, 100),
        CurrentActivityRow("A020", "Foundation", D(2026, 2, 11), D(2026, 8, 11), 180, True, 60),
        CurrentActivityRow("A030", "Steel", D(2026, 8, 12), D(2026, 11, 20), 100, True, 0),
        CurrentActivityRow("A040", "Added scope", D(2026, 11, 21), D(2026, 12, 20), 30, False, 0),
    ]
    return current, baselines, bl_rows


def test_one_cell_per_baseline(scenario):
    cur, bls, rows = scenario
    result = compare_baselines(cur, bls, rows)
    assert len(result.activities) == 4
    for act in result.activities:
        assert set(act.cells) == {1, 2}


def test_same_activity_slips_one_baseline_and_holds_another(scenario):
    """The whole point of multi-baseline: A020 is 92d late vs Original but on
    track against the approved rebaseline."""
    cur, bls, rows = scenario
    result = compare_baselines(cur, bls, rows)
    a020 = next(a for a in result.activities if a.code == "A020")
    assert a020.cells[1].finish_var_days == 92
    assert a020.cells[1].status == "slipped"
    assert a020.cells[2].finish_var_days == 0
    assert a020.cells[2].status == "on_track"


def test_worst_slip_drives_ordering(scenario):
    cur, bls, rows = scenario
    result = compare_baselines(cur, bls, rows)
    assert result.activities[0].code == "A020"      # biggest damage first
    assert result.activities[0].worst_slip_days == 92


def test_added_and_removed_activities(scenario):
    cur, bls, rows = scenario
    result = compare_baselines(cur, bls, rows)
    a040 = next(a for a in result.activities if a.code == "A040")
    assert a040.cells[1].status == "added"
    assert a040.cells[2].status == "added"
    original = next(b for b in result.baselines if b.baseline_id == 1)
    assert original.removed == ["A099"]             # was baselined, now gone
    assert original.added == 1
    rebase = next(b for b in result.baselines if b.baseline_id == 2)
    assert rebase.removed == []


def test_project_finish_variance_per_baseline(scenario):
    cur, bls, rows = scenario
    result = compare_baselines(cur, bls, rows, current_project_finish=D(2027, 12, 31))
    original = next(b for b in result.baselines if b.baseline_id == 1)
    rebase = next(b for b in result.baselines if b.baseline_id == 2)
    assert original.project_finish_variance_days == 184   # 2027-06-30 -> 2027-12-31
    assert rebase.project_finish_variance_days == 0


def test_project_finish_inferred_when_not_supplied(scenario):
    cur, bls, rows = scenario
    result = compare_baselines(cur, bls, rows)
    assert result.baselines[0].current_project_finish == D(2026, 12, 20)


def test_went_critical_detected():
    bls = [BaselineRef(1, "Original")]
    rows = [BaselineActivityRow(1, "X", D(2026, 1, 1), D(2026, 1, 10), 10, False)]
    cur = [CurrentActivityRow("X", "X", D(2026, 1, 1), D(2026, 1, 10), 10, True, 0)]
    result = compare_baselines(cur, bls, rows)
    assert result.activities[0].cells[1].went_critical is True
    assert result.baselines[0].went_critical == ["X"]


def test_ahead_of_baseline_is_not_counted_as_slip():
    bls = [BaselineRef(1, "Original")]
    rows = [BaselineActivityRow(1, "X", D(2026, 1, 1), D(2026, 2, 1), 31, False)]
    cur = [CurrentActivityRow("X", "X", D(2026, 1, 1), D(2026, 1, 20), 19, False, 100)]
    result = compare_baselines(cur, bls, rows)
    assert result.activities[0].cells[1].status == "ahead"
    assert result.activities[0].cells[1].finish_var_days == -12
    assert result.baselines[0].slipped == 0
    assert result.baselines[0].ahead == 1


def test_slip_tolerance_absorbs_small_variance():
    bls = [BaselineRef(1, "Original")]
    rows = [BaselineActivityRow(1, "X", D(2026, 1, 1), D(2026, 2, 1), 31, False)]
    cur = [CurrentActivityRow("X", "X", D(2026, 1, 1), D(2026, 2, 3), 33, False, 0)]
    strict = compare_baselines(cur, bls, rows)
    lenient = compare_baselines(cur, bls, rows, slip_tolerance_days=5)
    assert strict.activities[0].cells[1].status == "slipped"
    assert lenient.activities[0].cells[1].status == "on_track"


def test_missing_dates_do_not_crash():
    bls = [BaselineRef(1, "Original")]
    rows = [BaselineActivityRow(1, "X", None, None, None, False)]
    cur = [CurrentActivityRow("X", "X", None, None, None, False, 0)]
    result = compare_baselines(cur, bls, rows)
    cell = result.activities[0].cells[1]
    assert cell.finish_var_days is None and cell.status == "on_track"


def test_duration_variance(scenario):
    cur, bls, rows = scenario
    result = compare_baselines(cur, bls, rows)
    a020 = next(a for a in result.activities if a.code == "A020")
    assert a020.cells[1].duration_var_days == 90    # 180 now vs 90 baselined
    assert a020.cells[2].duration_var_days == 0


def test_serialisable(scenario):
    import json
    cur, bls, rows = scenario
    payload = compare_baselines(cur, bls, rows).to_dict()
    json.dumps(payload)                              # must not raise
    assert set(payload) == {"baselines", "activities", "data_date"}
    assert payload["activities"][0]["cells"]["1"]["status"] == "slipped"


def test_no_baselines_returns_activities_without_cells(scenario):
    cur, _, _ = scenario
    result = compare_baselines(cur, [], [])
    assert result.baselines == []
    assert len(result.activities) == 4
    assert all(a.cells == {} for a in result.activities)


def test_data_date_is_returned_for_the_chart(scenario):
    """The Gantt draws a data-date line, so the comparison must carry it."""
    cur, bls, rows = scenario
    result = compare_baselines(cur, bls, rows, data_date=D(2026, 7, 22))
    assert result.data_date == D(2026, 7, 22)
    assert result.to_dict()["data_date"] == "2026-07-22"


def test_data_date_optional(scenario):
    cur, bls, rows = scenario
    assert compare_baselines(cur, bls, rows).to_dict()["data_date"] is None


def test_current_start_present_for_bar_drawing(scenario):
    """Bars need a start as well as a finish."""
    cur, bls, rows = scenario
    payload = compare_baselines(cur, bls, rows).to_dict()
    assert payload["activities"][0]["current_start"] is not None
    assert payload["activities"][0]["cells"]["1"]["bl_start"] is not None
