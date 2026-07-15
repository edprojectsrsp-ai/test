"""
Project Brain — Schemes API Router (GOD MODE v2.1)
Sprint 1: Vault upgrade

Place at: project-brain-backend/app/api/v1/schemes.py
"""

from datetime import date, datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import text, func
from app.core.database import get_db
from app.models.scheme import (
    Scheme, Package, Contract, ContractAmendment,
    SchemeFormulation, Stage1Approval, Stage2Approval,
    TenderCycle, TodExtension, BidEvaluation, PriceEvaluation,
    NegotiationRound, CompletionDetail, MonitoringLog
)

router = APIRouter()


# ============================================================================
# Helper utilities
# ============================================================================
def _date(d):
    """Date → ISO string (or None)."""
    return d.isoformat() if d else None


def _num(n):
    """Decimal → float (or None)."""
    return float(n) if n is not None else None


def _safe_dict(obj, fields):
    """Pick fields from SQLAlchemy obj into a JSON-friendly dict."""
    out = {}
    for f in fields:
        v = getattr(obj, f, None)
        if hasattr(v, 'isoformat'):
            v = v.isoformat()
        elif hasattr(v, '__float__'):
            v = float(v)
        out[f] = v
    return out


def _table_exists(db: Session, table_name: str) -> bool:
    """True if a relation exists (table or view) in public schema."""
    return bool(
        db.execute(text("SELECT to_regclass(:t) IS NOT NULL"), {"t": f"public.{table_name}"}).scalar()
    )


def _coerce_value(v):
    if isinstance(v, str):
        try:
            if len(v) >= 10 and v[4] == "-" and v[7] == "-":
                return date.fromisoformat(v[:10])
        except ValueError:
            return v
    return v


_APPROVAL_STAGE_FIELDS = {
    "formulation": [
        "consultant_name", "consultant_acceptance_date", "draft_fr_ts_date",
        "final_fr_ts_ce_ec_date", "pre_nit_meeting_date", "plant_pag_meeting_date",
        "dic_approval_date", "forwarded_to_corporate_date", "cost_gross_cr",
    ],
    "stage1": [
        "cod_date", "independent_financial_appraisal_date", "corporate_pag_date",
        "chairman_approval_date", "pcsb_date", "sail_board_date", "sanction_date",
        "order_date", "cost_gross_cr", "implementation_period_months",
    ],
    "tendering": [
        "nit_number", "pr_initiation_date", "pr_approval_date", "nit_date",
        "pre_bid_date", "tod_original_date", "offers_received_count",
        "estimated_value_cr", "awarded_value_cr", "cancellation_date",
    ],
    "stage2": [
        "draft_board_note_date", "proposal_to_co_date", "pag_date",
        "chairman_approval_date", "pcsb_date", "sail_board_date",
        "empowered_committee_date", "sanction_date", "order_date", "cod_date",
        "firmed_up_cost_gross_cr", "variance_vs_stage1_pct",
    ],
}


def _serialize_stage_rows(rows, id_field: str, revision_field: str, label_field: str, fields: list[str]):
    out = []
    for row in rows:
        out.append({
            "id": getattr(row, id_field),
            "revision_no": getattr(row, revision_field, 0) or 0,
            "revision_label": getattr(row, label_field, None) or f"R{getattr(row, revision_field, 0) or 0}",
            "is_current": bool(getattr(row, "is_current", False)),
            "fields": {field: _coerce_value(getattr(row, field, None)) for field in fields if getattr(row, field, None) is not None},
            "remarks": getattr(row, "remarks", "") or "",
        })
    return out


class ApprovalRevisionIn(BaseModel):
    fields: dict = {}
    remarks: str = ""
    revision_label: str | None = None


class StageChangeIn(BaseModel):
    new_status: str
    remark: str = ""


