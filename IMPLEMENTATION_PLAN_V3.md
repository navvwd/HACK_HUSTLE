# sec_logistics — Final Implementation Plan v3
# For: Claude Code (execute phase-by-phase, confirm before advancing)

---

## AGENT INSTRUCTIONS — READ FIRST

You are completing a returns-fraud detection platform called **sec_logistics**.
The existing codebase is at the project root. Read these rules before writing a single line.

**Execution rules:**
1. Execute **one phase at a time**. Stop after each phase and output: `PHASE N COMPLETE — awaiting confirmation`.
2. When creating a new file, always write the **entire file** — no truncation.
3. Maintain **backward compatibility** with existing Maya / Priya / Ring demo scenarios.
4. Existing stack: **Python 3.12 + FastAPI + SQLite + scikit-learn + Pillow + exifread + Gemini 2.5 Flash · React 18 + Vite + TailwindCSS v4**. Do not introduce incompatible libraries.
5. All new Python dependencies must be appended to `server/requirements.txt`.
6. All new frontend dependencies must be added via `npm install` commands listed in the phase.
7. Every new backend endpoint follows the existing pattern: `{"ok": True, "data": ...}` on success, `{"ok": False, "detail": "..."}` on error.
8. SQLite stays as the primary database **except for Supabase receipt table** (see Phase 5 — Architecture Decision below).
9. Do not remove the existing file upload `<input>` from `ReturnForm.tsx` — it is used for general returns. The camera-only enforcement is a **new separate page**.
10. Seed data must not break. After any schema change, update `server/seed.py` to handle new columns gracefully.

---

## ARCHITECTURE DECISION — Supabase for Receipt Verification

**Use Supabase for receipt hash storage only. Keep SQLite for everything else.**

**Why Supabase here and not elsewhere:**
- Receipt verification requires comparing a customer-uploaded PDF against receipts *we generated* at order time. This is a cross-session, multi-user lookup — not a single-process local write.
- Supabase gives us: PostgreSQL row-level lookup, file storage bucket (to store generated receipt PDFs), and a REST API callable from both the FastAPI backend and the React frontend directly.
- Real-time subscriptions (free tier) can replace the current 2-second polling in `AdminDashboard.tsx`.
- SQLite cannot handle concurrent writes from the carrier webhook ingestion pipeline — Supabase/PostgreSQL handles this natively.

**What stays on SQLite:** All existing tables (`customers`, `orders`, `claims`, `claim_evidence`, `ring_clusters`, `evaluation_sessions`, `evaluation_turns`, `address_signatures`). These are local and already working.

**What goes to Supabase:**
- `receipt_hashes` — stores SHA-256 of every receipt PDF we generate, keyed to `order_id`
- `receipt_pdfs` bucket — stores generated receipt PDFs
- `realtime` channel — admin dashboard live updates (replaces setInterval polling)

**Supabase setup steps (human must do this once):**
```
1. Go to https://supabase.com, create a project called "sec_logistics"
2. In SQL editor, run the receipt schema from Phase 5
3. Create a storage bucket called "receipts" (public: false)
4. Copy: Project URL → SUPABASE_URL in server/.env
5. Copy: anon/public key → SUPABASE_ANON_KEY in server/.env
6. Copy: service_role key → SUPABASE_SERVICE_KEY in server/.env
```

Add to `server/.env.example`:
```
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_KEY=
```

Add to `server/app/config.py`:
```python
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")
```

---

## CURRENT STATE SUMMARY

**What exists and works:**
- `server/app/engine/exif.py` — EXIF date check (score 0–90)
- `server/app/engine/image_text.py` — mock vision check (score 0–90)
- `server/app/engine/linguistic.py` — TF-IDF cosine similarity (score 0–80)
- `server/app/engine/address.py` — SHA-256 address cluster (score 0–75)
- `server/app/engine/behavioural.py` — return velocity + account age (score 0–75)
- `server/app/engine/fusion.py` — weighted sum + corroboration multiplier + ring detection
- `server/app/evaluation_engine/runner.py` — Gemini function-calling loop (4-turn cap)
- `server/app/main.py` — FastAPI routes for claims, admin, evaluation
- `client/src/pages/ReturnForm.tsx` — return filing form with optional file upload
- `client/src/pages/ClaimStatus.tsx` — evidence trail + AI chat
- `client/src/pages/AdminDashboard.tsx` — live queue + ring graph
- `client/src/pages/DemoPanel.tsx` — one-click Maya/Priya/Ring scenarios
- `server/seed.py` — seeds 30 legit claims + Priya + Ring + Anjali scenarios

**Known bugs to fix in Phase 1 (listed below).**

---

## PHASE 1 — Critical Bug Fixes
*Estimated time: 1.5 hours. Do all 7 fixes before Phase 2.*

### Bug 1 — `score_claim()` is synchronous, blocks the event loop
**File:** `server/app/engine/fusion.py`

Replace the sequential signal calls with `asyncio.gather`. Signals are independent and should run concurrently.

```python
# BEFORE (in fusion.py score_claim):
evidence = [
    exif.score(photo_path, order),
    image_text.score(photo_path, claim_text, order),
    linguistic.score(claim_text, customer_id, conn),
    address.score(order, customer_id, conn),
    behavioural.score(customer_id, conn),
]

# AFTER — wrap each in asyncio.to_thread so IO-bound scorers don't block
import asyncio

async def score_claim_async(claim_id, claim_text, photo_path, order, conn):
    results = await asyncio.gather(
        asyncio.to_thread(exif.score, photo_path, order),
        asyncio.to_thread(image_text.score, photo_path, claim_text, order),
        asyncio.to_thread(linguistic.score, claim_text, order["customer_id"], conn),
        asyncio.to_thread(address.score, order, order["customer_id"], conn),
        asyncio.to_thread(behavioural.score, order["customer_id"], conn),
    )
    evidence = list(results)
    # ... rest of fusion logic unchanged
```

Also update `submit_claim` in `main.py` to `await score_claim_async(...)` and mark `submit_claim` as `async def`.

### Bug 2 — Ring detection ignores WARN verdicts, misses partial rings
**File:** `server/app/engine/fusion.py`, function `_ring_check`

Change the ring candidate collection to include both FAIL **and** WARN from linguistic:
```python
# BEFORE:
if ev["signal"] == "linguistic" and ev["verdict"] == "FAIL":
# AFTER:
if ev["signal"] == "linguistic" and ev["verdict"] in ("FAIL", "WARN"):
```

Also lower the ring threshold from 3 candidates to 2 for the auto-freeze trigger (but keep 3+ for the REJECT escalation):
```python
if len(candidates) < 2:  # was < 3
    return None
# Escalate to REJECT only when >= 3
if len(candidates) >= 3:
    final = max(final, 80)
```

### Bug 3 — `return_count_30d` is never incremented
**File:** `server/app/main.py`, in `submit_claim`

After inserting the claim and before scoring, add:
```python
conn.execute(
    "UPDATE customers SET return_count_30d = return_count_30d + 1 "
    "WHERE id = ? AND created_at >= datetime('now', '-30 days')",
    (order["customer_id"],),
)
conn.commit()
```

Note: This uses a date check on `created_at` as a proxy — acceptable for hackathon. The nightly reset is a Phase 8 task.

### Bug 4 — Maya demo order `ord_legit_000` not in seed
**File:** `server/seed.py`

In `seed_legit_history`, after the loop, add an explicit seed for the Maya demo order:
```python
# Explicit Maya demo order (used by DemoPanel.tsx)
_insert_customer(conn, "cust_maya_demo", days_old=500, return_count=0)
_insert_order(
    conn, "ord_legit_000", "cust_maya_demo",
    ("Boat Airdopes 141 Earbuds", "electronics", 1499),
    "Flat 3A, MG Road, Bengaluru, 560001", "560001",
    ordered_days_ago=8, delivered_days_ago=4,
)
```

### Bug 5 — Missing pip dependencies
**File:** `server/requirements.txt`

Add these lines:
```
pymupdf==1.24.5
qrcode[pil]==7.4.2
supabase==2.5.0
numpy==2.1.2
scipy==1.14.1
```

Note: `numpy` is already listed — only add if not present. Do not duplicate.

### Bug 6 — Closed evaluation session returns 200 with stale data
**File:** `server/app/evaluation_engine/runner.py`, function `take_turn`

```python
# BEFORE:
if sess["outcome"]:
    return {"error": "session already closed", "outcome": sess["outcome"]}

# AFTER:
if sess["outcome"]:
    conn.close()
    from fastapi import HTTPException
    raise HTTPException(status_code=409, detail=f"Session closed: {sess['outcome']}")
```

Also update `main.py` evaluation_turn endpoint to handle the 409 and return `{"ok": False, "detail": "session closed"}`.

