# Falsified Damage Claims — Detection Spec

*Signal module for the Inconsistency Engine · Companion to FUSION_SCORING_V2.md and RECEIPT_MANIPULATION_DETECTION.md*
*Scope: all detection layers, data collection, scoring logic, camera-only enforcement, build priority*

---

## 1. The threat model

A customer submits a photo claiming their product arrived damaged. The photo is one of four things:

| Attack type | What the fraudster does | Primary detection |
|---|---|---|
| **Internet sourced** | Downloads a damaged product photo from Google Images | Reverse image search |
| **Pre-delivery photo** | Uses a photo taken before the order was placed | EXIF date check |
| **Wrong location photo** | Uses a photo taken at a different address | EXIF GPS check |
| **Edited photo** | Manipulates a real product photo to add/exaggerate damage | ELA + pixel analysis |
| **Wrong product photo** | Submits damage photo of a different product entirely | Product model comparison |

A real damage photo is taken right now, at the customer's address, on their registered phone. Every fake photo fails at least one of: date, location, device, pixel integrity, or reverse search. The detection stack checks all five.

---

## 2. Layer 1 — Reverse image search (catches sourced photos)

### What it does

Submits the customer's photo to Google Vision API's web detection endpoint. If the image (or a near-duplicate) already exists on the internet, it cannot be a photo of their specific delivery.

### Implementation

```python
from google.cloud import vision
import io

def reverse_image_search(image_bytes: bytes) -> SignalResult:
    client  = vision.ImageAnnotatorClient()
    image   = vision.Image(content=image_bytes)
    response = client.web_detection(image=image)
    web      = response.web_detection

    # Full match = exact image found online
    if web.full_matching_images:
        urls = [m.url for m in web.full_matching_images[:3]]
        return SignalResult(
            score=95,
            reason="image_found_online",
            detail=f"Exact match found at: {urls[0]}"
        )

    # Partial match = visually similar image found (same product stock photo)
    if web.partial_matching_images:
        return SignalResult(
            score=60,
            reason="partial_match_online",
            detail=f"Visually similar image found online — possible stock photo"
        )

    # Best guess label check — does the image even contain the right product?
    if web.best_guess_labels:
        labels = [l.label.lower() for l in web.best_guess_labels]
        return SignalResult(
            score=0,
            reason="reverse_search_clean",
            detail=f"No internet match. Best guess labels: {labels}"
        )

    return SignalResult(score=0, reason="reverse_search_clean")
```

**Cost:** Google Vision web detection is $1.50 per 1,000 requests. At hackathon scale, effectively free with the $200 Google Cloud credit.

---

## 3. Layer 2 — EXIF metadata analysis (catches pre-delivery and wrong-location photos)

### What EXIF is

Every photo taken on a smartphone contains hidden metadata written automatically by the device at capture time. The customer cannot see it or easily remove it. Your system reads it on submission.

```
Customer takes photo on their phone
         ↓
Phone automatically embeds inside the image file:
  - "DateTimeOriginal: 2026-04-29 15:45:22"
  - "GPS: 13.0827° N, 80.2707° E"  (Chennai)
  - "Make: Samsung, Model: Galaxy S23"
         ↓
Customer submits the photo
         ↓
Your system extracts these hidden fields before the image is displayed
```

### Three fraud signals from EXIF

| Field | What you check | Fraud signal |
|---|---|---|
| `DateTimeOriginal` | Is photo date after delivery date? | Photo before delivery = impossible to be damage from this order |
| `GPSLatitude / GPSLongitude` | Distance from customer's registered address | > 50km gap = not taken at their location |
| `Make + Model` | Does device match account's registered phone? | Different device = not their camera |

### Implementation

