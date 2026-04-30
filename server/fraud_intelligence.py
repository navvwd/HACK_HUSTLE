"""
Fraud Intelligence and Explainability Engine
Multi-audience output: Internal Fraud Team | Seller | Judge/Legal
Uses Gemini 2.5 Flash with a strict system prompt.
"""
import os
import json
from dotenv import load_dotenv
from llm_service import LLMService

load_dotenv()

SYSTEM_PROMPT = """
You are a Fraud Intelligence and Explainability Engine for an e-commerce platform.

You analyze behavioral signals, transaction history, device/IP relationships, and return patterns to detect fraud, wardrobing, and coordinated abuse.

You must generate outputs for THREE different audiences:
1. Internal Fraud Team (full intelligence)
2. Seller (high-level business abstraction)
3. Legal/Judge (evidence-based explanation)

You must NEVER expose raw sensitive identifiers (device IDs, IPs, graph structure) to sellers or customers.

STEP 1: INTERNAL FRAUD ANALYSIS — graph clustering, behavioral anomaly, temporal analysis, similarity detection across claims.

Detect: Fraud rings (multi-account coordination), Wardrobing (temporary usage before return), Return abuse patterns (INR, fake damage, receipt manipulation).

STEP 2: FRAUD CLUSTER LOGIC (INTERNAL ONLY) — shared devices/IPs/addresses/behavioral similarity. DO NOT expose raw structure outside internal layer.

STEP 3: Output STRICT JSON matching this schema exactly:

{
  "internal_fraud_summary": {
    "risk_score": number,
    "fraud_types": ["WARDROBING" | "INR_ABUSE" | "RETURN_RING" | "NORMAL"],
    "cluster_detected": true | false,
    "cluster_risk_score": number,
    "key_internal_signals": ["short explanation of pattern (no raw IDs)"]
  },
  "seller_view": {
    "order_risk_level": "LOW | MEDIUM | HIGH",
    "decision": "APPROVE | REVIEW | HOLD",
    "reason_codes": ["Human readable reason 1", "reason 2"],
    "message_to_seller": "Human-readable explanation without technical details"
  },
  "judge_evidence_view": {
    "case_summary": "Neutral explanation of behavior pattern",
    "timeline": ["Event 1 description", "Event 2 description"],
    "evidence_points": ["Evidence point 1", "Evidence point 2"],
    "conclusion": "Behavior consistent with potential return abuse pattern"
  }
}

RULES:
- NEVER expose device IDs, IP addresses, or graph topology outside internal_fraud_summary
- Seller must only see business-level abstraction
- Judge view must be neutral, factual, and explainable
- Avoid legal accusations like "fraud committed"
- Use terms like "pattern consistent with" instead of absolute claims
- If confidence is low, reduce severity instead of guessing
- Graph reasoning must remain internal-only
"""

