from database import supabase

class DecisionEngine:
    @staticmethod
    def evaluate_claim(claim_id: str) -> dict:
        """
        Fetches signals for a claim, calculates a weighted fraud score, 
        and returns the decision (approve, friction, reject).
        """
        # 1. Fetch signals
        try:
            res = supabase.table("signals").select("*").eq("claim_id", claim_id).execute()
            signals = res.data
        except Exception as e:
            raise Exception(f"Failed to fetch signals: {e}")
            
        if not signals:
            return {"score": 0.0, "action": "approve"}
            
        # 2. Extract specific values
        ela_score = 0.0
        has_exif = True
        has_receipt_hash = False
        return_freq_high = False
        delivered = False
        otp_verified = False
        
        for sig in signals:
            stype = sig.get("type")
            val = sig.get("value", {})
            
            if stype == "image":
                ela_score = val.get("ela_anomaly_score", 0.0)
                has_exif = val.get("has_exif", True)
            elif stype == "receipt":
                if val.get("hash"):
                    has_receipt_hash = True
            elif stype == "behavioral":
                return_freq_high = val.get("return_frequency_high", False)
            elif stype == "delivery":
                delivered = val.get("delivered", False)
                otp_verified = val.get("otp_verified", False)

        # 3. Calculate Weighted Fraud Score
        score = 0.0
        
        # Fake Damage logic
        if ela_score > 0.7:
            score += 0.5  # Heavy weight for detected image manipulation
        elif ela_score > 0.4:
            score += 0.2
            
        if not has_exif:
            score += 0.2  # Missing EXIF metadata adds suspicion
            
        # Wardrobing/Behavioral logic
        if return_freq_high:
            score += 0.3  # Serial returner
            
        # Delivery/INR logic
        # If they claim INR (not checked explicitly here but delivery verified)
        # and it was delivered with OTP, it's highly suspicious.
        if delivered and otp_verified:
            score += 0.4
            
        # Receipt fraud logic
        # If they didn't upload a receipt, minor friction
        if not has_receipt_hash:
            score += 0.1

        # Normalize score between 0.0 and 1.0
        score = min(max(score, 0.0), 1.0)
        
        # 4. Determine Action based on thresholds
        if score <= 0.3:
            action = "approve"
        elif score <= 0.7:
            action = "friction"
        else:
            action = "reject"
            
        return {
            "score": round(score, 2),
            "action": action
        }

    @staticmethod
    def process_and_store_decision(claim_id: str) -> dict:
        """
        Evaluates the claim and saves the decision to the database.
        """
        decision = DecisionEngine.evaluate_claim(claim_id)
        
        try:
            res = supabase.table("decisions").insert({
                "claim_id": claim_id,
                "score": decision["score"],
                "action": decision["action"]
            }).execute()
            
            # Update the claim status based on decision
            new_status = "APPROVED" if decision["action"] == "approve" else \
                         "REQUIRES_REVIEW" if decision["action"] == "friction" else "REJECTED"
                         
            supabase.table("claims").update({"status": new_status}).eq("id", claim_id).execute()
            
            return decision
        except Exception as e:
            raise Exception(f"Failed to store decision: {e}")