```python
import exifread
from math import radians, sin, cos, sqrt, atan2
from datetime import datetime
import io

def haversine_km(lat1, lon1, lat2, lon2) -> float:
    R = 6371
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a = sin(dlat/2)**2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon/2)**2
    return R * 2 * atan2(sqrt(a), sqrt(1 - a))

def dms_to_decimal(dms_values, ref) -> float:
    d = float(dms_values[0].num) / float(dms_values[0].den)
    m = float(dms_values[1].num) / float(dms_values[1].den)
    s = float(dms_values[2].num) / float(dms_values[2].den)
    decimal = d + m/60 + s/3600
    if ref in ['S', 'W']:
        decimal = -decimal
    return decimal

def analyse_exif(
    image_bytes: bytes,
    delivery_date: date,
    customer_address_lat: float,
    customer_address_lng: float,
    account_device_model: str | None
) -> SignalResult:

    tags = exifread.process_file(io.BytesIO(image_bytes), details=False)
    score = 0
    evidence = []

    # --- Date check ---
    date_tag = tags.get("EXIF DateTimeOriginal")
    if date_tag:
        photo_dt = datetime.strptime(str(date_tag), "%Y:%m:%d %H:%M:%S")
        photo_date = photo_dt.date()

        if photo_date < delivery_date:
            days_before = (delivery_date - photo_date).days
            score += 80
            evidence.append(
                f"Photo taken {days_before} days BEFORE delivery date "
                f"({photo_date} vs delivery {delivery_date})"
            )
        elif (photo_date - delivery_date).days > 30:
            score += 20
            evidence.append(
                f"Photo taken {(photo_date - delivery_date).days} days after delivery — suspicious delay"
            )
    else:
        # No EXIF date — could mean stripped metadata (itself a mild signal)
        score += 15
        evidence.append("No EXIF date found — metadata may have been stripped")

    # --- GPS check ---
    gps_lat  = tags.get("GPS GPSLatitude")
    gps_lat_ref = tags.get("GPS GPSLatitudeRef")
    gps_lon  = tags.get("GPS GPSLongitude")
    gps_lon_ref = tags.get("GPS GPSLongitudeRef")

    if gps_lat and gps_lon and customer_address_lat:
        photo_lat = dms_to_decimal(gps_lat.values, str(gps_lat_ref))
        photo_lon = dms_to_decimal(gps_lon.values, str(gps_lon_ref))
        distance_km = haversine_km(
            customer_address_lat, customer_address_lng,
            photo_lat, photo_lon
        )
        if distance_km > 500:
            score += 60
            evidence.append(f"Photo GPS is {distance_km:.0f}km from customer address")
        elif distance_km > 100:
            score += 30
            evidence.append(f"Photo GPS is {distance_km:.0f}km from customer address")
        elif distance_km > 50:
            score += 10

    # --- Device check ---
    make  = str(tags.get("Image Make", "")).strip()
    model = str(tags.get("Image Model", "")).strip()
    if account_device_model and make and model:
        photo_device = f"{make} {model}".lower()
        if account_device_model.lower() not in photo_device:
            score += 25
            evidence.append(
                f"Photo device '{make} {model}' doesn't match account device '{account_device_model}'"
            )

    return SignalResult(
        score=min(score, 100),
        reason="exif_analysis",
        detail="; ".join(evidence) if evidence else "EXIF clean"
    )
```

---

## 4. Layer 3 — ELA pixel manipulation detection (catches edited photos)

### What ELA detects

When a photo is edited — clone stamp, copy-paste, brightness manipulation to make damage look worse — the edited region is re-compressed by the editor at a different quality level than the rest of the image. Error Level Analysis (ELA) reveals these inconsistencies by re-saving the image at known quality and computing the per-pixel difference. Edited regions appear as bright spots.