# ============================================================================
# 1) GET /all  → list view (unchanged)
# ============================================================================
@router.get("/all")
def get_all_schemes(db: Session = Depends(get_db)):
    try:
        sql = text("""
            SELECT
                sm.scheme_id, sm.scheme_name, sm.scheme_type, sm.current_status,
                sm.estimated_cost_cr, sm.sanctioned_cost_cr, sm.anticipated_cost_cr,
                sm.amr_no, sm.wbs_element, sm.has_multiple_packages,
                sm.scheme_owner_name, sm.created_at,
                COUNT(DISTINCT p.package_id) AS package_count,
                COALESCE(SUM(c.contract_value_cr), 0) AS total_contract_value_cr,
                MIN(c.effective_date) AS earliest_effective_date,
                MAX(c.schedule_completion_date) AS latest_scheduled_completion,
                NULL::date AS latest_likely_completion
            FROM public.scheme_master sm
            LEFT JOIN public.packages p
              ON p.scheme_id = sm.scheme_id AND p.is_deleted = FALSE
            LEFT JOIN public.contracts c
              ON c.package_id = p.package_id AND c.is_deleted = FALSE
            WHERE sm.is_deleted = FALSE
            GROUP BY
                sm.scheme_id, sm.scheme_name, sm.scheme_type, sm.current_status,
                sm.estimated_cost_cr, sm.sanctioned_cost_cr, sm.anticipated_cost_cr,
                sm.amr_no, sm.wbs_element, sm.has_multiple_packages,
                sm.scheme_owner_name, sm.created_at
            ORDER BY
                CASE sm.current_status
                    WHEN 'ongoing' THEN 1 WHEN 'under_stage2' THEN 2
                    WHEN 'under_tendering' THEN 3 WHEN 'under_stage1' THEN 4
                    WHEN 'under_formulation' THEN 5 WHEN 'on_hold' THEN 6
                    WHEN 'closed' THEN 7 WHEN 'dropped' THEN 8 ELSE 9
                END, sm.scheme_id DESC
        """)
        results = db.execute(sql).fetchall()

        out = []
        for r in results:
            delay_status, delay_days = "N/A", 0
            if r.latest_scheduled_completion and r.latest_likely_completion:
                delta = (r.latest_likely_completion - r.latest_scheduled_completion).days
                delay_status = "On Time" if delta <= 0 else ("Delayed < 1 Year" if delta < 365 else "Delayed > 1 Year")
                delay_days = delta

            out.append({
                "id": r.scheme_id,
                "scheme_id": r.scheme_id,
                "scheme_name": r.scheme_name,
                "scheme_type": r.scheme_type or "Unknown",
                "status": r.current_status or "Unknown",
                "current_status": r.current_status or "Unknown",
                "estimated_cost": _num(r.estimated_cost_cr) or 0.0,
                "estimated_cost_cr": _num(r.estimated_cost_cr) or 0.0,
                "sanctioned_cost_cr": _num(r.sanctioned_cost_cr) or 0.0,
                "anticipated_cost_cr": _num(r.anticipated_cost_cr) or 0.0,
                "amr_no": r.amr_no or "",
                "wbs_element": r.wbs_element or "",
                "has_multiple_packages": r.has_multiple_packages or False,
                "scheme_owner_name": r.scheme_owner_name or "",
                "package_count": r.package_count or 0,
                "total_contract_value_cr": _num(r.total_contract_value_cr) or 0.0,
                "scheduled_completion": r.latest_scheduled_completion.strftime("%d %b %Y") if r.latest_scheduled_completion else "TBD",
                "expected_completion": r.latest_likely_completion.strftime("%d %b %Y") if r.latest_likely_completion else (
                    r.latest_scheduled_completion.strftime("%d %b %Y") if r.latest_scheduled_completion else "TBD"
                ),
                "effective_date": r.earliest_effective_date.strftime("%d %b %Y") if r.earliest_effective_date else "TBD",
                "delay_status": delay_status,
                "delay_days": delay_days,
            })

        return out
    except Exception as e:
        import traceback; traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to fetch schemes: {e}")


