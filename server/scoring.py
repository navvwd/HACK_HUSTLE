"""
Fusion Engine v2 — Context-Aware Weighted Scoring + Corroboration Rule.
Combines device, behavioral, graph scorers with new fraud-vector-specific engines.
"""
import asyncio
import json
from datetime import datetime, timedelta
from typing import Optional
from enum import Enum

import database as db

# ─── Fraud Context ─────────────────────────────────────────────────────────────

class FraudContext(str, Enum):
    DEFAULT = "default"
    WARDROBING = "wardrobing"
    DAMAGE_CLAIM = "damage_claim"
    INR_ABUSE = "inr_abuse"
    RING_ORGANISED = "ring_organised"
    FRIENDLY_FRAUD = "friendly_fraud"

HIGH_VALUE_WEARABLE = {"apparel", "fashion", "shoes", "footwear", "jewellery"}
DAMAGE_REASONS = {"damaged", "defective", "broken"}

CONTEXT_WEIGHTS = {
    FraudContext.DEFAULT:        {"device": 0.30, "behavior": 0.25, "graph": 0.25, "wardrobing": 0.10, "friendly_fraud": 0.05, "inr": 0.05},
    FraudContext.WARDROBING:     {"device": 0.10, "behavior": 0.10, "graph": 0.10, "wardrobing": 0.40, "friendly_fraud": 0.15, "inr": 0.15},
    FraudContext.DAMAGE_CLAIM:   {"device": 0.25, "behavior": 0.25, "graph": 0.25, "wardrobing": 0.05, "friendly_fraud": 0.10, "inr": 0.10},
    FraudContext.INR_ABUSE:      {"device": 0.15, "behavior": 0.10, "graph": 0.15, "wardrobing": 0.05, "friendly_fraud": 0.15, "inr": 0.40},
    FraudContext.RING_ORGANISED: {"device": 0.30, "behavior": 0.15, "graph": 0.35, "wardrobing": 0.05, "friendly_fraud": 0.05, "inr": 0.10},
    FraudContext.FRIENDLY_FRAUD: {"device": 0.10, "behavior": 0.10, "graph": 0.15, "wardrobing": 0.05, "friendly_fraud": 0.45, "inr": 0.15},
}

def infer_context(reason_code: str, product_category: str, has_photo: bool, days_held: int, ring_cluster_id=None) -> FraudContext:
    if ring_cluster_id:
        return FraudContext.RING_ORGANISED
    if reason_code == "not_received":
        return FraudContext.INR_ABUSE
    if product_category in HIGH_VALUE_WEARABLE and days_held <= 4:
        return FraudContext.WARDROBING
    if has_photo or reason_code in DAMAGE_REASONS:
        return FraudContext.DAMAGE_CLAIM
    return FraudContext.DEFAULT

# ─── Individual Scorers ────────────────────────────────────────────────────────

def _device_score(account_ids: list[str]) -> tuple[int, str]:
    n = len(account_ids)
    if n <= 1: return 0, "Single account on device"
    if n == 2: return 20, f"2 accounts share this device"
    if n <= 4: return 60, f"{n} accounts — elevated risk"
    if n <= 9: return 80, f"{n} accounts — strong fraud indicator"
    return 90, f"{n}+ accounts — likely fraud ring"

def _behavior_score(account_id: str, session_behavioral: Optional[dict]) -> tuple[int, str]:
    profile = db.get_behavioral_profile(account_id)
    if not profile or not profile.get("baseline"):
        return 0, "First session — baseline established"
    if not session_behavioral:
        return 15, "No behavioral data submitted"
    baseline = profile["baseline"]
    if not isinstance(baseline, dict):
        return 0, "Baseline not yet computed"
    deviation_factors = []
    for k in ["dwell_avg", "flight_avg", "mouse_velocity", "scroll_rhythm"]:
        bv = baseline.get(k, 1)
        sv = session_behavioral.get(k, 1)
        if bv > 0:
            deviation_factors.append(abs(sv - bv) / bv)
    z_score = sum(deviation_factors) / max(len(deviation_factors), 1) * 3
    if z_score < 1: return 0, f"Behavioral {z_score:.2f}σ — normal"
    if z_score < 2: return 30, f"Behavioral {z_score:.2f}σ — mild mismatch"
    if z_score < 3: return 70, f"Behavioral {z_score:.2f}σ — possible takeover"
    return 90, f"Behavioral {z_score:.2f}σ — strong takeover signal"

def _graph_score(account_id: str, fingerprint_hash: str, ip: str) -> tuple[int, str]:
    cluster_accounts = set()
    all_fps = db.get_all_fingerprints()
    for fp in all_fps:
        if account_id in fp["account_ids"] or fp["fingerprint_hash"] == fingerprint_hash:
            cluster_accounts.update(fp["account_ids"])
    ip_subnet = ".".join(ip.split(".")[:3]) if ip and "." in ip else ""
    if ip_subnet:
        for sess in db.get_all_sessions():
            sess_ip = sess.get("ip", "")
            if sess_ip and ".".join(sess_ip.split(".")[:3]) == ip_subnet:
                cluster_accounts.add(sess["account_id"])
    n = len(cluster_accounts)
    if n <= 1: return 0, "Isolated account"
    if n <= 3: return 25, f"Cluster of {n}"
    if n <= 7: return 55, f"Cluster of {n} — suspicious"
    if n <= 14: return 80, f"Cluster of {n} — likely ring"
    return 95, f"Cluster of {n}+ — confirmed ring"

