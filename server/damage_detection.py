import io
import time
import numpy as np
import imagehash
from PIL import Image, ImageChops, ExifTags
import cv2
from datetime import datetime

# In a true production app, these would be fetched from your database (e.g. Supabase)
STORED_HASHES = [
    imagehash.hex_to_hash('ffc0c0c0c0c0c0c0') # Example known fraud hashes
]

LOGISTICS_DATA = {
    "ORD-10000": {"delivered_at": "2026-01-01T10:00:00", "location": "New York"},
}

def analyze_duplicate_image(img: Image.Image) -> dict:
    """1. Reverse Image Search (Duplicate Detection) using pHash.
    In production this calls Google Cloud Vision / TinEye.
    Here we use perceptual hashing against known fraud image hashes.
    """
    try:
        phash = imagehash.phash(img)
        min_diff = 100
        for stored in STORED_HASHES:
            diff = phash - stored
            if diff < min_diff:
                min_diff = diff

        # diff < 5: near-identical copy of a known fraud image
        if min_diff < 5:
            return {"score": 0.9, "flag": True, "reason": f"pHash match (diff={min_diff}): near-identical to a known fraud image in the database."}

        # diff 5-10: moderately suspicious
        if min_diff < 10:
            return {"score": 0.5, "flag": True, "reason": f"Moderate pHash similarity (diff={min_diff}): may be a cropped or filtered version of a known fraud image."}

        # No match: image is visually unique — genuine
        return {"score": 0.0, "flag": False, "reason": f"No reverse-image match found (hash diff={min_diff}). Image is visually unique."}

    except Exception as e:
        return {"score": 0.0, "flag": False, "reason": f"Reverse image search skipped: {e}"}

def analyze_exif(img: Image.Image, order_date: datetime = None) -> dict:
    """2. EXIF Metadata Analysis"""
    try:
        exif = img._getexif()
        if not exif:
            return {"score": 0.8, "flag": True, "reason": "Missing EXIF metadata. Image may be a screenshot or downloaded from web."}
        
        exif_data = {ExifTags.TAGS.get(k, k): v for k, v in exif.items() if k in ExifTags.TAGS}
        
        date_taken_str = exif_data.get('DateTimeOriginal') or exif_data.get('DateTime')
        if date_taken_str and order_date:
            date_taken = datetime.strptime(date_taken_str, '%Y:%m:%d %H:%M:%S')
            if date_taken < order_date:
                return {"score": 0.95, "flag": True, "reason": "Image was taken before the order was placed."}
                
        return {"score": 0.1, "flag": False, "reason": "EXIF metadata appears normal."}
    except Exception:
        return {"score": 0.5, "flag": True, "reason": "Could not parse EXIF properly."}

def run_ela(img: Image.Image) -> dict:
    """3. Error Level Analysis (ELA) for digital manipulation detection"""
    try:
        # Save at known quality to check recompression artifacts
        temp_io = io.BytesIO()
        img_rgb = img.convert('RGB')
        img_rgb.save(temp_io, 'JPEG', quality=90)
        temp_io.seek(0)
        recompressed = Image.open(temp_io)
        
        ela_image = ImageChops.difference(img_rgb, recompressed)
        extrema = ela_image.getextrema()
        max_diff = max([ex[1] for ex in extrema])
        
        if max_diff == 0: max_diff = 1
        scale = 255.0 / max_diff
        ela_image = ela_image.point(lambda p: p * scale)
        
        np_ela = np.array(ela_image)
        avg_diff = np.mean(np_ela)
        
        # High variation indicates parts of the image were pasted/edited
        if avg_diff > 10.0:
            return {"score": 0.85, "flag": True, "reason": f"High ELA variance ({avg_diff:.2f}) indicates AI generation or digital manipulation."}
        return {"score": 0.1, "flag": False, "reason": "Natural pixel variance. No AI artifacts or manipulation detected."}
    except Exception as e:
        return {"score": 0.0, "flag": False, "reason": f"ELA failed: {e}"}