# ============================================================================
# 2) GET /{scheme_id}/full  → SPRINT 1 STAR  ⭐
#    Returns the COMPLETE Vault payload — 8 sections in one call
# ============================================================================
@router.get("/{scheme_id}/full")
def get_scheme_full(scheme_id: int, db: Session = Depends(get_db)):
    """
    Returns everything the Vault page needs:
    1) core (scheme_master)
    2) formulation (current revision)
    3) stage1 (current revision)
    4) stage2 (current revision)
    5) packages (list with mirror flag)
    6) tendering (per-package tender cycles)
    7) contracts (per-package)
    8) completion (per-package)
    9) monitoring (log entries)
    """
    scheme = db.query(Scheme).filter(
        Scheme.scheme_id == scheme_id,
        Scheme.is_deleted == False
    ).first()
    if not scheme:
        raise HTTPException(status_code=404, detail="Scheme not found")

    # --- 1. CORE ---
    core = {
        "scheme_id": scheme.scheme_id,
        "scheme_name": scheme.scheme_name,
        "scheme_type": scheme.scheme_type,
        "current_status": scheme.current_status,
        "wbs_element": scheme.wbs_element,
        "ipm_fa_code": scheme.ipm_fa_code,
        "amr_no": scheme.amr_no,
        "estimated_cost_cr": _num(scheme.estimated_cost_cr),
        "sanctioned_cost_cr": _num(scheme.sanctioned_cost_cr),
        "anticipated_cost_cr": _num(scheme.anticipated_cost_cr),
        "scheme_owner_name": scheme.scheme_owner_name,
        "scheme_owner_designation": scheme.scheme_owner_designation,
        "steering_committee_chair": scheme.steering_committee_chair,
        "finance_controller": scheme.finance_controller,
        "has_multiple_packages": scheme.has_multiple_packages or False,
        "extra_fields": scheme.extra_fields or {},
        "created_at": _date(scheme.created_at) if scheme.created_at else None,
    }

    # --- 2. FORMULATION (current) ---
    formulation = db.query(SchemeFormulation).filter(
        SchemeFormulation.scheme_id == scheme_id,
        SchemeFormulation.is_current == True
    ).first()
    formulation_data = {}
    if formulation:
        formulation_data = _safe_dict(formulation, [
            "formulation_id", "revision_no", "revision_label", "revision_reason",
            "consultant_name", "consultant_acceptance_date",
            "draft_fr_ts_date", "final_fr_ts_ce_ec_date",
            "pre_nit_meeting_date", "pre_nit_participants",
            "plant_pag_meeting_date", "dic_approval_date", "forwarded_to_corporate_date",
            "cost_gross_cr", "cost_net_itc_cr", "remarks",
        ])
        formulation_data["extra_fields"] = formulation.extra_fields or {}

    # --- 3. STAGE-I (current) ---
    stage1 = db.query(Stage1Approval).filter(
        Stage1Approval.scheme_id == scheme_id,
        Stage1Approval.is_current == True
    ).first()
    stage1_data = {}
    if stage1:
        stage1_data = _safe_dict(stage1, [
            "stage1_id", "revision_no", "revision_label",
            "cod_date", "independent_financial_appraisal_date",
            "corporate_pag_date", "chairman_approval_date",
            "pcsb_date", "sail_board_date",
            "sanction_date", "order_date",
            "cost_gross_cr", "cost_net_itc_cr", "implementation_period_months",
            "remarks",
        ])
        stage1_data["extra_fields"] = stage1.extra_fields or {}

    # --- 4. STAGE-II (current) ---
    stage2 = db.query(Stage2Approval).filter(
        Stage2Approval.scheme_id == scheme_id,
        Stage2Approval.is_current == True
    ).first()
    stage2_data = {}
    if stage2:
        stage2_data = _safe_dict(stage2, [
            "stage2_id", "revision_no", "revision_label",
            "draft_board_note_date", "proposal_to_co_date",
            "firmed_up_cost_net_itc_cr", "firmed_up_cost_gross_cr",
            "consultant_estimate_cr", "variance_vs_stage1_pct", "variance_vs_consultant_pct",
            "cod_date", "pag_date", "chairman_approval_date",
            "pcsb_date", "sail_board_date", "empowered_committee_date",
            "sanction_date", "order_date", "remarks",
        ])
        stage2_data["extra_fields"] = stage2.extra_fields or {}

    # --- 5. PACKAGES ---
    pkgs = db.query(Package).filter(
        Package.scheme_id == scheme_id,
        Package.is_deleted == False
    ).order_by(Package.package_no).all()

    packages_data = []
    tendering_data = []
    contracts_data = []
    completion_data = []

    has_completion = _table_exists(db, "completion_details")

    for p in pkgs:
        packages_data.append({
            "package_id": p.package_id,
            "package_no": p.package_no,
            "package_name": p.package_name,
            "package_scope": p.package_scope,
            "package_type": p.package_type,
            "package_status": p.package_status,
            "package_estimate_cr": _num(p.package_estimate_cr),
            "package_value_cr": _num(p.package_value_cr),
            "project_manager_name": p.project_manager_name,
            "project_manager_email": p.project_manager_email,
            "project_manager_phone": p.project_manager_phone,
            "executing_agency": p.executing_agency,
            "consultant_name": p.consultant_name,
            "consultant_pmc": p.consultant_pmc,
            "section_in_charge": p.section_in_charge,
            "safety_officer": p.safety_officer,
            "quality_officer": p.quality_officer,
            "site_location": p.site_location,
            "start_date_actual": _date(p.start_date_actual),
            "is_scheme_mirror": p.is_scheme_mirror or False,
            "remarks": p.remarks,
            "extra_fields": p.extra_fields or {},
        })

        # --- 6. TENDERING (cycles + extensions per package) ---
        cycles = db.query(TenderCycle).filter(
            TenderCycle.package_id == p.package_id
        ).order_by(TenderCycle.cycle_no).all()
        for cy in cycles:
            exts = [_safe_dict(e, [
                "extension_id", "extension_no", "extended_to_date",
                "extension_letter_no", "approved_by_date", "reason"
            ]) for e in cy.tod_extensions]

            tendering_data.append({
                "tender_cycle_id": cy.tender_cycle_id,
                "package_id": p.package_id,
                "package_name": p.package_name,
                "cycle_no": cy.cycle_no,
                "cycle_label": cy.cycle_label,
                "cycle_status": cy.cycle_status,
                "is_current": cy.is_current or False,
                "pr_initiation_date": _date(cy.pr_initiation_date),
                "pr_approval_date": _date(cy.pr_approval_date),
                "mode_of_tender": cy.mode_of_tender,
                "nit_number": cy.nit_number,
                "nit_date": _date(cy.nit_date),
                "pre_bid_date": _date(cy.pre_bid_date),
                "tod_original_date": _date(cy.tod_original_date),
                "offers_received_count": cy.offers_received_count,
                "bidder_names": cy.bidder_names or [],
                "cancellation_reason": cy.cancellation_reason,
                "cancellation_date": _date(cy.cancellation_date),
                "remarks": cy.remarks,
                "extra_fields": cy.extra_fields or {},
                "tod_extensions": exts,
            })

        # --- 7. CONTRACT (one per package) ---
        if p.contract:
            c = p.contract
            contracts_data.append({
                "contract_id": c.contract_id,
                "package_id": p.package_id,
                "package_name": p.package_name,
                "loa_date": _date(c.loa_date),
                "contractor_name": c.contractor_name,
                "contract_no": c.contract_no,
                "effective_date": _date(c.effective_date),
                "schedule_completion_date": _date(getattr(c, "schedule_completion_date", None)),
                "contract_value_cr": _num(getattr(c, "contract_value_cr", None)),
                "contract_duration_months": getattr(c, "contract_duration_months", None),
                "is_active": getattr(c, "is_active", True),
                "is_deleted": getattr(c, "is_deleted", False),
                "extra_fields": c.extra_fields or {},
                "amendments": [_safe_dict(a, [
                    "amendment_id", "amendment_no", "amendment_date",
                    "value_change_cr", "new_completion_date", "reason"
                ]) for a in c.amendments],
            })

        # --- 8. COMPLETION (one per package) ---
        if has_completion and p.completion:
            comp = p.completion
            completion_data.append({
                "completion_id": comp.completion_id,
                "package_id": p.package_id,
                "package_name": p.package_name,
                "pac_date": _date(comp.pac_date),
                "commissioning_date": _date(comp.commissioning_date),
                "delay_analysis_approval_date": _date(comp.delay_analysis_approval_date),
                "contract_amendment_issue_date": _date(comp.contract_amendment_issue_date),
                "pg_date": _date(comp.pg_date),
                "fac_date": _date(comp.fac_date),
                "fac_payment_date": _date(comp.fac_payment_date),
                "closure_date": _date(comp.closure_date),
                "remarks": comp.remarks,
                "extra_fields": comp.extra_fields or {},
            })

    # --- 9. MONITORING LOG ---
    try:
        logs = db.query(MonitoringLog).filter(
            MonitoringLog.scheme_id == scheme_id
        ).order_by(MonitoringLog.log_date.desc()).limit(50).all()
        monitoring_data = [{
            "log_id": l.log_id,
            "log_date": _date(l.log_date),
            "package_id": l.package_id,
            "reason_for_delay": l.reason_for_delay,
            "issues": l.issues,
            "action_taken": l.action_taken,
            "progress_status": l.progress_status,
            "extra_fields": l.extra_fields or {},
        } for l in logs]
    except Exception:
        monitoring_data = []

    return {
        "core": core,
        "formulation": formulation_data,
        "stage1": stage1_data,
        "stage2": stage2_data,
        "packages": packages_data,
        "tendering": tendering_data,
        "contracts": contracts_data,
        "completion": completion_data,
        "monitoring": monitoring_data,
    }


