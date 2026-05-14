from pydantic import BaseModel, ConfigDict
from enum import Enum
from datetime import date
from typing import Optional


class SchemeType(str, Enum):
    corporate = "corporate"
    plant = "plant"
    dummy = "dummy"


class SchemeStatus(str, Enum):
    under_formulation = "under_formulation"
    under_stage1 = "under_stage1"
    under_tendering = "under_tendering"
    under_stage2 = "under_stage2"
    ongoing = "ongoing"
    closed = "closed"


class SchemeNameCheckRequest(BaseModel):
    scheme_name: str


class SchemeStep1Create(BaseModel):
    scheme_name: str
    scheme_type: SchemeType
    current_status: SchemeStatus
    estimated_cost: Optional[float] = None


class SchemeStep2Update(BaseModel):
    stage1_date: Optional[date] = None
    stage2_date: Optional[date] = None
    start_date: Optional[date] = None
    scheduled_completion_date: Optional[date] = None
    expected_completion_date: Optional[date] = None
    closure_date: Optional[date] = None
    remarks: Optional[str] = None


class SchemeResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    scheme_name: str
    scheme_type: str
    current_status: str
    is_active: bool = True
    multi_package_type: str = "none"
    parent_scheme_id: Optional[int] = None
    total_cost: float = 0.0
    stage1_date: Optional[date] = None
    stage2_date: Optional[date] = None
    start_date: Optional[date] = None
    scheduled_completion_date: Optional[date] = None
    expected_completion_date: Optional[date] = None
    closure_date: Optional[date] = None
    remarks: Optional[str] = None
