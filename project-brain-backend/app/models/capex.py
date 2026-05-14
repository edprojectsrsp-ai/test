from sqlalchemy import Column, Integer, String, Float, Boolean, ForeignKey, DateTime
from sqlalchemy.orm import relationship
from datetime import datetime
from app.core.database import Base

class CapexPlanHeader(Base):
    __tablename__ = "capex_plan_header"

    id = Column(Integer, primary_key=True, index=True)
    fy_year = Column(String, index=True)
    plan_version = Column(String)
    plan_type = Column(String) # BE / RE
    plan_status = Column(String, default="Draft") # Draft / Approved / Locked / Effective
    is_effective = Column(Boolean, default=False)
    effective_from_month = Column(Integer, nullable=True) # e.g., 10 for October
    created_by = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)

    rows = relationship("CapexPlanRow", back_populates="plan", cascade="all, delete")

class CapexPlanRow(Base):
    __tablename__ = "capex_plan_rows"

    id = Column(Integer, primary_key=True, index=True)
    plan_id = Column(Integer, ForeignKey("capex_plan_header.id"))
    parent_row_id = Column(Integer, ForeignKey("capex_plan_rows.id"), nullable=True)
    scheme_id = Column(Integer, nullable=True) # Links to scheme_master
    row_name = Column(String)
    row_level = Column(String) # Header / SubHeader / Item
    indent_level = Column(Integer, default=0) # 0, 1, 2
    display_order = Column(Integer, default=0)
    is_imported = Column(Boolean, default=False)
    is_collapsed = Column(Boolean, default=False)

    plan = relationship("CapexPlanHeader", back_populates="rows")
    values = relationship("CapexPlanValue", back_populates="row", uselist=False, cascade="all, delete")
    months = relationship("CapexMonthValue", back_populates="row", cascade="all, delete")

class CapexPlanValue(Base):
    __tablename__ = "capex_plan_values"

    id = Column(Integer, primary_key=True, index=True)
    plan_row_id = Column(Integer, ForeignKey("capex_plan_rows.id"))
    gross_cost = Column(Float, default=0.0)
    cumulative_exp_till_last_fy = Column(Float, default=0.0)
    be_fy = Column(Float, default=0.0)
    re_fy = Column(Float, default=0.0)

    row = relationship("CapexPlanRow", back_populates="values")

class CapexMonthValue(Base):
    __tablename__ = "capex_month_values"

    id = Column(Integer, primary_key=True, index=True)
    plan_row_id = Column(Integer, ForeignKey("capex_plan_rows.id"))
    month_no = Column(Integer) # 4 to 12, 1 to 3
    be_amount = Column(Float, default=0.0)
    re_amount = Column(Float, default=0.0)
    actual_amount = Column(Float, default=0.0)

    row = relationship("CapexPlanRow", back_populates="months")
