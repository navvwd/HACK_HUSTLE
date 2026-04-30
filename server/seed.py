"""Seed demo data for ReturnGuard."""
import json
import uuid
import hashlib
import random
from datetime import datetime, date, timedelta

def seed_all(conn):
    """Seed all demo data."""
    _seed_customers(conn)
    _seed_orders(conn)
    _seed_fraud_ring(conn)
    _seed_category_baselines(conn)
    _seed_wardrobing_demo(conn)
    _seed_friendly_fraud_demo(conn)
    _seed_pincode_intelligence(conn)
    _seed_shipment_deliveries(conn)
    conn.commit()
    print("[SEED] All demo data seeded successfully")

def _seed_customers(conn):
    customers = [
        ("cust_maya_demo", "Maya Sharma", 500, 0),
        ("cust_priya_001", "Priya Nair", 120, 4),
        ("cust_legit_001", "Ravi Kumar", 400, 0),
        ("cust_legit_002", "Sneha Patel", 300, 1),
        ("cust_legit_003", "Arjun Mehta", 250, 0),
        ("cust_legit_004", "Divya Rao", 180, 0),
        ("cust_legit_005", "Karthik S", 90, 1),
    ]
    for cid, name, days_old, ret_count in customers:
        created = (datetime.now() - timedelta(days=days_old)).isoformat()
        conn.execute("INSERT OR IGNORE INTO customers (id, name, created_at, return_count_30d) VALUES (?,?,?,?)",
                     (cid, name, created, ret_count))

def _seed_orders(conn):
    products = [
        ("ORD-10000", "cust_maya_demo", "Boat Airdopes 141 Earbuds", "electronics", 1499, "upi"),
        ("ORD-10001", "cust_legit_001", "Nike Air Max 270", "footwear", 12999, "credit_card"),
        ("ORD-10002", "cust_legit_002", "Levi's 511 Jeans", "apparel", 3999, "upi"),
        ("ORD-10003", "cust_legit_003", "Apple AirPods Pro", "electronics", 24900, "credit_card"),
        ("ORD-10004", "cust_priya_001", "Sony WH-1000XM5", "electronics", 29990, "bnpl"),
        ("ORD-10005", "cust_legit_004", "Dyson V15 Vacuum", "appliance", 52900, "netbanking"),
        ("ORD-10006", "cust_legit_005", "Canon EOS R50", "electronics", 67000, "credit_card"),
        ("ORD-10007", "cust_legit_001", "Adidas Ultraboost", "footwear", 15999, "debit_card"),
    ]
    for oid, cid, name, cat, price, pm in products:
        pdate = (date.today() - timedelta(days=random.randint(5, 20))).isoformat()
        ddate = (datetime.now() - timedelta(days=random.randint(1, 8))).isoformat()
        carrier = random.choice(["DHL", "FedEx", "BlueDart", "Delhivery"])
        pincode = random.choice(["600001", "400001", "110001", "560001"])
        lat = 13.0827 + random.uniform(-0.5, 0.5)
        lng = 80.2707 + random.uniform(-0.5, 0.5)
        conn.execute(
            "INSERT OR IGNORE INTO orders (id, customer_id, item_name, product_category, value_inr, "
            "purchase_date, delivered_at, carrier, pincode, address_lat, address_lng, payment_method) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (oid, cid, name, cat, price, pdate, ddate, carrier, pincode, lat, lng, pm))
        # Receipt hash for each order
        fake_pdf = f"RECEIPT|{oid}|{cid}|{price}|GENUINE".encode()
        h = hashlib.sha256(fake_pdf).hexdigest()
        conn.execute("INSERT OR IGNORE INTO receipt_hashes (order_id, hash_sha256) VALUES (?,?)", (oid, h))

def _seed_fraud_ring(conn):
    ring_device = "fp_RING_DEVICE_X9K2"
    ring_accounts = ["acct_ring_001", "acct_ring_002", "acct_ring_003", "acct_ring_004", "acct_ring_005"]
    for acc in ring_accounts:
        conn.execute("INSERT OR IGNORE INTO customers (id, name, created_at, return_count_30d) VALUES (?,?,?,?)",
                     (acc, f"Ring Member {acc[-3:]}", (datetime.now() - timedelta(days=14)).isoformat(), 3))
    conn.execute("INSERT OR IGNORE INTO device_fingerprints (fingerprint_hash, account_ids_json, first_seen_at) VALUES (?,?,?)",
                 (ring_device, json.dumps(ring_accounts), (datetime.now() - timedelta(days=14)).isoformat()))
    for acc in ring_accounts:
        conn.execute("INSERT OR IGNORE INTO behavioral_profiles (account_id, baseline_json, session_count) VALUES (?,?,?)",
                     (acc, '{}', 0))
        sid = str(uuid.uuid4())
        oid = random.choice(["ORD-10000", "ORD-10001", "ORD-10002", "ORD-10003"])
        ts = (datetime.now() - timedelta(hours=random.randint(1, 72))).isoformat()
        conn.execute(
            "INSERT OR IGNORE INTO sessions (session_id, account_id, fingerprint_hash, ip, order_id, timestamp, risk_tier, carrier, pincode) "
            "VALUES (?,?,?,?,?,?,?,?,?)",
            (sid, acc, ring_device, f"192.168.{random.randint(1,5)}.{random.randint(1,255)}",
             oid, ts, "red", "FedEx", "600001"))

def _seed_category_baselines(conn):
    baselines = [
        ("apparel", 7, '["11","12","1","2","4","5"]', 3, 3000),
        ("shoes", 5, '["11","12","1","2"]', 3, 5000),
        ("footwear", 5, '["11","12","1","2"]', 3, 5000),
        ("jewellery", 3, '["11","12","1","2","4","5"]', 2, 8000),
        ("electronics", 14, '["6","7","12"]', 5, 15000),
        ("appliance", 21, '[]', 7, 10000),
        ("beauty", 7, '[]', 5, 1000),
        ("fashion", 5, '["11","12","1","2"]', 2, 4000),
    ]
    for row in baselines:
        conn.execute(
            "INSERT OR REPLACE INTO category_return_baselines "
            "(category, median_return_gap_days, wardrobing_peak_months, restocking_threshold_days, high_value_threshold_inr) "
            "VALUES (?,?,?,?,?)", row)

def _seed_wardrobing_demo(conn):
    conn.execute("INSERT OR IGNORE INTO customers (id, name, created_at, return_count_30d) VALUES (?,?,?,?)",
                 ("cust_wardrobing", "Ananya Kapoor", (datetime.now() - timedelta(days=200)).isoformat(), 2))
    ddate = (datetime.now() - timedelta(days=1)).isoformat()
    conn.execute(
        "INSERT OR IGNORE INTO orders (id, customer_id, item_name, product_category, value_inr, "
        "purchase_date, delivered_at, carrier, pincode, address_lat, address_lng, payment_method) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        ("ord_wardrobing_001", "cust_wardrobing", "Sabyasachi Lehenga", "apparel", 45000,
         (date.today() - timedelta(days=3)).isoformat(), ddate, "BlueDart", "400049",
         19.0760, 72.8777, "credit_card"))

