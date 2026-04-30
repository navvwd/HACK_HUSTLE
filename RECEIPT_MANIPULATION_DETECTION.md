# Receipt Manipulation Detection

*Signal module for the Inconsistency Engine · Companion to FUSION_SCORING_V2.md*
*Scope: detection methods, data collection, scoring logic, implementation priority*

---

## 1. What this signal solves

Receipt manipulation ranges from simple PDF edits (changing ₹2,500 to ₹250, backdating a purchase date) to using a completely different product's receipt for a higher-value return claim. The two attack patterns are distinct and require different detection strategies:

| Attack type | What the fraudster does | Detection approach |
|---|---|---|
| **Field editing** | Opens retailer-generated PDF, edits amount/date/item name | Cross-reference against your own DB + hash mismatch |
| **Receipt substitution** | Submits a different product's receipt entirely | Order ID lookup + amount/item consistency check |
| **Date manipulation** | Edits purchase date to fall inside return window | DB cross-reference + PDF metadata delta |
| **External receipt** | Submits receipt from a different retailer for a higher-value item | Issuer detection + visual template check |

**The fundamental rule:** your database is the source of truth, not the document. Every check below reduces to: does the submitted receipt match what your system generated?

---

## 2. Detection methods — priority order

### Method 1 — DB cross-reference (implement first, catches ~85% of cases)

Every receipt your system generates contains an Order ID or Invoice Number. When a customer submits a receipt:

1. Extract the Order ID from the submitted PDF via PyMuPDF text extraction
2. Look up that Order ID in your `orders` table
3. Compare every verifiable field

```python
def cross_reference_receipt(extracted: ExtractedReceiptData) -> SignalResult:
    order = db.query(Order).filter_by(order_id=extracted.order_id).first()

    if not order:
        return SignalResult(score=90, reason="order_id_not_found",
                           detail=f"Order ID {extracted.order_id} does not exist")

    mismatches = []
    if abs(extracted.amount - order.amount) > 0.01:
        mismatches.append(f"amount: submitted ₹{extracted.amount}, actual ₹{order.amount}")
    if extracted.item_name.lower() not in order.item_name.lower():
        mismatches.append(f"item: submitted '{extracted.item_name}', actual '{order.item_name}'")
    if extracted.date != order.purchase_date:
        mismatches.append(f"date: submitted {extracted.date}, actual {order.purchase_date}")

    if mismatches:
        return SignalResult(score=95, reason="field_mismatch", detail="; ".join(mismatches))
    return SignalResult(score=0, reason="receipt_verified")
```

**What this catches:** field editing (amount, date, item name), receipt substitution (different order ID or no matching ID), date manipulation.

---

### Method 2 — Cryptographic hash comparison (implement second)

When your billing system generates a PDF receipt, compute a SHA-256 hash of the raw byte content and store it:

```python
import hashlib

def store_receipt_hash(order_id: str, pdf_bytes: bytes):
    h = hashlib.sha256(pdf_bytes).hexdigest()
    db.execute(
        "INSERT INTO receipt_hashes (order_id, hash, created_at) VALUES (%s, %s, now())",
        (order_id, h)
    )
```

At submission time, recompute and compare:

```python
def verify_receipt_hash(order_id: str, submitted_pdf_bytes: bytes) -> SignalResult:
    stored = db.query(ReceiptHash).filter_by(order_id=order_id).first()
    if not stored:
        return SignalResult(score=30, reason="no_stored_hash",
                           detail="Receipt hash not on record — generated before hash system")

    submitted_hash = hashlib.sha256(submitted_pdf_bytes).hexdigest()
    if submitted_hash != stored.hash:
        return SignalResult(score=85, reason="hash_mismatch",
                           detail="PDF content differs from original — modification detected")
    return SignalResult(score=0, reason="hash_verified")
```

**One character changed anywhere in the PDF — date, amount, a space — produces a completely different hash. This is binary: either it matches or it doesn't.**

Note: hash comparison only works for receipts your system generated after you implemented hashing. For older receipts, fall back to Method 1 and Method 3.

