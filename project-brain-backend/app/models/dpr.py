from sqlalchemy import (
    Column, Date, DateTime, Float, ForeignKey, Integer, String, Text,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base


# ============================================================================
# Legacy DPR table — one row per (scheme, date). Kept for backward compat with
# the existing /dpr endpoint and the "Legacy mode" toggle on the UI.
# ============================================================================
class DPREntry(Base):
    __tablename__ = "dpr_entries"

    id = Column(Integer, primary_key=True, index=True)
    scheme_id = Column(Integer, ForeignKey("schemes.id"), nullable=False)
    report_date = Column(Date, nullable=False)
    weather = Column(String, default="Clear")
    manpower = Column(Integer, default=0)
    work_done = Column(Text, nullable=True)
    issues = Column(Text, nullable=True)


# ============================================================================
# Sprint 14a — multi-entry DPR. Many rows per (scheme, date), each with its
# own GPS, area, and zero-or-more photos.
# ============================================================================
class DPREntryV2(Base):
    __tablename__ = "dpr_entries_v2"

    id = Column(Integer, primary_key=True, index=True)
    scheme_id = Column(Integer, ForeignKey("schemes.id"), nullable=False, index=True)
    report_date = Column(Date, nullable=False, index=True)

    area_name = Column(String(200), nullable=True)
    gps_lat = Column(Float, nullable=False)
    gps_lng = Column(Float, nullable=False)
    gps_accuracy_m = Column(Float, nullable=True)

    work_done = Column(Text, nullable=True)
    issues = Column(Text, nullable=True)
    weather = Column(String(40), default="Clear")
    manpower = Column(Integer, default=0)

    created_by = Column(String(100), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    photos = relationship(
        "DPRPhoto",
        back_populates="entry",
        cascade="all, delete-orphan",
        order_by="DPRPhoto.id",
    )


class DPRPhoto(Base):
    __tablename__ = "dpr_photos"

    id = Column(Integer, primary_key=True, index=True)
    dpr_entry_id = Column(
        Integer,
        ForeignKey("dpr_entries_v2.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # Path relative to UPLOAD_DIR — e.g. "dpr/12/2026-05/abc123.jpg"
    # Served at /uploads/<file_path>.
    file_path = Column(String(500), nullable=False)
    captured_at = Column(DateTime(timezone=True), server_default=func.now())

    entry = relationship("DPREntryV2", back_populates="photos")


class CorporateManpowerDaily(Base):
    __tablename__ = "corporate_manpower_daily"

    id = Column(Integer, primary_key=True, index=True)
    scheme_id = Column(Integer, ForeignKey("schemes.id"))
    record_date = Column(Date)
    rsp_executives = Column(Integer, default=0)
    rsp_non_executives = Column(Integer, default=0)
    agency_executives = Column(Integer, default=0)
    agency_non_executives = Column(Integer, default=0)
    subcontractor_supervisors = Column(Integer, default=0)
    subcontractor_labour = Column(Integer, default=0)
