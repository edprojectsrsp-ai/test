"""Root-cause taxonomy tests.

The taxonomy exists so that "why did we slip" becomes a number instead of a
paragraph. These tests pin the aggregation, because a closed list that does not
aggregate correctly is worse than free text — it looks authoritative and is not.
"""
from __future__ import annotations

import pytest

from app.services.root_cause import (BENIGN_CODES, BY_CODE, CONTRACTOR,
                                     EXTERNAL, GROUPS, NOTE_REQUIRED_CODES,
                                     OWNER, ROOT_CAUSES, catalogue, is_valid,
                                     summarise, validate)


class TestTaxonomyIntegrity:
    def test_codes_are_unique(self):
        codes = [c.code for c in ROOT_CAUSES]
        assert len(codes) == len(set(codes))

    def test_labels_are_unique(self):
        labels = [c.label for c in ROOT_CAUSES]
        assert len(labels) == len(set(labels))

    def test_every_cause_has_a_hint(self):
        assert all(c.hint.strip() for c in ROOT_CAUSES)

    def test_responsibility_is_from_the_closed_set(self):
        allowed = {"owner", "contractor", "external", "shared"}
        assert {c.default_responsibility for c in ROOT_CAUSES} <= allowed

    def test_the_causes_that_actually_stop_indian_epc_work_are_present(self):
        """These are the answers a planner reaches for; if one is missing the
        engineer picks OTHER and the aggregate becomes useless."""
        for code in ("DRG_PENDING", "MAT_NOT_DELIVERED", "FRONT_NOT_AVAILABLE",
                     "SHUTDOWN_AWAITED", "PERMIT_PENDING", "WEATHER_RAIN",
                     "LABOUR_SHORTAGE", "PAYMENT_DELAY"):
            assert code in BY_CODE

    def test_owner_caused_design_holds_are_excusable(self):
        assert BY_CODE["DRG_PENDING"].default_responsibility == OWNER
        assert BY_CODE["DRG_PENDING"].typically_excusable is True

    def test_contractor_failures_are_not_excusable(self):
        for code in ("LABOUR_SHORTAGE", "EQUIP_BREAKDOWN", "MAT_NOT_DELIVERED",
                     "QUALITY_REWORK", "SUBCONTRACTOR"):
            assert BY_CODE[code].default_responsibility == CONTRACTOR
            assert BY_CODE[code].typically_excusable is False

    def test_weather_is_external_and_excusable(self):
        assert BY_CODE["WEATHER_RAIN"].default_responsibility == EXTERNAL
        assert BY_CODE["WEATHER_RAIN"].typically_excusable is True


class TestValidation:
    def test_missing_code_is_rejected(self):
        assert validate(None)
        assert validate("")

    def test_unknown_code_is_rejected(self):
        problems = validate("MERCURY_RETROGRADE")
        assert problems and "Unknown" in problems[0]

    def test_valid_code_passes(self):
        assert validate("WEATHER_RAIN") == []

    def test_other_demands_an_explanation(self):
        """Otherwise OTHER becomes the default and the taxonomy is pointless."""
        assert validate("OTHER") != []
        assert validate("OTHER", "  ") != []
        assert validate("OTHER", "Adjacent contractor blocked the crane path") == []

    def test_is_valid_helper(self):
        assert is_valid("DRG_PENDING") and not is_valid("NOPE") and not is_valid(None)


class TestCatalogue:
    def test_grouped_for_a_dropdown(self):
        cat = catalogue()
        assert [g["group"] for g in cat] == list(GROUPS)
        assert all(g["causes"] for g in cat)

    def test_every_cause_appears_exactly_once(self):
        seen = [c["code"] for g in catalogue() for c in g["causes"]]
        assert sorted(seen) == sorted(c.code for c in ROOT_CAUSES)

    def test_note_requirement_is_advertised_to_the_ui(self):
        flagged = {c["code"] for g in catalogue() for c in g["causes"]
                   if c["note_required"]}
        assert flagged == set(NOTE_REQUIRED_CODES)

    def test_serialises(self):
        import json
        json.dumps(catalogue())


class TestSummarise:
    def test_the_report_this_exists_to_produce(self):
        """'47 days to design holds, of which 41 are owner-attributable.'"""
        rep = summarise([
            ("DRG_PENDING", 20), ("DRG_PENDING", 15), ("DESIGN_QUERY", 6),
            ("WEATHER_RAIN", 8), ("LABOUR_SHORTAGE", 5),
        ])
        assert rep["total_days_lost"] == 54.0
        assert rep["by_group"]["Design"] == 41.0
        assert rep["by_responsibility"]["owner"] == 41.0
        assert rep["excusable_days"] == 49.0
        assert rep["non_excusable_days"] == 5.0

    def test_biggest_cause_leads(self):
        rep = summarise([("WEATHER_RAIN", 3), ("DRG_PENDING", 30),
                         ("LABOUR_SHORTAGE", 12)])
        assert [c["code"] for c in rep["causes"]] == [
            "DRG_PENDING", "LABOUR_SHORTAGE", "WEATHER_RAIN"]

    def test_occurrences_and_days_both_accumulate(self):
        rep = summarise([("WEATHER_RAIN", 1)] * 5)
        assert rep["causes"][0]["occurrences"] == 5
        assert rep["causes"][0]["days_lost"] == 5.0

    def test_planned_nil_is_not_counted_as_lost_time(self):
        """A holiday is not a delay, and counting it as one inflates every
        report."""
        rep = summarise([("PLANNED_NIL", 8), ("DRG_PENDING", 3)])
        assert rep["total_days_lost"] == 3.0
        assert "PLANNED_NIL" in BENIGN_CODES

    def test_benign_can_be_included_when_asked(self):
        rep = summarise([("PLANNED_NIL", 8)], include_benign=True)
        assert rep["total_days_lost"] == 8.0

    def test_unclassified_is_surfaced_not_silently_dropped(self):
        """Legacy rows have no cause. Hiding them makes the total look
        complete when it is not."""
        rep = summarise([("DRG_PENDING", 5), (None, 9), ("BOGUS", 4)])
        assert rep["total_days_lost"] == 5.0
        assert rep["unclassified_count"] == 2
        assert rep["unclassified_days"] == 13.0

    def test_empty_input_is_safe(self):
        rep = summarise([])
        assert rep["total_days_lost"] == 0 and rep["causes"] == []

    def test_none_and_zero_days_do_not_crash(self):
        rep = summarise([("WEATHER_RAIN", None), ("DRG_PENDING", 0)])
        assert rep["total_days_lost"] == 0.0
        assert len(rep["causes"]) == 2

    def test_report_carries_the_disclaimer(self):
        """Attribution defaults must never read as a contractual finding."""
        rep = summarise([("DRG_PENDING", 5)])
        assert "not a contractual determination" in rep["disclaimer"]

    def test_serialises(self):
        import json
        json.dumps(summarise([("DRG_PENDING", 5), (None, 2)]))