### Bug 7 — `exif.py` only reads date, drops GPS and device model
**File:** `server/app/engine/exif.py`

Extend `parse_exif_date` into `parse_exif_full` that also returns GPS coordinates and device model:

```python
def parse_exif_full(photo_path: str | None) -> dict:
    """Returns dict with keys: date, lat, lng, device_model"""
    result = {"date": None, "lat": None, "lng": None, "device_model": None}
    if not photo_path or not Path(photo_path).exists():
        return result
    with open(photo_path, "rb") as f:
        tags = exifread.process_file(f, details=True)

    for key in ("EXIF DateTimeOriginal", "Image DateTimeOriginal",
                "EXIF DateTimeDigitized", "Image DateTime"):
        tag = tags.get(key)
        if tag:
            try:
                result["date"] = datetime.strptime(str(tag), "%Y:%m:%d %H:%M:%S").date()
                break
            except ValueError:
                continue

    # GPS
    lat_ref = tags.get("GPS GPSLatitudeRef")
    lat = tags.get("GPS GPSLatitude")
    lng_ref = tags.get("GPS GPSLongitudeRef")
    lng = tags.get("GPS GPSLongitude")
    if lat and lng:
        try:
            def dms_to_dd(vals, ref):
                d, m, s = [v.num / v.den for v in vals.values]
                dd = d + m/60 + s/3600
                return -dd if str(ref) in ('S', 'W') else dd
            result["lat"] = dms_to_dd(lat, lat_ref)
            result["lng"] = dms_to_dd(lng, lng_ref)
        except Exception:
            pass

    model = tags.get("Image Model")
    if model:
        result["device_model"] = str(model).strip()

    return result
```

Update `score()` function in `exif.py` to use `parse_exif_full` and include GPS/device info in the `raw` dict.

---

## PHASE 2 — Fusion Engine v2 Upgrade
*Estimated time: 2 hours. Implements FUSION_SCORING_V2.md fully.*

### 2.1 — Context-aware weight table
**File:** `server/app/engine/fusion.py`

Add `FraudContext` enum and weight table at the top of the file:

```python
from enum import Enum

class FraudContext(str, Enum):
    DEFAULT        = "default"
    WARDROBING     = "wardrobing"
    DAMAGE_CLAIM   = "damage_claim"
    INR_ABUSE      = "inr_abuse"
    RING_ORGANISED = "ring_organised"

HIGH_VALUE_WEARABLE_CODES = {"apparel", "fashion", "shoes", "jewellery"}
DAMAGE_REASON_CODES = {"damaged", "defective", "broken"}

CONTEXT_WEIGHTS = {
    FraudContext.DEFAULT:        {"exif":0.20,"image_text":0.20,"linguistic":0.20,"behavioural":0.10,"address":0.15,"carrier":0.15,"ring_velocity":0.10},
    FraudContext.WARDROBING:     {"exif":0.05,"image_text":0.05,"linguistic":0.15,"behavioural":0.25,"address":0.10,"carrier":0.15,"ring_velocity":0.25},
    FraudContext.DAMAGE_CLAIM:   {"exif":0.30,"image_text":0.30,"linguistic":0.10,"behavioural":0.05,"address":0.05,"carrier":0.10,"ring_velocity":0.10},
    FraudContext.INR_ABUSE:      {"exif":0.10,"image_text":0.05,"linguistic":0.20,"behavioural":0.15,"address":0.15,"carrier":0.25,"ring_velocity":0.10},
    FraudContext.RING_ORGANISED: {"exif":0.10,"image_text":0.10,"linguistic":0.15,"behavioural":0.10,"address":0.25,"carrier":0.15,"ring_velocity":0.15},
}

def infer_context(reason_code: str, product_category: str, has_photo: bool,
                  days_held: int, ring_cluster_id: str | None) -> FraudContext:
    if ring_cluster_id:
        return FraudContext.RING_ORGANISED
    if reason_code == "not_received":
        return FraudContext.INR_ABUSE
    if product_category in HIGH_VALUE_WEARABLE_CODES and days_held <= 4:
        return FraudContext.WARDROBING
    if has_photo or reason_code in DAMAGE_REASON_CODES:
        return FraudContext.DAMAGE_CLAIM
    return FraudContext.DEFAULT
```

### 2.2 — Replace static weights with context-aware weights in `score_claim`

In `score_claim` / `score_claim_async`, replace:
```python
raw = sum(ev["score"] * ev["weight"] for ev in evidence)
```
with:
```python
# Infer context
days_held = (datetime.now() - datetime.fromisoformat(order.get("delivered_at", datetime.now().isoformat()))).days
context = infer_context(
    reason_code=order.get("reason_code", ""),
    product_category=order.get("product_category", ""),
    has_photo=photo_path is not None,
    days_held=days_held,
    ring_cluster_id=order.get("ring_cluster_id"),
)
weights = CONTEXT_WEIGHTS[context]

signal_map = {ev["signal"]: ev["score"] for ev in evidence}
raw = (
    signal_map.get("exif",       0) * weights["exif"]       +
    signal_map.get("image_text", 0) * weights["image_text"] +
    signal_map.get("linguistic", 0) * weights["linguistic"] +
    signal_map.get("behavioural",0) * weights["behavioural"]+
    signal_map.get("address",    0) * weights["address"]    +
    signal_map.get("carrier",    0) * weights["carrier"]    +
    signal_map.get("ring_velocity",0)* weights["ring_velocity"]
)
```

### 2.3 — Corroboration multiplier (already partially present, formalise it)

Replace the existing ad-hoc multiplier with:
```python
def apply_corroboration_multiplier(signal_scores: dict[str, int], raw: float) -> float:
    high = [s for s in signal_scores.values() if s >= 60]
    n = len(high)
    if n >= 3:   multiplier = 1.25
    elif n == 2: multiplier = 1.12
    else:        multiplier = 1.00
    return min(raw * multiplier, 100.0)

final_raw = apply_corroboration_multiplier(signal_map, raw)
final = int(round(final_raw))
```

### 2.4 — Ring velocity signal stub (full implementation in Phase 7)

Add a placeholder in `fusion.py` that returns score 0 until Phase 7:
```python
def score_ring_velocity_stub(claim_id: str, customer_id: str, conn) -> dict:
    """Placeholder until Redis is wired in Phase 7."""
    return {"signal": "ring_velocity", "verdict": "SKIP", "score": 0,
            "weight": 0.10, "detail": "Ring velocity scorer pending Redis integration", "raw": {}}
```

Add it to the evidence list in `score_claim_async`.

### 2.5 — Add `fraud_context` to claims table

```sql
-- Run as migration or add to schema.sql
ALTER TABLE claims ADD COLUMN fraud_context TEXT DEFAULT 'default';
```

In `submit_claim` in `main.py`, after scoring:
```python
conn.execute("UPDATE claims SET fraud_context = ? WHERE id = ?", (context.value, claim_id))
```

---

## PHASE 3 — New Page: Damaged Product Capture
*Estimated time: 2.5 hours. New frontend page + backend integration.*

### Why a separate page (not modifying ReturnForm)
The existing `ReturnForm.tsx` accepts file uploads — this is kept for general returns.
The new `DamagedProductCapture.tsx` is specifically for **damage reason claims** and enforces live camera capture to defeat pre-existing photo fraud. The return form's reason dropdown routes to this page when "damaged" is selected.

### 3.1 — New frontend page
**File:** `client/src/pages/DamagedProductCapture.tsx`

This page must:
- Show a live webcam/camera feed via `navigator.mediaDevices.getUserMedia`
- Work on both mobile (rear camera preferred) and desktop (front camera fallback)
- Have a **Capture** button that takes a still frame from the video stream
- Show a countdown timer (3–2–1) before capture to prevent button-mashing
- Display the captured image for review with **Retake** and **Submit** buttons
- Embed a visible **timestamp overlay** on the captured frame (drawn on a canvas)
- Not allow uploading from gallery — `<input type="file">` is hidden on this page
- After capture, redirect to `ReturnForm.tsx` with the image and `reason_code=damaged` pre-filled via React Router state

**Component structure:**
```
DamagedProductCapture
├── <video ref={videoRef} autoPlay playsInline muted>
├── <canvas ref={canvasRef}> (hidden, for capture + timestamp overlay)
├── <img src={capturedDataUrl}> (shown after capture)
├── CountdownOverlay (3s countdown on capture)
├── CameraSelector (front/rear toggle for mobile)
└── ActionButtons (Capture | Retake | Use This Photo)
```

