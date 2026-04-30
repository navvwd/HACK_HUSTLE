"""Module F — Wardrobing Detection."""
import json
import sqlite3
from datetime import datetime

WARDROBING_CATEGORIES = {"apparel", "shoes", "jewellery", "fashion", "accessories", "footwear"}

def _get_days_held(order: dict) -> int:
    delivered = order.get("delivered_at")
    if not delivered:
        return 999
    try:
        d = datetime.fromisoformat(delivered)
        return max(0, (datetime.now() - d).days)
    except ValueError:
        return 999

def score(customer_id: str, order: dict, reason_code: str, conn: sqlite3.Connection) -> dict:
    weight = 0.15
    category = (order.get("product_category") or "").lower()
    value = float(order.get("value_inr") or 0)
    days_held = _get_days_held(order)

    baseline = conn.execute("SELECT * FROM category_return_baselines WHERE category = ?", (category,)).fetchone()
    signal_score = 0
    detail_parts = []

    if baseline:
        threshold = baseline["restocking_threshold_days"]
        if days_held <= threshold:
            signal_score += 60 if category in WARDROBING_CATEGORIES else 30
            detail_parts.append(f"Returned {days_held}d after delivery (threshold: {threshold}d)")

    if baseline and category in WARDROBING_CATEGORIES:
        hv = baseline["high_value_threshold_inr"]
        if value >= hv and days_held <= 5:
            signal_score += 25
            detail_parts.append(f"High-value {category} (₹{value:.0f}) returned in {days_held}d")

    if baseline:
        peak_months = json.loads(baseline["wardrobing_peak_months"] or "[]")
        current_month = str(datetime.now().month)
        if current_month in peak_months and category in WARDROBING_CATEGORIES:
            signal_score += 15
            detail_parts.append(f"Peak wardrobing month for {category}")

    prior = conn.execute(
        "SELECT COUNT(*) AS c FROM return_history WHERE customer_id = ? AND product_category = ? AND filed_at >= datetime('now', '-180 days')",
        (customer_id, category)).fetchone()["c"]
    if prior >= 2:
        signal_score += 30
        detail_parts.append(f"{prior + 1} returns in same category in 180 days")
    elif prior == 1:
        signal_score += 15

    signal_score = min(signal_score, 100)
    verdict = "FAIL" if signal_score >= 60 else "WARN" if signal_score >= 25 else "OK"
    return {"signal": "wardrobing", "verdict": verdict, "score": signal_score, "weight": weight,
            "detail": "; ".join(detail_parts) if detail_parts else "No wardrobing indicators",
            "raw": {"days_held": days_held, "category": category, "value_inr": value, "prior_same_cat": prior}}

def record_return_history(customer_id, order_id, claim_id, order, wardrobing_score, conn):
    conn.execute(
        "INSERT INTO return_history (customer_id, order_id, claim_id, product_category, order_value_inr, days_held, wardrobing_score) "
        "VALUES (?,?,?,?,?,?,?)",
        (customer_id, order_id, claim_id, order.get("product_category", ""), order.get("value_inr", 0),
         _get_days_held(order), wardrobing_score))
