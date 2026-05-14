from sqlalchemy import Column, Float, ForeignKey, Integer, String

from app.core.database import Base


class MaterialEntry(Base):
    __tablename__ = "materials"

    id = Column(Integer, primary_key=True, index=True)
    scheme_id = Column(Integer, ForeignKey("schemes.id"), nullable=False)
    material_name = Column(String, nullable=False)
    uom = Column(String, nullable=False)
    planned_qty = Column(Float, default=0.0)
    received_qty = Column(Float, default=0.0)
    consumed_qty = Column(Float, default=0.0)

