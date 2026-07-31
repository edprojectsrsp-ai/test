"""
Domain / master-data models -- the persistent backbone the platform was missing.

Before this, the only durable state was the active-learning queue (capture_items
/ review_labels) and the model registry. Cameras lived in memory only and
violations existed just as saved images. These tables make the operational
side real and queryable:

    CameraRecord     -- persisted camera config (survives restart; the manager
                        rehydrates from this on boot)
    Employee         -- plant employee master (for repeat-offender analytics)
    Contractor       -- contractor master (per-agency accountability)
    ViolationEvent   -- one durable violation record (links to a capture image,
                        camera, and optionally a matched person/employee)
    Alert            -- one dispatched alert (channel, status, dedup key)
    Incident         -- a higher-level grouping (e.g. an escalated cluster of
                        violations, a fire event, a fall) with a workflow state
    AuditLog         -- who did what (activate model, edit rule, ack alert)
    Setting          -- key/value app settings (JSON value), single home for
                        tunables the UI can edit without a redeploy

Design notes:
- All FKs are nullable where the link is best-effort (person matching is
  probabilistic). We never want analytics writes to fail because a face/ID
  match was uncertain.
- JSON columns degrade to TEXT-backed JSON on SQLite and JSONB on Postgres,
  matching the existing db.py convention.
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
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


def _uid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


# --------------------------------------------------------------------- cameras
class CameraRecord(Base):
    """Durable camera config. The CameraManager rehydrates these at startup so
    cameras no longer vanish on restart."""

    __tablename__ = "cameras"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)  # camera_id
    name: Mapped[str] = mapped_column(String(128), default="")
    source_kind: Mapped[str] = mapped_column(String(24), default="rtsp")
    source_kwargs: Mapped[dict] = mapped_column(JSON, default=dict)
    required_ppe: Mapped[list] = mapped_column(JSON, default=list)
    zones: Mapped[list] = mapped_column(JSON, default=list)  # restricted-area polygons
    # PPE monitoring zones: masks over public areas, regions of interest and
    # per-zone gear rules. Distinct from `zones` above, which are hazard
    # restricted areas ("nobody should be here at all").
    monitoring_zones: Mapped[list] = mapped_column(JSON, default=list)
    # Detection tuning. min_person_px in particular has to be per camera: 64
    # suits 1080p, but a gantry camera down a 200 m yard gates out most workers
    # at that value, and an operator who tunes it must not lose the change on
    # the next restart.
    detection_rule: Mapped[dict] = mapped_column(JSON, default=dict)
    # Ground-plane homography (app/ml/calibration.py) so this camera's geometry
    # can be expressed in metres rather than pixels.
    calibration: Mapped[dict] = mapped_column(JSON, default=dict)
    priority: Mapped[str] = mapped_column(String(16), default="normal")
    # Keypoints for this camera (Track B). Costs a second model per
    # frame, so it is per-camera rather than global.
    pose_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    mode: Mapped[str] = mapped_column(String(16), default="monitor")
    fps_limit: Mapped[float] = mapped_column(Float, default=6.0)
    location: Mapped[str] = mapped_column(String(128), default="")
    department: Mapped[str] = mapped_column(String(128), default="")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    # health
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_state: Mapped[str] = mapped_column(String(24), default="created")
    last_error: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)


# ------------------------------------------------------------------- personnel
class Employee(Base):
    __tablename__ = "employees"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uid)
    emp_code: Mapped[str] = mapped_column(String(48), index=True, default="")
    name: Mapped[str] = mapped_column(String(128), default="")
    department: Mapped[str] = mapped_column(String(128), default="")
    shift: Mapped[str] = mapped_column(String(32), default="")
    contractor_id: Mapped[str | None] = mapped_column(
        ForeignKey("contractors.id", ondelete="SET NULL"), nullable=True
    )
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class Contractor(Base):
    __tablename__ = "contractors"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uid)
    name: Mapped[str] = mapped_column(String(128), index=True, default="")
    agency_code: Mapped[str] = mapped_column(String(48), default="")
    contact: Mapped[str] = mapped_column(String(128), default="")
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


# ------------------------------------------------------------------ violations
class ViolationStatus(str, enum.Enum):
    open = "open"
    acknowledged = "acknowledged"
    resolved = "resolved"
    false_alarm = "false_alarm"


class ViolationEvent(Base):
    """A durable, queryable violation record. Written whenever the pipeline
    fires a violation (in parallel with the review-queue image capture)."""

    __tablename__ = "violation_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uid)
    camera_id: Mapped[str] = mapped_column(String(64), index=True)
    rule_type: Mapped[str] = mapped_column(String(48), index=True, default="ppe")
    gear: Mapped[str] = mapped_column(String(48), default="")  # missing item / hazard
    track_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Anonymous appearance identity (app/ml/reid.py). Survives occlusion and
    # crosses cameras, unlike track_id — which is why repeat-offender counting
    # groups by this. Not biometric and not durable: the signature behind it
    # expires, this is only the label it had at the time.
    person_key: Mapped[str] = mapped_column(String(48), default="", index=True)
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    person_box: Mapped[list] = mapped_column(JSON, default=list)  # [x1,y1,x2,y2]
    capture_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    image_path: Mapped[str] = mapped_column(Text, default="")
    employee_id: Mapped[str | None] = mapped_column(
        ForeignKey("employees.id", ondelete="SET NULL"), nullable=True
    )
    department: Mapped[str] = mapped_column(String(128), default="", index=True)
    shift: Mapped[str] = mapped_column(String(32), default="", index=True)
    status: Mapped[ViolationStatus] = mapped_column(
        SAEnum(ViolationStatus), default=ViolationStatus.open, index=True
    )
    occurred_at: Mapped[datetime] = mapped_column(DateTime, default=_now, index=True)


# ---------------------------------------------------------------------- alerts
class AlertStatus(str, enum.Enum):
    queued = "queued"
    sent = "sent"
    suppressed = "suppressed"  # cooldown
    failed = "failed"


class Alert(Base):
    __tablename__ = "alerts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uid)
    camera_id: Mapped[str] = mapped_column(String(64), index=True)
    violation_id: Mapped[str | None] = mapped_column(
        ForeignKey("violation_events.id", ondelete="SET NULL"), nullable=True
    )
    channel: Mapped[str] = mapped_column(String(24), default="")  # webhook/whatsapp/email
    gear: Mapped[str] = mapped_column(String(48), default="")
    dedup_key: Mapped[str] = mapped_column(String(128), default="", index=True)
    status: Mapped[AlertStatus] = mapped_column(
        SAEnum(AlertStatus), default=AlertStatus.queued, index=True
    )
    detail: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, index=True)


# ------------------------------------------------------------------- incidents
class IncidentStatus(str, enum.Enum):
    open = "open"
    investigating = "investigating"
    closed = "closed"


class Incident(Base):
    """Higher-level grouping / escalation. E.g. a fire event, a fall, or a
    cluster of repeated violations by one person promoted to an incident."""

    __tablename__ = "incidents"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uid)
    title: Mapped[str] = mapped_column(String(200), default="")
    kind: Mapped[str] = mapped_column(String(48), default="ppe", index=True)
    severity: Mapped[str] = mapped_column(String(16), default="medium")
    camera_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    status: Mapped[IncidentStatus] = mapped_column(
        SAEnum(IncidentStatus), default=IncidentStatus.open, index=True
    )
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, index=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


# ------------------------------------------------------------------- audit/log
class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uid)
    actor: Mapped[str] = mapped_column(String(128), default="system")
    action: Mapped[str] = mapped_column(String(64), index=True)  # e.g. model.activate
    target: Mapped[str] = mapped_column(String(200), default="")
    meta: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, index=True)


# --------------------------------------------------------------------- settings
class Setting(Base):
    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    value: Mapped[dict] = mapped_column(JSON, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)
