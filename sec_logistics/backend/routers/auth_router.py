from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from database import get_db
from models import UserProfile

router = APIRouter(prefix="/api/auth", tags=["auth"])

class RegisterRequest(BaseModel):
    id: str
    email: str
    name: str
    role: str

@router.post("/register")
async def register_user(req: RegisterRequest, db: AsyncSession = Depends(get_db)):
    """
    Called by the frontend after successful Supabase signup 
    to persist profile data in our SQLite database.
    """
    new_profile = UserProfile(
        id=req.id,
        email=req.email,
        name=req.name,
        role=req.role
    )
    db.add(new_profile)
    try:
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=400, detail="Profile creation failed or email already exists")
    
    return {"message": "Profile created successfully"}
