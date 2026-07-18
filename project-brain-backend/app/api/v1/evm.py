"""Earned Value Management API.

  GET /evm/scheme/{scheme_id}?fy_start_year=2026   full monthly EVM series
  GET /evm/portfolio?fy_start_year=2026            latest snapshot, all schemes
  GET /evm/glossary                                metric definitions (UI help)

All figures in ₹ Cr. Basis: PV/AC financial (effective CAPEX plan + booked
actuals), EV = weighted physical % complete × BAC (gross cost). See
app/services/evm_engine.py for formula definitions.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.security.auth import require_user
from app.services import evm_engine as EVM

router = APIRouter(prefix="/evm", tags=["EVM"], dependencies=[Depends(require_user)])


@router.get("/scheme/{scheme_id}")
def scheme_evm(scheme_id: int, fy_start_year: Optional[int] = None,
               db: Session = Depends(get_db)):
    try:
        return EVM.scheme_evm(db, scheme_id, fy_start_year)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"EVM failed: {str(e)[:300]}")


@router.get("/portfolio")
def portfolio(fy_start_year: Optional[int] = None, db: Session = Depends(get_db)):
    try:
        return EVM.portfolio_evm(db, fy_start_year)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"EVM failed: {str(e)[:300]}")


@router.get("/glossary")
def glossary():
    return {"metrics": [
        {"key": "pv", "name": "Planned Value", "def": "Budgeted cost of work scheduled to date (exp. till last FY + FY plan)."},
        {"key": "ev", "name": "Earned Value", "def": "Budgeted cost of work actually performed = physical % complete × BAC."},
        {"key": "ac", "name": "Actual Cost", "def": "Booked expenditure to date (exp. till last FY + FY actuals)."},
        {"key": "spi", "name": "Schedule Performance Index", "def": "EV ÷ PV. < 1 behind schedule."},
        {"key": "cpi", "name": "Cost Performance Index", "def": "EV ÷ AC. < 1 over cost."},
        {"key": "sv", "name": "Schedule Variance", "def": "EV − PV (Cr)."},
        {"key": "cv", "name": "Cost Variance", "def": "EV − AC (Cr)."},
        {"key": "eac", "name": "Estimate At Completion", "def": "BAC ÷ CPI — forecast final cost at current efficiency."},
        {"key": "eac_ac", "name": "EAC (atypical)", "def": "AC + (BAC − EV) — if variance to date won't repeat."},
        {"key": "eac_scr", "name": "EAC (schedule-adj.)", "def": "AC + (BAC − EV)/(CPI·SPI) — worst case."},
        {"key": "etc", "name": "Estimate To Complete", "def": "EAC − AC."},
        {"key": "vac", "name": "Variance At Completion", "def": "BAC − EAC. Negative = forecast overrun."},
        {"key": "tcpi", "name": "To-Complete Performance Index", "def": "(BAC−EV)÷(BAC−AC). Efficiency needed to finish on budget."},
    ]}
