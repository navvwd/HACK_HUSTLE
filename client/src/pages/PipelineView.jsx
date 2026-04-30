import { useState, useEffect, useRef } from 'react';
import { getGraphData } from '../api';
import { GitBranch, Cpu, Wifi, User, AlertTriangle, Shield } from 'lucide-react';

const STAGES = [
  { title: 'Signal Collection', desc: 'Client-side JS silently collects device fingerprint + behavioral biometrics', icon: Wifi, time: '0ms' },
  { title: 'Feature Extraction', desc: 'Fingerprint DB lookup, behavioral delta, feature store write', icon: Cpu, time: '+5ms' },
  { title: 'Three Parallel Scorers', desc: 'Device (0.35) · Behavior (0.30) · Graph (0.35) — concurrent via asyncio', icon: GitBranch, time: '+85ms' },
  { title: 'Fusion Engine', desc: 'Weighted sum + corroboration rule: ≥2 scorers above 40 required to escalate', icon: Cpu, time: '+86ms' },
  { title: 'Decision Tier', desc: 'Green (auto) · Amber (photo) · Orange (human) · Red (block + appeal)', icon: User, time: '+90ms' },
];

/* ─── Seeded fraud ring data ─────────────────────────────── */
const RING_NODES = [
  // Central device hub
  { id: 'd0', type: 'device', label: 'fp_RING_X9K2', x: 50, y: 50, r: 22, desc: 'Shared device fingerprint' },
  // Accounts
  { id: 'a1', type: 'account', label: 'acct_synth_001', x: 20, y: 18, r: 16, desc: 'Synthetic ID · 4 claims' },
  { id: 'a2', type: 'account', label: 'acct_synth_002', x: 78, y: 18, r: 16, desc: 'Stolen identity · 6 claims' },
  { id: 'a3', type: 'account', label: 'acct_synth_003', x: 82, y: 72, r: 16, desc: 'Synthetic ID · 3 claims' },
  { id: 'a4', type: 'account', label: 'acct_synth_004', x: 22, y: 78, r: 16, desc: 'Mule account · 5 claims' },
  { id: 'a5', type: 'account', label: 'acct_synth_005', x: 50, y: 10, r: 14, desc: 'New account · 2 claims' },
  // Rotating IPs
  { id: 'ip1', type: 'ip', label: '10.8.1.45', x: 12, y: 45, r: 10, desc: 'VPN exit node — NL' },
  { id: 'ip2', type: 'ip', label: '10.9.3.21', x: 88, y: 40, r: 10, desc: 'VPN exit node — SG' },
  { id: 'ip3', type: 'ip', label: '10.8.7.99', x: 50, y: 90, r: 10, desc: 'VPN exit node — DE' },
  // Addresses
  { id: 'addr1', type: 'address', label: 'Addr A', x: 8,  y: 25, r: 9, desc: '12 Fake St, Mumbai' },
  { id: 'addr2', type: 'address', label: 'Addr B', x: 92, y: 60, r: 9, desc: '7 Ghost Ave, Delhi' },
  { id: 'addr3', type: 'address', label: 'Addr C', x: 35, y: 95, r: 9, desc: '99 Shell Rd, Pune' },
];

const RING_EDGES = [
  // All accounts share the device
  { s: 'a1', t: 'd0', weight: 3, label: 'shared device' },
  { s: 'a2', t: 'd0', weight: 3 },
  { s: 'a3', t: 'd0', weight: 3 },
  { s: 'a4', t: 'd0', weight: 3 },
  { s: 'a5', t: 'd0', weight: 2 },
  // Rotating IPs
  { s: 'a1', t: 'ip1', weight: 1, label: 'VPN rotation' },
  { s: 'a2', t: 'ip2', weight: 1 },
  { s: 'a3', t: 'ip2', weight: 1 },
  { s: 'a4', t: 'ip3', weight: 1 },
  { s: 'a5', t: 'ip1', weight: 1 },
  // Address rotation
  { s: 'a1', t: 'addr1', weight: 1 },
  { s: 'a2', t: 'addr2', weight: 1 },
  { s: 'a3', t: 'addr2', weight: 1 },
  { s: 'a4', t: 'addr3', weight: 1 },
  // Cross-links that betray coordination
  { s: 'a1', t: 'a3', weight: 2, label: 'same behavior pattern' },
  { s: 'a2', t: 'a4', weight: 2 },
];

