import { useState } from 'react';
import { submitReturn } from '../api';
import { Send, AlertTriangle, CheckCircle, ShieldAlert } from 'lucide-react';

const DEMO_PRESETS = [
  { label: '✅ Legitimate Return', account_id: 'cust_alice_2026', fingerprint_hash: 'fp_alice_clean', ip_address: '203.0.113.10', reason: 'Item too small', description: 'Ordered wrong size, need to exchange.', dwell_avg: 120, flight_avg: 85, mouse_velocity: 340, scroll_rhythm: 45 },
  { label: '🟡 VPN User (innocent)', account_id: 'cust_bob_vpn', fingerprint_hash: 'fp_bob_unique', ip_address: '10.8.0.1', reason: 'Changed mind', description: 'No longer need the product.', dwell_avg: 95, flight_avg: 110, mouse_velocity: 280, scroll_rhythm: 60 },
  { label: '🟠 Suspicious Behavior', account_id: 'cust_charlie_sus', fingerprint_hash: 'fp_charlie_shared', ip_address: '192.168.1.50', reason: 'Damaged', description: 'Product arrived broken.', dwell_avg: 30, flight_avg: 200, mouse_velocity: 800, scroll_rhythm: 12 },
  { label: '🔴 Fraud Ring Member', account_id: 'acct_ring_001', fingerprint_hash: 'fp_RING_DEVICE_X9K2', ip_address: '192.168.1.100', reason: 'Not received', description: 'Package never arrived.', dwell_avg: 15, flight_avg: 300, mouse_velocity: 1200, scroll_rhythm: 5 },
];

const TIER_ICONS = { green: CheckCircle, amber: AlertTriangle, orange: ShieldAlert, red: ShieldAlert };
const TIER_COLORS = { green: 'var(--green)', amber: 'var(--amber)', orange: 'var(--orange)', red: 'var(--red)' };

