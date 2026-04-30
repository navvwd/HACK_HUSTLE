from fastapi import Request, HTTPException, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from database import supabase
from models import UserProfile
from sqlalchemy.ext.asyncio import AsyncSession
from database import get_db

security = HTTPBearer()

async def get_current_user(credentials: HTTPAuthorizationCredentials = Security(security)):
    """
    Validates Supabase JWT token and extracts user metadata.
    """
    token = credentials.credentials
    if not supabase:
        raise HTTPException(status_code=500, detail="Supabase client not initialized")
        
    try:
        # Verify JWT with Supabase (returns user object)
        res = supabase.auth.get_user(token)
        if not res.user:
            raise HTTPException(status_code=401, detail="Invalid token")
            
        return res.user
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Authentication failed: {str(e)}")

async def require_role(allowed_roles: list[str]):
    """
    Dependency generator for role-based protection
    """
    async def role_checker(user = Security(get_current_user)):
        user_role = user.user_metadata.get('role', 'user')
        if user_role not in allowed_roles:
            raise HTTPException(
                status_code=403, 
                detail=f"Access denied. Requires one of: {', '.join(allowed_roles)}"
            )
        return user
    return role_checker
