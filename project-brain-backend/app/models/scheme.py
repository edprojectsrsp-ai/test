"""
SQLAlchemy models for Project Brain — GOD MODE v2
Matches the schema in godmode_v2_schema.sql exactly.

Place this file at: project-brain-backend/app/models/scheme.py
(Replaces the old scheme.py)
"""

from sqlalchemy import (
    Column, Integer, String, Text, Numeric, Date, DateTime, Boolean,
    ForeignKey, ARRAY, UniqueConstraint, CheckConstraint, Index
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.core.database import Base


# ============================================================================
# 1. USERS & PERMISSIONS
# ============================================================================
# Defined in app/models/user.py in this repo (avoid duplicate table definitions).


# ============================================================================
# 2. MASTERS
# ============================================================================
class UomMaster(Base):
    __tablename__ = "uom_master"

    uom_id = Column(Integer, primary_key=True, autoincrement=True)
    uom_name = Column(String(50), unique=True, nullable=False)
    description = Column(String(200))
    is_active = Column(Boolean, default=True)


class ActivityMasterGlobal(Base):
    __tablename__ = "activity_master_global"

    activity_id = Column(Integer, primary_key=True, autoincrement=True)
    activity_name = Column(String(255), unique=True, nullable=False)
    default_uom_id = Column(Integer, ForeignKey("uom_master.uom_id"))
    default_weightage = Column(Numeric(5, 2), default=10.00)
    is_active = Column(Boolean, default=True)


class CustomFieldDefinition(Base):
    __tablename__ = "custom_field_definitions"

    custom_field_id = Column(Integer, primary_key=True, autoincrement=True)
    section_name = Column(String(100), nullable=False)
    field_key = Column(String(100), nullable=False)
    field_label = Column(String(200), nullable=False)
    field_type = Column(String(20), nullable=False)
    field_options = Column(JSONB)
    usage_count = Column(Integer, default=0)
    promoted_to_column = Column(Boolean, default=False)
    created_by = Column(Integer, ForeignKey("users.user_id"))
    created_at = Column(DateTime, server_default=func.current_timestamp())

    __table_args__ = (UniqueConstraint("section_name", "field_key"),)


# ============================================================================
# 3. SCHEME MASTER (the registry)
# ============================================================================
class Scheme(Base):
    """The main scheme registry. Lean — lifecycle data lives in child tables."""
    __tablename__ = "scheme_master"

    scheme_id = Column(Integer, primary_key=True, autoincrement=True)
    scheme_name = Column(String(500), nullable=False)
    scheme_type = Column(String(20), nullable=False)
    current_status = Column(String(30), nullable=False, default="under_formulation")

    wbs_element = Column(String(100))
    ipm_fa_code = Column(String(100))
    amr_no = Column(String(100))

    estimated_cost_cr = Column(Numeric(15, 4))
    sanctioned_cost_cr = Column(Numeric(15, 4))
    anticipated_cost_cr = Column(Numeric(15, 4))

    scheme_owner_name = Column(String(200))
    scheme_owner_designation = Column(String(200))
    steering_committee_chair = Column(String(200))
    finance_controller = Column(String(200))

    has_multiple_packages = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    is_deleted = Column(Boolean, default=False)

    extra_fields = Column(JSONB, default=dict)
    created_by = Column(Integer, ForeignKey("users.user_id"))
    created_at = Column(DateTime, server_default=func.current_timestamp())
    updated_by = Column(Integer, ForeignKey("users.user_id"))
    updated_at = Column(DateTime, server_default=func.current_timestamp())

    # Relationships
    packages = relationship("Package", back_populates="scheme", cascade="all, delete-orphan")
    formulations = relationship("SchemeFormulation", back_populates="scheme", cascade="all, delete-orphan")
    stage1_approvals = relationship("Stage1Approval", back_populates="scheme", cascade="all, delete-orphan")
    stage2_approvals = relationship("Stage2Approval", back_populates="scheme", cascade="all, delete-orphan")
    monitoring_logs = relationship("MonitoringLog", back_populates="scheme", cascade="all, delete-orphan")


# ============================================================================
# 4. FORMULATION HISTORY
# ============================================================================
class SchemeFormulation(Base):
    __tablename__ = "scheme_formulation"

    formulation_id = Column(Integer, primary_key=True, autoincrement=True)
    scheme_id = Column(Integer, ForeignKey("scheme_master.scheme_id", ondelete="CASCADE"), nullable=False)

    revision_no = Column(Integer, nullable=False, default=0)
    revision_label = Column(String(100))
    revision_reason = Column(Text)
    is_current = Column(Boolean, default=True)

    consultant_name = Column(String(300))
    consultant_acceptance_date = Column(Date)

    draft_fr_ts_date = Column(Date)
    final_fr_ts_ce_ec_date = Column(Date)

    pre_nit_meeting_date = Column(Date)
    pre_nit_participants = Column(Text)

    plant_pag_meeting_date = Column(Date)
    dic_approval_date = Column(Date)
    forwarded_to_corporate_date = Column(Date)

    cost_gross_cr = Column(Numeric(15, 4))
    cost_net_itc_cr = Column(Numeric(15, 4))

    remarks = Column(Text)
    extra_fields = Column(JSONB, default=dict)

    created_by = Column(Integer, ForeignKey("users.user_id"))
    created_at = Column(DateTime, server_default=func.current_timestamp())
    updated_by = Column(Integer, ForeignKey("users.user_id"))
    updated_at = Column(DateTime, server_default=func.current_timestamp())

    scheme = relationship("Scheme", back_populates="formulations")

    __table_args__ = (UniqueConstraint("scheme_id", "revision_no"),)


# ============================================================================
# 5. STAGE-I APPROVALS
# ============================================================================
class Stage1Approval(Base):
    __tablename__ = "stage1_approvals"

    stage1_id = Column(Integer, primary_key=True, autoincrement=True)
    scheme_id = Column(Integer, ForeignKey("scheme_master.scheme_id", ondelete="CASCADE"), nullable=False)

    revision_no = Column(Integer, nullable=False, default=0)
    revision_label = Column(String(100))
    revision_reason = Column(Text)
    is_current = Column(Boolean, default=True)

    cod_date = Column(Date)
    independent_financial_appraisal_date = Column(Date)
    corporate_pag_date = Column(Date)
    chairman_approval_date = Column(Date)
    pcsb_date = Column(Date)
    sail_board_date = Column(Date)

    sanction_date = Column(Date)
    order_date = Column(Date)
    cost_gross_cr = Column(Numeric(15, 4))
    cost_net_itc_cr = Column(Numeric(15, 4))
    implementation_period_months = Column(Integer)

    remarks = Column(Text)
    extra_fields = Column(JSONB, default=dict)

    created_by = Column(Integer, ForeignKey("users.user_id"))
    created_at = Column(DateTime, server_default=func.current_timestamp())
    updated_by = Column(Integer, ForeignKey("users.user_id"))
    updated_at = Column(DateTime, server_default=func.current_timestamp())

    scheme = relationship("Scheme", back_populates="stage1_approvals")

    __table_args__ = (UniqueConstraint("scheme_id", "revision_no"),)


# ============================================================================
# 6. STAGE-II APPROVALS
# ============================================================================
class Stage2Approval(Base):
    __tablename__ = "stage2_approvals"

    stage2_id = Column(Integer, primary_key=True, autoincrement=True)
    scheme_id = Column(Integer, ForeignKey("scheme_master.scheme_id", ondelete="CASCADE"), nullable=False)

    revision_no = Column(Integer, nullable=False, default=0)
    revision_label = Column(String(100))
    revision_reason = Column(Text)
    is_current = Column(Boolean, default=True)

    draft_board_note_date = Column(Date)
    proposal_to_co_date = Column(Date)
    firmed_up_cost_net_itc_cr = Column(Numeric(15, 4))
    firmed_up_cost_gross_cr = Column(Numeric(15, 4))
    consultant_estimate_cr = Column(Numeric(15, 4))
    variance_vs_stage1_pct = Column(Numeric(8, 2))
    variance_vs_consultant_pct = Column(Numeric(8, 2))

    cod_date = Column(Date)
    pag_date = Column(Date)
    chairman_approval_date = Column(Date)
    pcsb_date = Column(Date)
    sail_board_date = Column(Date)
    empowered_committee_date = Column(Date)

    sanction_date = Column(Date)
    order_date = Column(Date)

    remarks = Column(Text)
    extra_fields = Column(JSONB, default=dict)

    created_by = Column(Integer, ForeignKey("users.user_id"))
    created_at = Column(DateTime, server_default=func.current_timestamp())
    updated_by = Column(Integer, ForeignKey("users.user_id"))
    updated_at = Column(DateTime, server_default=func.current_timestamp())

    scheme = relationship("Scheme", back_populates="stage2_approvals")

    __table_args__ = (UniqueConstraint("scheme_id", "revision_no"),)


# ============================================================================
# 7. PACKAGES
# ============================================================================
class Package(Base):
    __tablename__ = "packages"

    package_id = Column(Integer, primary_key=True, autoincrement=True)
    scheme_id = Column(Integer, ForeignKey("scheme_master.scheme_id", ondelete="CASCADE"), nullable=False)

    package_no = Column(Integer, nullable=False)
    package_name = Column(String(500), nullable=False)
    package_scope = Column(Text)
    package_type = Column(String(50))
    package_status = Column(String(30), nullable=False, default="planned")

    package_estimate_cr = Column(Numeric(15, 4))
    package_value_cr = Column(Numeric(15, 4))

    linked_stage1_id = Column(Integer, ForeignKey("stage1_approvals.stage1_id"))
    linked_stage2_id = Column(Integer, ForeignKey("stage2_approvals.stage2_id"))

    project_manager_name = Column(String(200))
    project_manager_email = Column(String(200))
    project_manager_phone = Column(String(50))
    executing_agency = Column(String(300))
    consultant_name = Column(String(300))
    consultant_pmc = Column(String(300))
    section_in_charge = Column(String(200))
    safety_officer = Column(String(200))
    quality_officer = Column(String(200))
    site_location = Column(String(300))
    start_date_actual = Column(Date)

    is_scheme_mirror = Column(Boolean, default=False)
    is_deleted = Column(Boolean, default=False)

    remarks = Column(Text)
    extra_fields = Column(JSONB, default=dict)

    created_by = Column(Integer, ForeignKey("users.user_id"))
    created_at = Column(DateTime, server_default=func.current_timestamp())
    updated_by = Column(Integer, ForeignKey("users.user_id"))
    updated_at = Column(DateTime, server_default=func.current_timestamp())

    scheme = relationship("Scheme", back_populates="packages")
    tender_cycles = relationship("TenderCycle", back_populates="package", cascade="all, delete-orphan")
    contract = relationship("Contract", back_populates="package", uselist=False, cascade="all, delete-orphan")
    completion = relationship("CompletionDetail", back_populates="package", uselist=False, cascade="all, delete-orphan")

    __table_args__ = (UniqueConstraint("scheme_id", "package_no"),)


# ============================================================================
# 8. TENDER CYCLES & RELATED
# ============================================================================
class TenderCycle(Base):
    __tablename__ = "tender_cycles"

    tender_cycle_id = Column(Integer, primary_key=True, autoincrement=True)
    package_id = Column(Integer, ForeignKey("packages.package_id", ondelete="CASCADE"), nullable=False)

    cycle_no = Column(Integer, nullable=False)
    cycle_label = Column(String(100))
    cycle_status = Column(String(30), nullable=False, default="active")
    is_current = Column(Boolean, default=True)

    pr_initiation_date = Column(Date)
    pr_approval_date = Column(Date)
    mode_of_tender = Column(String(50))
    nit_number = Column(String(100))
    nit_date = Column(Date)

    pre_bid_date = Column(Date)
    pre_bid_participants = Column(Text)

    tod_original_date = Column(Date)

    offers_received_count = Column(Integer)
    bidder_names = Column(ARRAY(Text))

    cancellation_reason = Column(Text)
    cancellation_date = Column(Date)

    remarks = Column(Text)
    extra_fields = Column(JSONB, default=dict)

    created_by = Column(Integer, ForeignKey("users.user_id"))
    created_at = Column(DateTime, server_default=func.current_timestamp())
    updated_by = Column(Integer, ForeignKey("users.user_id"))
    updated_at = Column(DateTime, server_default=func.current_timestamp())

    package = relationship("Package", back_populates="tender_cycles")
    tod_extensions = relationship("TodExtension", back_populates="tender_cycle", cascade="all, delete-orphan")
    bid_evaluation = relationship("BidEvaluation", back_populates="tender_cycle", uselist=False, cascade="all, delete-orphan")
    price_evaluation = relationship("PriceEvaluation", back_populates="tender_cycle", uselist=False, cascade="all, delete-orphan")
    negotiation_rounds = relationship("NegotiationRound", back_populates="tender_cycle", cascade="all, delete-orphan")

    __table_args__ = (UniqueConstraint("package_id", "cycle_no"),)


class TodExtension(Base):
    __tablename__ = "tod_extensions"

    extension_id = Column(Integer, primary_key=True, autoincrement=True)
    tender_cycle_id = Column(Integer, ForeignKey("tender_cycles.tender_cycle_id", ondelete="CASCADE"), nullable=False)
    extension_no = Column(Integer, nullable=False)
    extended_to_date = Column(Date, nullable=False)
    extension_letter_no = Column(String(100))
    approved_by_date = Column(Date)
    reason = Column(Text)
    extra_fields = Column(JSONB, default=dict)
    created_by = Column(Integer, ForeignKey("users.user_id"))
    created_at = Column(DateTime, server_default=func.current_timestamp())

    tender_cycle = relationship("TenderCycle", back_populates="tod_extensions")

    __table_args__ = (UniqueConstraint("tender_cycle_id", "extension_no"),)


class BidEvaluation(Base):
    __tablename__ = "bid_evaluations"

    bid_evaluation_id = Column(Integer, primary_key=True, autoincrement=True)
    tender_cycle_id = Column(Integer, ForeignKey("tender_cycles.tender_cycle_id", ondelete="CASCADE"), unique=True, nullable=False)

    forwarded_to_consultant_date = Column(Date)
    ter_date = Column(Date)
    tec_report_date = Column(Date)
    technically_eligible_parties = Column(ARRAY(Text))
    technically_ineligible_parties = Column(ARRAY(Text))
    cec_report_date = Column(Date)
    commercially_eligible_parties = Column(ARRAY(Text))
    commercially_ineligible_parties = Column(ARRAY(Text))
    tc_recommendation_date = Column(Date)
    tc_approval_date = Column(Date)
    techno_commercial_eligible = Column(ARRAY(Text))
    techno_commercial_ineligible = Column(ARRAY(Text))

    remarks = Column(Text)
    extra_fields = Column(JSONB, default=dict)
    created_by = Column(Integer, ForeignKey("users.user_id"))
    created_at = Column(DateTime, server_default=func.current_timestamp())
    updated_by = Column(Integer, ForeignKey("users.user_id"))
    updated_at = Column(DateTime, server_default=func.current_timestamp())

    tender_cycle = relationship("TenderCycle", back_populates="bid_evaluation")


class PriceEvaluation(Base):
    __tablename__ = "price_evaluations"

    price_evaluation_id = Column(Integer, primary_key=True, autoincrement=True)
    tender_cycle_id = Column(Integer, ForeignKey("tender_cycles.tender_cycle_id", ondelete="CASCADE"), unique=True, nullable=False)

    mode_of_price_discovery = Column(String(50))
    differential_price_letter_date = Column(Date)
    ra_opening_date = Column(Date)
    ra_report_submission_date = Column(Date)
    l1_party_name = Column(String(300))
    l1_cost_net_itc_cr = Column(Numeric(15, 4))
    consultant_estimate_cr = Column(Numeric(15, 4))
    forwarded_to_consultant_date = Column(Date)
    price_eval_report_date = Column(Date)
    variance_vs_estimate_pct = Column(Numeric(8, 2))
    tc_recommendation_date = Column(Date)
    tc_approval_date = Column(Date)

    remarks = Column(Text)
    extra_fields = Column(JSONB, default=dict)
    created_by = Column(Integer, ForeignKey("users.user_id"))
    created_at = Column(DateTime, server_default=func.current_timestamp())
    updated_by = Column(Integer, ForeignKey("users.user_id"))
    updated_at = Column(DateTime, server_default=func.current_timestamp())

    tender_cycle = relationship("TenderCycle", back_populates="price_evaluation")


class NegotiationRound(Base):
    __tablename__ = "negotiation_rounds"

    negotiation_id = Column(Integer, primary_key=True, autoincrement=True)
    tender_cycle_id = Column(Integer, ForeignKey("tender_cycles.tender_cycle_id", ondelete="CASCADE"), nullable=False)

    round_no = Column(Integer, nullable=False)
    negotiation_date = Column(Date, nullable=False)
    discounted_price_net_itc_cr = Column(Numeric(15, 4))
    forwarded_to_consultant_date = Column(Date)
    price_eval_report_date = Column(Date)
    variance_vs_estimate_pct = Column(Numeric(8, 2))
    tc_recommendation_date = Column(Date)
    tc_approval_date = Column(Date)
    is_final_round = Column(Boolean, default=False)

    remarks = Column(Text)
    extra_fields = Column(JSONB, default=dict)
    created_by = Column(Integer, ForeignKey("users.user_id"))
    created_at = Column(DateTime, server_default=func.current_timestamp())
    updated_by = Column(Integer, ForeignKey("users.user_id"))
    updated_at = Column(DateTime, server_default=func.current_timestamp())

    tender_cycle = relationship("TenderCycle", back_populates="negotiation_rounds")

    __table_args__ = (UniqueConstraint("tender_cycle_id", "round_no"),)


# ============================================================================
# 9. CONTRACTS
# ============================================================================
class Contract(Base):
    __tablename__ = "contracts"

    contract_id = Column(Integer, primary_key=True, autoincrement=True)
    package_id = Column(Integer, ForeignKey("packages.package_id", ondelete="CASCADE"), unique=True, nullable=False)
    awarded_tender_cycle_id = Column(Integer, ForeignKey("tender_cycles.tender_cycle_id"))

    loa_date = Column(Date)
    contractor_name = Column(String(300))
    contract_no = Column(String(200))
    contract_signing_date = Column(Date)
    effective_date = Column(Date)
    scheduled_completion_date = Column(Date)
    contract_cost_net_itc_cr = Column(Numeric(15, 4))
    contract_cost_gross_cr = Column(Numeric(15, 4))
    likely_completion_date = Column(Date)
    delay_reason = Column(Text)

    remarks = Column(Text)
    extra_fields = Column(JSONB, default=dict)
    created_by = Column(Integer, ForeignKey("users.user_id"))
    created_at = Column(DateTime, server_default=func.current_timestamp())
    updated_by = Column(Integer, ForeignKey("users.user_id"))
    updated_at = Column(DateTime, server_default=func.current_timestamp())

    package = relationship("Package", back_populates="contract")
    amendments = relationship("ContractAmendment", back_populates="contract", cascade="all, delete-orphan")


class ContractAmendment(Base):
    __tablename__ = "contract_amendments"

    amendment_id = Column(Integer, primary_key=True, autoincrement=True)
    contract_id = Column(Integer, ForeignKey("contracts.contract_id", ondelete="CASCADE"), nullable=False)
    amendment_no = Column(Integer, nullable=False)
    amendment_date = Column(Date, nullable=False)
    description = Column(Text)
    cost_change_cr = Column(Numeric(15, 4))
    new_cost_net_itc_cr = Column(Numeric(15, 4))
    new_completion_date = Column(Date)
    approval_ref = Column(String(200))

    extra_fields = Column(JSONB, default=dict)
    created_by = Column(Integer, ForeignKey("users.user_id"))
    created_at = Column(DateTime, server_default=func.current_timestamp())

    contract = relationship("Contract", back_populates="amendments")

    __table_args__ = (UniqueConstraint("contract_id", "amendment_no"),)


# ============================================================================
# 10. COMPLETION
# ============================================================================
class CompletionDetail(Base):
    __tablename__ = "completion_details"

    completion_id = Column(Integer, primary_key=True, autoincrement=True)
    package_id = Column(Integer, ForeignKey("packages.package_id", ondelete="CASCADE"), unique=True, nullable=False)

    pac_date = Column(Date)
    commissioning_date = Column(Date)
    delay_analysis_approval_date = Column(Date)
    contract_amendment_issue_date = Column(Date)
    pg_date = Column(Date)
    fac_date = Column(Date)
    fac_payment_date = Column(Date)
    closure_date = Column(Date)

    remarks = Column(Text)
    extra_fields = Column(JSONB, default=dict)
    created_by = Column(Integer, ForeignKey("users.user_id"))
    created_at = Column(DateTime, server_default=func.current_timestamp())
    updated_by = Column(Integer, ForeignKey("users.user_id"))
    updated_at = Column(DateTime, server_default=func.current_timestamp())

    package = relationship("Package", back_populates="completion")


# ============================================================================
# 11. MONITORING LOG
# ============================================================================
class MonitoringLog(Base):
    __tablename__ = "monitoring_log"

    log_id = Column(Integer, primary_key=True, autoincrement=True)
    scheme_id = Column(Integer, ForeignKey("scheme_master.scheme_id", ondelete="CASCADE"), nullable=False)
    package_id = Column(Integer, ForeignKey("packages.package_id", ondelete="CASCADE"))

    log_date = Column(Date, server_default=func.current_date(), nullable=False)
    reason_for_delay = Column(Text)
    issues = Column(Text)
    action_taken = Column(Text)
    progress_status = Column(Text)

    extra_fields = Column(JSONB, default=dict)
    created_by = Column(Integer, ForeignKey("users.user_id"))
    created_at = Column(DateTime, server_default=func.current_timestamp())

    scheme = relationship("Scheme", back_populates="monitoring_logs")


# Backward-compat alias used by legacy API modules
SchemeMaster = Scheme