def _apply_decay(score: int, signal_age_days: int) -> int:
    if signal_age_days <= 0: return score
    return int(score * max(0.4, 1.0 - (signal_age_days / 540) * 0.6))

# ─── Corroboration ─────────────────────────────────────────────────────────────

def apply_corroboration(signal_scores: dict[str, int], raw: float) -> float:
    high = [s for s in signal_scores.values() if s >= 60]
    if len(high) >= 3: return min(raw * 1.25, 100.0)
    if len(high) == 2: return min(raw * 1.12, 100.0)
    return raw

# ─── Main Scoring Pipeline ─────────────────────────────────────────────────────

async def run_fraud_scoring(
    account_id: str,
    fingerprint_hash: str,
    ip: str,
    behavioral_data: Optional[dict],
    order: Optional[dict] = None,
    reason_code: str = "",
    signal_age_days: int = 0,
) -> dict:
    fp = db.get_fingerprint(fingerprint_hash)
    account_ids = fp["account_ids"] if fp else [account_id]

    device_raw, device_reason = _device_score(account_ids)
    behavior_raw, behavior_reason = _behavior_score(account_id, behavioral_data)
    graph_raw, graph_reason = _graph_score(account_id, fingerprint_hash, ip)

    device_s = _apply_decay(device_raw, signal_age_days)
    behavior_s = behavior_raw
    graph_s = _apply_decay(graph_raw, signal_age_days)

    # New engines (run if order data available)
    wardrobing_s, wardrobing_reason = 0, "N/A"
    ff_s, ff_reason = 0, "N/A"
    inr_s, inr_reason = 0, "N/A"

    if order:
        conn = db.get_db()
        try:
            import wardrobing as wm
            wr = wm.score(account_id, order, reason_code, conn)
            wardrobing_s, wardrobing_reason = wr["score"], wr["detail"]
        except Exception:
            pass
        try:
            import friendly_fraud as ffm
            fr = ffm.score(account_id, order.get("payment_method", "upi"), conn)
            ff_s, ff_reason = fr["score"], fr["detail"]
        except Exception:
            pass
        if reason_code == "not_received":
            try:
                import inr_detection as inrm
                ir = inrm.score(account_id, order.get("id", ""), order, datetime.now().isoformat(), conn)
                inr_s, inr_reason = ir["score"], ir["detail"]
            except Exception:
                pass
        conn.close()

    # Context-aware weighting
    days_held = 999
    if order and order.get("delivered_at"):
        try:
            days_held = (datetime.now() - datetime.fromisoformat(order["delivered_at"])).days
        except Exception:
            pass
    product_cat = (order.get("product_category", "") if order else "").lower()
    ring_id = None
    if len(account_ids) >= 5:
        ring_id = fingerprint_hash

    context = infer_context(reason_code, product_cat, False, days_held, ring_id)
    weights = CONTEXT_WEIGHTS[context]

    signal_map = {
        "device": device_s, "behavior": behavior_s, "graph": graph_s,
        "wardrobing": wardrobing_s, "friendly_fraud": ff_s, "inr": inr_s,
    }

    raw = sum(signal_map[k] * weights.get(k, 0) for k in signal_map)
    final_raw = apply_corroboration(signal_map, raw)
    combined = round(final_raw, 1)

    scorers_above_40 = sum(1 for v in [device_s, behavior_s, graph_s] if v > 40)
    all_above_60 = all(s > 60 for s in [device_s, behavior_s, graph_s])

    if combined <= 30:
        tier, action = "green", "Auto-approve"
        message = "Your return has been approved. Refund in 3-5 business days."
    elif combined <= 60 or scorers_above_40 < 2:
        tier, action = "amber", "Photo required"
        message = "Please upload a photo of the item to complete your request."
    elif combined <= 80 and scorers_above_40 >= 2:
        tier, action = "orange", "Human review"
        message = "Your return is under review — you'll hear back within 24 hours."
    elif combined > 80 and scorers_above_40 == 3 and all_above_60:
        tier, action = "red", "Additional review"
        message = "This return requires additional review. An appeal link has been sent."
    else:
        tier, action = "orange", "Human review"
        message = "Your return is under review — you'll hear back within 24 hours."

    return {
        "scorers": {
            "device": {"score": device_s, "reason": device_reason},
            "behavior": {"score": behavior_s, "reason": behavior_reason},
            "graph": {"score": graph_s, "reason": graph_reason},
            "wardrobing": {"score": wardrobing_s, "reason": wardrobing_reason},
            "friendly_fraud": {"score": ff_s, "reason": ff_reason},
            "inr": {"score": inr_s, "reason": inr_reason},
        },
        "combined_score": combined,
        "scorers_above_40": scorers_above_40,
        "corroboration_rule": scorers_above_40 >= 2,
        "fraud_context": context.value,
        "risk_tier": tier,
        "action": action,
        "customer_message": message,
        "decay_applied": signal_age_days > 0,
    }