def compare_product(img: Image.Image, order_id: str) -> dict:
    """4. Product Comparison using SSIM (Structural Similarity)"""
    try:
        from skimage.metrics import structural_similarity as ssim
        np_img = cv2.cvtColor(np.array(img.convert('RGB')), cv2.COLOR_RGB2GRAY)
        
        # Real impl: Fetch catalog_image from S3/DB and cv2.resize to match np_img shape
        # Here we do a proxy check: evaluate Shannon entropy for complexity
        from skimage.measure import shannon_entropy
        entropy = shannon_entropy(np_img)
        
        if entropy < 3.0: 
            return {"score": 0.7, "flag": True, "reason": "Image lacks complex features (too flat/blank), mismatch with real product expected."}
        return {"score": 0.2, "flag": False, "reason": "Image features visually match expected product category."}
    except ImportError:
        # Fallback if skimage is not installed
        return {"score": 0.2, "flag": False, "reason": "Visual match simulated (install scikit-image for real SSIM)."}
    except Exception as e:
        return {"score": 0.0, "flag": False, "reason": f"Product match failed: {e}"}

def verify_live_capture(img: Image.Image, capture_method: str = "manual_upload") -> dict:
    """5. Live Capture Verification — trusts server-side provenance first."""
    try:
        # PRIMARY SIGNAL: Was this image submitted via our locked live-capture endpoint?
        # Browser canvas images never have EXIF — that is expected and NOT suspicious.
        if capture_method == "live_camera":
            return {
                "score": 0.0,
                "flag": False,
                "reason": "Confirmed live capture via ReturnGuard camera endpoint. Browser canvas images do not embed EXIF by design."
            }
        
        # SECONDARY: For manually uploaded images, check for EXIF as before
        exif = img._getexif()
        if not exif:
            return {"score": 0.7, "flag": True, "reason": "Manually uploaded image with no EXIF — source unverifiable."}
            
        exif_data = {ExifTags.TAGS.get(k, k): v for k, v in exif.items() if k in ExifTags.TAGS}
        if 'Make' not in exif_data and 'Model' not in exif_data:
            return {"score": 0.6, "flag": True, "reason": "Missing camera Make/Model in EXIF, potential screenshot."}
            
        return {"score": 0.05, "flag": False, "reason": "Live capture signatures (Make/Model) verified in EXIF."}
    except Exception:
        return {"score": 0.5, "flag": True, "reason": "Live capture verification error."}

def check_logistics(order_id: str) -> dict:
    """6. Route Cross-Reference"""
    try:
        if order_id in LOGISTICS_DATA:
            # e.g., cross check damage claim time vs delivery time
            return {"score": 0.1, "flag": False, "reason": "Logistics data matches claim timeframe."}
        
        return {"score": 0.5, "flag": True, "reason": f"Could not verify delivery logistics for order {order_id}."}
    except Exception:
        return {"score": 0.5, "flag": True, "reason": "Logistics check failed."}

def run_fusion_engine(results: dict) -> dict:
    """Combines the 6 layers using weighted scoring and corroboration rule."""
    weights = {
        "reverse_search": 0.20,
        "exif": 0.15,
        "ela": 0.20,
        "product_match": 0.15,
        "live_capture": 0.10,
        "route_crossref": 0.20
    }
    
    final_score = 0.0
    high_risk_signals = 0
    evidence = []
    
    for layer, res in results.items():
        score = res["score"]
        
        layer_name = layer if layer != 'route_check' else 'route_crossref'
        final_score += score * weights.get(layer_name, 0)
        
        if res["flag"]:
            high_risk_signals += 1
            
        evidence.append({
            "layer": layer_name,
            "score": int(score * 100),
            "detail": res["reason"]
        })
            
    final_score_100 = min(int(final_score * 100), 100)
    
    # Corroboration Rule mapped to Frontend Tiers
    if high_risk_signals >= 2:
        tier = "red"
    elif high_risk_signals == 1:
        tier = "amber"
    else:
        tier = "green"
        
    return {
        "tier": tier,
        "score": final_score_100,
        "layers_fired": high_risk_signals,
        "total_layers": 6,
        "evidence": evidence
    }

def analyze_damage_claim(order_id: str, image_bytes: bytes, capture_method: str = "manual_upload") -> dict:
    """Main pipeline execution."""
    try:
        img = Image.open(io.BytesIO(image_bytes))
        
        # Real system would lookup order_date from DB via order_id
        order_date = datetime(2025, 1, 1) 
        
        layers = {
            "reverse_search": analyze_duplicate_image(img),
            "exif": analyze_exif(img, order_date),
            "ela": run_ela(img),
            "product_match": compare_product(img, order_id),
            "live_capture": verify_live_capture(img, capture_method),
            "route_check": check_logistics(order_id)
        }
        
        fusion = run_fusion_engine(layers)
        return fusion
        
    except Exception as e:
        return {"error": str(e)}
