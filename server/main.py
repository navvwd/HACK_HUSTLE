from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Header
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from supabase import create_client
from dotenv import load_dotenv
from pydantic import BaseModel
from typing import Optional
import os

# 1. Load env
load_dotenv()

# 2. Read env variables
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

# 3. Sanity check (STEP 5)
print("URL:", SUPABASE_URL)
print("KEY:", SUPABASE_KEY[:10] if SUPABASE_KEY else None)

# 4. Create app
app = FastAPI()

# 5. Add CORS (you already struggled here)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 6. Create Supabase client (STEP 6)
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
# ─────────────────────────────────────────
# TEST ROUTE
# ─────────────────────────────────────────
@app.get("/test-supabase")
def test_supabase():
    res = supabase.table("profiles").select("*").execute()
    return {"status": "connected", "data": res.data}


# ─────────────────────────────────────────
# ANALYTICS ROUTES
# ─────────────────────────────────────────
@app.get("/api/analytics/summary")
def analytics_summary():
    return {"message": "summary working"}


@app.get("/api/analytics/chargebacks")
def chargebacks():
    return {"message": "chargebacks working"}


@app.get("/api/analytics/inr")
def inr():
    return {"message": "inr working"}


@app.get("/api/analytics/wardrobing")
def wardrobing():
    return {"message": "wardrobing working"}


@app.get("/api/analytics/fingerprints")
def fingerprints():
    return {"message": "fingerprints working"}


# ─────────────────────────────────────────
# MODELS
# ─────────────────────────────────────────
class ClaimSubmit(BaseModel):
    order_id: str
    account_id: str
    reason: str
    description: Optional[str] = ""
    fingerprint_hash: Optional[str] = ""
    ip_address: Optional[str] = ""
    dwell_avg: Optional[float] = 0
    flight_avg: Optional[float] = 0
    mouse_velocity: Optional[float] = 0
    scroll_rhythm: Optional[float] = 0

# ─────────────────────────────────────────
# RETURNS
# ─────────────────────────────────────────
@app.post("/api/returns/submit")
def submit_return(data: dict):
    import uuid
    required_fields = [
        "order_id", "account_id", "reason", "description",
        "fingerprint_hash", "ip_address", "dwell_avg",
        "flight_time", "mouse_velocity", "scroll_rhythm"
    ]

    account_id = data.get("account_id", "")

    # ── Demo account overrides ────────────────────────────────────────────────
    # Hardcoded prior return counts for demo scenarios.
    # Demo accounts are NOT persisted to Supabase so they stay deterministic
    # across repeated runs and never pollute real fraud data.
    DEMO_ACCOUNT_OVERRIDES = {
        "cust_maya_demo":   0,   # Legitimate — no prior history
        "cust_priya_001":   3,   # Serial returner — 3 prior returns on record
        "acct_ring_001":    0,   # Ring fraud uses fingerprint signals, not return count
        "cust_wardrobing":  0,   # Wardrobing uses timing/NLP signals
        "cust_ff_001":      0,   # Friendly fraud uses INR + account pattern signals
        "cust_charlie_sus": 0,   # Suspicious behavior uses telemetry signals
        "cust_bob_vpn":     0,   # VPN user — prior count not the fraud signal here
    }

    is_demo = account_id in DEMO_ACCOUNT_OVERRIDES

    if is_demo:
        # Use hardcoded count, skip DB read and write entirely
        prior_return_count = DEMO_ACCOUNT_OVERRIDES[account_id]
    else:
        # Real user: query live history BEFORE inserting current claim
        prior_return_count = 0
        try:
            history_res = (
                supabase.table("claims")
                .select("order_id")
                .eq("account_id", account_id)
                .execute()
            )
            prior_return_count = len(history_res.data) if history_res.data else 0
        except Exception as e:
            print(f"Could not fetch return history for {account_id}: {e}")

        # Persist real claim to Supabase
        clean_data = {k: data.get(k) for k in required_fields}
        try:
            supabase.table("claims").insert(clean_data).execute()
        except Exception as e:
            print("Supabase insert error:", e)

    # ── Score with prior_return_count injected ────────────────────────────────
    from behavior_engine import analyze_behavior_telemetry
    scoring_payload = dict(data)
    scoring_payload["prior_return_count"] = prior_return_count
    scoring_payload["is_demo"] = is_demo   # signal to bypass Gemini for demo accounts
    behavior_analysis = analyze_behavior_telemetry(scoring_payload)
    req_id = "REQ-" + str(uuid.uuid4())[:8]

    return {
        "risk_tier": behavior_analysis["risk_level"].lower(),
        "request_id": req_id,
        "combined_score": behavior_analysis["risk_score"],
        "customer_message": (
            "Your return has been approved."
            if behavior_analysis["recommended_action"] == "ALLOW"
            else "This return requires additional review."
        ),
        "scorers_above_40": len([
            x for x in behavior_analysis["fraud_indicators"]
            if x["severity"] in ["medium", "high"]
        ]),
        "scorers": {
            "behavior_engine": {
                "score": behavior_analysis["risk_score"],
                "reason": behavior_analysis["classification"],
                "details": behavior_analysis
            }
        }
    }



