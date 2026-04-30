# ReturnGuard Technical Pipeline Study

This document provides a comprehensive technical breakdown of the ReturnGuard fraud detection pipeline. It details how the system ingests data, extracts signals, scores risk, and enforces business logic to detect organized return rings, wardrobing, friendly fraud, and bot-driven claims.

---

## 1. Architectural Overview: The 5-Layer Pipeline

The core philosophy of ReturnGuard is **defense in depth**. A single signal (like an IP address) is easily spoofed. By layering signals and requiring corroboration, the system structurally bounds false positives and accurately identifies network-level fraud.

The pipeline executes in ~120ms total latency (when bypassing LLM overhead via caching/heuristics):

1.  **Signal Collection (0ms):** Client-side collection of device fingerprints, behavioral biometrics, and linguistic data.
2.  **Feature Extraction (+5ms):** Data normalization, DB lookups for prior history, and behavioral delta calculation.
3.  **Parallel Scorers (+85ms):** Concurrent evaluation across Device, Behavior, and Graph/History engines.
4.  **Fusion Engine (+86ms):** Aggregation of scores using a strict corroboration rule.
5.  **Decision Tier (+90ms):** Categorization into Auto-Approve (GREEN), Photo Required (AMBER), Human Review (ORANGE), or Block/Appeal (RED).

---

## 2. Layer 1: Signal Collection (Client-Side)

The frontend React application acts as the primary sensor network.

### Conversational UI (`ReturnChat.jsx`)
*   Instead of a static form, the return process is a multi-step conversational interface. This extends the interaction time, generating richer behavioral telemetry.
*   **Linguistic Signals:** The conversational engine captures the user's unstructured reason (`description`) alongside the structured category (`reason`).

### Behavioral Telemetry Collection
Silent event listeners track micro-interactions:
*   **Dwell Time (`dwell_avg`):** Milliseconds spent focusing on inputs before typing.
*   **Flight Time (`flight_avg`):** Milliseconds between keystrokes or discrete UI interactions.
*   **Mouse Velocity (`mouse_velocity`):** Pixels per millisecond cursor speed.
*   **Scroll Rhythm (`scroll_rhythm`):** Variance in scroll event intervals.

### Device & Network Fingerprinting
*   **Fingerprint Hash (`fingerprint_hash`):** A composite hash of stable client attributes (Canvas/WebGL rendering, audio API, hardware concurrency, fonts). This is the "anchor" identity that survives VPN rotation.
*   **IP & Network:** Collected on submission, but treated as a low-confidence signal due to VPN prevalence.

### Live Camera Anti-Spoofing (`DamagedProductCapture.jsx`)
*   **Gallery Block:** The system forces the use of the `getUserMedia` API (live camera) to prevent uploads of stock photos or previously used damage images.
*   **Metadata Embedding:** A burned-in timestamp overlay and EXIF metadata (capture method, user agent) are appended to the image to prevent post-processing spoofing.

---

## 3. Layer 2: Feature Extraction (Backend)

The FastAPI backend (`main.py`) receives the payload and enriches it before scoring.

### Historical Context Injection
*   **Serial Returner Check:** Before scoring, the system queries the Supabase `claims` table:
    ```python
    history_res = supabase.table("claims").select("order_id").eq("account_id", account_id).execute()
    prior_return_count = len(history_res.data)
    ```
*   This stateless injection allows the scoring engines to be pure functions while still being aware of longitudinal account history.

---

## 4. Layer 3: Parallel Scorers

The core logic resides in `behavior_engine.py`, which utilizes a deterministic heuristic fallback to ensure 100% uptime and prevent LLM hallucination biases.

### A. The Telemetry Scorer (Bot / Script Detection)
Evaluates physical interaction bounds:
*   **`dwell <= 30ms`:** Faster than human capability (Scripted injection) -> `+30 points`
*   **`flight > 250ms`:** Erratic or automated hesitation -> `+20 points`
*   **`mouse >= 800px/ms`:** Hyper-velocity, perfectly linear bot cursor paths -> `+30 points`
*   **`scroll <= 10ms variance`:** Perfectly rhythmic automated scrolling -> `+20 points`

