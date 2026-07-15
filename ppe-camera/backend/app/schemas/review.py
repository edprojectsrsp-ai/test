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


class ClassesOut(BaseModel):
    classes: list[str]
    violation_classes: list[str]


def classes_payload() -> ClassesOut:
    return ClassesOut(
        classes=taxonomy.CANONICAL_CLASSES,
        violation_classes=sorted(taxonomy.VIOLATION_CLASSES),
    )

