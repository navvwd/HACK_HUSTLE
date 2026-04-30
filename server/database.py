"""
ReturnGuard — SQLite Database Layer.
Primary storage for all fraud detection data.
Supabase used only for receipt hash verification (optional).
"""
import sqlite3
import json
import uuid
import os
from datetime import datetime, date, timedelta
from typing import Optional
from pathlib import Path

from config import DB_PATH

def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn

async def init_db():
    conn = get_db()
    schema_path = os.path.join(os.path.dirname(__file__), "schema.sql")
    with open(schema_path) as f:
        conn.executescript(f.read())
    conn.commit()
    count = conn.execute("SELECT COUNT(*) FROM orders").fetchone()[0]
    if count == 0:
        from seed import seed_all
        seed_all(conn)
        print("[OK] SQLite database initialized with demo data")
    else:
        print(f"[OK] SQLite database loaded ({count} orders)")
    conn.close()

# ─── Order Functions ──────────────────────────────────────────────────────────

def get_order(order_id: str) -> Optional[dict]:
    conn = get_db()
    row = conn.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
    conn.close()
    if not row:
        return None
    d = dict(row)
    # Backward compat: map column names used by damage/receipt detection
    d["item_name"] = d.get("item_name", "")
    d["amount"] = d.get("value_inr", 0)
    d["purchase_date"] = d.get("purchase_date")
    d["delivered_at"] = d.get("delivered_at")
    return d

# ─── Fingerprint Functions ────────────────────────────────────────────────────

def get_fingerprint(fp_hash: str) -> Optional[dict]:
    conn = get_db()
    row = conn.execute("SELECT * FROM device_fingerprints WHERE fingerprint_hash = ?", (fp_hash,)).fetchone()
    conn.close()
    if not row:
        return None
    return {
        "fingerprint_hash": row["fingerprint_hash"],
        "account_ids": json.loads(row["account_ids_json"]),
        "first_seen_at": row["first_seen_at"],
    }

def upsert_fingerprint(fp_hash: str, account_id: str):
    conn = get_db()
    row = conn.execute("SELECT account_ids_json FROM device_fingerprints WHERE fingerprint_hash = ?", (fp_hash,)).fetchone()
    if row:
        ids = json.loads(row["account_ids_json"])
        if account_id not in ids:
            ids.append(account_id)
            conn.execute("UPDATE device_fingerprints SET account_ids_json = ? WHERE fingerprint_hash = ?",
                         (json.dumps(ids), fp_hash))
    else:
        conn.execute("INSERT INTO device_fingerprints (fingerprint_hash, account_ids_json) VALUES (?, ?)",
                     (fp_hash, json.dumps([account_id])))
    conn.commit()
    conn.close()

def get_all_fingerprints() -> list[dict]:
    conn = get_db()
    rows = conn.execute("SELECT * FROM device_fingerprints").fetchall()
    conn.close()
    return [{"fingerprint_hash": r["fingerprint_hash"],
             "account_ids": json.loads(r["account_ids_json"]),
             "first_seen_at": r["first_seen_at"]} for r in rows]

# ─── Behavioral Functions ─────────────────────────────────────────────────────

def get_behavioral_profile(account_id: str) -> Optional[dict]:
    conn = get_db()
    row = conn.execute("SELECT * FROM behavioral_profiles WHERE account_id = ?", (account_id,)).fetchone()
    conn.close()
    if not row:
        return None
    bl = json.loads(row["baseline_json"]) if row["baseline_json"] else None
    return {"baseline": bl, "session_count": row["session_count"]}

def update_behavioral_profile(account_id: str, session_data: dict):
    conn = get_db()
    row = conn.execute("SELECT session_count FROM behavioral_profiles WHERE account_id = ?", (account_id,)).fetchone()
    if row:
        conn.execute("UPDATE behavioral_profiles SET session_count = session_count + 1 WHERE account_id = ?", (account_id,))
    else:
        conn.execute("INSERT INTO behavioral_profiles (account_id, baseline_json, session_count) VALUES (?, ?, 1)",
                     (account_id, json.dumps(session_data)))
    conn.commit()
    conn.close()

