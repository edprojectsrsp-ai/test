"""Photo evidence verification tests.

The point of this module is that a photo attached to a billing claim can be
shown to have been taken at that place at that time. These tests pin both
directions: a corroborating photo must verify, and a photo from elsewhere or
another day must not quietly pass.
"""
from __future__ import annotations

from datetime import datetime, timedelta

import pytest

from app.services.photo_evidence import (CONFLICTED, SUSPECT, UNVERIFIED,
                                         VERIFIED, PhotoEvidence,
                                         VerificationPolicy, haversine_m,
                                         verify_photo)

# Rourkela Steel Plant, roughly.
LAT, LNG = 22.2270, 84.8536
NOW = datetime(2026, 7, 24, 10, 30, 0)


def ev(**kw) -> PhotoEvidence:
    base = dict(lat=LAT, lng=LNG, taken_at=NOW)
    base.update(kw)
    return PhotoEvidence(**base)


class TestDistance:
    def test_same_point_is_zero(self):
        assert haversine_m(LAT, LNG, LAT, LNG) == pytest.approx(0, abs=0.01)

    def test_known_separation(self):
        # 0.001 degrees of latitude is about 111 m anywhere on Earth
        d = haversine_m(LAT, LNG, LAT + 0.001, LNG)
        assert 105 < d < 118, d

    def test_symmetric(self):
        a = haversine_m(LAT, LNG, 22.30, 84.90)
        b = haversine_m(22.30, 84.90, LAT, LNG)
        assert a == pytest.approx(b)

    def test_southern_and_western_hemispheres(self):
        d = haversine_m(-33.86, 151.21, -33.87, 151.21)
        assert 900 < d < 1200, d


class TestCorroboration:
    def test_photo_on_the_spot_verifies(self):
        r = verify_photo(ev(), LAT, LNG, NOW)
        assert r.status == VERIFIED and r.is_defensible

    def test_photo_a_short_walk_away_still_verifies(self):
        """A work front is not a point; the engineer photographs the column and
        writes the entry from the site office."""
        r = verify_photo(ev(lat=LAT + 0.0008), LAT, LNG, NOW)
        assert r.status == VERIFIED, r.reasons

    def test_photo_from_another_part_of_the_plant_is_suspect(self):
        r = verify_photo(ev(lat=LAT + 0.05), LAT, LNG, NOW)
        assert r.status == SUSPECT
        assert any("from the recorded entry point" in x for x in r.reasons)

    def test_photo_from_yesterday_is_suspect(self):
        r = verify_photo(ev(taken_at=NOW - timedelta(days=1)), LAT, LNG, NOW)
        assert r.status == SUSPECT
        assert any("days from" in x for x in r.reasons)

    def test_right_place_wrong_day_is_still_suspect(self):
        """The case worth catching: last week's photo of the same location."""
        r = verify_photo(ev(taken_at=NOW - timedelta(days=7)), LAT, LNG, NOW)
        assert r.status == SUSPECT

    def test_hour_of_slack_is_accepted(self):
        r = verify_photo(ev(taken_at=NOW - timedelta(minutes=40)), LAT, LNG, NOW)
        assert r.status == VERIFIED

    def test_distance_and_delta_are_reported(self):
        r = verify_photo(ev(lat=LAT + 0.01, taken_at=NOW - timedelta(minutes=30)),
                         LAT, LNG, NOW)
        assert r.distance_m and r.distance_m > 900
        assert r.time_delta_s == pytest.approx(1800)


class TestMissingExif:
    def test_stripped_exif_is_unverified_not_suspect(self):
        """WhatsApp strips EXIF. Treating that as fraud would push engineers
        back to paper, which is a worse outcome than an unverified photo."""
        r = verify_photo(PhotoEvidence(), LAT, LNG, NOW)
        assert r.status == UNVERIFIED
        assert not r.is_defensible
        assert any("strip it" in x for x in r.reasons)

    def test_strict_mode_can_demand_exif(self):
        r = verify_photo(PhotoEvidence(), LAT, LNG, NOW,
                         policy=VerificationPolicy(require_exif=True))
        assert r.status == SUSPECT

    def test_time_only_photo_can_still_verify(self):
        r = verify_photo(PhotoEvidence(taken_at=NOW), LAT, LNG, NOW)
        assert r.status == VERIFIED

    def test_gps_only_photo_can_still_verify(self):
        r = verify_photo(PhotoEvidence(lat=LAT, lng=LNG), LAT, LNG, NOW)
        assert r.status == VERIFIED

    def test_entry_without_gps_does_not_falsely_verify_location(self):
        r = verify_photo(PhotoEvidence(lat=LAT, lng=LNG), None, None, None)
        assert r.status == UNVERIFIED
        assert any("no GPS to compare" in x for x in r.reasons)


class TestAccuracyHandling:
    def test_poor_fix_widens_the_gate_rather_than_failing(self):
        """Failing a photo for imprecision the device itself reported would
        punish the engineer for standing beside a steel structure."""
        far = ev(lat=LAT + 0.0018)              # ~200 m
        strict = verify_photo(far, LAT, LNG, NOW)
        lenient = verify_photo(far, LAT, LNG, NOW, entry_accuracy_m=120)
        assert strict.status == SUSPECT
        assert lenient.status == VERIFIED

    def test_hopeless_fix_is_neither_confirmed_nor_denied(self):
        r = verify_photo(ev(lat=LAT + 0.05), LAT, LNG, None, entry_accuracy_m=800)
        assert r.status == UNVERIFIED
        assert any("too vague" in x for x in r.reasons)


class TestInternalConsistency:
    def test_future_timestamp_is_conflicted(self):
        r = verify_photo(ev(taken_at=NOW + timedelta(days=400)), LAT, LNG, NOW)
        assert r.status == CONFLICTED
        assert any("future" in x for x in r.reasons)

    def test_editing_software_is_noted_but_not_fatal(self):
        r = verify_photo(ev(software="Adobe Photoshop"), LAT, LNG, NOW)
        assert r.status == VERIFIED
        assert any("editing software" in x for x in r.reasons)


class TestReporting:
    def test_every_result_explains_itself(self):
        for e in (ev(), PhotoEvidence(), ev(lat=LAT + 0.05)):
            assert verify_photo(e, LAT, LNG, NOW).reasons

    def test_serialises(self):
        import json
        json.dumps(verify_photo(ev(), LAT, LNG, NOW).as_dict())

    def test_only_verified_is_defensible(self):
        assert verify_photo(ev(), LAT, LNG, NOW).is_defensible is True
        assert verify_photo(PhotoEvidence(), LAT, LNG, NOW).is_defensible is False
        assert verify_photo(ev(lat=LAT + 0.05), LAT, LNG, NOW).is_defensible is False


class TestExtraction:
    def test_missing_file_returns_empty_not_raise(self):
        from app.services.photo_evidence import extract_exif
        assert extract_exif("/nonexistent/photo.jpg").has_gps is False

    def test_non_image_returns_empty_not_raise(self, tmp_path):
        from app.services.photo_evidence import extract_exif
        p = tmp_path / "notes.txt"
        p.write_text("not an image")
        assert extract_exif(str(p)).has_time is False
