from supabase import create_client
import os

url = os.getenv("SUPABASE_URL")
key = os.getenv("SUPABASE_ANON_KEY")

supabase = create_client(url, key)

def get_profiles():
    res = supabase.table("profiles").select("*").execute()
    return res.data
    
@app.get("/test-supabase")
def test():
    return test()