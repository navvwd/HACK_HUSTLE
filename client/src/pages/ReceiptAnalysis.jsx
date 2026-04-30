import { useState } from 'react';
import { analyzeReceipt } from '../api';
import { FileText, Upload, Shield } from 'lucide-react';

const TIER_COLORS = { green: 'var(--green)', amber: 'var(--amber)', orange: 'var(--orange)', red: 'var(--red)' };
const METHOD_NAMES = { db_crossref: 'DB Cross-Reference', hash_compare: 'Hash Verification', metadata: 'PDF Metadata Analysis', ela: 'ELA Pixel Analysis', qr_verify: 'QR Code Verification' };

export default function ReceiptAnalysis() {
  const [file, setFile] = useState(null);
  const [orderId, setOrderId] = useState('ORD-10000');
  const [amount, setAmount] = useState('');
  const [itemName, setItemName] = useState('');
  const [receiptDate, setReceiptDate] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const applyPreset = (type) => {
    if (type === 'clean') {
      setOrderId('ORD-10000'); setAmount('74999'); setItemName('Samsung Galaxy S23'); setReceiptDate('');
    } else {
      setOrderId('ORD-10000'); setAmount('24999'); setItemName('iPhone 15'); setReceiptDate('2025-01-01');
    }
  };

  const handleSubmit = async () => {
    if (!file) return;
    setLoading(true); setError(''); setResult(null);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('order_id', orderId);
    fd.append('amount', amount || '0');
    fd.append('item_name', itemName);
    if (receiptDate) fd.append('receipt_date', receiptDate);
    try {
      const res = await analyzeReceipt(fd);
      setResult(res.data);
    } catch (err) {
      setError(err.response?.data?.detail || 'Analysis failed.');
    } finally { setLoading(false); }
  };

  return (
    <div className="animate-fade">
      <div className="page-header">
        <h2>Receipt Manipulation Detection</h2>
        <p>5-method detection — DB cross-reference, hash verification, metadata, ELA, QR code</p>
      </div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
        <button className="btn btn-secondary" onClick={() => applyPreset('clean')}>✅ Matching Receipt</button>
        <button className="btn btn-secondary" onClick={() => applyPreset('tampered')}>🔴 Tampered Receipt</button>
      </div>
      <div className="grid-12">
        <div>
          <div className="card mb-16">
            <div className="card-title mb-16">Receipt Details</div>
            <div className="form-group">
              <label className="form-label">Order ID</label>
              <select className="form-select" value={orderId} onChange={e => setOrderId(e.target.value)}>
                {Array.from({ length: 8 }, (_, i) => `ORD-${10000 + i}`).map(id => <option key={id} value={id}>{id}</option>)}
              </select>
            </div>
            <div className="grid-2">
              <div className="form-group">
                <label className="form-label">Submitted Amount (₹)</label>
                <input className="form-input" type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="e.g. 74999" />
              </div>
              <div className="form-group">
                <label className="form-label">Receipt Date</label>
                <input className="form-input" type="date" value={receiptDate} onChange={e => setReceiptDate(e.target.value)} />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Item Name on Receipt</label>
              <input className="form-input" value={itemName} onChange={e => setItemName(e.target.value)} placeholder="e.g. Samsung Galaxy S23" />
            </div>
            <div className="upload-zone" onClick={() => document.getElementById('receipt-file').click()}>
              {file ? (
                <div><FileText size={24} style={{ color: 'var(--accent)' }} /><p style={{ marginTop: 8 }}>{file.name}</p></div>
              ) : (
                <><Upload size={32} /><p>Upload receipt PDF or image</p></>
              )}
              <input id="receipt-file" type="file" accept=".pdf,image/*" style={{ display: 'none' }} onChange={e => { if (e.target.files[0]) { setFile(e.target.files[0]); setResult(null); } }} />
            </div>
          </div>
          {error && <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</div>}
          <button className="btn btn-primary" onClick={handleSubmit} disabled={!file || loading} style={{ width: '100%' }}>
            <Shield size={16} />{loading ? 'Analyzing…' : 'Verify Receipt'}
          </button>
        </div>
        <div>
          {result ? (
            <div className="animate-scale">
              <div className="card" style={{ borderColor: TIER_COLORS[result.tier], borderWidth: 2 }}>
                <div style={{ textAlign: 'center', marginBottom: 24 }}>
                  <div style={{ fontSize: 48, fontWeight: 900, color: TIER_COLORS[result.tier] }}>{result.score}</div>
                  <span className={`tier-badge tier-${result.tier}`}>{result.tier}</span>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>{result.methods_fired}/{result.total_methods} methods triggered</div>
                </div>
                <div className="card-title mb-16">Method Evidence</div>
                {(result.evidence || []).map((e, i) => (
                  <div key={i} className={`evidence-item ${e.score >= 60 ? 'high' : e.score >= 30 ? 'medium' : 'low'}`}>
                    <div className="evidence-label">{METHOD_NAMES[e.method] || e.method} — Score: {e.score}</div>
                    <div style={{ fontSize: 13 }}>{e.detail}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="card" style={{ textAlign: 'center', padding: 60 }}>
              <FileText size={48} style={{ color: 'var(--text-muted)', marginBottom: 16 }} />
              <h3 style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>Upload a Receipt</h3>
              <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 8 }}>The system cross-references against your database. Your data is the oracle — every mismatch is detected.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
