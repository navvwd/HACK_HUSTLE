import { useState, useEffect } from 'react';
import { getReviewQueue, submitReviewDecision, getReviewStats, submitAdminReview } from '../api';
import { CheckCircle, XCircle, ArrowUpCircle, Clock, Shield } from 'lucide-react';

const TIER_COLORS = { green: 'var(--green)', amber: 'var(--amber)', orange: 'var(--orange)', red: 'var(--red)' };

export default function ReviewQueue() {
  const [queue, setQueue] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [deciding, setDeciding] = useState(null);

  const refresh = () => {
    setLoading(true);
    Promise.all([getReviewQueue(), getReviewStats()])
      .then(([q, s]) => { setQueue(q.data.queue || []); setStats(s.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { refresh(); }, []);

  const handleDecision = async (requestId, outcome) => {
    setDeciding(requestId);
    try {
      const formData = new FormData();
      formData.append('claim_id', requestId);
      formData.append('reviewer_id', 'analyst_demo');
      formData.append('outcome', outcome);
      formData.append('confidence', '3');
      formData.append('notes', '');
      await submitAdminReview(formData);
      refresh();
    } catch (e) { console.error(e); }
    finally { setDeciding(null); }
  };

  return (
    <div className="animate-fade">
      <div className="page-header">
        <h2>Human Review Queue</h2>
        <p>Orange & red tier returns requiring analyst judgment — no algorithm blocks unilaterally</p>
      </div>

      {stats && (
        <div className="stat-grid" style={{ marginBottom: 24 }}>
          {[
            { label: 'Pending', value: stats.pending, color: 'var(--orange)', icon: Clock },
            { label: 'Approved', value: stats.approved, color: 'var(--green)', icon: CheckCircle },
            { label: 'Denied', value: stats.denied, color: 'var(--red)', icon: XCircle },
            { label: 'Escalated', value: stats.escalated, color: '#a855f7', icon: ArrowUpCircle },
          ].map((s, i) => (
            <div className="stat-card" key={i}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <div>
                  <div className="stat-value" style={{ color: s.color }}>{s.value}</div>
                  <div className="stat-label">{s.label}</div>
                </div>
                <s.icon size={20} style={{ color: s.color, opacity: 0.5 }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div className="card flex-center" style={{ padding: 60 }}>
          <div className="loading">Loading queue…</div>
        </div>
      ) : queue.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 60 }}>
          <Shield size={48} style={{ color: 'var(--green)', marginBottom: 16 }} />
          <h3 style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>Queue Empty</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 8 }}>No returns pending review. Submit returns with fraud ring presets to populate this queue.</p>
        </div>
      ) : (
        queue.map((item, i) => (
          <div className="card animate-slide" key={item.request_id} style={{ marginBottom: 16, animationDelay: `${i * 80}ms` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span className="mono" style={{ fontSize: 15, fontWeight: 600 }}>{item.request_id}</span>
                  <span className={`tier-badge tier-${item.risk_tier}`}>{item.risk_tier}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                  Order: {item.order_id} · Account: {item.account_id} · {item.reason}
                </div>
              </div>
              <div style={{ fontSize: 36, fontWeight: 900, color: TIER_COLORS[item.risk_tier] }}>{item.combined_score}</div>
            </div>

            {item.scorers && (
              <div style={{ marginBottom: 16 }}>
                {Object.entries(item.scorers).map(([name, data]) => {
                  const s = data.score;
                  const color = s > 60 ? 'var(--red)' : s > 30 ? 'var(--orange)' : 'var(--green)';
                  return (
                    <div className="scorer-bar" key={name}>
                      <span className="scorer-name" style={{ textTransform: 'capitalize' }}>{name}</span>
                      <div className="scorer-track"><div className="scorer-fill" style={{ width: `${s}%`, background: color }} /></div>
                      <span className="scorer-value" style={{ color }}>{s}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {item.corroboration_met && (
              <div className="evidence-item high" style={{ marginBottom: 16 }}>
                <div className="evidence-label">⚠ Corroboration Rule Met</div>
                Multiple independent scorers agree — escalation warranted
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn btn-success" onClick={() => handleDecision(item.request_id, 'CONFIRMED_LEGIT')} disabled={deciding === item.request_id}>
                <CheckCircle size={14} />✓ Legit
              </button>
              <button className="btn btn-secondary" onClick={() => handleDecision(item.request_id, 'ESCALATED')} disabled={deciding === item.request_id}>
                <ArrowUpCircle size={14} />Escalate
              </button>
              <button className="btn btn-danger" onClick={() => handleDecision(item.request_id, 'CONFIRMED_FRAUD')} disabled={deciding === item.request_id}>
                <XCircle size={14} />✗ Fraud
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
