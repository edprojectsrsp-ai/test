"""SQLAlchemy models for the CAPEX feature.

Sprint 15.5 changes:
  * Added effective_from_month to CapexPlanHeader (for RE plans).
  * Added CapexActual — actuals are now stored independently from
    capex_month_values.actual_amount (the column stays for back-compat
    but Sprint 15.5+ writes/reads go through CapexActual).
  * Added ActualsMonthLock — admin-managed monthly lock for actuals.
"""
from sqlalchemy import (
    Column, DateTime, ForeignKey, Integer, Numeric, String, Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base


class CapexPlanHeader(Base):
    __tablename__ = "capex_plan_header"

    id = Column(Integer, primary_key=True, index=True)
    fy_year = Column(String(20), nullable=False)
    plan_type = Column(String(10), nullable=False, default="BE")  # 'BE' | 'RE'
    plan_version = Column(String(50))
    plan_status = Column(String(20), default="Draft")
    is_effective = Column(Integer, default=0)
    effective_from_month = Column(Integer, nullable=True)   # 1..12; 4 = Apr
    created_by = Column(String(100))
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    rows = relationship(
        "CapexPlanRow", back_populates="header",
        cascade="all, delete", passive_deletes=True,
    )


class CapexPlanRow(Base):
    __tablename__ = "capex_plan_rows"

    id = Column(Integer, primary_key=True, index=True)
    plan_id = Column(Integer, ForeignKey("capex_plan_header.id", ondelete="CASCADE"))
    parent_row_id = Column(Integer, ForeignKey("capex_plan_rows.id"), nullable=True)
    scheme_id = Column(Integer, nullable=True)
    row_name = Column(String(500), nullable=False)
    row_level = Column(String(20), nullable=False)   # Header | SubHeader | Item
    indent_level = Column(Integer, default=0)
    display_order = Column(Integer, default=0)
    is_imported = Column(Integer, default=0)

    header = relationship("CapexPlanHeader", back_populates="rows")
    values = relationship(
        "CapexPlanValue", uselist=False, back_populates="row",
        cascade="all, delete", passive_deletes=True,
    )
    months = relationship(
        "CapexMonthValue", back_populates="row",
        cascade="all, delete", passive_deletes=True,
    )
    actuals = relationship(
        "CapexActual", back_populates="row",
        cascade="all, delete", passive_deletes=True,
    )


class CapexPlanValue(Base):
    __tablename__ = "capex_plan_values"

    id = Column(Integer, primary_key=True, index=True)
    plan_row_id = Column(Integer, ForeignKey("capex_plan_rows.id", ondelete="CASCADE"))
    gross_cost = Column(Numeric(15, 4), default=0)
    cumulative_exp_till_last_fy = Column(Numeric(15, 4), default=0)
    be_fy = Column(Numeric(15, 4), default=0)
    re_fy = Column(Numeric(15, 4), default=0)

    row = relationship("CapexPlanRow", back_populates="values")


class CapexMonthValue(Base):
    """Per-month BE/RE/Actual amounts attached to a plan row.

    NOTE: As of Sprint 15.5 actual_amount is still written by older code paths,
    but the canonical source of actuals is CapexActual. Treat actual_amount here
    as legacy; readers should prefer CapexActual.
    """
    __tablename__ = "capex_month_values"

    id = Column(Integer, primary_key=True, index=True)
    plan_row_id = Column(Integer, ForeignKey("capex_plan_rows.id", ondelete="CASCADE"))
    month_no = Column(Integer, nullable=False)   # 1..12
    be_amount = Column(Numeric(15, 4), default=0)
    re_amount = Column(Numeric(15, 4), default=0)
    actual_amount = Column(Numeric(15, 4), default=0)   # legacy; see CapexActual

    row = relationship("CapexPlanRow", back_populates="months")


# ---------------------------------------------------------------------------
# Sprint 15.5 — independent actuals + month-lock
# ---------------------------------------------------------------------------
class CapexActual(Base):
    """One row per (plan_row_id, month_no). Independent of plan versioning."""
    __tablename__ = "capex_actuals"
    __table_args__ = (UniqueConstraint("plan_row_id", "month_no", name="capex_actuals_unique"),)

    id = Column(Integer, primary_key=True, index=True)
    plan_row_id = Column(Integer, ForeignKey("capex_plan_rows.id", ondelete="CASCADE"))
    month_no = Column(Integer, nullable=False)        # 1..12
    fy_year = Column(String(20), nullable=False)      # denormalized for filtering
    amount = Column(Numeric(15, 4), default=0)
    created_by = Column(String(100))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_by = Column(String(100))
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    row = relationship("CapexPlanRow", back_populates="actuals")


class ActualsMonthLock(Base):
    """Admin-managed lock — (fy_year, month_no) unique."""
    __tablename__ = "actuals_month_lock"
    __table_args__ = (UniqueConstraint("fy_year", "month_no", name="actuals_month_lock_unique"),)

    id = Column(Integer, primary_key=True, index=True)
    fy_year = Column(String(20), nullable=False)
    month_no = Column(Integer, nullable=False)
    locked_by = Column(String(100))
    locked_at = Column(DateTime(timezone=True), server_default=func.now())
    note = Column(Text)
