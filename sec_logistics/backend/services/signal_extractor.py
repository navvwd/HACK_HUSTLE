import hashlib
import json
import random
from datetime import datetime
from database import supabase

class SignalExtractor:
    @staticmethod
    def extract_exif(image_path: str):
        """
        Simulates EXIF metadata extraction and Error Level Analysis (ELA).
        In a real scenario, this would use Pillow to parse EXIF and perform pixel analysis.
        """
        # Mocking an anomaly scenario randomly for demonstration
        has_anomaly = random.choice([True, False, False])
        
        return {
            "exif": {
                "gps": {"lat": 12.9716, "lng": 77.5946},
                "device": "iPhone 14 Pro",
                "timestamp": datetime.utcnow().isoformat(),
                "software": "16.5"
            },
            "ela_anomaly_score": 0.85 if has_anomaly else 0.12,
            "has_exif": not has_anomaly
        }

    @staticmethod
    def extract_receipt_hash(receipt_path: str):
        """
        Calculates SHA256 hash of the receipt file to detect duplicates.
        """
        if not receipt_path:
            return None
            
        sha256_hash = hashlib.sha256()
        try:
            with open(receipt_path, "rb") as f:
                for byte_block in iter(lambda: f.read(4096), b""):
                    sha256_hash.update(byte_block)
            return sha256_hash.hexdigest()
        except FileNotFoundError:
            return None

    @staticmethod
    def extract_behavioral(customer_id: str):
        """
        Calculates behavioral return signals for the user.
        """
        # Query total claims in the last 30 days (mocking the date filter for simplicity)
        try:
            res = supabase.table("claims").select("id", count="exact").eq("customer_id", customer_id).execute()
            claim_count = res.count if hasattr(res, 'count') and res.count else len(res.data)
        except Exception:
            claim_count = 0
            
        return {
            "total_claims": claim_count,
            "return_frequency_high": claim_count > 3
        }

    @staticmethod
    def extract_delivery(order_id: str):
        """
        Checks delivery logistics signals.
        """
        try:
            res = supabase.table("deliveries").select("*").eq("order_id", order_id).execute()
            if res.data:
                delivery = res.data[0]
                return {
                    "delivered": True,
                    "otp_verified": delivery.get("otp_verified", False),
                    "delivered_at": delivery.get("delivered_at")
                }
            return {
                "delivered": False,
                "otp_verified": False,
                "delivered_at": None
            }
        except Exception:
            return {
                "delivered": False,
                "otp_verified": False,
                "delivered_at": None
            }

    @staticmethod
    def process_and_store_signals(claim_id: str, order_id: str, customer_id: str, image_path: str, receipt_path: str):
        """
        Master function to extract all signals and store them in the 'signals' table.
        """
        signals_to_insert = []
        
        # 1. EXIF & Image Signals
        image_signals = SignalExtractor.extract_exif(image_path)
        signals_to_insert.append({
            "claim_id": claim_id,
            "type": "image",
            "value": image_signals
        })
        
        # 2. Receipt Signals
        if receipt_path:
            receipt_hash = SignalExtractor.extract_receipt_hash(receipt_path)
            signals_to_insert.append({
                "claim_id": claim_id,
                "type": "receipt",
                "value": {"hash": receipt_hash}
            })
            
        # 3. Behavioral Signals
        behavioral_signals = SignalExtractor.extract_behavioral(customer_id)
        signals_to_insert.append({
            "claim_id": claim_id,
            "type": "behavioral",
            "value": behavioral_signals
        })
        
        # 4. Delivery Signals
        delivery_signals = SignalExtractor.extract_delivery(order_id)
        signals_to_insert.append({
            "claim_id": claim_id,
            "type": "delivery",
            "value": delivery_signals
        })
        
        # Insert all signals
        try:
            supabase.table("signals").insert(signals_to_insert).execute()
        except Exception as e:
            print(f"Error saving signals: {e}")
