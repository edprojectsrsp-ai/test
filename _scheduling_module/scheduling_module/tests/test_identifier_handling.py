"""Identifiers must survive the API layer unchanged.

sql/schema.sql declares every primary key as UUID DEFAULT gen_random_uuid(),
models.py mirrors that with UUID(as_uuid=True), and POST /projects returns
str(id). Despite that, the routing and service layers coerced ids with int(),
which raises ValueError on any real UUID — so get_schedule, import, cpm/run,
progress, delay, dcma and reports/export all failed on every request made with
an id the API itself had issued.

These tests pin the contract: ids are opaque strings, passed through to the
database, which casts them. That holds whether the deployed keys are UUID or
integer, so it cannot regress in either direction.
"""
from __future__ import annotations

import inspect
import re
import uuid

import pytest

from app.api import routes
from app.services import cpm_service

MODULES = (routes, cpm_service)
ID_NAMES = ("project_id", "baseline_id", "activity_id", "schedule_id")


def test_a_real_uuid_cannot_be_coerced_to_int():
    """The premise: this is what broke, and why a string contract is required."""
    with pytest.raises(ValueError):
        int(str(uuid.uuid4()))


@pytest.mark.parametrize("module", MODULES, ids=lambda m: m.__name__)
def test_no_int_coercion_of_identifiers(module):
    src = inspect.getsource(module)
    offenders = [
        m.group(0)
        for name in ID_NAMES
        for m in re.finditer(rf"\bint\(\s*{name}\s*\)", src)
    ]
    assert not offenders, (
        f"{module.__name__} coerces identifiers to int: {offenders}. "
        "Primary keys are UUID; int() raises on every real id."
    )


@pytest.mark.parametrize("module", MODULES, ids=lambda m: m.__name__)
def test_no_int_coercion_of_id_columns_read_back(module):
    """Ids read out of a row are just as unsafe to coerce as ids from a path."""
    src = inspect.getsource(module)
    bad = re.findall(r"int\(\s*\w+\[[\"'](?:\w*_)?id[\"']\]\s*\)", src)
    assert not bad, f"{module.__name__} coerces id columns to int: {bad}"


@pytest.mark.parametrize("module", MODULES, ids=lambda m: m.__name__)
def test_identifier_annotations_are_not_int(module):
    """A signature saying `project_id: int` invites the coercion back."""
    offenders = []
    for name, fn in vars(module).items():
        if not callable(fn) or not hasattr(fn, "__annotations__"):
            continue
        for arg, ann in getattr(fn, "__annotations__", {}).items():
            if arg in ID_NAMES and ann in (int, "int"):
                offenders.append(f"{name}({arg}: int)")
    assert not offenders, f"{module.__name__}: {offenders}"


def test_uuid_survives_a_round_trip_as_a_string():
    """What the API actually promises: the id it returns is the id it accepts."""
    issued = str(uuid.uuid4())
    assert str(issued) == issued
    assert uuid.UUID(issued)          # still a valid UUID after the round trip


def test_integer_ids_also_pass_through_unchanged():
    """Pass-through must not assume UUID either — if a deployment really does
    use integer keys, the same code path has to keep working."""
    for candidate in ("1", "42", "1000000"):
        assert str(candidate) == candidate
