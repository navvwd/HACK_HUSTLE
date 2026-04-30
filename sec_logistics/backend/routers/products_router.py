from fastapi import APIRouter, Depends, HTTPException
from typing import List
from pydantic import BaseModel
from database import supabase
from auth import require_role

router = APIRouter(prefix="/api/products", tags=["products"])

class ProductCreate(BaseModel):
    name: str
    category: str
    price: float
    description: str = ""

@router.get("/")
async def get_products():
    """Fetch all products. Everyone can view."""
    try:
        res = supabase.table("products").select("*").execute()
        return {"data": res.data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/", dependencies=[Depends(require_role(["seller"]))])
async def create_product(product: ProductCreate, user = Depends(require_role(["seller"]))):
    """
    Create a new product.
    Requires 'seller' role. RLS ensures they can only create for themselves.
    Since backend bypasses RLS (if using service_role key), we explicitly set seller_id.
    """
    try:
        res = supabase.table("products").insert({
            "seller_id": user.id,
            "name": product.name,
            "category": product.category,
            "price": product.price,
            "description": product.description
        }).execute()
        return {"data": res.data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
