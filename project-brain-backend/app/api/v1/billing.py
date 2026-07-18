from datetime import date
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import text
from app.core.database import get_db

router = APIRouter(prefix="/billing", tags=["billing"])

class RABillCreate(BaseModel):
    package_id: int
    bill_no: str
    bill_date: date
    gross_amount_cr: float
    gst_amount_cr: float
    retention_amount_cr: float
    price_variation_cr: Optional[float] = 0.0
    net_payable_cr: float
    payment_status: str = "pending"

class ClearanceUpdate(BaseModel):
    package_id: int
    gate_name: str  # manufacturing, inspection, dispatch, site_receipt, approval
    cleared_date: date
    cleared_by: str
    remarks: Optional[str] = None

@router.get("/bills/{package_id}")
def get_bills(package_id: int, db: Session = Depends(get_db)):
    rows = db.execute(text("""
        SELECT bill_id, bill_no, bill_date, gross_amount_cr, gst_amount_cr,
               retention_amount_cr, price_variation_cr, net_payable_cr, payment_status
        FROM ra_bills
        WHERE package_id = :pid AND is_deleted = FALSE
        ORDER BY bill_date DESC
    """), {"pid": package_id}).fetchall()
    return [dict(r) for r in rows]

@router.post("/bills")
def create_bill(bill: RABillCreate, db: Session = Depends(get_db)):
    try:
        bill_id = db.execute(text("""
            INSERT INTO ra_bills (
                package_id, bill_no, bill_date, gross_amount_cr, gst_amount_cr,
                retention_amount_cr, price_variation_cr, net_payable_cr, payment_status,
                is_deleted, created_at, updated_at
            ) VALUES (
                :pid, :no, :dt, :gross, :gst, :ret, :pv, :net, :status,
                FALSE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            ) RETURNING bill_id
        """), {
            "pid": bill.package_id, "no": bill.bill_no, "dt": bill.bill_date,
            "gross": bill.gross_amount_cr, "gst": bill.gst_amount_cr,
            "ret": bill.retention_amount_cr, "pv": bill.price_variation_cr,
            "net": bill.net_payable_cr, "status": bill.payment_status
        }).scalar()
        db.commit()
        return {"bill_id": bill_id, "status": "created"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/clearances/{package_id}")
def get_clearances(package_id: int, db: Session = Depends(get_db)):
    rows = db.execute(text("""
        SELECT clearance_id, gate_name, cleared_date, cleared_by, remarks
        FROM package_clearances
        WHERE package_id = :pid AND is_deleted = FALSE
    """), {"pid": package_id}).fetchall()
    return [dict(r) for r in rows]

@router.post("/clearances")
def update_clearance(c: ClearanceUpdate, db: Session = Depends(get_db)):
    try:
        db.execute(text("""
            INSERT INTO package_clearances (package_id, gate_name, cleared_date, cleared_by, remarks, is_deleted)
            VALUES (:pid, :gate, :dt, :by, :rem, FALSE)
            ON CONFLICT (package_id, gate_name) 
            DO UPDATE SET cleared_date = EXCLUDED.cleared_date, 
                          cleared_by = EXCLUDED.cleared_by, 
                          remarks = EXCLUDED.remarks,
                          updated_at = CURRENT_TIMESTAMP
        """), {
            "pid": c.package_id, "gate": c.gate_name, "dt": c.cleared_date, "by": c.cleared_by, "rem": c.remarks
        })
        db.commit()
        return {"ok": True}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