export default function ReturnForm() {
  const [form, setForm] = useState({ order_id: 'ORD-10000', account_id: '', reason: '', description: '', fingerprint_hash: '', ip_address: '', dwell_avg: 0, flight_avg: 0, mouse_velocity: 0, scroll_rhythm: 0 });
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const applyPreset = (p) => setForm(f => ({ ...f, ...p }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true); setError(''); setResult(null);
    try {
      const res = await submitReturn(form);
      setResult(res.data);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to submit. Is the backend running?');
    } finally { setLoading(false); }
  };

  const TierIcon = result ? TIER_ICONS[result.risk_tier] : null;

  return (
    <div className="animate-fade">
      <div className="page-header">
        <h2>Submit Return Request</h2>
        <p>Test the 5-layer fraud detection pipeline with demo presets or custom data</p>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
        {DEMO_PRESETS.map((p, i) => (
          <button key={i} className="btn btn-secondary" onClick={() => applyPreset(p)} style={{ fontSize: 13 }}>{p.label}</button>
        ))}
      </div>

      <div className="grid-12">
        <div>
          <form onSubmit={handleSubmit}>
            <div className="card">
              <div className="card-title mb-16">Return Details</div>
              <div className="form-group">
                <label className="form-label">Order ID</label>
                <select className="form-select" value={form.order_id} onChange={e => setForm({ ...form, order_id: e.target.value })}>
                  {Array.from({ length: 8 }, (_, i) => `ORD-${10000 + i}`).map(id => <option key={id} value={id}>{id}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Account ID</label>
                <input className="form-input" value={form.account_id} onChange={e => setForm({ ...form, account_id: e.target.value })} required placeholder="e.g. cust_alice_2026" />
              </div>
              <div className="form-group">
                <label className="form-label">Reason</label>
                <select className="form-select" value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} required>
                  <option value="">Select reason…</option>
                  <option value="Damaged">Damaged / Defective</option>
                  <option value="Not received">Item Not Received</option>
                  <option value="Wrong item">Wrong Item Sent</option>
                  <option value="Changed mind">Changed Mind</option>
                  <option value="Item too small">Size Issue</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Description</label>
                <textarea className="form-textarea" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Describe the issue…" />
              </div>
            </div>

            <div className="card" style={{ marginTop: 16 }}>
              <div className="card-title mb-16">Device & Behavioral Signals <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>(Layer 1)</span></div>
              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">Fingerprint Hash</label>
                  <input className="form-input mono" value={form.fingerprint_hash} onChange={e => setForm({ ...form, fingerprint_hash: e.target.value })} placeholder="fp_…" />
                </div>
                <div className="form-group">
                  <label className="form-label">IP Address</label>
                  <input className="form-input mono" value={form.ip_address} onChange={e => setForm({ ...form, ip_address: e.target.value })} placeholder="0.0.0.0" />
                </div>
              </div>
              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">Key Dwell (ms)</label>
                  <input className="form-input" type="number" value={form.dwell_avg} onChange={e => setForm({ ...form, dwell_avg: +e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">Flight Time (ms)</label>
                  <input className="form-input" type="number" value={form.flight_avg} onChange={e => setForm({ ...form, flight_avg: +e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">Mouse Velocity</label>
                  <input className="form-input" type="number" value={form.mouse_velocity} onChange={e => setForm({ ...form, mouse_velocity: +e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">Scroll Rhythm</label>
                  <input className="form-input" type="number" value={form.scroll_rhythm} onChange={e => setForm({ ...form, scroll_rhythm: +e.target.value })} />
                </div>
              </div>
            </div>

            {error && <div style={{ color: 'var(--red)', marginTop: 12, fontSize: 13 }}>{error}</div>}
            <button className="btn btn-primary" type="submit" disabled={loading} style={{ marginTop: 16, width: '100%' }}>
              <Send size={16} />{loading ? 'Scoring…' : 'Submit Return & Score'}
            </button>
          </form>
        </div>

        <div>
          {result ? (
            <div className="animate-scale">
              <div className="card" style={{ borderColor: TIER_COLORS[result.risk_tier], borderWidth: 2 }}>
                <div style={{ textAlign: 'center', marginBottom: 20 }}>
                  {TierIcon && <TierIcon size={48} style={{ color: TIER_COLORS[result.risk_tier] || '#999', marginBottom: 8 }} />}
                  <h3 style={{ color: TIER_COLORS[result.risk_tier] || '#999', fontSize: 28, fontWeight: 800 }}>{(result.risk_tier || "").toUpperCase()}</h3>
                  <div className="mono" style={{ fontSize: 13, color: 'var(--text-muted)' }}>{result.request_id || "PENDING"}</div>
                </div>

                <div style={{ textAlign: 'center', margin: '24px 0' }}>
                  <div style={{ fontSize: 56, fontWeight: 900, color: TIER_COLORS[result.risk_tier], letterSpacing: -2 }}>{result.combined_score}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>COMBINED SCORE</div>
                </div>

                <div style={{ background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)', padding: 16, marginBottom: 16 }}>
                  <p style={{ fontSize: 14, lineHeight: 1.6 }}>{result.customer_message}</p>
                </div>

                <div className="card-title mb-16">Scorer Breakdown</div>
                {Object.entries(result.scorers || {}).map(([name, data]) => {
                  const s = data.score;
                  const color = s > 60 ? 'var(--red)' : s > 30 ? 'var(--orange)' : 'var(--green)';
                  return (
                    <div key={name}>
                      <div className="scorer-bar">
                        <span className="scorer-name" style={{ textTransform: 'capitalize' }}>{name}</span>
                        <div className="scorer-track">
                          <div className="scorer-fill" style={{ width: `${s}%`, background: color }} />
                        </div>
                        <span className="scorer-value" style={{ color }}>{s}</span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '0 0 8px 112px' }}>{data.reason}</div>
                      
                      {data.details && data.details.fraud_indicators && data.details.fraud_indicators.length > 0 && (
                        <div style={{ paddingLeft: 112, marginTop: 8, marginBottom: 12 }}>
                          {data.details.fraud_indicators.map((ind, idx) => (
                            <div key={idx} style={{ 
                              background: 'rgba(255,255,255,0.03)', 
                              border: '1px solid rgba(255,255,255,0.05)', 
                              padding: '8px 10px', 
                              borderRadius: 4, 
                              marginBottom: 6,
                              borderLeft: `2px solid ${ind.severity === 'high' ? 'var(--red)' : ind.severity === 'medium' ? 'var(--orange)' : 'var(--green)'}` 
                            }}>
                              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent)', marginBottom: 2 }}>
                                {ind.signal}
                                {ind.observed_value && <span style={{ color: '#fff', marginLeft: 8 }}>({ind.observed_value})</span>}
                              </div>
                              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{ind.reason}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}

                <div className="evidence-item" style={{ marginTop: 16, borderLeftColor: result.scorers_above_40 >= 2 ? 'var(--red)' : 'var(--green)' }}>
                  <div className="evidence-label">Corroboration Rule</div>
                  {result.scorers_above_40 >= 2
                    ? `⚠ ${result.scorers_above_40}/3 scorers above 40 — escalation permitted`
                    : `✓ Only ${result.scorers_above_40}/3 scorers above 40 — capped at amber`}
                </div>
              </div>
            </div>
          ) : (
            <div className="card" style={{ textAlign: 'center', padding: 60 }}>
              <ShieldAlert size={48} style={{ color: 'var(--text-muted)', marginBottom: 16 }} />
              <h3 style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>No Scoring Result Yet</h3>
              <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 8 }}>Select a demo preset or fill the form and submit to see the 5-layer pipeline in action.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