**Key implementation notes:**
```typescript
// Camera constraints — prefer rear camera on mobile
const constraints: MediaStreamConstraints = {
  video: {
    facingMode: { ideal: "environment" },  // rear camera
    width: { ideal: 1280 },
    height: { ideal: 720 },
  }
};

// Timestamp overlay on canvas
function drawTimestampOverlay(canvas: HTMLCanvasElement, video: HTMLVideoElement) {
  const ctx = canvas.getContext("2d")!;
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  ctx.drawImage(video, 0, 0);
  
  const ts = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, canvas.height - 40, canvas.width, 40);
  ctx.fillStyle = "white";
  ctx.font = "bold 16px monospace";
  ctx.fillText(`sec_logistics · ${ts}`, 10, canvas.height - 14);
}
```

**Anti-spoofing metadata** — capture these and send as hidden form fields:
```typescript
const metadata = {
  capture_method: "live_camera",
  user_agent: navigator.userAgent,
  captured_at: new Date().toISOString(),
  // Browser-level proof it was live, not uploaded
};
```

**Route:** Add `/return/damage-capture` to `client/src/main.tsx`

**Entry point:** In `ReturnForm.tsx`, when `reason` changes to `"damaged"`, show a banner:
```tsx
{reason === "damaged" && (
  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
    Damage claims require a live photo for faster processing.{" "}
    <button onClick={() => navigate("/return/damage-capture", { state: { orderId, reason } })}
            className="underline font-medium">
      Open Camera →
    </button>
    {" "}or continue with file upload below.
  </div>
)}
```

### 3.2 — Backend: accept `capture_method` metadata
**File:** `server/app/main.py`, `submit_claim` endpoint

Add optional form field:
```python
capture_method: str = Form("file_upload"),
```

Store in claim:
```sql
ALTER TABLE claims ADD COLUMN capture_method TEXT DEFAULT 'file_upload';
```

In `exif.py` scoring, if `capture_method == "live_camera"` and EXIF is missing, return `SKIP` instead of `MISSING` (live camera frames on some browsers strip EXIF — this is expected and should not penalise honest users):
```python
if photo_date is None and capture_method == "live_camera":
    return {"signal": "exif", "verdict": "SKIP", "score": 5, "weight": weight,
            "detail": "Live capture — EXIF not embedded by browser (expected)", "raw": {}}
```

### 3.3 — ELA (Error Level Analysis) for image manipulation detection
**File:** `server/app/engine/ela.py` (new file)

ELA detects JPEG re-compression artifacts that indicate editing. Implement using Pillow + NumPy:

```python
"""ELA — Error Level Analysis for image manipulation detection.
Re-saves the image at a known quality, then computes the pixel-difference map.
High ELA scores in specific regions (text overlays, copy-paste edits) indicate tampering.
"""
from __future__ import annotations
import io
import numpy as np
from pathlib import Path
from PIL import Image, ImageChops, ImageEnhance

ELA_QUALITY = 75  # Re-save quality for comparison
SCALE_FACTOR = 10  # Amplify differences for scoring


def compute_ela_score(photo_path: str) -> tuple[int, dict]:
    """
    Returns (score 0-100, evidence_dict).
    score >= 50 → likely manipulated
    score >= 70 → strong evidence of manipulation
    """
    if not Path(photo_path).exists():
        return 0, {"error": "file not found"}

    try:
        original = Image.open(photo_path).convert("RGB")
        buf = io.BytesIO()
        original.save(buf, "JPEG", quality=ELA_QUALITY)
        buf.seek(0)
        resaved = Image.open(buf).convert("RGB")

        diff = ImageChops.difference(original, resaved)
        extrema = diff.getextrema()
        max_diff = max([ex[1] for ex in extrema])
        if max_diff == 0:
            return 0, {"max_diff": 0, "mean_diff": 0}

        arr = np.array(diff).astype(float)
        arr = (arr / max_diff) * 255 * SCALE_FACTOR
        arr = np.clip(arr, 0, 255)
        mean_diff = float(np.mean(arr))

        # Score: mean ELA intensity mapped to 0–100
        score = min(int(mean_diff * 0.6), 100)

        return score, {
            "mean_diff": round(mean_diff, 2),
            "max_diff": int(max_diff),
            "ela_score": score,
        }
    except Exception as e:
        return 0, {"error": str(e)}


def score(photo_path: str | None) -> dict:
    weight = 0.15  # Used within image_text module, not as standalone signal
    if not photo_path:
        return {"signal": "ela", "verdict": "SKIP", "score": 0, "weight": weight,
                "detail": "No photo provided", "raw": {}}

    ela_score, evidence = compute_ela_score(photo_path)

    if ela_score >= 70:
        return {"signal": "ela", "verdict": "FAIL", "score": 85, "weight": weight,
                "detail": f"ELA detected likely image manipulation (score {ela_score}/100)",
                "raw": evidence}
    if ela_score >= 40:
        return {"signal": "ela", "verdict": "WARN", "score": 40, "weight": weight,
                "detail": f"ELA detected possible re-compression artifacts (score {ela_score}/100)",
                "raw": evidence}

    return {"signal": "ela", "verdict": "OK", "score": 0, "weight": weight,
            "detail": f"ELA clean (score {ela_score}/100)", "raw": evidence}
```

Wire ELA into `image_text.py`: when `USE_MOCK_VISION=false`, call `ela.score(photo_path)` and blend its result with the vision model output. When `USE_MOCK_VISION=true`, run ELA on real uploads (it works without any API).

---

## PHASE 4 — New Page: Billing & Receipt Verification
*Estimated time: 3 hours. New frontend page + Supabase integration + receipt engine.*

### Why this page exists
Customers filing high-value returns must submit a receipt/invoice. This page:
1. Accepts a receipt PDF or image upload
2. Calls the backend to verify it against our Supabase receipt hash store
3. Shows a clear "Verified ✓" or "Mismatch detected ✗" result
4. If mismatch, routes the claim to REJECT automatically

### 4.1 — Supabase receipt schema
**Run in Supabase SQL editor:**
```sql
-- Stores hashes of every receipt we generate at order time
CREATE TABLE receipt_hashes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        TEXT NOT NULL UNIQUE,
  customer_id     TEXT NOT NULL,
  amount_inr      NUMERIC(12,2) NOT NULL,
  issued_at       TIMESTAMPTZ NOT NULL,
  pdf_hash_sha256 TEXT NOT NULL,       -- SHA-256 of raw PDF bytes
  pdf_hash_md5    TEXT NOT NULL,       -- secondary hash
  line_items_hash TEXT NOT NULL,       -- hash of just the line items JSON
  storage_path    TEXT,                -- path in Supabase storage bucket
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_receipt_order ON receipt_hashes(order_id);
CREATE INDEX idx_receipt_customer ON receipt_hashes(customer_id);

-- Stores verified/rejected submissions
CREATE TABLE receipt_verifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id        TEXT NOT NULL,
  order_id        TEXT NOT NULL,
  submitted_hash  TEXT NOT NULL,
  stored_hash     TEXT,
  match_result    TEXT NOT NULL,  -- 'MATCH', 'MISMATCH', 'NOT_FOUND'
  pdf_metadata    JSONB,          -- PyMuPDF extracted metadata
  tamper_signals  JSONB,          -- list of detected manipulation signals
  verified_at     TIMESTAMPTZ DEFAULT now()
);
```

### 4.2 — Backend: receipt engine
**File:** `server/app/engine/receipt.py` (new file)

