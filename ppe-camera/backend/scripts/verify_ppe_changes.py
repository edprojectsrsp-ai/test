"""Verify this round of PPE changes against the real modules.

Covers the four things that were reported broken:
  1. SH17 class names map onto the canonical PPE taxonomy
  2. the SH17 models are in the zoo catalog and selectable
  3. the alert gear filter no longer discards live violations
  4. the labeler exposes "Cap"-style names and a red<->green counterpart
plus that the app still boots with the training router mounted.

Run:  .venv/Scripts/python.exe scripts/verify_ppe_changes.py
"""
from __future__ import annotations

import sys

PASS, FAIL = "PASS", "FAIL"
results: list[tuple[str, str, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((PASS if ok else FAIL, name, detail))


# --- 1. taxonomy: SH17 raw labels -> canonical --------------------------------
from app.ml import taxonomy  # noqa: E402

SH17 = ["person", "ear", "ear-mufs", "face", "face-guard", "face-mask", "foot",
        "tool", "glasses", "gloves", "helmet", "hands", "head", "medical-suit",
        "shoes", "safety-suit", "safety-vest"]
expected = {
    "person": "person", "helmet": "helmet", "head": "no_helmet",
    "safety-vest": "vest", "gloves": "gloves", "hands": "no_gloves",
    "glasses": "goggles", "face-guard": "goggles", "shoes": "boots",
    "foot": "no_boots", "face-mask": "mask",
}
for raw, want in expected.items():
    got = taxonomy.canon(raw)
    check(f"canon({raw!r}) -> {want}", got == want, f"got {got!r}")

unmapped = [c for c in SH17 if taxonomy.canon(c) is None]
check("unmapped SH17 classes are only non-PPE body parts/objects",
      set(unmapped) <= {"ear", "ear-mufs", "face", "tool", "medical-suit",
                        "safety-suit"},
      f"unmapped={unmapped}")

# --- 2. model zoo -------------------------------------------------------------
from app.ml import model_zoo  # noqa: E402

cat = {m["key"]: m for m in model_zoo.catalog()}
for key in ("sh17-yolo9m", "sh17-yolo9e", "sh17-yolo8s"):
    m = cat.get(key)
    check(f"zoo has {key}", m is not None)
    if m:
        check(f"{key} is downloadable", bool(m["url"]) and m["available"],
              f"url={m['url'][:60]}")
        check(f"{key} advertises helmet + vest",
              "helmet" in m["classes"] and "safety-vest" in m["classes"])

recommended = [k for k, m in cat.items() if m["recommended"]]
check("exactly one recommended default", len(recommended) == 1, f"{recommended}")

# --- 3. alert gear filter -----------------------------------------------------
from app.services.alert_service import AlertService  # noqa: E402

f = AlertService._passes_gear_filter
UI_FILTER = ["NO_HELMET", "NO_VEST"]          # exactly what the Settings tab stores

check("live NO_HELMET violation passes the UI filter",
      f({"violation": "NO_HELMET", "meta": {}}, UI_FILTER))
check("legacy lowercase payload still passes (old queued alerts)",
      f({"violation": "NO_helmet", "meta": {}}, UI_FILTER))
check("escalation of a filtered gear passes",
      f({"violation": "ESCALATION — NO_HELMET", "meta": {}}, UI_FILTER))
check("gear NOT in the filter is dropped",
      not f({"violation": "NO_GLOVES", "meta": {}}, UI_FILTER))
check("empty filter means everything passes",
      f({"violation": "NO_GLOVES", "meta": {}}, []))
check("digests are never gear-filtered",
      f({"violation": "12 further violations suppressed", "meta": {"digest": True}},
        UI_FILTER))
check("filter written as bare gear name still matches",
      f({"violation": "NO_HELMET", "meta": {}}, ["helmet"]))

# The regression this replaced: uppercase filter vs lowercase payload.
check("the old comparison would have dropped it (bug is real)",
      "NO_helmet" not in UI_FILTER)

# --- 4. labeler class palette -------------------------------------------------
from app.schemas.review import classes_payload  # noqa: E402

payload = classes_payload()
opts = {o.id: o for o in payload.options}
check("legacy `classes` list unchanged (training indices stable)",
      payload.classes == taxonomy.CANONICAL_CLASSES)
check("every canonical class has an option",
      set(opts) == set(taxonomy.CANONICAL_CLASSES))
check("no_helmet reads as 'Cap Not found'",
      opts["no_helmet"].label == "Cap Not found", opts["no_helmet"].label)
check("helmet reads as 'Cap Found'",
      opts["helmet"].label == "Cap Found", opts["helmet"].label)
check("red -> green flip target is helmet",
      opts["no_helmet"].counterpart == "helmet")
check("green -> red flip target is no_helmet",
      opts["helmet"].counterpart == "no_helmet")
check("'hardhat' is searchable as an alias of Cap",
      "hardhat" in opts["helmet"].aliases, str(opts["helmet"].aliases))
check("'head' is listed as an alias of Cap Not found",
      "head" in opts["no_helmet"].aliases, str(opts["no_helmet"].aliases))
check("polarities are assigned",
      opts["person"].polarity == "neutral"
      and opts["no_vest"].polarity == "negative"
      and opts["fire"].polarity == "hazard")

# --- 5. app boots with the training router ------------------------------------
from app.main import create_app  # noqa: E402

# Read the OpenAPI schema rather than walking .routes: recent FastAPI wraps
# include_router() results in _IncludedRouter objects that have no .path.
routes = set(create_app().openapi().get("paths", {}))
for path in ("/api/training/status", "/api/training/start", "/api/training/cancel"):
    check(f"route {path} mounted", path in routes)

# --- report -------------------------------------------------------------------
failed = [r for r in results if r[0] == FAIL]
for status, name, detail in results:
    print(f"{status}  {name}" + (f"   [{detail}]" if detail and status == FAIL else ""))
print(f"\n{len(results) - len(failed)}/{len(results)} passed")
sys.exit(1 if failed else 0)
