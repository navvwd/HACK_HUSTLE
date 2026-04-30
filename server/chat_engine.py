"""
AI Chat Session Manager for the ReturnGuard Return Filing Chatbot.
Uses Gemini 2.5 Flash with in-memory session storage (per request).
"""
import os
import json
import uuid
from dotenv import load_dotenv
from category_questions import build_system_prompt

load_dotenv()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

from llm_service import LLMService

# In-memory session store: session_id -> {history, metadata}
# In production this would be Redis or Supabase
_sessions: dict = {}

def start_session(order_id: str, category: str, reason: str, product_name: str = "") -> dict:
    """Start a new chat session. Returns session_id and opening AI message."""
    session_id = str(uuid.uuid4())[:12]
    system_prompt = build_system_prompt(category, reason, order_id, product_name)

    fallback_greeting = f"Hello! I'm ReturnGuard AI 👋 I'll help you with your return for order **{order_id}**.\n\nCould you start by describing the issue you're experiencing with the product?"
    prompt = "Start the conversation with a warm greeting and your first question."
    
    opening_text = LLMService.safe_gemini_call_sync(
        contents=prompt,
        system_instruction=system_prompt,
        session_id=session_id,
        fallback_response={"message": fallback_greeting}
    )
    
    history = [
        {"role": "user", "parts": [{"text": prompt}]},
        {"role": "model", "parts": [{"text": opening_text}]}
    ]

    _sessions[session_id] = {
        "order_id": order_id,
        "category": category,
        "reason": reason,
        "product_name": product_name,
        "system_prompt": system_prompt,
        "history": history,
        "turn_count": 0,
        "is_complete": False
    }

    return {
        "session_id": session_id,
        "message": opening_text,
        "is_complete": False
    }


def send_message(session_id: str, user_message: str) -> dict:
    """Process a user message and return the AI's response."""
    session = _sessions.get(session_id)
    if not session:
        return {"error": "Session not found or expired.", "is_complete": True}

    session["turn_count"] += 1

    session["history"].append({"role": "user", "parts": [{"text": user_message}]})

    fallback_replies = [
        "Got it, thank you! Can you tell me when you first noticed this issue?",
        "Understood. Is the product still in its original packaging?",
        "Thank you for that information. Let me create a summary of your return request...",
        "✅ Your return has been logged. Our team will review it within 24 hours."
    ]
    idx = min(session["turn_count"] - 1, len(fallback_replies) - 1)
    
    response_text = LLMService.safe_gemini_call_sync(
        contents=session["history"],
        system_instruction=session["system_prompt"],
        session_id=session_id,
        fallback_response={"message": fallback_replies[idx]}
    )
    
    session["history"].append({"role": "model", "parts": [{"text": response_text}]})

    # Check if Gemini has signalled completion via JSON block
    is_complete = False
    fraud_signals = []
    summary = ""

    if "```json" in response_text:
        try:
            json_start = response_text.index("```json") + 7
            json_end = response_text.index("```", json_start)
            payload = json.loads(response_text[json_start:json_end].strip())
            if payload.get("status") == "complete":
                is_complete = True
                fraud_signals = payload.get("fraud_signals", [])
                summary = payload.get("summary", "")
                session["is_complete"] = True
                # Clean the text for display
                response_text = response_text[:response_text.index("```json")].strip()
                if not response_text:
                    response_text = f"✅ Thank you! Your return request has been submitted. {summary}"
        except Exception:
            pass

    return {
        "session_id": session_id,
        "message": response_text,
        "is_complete": is_complete,
        "fraud_signals": fraud_signals,
        "summary": summary,
        "turn_count": session["turn_count"]
    }


def get_session_info(session_id: str) -> dict:
    """Return session metadata (for debugging/admin)."""
    return _sessions.get(session_id, {})