def build_heuristic_result(data: dict) -> dict:
    """Offline heuristic fallback when Gemini is unavailable.

    Supports two payload formats:
      1. Legacy nested:  { return_claims: [...], order_history: [...], device_links: [...], behavioral_signals: {...} }
      2. Scenario flat:  { scenario_type: "WARDROBING_CASE", data: { return_time_days, category, behavior, ... } }
    """
    scenario_type = data.get("scenario_type", "")
    inner         = data.get("data", {})

    # Legacy fields (may be empty for scenario-type payloads)
    returns      = data.get("return_claims", [])
    order_hist   = data.get("order_history", [])
    device_links = data.get("device_links", [])
    behavioral   = data.get("behavioral_signals", {})

    risk = 0
    fraud_types      = []
    internal_signals = []

    # ── Scenario-type fast-path scoring ─────────────────────────────────────
    if scenario_type == "WARDROBING_CASE":
        return_days  = inner.get("return_time_days", 999)
        category     = inner.get("category", "")
        behavior_tag = inner.get("behavior", "")

        if return_days <= 3:
            risk += 45
            fraud_types.append("WARDROBING")
            internal_signals.append(
                f"Item returned in {return_days} day(s) — well within wardrobing window"
            )
        elif return_days <= 7:
            risk += 25
            fraud_types.append("WARDROBING")
            internal_signals.append(
                f"Item returned in {return_days} days — borderline return timeline"
            )

        if "apparel" in category.lower() or "fashion" in category.lower():
            risk += 15
            internal_signals.append(
                "High-risk category (apparel/fashion) — elevated wardrobing incidence"
            )

        if "high usage" in behavior_tag.lower():
            risk += 20
            internal_signals.append(
                "Customer behavior indicates high product usage prior to return"
            )

        if inner.get("device_reuse"):
            risk += 15
            fraud_types.append("RETURN_RING")
            device_links = ["linked_device"]
            internal_signals.append("Device reused across multiple return sessions")

        if inner.get("ip_reuse"):
            risk += 10
            internal_signals.append("IP address shared with other return claimants")

    elif scenario_type == "INR_CASE":
        inr_count = inner.get("inr_count", 1)
        if inr_count >= 2:
            risk += 35
            fraud_types.append("INR_ABUSE")
            internal_signals.append(
                f"{inr_count} 'not received' claims — elevated dispute abuse probability"
            )

    elif scenario_type == "FRAUD_RING_CASE":
        linked = inner.get("linked_accounts", 0)
        if linked >= 2:
            risk += 40
            fraud_types.append("RETURN_RING")
            device_links = ["x"] * linked
            internal_signals.append(
                f"Account linked to {linked} other claimants — cluster risk detected"
            )

    # ── Legacy nested-format scoring ────────────────────────────────────────
    else:
        if len(returns) >= 2:
            risk += 30
            fraud_types.append("WARDROBING")
            internal_signals.append(
                f"{len(returns)} returns detected — potential short-duration usage pattern"
            )

        inr_claims = [r for r in returns if "not" in str(r.get("reason", "")).lower()]
        if len(inr_claims) >= 2:
            risk += 35
            fraud_types.append("INR_ABUSE")
            internal_signals.append(
                f"{len(inr_claims)} 'not received' claims — elevated probability of delivery dispute abuse"
            )

        if len(device_links) > 2:
            risk += 25
            fraud_types.append("RETURN_RING")
            internal_signals.append(
                f"Account connected to {len(device_links)} shared device links — cluster risk elevated"
            )

        if behavioral.get("mouse_velocity", 0) > 800 or behavioral.get("dwell_avg", 100) < 30:
            risk += 10
            internal_signals.append("Session telemetry shows bot-like interaction patterns")

    # ── Shared final scoring ─────────────────────────────────────────────────
    cluster_detected = len(device_links) > 0
    if not fraud_types:
        fraud_types = ["NORMAL"]

    risk     = min(risk, 100)
    level    = "HIGH" if risk >= 65 else "MEDIUM" if risk >= 35 else "LOW"
    decision = "HOLD" if risk >= 65 else "REVIEW"  if risk >= 35 else "APPROVE"

    # Build readable timeline entries
    if inner:
        timeline_entry_1 = f"Return filed: {inner.get('return_time_days', 'N/A')} day(s) after purchase"
        timeline_entry_2 = f"Category: {inner.get('category', 'unspecified')}"
    else:
        timeline_entry_1 = f"Order placed: {order_hist[0].get('order_id', 'N/A')}" if order_hist else "Order history unavailable"
        timeline_entry_2 = f"Return claim filed: {returns[0].get('reason', 'unspecified reason')}" if returns else "No return claim found"

    return {
        "internal_fraud_summary": {
            "risk_score": risk,
            "fraud_types": fraud_types,
            "cluster_detected": cluster_detected,
            "cluster_risk_score": 70 if cluster_detected else 0,
            "key_internal_signals": internal_signals or ["No significant anomaly signals detected."]
        },
        "seller_view": {
            "order_risk_level": level,
            "decision": decision,
            "reason_codes": [
                f"Fraud pattern detected: {', '.join(fraud_types)}" if fraud_types != ["NORMAL"] else "No fraud pattern detected",
                f"Return timeline: {inner.get('return_time_days', len(returns))} day(s)" if inner else f"{len(returns)} return(s) on record",
                "Cluster or device reuse detected" if cluster_detected else "Account appears isolated"
            ],
            "message_to_seller": (
                f"This return request has been flagged as {level} risk "
                f"(scenario: {scenario_type or 'legacy'} — {len(internal_signals)} signal(s) detected). "
                f"We recommend {'manual review before processing' if decision != 'APPROVE' else 'proceeding with the return'}."
            )
        },
        "judge_evidence_view": {
            "case_summary": (
                f"Scenario '{scenario_type or 'standard'}' analyzed. Risk score: {risk}/100."
            ),
            "timeline": [timeline_entry_1, timeline_entry_2],
            "evidence_points": internal_signals or ["No behavioral evidence collected."],
            "conclusion": (
                f"Behavioral pattern is {'consistent with potential return abuse' if risk >= 50 else 'within normal expected parameters'}."
            )
        }
    }



def run_fraud_intelligence(payload: dict) -> dict:
    """
    Main entry point.
    Runs the multi-audience Fraud Intelligence Engine.
    """
    fallback = build_heuristic_result(payload)
    prompt = f"Analyze this fraud intelligence data:\n{json.dumps(payload, indent=2)}"

    response_text = LLMService.safe_gemini_call_sync(
        contents=prompt,
        system_instruction=SYSTEM_PROMPT,
        json_mode=True,
        fallback_response=fallback
    )
    
    try:
        return json.loads(response_text)
    except Exception:
        return fallback