---

### Method 3 — PDF metadata analysis

Every PDF carries internal metadata that reveals its creation history. Use `PyMuPDF` (`fitz`) to extract:

```python
import fitz  # PyMuPDF

def analyse_pdf_metadata(pdf_bytes: bytes) -> SignalResult:
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    meta = doc.metadata
    score = 0
    evidence = []

    creator    = meta.get("creator", "")
    producer   = meta.get("producer", "")
    created    = meta.get("creationDate", "")
    modified   = meta.get("modDate", "")

    # Was it modified after creation?
    if created and modified and modified != created:
        evidence.append(f"Modified after creation: created {created}, modified {modified}")
        score += 40

    # Was it created by your billing system?
    EXPECTED_CREATORS = ["YourBillingSystem", "InvoiceService", "OrderEngine"]
    if not any(exp.lower() in creator.lower() for exp in EXPECTED_CREATORS):
        evidence.append(f"Unexpected creator software: '{creator}'")
        score += 25

    # Known editing tools in producer field
    EDITING_TOOLS = ["adobe acrobat", "foxit", "pdf-xchange", "smallpdf",
                     "ilovepdf", "sejda", "pdfescape", "preview"]
    if any(tool in producer.lower() for tool in EDITING_TOOLS):
        evidence.append(f"Edited with: '{producer}'")
        score += 35

    return SignalResult(score=min(score, 100), reason="metadata_analysis",
                       detail="; ".join(evidence) if evidence else "clean")
```

**Key signals extracted:**

| Metadata field | What to check | Fraud signal |
|---|---|---|
| `creationDate` | Should be close to order date | Gap > 7 days is suspicious |
| `modDate` | Should equal `creationDate` | Any difference means post-creation edit |
| `creator` | Should be your billing system name | Anything else is a red flag |
| `producer` | PDF library used | Adobe Acrobat Edit, Foxit, online editors = flag |
| `author` | Should be blank or your system name | Customer name here = manually created |

---

### Method 4 — Visual / font inconsistency detection (for external receipts)

When a customer submits a receipt from a different retailer entirely, DB cross-reference fails because the Order ID won't exist. Visual analysis catches these.

**What to detect:**

When a PDF is edited, the modified region often contains:
- A white rectangle painted over original text (visible under certain render settings)
- Text in a slightly different font weight or kerning than surrounding text
- JPEG compression artifacts around modified numbers (PDF editors re-compress on save)
- Inconsistent character spacing specifically around numeric values

**Implementation using Pillow + ELA (Error Level Analysis):**

ELA works by re-saving the PDF page as JPEG at known quality, then computing pixel-level difference from the submitted image. Edited regions compress differently — they show as bright spots in the ELA output.

```python
from PIL import Image, ImageChops, ImageEnhance
import fitz
import io

def run_ela_on_receipt(pdf_bytes: bytes, page_num: int = 0) -> SignalResult:
    doc   = fitz.open(stream=pdf_bytes, filetype="pdf")
    page  = doc[page_num]
    pix   = page.get_pixmap(dpi=150)
    img   = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)

    # Save at known quality and reload
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=90)
    buf.seek(0)
    resaved = Image.open(buf)

    # ELA diff
    ela_img    = ImageChops.difference(img, resaved)
    enhancer   = ImageEnhance.Brightness(ela_img)
    ela_bright = enhancer.enhance(20)

    # Check if any region has anomalously high ELA signal
    pixels     = list(ela_bright.getdata())
    bright_px  = sum(1 for r, g, b in pixels if r > 200 or g > 200 or b > 200)
    ratio      = bright_px / len(pixels)

    if ratio > 0.03:   # >3% of pixels show high ELA — strong editing signal
        return SignalResult(score=70, reason="ela_anomaly",
                           detail=f"ELA bright pixel ratio: {ratio:.3f}")
    if ratio > 0.01:
        return SignalResult(score=35, reason="ela_minor",
                           detail=f"Minor ELA signal: {ratio:.3f}")
    return SignalResult(score=0, reason="ela_clean")
```

