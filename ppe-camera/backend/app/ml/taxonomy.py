"""
Canonical PPE label taxonomy.

This is the single source of truth for what the model detects and what
counts as a violation. It maps the messy, inconsistent class names found
across public datasets (Roboflow Construction-Safety, SH17, etc.) onto one
clean internal set, so we can mix datasets during fine-tuning without chaos.

Design decisions:
- We track BOTH positive ("Helmet") and negative ("NO-Helmet") classes.
  Some datasets only label the positive and rely on a 'person' box lacking
  the gear; others label the negative directly. We support both paths.
- 'Person' is kept because violation logic is per-person: a helmet lying on
  the ground is not a violation; a person without one is.
"""
from __future__ import annotations

# Internal canonical classes (stable order = training class indices).
CANONICAL_CLASSES: list[str] = [
    "person",
    "helmet",
    "no_helmet",
    "vest",
    "no_vest",
    "gloves",
    "no_gloves",
    "goggles",
    "no_goggles",
    "boots",
    "no_boots",
    "harness",
    "no_harness",
    "mask",
    "no_mask",
    # --- direct-hazard classes (presence == hazard, no positive/negative pair)
    "smoking",
    "mobile_phone",
    "fire",
    "smoke",
    "vehicle",        # for near-miss (person vs moving vehicle/equipment)
    "fall",           # Hexmon/Vyra Fall-Detected
]

CLASS_TO_ID: dict[str, int] = {c: i for i, c in enumerate(CANONICAL_CLASSES)}

# Direct hazards: detecting the class at all is a violation/hazard, unlike PPE
# gear where the *absence* on a person is the violation.
HAZARD_CLASSES: set[str] = {"smoking", "mobile_phone", "fire", "smoke", "fall"}
# Scene-level hazards drive incidents/alerts, not per-person PPE logic.
SCENE_HAZARD_CLASSES: set[str] = {"fire", "smoke", "fall"}

# Which canonical classes are "violation" classes -> drive alerts.
VIOLATION_CLASSES: set[str] = {
    c for c in CANONICAL_CLASSES if c.startswith("no_")
} | HAZARD_CLASSES

# Positive gear classes, paired with their violation counterpart.
GEAR_PAIRS: dict[str, str] = {
    "helmet": "no_helmet",
    "vest": "no_vest",
    "gloves": "no_gloves",
    "goggles": "no_goggles",
    "boots": "no_boots",
    "harness": "no_harness",
    "mask": "no_mask",
}

# Human-facing labels for live feed + reports (industry-style chips).
# Keep short — OpenCV HUD text is ASCII-only.
DISPLAY_NAMES: dict[str, str] = {
    "helmet": "Cap",
    "no_helmet": "Cap",
    "vest": "Safety Jacket",
    "no_vest": "Safety Jacket",
    "mask": "Mask",
    "no_mask": "Mask",
    "gloves": "Gloves",
    "no_gloves": "Gloves",
    "goggles": "Goggles",
    "no_goggles": "Goggles",
    "boots": "Boots",
    "no_boots": "Boots",
    "harness": "Harness",
    "no_harness": "Harness",
    "person": "Person",
    "smoking": "Smoking",
    "mobile_phone": "Mobile Phone",
    "fire": "Fire",
    "smoke": "Smoke",
    "vehicle": "Vehicle",
    "fall": "Fall",
}

