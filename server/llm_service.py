import os
import time
import json
import asyncio
from dotenv import load_dotenv

load_dotenv()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

try:
    from google import genai
    from google.genai import types
    HAS_GEMINI = bool(GEMINI_API_KEY)
    if HAS_GEMINI:
        client = genai.Client(api_key=GEMINI_API_KEY)
except ImportError:
    HAS_GEMINI = False
    client = None

# Rate limiter state
_rate_limits = {}  # Format: { "session_id_minute": count }
RATE_LIMIT_PER_MINUTE = 15

# Cache state
_response_cache = {}  # Format: { "hash_key": {"response": str, "expires_at": float} }
CACHE_TTL = 600  # 10 minutes

class RateLimitExceeded(Exception):
    pass

class LLMService:
    @staticmethod
    def _check_rate_limit(session_id: str):
        if not session_id:
            return
        current_min = int(time.time() // 60)
        key = f"{session_id}_{current_min}"
        
        # Clean up old keys
        keys_to_delete = [k for k in _rate_limits.keys() if not k.endswith(f"_{current_min}")]
        for k in keys_to_delete:
            del _rate_limits[k]
            
        count = _rate_limits.get(key, 0)
        if count >= RATE_LIMIT_PER_MINUTE:
            raise RateLimitExceeded("Rate limit exceeded for this session.")
        _rate_limits[key] = count + 1

    @staticmethod
    def _get_cache(cache_key: str):
        cached = _response_cache.get(cache_key)
        if cached:
            if time.time() < cached["expires_at"]:
                return cached["response"]
            else:
                del _response_cache[cache_key]
        return None

    @staticmethod
    def _set_cache(cache_key: str, response: str):
        _response_cache[cache_key] = {
            "response": response,
            "expires_at": time.time() + CACHE_TTL
        }

    @staticmethod
    def _build_fallback(json_mode: bool, custom_fallback: dict = None) -> str:
        fallback = custom_fallback or {
            "status": "degraded",
            "message": "System is temporarily busy. Please retry shortly.",
            "fallback_mode": True
        }
        return json.dumps(fallback) if json_mode else fallback.get("message", "System busy.")

    @staticmethod
    async def safe_gemini_call(
        contents,  # String or list of dicts for chat history
        system_instruction: str = None, 
        session_id: str = "global", 
        json_mode: bool = False,
        fallback_response: dict = None
    ) -> str:
        """
        Safely calls Gemini API with rate limiting, caching, and exponential backoff.
        Accepts 'contents' as a single string (prompt) or a list of messages (chat history).
        """
        if not HAS_GEMINI:
            return LLMService._build_fallback(json_mode, fallback_response)

        try:
            LLMService._check_rate_limit(session_id)
        except RateLimitExceeded:
            return LLMService._build_fallback(json_mode, fallback_response)

        # Generate a cache key
        cache_key_raw = str(contents) + str(system_instruction) + str(json_mode)
        cache_key = str(hash(cache_key_raw))
        
        cached_response = LLMService._get_cache(cache_key)
        if cached_response:
            return cached_response

        max_retries = 3
        backoff = 2

        config_args = {}
        if system_instruction:
            config_args["system_instruction"] = system_instruction
        if json_mode:
            config_args["response_mime_type"] = "application/json"

        config = types.GenerateContentConfig(**config_args) if config_args else None

        for attempt in range(max_retries):
            try:
                # Use client.aio to support async execution properly without blocking Event Loop
                if hasattr(client, "aio"):
                    response = await client.aio.models.generate_content(
                        model='gemini-2.5-flash',
                        contents=contents,
                        config=config
                    )
                else:
                    # Fallback to sync run in thread pool
                    response = await asyncio.to_thread(
                        client.models.generate_content,
                        model='gemini-2.5-flash',
                        contents=contents,
                        config=config
                    )
                
                result_text = response.text
                LLMService._set_cache(cache_key, result_text)
                return result_text
            
            except Exception as e:
                err_str = str(e).lower()
                is_quota = "429" in err_str or "resource exhausted" in err_str or "quota" in err_str
                
                if is_quota or attempt < max_retries - 1:
                    await asyncio.sleep(backoff)
                    backoff *= 2
                else:
                    print(f"[LLMService] Gemini API failed permanently: {e}")
                    return LLMService._build_fallback(json_mode, fallback_response)
        
        return LLMService._build_fallback(json_mode, fallback_response)

    @staticmethod
    def safe_gemini_call_sync(
        contents,
        system_instruction: str = None, 
        session_id: str = "global", 
        json_mode: bool = False,
        fallback_response: dict = None
    ) -> str:
        """Synchronous wrapper for safe_gemini_call."""
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            return loop.run_until_complete(LLMService.safe_gemini_call(
                contents, system_instruction, session_id, json_mode, fallback_response
            ))
        finally:
            loop.close()
