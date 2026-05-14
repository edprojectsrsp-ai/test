from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.material import MaterialEntry

router = APIRouter(prefix="/material", tags=["Material"])


class MaterialCreate(BaseModel):
    material_name: str
    uom: str
    planned_qty: float
    received_qty: float = 0.0
    consumed_qty: float = 0.0


class MaterialTransaction(BaseModel):
    id: int
    received_add: float = 0.0
    consumed_add: float = 0.0


@router.get("/{scheme_id}")
def get_inventory(scheme_id: int, db: Session = Depends(get_db)):
    """Fetch the complete material inventory for a scheme."""
    return db.query(MaterialEntry).filter(MaterialEntry.scheme_id == scheme_id).all()


@router.post("/{scheme_id}/new")
def add_new_material(scheme_id: int, item: MaterialCreate, db: Session = Depends(get_db)):
    """Add a new material category to the scheme."""
    new_mat = MaterialEntry(scheme_id=scheme_id, **item.model_dump())
    db.add(new_mat)
    db.commit()
    db.refresh(new_mat)
    return new_mat


@router.put("/transaction")
def log_transaction(payload: MaterialTransaction, db: Session = Depends(get_db)):
    """Update received or consumed quantities for an existing material."""
    record = db.query(MaterialEntry).filter(MaterialEntry.id == payload.id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Material not found")

    record.received_qty += payload.received_add
    record.consumed_qty += payload.consumed_add
    db.commit()
    db.refresh(record)
    return record