```python
"""Module C — Receipt manipulation detection.

Five detection methods:
1. PDF hash comparison against Supabase receipt_hashes
2. PDF metadata analysis (creation/modification dates, producer field)
3. Line item cross-reference against orders table
4. Amount vs order value comparison
5. PDF structure integrity check (stream corruption, re-encryption signs)
"""
from __future__ import annotations
import hashlib
import json
import sqlite3
from pathlib import Path
from datetime import datetime

try:
    import fitz  # PyMuPDF
    PYMUPDF_AVAILABLE = True
except ImportError:
    PYMUPDF_AVAILABLE = False

from ..config import SUPABASE_URL, SUPABASE_SERVICE_KEY


def _hash_file(path: str) -> tuple[str, str]:
    """Returns (sha256_hex, md5_hex) of file bytes."""
    data = Path(path).read_bytes()
    return hashlib.sha256(data).hexdigest(), hashlib.md5(data).hexdigest()


def _extract_pdf_metadata(path: str) -> dict:
    if not PYMUPDF_AVAILABLE:
        return {"error": "PyMuPDF not installed"}
    try:
        doc = fitz.open(path)
        meta = doc.metadata
        doc.close()
        return {
            "title": meta.get("title", ""),
            "author": meta.get("author", ""),
            "creator": meta.get("creator", ""),
            "producer": meta.get("producer", ""),
            "creation_date": meta.get("creationDate", ""),
            "mod_date": meta.get("modDate", ""),
        }
    except Exception as e:
        return {"error": str(e)}


def _check_date_tamper(metadata: dict) -> dict:
    """If modDate is after creationDate by more than 60 seconds → likely edited."""
    signals = []
    creation = metadata.get("creation_date", "")
    mod = metadata.get("mod_date", "")
    if creation and mod and mod > creation:
        # PyMuPDF dates: "D:20240101120000+05'30'"
        try:
            # Strip "D:" prefix and timezone for comparison
            c_clean = creation[2:16] if creation.startswith("D:") else creation[:14]
            m_clean = mod[2:16] if mod.startswith("D:") else mod[:14]
            c_dt = datetime.strptime(c_clean, "%Y%m%d%H%M%S")
            m_dt = datetime.strptime(m_clean, "%Y%m%d%H%M%S")
            diff = (m_dt - c_dt).total_seconds()
            if diff > 60:
                signals.append({"type": "DATE_MODIFIED", "detail": f"PDF modified {int(diff)}s after creation"})
        except Exception:
            pass

    # Known edit tools in producer field
    EDIT_TOOLS = ["adobe acrobat", "foxit", "ilovepdf", "smallpdf", "libreoffice", "inkscape"]
    producer = metadata.get("producer", "").lower()
    for tool in EDIT_TOOLS:
        if tool in producer:
            signals.append({"type": "EDIT_TOOL", "detail": f"Producer field: {metadata.get('producer')}"})
            break

    return {"signals": signals, "tampered": len(signals) > 0}


def _lookup_supabase_hash(order_id: str, submitted_sha256: str) -> dict:
    """Compare submitted PDF hash against Supabase stored hash."""
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        return {"match_result": "SKIPPED", "detail": "Supabase not configured"}

    try:
        import httpx
        headers = {
            "apikey": SUPABASE_SERVICE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
            "Content-Type": "application/json",
        }
        url = f"{SUPABASE_URL}/rest/v1/receipt_hashes?order_id=eq.{order_id}&select=pdf_hash_sha256,amount_inr,issued_at"
        resp = httpx.get(url, headers=headers, timeout=5.0)
        if resp.status_code != 200 or not resp.json():
            return {"match_result": "NOT_FOUND", "detail": "No receipt on file for this order"}

        stored = resp.json()[0]
        if stored["pdf_hash_sha256"] == submitted_sha256:
            return {"match_result": "MATCH", "amount_inr": stored["amount_inr"],
                    "issued_at": stored["issued_at"]}
        else:
            return {"match_result": "MISMATCH",
                    "detail": "Receipt hash does not match our records — possible tampering",
                    "stored_amount": stored["amount_inr"]}
    except Exception as e:
        return {"match_result": "ERROR", "detail": str(e)}


def score(receipt_path: str | None, order_id: str, order_value_inr: float,
          conn: sqlite3.Connection) -> dict:
    weight = 0.20
    if not receipt_path:
        return {"signal": "receipt", "verdict": "SKIP", "score": 0, "weight": weight,
                "detail": "No receipt submitted", "raw": {}}

    sha256, md5 = _hash_file(receipt_path)
    metadata = _extract_pdf_metadata(receipt_path)
    date_check = _check_date_tamper(metadata)
    supabase_check = _lookup_supabase_hash(order_id, sha256)

    raw = {
        "sha256": sha256,
        "metadata": metadata,
        "tamper_signals": date_check["signals"],
        "hash_check": supabase_check,
    }

    if supabase_check["match_result"] == "MISMATCH":
        return {"signal": "receipt", "verdict": "FAIL", "score": 90, "weight": weight,
                "detail": supabase_check.get("detail", "Receipt hash mismatch"), "raw": raw}

    if date_check["tampered"]:
        return {"signal": "receipt", "verdict": "FAIL", "score": 75, "weight": weight,
                "detail": f"PDF tamper signals: {', '.join(s['type'] for s in date_check['signals'])}",
                "raw": raw}

    if supabase_check["match_result"] == "MATCH":
        return {"signal": "receipt", "verdict": "OK", "score": 0, "weight": weight,
                "detail": "Receipt hash verified against our records", "raw": raw}

    # NOT_FOUND or SKIPPED — partial check via metadata only
    if len(date_check["signals"]) > 0:
        return {"signal": "receipt", "verdict": "WARN", "score": 40, "weight": weight,
                "detail": "Receipt metadata suggests possible editing", "raw": raw}

    return {"signal": "receipt", "verdict": "OK", "score": 10, "weight": weight,
            "detail": "Receipt metadata clean (hash check skipped)", "raw": raw}
```

### 4.3 — Backend: receipt verification endpoint
**File:** `server/app/main.py`

Add endpoint:
```python
@app.post("/api/v1/receipts/verify")
async def verify_receipt(
    order_id: str = Form(...),
    claim_id: str = Form(""),
    receipt: UploadFile = File(...),
):
    """Standalone receipt verification — called from BillingVerification page."""
    path = str(UPLOAD_DIR / f"receipt_{uuid.uuid4().hex[:8]}_{receipt.filename}")
    with open(path, "wb") as f:
        f.write(await receipt.read())

    conn = get_db()
    order = conn.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
    if not order:
        conn.close()
        raise HTTPException(404, "Order not found")

    from .engine.receipt import score as receipt_score
    result = receipt_score(path, order_id, order["value_inr"], conn)
    conn.close()

    return {"ok": True, "data": result}
```

Also wire `receipt.score()` into `fusion.py`'s `score_claim_async` when `reason_code == "receipt_tampered"`.

### 4.4 — Frontend: BillingVerification page
**File:** `client/src/pages/BillingVerification.tsx` (new file)

This page:
- Has an order ID input field
- Has a PDF/image upload dropzone (drag-and-drop + click-to-browse)
- On submit, calls `POST /api/v1/receipts/verify`
- Shows one of three states:
  - **Verified ✓** (green) — receipt hash matches our records
  - **Mismatch Detected ✗** (red) — with explanation (amount differs, dates differ, etc.)
  - **Partial Check** (amber) — hash not on file, metadata clean
- Uses a loading spinner during verification (receipt upload can be slow)
- Shows extracted metadata: issue date, amount, producer (for transparency)

**Route:** Add `/billing` to `client/src/main.tsx`

**Add to nav in `App.tsx`:**
```tsx
{ to: "/billing", label: "Receipt Check" },
```

### 4.5 — Order receipt generation (seed + endpoint)
**File:** `server/seed.py`

When seeding orders, generate a receipt hash and push to Supabase (only if `SUPABASE_URL` is set):

```python
def seed_supabase_receipt(order_id: str, customer_id: str, amount_inr: float):
    """Push a fake receipt hash to Supabase for demo. Skip if Supabase not configured."""
    import os
    if not os.getenv("SUPABASE_URL"):
        return
    # Generate fake but consistent PDF bytes for the demo order
    fake_pdf = f"RECEIPT|{order_id}|{customer_id}|{amount_inr}|GENUINE".encode()
    sha256 = hashlib.sha256(fake_pdf).hexdigest()
    md5 = hashlib.md5(fake_pdf).hexdigest()
    # ... POST to Supabase rest/v1/receipt_hashes
```

---

## PHASE 5 — Friendly Fraud (Chargeback Abuse) Engine
*Estimated time: 2 hours.*

**What friendly fraud is:** Customer receives goods, keeps them, then files a bank chargeback claiming the transaction was unauthorised. The retailer loses both goods and money.

### 5.1 — Schema additions
**File:** `server/app/schema.sql`

Add to existing schema:
```sql
CREATE TABLE IF NOT EXISTS payment_risk_profiles (
  customer_id           TEXT PRIMARY KEY REFERENCES customers(id),
  risk_tier             TEXT NOT NULL DEFAULT 'LOW',  -- LOW / MEDIUM / HIGH / BLOCKED
  claim_count_180d      INT DEFAULT 0,
  chargeback_count      INT DEFAULT 0,
  last_chargeback_at    TEXT,
  largest_chargeback_inr REAL DEFAULT 0,
  preferred_payment_method TEXT DEFAULT 'all',
  tier_set_at           TEXT DEFAULT (datetime('now')),
  tier_expires_at       TEXT,
  notes                 TEXT
);

CREATE TABLE IF NOT EXISTS chargeback_events (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id         TEXT REFERENCES customers(id),
  order_id            TEXT REFERENCES orders(id),
  payment_method      TEXT,
  amount_inr          REAL,
  chargeback_reason   TEXT,
  gateway_dispute_id  TEXT,
  filed_at            TEXT,
  resolved_at         TEXT,
  resolution          TEXT,   -- WON / LOST / PENDING
  created_at          TEXT DEFAULT (datetime('now'))
);
```