**Limitation:** ELA is probabilistic — poor quality original scans trigger false positives. Use only as a corroborating signal, never as a standalone block trigger.

---

### Method 5 — QR code verification (implement on new receipt generation)

Print a QR code on every generated receipt containing a server-signed payload. When submitted, scan and verify the signature.

```python
import qrcode
import hmac, hashlib, json

SECRET_KEY = os.environ["RECEIPT_SIGNING_KEY"]  # keep server-side only

def generate_receipt_qr(order: Order) -> bytes:
    payload = {
        "order_id": order.order_id,
        "amount":   str(order.amount),
        "date":     order.purchase_date.isoformat(),
        "item":     order.item_name
    }
    msg = json.dumps(payload, sort_keys=True).encode()
    sig = hmac.new(SECRET_KEY.encode(), msg, hashlib.sha256).hexdigest()
    payload["sig"] = sig
    qr = qrcode.make(json.dumps(payload))
    buf = io.BytesIO()
    qr.save(buf)
    return buf.getvalue()

def verify_receipt_qr(qr_data: str, submitted_amount: float) -> SignalResult:
    try:
        payload = json.loads(qr_data)
        sig     = payload.pop("sig")
        msg     = json.dumps(payload, sort_keys=True).encode()
        expected = hmac.new(SECRET_KEY.encode(), msg, hashlib.sha256).hexdigest()

        if not hmac.compare_digest(sig, expected):
            return SignalResult(score=95, reason="qr_signature_invalid",
                               detail="QR code signature does not match — receipt tampered")

        qr_amount = float(payload["amount"])
        if abs(qr_amount - submitted_amount) > 0.01:
            return SignalResult(score=95, reason="qr_amount_mismatch",
                               detail=f"QR shows ₹{qr_amount}, submitted shows ₹{submitted_amount}")

        return SignalResult(score=0, reason="qr_verified")
    except Exception as e:
        return SignalResult(score=20, reason="qr_parse_error", detail=str(e))
```

**Why this is strong:** the fraudster edits the PDF amount, but the QR code contains the server-signed original amount. They cannot forge the QR without the `SECRET_KEY`, which never leaves your server.

---

## 3. Receipt scorer — combining all methods

```python
def score_receipt_manipulation(
    pdf_bytes: bytes,
    extracted: ExtractedReceiptData
) -> tuple[int, list[dict]]:

    results = []

    # Method 1: DB cross-reference (always run — highest priority)
    r1 = cross_reference_receipt(extracted)
    results.append({"method": "db_crossref", "score": r1.score, "detail": r1.detail})
    if r1.score >= 85:
        # Terminate early — definitive mismatch found
        return r1.score, results

    # Method 2: Hash comparison (run if stored hash exists)
    r2 = verify_receipt_hash(extracted.order_id, pdf_bytes)
    results.append({"method": "hash_compare", "score": r2.score, "detail": r2.detail})

    # Method 3: Metadata analysis (always run)
    r3 = analyse_pdf_metadata(pdf_bytes)
    results.append({"method": "metadata", "score": r3.score, "detail": r3.detail})

    # Method 4: ELA (only if no hash stored — likely external or old receipt)
    if r2.reason == "no_stored_hash":
        r4 = run_ela_on_receipt(pdf_bytes)
        results.append({"method": "ela", "score": r4.score, "detail": r4.detail})
    else:
        r4 = SignalResult(score=0, reason="skipped")

    # Method 5: QR if QR data extracted from PDF
    if extracted.qr_data:
        r5 = verify_receipt_qr(extracted.qr_data, extracted.amount)
        results.append({"method": "qr_verify", "score": r5.score, "detail": r5.detail})
        if r5.score >= 90:
            return r5.score, results

    # Combine: take the maximum of the two highest signals
    scores = sorted([r1.score, r2.score, r3.score, r4.score], reverse=True)
    combined = scores[0] * 0.6 + scores[1] * 0.4 if len(scores) > 1 else scores[0]

    return int(min(combined, 100)), results
```