@app.get("/api/returns/history")
def get_returns():
    res = supabase.table("claims").select("*").execute()
    return res.data


# ─────────────────────────────────────────
# REVIEW
# ─────────────────────────────────────────
@app.get("/api/review/queue")
def review_queue():
    res = supabase.table("decisions")\
        .select("*")\
        .eq("action", "REQUIRES_REVIEW")\
        .execute()
    return res.data


@app.get("/api/review/stats")
def review_stats():
    res = supabase.table("decisions").select("*").execute()
    data = res.data

    return {
        "total": len(data),
        "pending": len([d for d in data if d["action"] == "REQUIRES_REVIEW"]),
        "approved": len([d for d in data if d["action"] == "APPROVED"]),
        "denied": len([d for d in data if d["action"] == "DENIED"]),
    }


# ─────────────────────────────────────────
# AI MOCKS
# ─────────────────────────────────────────
from damage_detection import analyze_damage_claim

@app.post("/api/returns/analyze-damage")
async def analyze_damage(
    order_id: str = Form(...),
    image: UploadFile = File(...),
    capture_method: str = Form(default="manual_upload")
):
    image_bytes = await image.read()
    return analyze_damage_claim(order_id, image_bytes, capture_method)


from receipt_detection import analyze_receipt_pipeline

@app.post("/api/returns/analyze-receipt")
async def analyze_receipt(
    order_id: str = Form(...),
    amount: str = Form(...),
    item_name: str = Form(...),
    receipt_date: Optional[str] = Form(None),
    file: UploadFile = File(...)
):
    file_bytes = await file.read()
    filename = file.filename
    return analyze_receipt_pipeline(order_id, amount, item_name, file_bytes, filename, supabase, receipt_date)

# ==========================================
# PHASE 4: AI CHATBOT ENDPOINTS
# ==========================================
from chat_engine import start_session, send_message as chat_send_message
from pydantic import BaseModel as PBM

class ChatStartRequest(PBM):
    order_id: str
    category: str       # e.g. "electronics", "apparel"
    reason: str         # e.g. "damaged", "defective", "not_received"
    product_name: Optional[str] = ""

class ChatMessageRequest(PBM):
    session_id: str
    message: str

@app.post("/api/v1/chat/start")
def chat_start(req: ChatStartRequest):
    """Start a new AI chat session for a return claim."""
    return start_session(req.order_id, req.category, req.reason, req.product_name or "")

@app.post("/api/v1/chat/message")
def chat_message(req: ChatMessageRequest):
    """Send a message in an existing chat session."""
    return chat_send_message(req.session_id, req.message)

# ==========================================
# FRAUD INTELLIGENCE ENGINE
# ==========================================
from fraud_intelligence import run_fraud_intelligence

@app.post("/api/v1/fraud/intelligence")
def fraud_intelligence(payload: dict):
    """
    Multi-audience Fraud Intelligence Engine.
    Returns internal_fraud_summary, seller_view, and judge_evidence_view.
    """
    return run_fraud_intelligence(payload)

# ==========================================
# PHASE 1: AUTHENTICATION ENDPOINTS
# ==========================================

from auth import LoginRequest, authenticate_user, verify_token

@app.post("/api/v1/auth/login")
def login(req: LoginRequest):
    """Authenticate user and return JWT token."""
    return authenticate_user(req)