const NODE_STYLE = {
  device:  { fill: '#c9922a', stroke: '#e8b84b', glow: 'rgba(201,146,42,0.5)', label: '#1c1710' },
  account: { fill: '#b82020', stroke: '#d94040', glow: 'rgba(184,32,32,0.45)', label: '#fff' },
  ip:      { fill: '#5c4f38', stroke: '#9c8b72', glow: 'rgba(92,79,56,0.3)',   label: '#fff' },
  address: { fill: '#2d7a3a', stroke: '#4aab5a', glow: 'rgba(45,122,58,0.35)', label: '#fff' },
};

function RingGraph({ pulse }) {
  const [hovered, setHovered] = useState(null);
  const [revealed, setRevealed] = useState(0);
  const svgRef = useRef(null);

  // Animate nodes appearing one by one
  useEffect(() => {
    let i = 0;
    const t = setInterval(() => {
      i++;
      setRevealed(i);
      if (i >= RING_NODES.length) clearInterval(t);
    }, 220);
    return () => clearInterval(t);
  }, []);

  const getNode = id => RING_NODES.find(n => n.id === id);
  const nodeIdx = id => RING_NODES.findIndex(n => n.id === id);
  const visible = id => nodeIdx(id) < revealed;

  const toSVG = (pct, dim) => (pct / 100) * dim;
  const W = 560, H = 340;

  return (
    <div style={{ position: 'relative' }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', height: 340, display: 'block', borderRadius: 10, background: '#faf7f2' }}
      >
        <defs>
          {Object.entries(NODE_STYLE).map(([type, s]) => (
            <radialGradient key={type} id={`glow-${type}`} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={s.glow} stopOpacity="0.8" />
              <stop offset="100%" stopColor={s.glow} stopOpacity="0" />
            </radialGradient>
          ))}
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0 L10,5 L0,10 Z" fill="rgba(156,111,26,0.5)" />
          </marker>
        </defs>

        {/* Edges */}
        {RING_EDGES.map((e, i) => {
          const s = getNode(e.s), t = getNode(e.t);
          if (!s || !t || !visible(e.s) || !visible(e.t)) return null;
          const sx = toSVG(s.x, W), sy = toSVG(s.y, H);
          const tx = toSVG(t.x, W), ty = toSVG(t.y, H);
          const isHighlight = e.weight >= 2;
          const isHovered = hovered === e.s || hovered === e.t;
          return (
            <g key={i}>
              <line
                x1={sx} y1={sy} x2={tx} y2={ty}
                stroke={isHighlight ? 'rgba(184,32,32,0.35)' : 'rgba(156,111,26,0.18)'}
                strokeWidth={isHighlight ? (isHovered ? 2.5 : 1.8) : (isHovered ? 1.5 : 0.9)}
                strokeDasharray={isHighlight ? 'none' : '5,4'}
                markerEnd={isHighlight ? 'url(#arrow)' : undefined}
                style={{ transition: 'all 0.3s' }}
              />
              {e.label && isHovered && (
                <text
                  x={(sx + tx) / 2} y={(sy + ty) / 2 - 5}
                  textAnchor="middle" fontSize={8}
                  fill="rgba(156,111,26,0.9)" fontFamily="JetBrains Mono, monospace"
                >
                  {e.label}
                </text>
              )}
            </g>
          );
        })}

        {/* Nodes */}
        {RING_NODES.map((n, i) => {
          if (i >= revealed) return null;
          const nx = toSVG(n.x, W), ny = toSVG(n.y, H);
          const style = NODE_STYLE[n.type] || NODE_STYLE.ip;
          const isH = hovered === n.id;
          const isPulse = pulse && n.type === 'device';
          return (
            <g
              key={n.id}
              style={{ cursor: 'pointer', transition: 'all 0.3s' }}
              onMouseEnter={() => setHovered(n.id)}
              onMouseLeave={() => setHovered(null)}
            >
              {/* Glow halo */}
              {(isH || isPulse) && (
                <circle cx={nx} cy={ny} r={n.r * 2.5} fill={`url(#glow-${n.type})`} opacity={isPulse ? 0.7 : 0.5} />
              )}
              {/* Node circle */}
              <circle
                cx={nx} cy={ny} r={isH ? n.r * 1.25 : n.r}
                fill={style.fill} stroke={style.stroke} strokeWidth={isH ? 2.5 : 1.5}
                style={{ transition: 'all 0.25s', filter: isH ? `drop-shadow(0 0 6px ${style.stroke})` : 'none' }}
              />
              {/* Label */}
              <text
                x={nx} y={ny + 1} textAnchor="middle" dominantBaseline="middle"
                fontSize={n.r > 14 ? 7 : 6} fontWeight="700"
                fill={style.label} fontFamily="JetBrains Mono, monospace"
                style={{ pointerEvents: 'none' }}
              >
                {n.label.length > 12 ? n.label.slice(0, 10) + '…' : n.label}
              </text>
              {/* Tooltip */}
              {isH && (
                <g>
                  <rect
                    x={nx - 58} y={ny + n.r + 5} width={116} height={22} rx={4}
                    fill="#1c1710" opacity={0.9}
                  />
                  <text
                    x={nx} y={ny + n.r + 19} textAnchor="middle"
                    fontSize={8.5} fill="#faf7f2" fontFamily="Inter, sans-serif"
                  >
                    {n.desc}
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {/* Legend bottom-right */}
        {[
          { type: 'device',  label: 'Shared Device' },
          { type: 'account', label: 'Fraud Account' },
          { type: 'ip',      label: 'VPN IP' },
          { type: 'address', label: 'Drop Address' },
        ].map((l, i) => (
          <g key={l.type} transform={`translate(${W - 120}, ${H - 70 + i * 16})`}>
            <circle cx={6} cy={6} r={5} fill={NODE_STYLE[l.type].fill} />
            <text x={15} y={10} fontSize={9} fill="var(--text-muted)" fontFamily="Inter, sans-serif">{l.label}</text>
          </g>
        ))}
      </svg>

      {/* Hover info panel */}
      {hovered && (
        <div style={{
          position: 'absolute', top: 8, left: 8, padding: '8px 14px',
          background: 'rgba(28,23,16,0.92)', borderRadius: 8, fontSize: 11,
          color: '#faf7f2', fontFamily: 'JetBrains Mono, monospace',
          border: '1px solid rgba(201,146,42,0.4)', maxWidth: 200,
        }}>
          <div style={{ color: 'var(--gold-light)', fontWeight: 700, marginBottom: 2 }}>
            {RING_NODES.find(n => n.id === hovered)?.label}
          </div>
          <div style={{ color: 'rgba(250,247,242,0.7)' }}>
            {RING_NODES.find(n => n.id === hovered)?.desc}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Damage Counter ─────────────────────────────────────── */
function DamageCounter() {
  const [val, setVal] = useState(0);
  const target = 847320;
  useEffect(() => {
    const step = target / 120;
    let cur = 0;
    const t = setInterval(() => {
      cur = Math.min(cur + step, target);
      setVal(Math.round(cur));
      if (cur >= target) clearInterval(t);
    }, 16);
    return () => clearInterval(t);
  }, []);
  return (
    <span style={{ fontFamily: 'Playfair Display, serif', fontSize: 32, fontWeight: 800, color: 'var(--red)' }}>
      ₹{val.toLocaleString('en-IN')}
    </span>
  );
}

/* ─── Timeline ───────────────────────────────────────────── */
const TIMELINE = [
  { day: 'Day 1',  event: 'acct_synth_001 submits ₹8,400 claim — defective laptop', risk: 'green',  note: 'Looks legitimate in isolation' },
  { day: 'Day 3',  event: 'acct_synth_002 submits ₹12,600 claim — same device fp', risk: 'amber',   note: 'Device fingerprint match flagged' },
  { day: 'Day 5',  event: 'acct_synth_003 + 004 submit simultaneously — same IP pool', risk: 'red', note: 'Cluster signature detected' },
  { day: 'Day 8',  event: 'Ring expansion: 3 new accounts registered, same fingerprint', risk: 'red', note: 'Network growing — HOLD all linked claims' },
  { day: 'Day 12', event: 'All 5 accounts blocked · ₹8.47L in fraudulent claims stopped', risk: 'green', note: 'Graph analysis caught what individual scores missed' },
];

/* ─── Main Component ─────────────────────────────────────── */
export default function PipelineView() {
  const [activeStage, setActiveStage] = useState(-1);
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    const iv = setInterval(() => setActiveStage(s => (s >= STAGES.length - 1 ? -1 : s + 1)), 1200);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    const iv = setInterval(() => setPulse(p => !p), 1000);
    return () => clearInterval(iv);
  }, []);

  return (
    <div className="animate-fade">
      <div className="page-header">
        <h2>Detection Pipeline</h2>
        <p>5-layer architecture — signal flows top to bottom in ~120ms total latency</p>
      </div>

      {/* ── Fraud Ring Evidence Section ── */}
      <div className="card mb-24" style={{ borderLeft: '4px solid var(--red)', background: '#fffdf9' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <AlertTriangle size={18} style={{ color: 'var(--red)' }} />
          <span style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px', color: 'var(--red)' }}>
            Evidence for Judicial Review — Organised Return Ring
          </span>
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: 20 }}>
          Organised return rings operate across dozens of synthetic or stolen accounts, rotating through
          addresses and devices. Each individual claim appears legitimate — it is only the <strong>network
          signature</strong> that reveals coordinated fraud. The graph below presents that signature.
        </p>

        <div className="grid-2" style={{ gap: 24, alignItems: 'start' }}>
          {/* Graph */}
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: 'var(--text-primary)' }}>
              Network Topology — Shared Device Fingerprint Cluster
            </div>
            <RingGraph pulse={pulse} />
            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.6 }}>
              Hover any node to inspect. Solid red edges = shared device fingerprint (the unchanging identifier
              that survives VPN rotation). Dashed edges = rotating IPs / addresses — individually different,
              collectively convergent.
            </p>
          </div>

          {/* Right panel */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Damage counter */}
            <div className="card" style={{ background: 'var(--red-bg)', border: '1px solid var(--red-border)', padding: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.7px', color: 'var(--red)', marginBottom: 6 }}>
                Total Fraudulent Claims — This Ring
              </div>
              <DamageCounter />
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                across 5 synthetic accounts · 20 claims · 18 days
              </div>
            </div>

            {/* Key finding */}
            <div className="card" style={{ padding: 18 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, color: 'var(--text-primary)' }}>
                Why Individual Scores Failed
              </div>
              {[
                { signal: 'Per-claim risk score', value: '28 / 100', color: 'var(--green)', note: 'Each claim individually approved' },
                { signal: 'Device fingerprint hits', value: '5 accounts', color: 'var(--red)', note: 'Same GPU + audio fingerprint' },
                { signal: 'Graph cluster score', value: '94 / 100', color: 'var(--red)', note: 'Network signature — definitive' },
              ].map((r, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderBottom: i < 2 ? '1px solid var(--border)' : 'none' }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{r.signal}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.note}</div>
                  </div>
                  <span style={{ fontFamily: 'JetBrains Mono', fontWeight: 700, fontSize: 13, color: r.color }}>{r.value}</span>
                </div>
              ))}
            </div>

            {/* VPN problem */}
            <div className="card" style={{ padding: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <Shield size={15} style={{ color: 'var(--gold)' }} />
                <span style={{ fontSize: 13, fontWeight: 700 }}>The VPN Evasion Technique — Solved</span>
              </div>
              {[
                { icon: '🔄', signal: 'IP Address', result: 'Different every submission — VPN rotation' },
                { icon: '🔒', signal: 'Device Fingerprint', result: 'Identical across all 5 accounts — GPU, fonts, audio' },
                { icon: '⌨️', signal: 'Typing Cadence', result: 'Same 140ms inter-key rhythm across sessions' },
              ].map((r, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, padding: '7px 0', borderBottom: i < 2 ? '1px solid var(--border)' : 'none' }}>
                  <span style={{ fontSize: 16 }}>{r.icon}</span>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{r.signal}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.result}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Timeline */}
        <div style={{ marginTop: 24, borderTop: '1px solid var(--border)', paddingTop: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 14, color: 'var(--text-primary)' }}>
            Chronological Evidence Timeline
          </div>
          <div style={{ position: 'relative', paddingLeft: 24 }}>
            <div style={{ position: 'absolute', left: 9, top: 4, bottom: 4, width: 2, background: 'linear-gradient(180deg, var(--red), var(--gold), var(--green))', borderRadius: 2 }} />
            {TIMELINE.map((t, i) => (
              <div key={i} style={{ display: 'flex', gap: 14, marginBottom: 14, position: 'relative' }}>
                <div style={{
                  position: 'absolute', left: -24, top: 3,
                  width: 12, height: 12, borderRadius: '50%',
                  background: t.risk === 'red' ? 'var(--red)' : t.risk === 'amber' ? 'var(--amber)' : 'var(--green)',
                  border: '2px solid var(--bg-card)',
                  boxShadow: `0 0 6px ${t.risk === 'red' ? 'var(--red)' : t.risk === 'amber' ? 'var(--amber)' : 'var(--green)'}`,
                }} />
                <div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 2 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, fontFamily: 'JetBrains Mono', color: 'var(--gold)' }}>{t.day}</span>
                    <span className={`tier-badge tier-${t.risk}`} style={{ fontSize: 9, padding: '2px 7px' }}>{t.risk.toUpperCase()}</span>
                  </div>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)' }}>{t.event}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{t.note}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Pipeline + Tiers (original content) ── */}
      <div className="grid-2">
        <div>
          <div className="card">
            <div className="card-title mb-16">Request Lifecycle</div>
            {STAGES.map((s, i) => (
              <div key={i} className={`pipeline-step ${i <= activeStage ? 'complete' : ''} ${i === activeStage ? 'active' : ''}`}>
                <div className="step-number">{i <= activeStage ? '✓' : i + 1}</div>
                <div style={{ flex: 1 }}>
                  <div className="step-title">{s.title}</div>
                  <div className="step-desc">{s.desc}</div>
                </div>
                <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.time}</div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="card">
            <div className="card-title mb-16">Decision Tiers</div>
            {[
              { tier: 'green',  pct: '~70%', label: 'Auto-approve',      desc: 'Score 0–30. Instant refund. System invisible.' },
              { tier: 'amber',  pct: '~20%', label: 'Photo required',     desc: 'Score 31–60 OR only 1 scorer > 40.' },
              { tier: 'orange', pct: '~8%',  label: 'Human review',       desc: 'Score 61–80 AND ≥2 scorers > 40. 24h response.' },
              { tier: 'red',    pct: '~2%',  label: 'Additional review',  desc: 'Score 81–100 AND all 3 scorers > 60.' },
            ].map((t, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: i < 3 ? '1px solid var(--border)' : 'none' }}>
                <span className={`tier-badge tier-${t.tier}`} style={{ minWidth: 70, justifyContent: 'center' }}>{t.tier}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{t.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t.desc}</div>
                </div>
                <span className="mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t.pct}</span>
              </div>
            ))}
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-title mb-16">Corroboration Rule</div>
            <div className="evidence-item medium">
              <div className="evidence-label">Hard Constraint</div>
              A score cannot escalate above amber unless <strong>at least 2 of 3</strong> individual scores exceed 40.
            </div>
            <div style={{ marginTop: 12, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              This structurally bounds false positives by requiring independent corroboration. The estimated cost
              of blocking one legitimate customer exceeds the average fraudulent return value.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