```python
from PIL import Image, ImageChops, ImageEnhance, ImageFilter
import numpy as np
import io

def run_ela(image_bytes: bytes, quality: int = 90) -> SignalResult:
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")

    # Re-save at known quality
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=quality)
    buf.seek(0)
    resaved = Image.open(buf).convert("RGB")

    # Compute difference
    ela_img    = ImageChops.difference(img, resaved)
    enhancer   = ImageEnhance.Brightness(ela_img)
    ela_bright = enhancer.enhance(20)

    # Analyse bright pixel distribution
    arr         = np.array(ela_bright)
    bright_mask = arr.max(axis=2) > 200     # any channel above threshold
    bright_ratio = bright_mask.sum() / bright_mask.size

    # Spatial clustering check — random noise is spread evenly,
    # manipulation creates localised bright clusters
    from scipy import ndimage
    labeled, num_clusters = ndimage.label(bright_mask)
    large_clusters = sum(
        1 for i in range(1, num_clusters + 1)
        if (labeled == i).sum() > 500    # cluster of >500 pixels = significant region
    )

    score = 0
    evidence = []

    if bright_ratio > 0.05 and large_clusters >= 2:
        score = 80
        evidence.append(
            f"ELA: {bright_ratio:.3f} bright ratio, {large_clusters} large manipulation clusters"
        )
    elif bright_ratio > 0.03:
        score = 45
        evidence.append(f"ELA: moderate anomaly ratio {bright_ratio:.3f}")
    elif large_clusters >= 3:
        score = 40
        evidence.append(f"ELA: {large_clusters} spatial clusters despite low overall ratio")

    return SignalResult(
        score=score,
        reason="ela_pixel_analysis",
        detail="; ".join(evidence) if evidence else "ELA clean"
    )
```

**Important limitation:** scanned paper images and low-quality photos produce high ELA scores on legitimate images. Only run ELA on digital photos (EXIF confirms camera capture). For scanned images (`source = "scan"`), skip ELA and rely on EXIF + reverse search.

---

## 5. Layer 4 — Product model comparison (catches wrong-product photos)

### What it checks

Your database has the original product listing photos. The submitted damage photo should contain the same product model. Vision API object detection verifies: is the right product in this photo?

```python
def compare_product_in_photo(
    image_bytes: bytes,
    expected_product: str,          # e.g. "Samsung Galaxy S23 black"
    listing_image_bytes: bytes      # your product listing photo
) -> SignalResult:

    client   = vision.ImageAnnotatorClient()
    image    = vision.Image(content=image_bytes)
    response = client.label_detection(image=image)
    labels   = [l.description.lower() for l in response.label_annotations]

    # Check if product category is even present
    product_keywords = expected_product.lower().split()
    matches = sum(1 for kw in product_keywords if any(kw in lbl for lbl in labels))

    if matches == 0:
        return SignalResult(
            score=75,
            reason="product_not_in_photo",
            detail=f"Expected '{expected_product}' — detected labels: {labels[:5]}"
        )

    # Check if it's even your product category (phone vs dress vs tool)
    category_map = {
        "electronics": ["phone", "screen", "device", "smartphone", "tablet", "laptop"],
        "apparel":     ["clothing", "dress", "shirt", "fabric", "garment"],
        "appliance":   ["appliance", "machine", "electronic device"],
    }
    order_category = classify_product_category(expected_product)
    photo_category = None
    for cat, keywords in category_map.items():
        if any(kw in " ".join(labels) for kw in keywords):
            photo_category = cat
            break

    if order_category and photo_category and order_category != photo_category:
        return SignalResult(
            score=85,
            reason="wrong_product_category",
            detail=f"Order was '{order_category}', photo appears to be '{photo_category}'"
        )

    return SignalResult(score=0, reason="product_match_clean")
```

---

## 6. Layer 5 — Camera-only enforcement (prevention, not detection)

This is the strongest measure and should be the primary UX for all damage claims. It eliminates the entire threat surface for sourced and pre-existing photos.

### How it works

The return portal opens the device camera directly. Gallery access is disabled entirely. The app captures timestamp, GPS, and device ID in the background at the moment of capture. These cannot be faked because they come from the device at the moment the shutter fires.

### Web implementation (React)

