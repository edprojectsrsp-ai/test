from sqlalchemy import Boolean, Column, Date, Float, ForeignKey, Integer, String, TIMESTAMP, func
from sqlalchemy.orm import relationship

from app.core.database import Base

# --- CORPORATE AMR MODELS ---


class CorporatePlanHeader(Base):
    __tablename__ = "corporate_plan_header"

    plan_id = Column(Integer, primary_key=True, index=True)
    scheme_id = Column(Integer, ForeignKey("scheme_master.scheme_id"))
    financial_year = Column(String)

    # Versioning & Status Logic from MVP
    plan_status = Column(String, default="Draft")  # 'Draft' or 'Active'
    version_no = Column(Integer, default=1)
    effective_month = Column(Date, nullable=True)

    activities = relationship("CorporatePlanActivity", backref="plan_header")


class CorporatePlanActivity(Base):
    __tablename__ = "corporate_plan_activities"

    plan_activity_id = Column(Integer, primary_key=True, index=True)
    plan_id = Column(Integer, ForeignKey("corporate_plan_header.plan_id"))
    activity_name = Column(String)
    uom = Column(String)
    scope = Column(Float)
    weightage = Column(Float)  # Validated to <= 100


class CorporatePlanMonthly(Base):
    __tablename__ = "corporate_plan_monthly"

    plan_monthly_id = Column(Integer, primary_key=True, index=True)
    plan_activity_id = Column(Integer, ForeignKey("corporate_plan_activities.plan_activity_id"))
    plan_month = Column(Date)
    planned_qty = Column(Float)


class CorporateActualDaily(Base):
    __tablename__ = "corporate_actual_daily"

    actual_id = Column(Integer, primary_key=True, index=True)
    scheme_id = Column(Integer, ForeignKey("scheme_master.scheme_id"))
    plan_activity_id = Column(Integer, ForeignKey("corporate_plan_activities.plan_activity_id"))
    entry_date = Column(Date)  # Month anchor (first of month) for cumulative actuals
    actual_qty = Column(Float)  # Validated >= previous month


# --- PLANT AMR MODEL ---


class PlantProgressMonthly(Base):
    __tablename__ = "plant_progress_monthly"

    progress_id = Column(Integer, primary_key=True, index=True)
    scheme_id = Column(Integer, ForeignKey("scheme_master.scheme_id"))
    progress_month = Column(Date)
    cumulative_progress_percent = Column(Float)  # Validated >= previous month
    progress_remark = Column(String)
    scheme_status = Column(String, default="ongoing")
    closure_date = Column(Date)
    expected_completion_date = Column(Date, nullable=True)
    created_at = Column(TIMESTAMP, server_default=func.now())
    updated_at = Column(TIMESTAMP, server_default=func.now(), onupdate=func.now())


# Legacy model kept for current API compatibility (existing /api/v1/progress endpoints).
class ProgressEntry(Base):
    __tablename__ = "progress_entries"

    id = Column(Integer, primary_key=True, index=True)
    scheme_id = Column(Integer, ForeignKey("schemes.id"), nullable=False)
    financial_year = Column(String, nullable=False, index=True)
    month = Column(String, nullable=False)
    planned_pct = Column(Float, default=0.0)
    actual_pct = Column(Float, default=0.0)
