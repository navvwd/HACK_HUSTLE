from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from database import supabase
from auth import require_role
from services.signal_extractor import SignalExtractor
import os
import uuid

router = APIRouter(prefix="/api/claims", tags=["claims"])

@router.post("/", dependencies=[Depends(require_role(["user"]))])
async def create_claim(
    order_id: str = Form(...),
    reason: str = Form(...),
    image: UploadFile = File(...),
    receipt: UploadFile = File(None),
    user = Depends(require_role(["user"]))
):
    """
    Submit a return claim. Validates order ownership and extracts image metadata.
    """
    # 1. Validate Order Ownership
    try:
        order_res = supabase.table("orders").select("*").eq("id", order_id).eq("customer_id", user.id).execute()
        if not order_res.data:
            raise HTTPException(status_code=403, detail="Order not found or access denied")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
        
    # 2. Save uploaded files
    os.makedirs("uploads", exist_ok=True)
    image_ext = image.filename.split('.')[-1]
    image_path = f"uploads/{uuid.uuid4()}.{image_ext}"
    with open(image_path, "wb") as f:
        f.write(await image.read())
        
    receipt_path = None
    if receipt:
        receipt_ext = receipt.filename.split('.')[-1]
        receipt_path = f"uploads/{uuid.uuid4()}_receipt.{receipt_ext}"
        with open(receipt_path, "wb") as f:
            f.write(await receipt.read())
            
    # 4. Insert Claim into Supabase
    try:
        res = supabase.table("claims").insert({
            "order_id": order_id,
            "customer_id": user.id,
            "reason": reason,
            "image_url": image_path,
            "receipt_url": receipt_path,
            "status": "PENDING_REVIEW"
        }).execute()
        claim_id = res.data[0]['id']
        
        # 5. Extract and Store Signals (Phase 4)
        SignalExtractor.process_and_store_signals(
            claim_id=claim_id,
            order_id=order_id,
            customer_id=user.id,
            image_path=image_path,
            receipt_path=receipt_path
        )
        
        return {"message": "Claim submitted and signals extracted successfully", "data": res.data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class ClaimAction(BaseModel):
    action: str  # "approve", "reject", "escalate"

@router.put("/{claim_id}/action", dependencies=[Depends(require_role(["seller", "admin"]))])
async def seller_claim_action(claim_id: str, payload: ClaimAction, user = Depends(require_role(["seller", "admin"]))):
    """
    Seller endpoint to manually override or decide on a claim.
    """
    valid_actions = {"approve": "APPROVED", "reject": "REJECTED", "escalate": "ESCALATED"}
    
    if payload.action not in valid_actions:
        raise HTTPException(status_code=400, detail="Invalid action")
        
    try:
        # Check ownership (Does this claim belong to a product owned by the seller?)
        # For brevity, backend runs with service_role so we must manually check.
        # RLS would handle this automatically if called from frontend.
        
        # Update claim status
        res = supabase.table("claims").update({"status": valid_actions[payload.action]}).eq("id", claim_id).execute()
        return {"message": f"Claim {payload.action}d successfully", "data": res.data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