# ─── Session Functions ─────────────────────────────────────────────────────────

def add_session(session: dict):
    conn = get_db()
    sid = session.get("session_id", str(uuid.uuid4()))
    conn.execute(
        "INSERT OR REPLACE INTO sessions (session_id, account_id, fingerprint_hash, ip, order_id, timestamp, risk_tier, carrier, pincode) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (sid, session.get("account_id"), session.get("fingerprint_hash"), session.get("ip"),
         session.get("order_id"), datetime.now().isoformat(), session.get("risk_tier", "green"),
         session.get("carrier", ""), session.get("pincode", ""))
    )
    conn.commit()
    conn.close()

def get_all_sessions() -> list[dict]:
    conn = get_db()
    rows = conn.execute("SELECT * FROM sessions ORDER BY timestamp DESC LIMIT 200").fetchall()
    conn.close()
    return [dict(r) for r in rows]

# ─── Return Request Functions ──────────────────────────────────────────────────

def add_return_request(req: dict):
    conn = get_db()
    rid = req.get("request_id", f"RET-{uuid.uuid4().hex[:8].upper()}")
    conn.execute(
        "INSERT OR REPLACE INTO return_requests "
        "(request_id, order_id, account_id, reason, description, combined_score, risk_tier, "
        "scorers_json, action, customer_message, corroboration_met, fraud_context, capture_method, timestamp) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (rid, req.get("order_id"), req.get("account_id"), req.get("reason"),
         req.get("description", ""), req.get("combined_score", 0), req.get("risk_tier", "green"),
         json.dumps(req.get("scorers", {})), req.get("action", ""), req.get("customer_message", ""),
         1 if req.get("corroboration_met") else 0, req.get("fraud_context", "default"),
         req.get("capture_method", "file_upload"), req.get("timestamp", datetime.now().isoformat()))
    )
    conn.commit()
    conn.close()

def get_all_returns() -> list[dict]:
    conn = get_db()
    rows = conn.execute("SELECT * FROM return_requests ORDER BY timestamp DESC LIMIT 50").fetchall()
    conn.close()
    results = []
    for r in rows:
        d = dict(r)
        d["scorers"] = json.loads(d.get("scorers_json") or "{}")
        results.append(d)
    return results

def get_return_by_id(request_id: str) -> Optional[dict]:
    conn = get_db()
    row = conn.execute("SELECT * FROM return_requests WHERE request_id = ?", (request_id,)).fetchone()
    conn.close()
    if not row:
        return None
    d = dict(row)
    d["scorers"] = json.loads(d.get("scorers_json") or "{}")
    return d

# ─── Review Queue Functions ────────────────────────────────────────────────────

def add_to_review_queue(req: dict):
    conn = get_db()
    rid = req.get("request_id", str(uuid.uuid4()))
    conn.execute(
        "INSERT OR REPLACE INTO review_queue (request_id, status, data_json) VALUES (?, 'pending', ?)",
        (rid, json.dumps(req))
    )
    conn.commit()
    conn.close()

def get_review_queue() -> list[dict]:
    conn = get_db()
    rows = conn.execute("SELECT * FROM review_queue WHERE status = 'pending' ORDER BY rowid DESC").fetchall()
    conn.close()
    result = []
    for r in rows:
        d = json.loads(r["data_json"])
        d["status"] = r["status"]
        d["request_id"] = r["request_id"]
        result.append(d)
    return result