### 5.2 — Friendly fraud scorer
**File:** `server/app/engine/friendly_fraud.py` (new file)

```python
"""Module E — Friendly Fraud (Chargeback Abuse) Detection.

Signals:
1. Prior chargeback count (0→80 score)
2. Payment method risk (COD < UPI < card-not-present < BNPL)
3. Claim-to-chargeback timing (very fast = suspicious)
4. Cross-merchant chargeback signal (future: requires network data)
5. Risk tier escalation with cooldown
"""
from __future__ import annotations
import sqlite3
from datetime import datetime

PAYMENT_METHOD_RISK = {
    "cod":        0,    # Cash on delivery — no chargeback possible
    "upi":       10,    # Low risk (UPI disputes rare)
    "netbanking":15,
    "debit_card":20,
    "credit_card":40,  # Standard chargeback risk
    "bnpl":      60,   # Buy-now-pay-later — highest chargeback risk
    "wallet":    20,
}


def get_risk_tier(chargeback_count: int) -> str:
    if chargeback_count == 0:      return "LOW"
    if chargeback_count == 1:      return "MEDIUM"
    if chargeback_count <= 3:      return "HIGH"
    return "BLOCKED"


def score(customer_id: str, payment_method: str, conn: sqlite3.Connection) -> dict:
    weight = 0.15
    row = conn.execute(
        "SELECT * FROM payment_risk_profiles WHERE customer_id = ?",
        (customer_id,),
    ).fetchone()

    chargeback_count = row["chargeback_count"] if row else 0
    claim_count_180d = row["claim_count_180d"] if row else 0
    risk_tier = row["risk_tier"] if row else "LOW"

    signal_score = 0
    detail_parts = []

    # Prior chargeback signal
    if chargeback_count >= 3:
        signal_score += 80
        detail_parts.append(f"{chargeback_count} prior chargebacks")
    elif chargeback_count == 2:
        signal_score += 50
        detail_parts.append(f"{chargeback_count} prior chargebacks")
    elif chargeback_count == 1:
        signal_score += 25
        detail_parts.append("1 prior chargeback")

    # Payment method risk
    pm_risk = PAYMENT_METHOD_RISK.get(payment_method.lower(), 20)
    if pm_risk >= 40:
        signal_score += pm_risk // 2
        detail_parts.append(f"High-risk payment method: {payment_method}")

    # Claim frequency
    if claim_count_180d >= 5:
        signal_score += 30
        detail_parts.append(f"{claim_count_180d} claims in 180 days")

    # Blocked tier override
    if risk_tier == "BLOCKED":
        return {
            "signal": "friendly_fraud",
            "verdict": "FAIL",
            "score": 95,
            "weight": weight,
            "detail": f"Customer is in BLOCKED tier — {chargeback_count} prior chargebacks",
            "raw": {"risk_tier": risk_tier, "chargeback_count": chargeback_count},
        }

    signal_score = min(signal_score, 100)

    if signal_score >= 60:
        verdict = "FAIL"
    elif signal_score >= 25:
        verdict = "WARN"
    else:
        verdict = "OK"

    return {
        "signal": "friendly_fraud",
        "verdict": verdict,
        "score": signal_score,
        "weight": weight,
        "detail": "; ".join(detail_parts) if detail_parts else "No prior chargeback history",
        "raw": {
            "chargeback_count": chargeback_count,
            "risk_tier": risk_tier,
            "payment_method_risk": pm_risk,
        },
    }


def record_chargeback(customer_id: str, order_id: str, amount_inr: float,
                      payment_method: str, reason: str, conn: sqlite3.Connection) -> None:
    """Called from the chargeback webhook handler."""
    conn.execute(
        "INSERT INTO chargeback_events (customer_id, order_id, payment_method, amount_inr, chargeback_reason, filed_at) "
        "VALUES (?, ?, ?, ?, ?, datetime('now'))",
        (customer_id, order_id, payment_method, amount_inr, reason),
    )
    # Update or create payment risk profile
    existing = conn.execute(
        "SELECT chargeback_count FROM payment_risk_profiles WHERE customer_id = ?",
        (customer_id,),
    ).fetchone()

    new_count = (existing["chargeback_count"] + 1) if existing else 1
    new_tier = get_risk_tier(new_count)

    conn.execute(
        "INSERT INTO payment_risk_profiles (customer_id, chargeback_count, risk_tier, last_chargeback_at, largest_chargeback_inr) "
        "VALUES (?, ?, ?, datetime('now'), ?) "
        "ON CONFLICT(customer_id) DO UPDATE SET "
        "  chargeback_count = chargeback_count + 1, "
        "  risk_tier = excluded.risk_tier, "
        "  last_chargeback_at = datetime('now'), "
        "  largest_chargeback_inr = MAX(largest_chargeback_inr, excluded.largest_chargeback_inr)",
        (customer_id, new_count, new_tier, amount_inr),
    )
    conn.commit()
```

### 5.3 — Chargeback webhook endpoint
**File:** `server/app/main.py`

```python
@app.post("/api/v1/webhooks/chargeback")
async def chargeback_webhook(
    customer_id: str = Form(...),
    order_id: str = Form(...),
    amount_inr: float = Form(...),
    payment_method: str = Form("credit_card"),
    reason: str = Form("unauthorised"),
):
    conn = get_db()
    from .engine.friendly_fraud import record_chargeback
    record_chargeback(customer_id, order_id, amount_inr, payment_method, reason, conn)
    conn.close()
    return {"ok": True, "data": {"message": "Chargeback recorded"}}
```

### 5.4 — Wire into fusion
**File:** `server/app/engine/fusion.py`

Add to `score_claim_async`:
```python
from . import friendly_fraud

payment_method = order.get("payment_method", "unknown")
ff_result = await asyncio.to_thread(
    friendly_fraud.score, customer_id, payment_method, conn
)
evidence.append(ff_result)
```

### 5.5 — Payment method restriction for HIGH/BLOCKED customers
**File:** `server/app/main.py`

Add endpoint:
```python
@app.get("/api/v1/customers/{customer_id}/payment-methods")
def get_allowed_payment_methods(customer_id: str):
    """Returns allowed payment methods based on risk tier. Frontend uses this to restrict checkout."""
    conn = get_db()
    row = conn.execute(
        "SELECT risk_tier FROM payment_risk_profiles WHERE customer_id = ?",
        (customer_id,),
    ).fetchone()
    conn.close()

    tier = row["risk_tier"] if row else "LOW"
    restrictions = {
        "LOW":     ["cod", "upi", "netbanking", "debit_card", "credit_card", "bnpl", "wallet"],
        "MEDIUM":  ["cod", "upi", "netbanking", "debit_card", "credit_card", "wallet"],
        "HIGH":    ["cod", "upi", "netbanking"],
        "BLOCKED": ["cod"],
    }
    return {"ok": True, "data": {"risk_tier": tier, "allowed_methods": restrictions.get(tier, [])}}
```

---

## PHASE 6 — Wardrobing Engine
*Estimated time: 2.5 hours.*

**What wardrobing is:** Customer buys an item (dress for a wedding, electronics for a trip, tools for a project), uses it briefly, then returns it in technically returnable condition. The intent to return was present at purchase time.

### 6.1 — Schema additions
**File:** `server/app/schema.sql`

```sql
CREATE TABLE IF NOT EXISTS return_history (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id       TEXT REFERENCES customers(id),
  order_id          TEXT REFERENCES orders(id),
  claim_id          TEXT REFERENCES claims(id),
  product_category  TEXT,
  order_value_inr   REAL,
  days_held         INT,
  return_reason     TEXT,
  condition_claimed TEXT,
  wardrobing_score  INT DEFAULT 0,
  filed_at          TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rh_customer ON return_history(customer_id);
CREATE INDEX IF NOT EXISTS idx_rh_category ON return_history(product_category, customer_id);

CREATE TABLE IF NOT EXISTS category_return_baselines (
  category              TEXT PRIMARY KEY,
  median_return_gap_days REAL,
  wardrobing_peak_months TEXT,         -- JSON array e.g. ["11","12","1","2"] for wedding season
  restocking_threshold_days INT,
  high_value_threshold_inr REAL,
  updated_at            TEXT DEFAULT (datetime('now'))
);
```

### 6.2 — Seed category baselines
**File:** `server/seed.py`

