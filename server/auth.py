import jwt
import datetime
from fastapi import HTTPException
from pydantic import BaseModel
import os

JWT_SECRET = os.getenv("JWT_SECRET", "super-secret-hackathon-key-2026")
JWT_ALGORITHM = "HS256"

# Hardcoded demo users from the plan to ensure a flawless presentation without DB setup
USERS = {
    "admin": {"password": "admin123", "role": "admin", "customer_id": None},
    "maya": {"password": "user123", "role": "user", "customer_id": "cust_maya_demo"},
    "priya": {"password": "user123", "role": "user", "customer_id": "cust_priya"},
}

class LoginRequest(BaseModel):
    username: str
    password: str

def create_access_token(username: str, role: str, customer_id: str = None) -> str:
    """Generate a JWT token for the user."""
    payload = {
        "sub": username,
        "role": role,
        "customer_id": customer_id,
        "exp": datetime.datetime.utcnow() + datetime.timedelta(hours=24)
    }
    token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
    return token

def verify_token(token: str) -> dict:
    """Decode and verify the JWT token."""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

def authenticate_user(req: LoginRequest) -> dict:
    """Check credentials and return token and user info."""
    user = USERS.get(req.username.lower())
    if not user or user["password"] != req.password:
        raise HTTPException(status_code=401, detail="Invalid username or password")
        
    token = create_access_token(req.username.lower(), user["role"], user["customer_id"])
    return {
        "token": token,
        "role": user["role"],
        "customer_id": user["customer_id"],
        "username": req.username.lower()
    }
