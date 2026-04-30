import { useState, useEffect } from 'react';
import { submitReturn, getDemoScenarios } from '../api';
import { Zap, Play, CheckCircle, XCircle, AlertTriangle, Shield } from 'lucide-react';

const TIER_COLORS = { green: 'var(--green)', amber: 'var(--amber)', orange: 'var(--orange)', red: 'var(--red)' };
const TIER_ICONS = { green: CheckCircle, amber: AlertTriangle, orange: AlertTriangle, red: XCircle };

export default function DemoPanel() {
  const [scenarios, setScenarios] = useState([]);
  const [results, setResults] = useState({});
  const [running, setRunning] = useState(null);

  useEffect(() => {
    getDemoScenarios().then(r => setScenarios(r.data.scenarios || [])).catch(() => {
      setScenarios([
        { key: 'maya_legit', label: 'Maya — Legitimate Return', orderId: 'ORD-10000', accountId: 'cust_maya_demo', reason: 'defective', description: 'Earbuds stopped charging.', expected: 'GREEN', color: 'green' },
        { key: 'ring_attack', label: 'Ring — Organised Fraud', orderId: 'ORD-10001', accountId: 'acct_ring_001', reason: 'damaged', description: 'Not working.', expected: 'RED', color: 'red', fingerprint: 'fp_RING_DEVICE_X9K2' },
        { key: 'wardrobing', label: 'Wardrobing — Dress Next Day', orderId: 'ord_wardrobing_001', accountId: 'cust_wardrobing', reason: 'damaged', description: 'Doesn\'t fit.', expected: 'AMBER', color: 'amber' },
        { key: 'friendly_fraud', label: 'Friendly Fraud — 3 Chargebacks', orderId: 'ord_friendly_001', accountId: 'cust_ff_001', reason: 'not_received', description: 'Never received.', expected: 'RED', color: 'red' },
      ]);
    });
  }, []);

  const runScenario = async (s) => {
    setRunning(s.key);
    try {
      const res = await submitReturn({
        order_id: s.orderId, account_id: s.accountId, reason: s.reason,
        description: s.description, fingerprint_hash: s.fingerprint || `fp_${s.accountId}`,
        ip_address: '192.168.1.' + Math.floor(Math.random() * 255),
      });
      setResults(prev => ({ ...prev, [s.key]: res.data }));
    } catch (e) {
      setResults(prev => ({ ...prev, [s.key]: { error: e.message } }));
    }
    setRunning(null);
  };

  const runAll = async () => {
    for (const s of scenarios) {
      await runScenario(s);
      await new Promise(r => setTimeout(r, 500));
    }
  };

  return (
    <div className="animate-fade">
      <div className="page-header">
        <h2>Demo Scenarios</h2>
        <p>One-click fraud detection demos covering all 6 vectors</p>
      </div>

      <button className="btn btn-primary mb-24" onClick={runAll} disabled={running !== null}>
        <Zap size={16} />Run All Scenarios
      </button>

      <div style={{ display: 'grid', gap: 16 }}>
        {scenarios.map(s => {
          const result = results[s.key];
          const tier = result?.risk_tier;
          const TierIcon = tier ? (TIER_ICONS[tier] || Shield) : Shield;
          return (
            <div key={s.key} className="card" style={{ borderLeft: `4px solid ${TIER_COLORS[s.color] || 'var(--border)'}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>{s.label}</div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>{s.description}</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>Order: {s.orderId}</span>
                    <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>Expected: {s.expected}</span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {result && !result.error && (
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 28, fontWeight: 900, color: TIER_COLORS[tier] || '#fff' }}>{result.combined_score}</div>
                      <span className={`tier-badge tier-${tier}`}>{tier?.toUpperCase()}</span>
                    </div>
                  )}
                  {result?.error && <span style={{ color: 'var(--red)', fontSize: 12 }}>Error</span>}
                  <button className="btn btn-secondary" onClick={() => runScenario(s)} disabled={running === s.key} style={{ minWidth: 80 }}>
                    <Play size={14} />{running === s.key ? '...' : 'Run'}
                  </button>
                </div>
              </div>

              {result && result.scorers && (
                <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
                  {Object.entries(result.scorers).map(([name, data]) => (
                    <div key={name} style={{ padding: 8, background: 'var(--bg-secondary)', borderRadius: 6, fontSize: 12 }}>
                      <div style={{ fontWeight: 600, marginBottom: 2, textTransform: 'capitalize' }}>{name.replace('_', ' ')}</div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: 'var(--text-muted)' }}>{data.reason?.substring(0, 35)}</span>
                        <span style={{ fontWeight: 700, fontFamily: 'JetBrains Mono', color: data.score >= 60 ? 'var(--red)' : data.score >= 30 ? 'var(--amber)' : 'var(--green)' }}>{data.score}</span>
                      </div>
                    </div>
                  ))}
                  {result.fraud_context && (
                    <div style={{ padding: 8, background: 'var(--gold-bg)', borderRadius: 6, fontSize: 12, border: '1px solid var(--gold-border)' }}>
                      <div style={{ fontWeight: 600, marginBottom: 2, color: 'var(--gold)' }}>Fraud Context</div>
                      <span style={{ fontFamily: 'JetBrains Mono' }}>{result.fraud_context}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
