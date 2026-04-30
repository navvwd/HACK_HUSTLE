import { useState } from 'react';
import { Shield, Eye, Scale, AlertTriangle, CheckCircle, Clock, Loader, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import axios from 'axios';

const DEMO_PRESETS = [
  {
    key: "fraud_ring",
    label: "🔴 Fraud Ring Member",
    data: {
      account_data: { account_id: "cust_ring_007", created_at: "2026-01-02", total_orders: 18 },
      order_history: [
        { order_id: "ORD-10000", item: "Samsung Galaxy S23", amount: 74999, purchased_at: "2026-01-10" },
        { order_id: "ORD-10001", item: "iPhone 15 Pro", amount: 134999, purchased_at: "2026-01-12" },
      ],
      return_claims: [
        { claim_id: "CLM-001", order_id: "ORD-10000", reason: "not_received", filed_at: "2026-01-12" },
        { claim_id: "CLM-002", order_id: "ORD-10001", reason: "not_received", filed_at: "2026-01-14" },
      ],
      device_links: ["fp_RING_A", "fp_RING_B", "fp_RING_C"],
      ip_links: ["192.168.x.x", "10.0.x.x"],
      address_links: ["same_building_cluster"],
      behavioral_signals: { dwell_avg: 12, mouse_velocity: 950, scroll_rhythm: 3 },
      graph_relationships: { cluster_size: 9, connected_accounts: 8, shared_devices: 3 }
    }
  },
  {
    key: "wardrobing",
    label: "🟡 Wardrobing Pattern",
    data: {
      account_data: { account_id: "cust_wardrobe_33", created_at: "2025-06-01", total_orders: 7 },
      order_history: [
        { order_id: "ORD-20001", item: "Designer Saree", amount: 8999, purchased_at: "2026-03-20" },
        { order_id: "ORD-20002", item: "Party Dress", amount: 5499, purchased_at: "2026-03-28" },
      ],
      return_claims: [
        { claim_id: "CLM-010", order_id: "ORD-20001", reason: "damaged", filed_at: "2026-03-27", days_held: 7 },
        { claim_id: "CLM-011", order_id: "ORD-20002", reason: "size_issue", filed_at: "2026-04-04", days_held: 7 },
      ],
      device_links: ["fp_user_ABC"],
      ip_links: ["home_ip"],
      address_links: [],
      behavioral_signals: { dwell_avg: 90, mouse_velocity: 200, scroll_rhythm: 25 },
      graph_relationships: { cluster_size: 1, connected_accounts: 0, shared_devices: 0 }
    }
  },
  {
    key: "legitimate",
    label: "🟢 Legitimate Customer",
    data: {
      account_data: { account_id: "cust_maya_legit", created_at: "2024-11-15", total_orders: 5 },
      order_history: [
        { order_id: "ORD-10000", item: "Samsung Galaxy S23", amount: 74999, purchased_at: "2026-04-20" },
      ],
      return_claims: [
        { claim_id: "CLM-050", order_id: "ORD-10000", reason: "defective", filed_at: "2026-04-23", days_held: 3 }
      ],
      device_links: ["fp_single_device"],
      ip_links: ["home_stable_ip"],
      address_links: [],
      behavioral_signals: { dwell_avg: 110, mouse_velocity: 180, scroll_rhythm: 32 },
      graph_relationships: { cluster_size: 1, connected_accounts: 0, shared_devices: 0 }
    }
  }
];

const RISK_COLORS = { LOW: 'var(--green)', MEDIUM: 'var(--orange)', HIGH: 'var(--red)' };
const DECISION_COLORS = { APPROVE: 'var(--green)', REVIEW: 'var(--orange)', HOLD: 'var(--red)' };

function Section({ title, icon: Icon, color, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ border: `1px solid ${color}22`, borderRadius: 12, marginBottom: 16, overflow: 'hidden' }}>
      <div onClick={() => setOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', background: `${color}11`, cursor: 'pointer', borderBottom: open ? `1px solid ${color}22` : 'none' }}>
        <Icon size={18} color={color} />
        <span style={{ fontWeight: 600, color, flex: 1 }}>{title}</span>
        {open ? <ChevronUp size={16} color={color} /> : <ChevronDown size={16} color={color} />}
      </div>
      {open && <div style={{ padding: 18 }}>{children}</div>}
    </div>
  );
}

