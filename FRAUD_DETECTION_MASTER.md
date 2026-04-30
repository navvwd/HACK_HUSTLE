# Return Fraud Detection — Master Specification

*Unified reference covering the full detection pipeline: return rings, INR abuse, receipt manipulation, and falsified damage claims.*

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [System Architecture Overview](#2-system-architecture-overview)
3. [End-to-End Request Lifecycle](#3-end-to-end-request-lifecycle)
4. [Module A — Return Ring Detection (Five-Layer Pipeline)](#4-module-a--return-ring-detection-five-layer-pipeline)
5. [Module B — INR (Item Not Received) Abuse Detection](#5-module-b--inr-item-not-received-abuse-detection)
6. [Module C — Receipt Manipulation Detection](#6-module-c--receipt-manipulation-detection)
7. [Module D — Falsified Damage Claims Detection](#7-module-d--falsified-damage-claims-detection)
8. [Fusion Engine — Combining All Modules](#8-fusion-engine--combining-all-modules)
9. [Decision Tiers](#9-decision-tiers)
10. [Tech Stack Summary](#10-tech-stack-summary)
11. [Database Schema Master Reference](#11-database-schema-master-reference)
12. [Build Priority](#12-build-priority)
13. [Key Design Principles](#13-key-design-principles)

---

## 1. Problem Statement

Return fraud takes four distinct forms, each requiring its own detection strategy:

| Fraud type | How it works | Primary detection module |
|---|---|---|
| **Return rings** | Coordinated groups operating across dozens of synthetic or stolen accounts, rotating through addresses and devices, submitting high-value claims that individually look legitimate but collectively form a network signature | Module A |
| **INR abuse** | Customer claims a package was never received when they actually have it | Module B |
| **Receipt manipulation** | Customer edits a receipt PDF (amount, date, item name) or submits a receipt from a different retailer | Module C |
| **Falsified damage claims** | Customer submits a downloaded, pre-existing, or manipulated photo to claim a product arrived damaged | Module D |

**The unifying problem:** no single request raises a red flag. The signal is always in the pattern — across claims, across signals, across time. The detection system must find that pattern without creating friction for the ~70% of customers who never commit fraud.

**The non-negotiable constraint:** the false positive rate is more damaging than the fraud rate for any individual case. A falsely blocked legitimate customer is a customer lost. A missed fraudster loses one claim. Design every module to protect the innocent first.

---

## 2. System Architecture Overview

All four modules feed into a shared fusion engine. The fusion engine applies the corroboration rule and maps to a final decision tier.

```
Customer opens return / claim form
              │
              ▼
┌─────────────────────────────────────────────────────────────┐
│  Signal Collection Layer (client-side JS, silent)           │
│  Device fingerprint · Behavioral biometrics · Session meta  │
└─────────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────┐
│  Feature Extraction (backend, per request)                  │
│  Fingerprint DB lookup · Behavioral delta · Feature store   │
└─────────────────────────────────────────────────────────────┘
              │
              ├──────────────────────────────────────────────────────┐
              │                                                      │
              ▼                                                      ▼
┌─────────────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  Module A           │  │  Module B    │  │  Module C    │  │  Module D    │
│  Return Ring        │  │  INR         │  │  Receipt     │  │  Damage      │
│  Detection          │  │  Detection   │  │  Manipulation│  │  Claims      │
│  (device/behavior/  │  │  (GPS/engage/│  │  (hash/meta/ │  │  (EXIF/ELA/  │
│   graph scorers)    │  │   OTP/ring)  │  │   ELA/QR)    │  │   vision/    │
└─────────────────────┘  └──────────────┘  └──────────────┘  │   route)     │
              │                │                 │            └──────────────┘
              └────────────────┴─────────────────┴────────────────┘
                                       │
                                       ▼
              ┌──────────────────────────────────────────┐
              │  Fusion Engine                           │
              │  Weighted sum · Corroboration rule       │
              │  Decay function · Context-aware weights  │
              └──────────────────────────────────────────┘
                                       │
                                       ▼
              ┌──────────────────────────────────────────┐
              │  Decision Tiers                          │
              │  Green · Amber · Orange · Red            │
              └──────────────────────────────────────────┘
                                       │
                                       ▼
              ┌──────────────────────────────────────────┐
              │  Learning Loop                           │
              │  Human review → labels → retrain         │
              └──────────────────────────────────────────┘
```

---

## 3. End-to-End Request Lifecycle

### Stage 1 — Page Load (t = 0ms)

The customer navigates to the return or claims form. Before they fill in a single field:

- FingerprintJS v3 bundle loads silently
- Canvas, WebGL, audio, font signals collected → combined into a stable device hash
- Behavioral event listeners attach to all form fields
- No network requests fired yet — collection is entirely client-side

### Stage 2 — Form Submission (t = user action)

The customer clicks submit. Everything collected in Stage 1 travels with the form payload:

- Form data (order ID, reason code, condition, photo/receipt if attached)
- Device fingerprint hash sent as `X-Device-ID` request header
- Behavioral event stream compressed and included in request body
- Session context: IP, user agent, timestamp

### Stage 3 — API Ingestion (t + 5ms)

FastAPI receives the request. Immediately:

- PostgreSQL fingerprint lookup runs
- Behavioral delta computed against stored account profile
- Feature store written (Redis for latency, Postgres for persistence)
- Claim type is detected from the request → context-aware scorer selection
- Module-specific scorer tasks spawned concurrently via `asyncio.gather`

### Stage 4 — Scoring (t + 5ms to t + 120ms)

Depending on claim type, the relevant module scorers run:

| Scorer | Typical latency |
|--------|----------------|
| Device scorer (Module A) | ~10ms — PostgreSQL query |
| Behavior scorer (Module A) | ~20ms — Z-score computation |
| Graph scorer (Module A) | ~80ms — community detection |
| GPS verification (Module B) | ~30ms — geocode + distance |
| Engagement scorer (Module B) | ~20ms — engagement events query |
| OTP check (Module B) | ~5ms — single field lookup |
| Receipt hash check (Module C) | ~15ms — hash comparison |
| PDF metadata analysis (Module C) | ~50ms — PyMuPDF extraction |
| EXIF analysis (Module D) | ~30ms — exifread extraction |
| Reverse image search (Module D) | ~200ms — Google Vision API |
| Route cross-reference (Module D) | ~25ms — aggregate query |

All scorers within a module run concurrently. Total latency is the slowest scorer.

### Stage 5 — Fusion (t + 120ms)

- Weighted sum computed with context-aware weights (see Section 8)
- Corroboration rule checked: cannot escalate above amber unless ≥2 scorers exceed 40
- Decay applied to stale signals
- Final score and tier determined

### Stage 6 — Response Assembly (t + 125ms)

- Decision written to audit log with all scorer outputs and explanation strings
- Response payload assembled for the appropriate tier
- HTTP response returned

### Stage 7 — Customer UX (~t + 150ms total)

| Tier | HTTP status | Customer message |
|------|------------|-----------------|
| Green | 200 | "Return approved — refund in 3–5 days" |
| Amber | 200 | Photo upload step rendered (feels like standard process) |
| Orange | 202 | "Your return is under review — you'll hear back within 24 hours" |
| Red | 200 (never 403) | "Additional verification required" + appeal link |

### Stage 8 — Learning Loop (async, post-response)

- Human review decisions in the orange queue become labelled training examples
- Confirmed fraud: all accounts linked to that device hash receive +30 risk flag
- False positive: behavioral profile baseline recomputed with the session included
- Celery scheduled task reruns scorer weight optimisation on last 30 days of labelled decisions weekly

---

## 4. Module A — Return Ring Detection (Five-Layer Pipeline)

### Layer 1 — Signal Collection

**Runs:** Client-side JavaScript, the moment the return form loads. **Visible to user:** Nothing.

#### Device Fingerprinting

The browser builds a stable device hash before the customer fills in a single field. The hash survives VPN switches and incognito mode — the only way to defeat it is to use a completely different physical device.

| Signal | Method |
|--------|--------|
| Canvas fingerprint | Render a hidden 200×50 canvas with specific text and shapes. Hash the pixel output — GPU differences produce measurably different values |
| WebGL renderer string | Query GPU vendor and model string directly — changes only on hardware swap |
| Screen resolution + pixel ratio | `window.screen` and `devicePixelRatio` |
| Font detection | Measure character rendering widths for test fonts — installed fonts produce different values |
| Audio context hash | Render an oscillator node and hash the floating-point output |
| Battery state | Charge level and charging status via Battery API |
| Touch capability | `navigator.maxTouchPoints` |
| Timezone offset | `Intl.DateTimeFormat().resolvedOptions().timeZone` |

All signals combine into a single stable hash — the **device ID**.

#### Behavioral Biometrics

Passive event listeners attach to the form and record:

- **Dwell time** per key — how long each key is held down
- **Flight time** between keystrokes
- **Mouse movement velocity vectors**
- **Scroll rhythm** — speed and pattern
- **Time from page load to first interaction**

A genuine returning user is remarkably consistent across sessions. A fraudster using stolen credentials interacts differently than the account owner.

---

### Layer 2 — Feature Extraction

**Runs:** Backend, on every return request. **Stack:** PostgreSQL (persistence), Redis (speed).

#### Fingerprint Database Lookup

```sql
fingerprint_hash  |  account_ids[]  |  first_seen_at
```

- New hash → insert new record
- Known hash → append the current account to the array
- The account array is the primary input to the device scorer

#### Behavioral Profile Delta

On the **first session** for an account, the behavioral event stream becomes the stored baseline. On **subsequent sessions**, the system computes a Z-score deviation from the historical mean. A deviation above 2σ indicates a different person is operating the account.

#### Feature Store Write

Session metadata — IP, user agent, return shipping address, target SKU, order timestamp — is written to the feature store. This feeds the graph scorer and creates the edges needed for ring detection.

---

### Layer 3 — Three Parallel Scorers

**Runs:** Concurrently via `asyncio.gather`. **Output:** Each scorer independently produces 0–100.

#### Scorer 1 — Device Scorer

Answers: how many distinct accounts share this fingerprint hash?

| Accounts on device | Score |
|--------------------|-------|
| 1 | 0 |
| 2 | 20 |
| 5 | 60 |
| 10+ | 90 |

The relationship is exponential beyond three. Two accounts on one device has an innocent explanation. Five does not.

#### Scorer 2 — Behavior Scorer

Answers: how much does this session deviate from the account owner's stored profile?

| Deviation | Score |
|-----------|-------|
| Below 1σ | 0 |
| 1–2σ | 30 |
| Above 2σ | 70 |
| Above 3σ | 90 |

This is the **account takeover detector**. A fraudster using stolen credentials types and moves differently than the person who built the stored profile.

#### Scorer 3 — Graph Scorer

Answers: does this account belong to a coordinated cluster?

Builds a graph where nodes are accounts, device fingerprints, shipping addresses, and IP subnets. Edges connect them when they appear together in the same return request. Community detection (Louvain or label propagation) identifies clusters.

| Cluster size | Score |
|-------------|-------|
| Isolated account | 0 |
| Cluster of 3 | 25 |
| Cluster of 8+ | 80 |
| 15+ accounts, created same week, all targeting high-value SKUs | 95 |

---

### Layer 4 — Fusion Engine

See **Section 8** for the full fusion specification. The three Module A scorers feed in with weights: device 0.35, behavior 0.30, graph 0.35.

#### The VPN Problem — Solved

A fraud ring member switches VPNs between every submission. IP address changes every time.

- IP address → different every time → graph edge via IP subnet weakened
- Device fingerprint → identical every time → GPU, fonts, audio hardware do not change with VPN
- Behavioral pattern → consistent typing rhythm across all submissions

Ten accounts, ten VPN IPs, one physical laptop: device scorer fires at 90, graph scorer builds a cluster around that fingerprint. Two independent scorers corroborate → orange or red outcome.

The only real defence is ten separate physical devices, ten separate networks, deliberately trained different behavioral patterns — operationally expensive and introduces timing coordination that makes the ring more visible, not less.

---

### Layer 5 — Decision Tiers

See **Section 9** for the full tier specification.

---

## 5. Module B — INR (Item Not Received) Abuse Detection

### The Three Real Scenarios

| Scenario | What happened | Correct response |
|---|---|---|
| Genuine non-delivery | Carrier misdelivered | Refund. Carrier is liable. |
| Genuine theft | Package stolen after correct delivery | Refund. Customer is innocent. |
| INR abuse | Customer received the package and is lying | Deny with evidence. |

The detection system must separate scenario 3 from scenarios 1 and 2. Misidentifying scenario 1 or 2 as fraud is severe — the customer did nothing wrong.

---

### Signal 1 — GPS Delivery Verification

Every carrier webhook for `SHIPMENT_DELIVERED` must store `gps_lat`, `gps_lng`, `accuracy_m`, `photo_url`, and `left_at` in the `shipment_deliveries` table permanently — this is chargeback evidence.

```sql
CREATE TABLE shipment_deliveries (
  shipment_id     TEXT PRIMARY KEY,
  order_id        TEXT NOT NULL,
  account_id      TEXT NOT NULL,
  delivered_at    TIMESTAMP NOT NULL,
  driver_id       TEXT,
  gps_lat         NUMERIC(9,6),
  gps_lng         NUMERIC(9,6),
  gps_accuracy_m  INT,
  photo_url       TEXT,
  left_at         TEXT,
  otp_confirmed   BOOLEAN DEFAULT false,
  otp_required    BOOLEAN DEFAULT false,
  otp_timestamp   TIMESTAMP,
  raw_payload     JSONB,
  created_at      TIMESTAMP DEFAULT now()
);
```

#### The 200-Metre Rule

```python
from geopy.distance import geodesic

def score_gps_verification(shipment_id: str, claim: INRClaim) -> GPSSignal:
    delivery = db.get(ShipmentDelivery, shipment_id)
    if not delivery or not delivery.gps_lat:
        return GPSSignal(score=0, verdict="NO_GPS_DATA",
                         reason="Carrier did not provide GPS coordinates")

    distance_m = geodesic(
        (delivery.gps_lat, delivery.gps_lng),
        geocode(claim.delivery_address)
    ).meters

    if distance_m > 500:
        # Driver was far from address — likely misdelivery. Customer is innocent.
        return GPSSignal(score=0, verdict="LIKELY_MISDELIVERY",
                         reason=f"Driver scanned {distance_m:.0f}m from address")
    elif distance_m > 150:
        return GPSSignal(score=20, verdict="GPS_MARGINAL")
    else:
        return GPSSignal(score=55, verdict="GPS_CONFIRMED")
```

**Why GPS confirmation scores 55, not 100:** GPS confirms the driver was there — not that the customer received it. The package could have been left and stolen. GPS is necessary but not sufficient.

---

### Signal 2 — Post-Delivery Engagement

After delivery, a customer who received the item interacts with it. A customer who genuinely did not receive it has no product-linked activity after the delivery date. **This is the strongest single signal for INR fraud.**

```python
ENGAGEMENT_TRIGGERS = {
    "APP_LOGIN_POST_DELIVERY":      40,
    "PRODUCT_APP_LOGIN":            60,
    "WARRANTY_REGISTERED":          80,
    "QR_SCAN_PACKAGING":            90,
    "PRODUCT_REVIEW_SUBMITTED":     85,
    "WISHLIST_REMOVED_SAME_SKU":    50,
    "REORDER_SAME_SKU":             70,
    "RETURN_INITIATED_DIFFERENT":   30,
}
```

```sql
CREATE TABLE engagement_events (
  id            SERIAL PRIMARY KEY,
  account_id    TEXT NOT NULL,
  order_id      TEXT NOT NULL,
  event_type    TEXT NOT NULL,
  occurred_at   TIMESTAMP NOT NULL,
  metadata_json JSONB,
  created_at    TIMESTAMP DEFAULT now()
);
CREATE INDEX idx_engagement_order   ON engagement_events (order_id, occurred_at);
CREATE INDEX idx_engagement_account ON engagement_events (account_id, event_type);
```

**Critical false positive protection:** no engagement data returns score 0, not a high score. Absence of engagement is not evidence of fraud — it is simply the absence of evidence. Many legitimate customers never log into apps, register warranties, or leave reviews.

---

### Signal 3 — Customer INR History

| Prior INR claims (12 months) | Score |
|------------------------------|-------|
| 0 | 0 |
| 1 | 25 |
| 2 | 55 |
| 3+ | 80 |

**Value escalation sub-signal:** if each successive INR claim is larger than the last, the account is testing the system. Three strictly escalating claims → +35 score.

---

### Signal 4 — Address and Neighbourhood Intelligence

**The most important false positive protection in the INR module:** some buildings and neighbourhoods have genuine delivery problems. If multiple customers at the same address report INR, the problem is the carrier, not the customers.

```python
def score_address_inr_intelligence(delivery_address, account_id):
    # Multiple DISTINCT accounts at same address = delivery problem, not fraud
    if distinct_accounts >= 5:
        return AddressINRSignal(
            score=0, verdict="BUILDING_DELIVERY_PROBLEM",
            reason=f"{distinct_accounts} different customers at this address "
                   f"reported INR — carrier issue, escalate to carrier ops"
        )
    # Same account, same address, multiple claims = fraud
    if account_claims_here >= 2:
        return AddressINRSignal(score=65, verdict="REPEAT_ACCOUNT_SAME_ADDRESS")
```

High RTO-rate pincodes apply a **negative weight** (−10) — reducing suspicion for areas with known delivery problems.

---

### Signal 5 — OTP Delivery Confirmation (Preventive)

OTP at doorstep converts INR from a detective problem into a preventive one. Once the customer's phone confirms receipt, no INR claim can succeed.

| Order value | OTP required | Signature required | Delivery photo |
|---|---|---|---|
| Under ₹500 / $10 | No | No | No |
| ₹500–₹2,000 / $10–$40 | No | No | Yes |
| ₹2,000–₹10,000 / $40–$200 | Yes | No | Yes |
| Above ₹10,000 / $200 | Yes | Yes | Yes |

When `otp_confirmed = true`: score 92 — customer's own registered mobile confirmed delivery.

**Why not universal:** OTP adds 2–3 minutes per delivery. At 10,000 deliveries per day that is 500 hours of added fleet time. Rural areas with poor mobile signal produce OTP failures that create false unconfirmed records. Value-tiered approach gives full protection where fraud is costly and zero friction where it is not.

---

### Signal 6 — Ring Detection for INR

Reuses the device fingerprint and graph infrastructure from Module A. Multiple accounts on the same device filing INR claims, or a known fraud cluster submitting 5+ INR claims in 30 days → score 75–85.

---

### Complete INR Scorer

```python
async def score_inr_claim(claim, order, account_id):
    gps_sig, engage_sig, history_sig, addr_sig, otp_sig, ring_sig = \
        await asyncio.gather(
            score_gps_verification(claim.shipment_id, claim),
            score_post_delivery_engagement(order.id, order.delivered_at, claim),
            score_inr_history(account_id, claim),
            score_address_inr_intelligence(claim.delivery_address, account_id),
            check_otp_confirmation(claim.shipment_id),
            score_inr_ring_detection(account_id, claim)
        )

    # Hard exits — short-circuit before fusion
    if gps_sig.verdict == "LIKELY_MISDELIVERY":
        return INRResult(decision="REFUND_CARRIER_FAULT", score=0)
    if addr_sig.verdict == "BUILDING_DELIVERY_PROBLEM":
        return INRResult(decision="REFUND_ESCALATE_CARRIER", score=0)

    # Weighted fusion — engagement has highest weight (most definitive signal)
    raw = (
        gps_sig.score     * 0.25
      + engage_sig.score  * 0.30
      + history_sig.score * 0.15
      + addr_sig.score    * 0.10
      + otp_sig.score     * 0.10
      + ring_sig.score    * 0.10
    )

    # Corroboration amplifier: 2+ hard signals above 60 → +20%
    high = sum(1 for s in [gps_sig.score, engage_sig.score,
                            otp_sig.score, ring_sig.score] if s >= 60)
    if high >= 2:
        raw = min(raw * 1.20, 100)

    return INRResult(score=round(raw))
```

---

### INR Decision Mapping

| INR score | Decision | Customer experience |
|---|---|---|
| Hard exit: misdelivery | Auto-refund + carrier complaint filed | "We've identified a delivery issue and processed your refund" |
| Hard exit: building problem | Auto-refund + carrier escalation | Same as above |
| 0–30 | Auto-refund | Instant. No friction. |
| 31–55 | Carrier investigation | "We've raised an investigation. Refund within 3–5 days." |
| 56–75 | Agent review | "Your claim is under review. You'll hear back within 24 hours." |
| 76–100 | Hold + evidence package | Agent reviews GPS, engagement log, OTP record. Appeal path always shown. |

---

### Chargeback Evidence Package

When a chargeback is filed, auto-assemble from stored data: delivery timestamp, GPS coordinates, distance from address, delivery photo URL, OTP confirmation status, post-delivery activity log, carrier driver ID. Exported as PDF for bank dispute submission.

---

## 6. Module C — Receipt Manipulation Detection

### The Fundamental Rule

Your database is the source of truth, not the document. Every check reduces to: **does the submitted receipt match what your system generated?**

### Four Attack Types

| Attack type | What the fraudster does | Detection approach |
|---|---|---|
| Field editing | Edits amount/date/item name in PDF | DB cross-reference + hash mismatch |
| Receipt substitution | Submits a different product's receipt | Order ID lookup + consistency check |
| Date manipulation | Edits purchase date to fall inside return window | DB cross-reference + PDF metadata delta |
| External receipt | Submits receipt from a different retailer | Issuer detection + visual template check |

---

### Method 1 — DB Cross-Reference (implement first, catches ~85% of cases)

```python
def cross_reference_receipt(extracted: ExtractedReceiptData) -> SignalResult:
    order = db.query(Order).filter_by(order_id=extracted.order_id).first()

    if not order:
        return SignalResult(score=90, reason="order_id_not_found")

    mismatches = []
    if abs(extracted.amount - order.amount) > 0.01:
        mismatches.append(f"amount: submitted ₹{extracted.amount}, actual ₹{order.amount}")
    if extracted.item_name.lower() not in order.item_name.lower():
        mismatches.append(f"item mismatch: '{extracted.item_name}' vs '{order.item_name}'")
    if extracted.date != order.purchase_date:
        mismatches.append(f"date: submitted {extracted.date}, actual {order.purchase_date}")

    if mismatches:
        return SignalResult(score=95, reason="field_mismatch", detail="; ".join(mismatches))
    return SignalResult(score=0, reason="receipt_verified")
```

---

### Method 2 — Cryptographic Hash Comparison

At PDF generation time, compute and store a SHA-256 hash of the raw bytes:

```python
def store_receipt_hash(order_id: str, pdf_bytes: bytes):
    h = hashlib.sha256(pdf_bytes).hexdigest()
    db.execute(
        "INSERT INTO receipt_hashes (order_id, hash, created_at) VALUES (%s, %s, now())",
        (order_id, h)
    )
```

At submission, recompute and compare. **One character changed anywhere in the PDF produces a completely different hash.** This is binary: either it matches or it doesn't.

---

### Method 3 — PDF Metadata Analysis

Every PDF carries internal metadata that reveals its creation history. Key signals:

| Metadata field | What to check | Fraud signal |
|---|---|---|
| `creationDate` | Should be close to order date | Gap > 7 days is suspicious |
| `modDate` | Should equal `creationDate` | Any difference means post-creation edit |
| `creator` | Should be your billing system name | Anything else is a red flag |
| `producer` | PDF library used | Adobe Acrobat Edit, Foxit, SmallPDF, ilovePDF = flag |
| `author` | Should be blank or system name | Customer name here = manually created |

Editing tools that score +35 when found in the `producer` field: Adobe Acrobat (edit mode), Foxit, PDF-XChange, SmallPDF, ilovePDF, Sejda, PDFescape, macOS Preview.

---

### Method 4 — ELA Visual Analysis (for external receipts)

When a PDF is edited, the modified region contains text re-compressed at a different quality level. Error Level Analysis (ELA) reveals these inconsistencies by re-saving the page as JPEG at known quality and computing pixel-level differences. Edited regions appear as bright spots.

```python
def run_ela_on_receipt(pdf_bytes: bytes) -> SignalResult:
    # Render PDF page → re-save as JPEG → compute difference
    # Bright pixel ratio > 3% = strong editing signal (score 70)
    # Bright pixel ratio > 1% = minor signal (score 35)
```

**Limitation:** only run ELA on digital PDFs. For scanned images (`source_file == "image"`), disable ELA — poor quality originals trigger false positives.

---

### Method 5 — QR Code Signing (future-proof, implement on new receipts)

Print a server-signed QR code on every generated receipt. The fraudster can edit the PDF amount but cannot forge the QR signature without the server-side secret key.

```python
def generate_receipt_qr(order: Order) -> bytes:
    payload = {"order_id": order.order_id, "amount": str(order.amount),
               "date": order.purchase_date.isoformat(), "item": order.item_name}
    msg = json.dumps(payload, sort_keys=True).encode()
    sig = hmac.new(SECRET_KEY.encode(), msg, hashlib.sha256).hexdigest()
    payload["sig"] = sig
    # Embed as QR in generated PDF
```

---

### Receipt Scorer — Combining All Methods

```python
def score_receipt_manipulation(pdf_bytes, extracted):
    # Method 1: DB cross-reference (always run — early exit if definitive)
    r1 = cross_reference_receipt(extracted)
    if r1.score >= 85:
        return r1.score, results   # Terminate early — definitive mismatch

    # Method 2: Hash comparison
    r2 = verify_receipt_hash(extracted.order_id, pdf_bytes)

    # Method 3: Metadata analysis
    r3 = analyse_pdf_metadata(pdf_bytes)

    # Method 4: ELA only if no stored hash (old/external receipt)
    r4 = run_ela_on_receipt(pdf_bytes) if r2.reason == "no_stored_hash" else SignalResult(0)

    # Method 5: QR if extracted
    if extracted.qr_data:
        r5 = verify_receipt_qr(extracted.qr_data, extracted.amount)
        if r5.score >= 90:
            return r5.score, results

    # Combine: two-highest weighted sum
    scores = sorted([r1.score, r2.score, r3.score, r4.score], reverse=True)
    combined = scores[0] * 0.6 + scores[1] * 0.4
    return int(min(combined, 100)), results
```

**Why take the two highest rather than average all:** averaging dilutes a definitive hash mismatch (85) with uninformative clean signals (0). Two-highest combination respects that any single strong independent signal is meaningful evidence.

---

### Receipt False Positive Protections

| Scenario | Risk | Mitigation |
|---|---|---|
| Customer re-saved PDF from email | Hash mismatch (email clients re-encode) | Fall back to DB cross-reference; only block if DB also mismatches |
| OCR extraction error on amount | Appears as mismatch | Route to orange (human review), not auto-deny |
| Old receipt before hash system | No hash on record | Skip Method 2; rely on Methods 1, 3, 4 |
| Legitimate shared receipt (gift) | Different name | Flag for soft verification, not block |
| PDF printed and re-scanned | ELA false positive | Disable ELA for `source_file == "image"` |

**Hard rule:** no single receipt signal produces a red-tier block alone. Receipt score ≥ 85 routes to orange unless a second independent signal (device, behavioral, or address) also exceeds 60.

---

## 7. Module D — Falsified Damage Claims Detection

### The Threat Model

A real damage photo is taken right now, at the customer's address, on their registered phone. Every fake photo fails at least one of: date, location, device, pixel integrity, or reverse search.

| Attack type | Primary detection |
|---|---|
| Internet sourced (downloaded photo) | Reverse image search |
| Pre-delivery photo | EXIF date check |
| Wrong location photo | EXIF GPS check |
| Edited/manipulated photo | ELA + pixel analysis |
| Wrong product photo | Product model comparison via Vision API |

---

### Layer 1 — Reverse Image Search

```python
def reverse_image_search(image_bytes: bytes) -> SignalResult:
    response = vision_client.web_detection(image=vision.Image(content=image_bytes))
    web = response.web_detection

    if web.full_matching_images:
        return SignalResult(score=95, reason="image_found_online",
                           detail=f"Exact match at: {web.full_matching_images[0].url}")
    if web.partial_matching_images:
        return SignalResult(score=60, reason="partial_match_online")
    return SignalResult(score=0, reason="reverse_search_clean")
```

**Cost:** Google Vision web detection is $1.50 per 1,000 requests.

---

### Layer 2 — EXIF Metadata Analysis

Every smartphone photo embeds metadata written automatically at capture time. The customer cannot easily remove or fake it.

| EXIF field | What you check | Fraud signal |
|---|---|---|
| `DateTimeOriginal` | Is photo date after delivery date? | Photo before delivery → impossible to be damage from this order |
| `GPSLatitude/Longitude` | Distance from customer's registered address | > 50km gap = not taken at their location |
| `Make + Model` | Does device match account's registered phone? | Different device = not their camera |

Scoring thresholds:

- Photo taken before delivery date → +80 score
- Photo taken > 30 days after delivery → +20 score
- No EXIF date (metadata stripped) → +15 score
- GPS > 500km from address → +60 score
- GPS 100–500km from address → +30 score
- Device model mismatch → +25 score

---

### Layer 3 — ELA Pixel Manipulation Detection

When a photo is edited (clone stamp, copy-paste, brightness manipulation to exaggerate damage), the edited region is re-compressed at a different quality level. ELA reveals this by computing per-pixel differences after re-saving at known quality.

- Bright pixel ratio > 5% AND 2+ large spatial clusters → score 80
- Bright pixel ratio > 3% → score 45
- 3+ spatial clusters despite low overall ratio → score 40

**Critical limitation:** only run on digital photos (confirmed by EXIF camera data). For scanned paper images, skip ELA — unreliable on non-digital sources.

---

### Layer 4 — Product Model Comparison

Uses Google Vision label detection to verify the correct product is in the photo. If the order was for a black Samsung and the photo shows an iPhone, score 85. If the product category (electronics vs apparel vs appliance) doesn't match, score 85.

---

### Layer 5 — Camera-Only Enforcement (Prevention)

**The strongest measure.** Opens the device camera directly. Gallery access is disabled entirely. Timestamp, GPS, and device ID are captured in the background at the moment of capture — these cannot be faked.

```jsx
// React component — key enforcement detail:
navigator.mediaDevices.getUserMedia({
    video: { facingMode: "environment" },
    audio: false
})
// No <input type="file"> anywhere in the component — intentionally absent.
```

| Attack vector | Gallery upload | Camera only |
|---|---|---|
| Downloaded internet photo | Works for fraud | Impossible |
| Old photo from camera roll | Works for fraud | Impossible |
| Pre-delivery photo | Works for fraud | Impossible (timestamp is live) |
| Photo from different city | Works for fraud | GPS captured live |
| Edited/manipulated photo | Works for fraud | No time to edit during live capture |

---

### Layer 6 — Route Cross-Reference (Carrier Damage vs Fraud)

If multiple customers on the same carrier route, same transit day, report damage — it is a real carrier problem. The route scorer applies a **negative adjustment** (−20) to the final score when 5+ independent claims come from the same route. This actively reduces suspicion for legitimate customers caught in a carrier mishandling event.

---

### Complete Damage Claim Scorer

```python
async def score_falsified_damage_claim(image_bytes, capture_meta, order, customer, shipment):
    # Layers 1–5 run concurrently
    r1, r2, r3, r4, r5 = await asyncio.gather(
        reverse_image_search_async(image_bytes),
        analyse_exif_async(image_bytes, shipment.delivered_at.date(),
                           customer.address_lat, customer.address_lng,
                           customer.registered_device_model),
        run_ela_async(image_bytes) if capture_meta or has_exif_camera else skip(),
        compare_product_in_photo(image_bytes, order.product_name, order.listing_image),
        verify_live_capture_metadata(capture_meta, shipment, customer) if capture_meta else skip()
    )

    # Layer 6: Route cross-reference (can reduce overall score)
    r6 = check_route_damage_pattern(shipment.shipment_id, shipment.carrier,
                                    shipment.transit_date, shipment.pincode)

    # Combine: highest signal weighted most
    sorted_s = sorted([s for s in positive_scores], reverse=True)
    combined = sorted_s[0]*0.55 + sorted_s[1]*0.30 + sum(sorted_s[2:])*0.15

    # Apply route adjustment — can go negative
    final = max(0, min(100, combined + r6.score))
    return int(final), results
```

---

### Damage Claim False Positive Protections

| Scenario | Risk | Mitigation |
|---|---|---|
| No GPS on phone | GPS check fails | GPS alone never blocks — must corroborate with date or reverse search |
| Product photo matches stock image online | Reverse search false hit | Partial match = amber only. Full match = high score. |
| Low-light photo has high ELA signal | ELA false positive | ELA alone caps contribution at 45. Requires second signal to escalate. |
| Customer used old phone for photo | Device mismatch | Device check is +25 only — never escalates alone |
| Real carrier damage (multiple claims) | Should not be penalised | Negative route score brings final down — legitimate claims pass faster |
| Customer strips EXIF before upload | Missing metadata | +15 mild flag + prompt for live camera resubmission |

**Hard rule:** no damage claim is denied on a single signal. Score must exceed 70 AND at least two layers must have fired above 40 before routing to orange. Red requires three layers above 60.

---

## 8. Fusion Engine — Combining All Modules

### Core Formula

```
Combined score = Σ (signal_score × context_weight)
```

### Context-Aware Weights

The weight profile changes based on the claim type detected at ingestion. Each context emphasises the signals most relevant to that fraud type.

| Signal | Return Ring | INR Claim | Receipt Claim | Damage Claim |
|--------|------------|-----------|--------------|-------------|
| Device fingerprint | 0.35 | 0.10 | 0.10 | 0.10 |
| Behavioral biometrics | 0.30 | 0.05 | 0.05 | 0.05 |
| Graph / ring | 0.35 | 0.10 | 0.05 | 0.05 |
| GPS verification | — | 0.25 | — | — |
| Post-delivery engagement | — | 0.30 | — | — |
| INR history | — | 0.15 | — | — |
| Address intelligence | — | 0.05 | — | — |
| OTP confirmation | — | 0.10 | — | — |
| Receipt integrity | — | — | 0.40 | 0.10 |
| Receipt hash | — | — | 0.20 | — |
| EXIF / live capture | — | — | — | 0.30 |
| Image integrity (ELA + reverse search) | — | — | 0.10 | 0.30 |
| Carrier / route signals | — | 0.05 | — | 0.10 |

---

### The Corroboration Rule — Hard Constraint

> **A combined score cannot escalate above amber unless at least two of the active scorers for that context individually exceed 40.**

This is the primary false-positive firewall. No single signal, no matter how high its score, can produce a hard block.

**Worked example — fraud ring member:**
- Device scorer: 72 (4 accounts on one device)
- Behavior scorer: 85 (3.2σ deviation — account takeover)
- Graph scorer: 68 (cluster of 9)
- Combined: 74.5 → all three exceed 40 → escalation to orange permitted ✓

**Worked example — innocent VPN user:**
- Device scorer: 0 (only one account on device)
- Behavior scorer: 15 (normal typing rhythm for this account)
- Graph scorer: 90 (coincidentally connected to suspicious cluster via shared IP subnet)
- Combined: 35.5 → only one scorer exceeds 40 → **capped at amber** ✓

---

### Decay Function

Signal age erodes certainty. A device fingerprint match from 18 months ago carries 40% of its original weight. A behavioral mismatch from a session where the customer demonstrably switched from desktop to mobile is discounted — the profile was built on a different input modality.

---

### Hard Exit Conditions

Some signals short-circuit the fusion engine entirely:

| Condition | Action |
|---|---|
| GPS verdict = `LIKELY_MISDELIVERY` | Auto-refund, carrier complaint filed. Fusion skipped. |
| Address verdict = `BUILDING_DELIVERY_PROBLEM` | Auto-refund, carrier escalation. Fusion skipped. |
| OTP confirmed = true, INR claim submitted | Score immediately set to 92+. |
| DB cross-reference mismatch score ≥ 85 | Receipt fusion terminates early. |

---

## 9. Decision Tiers

| Tier | Score range | Corroboration required | Customer experience | Volume |
|------|------------|----------------------|--------------------|----|
| **Green** | 0–30 | None | Auto-approve. System invisible. | ~70% |
| **Amber** | 31–60 OR only one scorer > 40 | None | Photo upload / soft verification. Feels like standard process. | ~20% |
| **Orange** | 61–80 AND ≥2 scorers > 40 | 2 signals | Human review queue. "Under review — 24 hours." No accusation. | ~8% |
| **Red** | 81–100 AND all scorers > 60 | 3 signals (all must agree) | "Additional verification required." Appeal link always present. | ~2% |

**Language rule:** the customer is never told "you are a fraudster." At every tier, the message is operational, not accusatory. Even at red, the path is "additional review required" with a direct escalation link. This matters legally and operationally.

**HTTP status rule:** red-tier responses always return HTTP 200, never 403. A 403 implies punishment and creates grounds for customer complaints.

---

## 10. Tech Stack Summary

| Component | Technology | Used by |
|-----------|-----------|---------|
| Client fingerprinting | FingerprintJS v3 + custom canvas/audio scripts | Module A |
| Behavioral collection | Vanilla JS passive event listeners | Module A |
| API layer | FastAPI (Python, async) | All modules |
| Concurrent scoring | `asyncio.gather` | All modules |
| Fingerprint + feature store | PostgreSQL + Redis | Module A, B |
| Graph scoring | NetworkX + Louvain community detection | Module A, B |
| GPS distance calculation | `geopy>=2.4.0` | Module B |
| Receipt PDF extraction | PyMuPDF (`fitz`) | Module C |
| Receipt hash verification | Python `hashlib` (SHA-256) | Module C |
| QR code generation + signing | `qrcode` + Python `hmac` | Module C |
| EXIF extraction | `exifread` | Module D |
| ELA pixel analysis | `Pillow` + `NumPy` + `scipy` | Module C, D |
| Reverse image search | Google Vision API (web detection) | Module D |
| Product label detection | Google Vision API (label detection) | Module D |
| Camera enforcement | React + `getUserMedia` API | Module D |
| Async workers | Celery | Learning loop |
| Audit + labels store | PostgreSQL | All modules |

---

## 11. Database Schema Master Reference

```sql
-- Device fingerprints (Module A)
CREATE TABLE device_fingerprints (
  fingerprint_hash  TEXT PRIMARY KEY,
  account_ids       TEXT[] NOT NULL,
  first_seen_at     TIMESTAMP NOT NULL,
  updated_at        TIMESTAMP DEFAULT now()
);

-- Behavioral profiles (Module A)
CREATE TABLE behavioral_profiles (
  account_id        TEXT PRIMARY KEY,
  baseline_json     JSONB NOT NULL,   -- mean vectors
  variance_json     JSONB NOT NULL,   -- std dev per feature
  session_count     INT DEFAULT 0,
  updated_at        TIMESTAMP DEFAULT now()
);

-- Shipment deliveries (Module B)
CREATE TABLE shipment_deliveries (
  shipment_id       TEXT PRIMARY KEY,
  order_id          TEXT NOT NULL,
  account_id        TEXT NOT NULL,
  delivered_at      TIMESTAMP NOT NULL,
  driver_id         TEXT,
  gps_lat           NUMERIC(9,6),
  gps_lng           NUMERIC(9,6),
  gps_accuracy_m    INT,
  photo_url         TEXT,
  left_at           TEXT,
  otp_confirmed     BOOLEAN DEFAULT false,
  otp_required      BOOLEAN DEFAULT false,
  otp_timestamp     TIMESTAMP,
  raw_payload       JSONB,
  created_at        TIMESTAMP DEFAULT now()
);

-- Post-delivery engagement events (Module B)
CREATE TABLE engagement_events (
  id                SERIAL PRIMARY KEY,
  account_id        TEXT NOT NULL,
  order_id          TEXT NOT NULL,
  event_type        TEXT NOT NULL,
  occurred_at       TIMESTAMP NOT NULL,
  metadata_json     JSONB,
  created_at        TIMESTAMP DEFAULT now()
);
CREATE INDEX idx_engagement_order   ON engagement_events (order_id, occurred_at);
CREATE INDEX idx_engagement_account ON engagement_events (account_id, event_type);

-- Receipt hashes (Module C)
CREATE TABLE receipt_hashes (
  order_id          TEXT PRIMARY KEY,
  hash              TEXT NOT NULL,
  created_at        TIMESTAMP DEFAULT now()
);

-- Receipt QR metadata (Module C)
CREATE TABLE receipt_qr_metadata (
  order_id          TEXT PRIMARY KEY,
  qr_payload        JSONB NOT NULL,
  generated_at      TIMESTAMP DEFAULT now()
);

-- Damage claim records (Module D)
CREATE TABLE damage_claims (
  claim_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          TEXT NOT NULL,
  image_bytes_hash  TEXT NOT NULL,
  capture_timestamp TIMESTAMP,
  capture_lat       NUMERIC(9,6),
  capture_lng       NUMERIC(9,6),
  capture_device    TEXT,
  exif_date         DATE,
  exif_lat          NUMERIC(9,6),
  exif_lng          NUMERIC(9,6),
  exif_device       TEXT,
  reverse_search_hit BOOLEAN DEFAULT false,
  ela_score         INT,
  final_signal_score INT,
  evidence_json     JSONB,
  created_at        TIMESTAMP DEFAULT now()
);

-- Master return decisions and audit log (all modules)
CREATE TABLE return_decisions (
  decision_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        TEXT NOT NULL,
  order_id          TEXT NOT NULL,
  claim_type        TEXT NOT NULL,   -- RETURN_RING | INR | RECEIPT | DAMAGE
  final_score       INT NOT NULL,
  tier              TEXT NOT NULL,   -- GREEN | AMBER | ORANGE | RED
  signal_scores_json JSONB,          -- all individual scorer outputs
  evidence_json     JSONB,
  reviewer_id       TEXT,            -- set when human review completes
  reviewer_decision TEXT,            -- APPROVE | CONFIRM_FRAUD
  inr_gps_distance_m INT,
  inr_otp_confirmed  BOOLEAN DEFAULT false,
  inr_engagement_found BOOLEAN DEFAULT false,
  created_at        TIMESTAMP DEFAULT now(),
  reviewed_at       TIMESTAMP
);
CREATE INDEX idx_decisions_account ON return_decisions (account_id, created_at);
CREATE INDEX idx_decisions_score   ON return_decisions (final_score DESC);

-- Pincode intelligence (Module B, D)
CREATE TABLE pincode_intelligence (
  pincode           TEXT PRIMARY KEY,
  rto_rate          NUMERIC(5,2),   -- return-to-origin rate %
  inr_rate          NUMERIC(5,2),   -- INR claim rate %
  carrier_issues    INT DEFAULT 0,
  updated_at        TIMESTAMP DEFAULT now()
);

-- Human review labels (learning loop)
CREATE TABLE review_labels (
  id                SERIAL PRIMARY KEY,
  decision_id       UUID NOT NULL REFERENCES return_decisions(decision_id),
  reviewer_id       TEXT NOT NULL,
  outcome           TEXT NOT NULL,   -- APPROVE | CONFIRM_FRAUD | ESCALATE
  confidence        SMALLINT,        -- 1–5
  notes             TEXT,
  created_at        TIMESTAMP DEFAULT now()
);
```

---

## 12. Build Priority

### Phase 1 — Core Ring Detection (Module A) — ~3 hours

| Task | Time |
|------|------|
| Client-side fingerprint collection + behavioral listeners | 45 min |
| `device_fingerprints` table + lookup | 30 min |
| Behavioral profile baseline + Z-score delta | 40 min |
| Device scorer + behavior scorer | 30 min |
| Redis feature store write | 20 min |
| Graph scorer (NetworkX + Louvain) | 45 min |
| Fusion engine + corroboration rule | 30 min |

### Phase 2 — INR Detection (Module B) — ~3.5 hours

| Task | Time |
|------|------|
| Carrier webhook GPS ingestion + `shipment_deliveries` table | 30 min |
| GPS scorer (200m rule + hard exits) | 20 min |
| Engagement events table + write triggers | 40 min |
| Engagement scorer | 20 min |
| INR history scorer | 15 min |
| Address building-vs-account distinction | 20 min |
| OTP field additions + scorer | 20 min |
| Ring detection (reuse Module A infrastructure) | 10 min |
| Full `score_inr_claim()` fusion | 25 min |
| Chargeback evidence package builder | 20 min |

### Phase 3 — Receipt Manipulation (Module C) — ~3.25 hours

| Task | Time |
|------|------|
| PyMuPDF text extraction + DB cross-reference | 45 min |
| `receipt_hashes` table + hash on PDF generation | 30 min |
| PDF metadata analysis (creator/producer/modDate) | 30 min |
| ELA implementation via Pillow | 45 min |
| QR code signing on new receipts | 45 min |

### Phase 4 — Damage Claims (Module D) — ~3.75 hours

| Task | Time |
|------|------|
| EXIF extraction — date + GPS check | 45 min |
| Google Vision reverse image search | 30 min |
| ELA via Pillow + NumPy + scipy | 45 min |
| Google Vision label detection — product comparison | 30 min |
| React camera-only component | 45 min |
| Route cross-reference query | 30 min |
| `damage_claims` table + evidence JSON logging | 20 min |

### Phase 5 — Learning Loop — ~1 hour

| Task | Time |
|------|------|
| Human review queue UI and decision capture | 30 min |
| `review_labels` table + fingerprint risk flag update | 15 min |
| Celery weekly retrain task | 15 min |

**Total estimated build time: ~14.5 hours** for full implementation across all four modules.

---

## 13. Key Design Principles

**1. Invisible to legitimate customers.** ~70% of users never encounter any friction. The system exists to be invisible.

**2. Corroboration over individual signals.** No single signal, regardless of its score, can produce a hard block. The false-positive rate is structurally bounded by requiring multiple independent sources to agree.

**3. Hard exits for genuine non-fraud.** GPS misdelivery detection and building-level INR clustering short-circuit the pipeline entirely — legitimate customers in bad delivery areas are never scored through fraud detection at all.

**4. Proportional friction.** Amber friction (a photo, a verification step) is natural and explainable. It does not accuse the customer — it asks for something a legitimate customer already has.

**5. Human judgment for hard cases.** Orange routes to a human reviewer. Algorithms make probabilistic statements; humans make decisions with consequences.

**6. Always an appeal path.** Even at red, the customer has a direct escalation route. No decision is permanent without human review.

**7. Decay over time.** Old signals carry less weight. The system does not penalise customers indefinitely for a past association with a risky device or network.

**8. Negative scores for exonerating signals.** When route cross-reference detects a carrier issue, or when a pincode has a known high RTO rate, the score actively decreases. The system is designed to clear innocents, not just catch fraudsters.

**9. Your database is the oracle.** For receipt fraud, every check reduces to comparing the submitted document against your ground-truth records. The fraudster is betting you won't check. Check.

**10. Prevention over detection.** Camera-only enforcement for damage claims and OTP delivery confirmation for high-value orders eliminate entire fraud attack surfaces at the source rather than detecting them after the fact.
