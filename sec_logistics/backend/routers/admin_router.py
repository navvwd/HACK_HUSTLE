from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from database import supabase
from auth import require_role

router = APIRouter(prefix="/api/admin", tags=["admin"])

@router.get("/stats", dependencies=[Depends(require_role(["admin"]))])
async def get_admin_stats():
    """
    Get aggregated fraud trends and high risk users.
    """
    try:
        # Get all decisions to calculate fraud rate
        decisions_res = supabase.table("decisions").select("*").execute()
        decisions = decisions_res.data
        
        total_claims = len(decisions)
        fraud_claims = len([d for d in decisions if d["score"] > 0.3])
        fraud_rate = (fraud_claims / total_claims * 100) if total_claims > 0 else 0
        
        # Get all claims to group by user for risk analysis
        claims_res = supabase.table("claims").select("customer_id, status").execute()
        claims = claims_res.data
        
        user_risk = {}
        for c in claims:
            cid = c["customer_id"]
            if cid not in user_risk:
                user_risk[cid] = {"total": 0, "fraudulent": 0}
            user_risk[cid]["total"] += 1
            if c["status"] in ["REJECTED", "REQUIRES_REVIEW", "ESCALATED"]:
                user_risk[cid]["fraudulent"] += 1
                
        high_risk_users = [
            {"customer_id": cid, **stats} 
            for cid, stats in user_risk.items() 
            if stats["fraudulent"] > 0
        ]
        high_risk_users.sort(key=lambda x: x["fraudulent"], reverse=True)

        return {
            "fraud_trends": {
                "total_claims": total_claims,
                "fraud_rate": round(fraud_rate, 1)
            },
            "high_risk_users": high_risk_users[:10]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/claims", dependencies=[Depends(require_role(["admin"]))])
async def get_escalated_claims():
    """
    Get claims that need manual review (friction or escalated).
    """
    try:
        res = supabase.table("claims").select("*, decisions(*), orders(*, products(name))").in_("status", ["REQUIRES_REVIEW", "ESCALATED"]).execute()
        return {"data": res.data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class OverrideAction(BaseModel):
    action: str  # "approve", "reject"

@router.put("/claims/{claim_id}/override", dependencies=[Depends(require_role(["admin"]))])
async def override_claim(claim_id: str, payload: OverrideAction):
    """
    Admin override for a claim.
    """
    valid_actions = {"approve": "APPROVED", "reject": "REJECTED"}
    if payload.action not in valid_actions:
        raise HTTPException(status_code=400, detail="Invalid action")
        
    try:
        res = supabase.table("claims").update({"status": valid_actions[payload.action]}).eq("id", claim_id).execute()
        return {"message": "Claim overridden successfully", "data": res.data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