### B. The Linguistic & NLP Scorer (Wardrobing & Misrepresentation)
Analyzes the unstructured text for contradictions against the stated reason category.
*   **Contradiction Detection:** If a user claims the item is `"damaged"` but their description keywords match `"changed_mind"` or `"wrong_item"` (e.g., "didn't fit my decor"), the system flags a linguistic contradiction -> `+35 points`.
*   **Vagueness:** Lacking expected descriptive keywords for a damage claim -> `+15 points`.
*   **Minimal Effort:** Descriptions under 20 characters -> `+10 points`.

### C. The Network & History Scorer (Organized Rings)
This is where organized fraud is defeated.
*   **Shared Fingerprints:** If `fingerprint_hash` contains known ring tags (e.g., "shared", "pool") -> `+25 points`.
*   **VPN/Proxy Subnets:** Checks IP against known OpenVPN (`10.8.x.x`) and CGNAT proxy ranges -> `+20 points`.
*   **Serial Return Escalation:**
    *   `1 prior`: `+10 points` (Monitoring)
    *   `2 priors`: `+20 points` (Repeat)
    *   `3+ priors`: `+30 points` (Pattern)
    *   `5+ priors`: `+40 points` (High-volume Abuse)
*   **Friendly Fraud / INR Markers:** Flags accounts with chargeback histories or specific naming conventions claiming "Not Received" -> `+35 points`.

---

## 5. Layer 4: The Fusion Engine (Corroboration)

ReturnGuard employs a strict **Corroboration Rule** to fuse scores. A single high-risk signal is rarely enough to block a user, mitigating false positives.

*   **Scoring Accumulation:** Indicators add points cumulatively (0-100 scale).
*   **Hard Constraints:** The frontend visualizes this principle: *A score cannot escalate above AMBER unless at least 2 independent signals trigger.* (e.g., a bad IP alone is not enough; it needs a bad IP + weird telemetry).

---

## 6. Layer 5: Decision Tier & Resiliency

Scores map to automated operational decisions:

| Tier | Score Range | Action | System Response |
| :--- | :--- | :--- | :--- |
| **GREEN** | 0 - 30 | Auto-Approve | Instant refund. Invisible to user. |
| **AMBER** | 31 - 60 | Friction Added | Live photo capture required. |
| **ORANGE** | 61 - 80 | Human Review | Sent to admin queue. 24h SLA. |
| **RED** | 81 - 100 | Block & Appeal | Immediate rejection. |

### Resilient Architecture (`llm_service.py`)
To prevent the backend from crashing under heavy load or API quota limits (429 errors), the system uses the `LLMService` wrapper:
1.  **Rate Limiting:** In-memory bucket (15 req/min).
2.  **Caching:** 10-minute TTL cache for identical payloads to reduce API costs.
3.  **Exponential Backoff:** Retries on transient network errors.
4.  **Deterministic Fallback:** If the LLM is unavailable, the system defaults to the `behavior_engine` pure Python heuristics, ensuring zero downtime for fraud scoring. Demo accounts explicitly force this fallback to prevent LLM training biases from over-scoring legitimate demo cases.

---

## 7. The VPN Problem: Solved

The ReturnGuard architecture specifically targets the most evasive technique used by fraud rings: **VPN Rotation**.

1.  **The Attack:** A fraudster submits 5 claims using 5 different accounts, switching VPN endpoints between each to present a different IP address.
2.  **The Failure of Legacy Systems:** Traditional IP-blocking rules see 5 independent, unrelated claims and approve them all.
3.  **The ReturnGuard Solution:**
    *   **Signal 1 (IP):** Different every time (Ignored / low weight).
    *   **Signal 2 (Device):** The underlying hardware (GPU renderer, audio drivers) remains identical. The `fingerprint_hash` links the 5 accounts.
    *   **Signal 3 (Telemetry):** The fraudster's typing cadence (`flight_avg`) and mouse movement patterns remain consistent across the sessions.
4.  **Result:** The Fusion Engine correlates the stable Fingerprint and Telemetry signals, overrides the IP variance, and surfaces the hidden network graph, flagging all 5 accounts as a unified Ring Attack.
