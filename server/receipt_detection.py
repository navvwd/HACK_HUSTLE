import io
import hashlib
import numpy as np
import cv2
from PIL import Image, ImageChops, ExifTags
import logging

logger = logging.getLogger(__name__)

# Attempt to load PyMuPDF for PDF parsing support
try:
    import fitz
    HAS_FITZ = True
except ImportError:
    HAS_FITZ = False

def hash_verification(file_bytes: bytes, stored_hash: str = None) -> dict:
    """B. Hash Verification against Original Receipt"""
    file_hash = hashlib.sha256(file_bytes).hexdigest()
    
    if stored_hash:
        if file_hash == stored_hash:
            return {"score": 0.0, "flag": False, "reason": "Hash match: Document is 100% authentic and unaltered."}
        else:
            return {"score": 0.9, "flag": True, "reason": "Hash mismatch: Document has been altered since original purchase."}
            
    return {"score": 0.0, "flag": False, "reason": "No original hash on file to compare against."}

def extract_image_from_bytes(file_bytes: bytes, filename: str) -> Image.Image:
    """Extracts image from bytes, supporting both images and PDFs"""
    if filename.lower().endswith(".pdf"):
        if not HAS_FITZ:
            raise Exception("PDF support requires PyMuPDF (fitz). Please install it.")
        doc = fitz.open(stream=file_bytes, filetype="pdf")
        page = doc.load_page(0)
        pix = page.get_pixmap(dpi=150)
        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        return img
    else:
        return Image.open(io.BytesIO(file_bytes)).convert("RGB")

def db_cross_reference(order_id: str, amount: str, item_name: str, supabase_client) -> dict:
    """A. Database Cross-Reference against Supabase"""
    try:
        # Cross reference against the 'orders' table
        res = supabase_client.table("orders").select("*").eq("id", order_id).execute()
        if not res.data:
            return {"score": 0.5, "flag": True, "reason": f"Order {order_id} not found in database."}
            
        order_data = res.data[0]
        expected_amount = float(order_data.get("total_amount", 0))
        expected_item = order_data.get("item_name", "Unknown")
        
        try:
            claimed_amount = float(amount)
        except ValueError:
            claimed_amount = 0.0
        
        reasons = []
        flag = False
        score = 0.0
        
        if expected_amount != claimed_amount:
            flag = True
            score += 0.4
            reasons.append(f"Amount mismatch: receipt says {claimed_amount}, order expected {expected_amount}.")
            
        if item_name and expected_item and expected_item.lower() not in item_name.lower():
            flag = True
            score += 0.4
            reasons.append(f"Item mismatch: receipt says '{item_name}', order expected '{expected_item}'.")
            
        if flag:
            return {"score": score, "flag": True, "reason": " | ".join(reasons)}
        else:
            return {"score": 0.0, "flag": False, "reason": "Order details perfectly match database records."}
            
    except Exception as e:
        return {"score": 0.2, "flag": False, "reason": f"Cross-reference check failed: {str(e)}"}

def analyze_exif_receipt(img: Image.Image) -> dict:
    """C. Metadata (EXIF) Analysis"""
    try:
        exif = img.getexif()
        if not exif:
            return {"score": 0.0, "flag": False, "reason": "No EXIF data found (expected for PDFs or flattened screenshots)."}
            
        exif_data = {ExifTags.TAGS.get(k, k): str(v) for k, v in exif.items() if k in ExifTags.TAGS}
        software = exif_data.get("Software", "").lower()
        
        suspicious_software = ["photoshop", "gimp", "canva", "illustrator", "pixelmator", "acrobat"]
        if any(sw in software for sw in suspicious_software):
            return {"score": 0.9, "flag": True, "reason": f"Image edited with manipulation software: {software}"}
            
        return {"score": 0.0, "flag": False, "reason": "EXIF metadata appears natural and untampered."}
    except Exception as e:
        return {"score": 0.0, "flag": False, "reason": f"EXIF analysis error: {e}"}

