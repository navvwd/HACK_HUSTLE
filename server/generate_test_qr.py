import requests
import base64
import os

# Create the videos directory if it doesn't exist
os.makedirs("videos", exist_ok=True)

# Call the API to generate the QR code
res = requests.post("http://127.0.0.1:8000/api/v1/orders/ORD-10000/qr")
data = res.json()

# Extract the base64 string
b64_str = data["qr_base64"].split(",")[1]
image_bytes = base64.b64decode(b64_str)

# Save it to the desktop
output_path = r"C:\Users\DELL\Desktop\sav\test_qr.png"
with open(output_path, "wb") as f:
    f.write(image_bytes)

print("Generated scan URL:", data["scan_url"])
print(f"Saved QR Code image to: {output_path}")
print("\nTo test:")
print("1. Send test_qr.png to your phone (or open it on another screen).")
print("2. Click 'Scan Return QR' in the React sidebar.")
print("3. Hold the QR code up to your webcam!")