function ScoreGauge({ score }) {
  const color = score >= 65 ? 'var(--red)' : score >= 35 ? 'var(--orange)' : 'var(--green)';
  return (
    <div style={{ textAlign: 'center', padding: 20 }}>
      <div style={{ fontSize: 64, fontWeight: 900, color, lineHeight: 1 }}>{score}</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>Risk Score / 100</div>
      <div style={{ marginTop: 12, height: 8, background: 'rgba(255,255,255,0.05)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: `${score}%`, height: '100%', background: color, borderRadius: 4, transition: 'width 1s ease' }} />
      </div>
    </div>
  );
}

export default function FraudIntelligencePage() {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [customJson, setCustomJson] = useState('');
  const [showCustom, setShowCustom] = useState(false);

  const runAnalysis = async (payload) => {
    setLoading(true);
    setResult(null);
    try {
      const res = await axios.post('http://127.0.0.1:8000/api/v1/fraud/intelligence', payload);
      setResult(res.data);
    } catch (err) {
      alert('Backend error: ' + (err.response?.data?.detail || err.message));
    } finally {
      setLoading(false);
    }
  };

  const handleCustomSubmit = () => {
    try {
      const parsed = JSON.parse(customJson);
      runAnalysis(parsed);
    } catch {
      alert('Invalid JSON format. Please check your input.');
    }
  };

  const internal = result?.internal_fraud_summary;
  const seller = result?.seller_view;
  const judge = result?.judge_evidence_view;

  return (
    <div className="animate-fade">
      <div className="page-header">
        <h2>Fraud Intelligence Engine</h2>
        <p>Multi-audience fraud analysis — Internal, Seller, and Legal views generated simultaneously by Gemini 2.5</p>
      </div>

      {/* Demo Presets */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 24, flexWrap: 'wrap' }}>
        {DEMO_PRESETS.map(p => (
          <button key={p.key} className="btn btn-secondary" onClick={() => runAnalysis(p.data)} disabled={loading}>
            {p.label}
          </button>
        ))}
        <button className="btn btn-secondary" onClick={() => setShowCustom(v => !v)}>
          {showCustom ? '✕ Hide' : '{ } Custom JSON'}
        </button>
      </div>

      {showCustom && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-title mb-16">Custom Payload (JSON)</div>
          <textarea
            value={customJson}
            onChange={e => setCustomJson(e.target.value)}
            placeholder='{"account_data": {...}, "return_claims": [...], ...}'
            style={{ width: '100%', minHeight: 180, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#fff', padding: 12, fontFamily: 'monospace', fontSize: 12 }}
          />
          <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={handleCustomSubmit} disabled={!customJson || loading}>
            Run Analysis
          </button>
        </div>
      )}

      {loading && (
        <div style={{ textAlign: 'center', padding: 60 }}>
          <Loader size={40} color="var(--accent)" style={{ animation: 'spin 1s linear infinite', margin: '0 auto 16px' }} />
          <p style={{ color: 'var(--text-muted)' }}>Gemini 2.5 is analyzing multi-signal behavioral data...</p>
        </div>
      )}

      {result && (
        <div className="animate-scale">
          <div className="grid-12" style={{ gap: 20 }}>
            {/* LEFT COLUMN */}
            <div>
              {/* INTERNAL VIEW */}
              <Section title="🔒 Internal Fraud Summary" icon={Shield} color="var(--red)" defaultOpen={true}>
                {internal && (
                  <>
                    <ScoreGauge score={internal.risk_score} />
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
                      {internal.fraud_types.map(t => (
                        <span key={t} style={{ padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: t === 'NORMAL' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)', color: t === 'NORMAL' ? 'var(--green)' : 'var(--red)', border: `1px solid ${t === 'NORMAL' ? 'var(--green)' : 'var(--red)'}` }}>{t}</span>
                      ))}
                    </div>
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>Key Signals</div>
                      {internal.key_internal_signals.map((s, i) => (
                        <div key={i} style={{ fontSize: 13, padding: '8px 10px', marginBottom: 6, background: 'rgba(255,255,255,0.03)', borderLeft: '2px solid var(--accent)', borderRadius: '0 6px 6px 0' }}>
                          {s}
                        </div>
                      ))}
                    </div>
                    {internal.cluster_detected && (
                      <div style={{ padding: 10, background: 'rgba(239,68,68,0.08)', borderRadius: 8, border: '1px solid rgba(239,68,68,0.2)' }}>
                        <span style={{ fontSize: 12, color: 'var(--red)' }}>⚠ Cluster detected · Risk Score: {internal.cluster_risk_score}/100</span>
                      </div>
                    )}
                  </>
                )}
              </Section>

              {/* JUDGE VIEW */}
              <Section title="⚖ Legal / Judge Evidence View" icon={Scale} color="var(--accent)" defaultOpen={true}>
                {judge && (
                  <>
                    <div style={{ fontSize: 14, lineHeight: 1.8, marginBottom: 16, color: 'var(--text-secondary)' }}>{judge.case_summary}</div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>Timeline</div>
                    <div style={{ marginBottom: 16 }}>
                      {judge.timeline.map((t, i) => (
                        <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
                          <div style={{ width: 24, height: 24, borderRadius: 12, background: 'rgba(59,130,246,0.15)', border: '1px solid var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, flexShrink: 0 }}>{i + 1}</div>
                          <div style={{ fontSize: 13, paddingTop: 4, lineHeight: 1.5 }}>{t}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>Evidence Points</div>
                    {judge.evidence_points.map((ep, i) => (
                      <div key={i} style={{ fontSize: 13, padding: '8px 10px', marginBottom: 6, background: 'rgba(255,255,255,0.03)', borderLeft: '2px solid var(--accent)', borderRadius: '0 6px 6px 0' }}>• {ep}</div>
                    ))}
                    <div style={{ marginTop: 16, padding: 12, background: 'rgba(59,130,246,0.08)', borderRadius: 8, fontSize: 13, fontStyle: 'italic', color: 'var(--text-secondary)', border: '1px solid rgba(59,130,246,0.2)' }}>
                      <strong>Conclusion:</strong> {judge.conclusion}
                    </div>
                  </>
                )}
              </Section>
            </div>

            {/* RIGHT COLUMN — SELLER VIEW */}
            <div>
              <Section title="🏪 Seller Business View" icon={Eye} color="var(--green)" defaultOpen={true}>
                {seller && (
                  <>
                    <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
                      <div style={{ flex: 1, textAlign: 'center', padding: 16, background: `${RISK_COLORS[seller.order_risk_level]}11`, border: `1px solid ${RISK_COLORS[seller.order_risk_level]}33`, borderRadius: 10 }}>
                        <div style={{ fontSize: 22, fontWeight: 800, color: RISK_COLORS[seller.order_risk_level] }}>{seller.order_risk_level}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Risk Level</div>
                      </div>
                      <div style={{ flex: 1, textAlign: 'center', padding: 16, background: `${DECISION_COLORS[seller.decision]}11`, border: `1px solid ${DECISION_COLORS[seller.decision]}33`, borderRadius: 10 }}>
                        <div style={{ fontSize: 22, fontWeight: 800, color: DECISION_COLORS[seller.decision] }}>{seller.decision}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Recommended Action</div>
                      </div>
                    </div>

                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>Reason Codes</div>
                    {seller.reason_codes.map((rc, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        <AlertTriangle size={14} color="var(--orange)" style={{ flexShrink: 0 }} />
                        <span style={{ fontSize: 13 }}>{rc}</span>
                      </div>
                    ))}

                    <div style={{ marginTop: 20, padding: 16, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8 }}>MESSAGE TO SELLER</div>
                      <p style={{ fontSize: 14, lineHeight: 1.7, margin: 0 }}>{seller.message_to_seller}</p>
                    </div>

                    <div style={{ marginTop: 16, padding: 12, background: 'rgba(34,197,94,0.05)', borderRadius: 8, fontSize: 12, color: 'var(--text-muted)', border: '1px solid rgba(34,197,94,0.1)' }}>
                      🔒 Raw device identifiers, IP addresses, and graph topology are hidden from this view.
                    </div>
                  </>
                )}
              </Section>

              {/* REFRESH BUTTON */}
              <button className="btn btn-secondary" style={{ width: '100%' }} onClick={() => setResult(null)}>
                <RefreshCw size={16} /> Run New Analysis
              </button>
            </div>
          </div>
        </div>
      )}

      {!result && !loading && (
        <div className="card" style={{ textAlign: 'center', padding: 60 }}>
          <Shield size={48} style={{ color: 'var(--text-muted)', margin: '0 auto 16px' }} />
          <h3 style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>Select a scenario above to run analysis</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 8 }}>Gemini 2.5 generates Internal, Seller, and Legal views simultaneously.</p>
        </div>
      )}
    </div>
  );
}
