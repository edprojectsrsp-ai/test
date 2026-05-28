"""
Progress models — remapped to LIVE t5 tables.

Sprint 0 fix. The previous file defined t3-era tables that DO NOT EXIST in t5
(corporate_plan_header/activities/monthly, corporate_actual_daily,
progress_entries) and a wrong-shape plant_progress_monthly. This version maps
to the real normalized t5 progress chain:

    progress_plans  ->  plan_activities  ->  monthly_plan_entries (planned)
                                          ->  daily_actuals       (actuals)

and the correct package-keyed plant_progress_monthly.

CUSTOM SCHEME-ROLLUP WEIGHT CONVENTION (Sprint 0 decision, no schema change):
    A package's weight when rolling multiple packages into one scheme-level
    S-curve is read from packages.extra_fields['scheme_rollup_weight'].
    Fallback chain if unset: package_value_cr -> package_estimate_cr ->
    equal weight. Implemented in the router, documented here.

variance_pct on plant_progress_monthly is a STORED GENERATED column — mapped
read-only via Computed(); never include it in INSERT/UPDATE.

Place at: project-brain-backend/app/models/progress.py
"""

from sqlalchemy import (
    Column, Integer, String, Text, Numeric, Date, DateTime, Boolean,
    ForeignKey, Computed, ARRAY, UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base


# ============================================================================
# PROGRESS PLAN (package-keyed, versioned by FY + plan_version + is_current)
# ============================================================================
class ProgressPlan(Base):
    __tablename__ = "progress_plans"

    plan_id = Column(Integer, primary_key=True, autoincrement=True)
    package_id = Column(Integer, ForeignKey("packages.package_id", ondelete="CASCADE"), nullable=False)
    plan_name = Column(String(200), nullable=False)
    plan_type = Column(String(50), nullable=False, default="execution")
    financial_year = Column(String(10))
    plan_version = Column(String(20))
    is_current = Column(Boolean, nullable=False, default=True)
    is_locked = Column(Boolean, nullable=False, default=False)
    plan_start_date = Column(Date)
    plan_end_date = Column(Date)
    appendix2_revision_id = Column(Integer)
    description = Column(Text)
    extra_fields = Column(JSONB, nullable=False, default=dict)
    is_deleted = Column(Boolean, nullable=False, default=False)
    created_by = Column(Integer, ForeignKey("users.user_id"))
    created_at = Column(DateTime, nullable=False, server_default=func.current_timestamp())
    updated_by = Column(Integer, ForeignKey("users.user_id"))
    updated_at = Column(DateTime, nullable=False, server_default=func.current_timestamp())

    activities = relationship("PlanActivity", back_populates="plan", cascade="all, delete-orphan")


class PlanActivity(Base):
    __tablename__ = "plan_activities"

    activity_id = Column(Integer, primary_key=True, autoincrement=True)
    plan_id = Column(Integer, ForeignKey("progress_plans.plan_id", ondelete="CASCADE"), nullable=False)
    activity_master_id = Column(Integer, ForeignKey("activity_master_global.activity_master_id"))
    appendix2_item_id = Column(Integer)
    activity_name = Column(String(255), nullable=False)
    activity_category = Column(String(100))
    uom_id = Column(Integer, ForeignKey("uom_master.uom_id"))
    scope_qty = Column(Numeric(15, 3))
    weight_pct = Column(Numeric(5, 2), nullable=False, default=0)
    planned_start_date = Column(Date)
    planned_finish_date = Column(Date)
    actual_start_date = Column(Date)
    actual_finish_date = Column(Date)
    actuals_till_last_fy = Column(Numeric(15, 3), nullable=False, default=0)
    expected_finish_date = Column(Date)
    sort_order = Column(Integer, nullable=False, default=0)
    notes = Column(Text)
    is_deleted = Column(Boolean, nullable=False, default=False)
    extra_fields = Column(JSONB, nullable=False, default=dict)
    created_at = Column(DateTime, nullable=False, server_default=func.current_timestamp())
    updated_at = Column(DateTime, nullable=False, server_default=func.current_timestamp())

    plan = relationship("ProgressPlan", back_populates="activities")
    monthly_entries = relationship("MonthlyPlanEntry", back_populates="activity", cascade="all, delete-orphan")
    daily_actuals = relationship("DailyActual", back_populates="activity", cascade="all, delete-orphan")


class MonthlyPlanEntry(Base):
    __tablename__ = "monthly_plan_entries"

    monthly_entry_id = Column(Integer, primary_key=True, autoincrement=True)
    activity_id = Column(Integer, ForeignKey("plan_activities.activity_id", ondelete="CASCADE"), nullable=False)
    month_date = Column(Date, nullable=False)  # DB CHECK: must be first-of-month
    planned_qty = Column(Numeric(15, 3), nullable=False, default=0)
    row_type = Column(String(20), default="plan")
    notes = Column(Text)
    created_at = Column(DateTime, nullable=False, server_default=func.current_timestamp())
    updated_at = Column(DateTime, nullable=False, server_default=func.current_timestamp())

    activity = relationship("PlanActivity", back_populates="monthly_entries")


class DailyActual(Base):
    """
    Single source of truth for physical actuals from ALL THREE entry paths.
    entered_via distinguishes: 'web' (admin direct), 'app' (mobile), 'dpr'.
    """
    __tablename__ = "daily_actuals"

    daily_actual_id = Column(Integer, primary_key=True, autoincrement=True)
    activity_id = Column(Integer, ForeignKey("plan_activities.activity_id", ondelete="CASCADE"), nullable=False)
    actual_date = Column(Date, nullable=False)
    actual_qty = Column(Numeric(15, 3), nullable=False, default=0)
    area_of_work = Column(String(300))
    manpower_count = Column(Integer)
    equipment_deployed = Column(Text)
    weather_conditions = Column(String(100))
    remarks = Column(Text)
    entered_by = Column(Integer, ForeignKey("users.user_id"))
    entered_via = Column(String(20), default="web")  # 'web' | 'app' | 'dpr'
    location_lat = Column(Numeric(10, 7))
    location_lng = Column(Numeric(10, 7))
    photo_urls = Column(ARRAY(Text))
    created_at = Column(DateTime, nullable=False, server_default=func.current_timestamp())
    updated_at = Column(DateTime, nullable=False, server_default=func.current_timestamp())

    activity = relationship("PlanActivity", back_populates="daily_actuals")


# ============================================================================
# PLANT AMR — monthly progress (package-keyed; generated variance_pct)
# ============================================================================
class PlantProgressMonthly(Base):
    __tablename__ = "plant_progress_monthly"

    progress_id = Column(Integer, primary_key=True, autoincrement=True)
    package_id = Column(Integer, ForeignKey("packages.package_id", ondelete="CASCADE"), nullable=False)
    month_date = Column(Date, nullable=False)
    planned_progress_pct = Column(Numeric(6, 2), nullable=False, default=0)
    actual_progress_pct = Column(Numeric(6, 2), nullable=False, default=0)
    cumulative_planned_pct = Column(Numeric(6, 2), default=0)
    cumulative_actual_pct = Column(Numeric(6, 2), default=0)
    # STORED GENERATED — read-only, never insert/update:
    variance_pct = Column(
        Numeric(6, 2),
        Computed("(actual_progress_pct - planned_progress_pct)", persisted=True),
    )
    risk_level = Column(String(10), nullable=False, default="unknown")  # enum risk_level_enum
    notes = Column(Text)
    computed_at = Column(DateTime, nullable=False, server_default=func.current_timestamp())

    __table_args__ = (UniqueConstraint("package_id", "month_date"),)


# ============================================================================
# BACKWARD-COMPAT ALIASES
# ----------------------------------------------------------------------------
# The legacy routers (s_curve.py, reports.py) import these old names. They are
# aliased to the closest t5 model so IMPORTS DO NOT BREAK before those routers
# are rewritten in Chunk 2. The column names differ, so the routers MUST be
# updated; these aliases only prevent an ImportError at load time.
#
#   CorporatePlanHeader   -> ProgressPlan
#   CorporatePlanActivity -> PlanActivity
#   CorporatePlanMonthly  -> MonthlyPlanEntry
#   CorporateActualDaily  -> DailyActual
#
# DO NOT write new code against these aliases.
# ============================================================================
CorporatePlanHeader = ProgressPlan
CorporatePlanActivity = PlanActivity
CorporatePlanMonthly = MonthlyPlanEntry
CorporateActualDaily = DailyActual
