from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from auth import require_role
from services.decision_engine import DecisionEngine

router = APIRouter(prefix="/api/decisions", tags=["decisions"])

class DecisionRequest(BaseModel):
    claim_id: str

@router.post("/", dependencies=[Depends(require_role(["seller", "admin"]))])
async def generate_decision(req: DecisionRequest):
    """
    Generate a decision for a claim based on extracted signals.
    Typically triggered automatically or by an admin/seller.
    """
    try:
        decision = DecisionEngine.process_and_store_decision(req.claim_id)
        return {"message": "Decision generated", "data": decision}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
