"""
Data models for the active-learning loop.

CaptureItem  -- one saved frame awaiting human review. Created automatically
                whenever a violation fires (your choice: capture ALL violations).
ReviewLabel  -- one human-corrected box on a capture. This is the gold data
                that gets exported to YOLO format and folded into retraining.

The lifecycle of a capture:
    pending  -> a human opens it in the dashboard
    labeled  -> human corrected/confirmed the boxes  (feeds training)
    ignored  -> human marked it as not useful         (never trains on it)
    exported -> its labels have been baked into a dataset version
"""
from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    JSON,
    DateTime,
    Enum as SAEnum,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


def _uid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


class CaptureStatus(str, enum.Enum):
    pending = "pending"
    labeled = "labeled"
    ignored = "ignored"
    exported = "exported"


class CaptureReason(str, enum.Enum):
    violation = "violation"      # a rule fired
    uncertain = "uncertain"      # low-confidence frame (active learning)
    manual = "manual"            # a human flagged it from the live view


class CaptureItem(Base):
    __tablename__ = "capture_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uid)
    camera_id: Mapped[str] = mapped_column(String(64), index=True)
    image_path: Mapped[str] = mapped_column(Text)
    reason: Mapped[CaptureReason] = mapped_column(
        SAEnum(CaptureReason), default=CaptureReason.violation, index=True
    )
    status: Mapped[CaptureStatus] = mapped_column(
        SAEnum(CaptureStatus), default=CaptureStatus.pending, index=True
    )
    # The model's own predictions at capture time, as a list of
    # {cls, conf, xyxy:[x1,y1,x2,y2], track_id}. Shown as editable overlays.
    predictions: Mapped[list] = mapped_column(JSON, default=list)
    width: Mapped[int] = mapped_column(Integer, default=0)
    height: Mapped[int] = mapped_column(Integer, default=0)
    note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, index=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    labels: Mapped[list["ReviewLabel"]] = relationship(
        back_populates="capture", cascade="all, delete-orphan"
    )


class ReviewLabel(Base):
    __tablename__ = "review_labels"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uid)
    capture_id: Mapped[str] = mapped_column(
        ForeignKey("capture_items.id", ondelete="CASCADE"), index=True
    )
    cls_name: Mapped[str] = mapped_column(String(48))  # canonical class
    # Normalized xywh (YOLO format, 0..1) so export is trivial and
    # resolution-independent.
    cx: Mapped[float] = mapped_column(Float)
    cy: Mapped[float] = mapped_column(Float)
    w: Mapped[float] = mapped_column(Float)
    h: Mapped[float] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    capture: Mapped["CaptureItem"] = relationship(back_populates="labels")