Add to `main()` after other seeds:
```python
CATEGORY_BASELINES = [
    ("apparel",    7,  '["11","12","1","2","4","5"]', 3,  3000),
    ("shoes",      5,  '["11","12","1","2"]',          3,  5000),
    ("jewellery",  3,  '["11","12","1","2","4","5"]', 2,  8000),
    ("electronics",14, '["6","7","12"]',               5,  15000),
    ("appliance",  21, '[]',                           7,  10000),
    ("beauty",     7,  '[]',                           5,  1000),
    ("baby",       14, '[]',                           7,  2000),
    ("fashion",    5,  '["11","12","1","2"]',           2,  4000),
]
for row in CATEGORY_BASELINES:
    conn.execute(
        "INSERT OR REPLACE INTO category_return_baselines "
        "(category, median_return_gap_days, wardrobing_peak_months, restocking_threshold_days, high_value_threshold_inr) "
        "VALUES (?,?,?,?,?)", row
    )
conn.commit()
```

### 6.3 — Wardrobing scorer
**File:** `server/app/engine/wardrobing.py` (new file)

```python
"""Module F — Wardrobing Detection.

Signals:
1. Days held: < restocking_threshold → suspicious (dress worn once before return)
2. Category + value: high-value wearable returned quickly → strong signal
3. Seasonal pattern: returns spiking in wedding/event months → wardrobing indicator
4. Return frequency: same category returned 2+ times in 6 months
5. Condition claim: "unused/unopened" but days_held == 1 → contradiction
"""
from __future__ import annotations
import json
import sqlite3
from datetime import datetime


WARDROBING_CATEGORIES = {"apparel", "shoes", "jewellery", "fashion", "accessories"}


def _get_days_held(order: dict) -> int:
    delivered = order.get("delivered_at")
    if not delivered:
        return 999
    try:
        d = datetime.fromisoformat(delivered)
        return max(0, (datetime.now() - d).days)
    except ValueError:
        return 999


def score(customer_id: str, order: dict, reason_code: str,
          conn: sqlite3.Connection) -> dict:
    weight = 0.15
    category = (order.get("product_category") or "").lower()
    value = float(order.get("value_inr") or 0)
    days_held = _get_days_held(order)

    baseline = conn.execute(
        "SELECT * FROM category_return_baselines WHERE category = ?",
        (category,),
    ).fetchone()

    signal_score = 0
    detail_parts = []

    # Signal 1 — Days held vs restocking threshold
    if baseline:
        threshold = baseline["restocking_threshold_days"]
        if days_held <= threshold:
            if category in WARDROBING_CATEGORIES:
                signal_score += 60
            else:
                signal_score += 30
            detail_parts.append(f"Returned {days_held}d after delivery (threshold: {threshold}d)")

    # Signal 2 — High-value wearable
    if baseline and category in WARDROBING_CATEGORIES:
        hv_threshold = baseline["high_value_threshold_inr"]
        if value >= hv_threshold and days_held <= 5:
            signal_score += 25
            detail_parts.append(f"High-value {category} (₹{value:.0f}) returned in {days_held}d")

    # Signal 3 — Seasonal peak (current month in wardrobing peak months)
    if baseline:
        peak_months_raw = baseline["wardrobing_peak_months"] or "[]"
        peak_months = json.loads(peak_months_raw)
        current_month = str(datetime.now().month)
        if current_month in peak_months and category in WARDROBING_CATEGORIES:
            signal_score += 15
            detail_parts.append(f"Peak wardrobing month for {category}")

    # Signal 4 — Category return frequency (same category 2+ times in 180 days)
    prior_same_category = conn.execute(
        "SELECT COUNT(*) AS c FROM return_history "
        "WHERE customer_id = ? AND product_category = ? "
        "AND filed_at >= datetime('now', '-180 days')",
        (customer_id, category),
    ).fetchone()["c"]

    if prior_same_category >= 2:
        signal_score += 30
        detail_parts.append(f"{prior_same_category + 1} returns in same category in 180 days")
    elif prior_same_category == 1:
        signal_score += 15

    signal_score = min(signal_score, 100)

    if signal_score >= 60:
        verdict = "FAIL"
    elif signal_score >= 25:
        verdict = "WARN"
    else:
        verdict = "OK"

    return {
        "signal": "wardrobing",
        "verdict": verdict,
        "score": signal_score,
        "weight": weight,
        "detail": "; ".join(detail_parts) if detail_parts else "No wardrobing indicators",
        "raw": {
            "days_held": days_held,
            "category": category,
            "value_inr": value,
            "prior_same_category_returns": prior_same_category,
        },
    }


def record_return_history(customer_id: str, order_id: str, claim_id: str,
                          order: dict, wardrobing_score: int,
                          conn: sqlite3.Connection) -> None:
    """Write to return_history after every claim submission."""
    conn.execute(
        "INSERT INTO return_history (customer_id, order_id, claim_id, product_category, "
        "order_value_inr, days_held, wardrobing_score) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (customer_id, order_id, claim_id,
         order.get("product_category", ""), order.get("value_inr", 0),
         _get_days_held(order), wardrobing_score),
    )
```

### 6.4 — Wire wardrobing into fusion and main
**File:** `server/app/engine/fusion.py`

Add wardrobing signal to `score_claim_async`:
```python
from . import wardrobing as wardrobing_module

wardrobing_result = await asyncio.to_thread(
    wardrobing_module.score, customer_id, order, order.get("reason_code", ""), conn
)
evidence.append(wardrobing_result)
```

**File:** `server/app/main.py`, after `score_claim_async`:
```python
from .engine.wardrobing import record_return_history

wardrobing_ev = next((e for e in evidence if e["signal"] == "wardrobing"), None)
wardrobing_score = wardrobing_ev["score"] if wardrobing_ev else 0
record_return_history(order["customer_id"], order_id, claim_id, dict(order), wardrobing_score, conn)
```

### 6.5 — Restocking fee endpoint
**File:** `server/app/main.py`

```python
@app.get("/api/v1/claims/{claim_id}/restocking-fee")
def get_restocking_fee(claim_id: str):
    """Returns recommended restocking fee for wardrobing cases."""
    conn = get_db()
    claim = conn.execute("SELECT * FROM claims WHERE id = ?", (claim_id,)).fetchone()
    if not claim:
        conn.close()
        raise HTTPException(404, "Claim not found")

    # Get wardrobing evidence
    wardrobing_ev = conn.execute(
        "SELECT * FROM claim_evidence WHERE claim_id = ? AND signal_name = 'wardrobing'",
        (claim_id,),
    ).fetchone()
    conn.close()

    if not wardrobing_ev or wardrobing_ev["verdict"] not in ("WARN", "FAIL"):
        return {"ok": True, "data": {"fee_inr": 0, "reason": "No wardrobing indicators"}}

    order = conn.execute("SELECT * FROM orders WHERE id = ?", (claim["order_id"],)).fetchone() if conn else None
    # Tiered restocking fee
    score = wardrobing_ev["score"] if wardrobing_ev else 0
    order_value = 1000  # fallback
    fee_pct = 0.25 if score >= 60 else 0.15
    fee_inr = round(order_value * fee_pct)

    return {"ok": True, "data": {
        "fee_inr": fee_inr,
        "fee_pct": fee_pct * 100,
        "reason": f"Wardrobing score {score} — restocking fee applies",
    }}
```

### 6.6 — Frontend: wardrobing banner in ClaimStatus
**File:** `client/src/pages/ClaimStatus.tsx`

After the decision banner, add:
```tsx
{/* Wardrobing restocking fee notice */}
{data.evidence.some(e => e.signal_name === "wardrobing" && e.verdict === "FAIL") && (
  <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
    <div className="font-medium">Restocking fee applies</div>
    <div className="mt-1">
      This return has been identified as a short-duration return. A restocking fee of up to 25%
      may be deducted from your refund. Our team will confirm the final amount within 24 hours.
    </div>
  </div>
)}
```

---

## PHASE 7 — INR (Item Not Received) Engine
*Estimated time: 3 hours.*

**What INR abuse is:** Customer claims a delivered package was never received. At low volume this is often genuine; at scale it becomes a pattern.

### 7.1 — Schema additions
**File:** `server/app/schema.sql`

```sql
CREATE TABLE IF NOT EXISTS shipment_deliveries (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id            TEXT REFERENCES orders(id),
  customer_id         TEXT REFERENCES customers(id),
  carrier             TEXT,
  shipment_id         TEXT,
  delivered_at        TEXT,
  gps_lat             REAL,
  gps_lng             REAL,
  gps_accuracy_m      REAL,
  scan_location       TEXT,
  otp_confirmed       INTEGER DEFAULT 0,
  driver_photo_url    TEXT,
  pod_signature_url   TEXT,
  created_at          TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS engagement_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id     TEXT REFERENCES customers(id),
  order_id        TEXT REFERENCES orders(id),
  event_type      TEXT,   -- 'app_login', 'qr_scan', 'warranty_reg', 'review_submitted'
  occurred_at     TEXT,
  metadata_json   TEXT,
  created_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_eng_order ON engagement_events(order_id);

CREATE TABLE IF NOT EXISTS pincode_intelligence (
  pincode          TEXT PRIMARY KEY,
  rto_rate         REAL,
  inr_rate         REAL,
  cod_allowed      INTEGER DEFAULT 1,
  tier             TEXT DEFAULT 'TIER2',
  last_refreshed   TEXT DEFAULT (datetime('now'))
);
```