# Configurable PPE catalog for the UI (required-gear checkboxes).
# `in_stock_models` = present in Snehil / VoxDroid pretrained weights.
PPE_CATALOG: list[dict] = [
    {"id": "helmet", "label": "Cap / Hardhat", "display": "Cap",
     "default": True, "in_stock_models": True, "zone_hint": "head"},
    {"id": "vest", "label": "Safety Jacket / Vest", "display": "Safety Jacket",
     "default": True, "in_stock_models": True, "zone_hint": "torso"},
    {"id": "mask", "label": "Face Mask / Respirator", "display": "Mask",
     "default": False, "in_stock_models": True, "zone_hint": "face"},
    {"id": "gloves", "label": "Gloves", "display": "Gloves",
     "default": False, "in_stock_models": True, "zone_hint": "hands",
     "note": "Best with Hexmon/Vyra"},
    {"id": "goggles", "label": "Safety Goggles", "display": "Goggles",
     "default": False, "in_stock_models": True, "zone_hint": "face",
     "note": "Best with Hexmon/Vyra"},
    {"id": "boots", "label": "Safety Boots", "display": "Boots",
     "default": False, "in_stock_models": False, "zone_hint": "feet"},
    {"id": "harness", "label": "Safety Harness", "display": "Harness",
     "default": False, "in_stock_models": False, "zone_hint": "torso"},
]


def display_name(cls_name: str) -> str:
    return DISPLAY_NAMES.get(cls_name, cls_name.replace("_", " ").title())


def found_label(gear_id: str) -> str:
    return f"{DISPLAY_NAMES.get(gear_id, gear_id.title())} Found"


def missing_label(gear_id: str) -> str:
    return f"{DISPLAY_NAMES.get(gear_id, gear_id.title())} Not found"

# Alias table: lowercase raw label from any public dataset -> canonical.
# Extend this as you fold in new datasets; unknown labels are logged, not dropped.
ALIASES: dict[str, str] = {
    # people
    "person": "person", "worker": "person", "people": "person",
    # helmet / hardhat
    "helmet": "helmet", "hardhat": "helmet", "hard-hat": "helmet",
    "hard_hat": "helmet", "safety-helmet": "helmet",
    "no-helmet": "no_helmet", "no-hardhat": "no_helmet",
    "nohardhat": "no_helmet", "no_hardhat": "no_helmet",
    "head": "no_helmet",  # bare head = no helmet
    # vest
    "vest": "vest", "safety-vest": "vest", "safety vest": "vest",
    "reflective-vest": "vest",
    "no-vest": "no_vest", "no-safety-vest": "no_vest",
    # gloves
    "gloves": "gloves", "glove": "gloves", "hand-gloves": "gloves",
    "no-gloves": "no_gloves", "no-glove": "no_gloves",
    # goggles / glasses
    "goggles": "goggles", "glasses": "goggles", "safety-glasses": "goggles",
    "eye-wear": "goggles",
    "no-goggles": "no_goggles", "no-glasses": "no_goggles",
    # boots
    "boots": "boots", "boot": "boots", "safety-boots": "boots", "shoes": "boots",
    "no-boots": "no_boots", "no-shoes": "no_boots",
    # harness
    "harness": "harness", "safety-harness": "harness",
    "no-harness": "no_harness",
    # mask
    "mask": "mask", "face-mask": "mask", "respirator": "mask",
    "no-mask": "no_mask",
    # direct hazards
    "smoking": "smoking", "cigarette": "smoking", "smoke-person": "smoking",
    "mobile": "mobile_phone", "phone": "mobile_phone", "cell-phone": "mobile_phone",
    "cellphone": "mobile_phone", "mobile-phone": "mobile_phone",
    "fire": "fire", "flame": "fire",
    "smoke": "smoke",
    "vehicle": "vehicle", "car": "vehicle", "truck": "vehicle",
    "forklift": "vehicle", "excavator": "vehicle", "crane": "vehicle",
    "machinery": "vehicle",
    # Hexmon / Vyra extras
    "fall": "fall", "fall_detected": "fall", "fall-detected": "fall",
}


def canon(raw_label: str) -> str | None:
    """Map any raw dataset label to a canonical class, or None if unknown."""
    key = raw_label.strip().lower().replace(" ", "-")
    if key in ALIASES:
        return ALIASES[key]
    # try underscore form too
    return ALIASES.get(key.replace("-", "_"))

