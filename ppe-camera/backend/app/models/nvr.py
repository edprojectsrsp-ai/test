"""
NVR models -- the index over recorded video.

RecordingSegment is one video file on disk. Two kinds exist:

    continuous  a fixed-length slice of an always-on recording
    event       a clip cut around a fired violation/hazard, including the
                pre-roll seconds that were still in memory when it fired

The row is the index, the file is the payload. Everything the timeline needs
(coverage bars, event markers, gaps) is answerable from these columns alone, so
drawing a day of 20 cameras never touches the filesystem.

`locked` exempts a segment from retention pruning. An evidence clip attached to
a disciplinary case must not evaporate because the disk filled up three weeks
later, and "delete oldest" is exactly the policy that would delete it.
"""
from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum as SAEnum,
    Float,
    Integer,
    JSON,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


def _uid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


class SegmentKind(str, enum.Enum):
    continuous = "continuous"
    event = "event"
    manual = "manual"          # operator pressed Record on the live view


class RecordingSegment(Base):
    __tablename__ = "recording_segments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uid)
    camera_id: Mapped[str] = mapped_column(String(64), index=True)
    path: Mapped[str] = mapped_column(Text)
    thumb_path: Mapped[str] = mapped_column(Text, default="")
    kind: Mapped[SegmentKind] = mapped_column(
        SAEnum(SegmentKind), default=SegmentKind.continuous, index=True
    )
    started_at: Mapped[datetime] = mapped_column(DateTime, default=_now, index=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    duration_s: Mapped[float] = mapped_column(Float, default=0.0)
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    width: Mapped[int] = mapped_column(Integer, default=0)
    height: Mapped[int] = mapped_column(Integer, default=0)
    fps: Mapped[float] = mapped_column(Float, default=0.0)
    frames: Mapped[int] = mapped_column(Integer, default=0)
    codec: Mapped[str] = mapped_column(String(16), default="")
    # What made this clip exist: missing gear, a hazard class, a manual press.
    trigger: Mapped[str] = mapped_column(String(64), default="", index=True)
    # Events that landed inside this segment, each {t, gear, rule_type, track_id,
    # confidence}. `t` is seconds from segment start, so the player can drop
    # markers on the scrub bar without a second query.
    events: Mapped[list] = mapped_column(JSON, default=list)
    locked: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, index=True)
