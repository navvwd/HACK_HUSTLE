import { useState, useEffect } from 'react';
import { analyzeDamage } from '../api';
import { Camera, Upload, Shield, Wifi, RefreshCw, Clock } from 'lucide-react';
import axios from 'axios';

const TIER_COLORS = { green: 'var(--green)', amber: 'var(--amber)', orange: 'var(--orange)', red: 'var(--red)' };
const LAYER_NAMES = { reverse_search: 'Reverse Image Search', exif: 'EXIF Metadata', ela: 'ELA Pixel Analysis', product_match: 'Product Comparison', live_capture: 'Live Capture Verify', route_crossref: 'Route Cross-Reference' };

export default function DamageAnalysis() {
  const [tab, setTab] = useState('upload'); // 'upload' | 'live'
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [orderId, setOrderId] = useState('ORD-10000');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [liveCaptures, setLiveCaptures] = useState([]);
  const [selectedCapture, setSelectedCapture] = useState(null);
  const [captureMethod, setCaptureMethod] = useState('manual_upload');

  const handleFile = (f) => {
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setResult(null);
  };

  // Poll live captures every 5 seconds
  useEffect(() => {
    const fetchCaptures = async () => {
      try {
        const res = await axios.get('http://127.0.0.1:8000/api/damage/live-captures');
        setLiveCaptures(res.data.captures || []);
      } catch (e) { /* backend may not be ready */ }
    };
    fetchCaptures();
    const interval = setInterval(fetchCaptures, 5000);
    return () => clearInterval(interval);
  }, []);

  // Load a live capture for analysis
  const loadLiveCapture = async (capture) => {
    setSelectedCapture(capture);
    setOrderId(capture.order_id);
    setPreview(`http://127.0.0.1:8000/api/damage/live-captures/${capture.order_id}/image`);
    const res = await fetch(`http://127.0.0.1:8000/api/damage/live-captures/${capture.order_id}/image`);
    const blob = await res.blob();
    setFile(new File([blob], `${capture.order_id}_live.jpg`, { type: 'image/jpeg' }));
    setCaptureMethod('live_camera'); // KEY: mark this as a verified live capture
    setResult(null);
    setTab('upload');
  };

  const handleSubmit = async () => {
    if (!file) return;
    setLoading(true); setError(''); setResult(null);
    const fd = new FormData();
    fd.append('image', file);
    fd.append('order_id', orderId);
    fd.append('capture_method', captureMethod);
    fd.append('capture_timestamp', new Date().toISOString());
    try {
      const res = await analyzeDamage(fd);
      setResult(res.data);
    } catch (err) {
      setError(err.response?.data?.detail || 'Analysis failed. Is backend running?');
    } finally { setLoading(false); }
  };

  return (
    <div className="animate-fade">
      <div className="page-header">
        <h2>Falsified Damage Claims Detection</h2>
        <p>6-layer detection stack — EXIF, reverse search, ELA, product match, live capture, route analysis</p>
      </div>

      {/* Tab toggle */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <button className={`btn ${tab === 'upload' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('upload')}>
          <Upload size={16} /> Manual Upload
        </button>
        <button className={`btn ${tab === 'live' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('live')} style={{ position: 'relative' }}>
          <Wifi size={16} /> Live Customer Captures
          {liveCaptures.length > 0 && <span style={{ position: 'absolute', top: -6, right: -6, background: 'var(--red)', color: '#fff', fontSize: 10, borderRadius: 8, padding: '2px 5px' }}>{liveCaptures.length}</span>}
        </button>
      </div>
      {tab === 'live' ? (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>Auto-refreshing every 5s — {liveCaptures.length} capture(s) received</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--green)' }}><Wifi size={14} /> Live</div>
          </div>
          {liveCaptures.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: 60 }}>
              <RefreshCw size={48} style={{ color: 'var(--text-muted)', marginBottom: 16 }} />
              <h3 style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>No Live Captures Yet</h3>
              <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 8 }}>Waiting for customers to submit damage photos via the Live Capture flow.</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
              {liveCaptures.map((cap, i) => (
                <div key={i} className="card" style={{ padding: 0, overflow: 'hidden', cursor: 'pointer', border: selectedCapture?.order_id === cap.order_id ? '2px solid var(--accent)' : '1px solid rgba(255,255,255,0.05)' }} onClick={() => loadLiveCapture(cap)}>
                  <img src={`http://127.0.0.1:8000/api/damage/live-captures/${cap.order_id}/image`} alt="live capture" style={{ width: '100%', height: 180, objectFit: 'cover', display: 'block' }} onError={e => e.target.style.display='none'} />
                  <div style={{ padding: 12 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{cap.order_id}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                      <Clock size={12} /> {new Date(cap.captured_at).toLocaleString('en-IN')}
                    </div>
                    <span style={{ display: 'inline-block', marginTop: 8, fontSize: 10, padding: '2px 8px', borderRadius: 10, background: 'rgba(239,68,68,0.15)', color: 'var(--red)', border: '1px solid var(--red)' }}>Pending Review</span>
                    <button className="btn btn-primary" style={{ width: '100%', marginTop: 10, padding: '8px' }} onClick={() => loadLiveCapture(cap)}>
                      <Camera size={14} /> Analyze This
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="grid-12">
          <div>
            <div className="card mb-16">
              <div className="form-group">
                <label className="form-label">Order ID</label>
                <select className="form-select" value={orderId} onChange={e => setOrderId(e.target.value)}>
                  {Array.from({ length: 8 }, (_, i) => `ORD-${10000 + i}`).map(id => <option key={id} value={id}>{id}</option>)}
                </select>
              </div>
              <div className="upload-zone" onClick={() => document.getElementById('damage-file').click()}
                onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('dragover'); }}
                onDragLeave={e => e.currentTarget.classList.remove('dragover')}
                onDrop={e => { e.preventDefault(); e.currentTarget.classList.remove('dragover'); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); }}>
                {preview ? (
                  <img src={preview} alt="preview" style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 8 }} />
                ) : (
                  <>
                    <Upload size={32} />
                    <p>Drop a damage photo here or click to select</p>
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>JPG, PNG — the system analyzes EXIF, pixels, and content</p>
                  </>
                )}
                <input id="damage-file" type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { if (e.target.files[0]) handleFile(e.target.files[0]); }} />
              </div>
            </div>
            {error && <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</div>}
            <button className="btn btn-primary" onClick={handleSubmit} disabled={!file || loading} style={{ width: '100%' }}>
              <Camera size={16} />{loading ? 'Analyzing 6 layers…' : 'Analyze Damage Photo'}
            </button>
            <div className="card" style={{ marginTop: 16 }}>
              <div className="card-title mb-16">Detection Layers</div>
              {Object.entries(LAYER_NAMES).map(([k, v], i) => (
                <div key={k} className={`pipeline-step ${result ? 'complete' : ''}`}>
                  <div className="step-number">{i + 1}</div>
                  <div><div className="step-title">{v}</div></div>
                </div>
              ))}
            </div>
          </div>
          <div>
            {result ? (
              <div className="animate-scale">
                <div className="card" style={{ borderColor: TIER_COLORS[result.tier], borderWidth: 2 }}>
                  <div style={{ textAlign: 'center', marginBottom: 24 }}>
                    <Shield size={40} style={{ color: TIER_COLORS[result.tier] }} />
                    <div style={{ fontSize: 48, fontWeight: 900, color: TIER_COLORS[result.tier], margin: '8px 0' }}>{result.score}</div>
                    <span className={`tier-badge tier-${result.tier}`}>{result.tier}</span>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>{result.layers_fired}/{result.total_layers} layers fired</div>
                  </div>
                  <div className="card-title mb-16">Layer Evidence</div>
                  {(result.evidence || []).map((e, i) => (
                    <div key={i} className={`evidence-item ${e.score >= 60 ? 'high' : e.score >= 30 ? 'medium' : 'low'}`}>
                      <div className="evidence-label">{LAYER_NAMES[e.layer] || e.layer} — Score: {e.score}</div>
                      <div style={{ fontSize: 13 }}>{e.detail}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="card" style={{ textAlign: 'center', padding: 60 }}>
                <Camera size={48} style={{ color: 'var(--text-muted)', marginBottom: 16 }} />
                <h3 style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>Upload a Photo to Analyze</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 8 }}>The 6-layer stack checks EXIF dates, GPS, pixel manipulation, reverse search, product match, and route patterns.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