**Why take the two highest rather than average all:** averaging dilutes a definitive signal (hash mismatch at 85) with uninformative clean signals (metadata at 0). The two-highest combination respects that any single strong independent signal is meaningful evidence.

---

## 4. Data collection requirements

### What you must store at receipt generation time

```sql
CREATE TABLE receipt_hashes (
  order_id   TEXT PRIMARY KEY,
  hash       TEXT NOT NULL,         -- SHA-256 of raw PDF bytes
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE receipt_qr_metadata (
  order_id      TEXT PRIMARY KEY,
  qr_payload    JSONB NOT NULL,     -- signed payload without secret
  generated_at  TIMESTAMP DEFAULT now()
);
```

### What you extract from submitted receipts

Uses PyMuPDF for text extraction + metadata, ExifRead for image metadata if receipt is an image file:

```python
@dataclass
class ExtractedReceiptData:
    order_id:    str
    amount:      float
    date:        date
    item_name:   str
    qr_data:     str | None        # extracted from embedded QR if present
    raw_text:    str               # full extracted text for linguistic checks
    source_file: str               # "pdf" | "image" | "screenshot"
```

Extraction runs in the FastAPI request handler before the scorer fires. No async needed — PyMuPDF is synchronous and fast (<50ms for standard receipts).

---

## 5. Scoring integration into fusion engine

The receipt manipulation signal feeds into the fusion formula as part of the `image_text_consistency` component (for damage photo receipts) or as a standalone `receipt_integrity` signal for receipt-specific return flows.

For the hackathon implementation, wire it as follows:

```python
# In the fusion engine, alongside other scorers
receipt_score, receipt_evidence = score_receipt_manipulation(
    submitted_pdf_bytes, extracted_data
)

# Add to signal_scores dict
signal_scores["receipt_integrity"] = receipt_score
fusion_evidence["receipt"] = receipt_evidence
```

Weight in the fusion formula: treat as equivalent to `image_text_consistency` weight (0.20 default) when a receipt is the primary claim document. When receipt is supporting evidence alongside a damage photo, reduce to 0.10.

---

## 6. False positive protections

| Scenario | Risk | Mitigation |
|---|---|---|
| Customer re-saved PDF from email | Hash mismatch (email clients re-encode) | Fall back to DB cross-reference; only hash-block if DB also mismatches |
| OCR extraction error on amount | Wrong amount extracted, appears as mismatch | Flag for human review (orange tier), not auto-deny |
| Old receipt before hash system | No hash on record | Skip Method 2; rely on Methods 1, 3, 4 |
| Legitimate shared receipt (gift) | Different name on receipt | Flag for soft verification, not block |
| PDF printed and re-scanned | ELA false positive on scanned image | Disable ELA for `source_file == "image"` — use only on digital PDFs |

**Hard rule:** no single receipt signal produces a red-tier block alone. Receipt score ≥ 85 routes to orange (human review) unless a second independent signal (device, behavioral, or address) also exceeds 60.

---

## 7. Build priority for 30-hour hackathon

| Order | Task | Time | Catches |
|---|---|---|---|
| 1 | PyMuPDF text extraction + DB cross-reference | 45 min | ~85% of field-edit fraud |
| 2 | `receipt_hashes` table + hash on PDF generation | 30 min | All hash-detectable edits |
| 3 | PDF metadata analysis (creator/producer/modDate) | 30 min | Editing tool fingerprint |
| 4 | ELA implementation via Pillow | 45 min | Visual editing artifacts |
| 5 | QR code signing on new receipts | 45 min | Future-proof: all new receipts |
| **Total** | | **~3h 15min** | |

For the demo: seed two receipts — one clean (shows green, auto-approved) and one with an edited amount that the DB cross-reference catches immediately (shows the mismatch table to the judge). That contrast takes 5 minutes to set up and is the most convincing demo moment for this signal.

---

*Receipt manipulation is the only fraud type where your own data is a perfect oracle. Every receipt your system generated has a known ground truth in your database. The fraudster is betting you won't check. Check.*