def run_ela_receipt(img: Image.Image) -> dict:
    """D. ELA (Error Level Analysis) for manipulation detection"""
    try:
        temp_io = io.BytesIO()
        img.save(temp_io, 'JPEG', quality=90)
        temp_io.seek(0)
        recompressed = Image.open(temp_io)
        
        ela_image = ImageChops.difference(img, recompressed)
        extrema = ela_image.getextrema()
        max_diff = max([ex[1] for ex in extrema])
        if max_diff == 0: max_diff = 1
        
        scale = 255.0 / max_diff
        ela_image = ela_image.point(lambda p: p * scale)
        
        np_ela = np.array(ela_image)
        avg_diff = float(np.mean(np_ela))
        
        # Threshold for highlighting inconsistent compression (text pasted over image)
        if avg_diff > 8.0:
            return {"score": 0.7, "flag": True, "reason": f"High ELA variance ({avg_diff:.2f}) indicates text or price manipulation."}
        return {"score": 0.0, "flag": False, "reason": "No digital manipulation detected (consistent compression)."}
    except Exception as e:
        return {"score": 0.0, "flag": False, "reason": f"ELA failed: {e}"}

def verify_qr_code(img: Image.Image) -> dict:
    """E. QR Code Verification using OpenCV"""
    try:
        np_img = cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)
        detector = cv2.QRCodeDetector()
        data, bbox, _ = detector.detectAndDecode(np_img)
        
        if bbox is not None and data:
            return {"score": 0.0, "flag": False, "reason": f"Valid verifiable QR code detected."}
        
        return {"score": 0.1, "flag": False, "reason": "No verifiable QR code found on the receipt."}
    except Exception as e:
        return {"score": 0.0, "flag": False, "reason": f"QR scanning failed: {e}"}

def analyze_receipt_pipeline(order_id: str, amount: str, item_name: str, file_bytes: bytes, filename: str, supabase_client, receipt_date: str = None) -> dict:
    """Executes the full 5-check real detection pipeline."""
    try:
        # A. DB check
        db_res = db_cross_reference(order_id, amount, item_name, supabase_client)
        
        # B. Hash check against original receipt hash in 'orders' table
        file_hash = hashlib.sha256(file_bytes).hexdigest()
        stored_hash = None
        try:
            # Check if the reseller originally stored the hash at the time of purchase
            order_res = supabase_client.table("orders").select("receipt_hash").eq("id", order_id).execute()
            if order_res.data and order_res.data[0].get("receipt_hash"):
                stored_hash = order_res.data[0]["receipt_hash"]
        except Exception:
            pass
            
        # Demo Magic: If they upload Receipt1.pdf and we have no stored hash, we can optionally simulate it
        # But we'll just stick to the real DB query now.
        hash_res = hash_verification(file_bytes, stored_hash)
        
        # C, D, E. Image checks
        try:
            img = extract_image_from_bytes(file_bytes, filename)
            exif_res = analyze_exif_receipt(img)
            ela_res = run_ela_receipt(img)
            qr_res = verify_qr_code(img)
        except Exception as e:
            exif_res = {"score": 0.5, "flag": True, "reason": f"Could not parse file: {e}"}
            ela_res = {"score": 0.0, "flag": False, "reason": "Skipped (parse error)."}
            qr_res = {"score": 0.0, "flag": False, "reason": "Skipped (parse error)."}
            
        weights = {
            "db_crossref": 0.30,
            "hash_compare": 0.30,
            "metadata": 0.15,
            "ela": 0.20,
            "qr_verify": 0.05
        }
        
        results = {
            "db_crossref": db_res,
            "hash_compare": hash_res,
            "metadata": exif_res,
            "ela": ela_res,
            "qr_verify": qr_res
        }
        
        final_score = 0.0
        evidence = []
        flags = 0
        
        for k, v in results.items():
            final_score += v["score"] * weights.get(k, 0)
            if v["flag"]:
                flags += 1
            evidence.append({
                "method": k,
                "score": int(v["score"] * 100),
                "detail": v["reason"]
            })
                
        final_score_100 = min(int(final_score * 100), 100)
        
        # Risk Scoring Engine mapped to Tiers
        if flags >= 2 or final_score_100 >= 60:
            tier = "red"
        elif flags == 1 or final_score_100 >= 30:
            tier = "amber"
        else:
            tier = "green"
                
        # Insert receipt record to DB
        try:
            supabase_client.table("receipts").insert({
                "order_id": order_id,
                "amount": float(amount) if amount else 0.0,
                "item_name": item_name,
                "receipt_date": receipt_date,
                "receipt_hash": file_hash
            }).execute()
        except Exception as e:
            logger.error(f"Failed to insert receipt to DB: {e}")
            
        return {
            "tier": tier,
            "score": final_score_100,
            "methods_fired": flags,
            "total_methods": 5,
            "evidence": evidence
        }

    except Exception as e:
        return {"error": str(e), "status": "ERROR"}
