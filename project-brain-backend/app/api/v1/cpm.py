from fastapi import APIRouter, HTTPException
from app.services.cpm_engine import CPMEngine
from pydantic import BaseModel
from typing import List, Optional

router = APIRouter(prefix="/cpm", tags=["CPM Engine"])

class ActivityItem(BaseModel):
    id: str
    name: str
    duration: int
    predecessors: List[str]

@router.post("/analyze")
async def analyze_schedule(activities: List[ActivityItem]):
    try:
        results = CPMEngine.calculate_cpm([a.dict() for a in activities])
        return results
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