### 7.2 — INR scorer
**File:** `server/app/engine/inr.py` (new file)

```python
"""Module B — Item Not Received (INR) Abuse Detection.

Six signals:
1. GPS delivery scan vs claimed non-delivery
2. Post-delivery engagement (app login, QR scan after delivery = received it)
3. Prior INR history
4. Delivery scan-to-claim timing gap (< 2h = suspicious)
5. Pincode INR rate
6. OTP confirmation status
"""
from __future__ import annotations
import sqlite3
from datetime import datetime


def _hours_gap(ts1: str, ts2: str) -> float | None:
    try:
        d1 = datetime.fromisoformat(ts1)
        d2 = datetime.fromisoformat(ts2)
        return abs((d2 - d1).total_seconds() / 3600)
    except Exception:
        return None


def score(customer_id: str, order_id: str, order: dict,
          claim_filed_at: str, conn: sqlite3.Connection) -> dict:
    weight = 0.20
    signal_score = 0
    detail_parts = []

    # Signal 1 — GPS delivery confirmation
    delivery = conn.execute(
        "SELECT * FROM shipment_deliveries WHERE order_id = ? ORDER BY delivered_at DESC LIMIT 1",
        (order_id,),
    ).fetchone()

    if delivery:
        if delivery["otp_confirmed"]:
            # OTP confirmed = strong proof of receipt
            return {
                "signal": "inr",
                "verdict": "FAIL",
                "score": 85,
                "weight": weight,
                "detail": "OTP delivery confirmation on record — delivery verified",
                "raw": {"otp_confirmed": True, "delivered_at": delivery["delivered_at"]},
            }
        if delivery["gps_lat"] and delivery["gps_lng"]:
            signal_score += 30
            detail_parts.append("GPS delivery scan on record")

    # Signal 2 — Post-delivery engagement (proves they received it)
    delivered_at = order.get("delivered_at", "")
    if delivered_at:
        engagement_after_delivery = conn.execute(
            "SELECT COUNT(*) AS c FROM engagement_events "
            "WHERE customer_id = ? AND order_id = ? AND occurred_at > ?",
            (customer_id, order_id, delivered_at),
        ).fetchone()["c"]
        if engagement_after_delivery > 0:
            signal_score += 50
            detail_parts.append(f"{engagement_after_delivery} post-delivery app events recorded")

    # Signal 3 — Prior INR history
    prior_inr = conn.execute(
        "SELECT COUNT(*) AS c FROM claims "
        "WHERE customer_id = ? AND reason_code = 'not_received' "
        "AND filed_at >= datetime('now', '-365 days')",
        (customer_id,),
    ).fetchone()["c"]
    if prior_inr >= 3:
        signal_score += 50
        detail_parts.append(f"{prior_inr} prior INR claims in 12 months")
    elif prior_inr == 2:
        signal_score += 25
    elif prior_inr == 1:
        signal_score += 10

    # Signal 4 — Claim timing gap
    if delivery and delivery["delivered_at"]:
        gap_hours = _hours_gap(delivery["delivered_at"], claim_filed_at)
        if gap_hours is not None:
            if gap_hours < 2:
                signal_score += 40
                detail_parts.append(f"INR claim filed {gap_hours:.1f}h after delivery scan")
            elif gap_hours < 12:
                signal_score += 15

    # Signal 5 — Pincode INR rate
    pincode = order.get("pincode", "")
    if pincode:
        pin_intel = conn.execute(
            "SELECT inr_rate FROM pincode_intelligence WHERE pincode = ?",
            (pincode,),
        ).fetchone()
        if pin_intel and pin_intel["inr_rate"] and pin_intel["inr_rate"] >= 15:
            signal_score += 20
            detail_parts.append(f"High INR-rate pincode ({pin_intel['inr_rate']:.0f}%)")

    signal_score = min(signal_score, 100)

    if signal_score >= 60:
        verdict = "FAIL"
    elif signal_score >= 25:
        verdict = "WARN"
    else:
        verdict = "OK"

    return {
        "signal": "inr",
        "verdict": verdict,
        "score": signal_score,
        "weight": weight,
        "detail": "; ".join(detail_parts) if detail_parts else "No INR indicators",
        "raw": {"prior_inr_count": prior_inr},
    }
```

### 7.3 — Wire INR into fusion
**File:** `server/app/engine/fusion.py`

```python
from . import inr as inr_module

if order.get("reason_code") == "not_received":
    inr_result = await asyncio.to_thread(
        inr_module.score, customer_id, order_id,
        order, datetime.now().isoformat(), conn
    )
    evidence.append(inr_result)
    # Boost carrier signal weight for INR context (already handled by context weights)
```

### 7.4 — Carrier webhook endpoint
**File:** `server/app/main.py`

```python
@app.post("/api/v1/webhooks/carrier")
async def carrier_webhook(
    order_id: str = Form(...),
    carrier: str = Form(...),
    event_type: str = Form(...),
    shipment_id: str = Form(""),
    gps_lat: float = Form(None),
    gps_lng: float = Form(None),
    otp_confirmed: bool = Form(False),
    delivered_at: str = Form(""),
):
    conn = get_db()
    if event_type == "SHIPMENT_DELIVERED":
        conn.execute(
            "INSERT OR REPLACE INTO shipment_deliveries "
            "(order_id, carrier, shipment_id, delivered_at, gps_lat, gps_lng, otp_confirmed) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (order_id, carrier, shipment_id, delivered_at or datetime.now().isoformat(),
             gps_lat, gps_lng, int(otp_confirmed)),
        )
    conn.commit()
    conn.close()
    return {"ok": True, "data": {"message": "Carrier event recorded"}}
```

---

## PHASE 8 — Admin Dashboard Upgrades + Learning Loop
*Estimated time: 2 hours.*

### 8.1 — Replace polling with Supabase Realtime (optional — do only if Supabase configured)
**File:** `client/src/pages/AdminDashboard.tsx`

Currently polls every 2 seconds. If `VITE_SUPABASE_URL` is set, replace with:
```typescript
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

useEffect(() => {
  refresh();
  const channel = supabase
    .channel("claims_realtime")
    .on("postgres_changes", { event: "*", schema: "public", table: "claims" }, refresh)
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}, []);
```

If Supabase not configured, fall back to existing setInterval(refresh, 2000).

### 8.2 — New fraud vector tabs in Admin
**File:** `client/src/pages/AdminDashboard.tsx`

Add tabs to the admin dashboard:
- **Queue** (existing)
- **Rings** (existing)
- **Wardrobing** — shows claims with wardrobing FAIL/WARN, days_held, restocking fee button
- **INR Abuse** — shows INR claims grouped by customer, with prior count badge
- **Chargebacks** — shows chargeback_events table with resolution status

### 8.3 — Human review labels (learning loop foundation)
**File:** `server/app/schema.sql`

```sql
CREATE TABLE IF NOT EXISTS review_labels (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  claim_id    TEXT REFERENCES claims(id),
  reviewer_id TEXT NOT NULL,
  outcome     TEXT NOT NULL,  -- 'CONFIRMED_FRAUD' / 'CONFIRMED_LEGIT' / 'ESCALATED'
  confidence  INT,            -- 1–5
  notes       TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);
```

**File:** `server/app/main.py`

```python
@app.post("/api/v1/admin/review")
async def submit_review(
    claim_id: str = Form(...),
    reviewer_id: str = Form("admin"),
    outcome: str = Form(...),
    confidence: int = Form(3),
    notes: str = Form(""),
):
    conn = get_db()
    conn.execute(
        "INSERT INTO review_labels (claim_id, reviewer_id, outcome, confidence, notes) VALUES (?,?,?,?,?)",
        (claim_id, reviewer_id, outcome, confidence, notes),
    )
    # Update claim decision based on human review
    if outcome == "CONFIRMED_FRAUD":
        conn.execute("UPDATE claims SET decision = 'REJECT' WHERE id = ?", (claim_id,))
    elif outcome == "CONFIRMED_LEGIT":
        conn.execute("UPDATE claims SET decision = 'APPROVE' WHERE id = ?", (claim_id,))
    conn.commit()
    conn.close()
    return {"ok": True, "data": {"message": "Review recorded"}}
```

### 8.4 — Add CONFIRM_FRAUD and APPROVE buttons to Admin queue rows
**File:** `client/src/pages/AdminDashboard.tsx`

