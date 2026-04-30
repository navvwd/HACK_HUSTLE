"""Module B — Item Not Received (INR) Abuse Detection."""
import sqlite3
from datetime import datetime

def _hours_gap(ts1: str, ts2: str):
    try:
        d1 = datetime.fromisoformat(ts1)
        d2 = datetime.fromisoformat(ts2)
        return abs((d2 - d1).total_seconds() / 3600)
    except Exception:
        return None

def score(customer_id: str, order_id: str, order: dict, claim_filed_at: str, conn: sqlite3.Connection) -> dict:
    weight = 0.20
    signal_score = 0
    detail_parts = []

    delivery = conn.execute("SELECT * FROM shipment_deliveries WHERE order_id = ? ORDER BY delivered_at DESC LIMIT 1", (order_id,)).fetchone()
    if delivery:
        if delivery["otp_confirmed"]:
            return {"signal": "inr", "verdict": "FAIL", "score": 85, "weight": weight,
                    "detail": "OTP delivery confirmation on record", "raw": {"otp_confirmed": True}}
        if delivery["gps_lat"] and delivery["gps_lng"]:
            signal_score += 30
            detail_parts.append("GPS delivery scan on record")

    delivered_at = order.get("delivered_at", "")
    if delivered_at:
        eng = conn.execute("SELECT COUNT(*) AS c FROM engagement_events WHERE customer_id = ? AND order_id = ? AND occurred_at > ?",
                           (customer_id, order_id, delivered_at)).fetchone()["c"]
        if eng > 0:
            signal_score += 50
            detail_parts.append(f"{eng} post-delivery app events recorded")

    prior_inr = conn.execute(
        "SELECT COUNT(*) AS c FROM return_requests WHERE account_id = ? AND reason = 'not_received' AND timestamp >= datetime('now', '-365 days')",
        (customer_id,)).fetchone()["c"]
    if prior_inr >= 3:
        signal_score += 50
        detail_parts.append(f"{prior_inr} prior INR claims in 12 months")
    elif prior_inr == 2:
        signal_score += 25
    elif prior_inr == 1:
        signal_score += 10

    if delivery and delivery["delivered_at"]:
        gap = _hours_gap(delivery["delivered_at"], claim_filed_at)
        if gap is not None and gap < 2:
            signal_score += 40
            detail_parts.append(f"INR claim filed {gap:.1f}h after delivery")
        elif gap is not None and gap < 12:
            signal_score += 15

    pincode = order.get("pincode", "")
    if pincode:
        pin = conn.execute("SELECT inr_rate FROM pincode_intelligence WHERE pincode = ?", (pincode,)).fetchone()
        if pin and pin["inr_rate"] and pin["inr_rate"] >= 15:
            signal_score += 20
            detail_parts.append(f"High INR-rate pincode ({pin['inr_rate']:.0f}%)")

    signal_score = min(signal_score, 100)
    verdict = "FAIL" if signal_score >= 60 else "WARN" if signal_score >= 25 else "OK"
    return {"signal": "inr", "verdict": verdict, "score": signal_score, "weight": weight,
            "detail": "; ".join(detail_parts) if detail_parts else "No INR indicators",
            "raw": {"prior_inr": prior_inr}}
