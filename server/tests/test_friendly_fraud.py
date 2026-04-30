import sqlite3
import pytest
from friendly_fraud import get_risk_tier, score, record_chargeback

@pytest.fixture
def db_conn():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute("""
        CREATE TABLE payment_risk_profiles (
            customer_id TEXT PRIMARY KEY,
            risk_tier TEXT,
            claim_count_180d INTEGER DEFAULT 0,
            chargeback_count INTEGER DEFAULT 0,
            last_chargeback_at TEXT,
            largest_chargeback_inr REAL DEFAULT 0
        )
    """)
    conn.execute("""
        CREATE TABLE chargeback_events (
            id INTEGER PRIMARY KEY,
            customer_id TEXT,
            order_id TEXT,
            payment_method TEXT,
            amount_inr REAL,
            chargeback_reason TEXT,
            filed_at TEXT
        )
    """)
    yield conn
    conn.close()

def test_get_risk_tier():
    assert get_risk_tier(0) == "LOW"
    assert get_risk_tier(1) == "MEDIUM"
    assert get_risk_tier(2) == "HIGH"
    assert get_risk_tier(3) == "HIGH"
    assert get_risk_tier(4) == "BLOCKED"

def test_score_no_history(db_conn):
    # Customer with no history
    res = score("cust_new", "upi", db_conn)
    assert res["verdict"] == "OK"
    assert res["score"] == 0

def test_score_high_risk_payment(db_conn):
    # Customer with no history but high risk payment
    res = score("cust_new", "bnpl", db_conn)
    assert res["verdict"] == "WARN"
    assert res["score"] == 30  # 60 // 2

def test_record_chargeback_and_score(db_conn):
    # Record a chargeback
    record_chargeback("cust_1", "order_1", 1000.0, "credit_card", "unauthorised", db_conn)
    
    # Check profile
    row = db_conn.execute("SELECT * FROM payment_risk_profiles WHERE customer_id = 'cust_1'").fetchone()
    assert row is not None
    assert row["chargeback_count"] == 1
    assert row["risk_tier"] == "MEDIUM"
    
    # Score customer
    res = score("cust_1", "credit_card", db_conn)
    assert res["verdict"] == "WARN"
    assert res["score"] >= 25

    # Record more chargebacks to hit BLOCKED tier
    record_chargeback("cust_1", "order_2", 2000.0, "credit_card", "unauthorised", db_conn)
    record_chargeback("cust_1", "order_3", 3000.0, "credit_card", "unauthorised", db_conn)
    record_chargeback("cust_1", "order_4", 4000.0, "credit_card", "unauthorised", db_conn)

    res = score("cust_1", "credit_card", db_conn)
    assert res["verdict"] == "FAIL"
    assert "BLOCKED" in res["detail"]