# ============================================================================
# 2b) Furnace approval timeline routes
# ============================================================================
@router.get("/{scheme_id}/approvals")
def get_scheme_approvals(scheme_id: int, db: Session = Depends(get_db)):
    scheme = db.query(Scheme).filter(
        Scheme.scheme_id == scheme_id,
        Scheme.is_deleted == False
    ).first()
    if not scheme:
        raise HTTPException(status_code=404, detail="Scheme not found")

    formulation_rows = db.query(SchemeFormulation).filter(
        SchemeFormulation.scheme_id == scheme_id,
        SchemeFormulation.is_deleted == False
    ).order_by(SchemeFormulation.revision_no).all()
    stage1_rows = db.query(Stage1Approval).filter(
        Stage1Approval.scheme_id == scheme_id,
        Stage1Approval.is_deleted == False
    ).order_by(Stage1Approval.revision_no).all()
    stage2_rows = db.query(Stage2Approval).filter(
        Stage2Approval.scheme_id == scheme_id,
        Stage2Approval.is_deleted == False
    ).order_by(Stage2Approval.revision_no).all()
    tender_rows = db.query(TenderCycle).join(Package, Package.package_id == TenderCycle.package_id).filter(
        Package.scheme_id == scheme_id,
        Package.is_deleted == False,
        TenderCycle.is_deleted == False
    ).order_by(TenderCycle.cycle_no, TenderCycle.tender_cycle_id).all()

    tender_entries = []
    for row in tender_rows:
        tender_entries.append({
            "id": row.tender_cycle_id,
            "revision_no": row.cycle_no or 0,
            "revision_label": row.cycle_label or f"Cycle-{row.cycle_no or 0}",
            "is_current": bool(row.is_current),
            "fields": {
                field: _coerce_value(getattr(row, field, None))
                for field in _APPROVAL_STAGE_FIELDS["tendering"]
                if getattr(row, field, None) is not None
            },
            "remarks": row.remarks or "",
        })

    return {
        "scheme_id": scheme.scheme_id,
        "current_status": scheme.current_status,
        "stages": {
            "formulation": _serialize_stage_rows(formulation_rows, "formulation_id", "revision_no", "revision_label", _APPROVAL_STAGE_FIELDS["formulation"]),
            "stage1": _serialize_stage_rows(stage1_rows, "stage1_id", "revision_no", "revision_label", _APPROVAL_STAGE_FIELDS["stage1"]),
            "tendering": tender_entries,
            "stage2": _serialize_stage_rows(stage2_rows, "stage2_id", "revision_no", "revision_label", _APPROVAL_STAGE_FIELDS["stage2"]),
        },
    }


