import { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Loader, CheckCircle, AlertTriangle, MessageSquare } from 'lucide-react';
import axios from 'axios';

const CATEGORIES = [
  { value: 'electronics', label: '📱 Electronics' },
  { value: 'apparel', label: '👗 Apparel / Clothing' },
  { value: 'appliances', label: '🏠 Home Appliances' },
  { value: 'beauty', label: '💄 Beauty & Personal Care' },
  { value: 'baby_products', label: '🍼 Baby Products' },
];

const REASONS = {
  electronics: ['damaged', 'defective', 'not_received', 'wrong_item'],
  apparel: ['damaged', 'wrong_item', 'size_issue', 'not_received'],
  appliances: ['damaged', 'defective', 'not_received'],
  beauty: ['damaged', 'wrong_item', 'not_received'],
  baby_products: ['damaged', 'defective', 'not_received'],
};

function TypingIndicator() {
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center', padding: '10px 14px', background: 'rgba(255,255,255,0.04)', borderRadius: 16, width: 'fit-content', marginBottom: 12 }}>
      {[0, 1, 2].map(i => (
        <div key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)', animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite` }} />
      ))}
    </div>
  );
}

function ChatBubble({ msg }) {
  const isBot = msg.role === 'bot';
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 14, flexDirection: isBot ? 'row' : 'row-reverse' }}>
      <div style={{ width: 32, height: 32, borderRadius: 16, flexShrink: 0, background: isBot ? 'rgba(59,130,246,0.2)' : 'rgba(147,51,234,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {isBot ? <Bot size={16} color="var(--accent)" /> : <User size={16} color="#a855f7" />}
      </div>
      <div style={{
        maxWidth: '75%',
        padding: '10px 14px',
        borderRadius: isBot ? '4px 16px 16px 16px' : '16px 4px 16px 16px',
        background: isBot ? 'rgba(255,255,255,0.06)' : 'linear-gradient(135deg, rgba(59,130,246,0.3), rgba(147,51,234,0.3))',
        border: isBot ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(147,51,234,0.3)',
        fontSize: 14,
        lineHeight: 1.6,
        whiteSpace: 'pre-wrap',
      }}>
        {msg.text}
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 4, textAlign: isBot ? 'left' : 'right' }}>
          {msg.time}
        </div>
      </div>
    </div>
  );
}

