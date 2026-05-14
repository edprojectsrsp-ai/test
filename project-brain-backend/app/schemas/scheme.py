from pydantic import BaseModel
from datetime import date
from typing import Optional


class SchemeCreate(BaseModel):
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