In the queue table, add action buttons on each row:
```tsx
<td className="px-5 py-2">
  <div className="flex gap-1">
    <button
      onClick={() => submitReview(c.id, "CONFIRMED_LEGIT")}
      className="text-xs bg-emerald-100 text-emerald-700 px-2 py-1 rounded hover:bg-emerald-200"
    >✓ Legit</button>
    <button
      onClick={() => submitReview(c.id, "CONFIRMED_FRAUD")}
      className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded hover:bg-red-200"
    >✗ Fraud</button>
  </div>
</td>
```

---

## PHASE 9 — Navigation, Routes & Demo Updates
*Estimated time: 45 minutes. Final wiring.*

### 9.1 — Update main.tsx routes
**File:** `client/src/main.tsx`

```tsx
import DamagedProductCapture from "./pages/DamagedProductCapture";
import BillingVerification from "./pages/BillingVerification";

// Inside Routes:
<Route path="return/damage-capture" element={<DamagedProductCapture />} />
<Route path="billing" element={<BillingVerification />} />
```

### 9.2 — Update App.tsx nav
**File:** `client/src/App.tsx`

```tsx
const tabs = [
  { to: "/return", label: "Return Portal" },
  { to: "/billing", label: "Receipt Check" },
  { to: "/admin", label: "Fraud Ops" },
  { to: "/demo", label: "Demo" },
];
```

### 9.3 — Update DemoPanel with new scenarios
**File:** `client/src/pages/DemoPanel.tsx`

Add two new demo scenarios after the existing three:
```typescript
{
  key: "wardrobing",
  label: "Run Wardrobing (dress returned next day)",
  description: "High-value apparel returned 1 day after delivery during wedding season.",
  orderId: "ord_wardrobing_001",
  reasonCode: "damaged",
  claimText: "The dress doesn't fit as expected, returning it.",
  photoFilename: null,
  expectedDecision: "BORDERLINE",
  color: "bg-amber-600 hover:bg-amber-700",
},
{
  key: "friendly_fraud",
  label: "Run Friendly Fraud (3 prior chargebacks)",
  description: "Customer with 3 prior chargebacks filing a new claim.",
  orderId: "ord_friendly_001",
  reasonCode: "not_received",
  claimText: "I never received this order.",
  photoFilename: null,
  expectedDecision: "REJECT",
  color: "bg-purple-600 hover:bg-purple-700",
},
```

### 9.4 — Seed wardrobing and friendly fraud demo orders
**File:** `server/seed.py`

Add to `main()`:
```python
print("Seeding wardrobing demo (dress returned same day)...")
_insert_customer(conn, "cust_wardrobing", days_old=200, return_count=2)
_insert_order(
    conn, "ord_wardrobing_001", "cust_wardrobing",
    ("Sabyasachi Lehenga", "apparel", 45000),
    "Flat 12, Juhu, Mumbai, 400049", "400049",
    ordered_days_ago=3, delivered_days_ago=1,
)

print("Seeding friendly fraud demo (3 prior chargebacks)...")
_insert_customer(conn, "cust_ff_001", days_old=90, return_count=3)
_insert_order(
    conn, "ord_friendly_001", "cust_ff_001",
    ("Apple iPhone 15 Pro", "electronics", 134900),
    "Flat 22, Koramangala, Bengaluru, 560034", "560034",
    ordered_days_ago=5, delivered_days_ago=2,
)
# Insert 3 prior chargebacks for this customer
for i in range(3):
    conn.execute(
        "INSERT INTO chargeback_events (customer_id, order_id, payment_method, amount_inr, chargeback_reason, filed_at) "
        "VALUES (?, ?, 'credit_card', 15000, 'unauthorised', datetime('now', ?))",
        ("cust_ff_001", f"ord_friendly_old_{i}", f"-{(i+1)*30} days"),
    )
conn.execute(
    "INSERT OR REPLACE INTO payment_risk_profiles (customer_id, chargeback_count, risk_tier, last_chargeback_at) "
    "VALUES ('cust_ff_001', 3, 'HIGH', datetime('now', '-30 days'))"
)
conn.commit()
```

---

## COMPLETE FILE CHANGE MANIFEST

### New files to create:
```
server/app/engine/ela.py                     # Phase 3
server/app/engine/friendly_fraud.py          # Phase 5
server/app/engine/wardrobing.py              # Phase 6
server/app/engine/inr.py                     # Phase 7
server/app/engine/receipt.py                 # Phase 4
client/src/pages/DamagedProductCapture.tsx   # Phase 3
client/src/pages/BillingVerification.tsx     # Phase 4
```

### Existing files to modify:
```
server/app/engine/fusion.py        # Phase 1 (async), Phase 2 (context weights)
server/app/engine/exif.py          # Phase 1 (GPS + device extraction)
server/app/engine/behavioural.py   # Phase 2 (context-aware)
server/app/engine/image_text.py    # Phase 3 (ELA integration)
server/app/main.py                 # Phase 1 + 4 + 5 + 7 + 8 (new endpoints)
server/app/schema.sql              # Phase 2, 5, 6, 7, 8 (new tables)
server/app/config.py               # Phase 4 (Supabase config)
server/seed.py                     # Phase 1 + 6 + 9 (new seed scenarios)
server/requirements.txt            # Phase 1 (new deps)
server/.env.example                # Phase 4 (Supabase keys)
client/src/main.tsx                # Phase 9 (new routes)
client/src/App.tsx                 # Phase 9 (nav update)
client/src/pages/ReturnForm.tsx    # Phase 3 (camera prompt banner)
client/src/pages/ClaimStatus.tsx   # Phase 6 (wardrobing banner)
client/src/pages/AdminDashboard.tsx # Phase 8 (tabs + review buttons)
client/src/pages/DemoPanel.tsx     # Phase 9 (new scenarios)
client/src/lib/api.ts              # Phase 4,5,6 (new API calls)
```

### New npm packages needed:
```bash
cd client
npm install @supabase/supabase-js  # Phase 4/8 (realtime admin)
```

### New pip packages (add to requirements.txt):
```
pymupdf==1.24.5
qrcode[pil]==7.4.2
supabase==2.5.0
scipy==1.14.1
httpx==0.27.2    # probably already present — check first
```

---

## ACCEPTANCE CRITERIA — Per Phase

| Phase | Pass condition |
|---|---|
| 1 | `pytest server/tests/ -v` passes all 4 existing tests; Maya/Priya/Ring demo still works |
| 2 | Fusion context is logged in claim response; context-aware weights visible in evidence `weight` field |
| 3 | `/return/damage-capture` opens webcam feed; captured image has timestamp overlay; submits to existing claim endpoint |
| 4 | `/billing` accepts PDF upload; returns `match_result` in response; MISMATCH routes claim to REJECT |
| 5 | Chargeback webhook creates `chargeback_events` row; `payment_risk_profiles` tier updates; friendly fraud signal appears in evidence |
| 6 | Wardrobing signal appears in evidence for `ord_wardrobing_001`; wardrobing banner shows in ClaimStatus |
| 7 | INR signal fires for `not_received` claims; carrier webhook creates `shipment_deliveries` row |
| 8 | Admin CONFIRM_FRAUD button updates claim decision; new admin tabs render without errors |
| 9 | All 5 demo scenarios run; nav shows all tabs; routes resolve without 404 |

---

## WHAT IS NOT IN SCOPE (Post-hackathon)

These are intentionally deferred — do not attempt them:
- Redis for ring velocity (Phase 2 stub is enough; full Redis wiring is post-hackathon)
- NetworkX/Louvain graph detection (device fingerprinting requires longer-term data collection)
- FingerprintJS v3 client-side collection (requires browser SDK approval flow)
- Celery task queue (nightly weight recomputation, `return_count_30d` reset)
- PostgreSQL migration (SQLite is fine at hackathon scale)
- OTP doorstep delivery (requires carrier SDK integration contract)
- Cross-merchant ring intelligence (requires data sharing agreements)

---

## FRAUD VECTOR COVERAGE AFTER ALL PHASES

| Fraud Vector | Signal(s) Added | Phase | Coverage |
|---|---|---|---|
| Falsified damage claims | ELA, camera-only enforcement, EXIF GPS | 3 | Full |
| Receipt manipulation | PDF hash (Supabase), metadata tamper, PyMuPDF | 4 | Full |
| Friendly fraud (chargeback abuse) | Chargeback history, payment method risk, claim velocity | 5 | Full |
| Wardrobing | Days-held threshold, category baseline, seasonal peak | 6 | Full |
| INR (Item Not Received) abuse | GPS scan, post-delivery engagement, timing gap, pincode rate | 7 | Full |
| Organised return rings | Existing linguistic+address+ring_velocity stub, enhanced ring detection | 1+2 | Strong |

All six fraud vectors from the problem statement are addressed.
