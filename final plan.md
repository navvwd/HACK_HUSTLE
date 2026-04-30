# SecLogistics — Final Implementation Plan

## Goal

Build a **fake e-commerce platform** with **User (customer)** and **Admin (retailer)** login. End-to-end flow: QR scan → live video recording → return request → AI chat with category-specific questions → EXIF/deepfake image check → speedometer fraud report to both sides.

The system detects **6 fraud vectors** using a 10+ signal fusion engine.

---

## Fraud Vector Audit: What Exists vs What Needs Work

### Vector 1 — Wardrobing
> *Customer buys item, uses it briefly (wedding dress, trip electronics), returns in "unused" condition.*

| Signal | File | Status | How It Works |
|---|---|---|---|
| Days-held vs restocking threshold | [wardrobing.py](file:///c:/hackhuslte/returnguard-ai-main/server/app/engine/wardrobing.py) | ✅ Built | If returned in ≤ threshold days (e.g., 3 days for apparel), score += 60 |
| High-value wearable quick return | wardrobing.py | ✅ Built | ₹45K lehenga returned in 1 day → score += 25 |
| Seasonal peak detection | wardrobing.py | ✅ Built | Wedding months (Nov-Feb) for apparel → score += 15 |
| Same-category repeat returns | wardrobing.py | ✅ Built | 2+ returns in same category in 180d → score += 30 |
| Category baselines (8 categories) | seed.py | ✅ Seeded | apparel, shoes, jewellery, electronics, appliance, beauty, baby, fashion |

**Enhancement needed**: Add AI chat questions for wardrobing specifically — *"Was the item used or worn?"*, *"Is the tag still attached?"*

---

### Vector 2 — INR (Item Not Received) Abuse
> *Customer claims delivered package never arrived. GPS/OTP proves otherwise.*

| Signal | File | Status | How It Works |
|---|---|---|---|
| OTP delivery confirmation | [inr.py](file:///c:/hackhuslte/returnguard-ai-main/server/app/engine/inr.py) | ✅ Built | OTP confirmed → score = 90 (instant FAIL) |
| GPS delivery scan | inr.py | ✅ Built | GPS on record → score += 30 |
| Post-delivery engagement | inr.py | ✅ Built | App login/QR scan after delivery proves receipt → score += 50 |
| Prior INR history | inr.py | ✅ Built | 3+ prior INR claims in 12 months → score += 50 |
| Claim timing gap | inr.py | ✅ Built | Filed < 2h after delivery → score += 40 |
| Pincode INR rate | inr.py | ✅ Built | High-INR pincode (≥15%) → score += 20 |
| Demo scenario seeded | seed.py | ✅ Seeded | `ord_inr_001` with GPS delivery 1h ago + 2 prior INR claims |

**Status**: ✅ Complete. No changes needed.

---

### Vector 3 — Falsified Damage Claims
> *Customer submits photos that were damaged intentionally, pre-existing, or sourced from internet. EXIF + pixel-level analysis are the signals.*

| Signal | File | Status | How It Works |
|---|---|---|---|
| EXIF date check | [exif.py](file:///c:/hackhuslte/returnguard-ai-main/server/app/engine/exif.py) | ✅ Built | Photo taken BEFORE delivery → score += 90 |
| EXIF GPS distance | exif.py | ✅ Built | Photo GPS 500km+ from delivery address → score += 50 |
| EXIF device model | exif.py | ✅ Built | Missing model = suspicious (AI-generated images lack device info) |
| ELA manipulation | [ela.py](file:///c:/hackhuslte/returnguard-ai-main/server/app/engine/ela.py) | ✅ Built | Re-compression artifacts → clone-stamp/overlay detection |
| Live camera enforcement | exif.py | ✅ Built | `capture_method=live_camera` handles missing EXIF gracefully |
| Missing EXIF detection | exif.py | ✅ Built | No EXIF at all → score += 15 (AI images strip metadata) |

**Enhancement needed**: 
- Add a unified `deepfake_check.py` that combines EXIF + ELA into a clear "AI/Edited/Genuine" classification
- Add detection for AI-generated images (no EXIF + no device model + specific patterns)
- Show image authenticity verdict prominently in the report

---

### Vector 4 — Receipt Manipulation
> *Customer edits receipt date/price in PDF editor, or uses a different product's receipt for a higher-value return.*

| Signal | File | Status | How It Works |
|---|---|---|---|
| PDF hash comparison | [receipt.py](file:///c:/hackhuslte/returnguard-ai-main/server/app/engine/receipt.py) | ✅ Built | SHA-256 of submitted PDF vs stored hash → MISMATCH = score 90 |
| PDF metadata tamper | receipt.py | ✅ Built | modDate >> creationDate → score += 75 |
| Edit tool detection | receipt.py | ✅ Built | Producer field contains Photoshop/Foxit/iLovePDF → flagged |
| Amount cross-reference | receipt.py | ✅ Built | Order amount not found in receipt text → WARN score 35 |
| Receipt verify endpoint | main.py | ✅ Built | `POST /api/v1/receipts/verify` |
| BillingVerification page | BillingVerification.tsx | ✅ Built | Upload PDF → see MATCH/MISMATCH result |

**Status**: ✅ Complete. No changes needed.

---

### Vector 5 — Friendly Fraud (Chargeback Abuse)
> *Customer receives product, keeps it, files bank chargeback claiming "unauthorised transaction".*

| Signal | File | Status | How It Works |
|---|---|---|---|
| Prior chargeback count | [friendly_fraud.py](file:///c:/hackhuslte/returnguard-ai-main/server/app/engine/friendly_fraud.py) | ✅ Built | 3+ chargebacks → score += 80 |
| Payment method risk | friendly_fraud.py | ✅ Built | BNPL=60, credit_card=40, COD=0 |
| Risk tier (BLOCKED) | friendly_fraud.py | ✅ Built | BLOCKED tier → auto score 95 |
| Claim frequency | friendly_fraud.py | ✅ Built | 5+ claims in 180 days → score += 30 |
| Chargeback webhook | main.py | ✅ Built | `POST /api/v1/webhooks/chargeback` |
| Payment method restrictions | main.py | ✅ Built | HIGH tier → only COD/UPI/netbanking |
| Demo scenario seeded | seed.py | ✅ Seeded | `cust_ff_001` with 3 prior chargebacks, HIGH tier |

**Status**: ✅ Complete. No changes needed.

---

### Vector 6 — Organised Return Rings
> *Coordinated groups across synthetic accounts, shared addresses, templated claim text.*

| Signal | File | Status | How It Works |
|---|---|---|---|
| Linguistic fingerprint (TF-IDF) | [linguistic.py](file:///c:/hackhuslte/returnguard-ai-main/server/app/engine/linguistic.py) | ✅ Built | Cosine similarity ≥ 0.65 across customers → ring template detected |
| Address clustering (SHA-256) | [address.py](file:///c:/hackhuslte/returnguard-ai-main/server/app/engine/address.py) | ✅ Built | 3+ customers at same canonical address → ring address |
| Google Address Validation | address.py | ✅ Built | UNRESOLVED address → score += 60 |
| Ring cluster detection | [fusion.py](file:///c:/hackhuslte/returnguard-ai-main/server/app/engine/fusion.py) | ✅ Built | 2+ candidates → logged; 3+ → REJECT escalation (score ≥ 80) |
| Ring velocity stub | fusion.py | ✅ Built | 5+ claims in 7 days from co-located accounts → FAIL |
| Ring graph visualization | AdminDashboard.tsx | ✅ Built | SVG graph showing connected accounts |
| Demo scenario seeded | seed.py | ✅ Seeded | 4-account ring at shared Bengaluru address + templated text |

**Status**: ✅ Complete. No changes needed.

---

## What's Missing (from plan.text Requirements)

| Feature | Priority | Phase |
|---|---|---|
| **User/Admin login system** | 🔴 | 1 |
| **QR code scan → auto video recording** | 🔴 | 2 |
| **Video storage + WhatsApp-style display** | 🔴 | 3 |
| **Category-specific customizable AI questions** | 🔴 | 4 |
| **Unified deepfake/AI image checker** | 🟡 | 5 |
| **Speedometer evaluation report + dual notification** | 🔴 | 6 |
| **Demo flow polish** | 🟡 | 7 |

---

## Phase 1 — Authentication (User = Customer, Admin = Retailer)

### [NEW] `server/app/auth.py`
- JWT-based auth with `PyJWT` (add to requirements.txt)
- Password hashing with `hashlib` (no bcrypt needed for demo)
- Two roles: `user`, `admin`
- Pre-seeded demo accounts (created in seed.py):

| Username | Password | Role | Linked Customer |
|---|---|---|---|
| `admin` | `admin123` | admin | — |
| `maya` | `user123` | user | cust_maya_demo |
| `priya` | `user123` | user | cust_priya |

### [NEW] Backend endpoints
```
POST /api/v1/auth/login    → { token, role, customer_id, username }
GET  /api/v1/auth/me       → current user info (from JWT)
```

### [NEW] `client/src/pages/LoginPage.tsx`
- Two tabs: **Customer Login** / **Retailer Login**
- Premium design: gradient background, glassmorphism card
- On success → redirect based on role

### [MODIFY] `client/src/App.tsx`
- Auth context provider wrapping all routes
- Nav changes based on role:
  - **Customer**: Home | Scan QR | My Returns | File Return
  - **Retailer**: Dashboard | Reports | Question Config | Fraud Ops

### [MODIFY] `client/src/main.tsx`
```
/login                      → LoginPage
/customer/home              → CustomerHome (my orders, my returns)
/customer/scan              → QRScanPage
/customer/record/:orderId   → VideoRecordPage
/customer/return/:orderId   → ReturnForm (pre-filled)
/customer/status/:claimId   → ClaimStatus + AI chat + speedometer
/admin                      → AdminDashboard (enhanced)
/admin/report/:claimId      → EvaluationReport (detailed)
/admin/questions             → AdminQuestionConfig
/demo                       → DemoPanel (no auth required)
```

### [MODIFY] `server/app/schema.sql`
```sql
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  customer_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
```

---

## Phase 2 — QR Code Scan → Live Video Recording (≤ 5 min)

### [NEW] `server/app/engine/qr_generator.py`
- Uses `qrcode[pil]` to generate QR PNG
- QR encodes: `{base_url}/customer/record/{order_id}?token={sha256(order_id+pepper)[:8]}`
- Validates token on scan to prevent URL guessing

### [NEW] Backend endpoints
```
POST /api/v1/orders/{order_id}/qr         → { qr_base64, scan_url }
GET  /api/v1/qr/validate?order_id&token   → { valid, order_info }
POST /api/v1/claims/video                 → upload video → save to disk + DB
GET  /api/v1/claims/{claim_id}/video      → stream video (StreamingResponse)
GET  /api/v1/orders/{order_id}/videos     → list all videos for order
GET  /api/v1/admin/videos                 → all recent videos (retailer)
```

### [NEW] `client/src/pages/QRScanPage.tsx`
- Uses `html5-qrcode` library to scan QR codes via camera
- On scan → validates token → redirects to video recording

### [NEW] `client/src/pages/VideoRecordPage.tsx`
- **Auto-starts camera on page load** (no delay)
- `MediaRecorder` API records WebM (video + audio)
- Features:
  - Live preview with red recording dot + timer
  - Date/time overlay (canvas compositing)
  - Max 5 minutes (auto-stop at 4:30 with warning)
  - Min 5 seconds
  - Stop → preview → Submit or Re-record
  - Upload progress bar
- On submit → `POST /api/v1/claims/video` → redirect to return form

### [MODIFY] `server/app/schema.sql`
```sql
CREATE TABLE IF NOT EXISTS claim_videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL,
  customer_id TEXT,
  claim_id TEXT,
  video_path TEXT NOT NULL,
  duration_seconds REAL,
  file_size_bytes INTEGER,
  recorded_at TEXT DEFAULT (datetime('now')),
  uploaded_at TEXT DEFAULT (datetime('now'))
);
```

### [MODIFY] `server/app/main.py`
- Video upload endpoint (50MB limit)
- Video streaming endpoint (`StreamingResponse`)
- Link video to claim when return form submitted

---

## Phase 3 — WhatsApp-Style Video Display (Retailer Side)

### [NEW] `client/src/components/VideoMessage.tsx`
- WhatsApp-style message bubble:
  - Video thumbnail with ▶ play overlay
  - Click → inline player expands
  - Below video: timestamp in format "12:34 PM · 30 Apr 2026"
  - Delivery ticks (✓✓ = stored in DB)
  - File size + duration metadata

### [NEW] `client/src/components/VideoTimeline.tsx`
- Chronological view of all videos + messages for a claim
- Each video shows:
  - WhatsApp-style bubble
  - Package details below (order ID, product, delivery date)
  - "Stored in database at: [timestamp]" indicator

### [MODIFY] `client/src/pages/AdminDashboard.tsx`
- Add **Videos** tab alongside existing Queue/Rings tabs
- Real-time: polls every 2s, new videos slide in with animation
- Each video card: customer ID, thumbnail, timestamp, "NEW" badge

---

## Phase 4 — Category-Specific Customizable AI Questions

### [NEW] `server/app/evaluation_engine/category_questions.py`

Default question bank (stored in DB, fully customizable):

**Electronics** — damaged:
1. "Can you show the serial number on the device?" (photo, required)
2. "When did you first notice the damage?" (text, required)
3. "Can you take a close-up photo of the damaged area?" (photo, required)
4. "Is the device powering on?" (text, required)
5. "Was the packaging damaged on delivery?" (text, optional)

**Apparel / Dress / Saree** — damaged:
1. "Can you upload a photo showing the defect?" (photo, required)
2. "Is the price tag still attached?" (text, required)
3. "Was the garment washed or worn before noticing the issue?" (text, required)
4. "Can you show the care label?" (photo, optional)

**Home Appliances** — damaged:
1. "Can you upload a photo of the damaged appliance?" (photo, required)
2. "Is the outer packaging also damaged?" (photo, required)
3. "Have you tried plugging it in? Does it work?" (text, required)
4. "Was there visible damage at delivery?" (text, optional)

**Home Appliances** — defective:
1. "What happens when you turn it on?" (text, required)
2. "Can you upload a short video showing the defect?" (video, required)
3. "Have you checked the voltage/power supply?" (text, optional)

**Beauty & Personal Care** — damaged:
1. "Can you upload a photo of the damaged product?" (photo, required)
2. "Was the seal broken when you received it?" (text, required)

**Baby Products** — damaged:
1. "Can you upload a photo of the damaged item?" (photo, required)
2. "Was the packaging intact on delivery?" (text, required)

### [MODIFY] `server/app/schema.sql`
```sql
CREATE TABLE IF NOT EXISTS category_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  question_text TEXT NOT NULL,
  question_type TEXT DEFAULT 'text',
  required INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);
```

### [NEW] Backend endpoints
```
GET  /api/v1/categories/questions                    → full question bank
PUT  /api/v1/categories/{category}/questions          → update questions
POST /api/v1/categories/{category}/questions          → add question
DELETE /api/v1/categories/{category}/questions/{id}   → remove question
```

### [MODIFY] `server/app/evaluation_engine/runner.py`
- `_build_initial_context()` fetches questions from `category_questions` table
- Injects into Gemini system prompt: *"For [apparel/damaged], ask these questions in order: [1, 2, 3...]"*
- After gathering info, AI confirms identity: *"So to confirm — you ordered [product] on [date], and you're reporting [issue]. Is that correct?"*
- Then evaluates evidence and calls `issue_decision`

### [MODIFY] `server/app/evaluation_engine/prompts.py`
- Add category question injection template to system prompt

### [NEW] `client/src/pages/AdminQuestionConfig.tsx`
- Retailer UI to add/edit/delete/reorder questions per category
- Toggle required/optional
- Live preview of how questions appear to customer

---

## Phase 5 — Enhanced Deepfake / AI Image Detection

### [NEW] `server/app/engine/deepfake_check.py`
Combines EXIF + ELA into a single authenticity verdict:

```python
def check_image_authenticity(photo_path, order) -> dict:
    """
    Returns:
      is_genuine: bool
      confidence: float (0-1)
      verdict: 'GENUINE' | 'AI_GENERATED' | 'EDITED' | 'SUSPICIOUS'
      signals: list of detected anomalies
    """
```

**Signals checked:**
1. EXIF presence (AI images have zero EXIF)
2. Device model present (real cameras embed this)
3. GPS location vs delivery address consistency
4. ELA manipulation score (edited regions glow)
5. Photo date vs claim date consistency
6. Software/editor field in metadata (Photoshop, GIMP = edited)
7. Image dimensions (AI images often use specific resolutions like 1024×1024)

**Classification logic:**
- No EXIF + no device + standard AI resolution → `AI_GENERATED`
- Has EXIF but modDate >> creationDate or editor in software field → `EDITED`
- ELA score ≥ 70 → `EDITED`
- All checks pass → `GENUINE`

### [MODIFY] `server/app/engine/fusion.py`
- Add deepfake_check as an additional evidence item
- Show in report as "Image Authenticity: GENUINE / AI_GENERATED / EDITED"

---

## Phase 6 — Speedometer Report + Dual Notification

### [NEW] `client/src/components/SpeedometerGauge.tsx`
- Animated SVG speedometer (0–100 scale)
- Color zones: 🟢 0-34 (APPROVE) | 🟡 35-64 (BORDERLINE) | 🔴 65-100 (REJECT)
- Needle animates from 0 → final score on load
- Below: decision text + confidence

### [NEW] `client/src/pages/EvaluationReport.tsx`
**Customer view** (simplified):
- Large speedometer gauge
- Decision: "Return Approved ✓" / "Under Review ⚠" / "Return Denied ✗"
- Next steps
- Evidence summary (no fraud terminology — customer-friendly)

**Retailer view** (detailed):
- Speedometer gauge
- Image authenticity verdict (GENUINE/AI/EDITED with confidence)
- Full signal breakdown table (all signals with scores + verdicts)
- Video playback (WhatsApp style)
- AI chat transcript
- Action buttons: Confirm Legit / Confirm Fraud / Escalate

### [NEW] Backend endpoint
```
GET /api/v1/claims/{claim_id}/report → {
  claim, order, customer, evidence[], videos[],
  chat_turns[], deepfake_check, decision, score, fraud_context
}
```

### Dual Notification
- **Customer**: ClaimStatus page auto-refreshes → speedometer animates + decision banner
- **Retailer**: Dashboard toast notification + row highlight for new decisions
- Both sides see the **same score** simultaneously


### Browser E2E Tests (10)

| # | Test | Expected |
|---|---|---|
| 1 | Login as customer → see customer nav | Customer home loads |
| 2 | Login as admin → see retailer nav | Admin dashboard loads |
| 3 | QR scan → camera opens → record 10s → submit | Video uploads, redirects to form |
| 4 | Video appears in retailer dashboard (Videos tab) | WhatsApp-style bubble with timestamp |
| 5 | File apparel/damaged return → AI asks garment questions | Tag, defect photo, worn question |
| 6 | File electronics/damaged return → AI asks electronics questions | Serial number, damage photo |
| 7 | Upload edited image → deepfake check flags it | "EDITED" verdict in report |
| 8 | Evaluation completes → customer sees speedometer | Needle animates, decision shown |
| 9 | Evaluation completes → retailer sees toast + report | Notification + detailed report |
| 10 | Admin customizes questions → reflected in next chat | Updated questions used by AI |

### Fraud Vector Demo Tests (6)

| Vector | Scenario | Expected Signals |
|---|---|---|
| **Wardrobing** | ₹45K lehenga returned 1 day after delivery | wardrobing FAIL (60+), seasonal peak |
| **INR Abuse** | Claim 1h after GPS-confirmed delivery, 2 prior INR | inr FAIL (90+ if OTP, 60+ otherwise) |
| **Falsified Damage** | Photo with EXIF date before delivery | exif FAIL (90), deepfake "SUSPICIOUS" |
| **Receipt Manipulation** | Tampered PDF (modDate >> creationDate) | receipt FAIL (75) |
| **Friendly Fraud** | 3 prior chargebacks, BNPL payment | friendly_fraud FAIL (80+) |
| **Organised Ring** | 4th ring member, shared address + text template | linguistic FAIL + address FAIL + ring_cluster FAIL, auto-REJECT |