export default function ReturnChatPage() {
  // Setup form state
  const [setup, setSetup] = useState({ order_id: 'ORD-10000', category: 'electronics', reason: 'damaged', product_name: 'Samsung Galaxy S23' });
  const [started, setStarted] = useState(false);

  // Chat state
  const [sessionId, setSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [fraudSignals, setFraudSignals] = useState([]);
  const [summary, setSummary] = useState('');

  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const now = () => new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

  const handleStart = async () => {
    setLoading(true);
    try {
      const res = await axios.post('http://127.0.0.1:8000/api/v1/chat/start', setup);
      setSessionId(res.data.session_id);
      setMessages([{ role: 'bot', text: res.data.message, time: now() }]);
      setStarted(true);
      setTimeout(() => inputRef.current?.focus(), 100);
    } catch (err) {
      alert("Could not start chat. Is the backend running?");
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || loading || isComplete) return;
    const userMsg = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text: userMsg, time: now() }]);
    setLoading(true);

    try {
      const res = await axios.post('http://127.0.0.1:8000/api/v1/chat/message', {
        session_id: sessionId,
        message: userMsg,
      });
      setMessages(prev => [...prev, { role: 'bot', text: res.data.message, time: now() }]);
      if (res.data.is_complete) {
        setIsComplete(true);
        setFraudSignals(res.data.fraud_signals || []);
        setSummary(res.data.summary || '');
      }
    } catch (err) {
      setMessages(prev => [...prev, { role: 'bot', text: "⚠️ Connection error. Please try again.", time: now() }]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!started) {
    return (
      <div className="animate-fade" style={{ maxWidth: 560, margin: '40px auto' }}>
        <div className="page-header" style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ width: 64, height: 64, borderRadius: 32, background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            <MessageSquare size={28} color="var(--accent)" />
          </div>
          <h2>File a Return with AI</h2>
          <p>Our AI assistant will guide you through the return process with relevant questions for your product category.</p>
        </div>

        <div className="card">
          <div className="form-group" style={{ marginBottom: 16 }}>
            <label className="form-label">Order ID</label>
            <input className="form-input" value={setup.order_id} onChange={e => setSetup({ ...setup, order_id: e.target.value })} placeholder="e.g. ORD-10000" />
          </div>
          <div className="form-group" style={{ marginBottom: 16 }}>
            <label className="form-label">Product Name</label>
            <input className="form-input" value={setup.product_name} onChange={e => setSetup({ ...setup, product_name: e.target.value })} placeholder="e.g. Samsung Galaxy S23" />
          </div>
          <div className="form-group" style={{ marginBottom: 16 }}>
            <label className="form-label">Product Category</label>
            <select className="form-select" value={setup.category} onChange={e => setSetup({ ...setup, category: e.target.value, reason: REASONS[e.target.value][0] })}>
              {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ marginBottom: 24 }}>
            <label className="form-label">Return Reason</label>
            <select className="form-select" value={setup.reason} onChange={e => setSetup({ ...setup, reason: e.target.value })}>
              {(REASONS[setup.category] || []).map(r => <option key={r} value={r}>{r.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</option>)}
            </select>
          </div>
          <button className="btn btn-primary" style={{ width: '100%', padding: 14 }} onClick={handleStart} disabled={loading}>
            {loading ? <><Loader size={16} style={{ animation: 'spin 1s linear infinite' }} /> Starting AI Session...</> : <><Bot size={16} /> Start AI Return Chat</>}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade" style={{ maxWidth: 700, margin: '0 auto', height: 'calc(100vh - 100px)', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 0', borderBottom: '1px solid rgba(255,255,255,0.08)', marginBottom: 16, flexShrink: 0 }}>
        <div style={{ width: 40, height: 40, borderRadius: 20, background: 'rgba(59,130,246,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Bot size={20} color="var(--accent)" />
        </div>
        <div>
          <div style={{ fontWeight: 600 }}>ReturnGuard AI</div>
          <div style={{ fontSize: 11, color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)' }} /> Active session · {setup.order_id} · {setup.category}
          </div>
        </div>
        <div style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>Session: {sessionId?.slice(0, 8)}</div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', paddingRight: 4 }}>
        {messages.map((m, i) => <ChatBubble key={i} msg={m} />)}
        {loading && <TypingIndicator />}
        {isComplete && (
          <div className="animate-scale" style={{ margin: '20px 0', padding: 20, background: 'rgba(34,197,94,0.08)', border: '1px solid var(--green)', borderRadius: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <CheckCircle color="var(--green)" size={20} />
              <strong style={{ color: 'var(--green)' }}>Return Request Submitted!</strong>
            </div>
            {summary && <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 8px' }}>{summary}</p>}
            {fraudSignals.length > 0 && (
              <div style={{ marginTop: 12, padding: 10, background: 'rgba(239,68,68,0.08)', borderRadius: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--red)', marginBottom: 6 }}>
                  <AlertTriangle size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                  {fraudSignals.length} Fraud Signal(s) Flagged for Admin Review
                </div>
                {fraudSignals.map((s, i) => <div key={i} style={{ fontSize: 11, color: 'var(--text-muted)' }}>• {s}</div>)}
              </div>
            )}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.08)', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isComplete ? "Session complete." : "Type your reply... (Enter to send)"}
            disabled={isComplete || loading}
            style={{ flex: 1, padding: '10px 14px', borderRadius: 12, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: 14, resize: 'none', lineHeight: 1.5, fontFamily: 'inherit', outline: 'none' }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || loading || isComplete}
            style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--accent)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, opacity: (!input.trim() || loading || isComplete) ? 0.4 : 1 }}
          >
            <Send size={18} color="#fff" />
          </button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, textAlign: 'center' }}>
          Powered by Gemini 2.5 Flash · Category: {setup.category} · Reason: {setup.reason}
        </div>
      </div>
    </div>
  );
}