def update_review_decision(request_id: str, decision: str, reviewer: str) -> bool:
    conn = get_db()
    row = conn.execute("SELECT * FROM review_queue WHERE request_id = ?", (request_id,)).fetchone()
    if not row:
        conn.close()
        return False
    conn.execute("UPDATE review_queue SET status = ?, reviewed_by = ?, reviewed_at = ? WHERE request_id = ?",
                 (decision, reviewer, datetime.now().isoformat(), request_id))
    conn.commit()
    conn.close()
    return True

def get_review_stats() -> dict:
    conn = get_db()
    total = conn.execute("SELECT COUNT(*) FROM review_queue").fetchone()[0]
    pending = conn.execute("SELECT COUNT(*) FROM review_queue WHERE status = 'pending'").fetchone()[0]
    approved = conn.execute("SELECT COUNT(*) FROM review_queue WHERE status = 'approved'").fetchone()[0]
    denied = conn.execute("SELECT COUNT(*) FROM review_queue WHERE status = 'denied'").fetchone()[0]
    conn.close()
    return {"total": total, "pending": pending, "approved": approved, "denied": denied, "escalated": 0}

# ─── Receipt Hash Functions ───────────────────────────────────────────────────

def get_receipt_hash(order_id: str) -> Optional[str]:
    conn = get_db()
    row = conn.execute("SELECT hash_sha256 FROM receipt_hashes WHERE order_id = ?", (order_id,)).fetchone()
    conn.close()
    return row["hash_sha256"] if row else None

# ─── Route Damage Count ───────────────────────────────────────────────────────

def get_route_damage_count(carrier: str, pincode: str, transit_date) -> int:
    conn = get_db()
    cutoff = (datetime.now() - timedelta(days=7)).isoformat()
    row = conn.execute(
        "SELECT COUNT(*) FROM sessions WHERE carrier = ? AND pincode = ? AND timestamp > ?",
        (carrier, pincode, cutoff)
    ).fetchone()
    conn.close()
    return row[0] if row else 0

# ─── Analytics Summary ─────────────────────────────────────────────────────────

def get_analytics_summary() -> dict:
    conn = get_db()
    total = conn.execute("SELECT COUNT(*) FROM return_requests").fetchone()[0]
    tiers = {"green": 0, "amber": 0, "orange": 0, "red": 0}
    for row in conn.execute("SELECT risk_tier, COUNT(*) as c FROM return_requests GROUP BY risk_tier").fetchall():
        if row["risk_tier"] in tiers:
            tiers[row["risk_tier"]] = row["c"]

    recent = []
    for row in conn.execute("SELECT * FROM return_requests ORDER BY timestamp DESC LIMIT 7").fetchall():
        recent.append({
            "date": (row["timestamp"] or "")[:10],
            "tier": row["risk_tier"] or "green",
            "score": row["combined_score"] or 0,
        })

    pending = conn.execute("SELECT COUNT(*) FROM review_queue WHERE status = 'pending'").fetchone()[0]
    ring_fp = conn.execute("SELECT account_ids_json FROM device_fingerprints WHERE fingerprint_hash = 'fp_RING_DEVICE_X9K2'").fetchone()
    ring_count = len(json.loads(ring_fp["account_ids_json"])) if ring_fp else 0

    # New stats
    chargebacks = conn.execute("SELECT COUNT(*) FROM chargeback_events").fetchone()[0]
    wardrobing_flags = conn.execute("SELECT COUNT(*) FROM return_history WHERE wardrobing_score >= 50").fetchone()[0]
    inr_claims = conn.execute("SELECT COUNT(*) FROM return_requests WHERE reason = 'not_received'").fetchone()[0]

    conn.close()
    return {
        "total_returns": total,
        "tier_distribution": tiers,
        "recent_activity": recent,
        "fraud_ring_accounts": ring_count,
        "pending_reviews": pending,
        "blocked_this_week": tiers.get("red", 0),
        "auto_approved": tiers.get("green", 0),
        "chargebacks": chargebacks,
        "wardrobing_flags": wardrobing_flags,
        "inr_claims": inr_claims,
    }
