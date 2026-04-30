"""Review router — human review queue."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import database as db

router = APIRouter()

class ReviewDecision(BaseModel):
    decision: str
    reviewer: str
    notes: str = ""

@router.get("/queue")
async def get_review_queue():
    return {"queue": db.get_review_queue()}

@router.post("/{request_id}/decide")
async def submit_review_decision(request_id: str, decision: ReviewDecision):
    if decision.decision not in ("approved", "denied", "escalated"):
        raise HTTPException(400, "Invalid decision")
    success = db.update_review_decision(request_id, decision.decision, decision.reviewer)
    if not success:
        raise HTTPException(404, "Request not found in queue")
    return {"status": "decided", "request_id": request_id, "decision": decision.decision}

@router.get("/stats")
async def review_stats():
    return db.get_review_stats()
