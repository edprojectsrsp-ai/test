"""
Request/response schemas for the review + capture API.

Kept deliberately separate from the ORM models so the wire format is stable
even if the DB schema evolves (backward-compatible responses, your usual rule).
"""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from app.ml import taxonomy


class PredictionOut(BaseModel):
    cls: str
    raw: str | None = None
    conf: float
    xyxy: list[float]
    track_id: int | None = None


class CaptureOut(BaseModel):
    id: str
    camera_id: str
    reason: str
    status: str
    image_url: str
    predictions: list[PredictionOut] = Field(default_factory=list)
    width: int
    height: int
    note: str
    created_at: datetime
    reviewed_at: datetime | None = None


class BoxIn(BaseModel):
    cls: str
    xyxy: list[float]  # [x1, y1, x2, y2] in pixel coords


class CorrectionIn(BaseModel):
    boxes: list[BoxIn]


class LabelOut(BaseModel):
    cls_name: str
    cx: float
    cy: float
    w: float
    h: float


class CaptureDetailOut(CaptureOut):
    labels: list[LabelOut] = Field(default_factory=list)


class ExportIn(BaseModel):
    version: str = Field(..., pattern=r"^[A-Za-z0-9._-]+$")


class ExportOut(BaseModel):
    version: str
    exported_items: int
    dataset_dir: str
    data_yaml: str


class ClassOption(BaseModel):
    """One entry in the labeler's class palette.

    `id` is what training stores; `label` is what the operator reads. They are
    deliberately different: the plant calls a hardhat a "Cap", the datasets call
    it "helmet"/"Hardhat", and an operator hunting for "Cap" in a list of raw
    class ids gives up and mislabels the frame.

    `counterpart` is the same gear with the opposite polarity, which is what
    lets the UI flip a red "Cap Not found" box straight to a green "Cap Found"
    one in a single click instead of making the operator find the right class.
    """
    id: str
    label: str                     # "Cap Not found"
    short: str                     # "Cap"
    group: str                     # gear id shared by the pair, e.g. "helmet"
    polarity: str                  # positive | negative | neutral | hazard
    counterpart: str | None = None
    aliases: list[str] = Field(default_factory=list)


class ClassesOut(BaseModel):
    classes: list[str]             # legacy: bare canonical ids, order = class index
    violation_classes: list[str]
    options: list[ClassOption] = Field(default_factory=list)


def _aliases_for(canonical: str) -> list[str]:
    """Raw dataset labels that map here — so searching 'hardhat' finds 'Cap'."""
    return sorted({raw for raw, c in taxonomy.ALIASES.items() if c == canonical})


def _class_options() -> list[ClassOption]:
    inverse = {v: k for k, v in taxonomy.GEAR_PAIRS.items()}
    out: list[ClassOption] = []
    for c in taxonomy.CANONICAL_CLASSES:
        if c in taxonomy.GEAR_PAIRS:               # positive gear
            group, polarity, counterpart = c, "positive", taxonomy.GEAR_PAIRS[c]
            label = taxonomy.found_label(c)
        elif c in inverse:                          # its negative twin
            group, polarity, counterpart = inverse[c], "negative", inverse[c]
            label = taxonomy.missing_label(group)
        elif c in taxonomy.HAZARD_CLASSES:
            group, polarity, counterpart = c, "hazard", None
            label = taxonomy.display_name(c)
        else:                                       # person, vehicle
            group, polarity, counterpart = c, "neutral", None
            label = taxonomy.display_name(c)
        out.append(ClassOption(
            id=c, label=label, short=taxonomy.display_name(c), group=group,
            polarity=polarity, counterpart=counterpart, aliases=_aliases_for(c),
        ))
    return out


def classes_payload() -> ClassesOut:
    return ClassesOut(
        classes=taxonomy.CANONICAL_CLASSES,
        violation_classes=sorted(taxonomy.VIOLATION_CLASSES),
        options=_class_options(),
    )

