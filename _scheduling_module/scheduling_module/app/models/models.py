"""SQLAlchemy ORM models (mirror of sql/schema.sql)."""
from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import (Boolean, Date, DateTime, ForeignKey, Integer, Numeric,
                        String, Text, func)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base


def _uuid_pk():
    return mapped_column(UUID(as_uuid=True), primary_key=True,
                         default=uuid.uuid4)


class Project(Base):
    __tablename__ = "projects"
    id: Mapped[uuid.UUID] = _uuid_pk()
    name: Mapped[str] = mapped_column(Text, nullable=False)
    code: Mapped[str | None] = mapped_column(Text, unique=True)
    description: Mapped[str | None] = mapped_column(Text)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    data_date: Mapped[date | None] = mapped_column(Date)
    default_calendar_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    created_by: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True),
                                                 server_default=func.now())


class Calendar(Base):
    __tablename__ = "calendars"
    id: Mapped[uuid.UUID] = _uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(Text, nullable=False)
    working_weekdays: Mapped[list[int]] = mapped_column(
        ARRAY(Integer), default=lambda: [1, 2, 3, 4, 5])
    holidays: Mapped[list[date]] = mapped_column(ARRAY(Date), default=list)
    exceptions_work: Mapped[list[date]] = mapped_column(ARRAY(Date), default=list)
    hours_per_day: Mapped[float] = mapped_column(Numeric(4, 2), default=8.0)


class WBS(Base):
    __tablename__ = "wbs"
    id: Mapped[uuid.UUID] = _uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"))
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("wbs.id", ondelete="CASCADE"))
    code: Mapped[str] = mapped_column(Text, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    sequence: Mapped[int] = mapped_column(Integer, default=0)


class Activity(Base):
    __tablename__ = "activities"
    id: Mapped[uuid.UUID] = _uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"))
    wbs_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("wbs.id", ondelete="SET NULL"))
    calendar_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("calendars.id", ondelete="SET NULL"))
    code: Mapped[str] = mapped_column(Text, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    duration: Mapped[int] = mapped_column(Integer, default=0)
    remaining_duration: Mapped[int | None] = mapped_column(Integer)
    percent_complete: Mapped[float] = mapped_column(Numeric(5, 2), default=0)
    is_milestone: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String, default="not_started")
    actual_start: Mapped[date | None] = mapped_column(Date)
    actual_finish: Mapped[date | None] = mapped_column(Date)
    constraint_type: Mapped[str] = mapped_column(String, default="NONE")
    constraint_date: Mapped[date | None] = mapped_column(Date)
    agency: Mapped[str | None] = mapped_column(Text)
    discipline: Mapped[str | None] = mapped_column(Text)
    package: Mapped[str | None] = mapped_column(Text)
    area: Mapped[str | None] = mapped_column(Text)
    early_start: Mapped[date | None] = mapped_column(Date)
    early_finish: Mapped[date | None] = mapped_column(Date)
    late_start: Mapped[date | None] = mapped_column(Date)
    late_finish: Mapped[date | None] = mapped_column(Date)
    total_float: Mapped[int | None] = mapped_column(Integer)
    free_float: Mapped[int | None] = mapped_column(Integer)
    is_critical: Mapped[bool] = mapped_column(Boolean, default=False)


class Relationship(Base):
    __tablename__ = "relationships"
    id: Mapped[uuid.UUID] = _uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"))
    predecessor_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("activities.id", ondelete="CASCADE"))
    successor_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("activities.id", ondelete="CASCADE"))
    rel_type: Mapped[str] = mapped_column(String, default="FS")
    lag: Mapped[int] = mapped_column(Integer, default=0)


class Baseline(Base):
    __tablename__ = "baselines"
    id: Mapped[uuid.UUID] = _uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(Text, nullable=False)
    is_primary: Mapped[bool] = mapped_column(Boolean, default=False)
    project_finish: Mapped[date | None] = mapped_column(Date)
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True),
                                                  server_default=func.now())


class BaselineActivity(Base):
    __tablename__ = "baseline_activities"
    id: Mapped[uuid.UUID] = _uuid_pk()
    baseline_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("baselines.id", ondelete="CASCADE"))
    activity_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("activities.id", ondelete="CASCADE"))
    bl_start: Mapped[date | None] = mapped_column(Date)
    bl_finish: Mapped[date | None] = mapped_column(Date)
    bl_duration: Mapped[int | None] = mapped_column(Integer)
    bl_total_float: Mapped[int | None] = mapped_column(Integer)


class UpdateLog(Base):
    __tablename__ = "update_logs"
    id: Mapped[uuid.UUID] = _uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"))
    activity_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("activities.id", ondelete="SET NULL"))
    update_date: Mapped[datetime] = mapped_column(DateTime(timezone=True),
                                                  server_default=func.now())
    data_date: Mapped[date | None] = mapped_column(Date)
    changed_by: Mapped[str | None] = mapped_column(Text)
    field_name: Mapped[str | None] = mapped_column(Text)
    previous_value: Mapped[str | None] = mapped_column(Text)
    revised_value: Mapped[str | None] = mapped_column(Text)
    remarks: Mapped[str | None] = mapped_column(Text)


class Hindrance(Base):
    __tablename__ = "hindrances"
    id: Mapped[uuid.UUID] = _uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"))
    activity_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("activities.id", ondelete="SET NULL"))
    hindrance_type: Mapped[str | None] = mapped_column(Text)
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
    responsibility: Mapped[str | None] = mapped_column(Text)
    impact_days: Mapped[int | None] = mapped_column(Integer)
    remarks: Mapped[str | None] = mapped_column(Text)
    documents: Mapped[list] = mapped_column(JSONB, default=list)


class Risk(Base):
    __tablename__ = "risks"
    id: Mapped[uuid.UUID] = _uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"))
    activity_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("activities.id", ondelete="SET NULL"))
    wbs_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("wbs.id", ondelete="SET NULL"))
    title: Mapped[str] = mapped_column(Text, nullable=False)
    category: Mapped[str | None] = mapped_column(Text)
    probability: Mapped[float | None] = mapped_column(Numeric(4, 2))
    impact_days: Mapped[int | None] = mapped_column(Integer)
    impact_cost: Mapped[float | None] = mapped_column(Numeric(16, 2))
    severity_score: Mapped[float | None] = mapped_column(Numeric(6, 2))
    mitigation: Mapped[str | None] = mapped_column(Text)
    owner: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String, default="open")


class DcmaRun(Base):
    __tablename__ = "dcma_runs"
    id: Mapped[uuid.UUID] = _uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"))
    run_at: Mapped[datetime] = mapped_column(DateTime(timezone=True),
                                             server_default=func.now())
    score: Mapped[float | None] = mapped_column(Numeric(5, 1))
    passed_count: Mapped[int | None] = mapped_column(Integer)
    applicable_count: Mapped[int | None] = mapped_column(Integer)
    detail: Mapped[list] = mapped_column(JSONB, default=list)


class Alert(Base):
    __tablename__ = "alerts"
    id: Mapped[uuid.UUID] = _uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"))
    activity_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("activities.id", ondelete="CASCADE"))
    category: Mapped[str] = mapped_column(Text, nullable=False)
    severity: Mapped[str] = mapped_column(String, default="warning")
    message: Mapped[str] = mapped_column(Text, nullable=False)
    is_resolved: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True),
                                                 server_default=func.now())