```jsx
import { useRef, useEffect, useState } from "react";

export function LiveDamageCapture({ onCapture }) {
  const videoRef  = useRef(null);
  const canvasRef = useRef(null);
  const [stream, setStream]   = useState(null);
  const [location, setLocation] = useState(null);

  useEffect(() => {
    // Request GPS before camera — both needed
    navigator.geolocation.getCurrentPosition(
      pos => setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      err => console.warn("GPS unavailable:", err)
    );

    // Open rear camera only — no gallery fallback
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
      audio: false
    }).then(s => {
      setStream(s);
      videoRef.current.srcObject = s;
    });

    return () => stream?.getTracks().forEach(t => t.stop());
  }, []);

  const capturePhoto = () => {
    const canvas  = canvasRef.current;
    const video   = videoRef.current;
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);

    canvas.toBlob(blob => {
      onCapture({
        photo: blob,
        captured_at: new Date().toISOString(),    // server also timestamps on receipt
        gps_lat:     location?.lat ?? null,
        gps_lng:     location?.lng ?? null,
        user_agent:  navigator.userAgent,
      });
    }, "image/jpeg", 0.92);
  };

  return (
    <div>
      <video ref={videoRef} autoPlay playsInline style={{ width: "100%" }} />
      <canvas ref={canvasRef} style={{ display: "none" }} />
      <button onClick={capturePhoto}>Take damage photo</button>
      {/* No file input. No gallery button. Intentionally absent. */}
    </div>
  );
}
```

### What camera-only eliminates

| Attack vector | Gallery upload | Camera only |
|---|---|---|
| Downloaded internet photo | Works for fraud | Impossible |
| Old photo from camera roll | Works for fraud | Impossible |
| Pre-delivery photo | Works for fraud | Impossible (timestamp live) |
| Photo from different city | Works for fraud | GPS captured live |
| Edited/manipulated photo | Works for fraud | No time to edit during live capture |

### Server-side verification of live capture metadata

```python
def verify_live_capture_metadata(
    capture_meta: LiveCaptureMetadata,
    delivery: Delivery,
    customer: Customer
) -> SignalResult:

    score    = 0
    evidence = []

    # Timestamp: must be after delivery
    captured_at = datetime.fromisoformat(capture_meta.captured_at)
    if captured_at.date() < delivery.delivered_at.date():
        score += 90
        evidence.append(
            f"Photo captured {capture_meta.captured_at} — before delivery {delivery.delivered_at}"
        )

    # GPS: must be within 50km of delivery address
    if capture_meta.gps_lat and customer.address_lat:
        dist = haversine_km(
            customer.address_lat, customer.address_lng,
            capture_meta.gps_lat, capture_meta.gps_lng
        )
        if dist > 200:
            score += 60
            evidence.append(f"Live capture GPS is {dist:.0f}km from delivery address")
        elif dist > 50:
            score += 25

    return SignalResult(
        score=min(score, 100),
        reason="live_capture_verification",
        detail="; ".join(evidence) if evidence else "live capture verified"
    )
```

---

## 7. Layer 6 — Route cross-reference (catches carrier damage vs fraud)

If multiple customers on the same carrier route, same transit day, report damage — it's a real carrier problem, not fraud. If only one customer on a route reports damage — that's a flag.

```python
def check_route_damage_pattern(
    shipment_id: str,
    carrier: str,
    transit_date: date,
    pincode: str
) -> SignalResult:

    # How many OTHER damage claims on same route in last 7 days?
    route_claims = db.execute("""
        SELECT COUNT(*) FROM damage_claims dc
        JOIN shipments s ON dc.order_id = s.order_id
        WHERE s.carrier = %s
          AND s.pincode = %s
          AND s.transit_date BETWEEN %s AND %s
          AND dc.order_id != %s
    """, (carrier, pincode, transit_date - timedelta(days=7), transit_date, shipment_id))

    count = route_claims.scalar()

    if count >= 5:
        # Likely real carrier damage — reduce suspicion
        return SignalResult(
            score=-20,     # negative score: reduces overall fraud score
            reason="route_damage_cluster",
            detail=f"{count} other damage claims on same route — likely carrier issue"
        )
    if count == 0:
        return SignalResult(
            score=15,
            reason="isolated_damage_claim",
            detail="No other damage claims on same route — isolated claim"
        )
    return SignalResult(score=0, reason="route_normal")
```