@router.post("/{scheme_id}/approvals/{stage}")
def add_stage_revision(
    scheme_id: int,
    stage: str,
    payload: ApprovalRevisionIn,
    db: Session = Depends(get_db),
):
    scheme = db.query(Scheme).filter(
        Scheme.scheme_id == scheme_id,
        Scheme.is_deleted == False
    ).first()
    if not scheme:
        raise HTTPException(status_code=404, detail="Scheme not found")

    try:
        if stage == "formulation":
            db.query(SchemeFormulation).filter(
                SchemeFormulation.scheme_id == scheme_id,
                SchemeFormulation.is_current == True,
                SchemeFormulation.is_deleted == False
            ).update({"is_current": False}, synchronize_session=False)
            next_rev = (db.query(func.coalesce(func.max(SchemeFormulation.revision_no), -1)).filter(
                SchemeFormulation.scheme_id == scheme_id
            ).scalar() or -1) + 1
            row = SchemeFormulation(
                scheme_id=scheme_id,
                revision_no=next_rev,
                revision_label=payload.revision_label or f"R{next_rev}",
                remarks=payload.remarks,
                is_current=True,
            )
            for key, value in (payload.fields or {}).items():
                if hasattr(row, key):
                    setattr(row, key, _coerce_value(value))
            db.add(row)
            db.commit()
            db.refresh(row)
            return {"id": row.formulation_id}

        if stage == "stage1":
            db.query(Stage1Approval).filter(
                Stage1Approval.scheme_id == scheme_id,
                Stage1Approval.is_current == True,
                Stage1Approval.is_deleted == False
            ).update({"is_current": False}, synchronize_session=False)
            next_rev = (db.query(func.coalesce(func.max(Stage1Approval.revision_no), -1)).filter(
                Stage1Approval.scheme_id == scheme_id
            ).scalar() or -1) + 1
            row = Stage1Approval(
                scheme_id=scheme_id,
                revision_no=next_rev,
                revision_label=payload.revision_label or f"R{next_rev}",
                remarks=payload.remarks,
                is_current=True,
            )
            for key, value in (payload.fields or {}).items():
                if hasattr(row, key):
                    setattr(row, key, _coerce_value(value))
            db.add(row)
            db.commit()
            db.refresh(row)
            return {"id": row.stage1_id}

        if stage == "stage2":
            db.query(Stage2Approval).filter(
                Stage2Approval.scheme_id == scheme_id,
                Stage2Approval.is_current == True,
                Stage2Approval.is_deleted == False
            ).update({"is_current": False}, synchronize_session=False)
            next_rev = (db.query(func.coalesce(func.max(Stage2Approval.revision_no), -1)).filter(
                Stage2Approval.scheme_id == scheme_id
            ).scalar() or -1) + 1
            row = Stage2Approval(
                scheme_id=scheme_id,
                revision_no=next_rev,
                revision_label=payload.revision_label or f"R{next_rev}",
                remarks=payload.remarks,
                is_current=True,
            )
            for key, value in (payload.fields or {}).items():
                if hasattr(row, key):
                    setattr(row, key, _coerce_value(value))
            db.add(row)
            db.commit()
            db.refresh(row)
            return {"id": row.stage2_id}

        if stage == "tendering":
            package = db.query(Package).filter(
                Package.scheme_id == scheme_id,
                Package.is_deleted == False
            ).order_by(Package.package_no, Package.package_id).first()
            if not package:
                raise HTTPException(status_code=400, detail="Create a package before adding tendering cycles")

            db.query(TenderCycle).filter(
                TenderCycle.package_id == package.package_id,
                TenderCycle.is_current == True,
                TenderCycle.is_deleted == False
            ).update({"is_current": False}, synchronize_session=False)
            next_cycle = (db.query(func.coalesce(func.max(TenderCycle.cycle_no), 0)).filter(
                TenderCycle.package_id == package.package_id
            ).scalar() or 0) + 1
            row = TenderCycle(
                package_id=package.package_id,
                cycle_no=next_cycle,
                cycle_label=payload.revision_label or f"Cycle-{next_cycle}",
                remarks=payload.remarks,
                is_current=True,
                cycle_status="active",
            )
            for key, value in (payload.fields or {}).items():
                if hasattr(row, key):
                    setattr(row, key, _coerce_value(value))
            db.add(row)
            db.commit()
            db.refresh(row)
            return {"id": row.tender_cycle_id}

        raise HTTPException(status_code=400, detail=f"Unknown approval stage: {stage}")
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not add approval revision: {e}")


