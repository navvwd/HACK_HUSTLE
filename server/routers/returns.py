"""Returns router — handles return submission, damage/receipt analysis."""
import uuid
import json
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, File, UploadFile, Form, HTTPException
from pydantic import BaseModel

import scoring
import damage_detection
import receipt_detection
import database as db

router = APIRouter()


class ReturnSubmission(BaseModel):
    order_id: str
    account_id: str
    reason: str
    description: str = ""
    fingerprint_hash: str = ""
    ip_address: str = ""
    dwell_avg: float = 0
    flight_avg: float = 0
    mouse_velocity: float = 0
    scroll_rhythm: float = 0


@router.post("/submit")
async def submit_return(submission: ReturnSubmission):
    request_id = f"RET-{uuid.uuid4().hex[:8].upper()}"

    if submission.fingerprint_hash:
        db.upsert_fingerprint(submission.fingerprint_hash, submission.account_id)

    behavioral = {
        "dwell_avg": submission.dwell_avg, "flight_avg": submission.flight_avg,
        "mouse_velocity": submission.mouse_velocity, "scroll_rhythm": submission.scroll_rhythm,
    }

    order = db.get_order(submission.order_id)

    result = await scoring.run_fraud_scoring(
        account_id=submission.account_id,
        fingerprint_hash=submission.fingerprint_hash or f"fp_{submission.account_id}",
        ip=submission.ip_address or "0.0.0.0",
        behavioral_data=behavioral if any(behavioral.values()) else None,
        order=order,
        reason_code=submission.reason,
    )

    if any(behavioral.values()):
        db.update_behavioral_profile(submission.account_id, behavioral)

    db.add_session({
        "session_id": request_id, "account_id": submission.account_id,
        "fingerprint_hash": submission.fingerprint_hash, "ip": submission.ip_address,
        "order_id": submission.order_id, "risk_tier": result["risk_tier"],
    })

    # Record wardrobing history
    if order:
        try:
            import wardrobing as wm
            we = next((v for k, v in result["scorers"].items() if k == "wardrobing"), None)
            ws = we["score"] if we else 0
            conn = db.get_db()
            wm.record_return_history(submission.account_id, submission.order_id, request_id, order, ws, conn)
            conn.commit()
            conn.close()
        except Exception:
            pass

    return_record = {
        "request_id": request_id, "order_id": submission.order_id,
        "account_id": submission.account_id, "reason": submission.reason,
        "description": submission.description, "combined_score": result["combined_score"],
        "risk_tier": result["risk_tier"], "scorers": result["scorers"],
        "action": result["action"], "customer_message": result["customer_message"],
        "corroboration_met": result["corroboration_rule"],
        "fraud_context": result.get("fraud_context", "default"),
        "timestamp": datetime.now().isoformat(),
    }
    db.add_return_request(return_record)

    if result["risk_tier"] in ("orange", "red"):
        db.add_to_review_queue({**return_record, "status": "pending"})

    return {
        "request_id": request_id, "risk_tier": result["risk_tier"],
        "customer_message": result["customer_message"],
        "combined_score": result["combined_score"], "scorers": result["scorers"],
        "fraud_context": result.get("fraud_context", "default"),
        "timestamp": datetime.now().isoformat(),
    }


@router.post("/analyze-damage")
async def analyze_damage_image(
    order_id: str = Form(...), capture_timestamp: Optional[str] = Form(None),
    capture_lat: Optional[float] = Form(None), capture_lng: Optional[float] = Form(None),
    image: UploadFile = File(...),
):
    image_bytes = await image.read()
    if not image_bytes:
        raise HTTPException(400, "Empty image file")
    score, evidence = await damage_detection.score_damage_claim(
        image_bytes, order_id, capture_timestamp, capture_lat, capture_lng)
    tier = "green" if score <= 30 else "amber" if score <= 60 else "orange" if score <= 80 else "red"
    return {"score": score, "tier": tier, "evidence": evidence,
            "layers_fired": sum(1 for e in evidence if e["score"] > 0), "total_layers": len(evidence)}


@router.post("/analyze-receipt")
async def analyze_receipt(
    order_id: str = Form(...), amount: float = Form(...),
    item_name: str = Form(""), receipt_date: Optional[str] = Form(None),
    file: UploadFile = File(...),
):
    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(400, "Empty file")
    source = "pdf" if file.filename and file.filename.lower().endswith(".pdf") else "image"
    parsed_date = None
    if receipt_date:
        try:
            parsed_date = datetime.strptime(receipt_date, "%Y-%m-%d").date()
        except ValueError:
            pass
    extracted = receipt_detection.ExtractedReceiptData(
        order_id=order_id, amount=amount, date=parsed_date, item_name=item_name, source_file=source)
    score, evidence = receipt_detection.score_receipt_manipulation(file_bytes, extracted)
    tier = "green" if score <= 30 else "amber" if score <= 60 else "orange" if score <= 80 else "red"
    return {"score": score, "tier": tier, "evidence": evidence,
            "methods_fired": sum(1 for e in evidence if e["score"] > 0), "total_methods": len(evidence)}


@router.get("/history")
async def get_return_history():
    return {"returns": db.get_all_returns()}


@router.get("/{request_id}")
async def get_return_detail(request_id: str):
    r = db.get_return_by_id(request_id)
    if not r:
        raise HTTPException(404, "Return request not found")
    return r