**The negative score is intentional.** If 8 customers on the same DHL route all report damaged packages on the same day, that's not fraud — that's a mishandled shipment. The system should reduce suspicion, not increase it.

---

## 8. Complete damage claim scorer

```python
async def score_falsified_damage_claim(
    image_bytes: bytes,
    capture_meta: LiveCaptureMetadata | None,
    order: Order,
    customer: Customer,
    shipment: Shipment
) -> tuple[int, list[dict]]:

    results  = []
    all_scores = []

    # Layer 1: Reverse image search (async — runs while others execute)
    r1 = await reverse_image_search_async(image_bytes)
    results.append({"layer": "reverse_search",    "score": r1.score, "detail": r1.detail})
    all_scores.append(r1.score)

    # Layer 2: EXIF analysis
    r2 = analyse_exif(
        image_bytes,
        delivery_date=shipment.delivered_at.date(),
        customer_address_lat=customer.address_lat,
        customer_address_lng=customer.address_lng,
        account_device_model=customer.registered_device_model
    )
    results.append({"layer": "exif",              "score": r2.score, "detail": r2.detail})
    all_scores.append(r2.score)

    # Layer 3: ELA (only for digital photos, not scans)
    if capture_meta or r2.has_exif_camera_data:
        r3 = run_ela(image_bytes)
        results.append({"layer": "ela",           "score": r3.score, "detail": r3.detail})
        all_scores.append(r3.score)

    # Layer 4: Product comparison
    r4 = compare_product_in_photo(image_bytes, order.product_name, order.listing_image)
    results.append({"layer": "product_match",     "score": r4.score, "detail": r4.detail})
    all_scores.append(r4.score)

    # Layer 5: Live capture metadata (if camera-only flow used)
    if capture_meta:
        r5 = verify_live_capture_metadata(capture_meta, shipment, customer)
        results.append({"layer": "live_capture",  "score": r5.score, "detail": r5.detail})
        all_scores.append(r5.score)

    # Layer 6: Route cross-reference (can reduce score)
    r6 = check_route_damage_pattern(
        shipment.shipment_id, shipment.carrier,
        shipment.transit_date, shipment.pincode
    )
    results.append({"layer": "route_crossref",    "score": r6.score, "detail": r6.detail})

    # Combine: highest signal drives the score, route adjustment applied last
    positive_scores = [s for s in all_scores if s > 0]
    if not positive_scores:
        combined = 0
    elif len(positive_scores) == 1:
        combined = positive_scores[0]
    else:
        sorted_s = sorted(positive_scores, reverse=True)
        combined = sorted_s[0] * 0.55 + sorted_s[1] * 0.30 + sum(sorted_s[2:]) * 0.15

    # Apply route adjustment (can go negative = reduce score)
    final = max(0, min(100, combined + r6.score))

    return int(final), results
```

---

## 9. Data collection requirements

### What you must store per order at shipment time

```sql
CREATE TABLE shipment_damage_context (
  order_id       TEXT PRIMARY KEY,
  carrier        TEXT NOT NULL,
  pincode        TEXT NOT NULL,
  transit_date   DATE NOT NULL,
  delivered_at   TIMESTAMP,
  listing_image_url TEXT             -- product photo URL for comparison
);
```

### What you collect from customer at claim time

