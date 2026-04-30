from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from database import supabase
from auth import require_role

router = APIRouter(prefix="/api/orders", tags=["orders"])

class OrderCreate(BaseModel):
    product_id: str

@router.post("/", dependencies=[Depends(require_role(["user"]))])
async def place_order(order: OrderCreate, user = Depends(require_role(["user"]))):
    """
    Place an order. Requires 'user' role.
    """
    try:
        res = supabase.table("orders").insert({
            "customer_id": user.id,
            "product_id": order.product_id,
            "status": "PENDING"
        }).execute()
        return {"message": "Order placed successfully", "data": res.data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/my-orders", dependencies=[Depends(require_role(["user"]))])
async def get_my_orders(user = Depends(require_role(["user"]))):
    """
    Get current user's orders.
    """
    try:
        res = supabase.table("orders").select("*, products(name, price)").eq("customer_id", user.id).execute()
        return {"data": res.data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
