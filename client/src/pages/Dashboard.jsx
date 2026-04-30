import { useState, useEffect } from 'react';
import { getAnalytics, getReturnHistory, getFingerprints, getWardrobingFlags, getINRClaims, getChargebacks } from '../api';
import { ShieldCheck, ShieldAlert, Eye, Ban, Activity, Users, Fingerprint, TrendingUp, PackageX, CreditCard } from 'lucide-react';

const TIER_COLORS = { green: 'var(--green)', amber: 'var(--amber)', orange: 'var(--orange)', red: 'var(--red)' };

function ScoreRing({ score, tier, size = 100 }) {
  const r = (size - 12) / 2, c = 2 * Math.PI * r;
  const pct = Math.min(score, 100) / 100;
  const color = TIER_COLORS[tier] || 'var(--accent)';
  return (
    <div className="score-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--bg-secondary)" strokeWidth="6" />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth="6"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct)} strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 1s ease-out' }} />
      </svg>
      <span className="score-value" style={{ color, fontSize: size * 0.28 }}>{score}</span>
    </div>
  );
}

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState('overview');
  const [stats, setStats] = useState(null);
  const [returns, setReturns] = useState([]);
  const [clusters, setClusters] = useState([]);
  const [wardrobing, setWardrobing] = useState([]);
  const [inr, setInr] = useState([]);
  const [chargebacks, setChargebacks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      getAnalytics(), getReturnHistory(), getFingerprints(),
      getWardrobingFlags(), getINRClaims(), getChargebacks()
    ])
      .then(([a, r, f, w, i, c]) => {
        setStats(a.data);
        setReturns(r.data.returns || []);
        setClusters(f.data.clusters || []);
        setWardrobing(w.data.wardrobing || []);
        setInr(i.data.inr_claims || []);
        setChargebacks(c.data.chargebacks || []);
      })
      .catch(() => {
        setStats({ total_returns: 0, tier_distribution: { green: 0, amber: 0, orange: 0, red: 0 }, pending_reviews: 0, fraud_ring_accounts: 0, blocked_this_week: 0, auto_approved: 0 });
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex-center" style={{ height: '60vh' }}><div className="loading" style={{ fontSize: 18 }}>Loading dashboard…</div></div>;

  const td = stats?.tier_distribution || {};
  const statCards = [
    { label: 'Total Returns', value: stats?.total_returns || 0, icon: Activity, color: 'var(--accent)' },
    { label: 'Auto-Approved', value: td.green || 0, icon: ShieldCheck, color: 'var(--green)' },
    { label: 'Photo Required', value: td.amber || 0, icon: Eye, color: 'var(--amber)' },
    { label: 'Under Review', value: (td.orange || 0) + (stats?.pending_reviews || 0), icon: ShieldAlert, color: 'var(--orange)' },
    { label: 'Blocked', value: td.red || 0, icon: Ban, color: 'var(--red)' },
    { label: 'Ring Accounts', value: stats?.fraud_ring_accounts || 0, icon: Users, color: '#a855f7' },
    { label: 'Chargebacks', value: stats?.chargebacks || 0, icon: TrendingUp, color: '#f43f5e' },
    { label: 'Wardrobing', value: stats?.wardrobing_flags || 0, icon: Fingerprint, color: '#eab308' },
  ];

  return (
    <div className="animate-fade">
      <div className="page-header">
        <h2>Fraud Detection Dashboard</h2>
        <p>Real-time return fraud monitoring — 6 fraud vectors · context-aware fusion</p>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 24, borderBottom: '1px solid var(--border)', paddingBottom: 12, overflowX: 'auto' }}>
        {['overview', 'rings', 'wardrobing', 'inr', 'chargebacks'].map(t => (
          <button 
            key={t}
            onClick={() => setActiveTab(t)}
            className={`btn ${activeTab === t ? 'btn-primary' : 'btn-secondary'}`}
            style={{ textTransform: 'capitalize', padding: '8px 16px', fontSize: 13 }}
          >
            {t === 'inr' ? 'INR Abuse' : t === 'rings' ? 'Device Rings' : t}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <>
          <div className="stat-grid">
            {statCards.map((s, i) => (
              <div className="stat-card" key={i} style={{ animationDelay: `${i * 60}ms` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div className="stat-value" style={{ color: s.color }}>{s.value}</div>
                    <div className="stat-label">{s.label}</div>
                  </div>
                  <s.icon size={22} style={{ color: s.color, opacity: 0.6 }} />
                </div>
              </div>
            ))}
          </div>

          <div className="grid-2 mb-24">
            <div className="card">
              <div className="card-header">
                <span className="card-title">Tier Distribution</span>
                <span className="card-subtitle">All time</span>
              </div>
              <div style={{ display: 'flex', gap: 24, alignItems: 'center', justifyContent: 'center', padding: '16px 0' }}>
                {['green', 'amber', 'orange', 'red'].map(t => (
                  <div key={t} style={{ textAlign: 'center' }}>
                    <ScoreRing score={td[t] || 0} tier={t} size={80} />
                    <div style={{ marginTop: 8, fontSize: 12, fontWeight: 600, textTransform: 'uppercase', color: TIER_COLORS[t] }}>{t}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <span className="card-title">Recent Returns</span>
                <span className="card-subtitle">{returns.length} processed</span>
              </div>
              {returns.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: 32 }}>No returns submitted yet.</p>
              ) : (
                <table className="data-table">
                  <thead><tr><th>Request ID</th><th>Account</th><th>Score</th><th>Tier</th></tr></thead>
                  <tbody>
                    {returns.slice(0, 5).map((r, i) => (
                      <tr key={i}>
                        <td className="mono" style={{fontSize: 11}}>{r.request_id}</td>
                        <td style={{fontSize: 11}}>{r.account_id}</td>
                        <td><strong>{r.combined_score}</strong></td>
                        <td><span className={`tier-badge tier-${r.risk_tier}`}>{r.risk_tier}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}

      {activeTab === 'rings' && (
        <div className="card animate-fade">
          <div className="card-header">
            <span className="card-title"><Fingerprint size={16} style={{ marginRight: 8, verticalAlign: -2 }} />Device Clusters</span>
            <span className="card-subtitle">{clusters.length} flagged</span>
          </div>
          {clusters.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>No suspicious clusters yet.</p>
          ) : (
            clusters.map((c, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
                <div>
                  <span className="mono">{c.fingerprint}</span>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{c.accounts} accounts linked</div>
                </div>
                <span className={`tier-badge tier-${c.risk === 'high' ? 'red' : c.risk === 'medium' ? 'orange' : 'green'}`}>{c.risk}</span>
              </div>
            ))
          )}
        </div>
      )}

      {activeTab === 'wardrobing' && (
        <div className="card animate-fade">
          <div className="card-header">
            <span className="card-title"><Eye size={16} style={{ marginRight: 8, verticalAlign: -2 }} />Wardrobing Flags</span>
            <span className="card-subtitle">Fast returns & high value</span>
          </div>
          {wardrobing.length === 0 ? <p style={{ color: 'var(--text-muted)', padding: '20px 0', textAlign: 'center' }}>No wardrobing indicators found.</p> : (
            <table className="data-table">
              <thead><tr><th>Claim ID</th><th>Category</th><th>Days Held</th><th>Value (INR)</th><th>Score</th></tr></thead>
              <tbody>
                {wardrobing.map((w, i) => (
                  <tr key={i}>
                    <td className="mono">{w.claim_id}</td>
                    <td style={{textTransform: 'capitalize'}}>{w.product_category}</td>
                    <td>{w.days_held} days</td>
                    <td>₹{w.order_value_inr}</td>
                    <td><strong style={{ color: w.wardrobing_score >= 60 ? 'var(--red)' : 'var(--orange)' }}>{w.wardrobing_score}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {activeTab === 'inr' && (
        <div className="card animate-fade">
          <div className="card-header">
            <span className="card-title"><PackageX size={16} style={{ marginRight: 8, verticalAlign: -2 }} />INR Abuse (Item Not Received)</span>
            <span className="card-subtitle">False non-delivery claims</span>
          </div>
          {inr.length === 0 ? <p style={{ color: 'var(--text-muted)', padding: '20px 0', textAlign: 'center' }}>No INR claims found.</p> : (
            <table className="data-table">
              <thead><tr><th>Request ID</th><th>Account ID</th><th>Score</th><th>Tier</th></tr></thead>
              <tbody>
                {inr.map((r, i) => (
                  <tr key={i}>
                    <td className="mono">{r.request_id}</td>
                    <td>{r.account_id}</td>
                    <td><strong>{r.combined_score}</strong></td>
                    <td><span className={`tier-badge tier-${r.risk_tier}`}>{r.risk_tier}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {activeTab === 'chargebacks' && (
        <div className="card animate-fade">
          <div className="card-header">
            <span className="card-title"><CreditCard size={16} style={{ marginRight: 8, verticalAlign: -2 }} />Chargebacks (Friendly Fraud)</span>
            <span className="card-subtitle">Recent payment disputes</span>
          </div>
          {chargebacks.length === 0 ? <p style={{ color: 'var(--text-muted)', padding: '20px 0', textAlign: 'center' }}>No chargebacks filed.</p> : (
            <table className="data-table">
              <thead><tr><th>Customer ID</th><th>Order ID</th><th>Reason</th><th>Amount (INR)</th><th>Status</th></tr></thead>
              <tbody>
                {chargebacks.map((c, i) => (
                  <tr key={i}>
                    <td>{c.customer_id}</td>
                    <td className="mono">{c.order_id}</td>
                    <td style={{textTransform: 'capitalize'}}>{c.chargeback_reason}</td>
                    <td>₹{c.amount_inr}</td>
                    <td><span className={`tier-badge tier-${c.resolution === 'PENDING' ? 'amber' : 'green'}`}>{c.resolution}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

