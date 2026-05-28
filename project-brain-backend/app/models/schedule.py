"""Schedule models for CPM (Critical Path Method) analysis."""
from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, ForeignKey, Text, DateTime
from sqlalchemy.orm import relationship
from app.core.database import Base


class ScheduleImport(Base):
    """Imported project schedules (MS Project .xer or .xml files)."""
    __tablename__ = "schedule_imports"

    id = Column(Integer, primary_key=True)
    project_id = Column(Integer, nullable=False)
    file_name = Column(String(255), nullable=False)
    imported_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    
    # Relationship
    activities = relationship("ScheduleActivity", back_populates="import", cascade="all, delete-orphan")


class ScheduleActivity(Base):
    """CPM activities parsed from schedule imports."""
    __tablename__ = "schedule_activities"

    id = Column(Integer, primary_key=True)
    schedule_id = Column(Integer, ForeignKey("schedule_imports.id"), nullable=False)
    activity_uid = Column(String(255), nullable=True)
    activity_code = Column(String(255), nullable=True)
    activity_name = Column(String(255), nullable=False)
    wbs = Column(String(255), nullable=True)
    duration_days = Column(Float, default=0.0)
    start_date = Column(String(10), nullable=True)  # YYYY-MM-DD
    finish_date = Column(String(10), nullable=True)  # YYYY-MM-DD
    actual_start = Column(String(10), nullable=True)
    actual_finish = Column(String(10), nullable=True)
    percent_complete = Column(Float, default=0.0)
    predecessors = Column(Text, nullable=True)  # JSON array or comma-separated
    successors = Column(Text, nullable=True)  # JSON array or comma-separated
    early_start = Column(String(10), nullable=True)
    early_finish = Column(String(10), nullable=True)
    late_start = Column(String(10), nullable=True)
    late_finish = Column(String(10), nullable=True)
    total_float = Column(Float, default=0.0)
    is_critical = Column(String(10), default="No")  # "Yes" or "No"
    raw_data = Column(Text, nullable=True)  # Store original parsed data as JSON
    
    # Relationship
    import_ = relationship("ScheduleImport", back_populates="activities")