@router.post("/{scheme_id}/change-stage")
def change_scheme_stage(
    scheme_id: int,
    payload: StageChangeIn,
    db: Session = Depends(get_db),
):
    scheme = db.query(Scheme).filter(
        Scheme.scheme_id == scheme_id,
        Scheme.is_deleted == False
    ).first()
    if not scheme:
        raise HTTPException(status_code=404, detail="Scheme not found")

    scheme.current_status = payload.new_status
    scheme.updated_at = datetime.utcnow()
    db.commit()
    return {"current_status": scheme.current_status, "remark": payload.remark}


# ============================================================================
# 3) PUT /{scheme_id}/section/{section_name}  → granular saves
# ============================================================================
@router.put("/{scheme_id}/section/{section_name}")
def update_scheme_section(
    scheme_id: int,
    section_name: str,
    payload: dict,
    db: Session = Depends(get_db),
):
    """
    Save a specific section of the Vault.
    section_name: core | formulation | stage1 | stage2 | package | contract |
                  completion | monitoring | tender_cycle
    """
    scheme = db.query(Scheme).filter(Scheme.scheme_id == scheme_id).first()
    if not scheme:
        raise HTTPException(status_code=404, detail="Scheme not found")

    try:
        if section_name == "core":
            for k, v in payload.items():
                if k in ("scheme_id", "created_at", "created_by"):
                    continue
                if hasattr(scheme, k):
                    setattr(scheme, k, v)
            scheme.updated_at = datetime.utcnow()
            db.commit()
            return {"ok": True, "section": "core"}

        if section_name == "formulation":
            row = db.query(SchemeFormulation).filter(
                SchemeFormulation.scheme_id == scheme_id,
                SchemeFormulation.is_current == True,
            ).first()
            if not row:
                row = SchemeFormulation(
                    scheme_id=scheme_id,
                    revision_no=0, is_current=True,
                )
                db.add(row)
                db.flush()
            for k, v in payload.items():
                if k in ("formulation_id", "scheme_id"):
                    continue
                if hasattr(row, k):
                    setattr(row, k, v)
            row.updated_at = datetime.utcnow()
            db.commit()
            return {"ok": True, "section": "formulation", "formulation_id": row.formulation_id}

        if section_name == "stage1":
            row = db.query(Stage1Approval).filter(
                Stage1Approval.scheme_id == scheme_id,
                Stage1Approval.is_current == True,
            ).first()
            if not row:
                row = Stage1Approval(
                    scheme_id=scheme_id, revision_no=0, is_current=True,
                )
                db.add(row); db.flush()
            for k, v in payload.items():
                if k in ("stage1_id", "scheme_id"): continue
                if hasattr(row, k): setattr(row, k, v)
            row.updated_at = datetime.utcnow()
            db.commit()
            return {"ok": True, "section": "stage1", "stage1_id": row.stage1_id}

        if section_name == "stage2":
            row = db.query(Stage2Approval).filter(
                Stage2Approval.scheme_id == scheme_id,
                Stage2Approval.is_current == True,
            ).first()
            if not row:
                row = Stage2Approval(
                    scheme_id=scheme_id, revision_no=0, is_current=True,
                )
                db.add(row); db.flush()
            for k, v in payload.items():
                if k in ("stage2_id", "scheme_id"): continue
                if hasattr(row, k): setattr(row, k, v)
            row.updated_at = datetime.utcnow()
            db.commit()
            return {"ok": True, "section": "stage2", "stage2_id": row.stage2_id}

        if section_name == "package":
            pkg_id = payload.get("package_id")
            if not pkg_id:
                raise HTTPException(status_code=400, detail="package_id required")
            pkg = db.query(Package).filter(Package.package_id == pkg_id).first()
            if not pkg:
                raise HTTPException(status_code=404, detail="Package not found")
            for k, v in payload.items():
                if k in ("package_id", "scheme_id"): continue
                if hasattr(pkg, k): setattr(pkg, k, v)
            pkg.updated_at = datetime.utcnow()
            db.commit()
            return {"ok": True, "section": "package", "package_id": pkg_id}

        if section_name == "contract":
            pkg_id = payload.get("package_id")
            if not pkg_id:
                raise HTTPException(status_code=400, detail="package_id required")
            ctr = db.query(Contract).filter(Contract.package_id == pkg_id).first()
            if not ctr:
                ctr = Contract(package_id=pkg_id)
                db.add(ctr); db.flush()
            for k, v in payload.items():
                if k in ("contract_id", "package_id", "amendments"): continue
                if hasattr(ctr, k): setattr(ctr, k, v)
            ctr.updated_at = datetime.utcnow()
            db.commit()
            return {"ok": True, "section": "contract", "contract_id": ctr.contract_id}

        if section_name == "completion":
            pkg_id = payload.get("package_id")
            if not pkg_id:
                raise HTTPException(status_code=400, detail="package_id required")
            comp = db.query(CompletionDetail).filter(CompletionDetail.package_id == pkg_id).first()
            if not comp:
                comp = CompletionDetail(package_id=pkg_id)
                db.add(comp); db.flush()
            for k, v in payload.items():
                if k in ("completion_id", "package_id"): continue
                if hasattr(comp, k): setattr(comp, k, v)
            comp.updated_at = datetime.utcnow()
            db.commit()
            return {"ok": True, "section": "completion", "completion_id": comp.completion_id}

        if section_name == "monitoring":
            log = MonitoringLog(
                scheme_id=scheme_id,
                package_id=payload.get("package_id"),
                log_date=payload.get("log_date"),
                reason_for_delay=payload.get("reason_for_delay"),
                issues=payload.get("issues"),
                action_taken=payload.get("action_taken"),
                progress_status=payload.get("progress_status"),
                extra_fields=payload.get("extra_fields") or {},
            )
            db.add(log)
            db.commit()
            return {"ok": True, "section": "monitoring", "log_id": log.log_id}

        raise HTTPException(status_code=400, detail=f"Unknown section: {section_name}")

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        import traceback; traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Save failed: {e}")