@app.get("/api/v1/auth/me")
def get_me(authorization: str = Header(None)):
    """Verify JWT and return user payload."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")
    token = authorization.split(" ")[1]
    return verify_token(token)

# ==========================================
# PHASE 2: QR & VIDEO RECORDING ENDPOINTS
# ==========================================

from qr_generator import create_qr_for_order, validate_qr_token

@app.post("/api/v1/orders/{order_id}/qr")
def generate_qr(order_id: str):
    """Generate a QR code for a specific order."""
    return create_qr_for_order(order_id)

@app.get("/api/v1/qr/validate")
def validate_qr(order_id: str, token: str):
    """Validate that the token belongs to the given order_id."""
    if validate_qr_token(order_id, token):
        return {"valid": True, "order_id": order_id}
    else:
        raise HTTPException(status_code=403, detail="Invalid or expired QR token")

@app.post("/api/v1/claims/video")
async def upload_video(order_id: str = Form(...), video: UploadFile = File(...)):
    """Accepts a WebM video recording and saves it locally."""
    # Ensure videos directory exists
    os.makedirs("videos", exist_ok=True)
    
    file_ext = video.filename.split(".")[-1] if "." in video.filename else "webm"
    file_path = f"videos/{order_id}_claim.{file_ext}"
    
    file_bytes = await video.read()
    with open(file_path, "wb") as f:
        f.write(file_bytes)
        
    return {
        "status": "success", 
        "message": "Video uploaded successfully", 
        "video_path": file_path,
        "size_bytes": len(file_bytes)
    }

@app.get("/api/v1/claims/{order_id}/video")
def get_video(order_id: str):
    """Stream the recorded video."""
    file_path = f"videos/{order_id}_claim.webm"
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Video not found")
        
    def iterfile():
        with open(file_path, mode="rb") as file_like:
            yield from file_like

    return StreamingResponse(iterfile(), media_type="video/webm")

# ==========================================
# LIVE CAPTURE — DAMAGE PHOTO PIPELINE
# ==========================================

import json as json_lib
import datetime

@app.post("/api/damage/store-capture")
async def store_live_capture(order_id: str = Form(...), image: UploadFile = File(...)):
    """Receives live damage photo from customer and stores it for seller review."""
    os.makedirs("live_captures", exist_ok=True)
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    file_path = f"live_captures/{order_id}_{timestamp}.jpg"
    
    img_bytes = await image.read()
    with open(file_path, "wb") as f:
        f.write(img_bytes)
    
    # Append metadata record
    meta_path = "live_captures/index.json"
    records = []
    if os.path.exists(meta_path):
        with open(meta_path, "r") as f:
            records = json_lib.load(f)
    records.insert(0, {
        "order_id": order_id,
        "file_path": file_path,
        "captured_at": datetime.datetime.now().isoformat(),
        "status": "pending_review"
    })
    with open(meta_path, "w") as f:
        json_lib.dump(records[:50], f)  # keep last 50
    
    return {"status": "stored", "file_path": file_path, "order_id": order_id}

@app.get("/api/damage/live-captures")
def get_live_captures():
    """Returns list of all customer-submitted live damage photos for seller review."""
    meta_path = "live_captures/index.json"
    if not os.path.exists(meta_path):
        return {"captures": []}
    with open(meta_path, "r") as f:
        records = json_lib.load(f)
    return {"captures": records}

@app.get("/api/damage/live-captures/{order_id}/image")
def serve_capture_image(order_id: str):
    """Stream a specific capture image for display on seller dashboard."""
    meta_path = "live_captures/index.json"
    if not os.path.exists(meta_path):
        raise HTTPException(status_code=404, detail="No captures found")
    with open(meta_path, "r") as f:
        records = json_lib.load(f)
    match = next((r for r in records if r["order_id"] == order_id), None)
    if not match or not os.path.exists(match["file_path"]):
        raise HTTPException(status_code=404, detail="Image not found")
    
    def iterfile():
        with open(match["file_path"], "rb") as file_like:
            yield from file_like
    return StreamingResponse(iterfile(), media_type="image/jpeg")

@app.get("/api/analytics/graph")
def analytics_graph():
    # temporary mock data (so frontend works)
    return {
        "labels": ["Jan", "Feb", "Mar"],
        "values": [10, 20, 15]
    }

# ─────────────────────────────────────────
# DEMO SCENARIOS
# ─────────────────────────────────────────
@app.get("/api/demo/scenarios")
async def get_demo_scenarios():
    return {"scenarios": [
        {"key": "maya_legit", "label": "Maya — Legitimate Return", "orderId": "ORD-10000",
         "accountId": "cust_maya_demo", "reason": "defective", "description": "Earbuds stopped charging after 3 days.",
         "expected": "GREEN", "color": "green"},
        {"key": "priya_fraud", "label": "Priya — Serial Returner", "orderId": "ORD-10004",
         "accountId": "cust_priya_001", "reason": "damaged", "description": "Product arrived broken.",
         "expected": "ORANGE", "color": "orange"},
        {"key": "ring_attack", "label": "Ring — Organised Fraud", "orderId": "ORD-10001",
         "accountId": "acct_ring_001", "reason": "damaged", "description": "Not working properly.",
         "expected": "RED", "color": "red", "fingerprint": "fp_RING_DEVICE_X9K2"},
        {"key": "wardrobing", "label": "Wardrobing — Dress Returned Next Day", "orderId": "ord_wardrobing_001",
         "accountId": "cust_wardrobing", "reason": "damaged", "description": "Doesn't fit as expected.",
         "expected": "AMBER", "color": "amber"},
        {"key": "friendly_fraud", "label": "Friendly Fraud — 3 Chargebacks", "orderId": "ord_friendly_001",
         "accountId": "cust_ff_001", "reason": "not_received", "description": "Never received this order.",
         "expected": "RED", "color": "red"},
    ]}