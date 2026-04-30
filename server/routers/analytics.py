"""Analytics router — dashboard data endpoints."""
from fastapi import APIRouter
import json
import database as db

router = APIRouter()

@router.get("/summary")
async def analytics_summary():
    return db.get_analytics_summary()

@router.get("/fingerprints")
async def get_fingerprints():
    clusters = []
    for fp in db.get_all_fingerprints():
        accounts = fp.get("account_ids", [])
        if len(accounts) > 1:
            clusters.append({
                "fingerprint": fp["fingerprint_hash"][:16] + "…",
                "accounts": len(accounts), "account_ids": accounts,
                "first_seen": fp.get("first_seen_at"),
                "risk": "high" if len(accounts) >= 5 else "medium" if len(accounts) >= 3 else "low",
            })
    return {"clusters": sorted(clusters, key=lambda x: x["accounts"], reverse=True)}

@router.get("/graph")
async def get_graph_data():
    nodes, edges, node_set = [], [], set()
    for session in db.get_all_sessions():
        acc = session.get("account_id", "")
        fp = session.get("fingerprint_hash", "")
        ip = session.get("ip", "")
        if acc and acc not in node_set:
            node_set.add(acc)
            nodes.append({"id": acc, "type": "account", "label": acc[:15], "risk": session.get("risk_tier", "green")})
        if fp and fp not in node_set:
            node_set.add(fp)
            nodes.append({"id": fp, "type": "device", "label": fp[:12] + "…", "risk": "neutral"})
        if acc and fp:
            edges.append({"source": acc, "target": fp, "type": "device_link"})
        if ip and ip not in node_set:
            node_set.add(ip)
            nodes.append({"id": ip, "type": "ip", "label": ip, "risk": "neutral"})
        if acc and ip:
            edges.append({"source": acc, "target": ip, "type": "ip_link"})
    return {"nodes": nodes, "edges": edges}

@router.get("/timeline")
async def get_timeline():
    events = []
    for r in db.get_all_returns()[:20]:
        events.append({
            "request_id": r["request_id"], "order_id": r["order_id"],
            "account_id": r["account_id"], "risk_tier": r["risk_tier"],
            "score": r["combined_score"], "reason": r.get("reason", ""),
            "fraud_context": r.get("fraud_context", "default"),
            "timestamp": r["timestamp"],
        })
    return {"events": events}

@router.get("/chargebacks")
async def get_chargebacks():
    conn = db.get_db()
    rows = conn.execute("SELECT * FROM chargeback_events ORDER BY created_at DESC LIMIT 50").fetchall()
    conn.close()
    return {"chargebacks": [dict(r) for r in rows]}

@router.get("/wardrobing")
async def get_wardrobing():
    conn = db.get_db()
    rows = conn.execute("SELECT * FROM return_history WHERE wardrobing_score >= 25 ORDER BY filed_at DESC LIMIT 50").fetchall()
    conn.close()
    return {"wardrobing": [dict(r) for r in rows]}

@router.get("/inr")
async def get_inr_claims():
    returns = db.get_all_returns()
    inr = [r for r in returns if r.get("reason") == "not_received"]
    return {"inr_claims": inr}
