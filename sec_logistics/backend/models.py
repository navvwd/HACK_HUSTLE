from sqlalchemy import Column, String, Integer, Float, DateTime
from database import Base
import datetime

class UserProfile(Base):
    __tablename__ = "profiles"
    
    id = Column(String, primary_key=True, index=True) # Matches Supabase auth.users.id
    email = Column(String, unique=True, index=True)
    name = Column(String)
    role = Column(String, default="user") # 'user', 'seller', 'admin'
    trust_score = Column(Float, default=100.0) # For buyers
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