def _seed_friendly_fraud_demo(conn):
    conn.execute("INSERT OR IGNORE INTO customers (id, name, created_at, return_count_30d) VALUES (?,?,?,?)",
                 ("cust_ff_001", "Vikram Desai", (datetime.now() - timedelta(days=90)).isoformat(), 3))
    ddate = (datetime.now() - timedelta(days=2)).isoformat()
    conn.execute(
        "INSERT OR IGNORE INTO orders (id, customer_id, item_name, product_category, value_inr, "
        "purchase_date, delivered_at, carrier, pincode, address_lat, address_lng, payment_method) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        ("ord_friendly_001", "cust_ff_001", "Apple iPhone 15 Pro", "electronics", 134900,
         (date.today() - timedelta(days=5)).isoformat(), ddate, "FedEx", "560034",
         12.9352, 77.6245, "credit_card"))
    for i in range(3):
        conn.execute(
            "INSERT OR IGNORE INTO chargeback_events (customer_id, order_id, payment_method, amount_inr, chargeback_reason, filed_at) "
            "VALUES (?,?,?,?,?,?)",
            ("cust_ff_001", f"ord_friendly_old_{i}", "credit_card", 15000, "unauthorised",
             (datetime.now() - timedelta(days=(i + 1) * 30)).isoformat()))
    conn.execute(
        "INSERT OR REPLACE INTO payment_risk_profiles (customer_id, chargeback_count, risk_tier, last_chargeback_at) "
        "VALUES ('cust_ff_001', 3, 'HIGH', ?)",
        ((datetime.now() - timedelta(days=30)).isoformat(),))

def _seed_pincode_intelligence(conn):
    pincodes = [
        ("600001", 5.2, 3.1, 1, "TIER1"),
        ("400001", 4.8, 2.5, 1, "TIER1"),
        ("110001", 6.1, 4.2, 1, "TIER1"),
        ("560001", 3.9, 2.0, 1, "TIER1"),
        ("400049", 3.5, 1.8, 1, "TIER1"),
        ("560034", 4.0, 2.2, 1, "TIER1"),
    ]
    for row in pincodes:
        conn.execute("INSERT OR REPLACE INTO pincode_intelligence (pincode, rto_rate, inr_rate, cod_allowed, tier) VALUES (?,?,?,?,?)", row)

def _seed_shipment_deliveries(conn):
    """Seed delivery records for demo orders."""
    orders_with_delivery = ["ORD-10000", "ORD-10001", "ORD-10002", "ORD-10003", "ORD-10004",
                            "ORD-10005", "ORD-10006", "ORD-10007", "ord_friendly_001"]
    for oid in orders_with_delivery:
        conn.execute(
            "INSERT OR IGNORE INTO shipment_deliveries (order_id, carrier, delivered_at, gps_lat, gps_lng, otp_confirmed) "
            "VALUES (?,?,?,?,?,?)",
            (oid, random.choice(["DHL", "FedEx", "BlueDart"]),
             (datetime.now() - timedelta(days=random.randint(1, 5))).isoformat(),
             13.08 + random.uniform(-0.01, 0.01), 80.27 + random.uniform(-0.01, 0.01),
             random.choice([0, 0, 0, 1])))
    # Engagement events for friendly fraud demo (proves they received it)
    conn.execute(
        "INSERT OR IGNORE INTO engagement_events (customer_id, order_id, event_type, occurred_at) VALUES (?,?,?,?)",
        ("cust_ff_001", "ord_friendly_001", "app_login", (datetime.now() - timedelta(hours=12)).isoformat()))
