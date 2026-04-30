"""Module E — Friendly Fraud (Chargeback Abuse) Detection."""
import sqlite3
from datetime import datetime

PAYMENT_METHOD_RISK = {
    "cod": 0, "upi": 10, "netbanking": 15, "debit_card": 20,
    "credit_card": 40, "bnpl": 60, "wallet": 20,
}

def get_risk_tier(chargeback_count: int) -> str:
    if chargeback_count == 0: return "LOW"
    if chargeback_count == 1: return "MEDIUM"
    if chargeback_count <= 3: return "HIGH"
    return "BLOCKED"

def score(customer_id: str, payment_method: str, conn: sqlite3.Connection) -> dict:
    weight = 0.15
    row = conn.execute("SELECT * FROM payment_risk_profiles WHERE customer_id = ?", (customer_id,)).fetchone()
    chargeback_count = row["chargeback_count"] if row else 0
    claim_count_180d = row["claim_count_180d"] if row else 0
    risk_tier = row["risk_tier"] if row else "LOW"

    signal_score = 0
    detail_parts = []

    if chargeback_count >= 3:
        signal_score += 80
        detail_parts.append(f"{chargeback_count} prior chargebacks")
    elif chargeback_count == 2:
        signal_score += 50
        detail_parts.append(f"{chargeback_count} prior chargebacks")
    elif chargeback_count == 1:
        signal_score += 25
        detail_parts.append("1 prior chargeback")

    pm_risk = PAYMENT_METHOD_RISK.get(payment_method.lower(), 20)
    if pm_risk >= 40:
        signal_score += pm_risk // 2
        detail_parts.append(f"High-risk payment: {payment_method}")

    if claim_count_180d >= 5:
        signal_score += 30
        detail_parts.append(f"{claim_count_180d} claims in 180 days")

    if risk_tier == "BLOCKED":
        return {"signal": "friendly_fraud", "verdict": "FAIL", "score": 95, "weight": weight,
                "detail": f"BLOCKED tier — {chargeback_count} chargebacks",
                "raw": {"risk_tier": risk_tier, "chargeback_count": chargeback_count}}

    signal_score = min(signal_score, 100)
    verdict = "FAIL" if signal_score >= 60 else "WARN" if signal_score >= 25 else "OK"
    return {"signal": "friendly_fraud", "verdict": verdict, "score": signal_score, "weight": weight,
            "detail": "; ".join(detail_parts) if detail_parts else "No chargeback history",
            "raw": {"chargeback_count": chargeback_count, "risk_tier": risk_tier, "pm_risk": pm_risk}}

def record_chargeback(customer_id, order_id, amount_inr, payment_method, reason, conn):
    conn.execute(
        "INSERT INTO chargeback_events (customer_id, order_id, payment_method, amount_inr, chargeback_reason, filed_at) "
        "VALUES (?,?,?,?,?,datetime('now'))", (customer_id, order_id, payment_method, amount_inr, reason))
    existing = conn.execute("SELECT chargeback_count FROM payment_risk_profiles WHERE customer_id = ?", (customer_id,)).fetchone()
    new_count = (existing["chargeback_count"] + 1) if existing else 1
    new_tier = get_risk_tier(new_count)
    conn.execute(
        "INSERT INTO payment_risk_profiles (customer_id, chargeback_count, risk_tier, last_chargeback_at, largest_chargeback_inr) "
        "VALUES (?,?,?,datetime('now'),?) ON CONFLICT(customer_id) DO UPDATE SET "
        "chargeback_count = chargeback_count + 1, risk_tier = excluded.risk_tier, "
        "last_chargeback_at = datetime('now'), largest_chargeback_inr = MAX(largest_chargeback_inr, excluded.largest_chargeback_inr)",
        (customer_id, new_count, new_tier, amount_inr))
    conn.commit()
