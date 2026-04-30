"""Configuration — environment variables and constants."""
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "returnguard.db")
UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "uploads")

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")


os.makedirs(UPLOAD_DIR, exist_ok=True)
