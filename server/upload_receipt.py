import os
from supabase import create_client
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

file_path = r"C:\Users\DELL\Desktop\sav\Receipt1.pdf"
bucket_name = "receipts"

# Ensure the file exists
if not os.path.exists(file_path):
    print("File not found:", file_path)
    exit(1)

with open(file_path, "rb") as f:
    file_bytes = f.read()

# Define storage path
storage_path = "ORD-10000/Receipt1.pdf"

print(f"Uploading {file_path} to Supabase bucket '{bucket_name}' at path '{storage_path}'...")

try:
    # Attempt to upload
    res = supabase.storage.from_(bucket_name).upload(
        file=file_bytes,
        path=storage_path,
        file_options={"content-type": "application/pdf"}
    )
    print("Upload successful!")
except Exception as e:
    print(f"Upload error: {e}")
    if "Bucket not found" in str(e) or "The resource was not found" in str(e):
        print("\n*** IMPORTANT: You need to create a Storage Bucket named 'receipts' in your Supabase dashboard and make it public! ***")

# Now insert into the orders table (since this is the order DB reference)
print("\nEnsuring order ORD-10000 exists in the 'orders' table...")
try:
    supabase.table("orders").upsert({
        "id": "ORD-10000",
        "total_amount": 74999.00,
        "item_name": "Samsung Galaxy S23"
    }).execute()
    print("Order ORD-10000 inserted/verified in the database.")
except Exception as e:
    print(f"DB Error: {e}")
