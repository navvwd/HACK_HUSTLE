import hashlib
import qrcode
import io
import base64
from urllib.parse import urlencode

# A secret pepper to hash against order_id so users can't guess URL tokens
QR_PEPPER = "SecretHackathonPepper2026!"
BASE_URL = "http://localhost:5173"  # Frontend URL

def generate_qr_token(order_id: str) -> str:
    """Generate a short cryptographic token to prevent URL guessing."""
    raw = f"{order_id}{QR_PEPPER}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:8]

def validate_qr_token(order_id: str, token: str) -> bool:
    """Validate that the token belongs to the given order_id."""
    expected_token = generate_qr_token(order_id)
    return token == expected_token

def create_qr_for_order(order_id: str) -> dict:
    """
    Generates a QR code for the customer to scan when their package arrives.
    Returns the scan URL and a base64 encoded PNG of the QR code.
    """
    token = generate_qr_token(order_id)
    scan_url = f"{BASE_URL}/customer/record/{order_id}?token={token}"
    
    qr = qrcode.QRCode(
        version=1,
        error_correction=qrcode.constants.ERROR_CORRECT_L,
        box_size=10,
        border=4,
    )
    qr.add_data(scan_url)
    qr.make(fit=True)

    img = qr.make_image(fill_color="black", back_color="white")
    
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    qr_base64 = base64.b64encode(buf.getvalue()).decode("utf-8")
    
    return {
        "order_id": order_id,
        "scan_url": scan_url,
        "qr_base64": f"data:image/png;base64,{qr_base64}"
    }