```sql
CREATE TABLE damage_claims (
  claim_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id           TEXT NOT NULL,
  image_bytes_hash   TEXT NOT NULL,   -- SHA-256 of submitted image
  capture_timestamp  TIMESTAMP,       -- from live capture meta (NULL if upload allowed)
  capture_lat        NUMERIC(9,6),
  capture_lng        NUMERIC(9,6),
  capture_device     TEXT,
  exif_date          DATE,
  exif_lat           NUMERIC(9,6),
  exif_lng           NUMERIC(9,6),
  exif_device        TEXT,
  reverse_search_hit BOOLEAN DEFAULT false,
  ela_score          INT,
  final_signal_score INT,
  evidence_json      JSONB,
  created_at         TIMESTAMP DEFAULT now()
);

CREATE INDEX idx_damage_order    ON damage_claims (order_id);
CREATE INDEX idx_damage_score    ON damage_claims (final_signal_score DESC);
```

---

## 10. Integration into fusion engine

The damage claim scorer outputs a `FALSIFIED_DAMAGE` signal score. In the fusion formula, this maps to the existing `image_text_consistency` weight when a damage photo is the primary claim document.

```python
# In fusion engine context-aware weights:
# When context = DAMAGE_CLAIM:
#   EXIF weight          = 0.30  (from FUSION_SCORING_V2.md table)
#   image_text           = 0.30  ← this signal feeds here
#   linguistic           = 0.10
#   behavioural          = 0.05
#   address_intelligence = 0.05
#   carrier_signals      = 0.10
#   ring_velocity        = 0.10

damage_score, damage_evidence = await score_falsified_damage_claim(...)
signal_scores["image_text_consistency"] = damage_score
fusion_evidence["damage_claim"]         = damage_evidence
```

---

## 11. False positive protections

| Scenario | Risk | Mitigation |
|---|---|---|
| Legitimate customer, no GPS on phone | GPS check fails, raises score | GPS alone never blocks — must corroborate with date or reverse search |
| Product photo matches stock image online | Reverse search false hit | Partial match = amber (review), not deny. Full match only = high score |
| Low-light photo has high ELA signal | ELA false positive | ELA alone caps contribution at 45. Requires second signal to escalate |
| Customer used old phone for photo | Device mismatch | Device check is +25 only — single weakest signal, never escalates alone |
| Real carrier damage (multiple claims) | Correctly reduced by route signal | Negative route score brings final down — legitimate claims pass faster |
| Customer strips EXIF before upload | Missing metadata | Stripped EXIF = +15 (mild flag) + force live camera for resubmission |

**Hard rule:** no damage claim is denied on a single signal. Score must exceed 70 AND at least two layers must have fired above 40 before the claim routes to orange. Red tier requires three layers above 60.

---

## 12. Build priority for 30-hour hackathon

| Order | Task | Time | What it catches |
|---|---|---|---|
| 1 | EXIF extraction with `exifread` — date + GPS check | 45 min | Pre-delivery photos, wrong location |
| 2 | Google Vision reverse image search | 30 min | Internet-sourced photos |
| 3 | ELA via Pillow + NumPy | 45 min | Edited/manipulated photos |
| 4 | Google Vision label detection for product comparison | 30 min | Wrong product photos |
| 5 | React camera-only component | 45 min | Eliminates upload-based attacks |
| 6 | Route cross-reference query | 30 min | Separates fraud from real carrier damage |
| 7 | `damage_claims` table + evidence JSON logging | 20 min | Audit trail |
| **Total** | | **~3h 45min** | |

**Demo scenario for the pitch:**

1. Submit a real damage photo taken live on the demo phone → all layers clean → green, auto-approved
2. Submit a stock photo of a cracked screen downloaded from Google → reverse search hits → score 95, evidence shows the URL where it was found
3. Submit a photo with EXIF date three weeks before the order was placed → EXIF layer fires at 80 → routed to human review with exact date mismatch shown
4. Submit a photo of a white iPhone for a black Samsung order → product comparison fires → score 85

Four distinct attack types, four distinct detections, one 3-minute demo.

---

*A genuine damage photo is taken now, at the customer's address, on their phone. Every fake fails at date, location, pixel integrity, reverse search, or product identity. Enforce live capture and the threat surface collapses to near zero — the remaining checks catch the edge cases.*