# ============================================================================
# 4) GET /{scheme_id}  → simple single-scheme fetch (kept for compatibility)
# ============================================================================
@router.get("/{scheme_id}")
def get_scheme(scheme_id: int, db: Session = Depends(get_db)):
    scheme = db.query(Scheme).filter(
        Scheme.scheme_id == scheme_id,
        Scheme.is_deleted == False
    ).first()
    if not scheme:
        raise HTTPException(status_code=404, detail="Scheme not found")
    return {
        "scheme_id": scheme.scheme_id,
        "scheme_name": scheme.scheme_name,
        "scheme_type": scheme.scheme_type,
        "current_status": scheme.current_status,
        "estimated_cost_cr": _num(scheme.estimated_cost_cr),
        "has_multiple_packages": scheme.has_multiple_packages or False,
        "extra_fields": scheme.extra_fields or {},
    }


# ============================================================================
# 5) POST /step1  → new scheme registration
# ============================================================================
@router.post("/step1")
def create_scheme_step1(data: dict, db: Session = Depends(get_db)):
    try:
        new_scheme = Scheme(
            scheme_name=data.get("scheme_name"),
            scheme_type=data.get("scheme_type", "plant"),
            current_status=data.get("current_status", "under_formulation"),
            estimated_cost_cr=data.get("estimated_cost"),
            created_by=1, updated_by=1,
        )
        db.add(new_scheme); db.commit(); db.refresh(new_scheme)
        return {
            "id": new_scheme.scheme_id,
            "scheme_id": new_scheme.scheme_id,
            "scheme_name": new_scheme.scheme_name,
            "scheme_type": new_scheme.scheme_type,
            "current_status": new_scheme.current_status,
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# 6) POST /check-name  → duplicate name check
# ============================================================================
@router.post("/check-name")
def check_scheme_name(data: dict, db: Session = Depends(get_db)):
    name = data.get("scheme_name", "").strip()
    if not name:
        return {"matches": []}

    exact = db.query(Scheme).filter(
        func.lower(Scheme.scheme_name) == name.lower(),
        Scheme.is_deleted == False,
    ).first()

    matches = []
    if exact:
        matches.append({"id": exact.scheme_id, "name": exact.scheme_name, "exact": True})

    similar = db.query(Scheme).filter(
        func.lower(Scheme.scheme_name).contains(name.lower()),
        Scheme.is_deleted == False,
    ).limit(5).all()

    for s in similar:
        if not exact or s.scheme_id != exact.scheme_id:
            matches.append({
                "id": s.scheme_id, "name": s.scheme_name,
                "exact": False, "confidence": 75
            })

    return {"matches": matches}


# ============================================================================
# 7) PUT /{scheme_id}/status  → manual status override
# ============================================================================
@router.put("/{scheme_id}/status")
def update_scheme_status(scheme_id: int, data: dict, db: Session = Depends(get_db)):
    scheme = db.query(Scheme).filter(Scheme.scheme_id == scheme_id).first()
    if not scheme:
        raise HTTPException(status_code=404, detail="Scheme not found")

    new_status = data.get("status")
    valid = [
        "under_formulation", "under_stage1", "under_tendering",
        "under_stage2", "ongoing", "closed", "dropped", "on_hold"
    ]
    if new_status not in valid:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of: {valid}")

    scheme.current_status = new_status
    scheme.updated_by = 1
    db.commit()
    return {
        "scheme_id": scheme.scheme_id,
        "current_status": scheme.current_status,
        "message": f"Status updated to '{new_status}'",
    }


# ============================================================================
# 8) GET /parents  → parent dropdown
# ============================================================================
@router.get("/parents")
def get_potential_parents(scheme_id: int = None, db: Session = Depends(get_db)):
    q = db.query(Scheme).filter(Scheme.is_deleted == False)
    if scheme_id:
        q = q.filter(Scheme.scheme_id != scheme_id)
    parents = q.order_by(Scheme.scheme_id.desc()).limit(50).all()
    return [{"id": p.scheme_id, "scheme_name": p.scheme_name} for p in parents]


# ============================================================================
# Legacy alias for the old /{scheme_id}/vault endpoint  (so existing UI works)
# ============================================================================
@router.get("/{scheme_id}/vault")
def get_scheme_vault_legacy(scheme_id: int, db: Session = Depends(get_db)):
    """Alias to /full for old frontend code."""
    return get_scheme_full(scheme_id, db)
