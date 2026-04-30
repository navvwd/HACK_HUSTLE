import { useState } from 'react';
import { Shield, User, Lock, ArrowRight, Activity } from 'lucide-react';
import axios from 'axios';

export default function LoginPage({ onLoginSuccess }) {
  const [tab, setTab] = useState('retailer');
  const [username, setUsername] = useState(tab === 'retailer' ? 'admin' : 'maya');
  const [password, setPassword] = useState(tab === 'retailer' ? 'admin123' : 'user123');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleTabSwitch = (newTab) => {
    setTab(newTab);
    setUsername(newTab === 'retailer' ? 'admin' : 'maya');
    setPassword(newTab === 'retailer' ? 'admin123' : 'user123');
    setError('');
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    try {
      const res = await axios.post('http://127.0.0.1:8000/api/v1/auth/login', { username, password });
      const data = res.data;
      
      // We pass the user payload up to App.jsx to handle routing
      onLoginSuccess(data);
    } catch (err) {
      setError(err.response?.data?.detail || "Invalid credentials");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #09090b 0%, #18181b 100%)', padding: 20 }}>
      <div className="animate-scale" style={{ width: '100%', maxWidth: 440 }}>
        
        {/* Logo Section */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 64, height: 64, borderRadius: 20, background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.2), rgba(147, 51, 234, 0.2))', border: '1px solid rgba(255,255,255,0.1)', marginBottom: 16 }}>
            <Shield size={32} style={{ color: 'var(--accent)' }} />
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 700, margin: '0 0 8px 0', letterSpacing: '-0.02em' }}>ReturnGuard AI</h1>
          <p style={{ color: 'var(--text-muted)', margin: 0 }}>Enterprise Fraud Intelligence</p>
        </div>

        {/* Login Card */}
        <div className="card" style={{ padding: 0, overflow: 'hidden', backdropFilter: 'blur(20px)', background: 'rgba(24, 24, 27, 0.6)', border: '1px solid rgba(255,255,255,0.05)' }}>
          
          {/* Tabs */}
          <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
            <button 
              onClick={() => handleTabSwitch('customer')}
              style={{ flex: 1, padding: '16px', background: tab === 'customer' ? 'rgba(255,255,255,0.05)' : 'transparent', border: 'none', color: tab === 'customer' ? '#fff' : 'var(--text-muted)', fontWeight: tab === 'customer' ? 600 : 400, cursor: 'pointer', transition: 'all 0.2s' }}
            >
              Customer Login
            </button>
            <button 
              onClick={() => handleTabSwitch('retailer')}
              style={{ flex: 1, padding: '16px', background: tab === 'retailer' ? 'rgba(255,255,255,0.05)' : 'transparent', border: 'none', color: tab === 'retailer' ? '#fff' : 'var(--text-muted)', fontWeight: tab === 'retailer' ? 600 : 400, cursor: 'pointer', transition: 'all 0.2s' }}
            >
              Retailer Admin
            </button>
          </div>

          <form onSubmit={handleLogin} style={{ padding: 32 }}>
            <div className="form-group" style={{ marginBottom: 20 }}>
              <label className="form-label">Username</label>
              <div style={{ position: 'relative' }}>
                <User size={18} style={{ position: 'absolute', left: 12, top: 11, color: 'var(--text-muted)' }} />
                <input 
                  type="text" 
                  className="form-input" 
                  style={{ paddingLeft: 40 }}
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="Enter username"
                  required
                />
              </div>
            </div>

            <div className="form-group" style={{ marginBottom: 24 }}>
              <label className="form-label">Password</label>
              <div style={{ position: 'relative' }}>
                <Lock size={18} style={{ position: 'absolute', left: 12, top: 11, color: 'var(--text-muted)' }} />
                <input 
                  type="password" 
                  className="form-input" 
                  style={{ paddingLeft: 40 }}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Enter password"
                  required
                />
              </div>
            </div>

            {error && (
              <div style={{ padding: '10px 12px', background: 'rgba(239, 68, 68, 0.1)', color: 'var(--red)', borderRadius: 8, fontSize: 13, marginBottom: 24, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Activity size={16} /> {error}
              </div>
            )}

            <button 
              type="submit" 
              className="btn btn-primary" 
              style={{ width: '100%', padding: '12px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8 }}
              disabled={loading}
            >
              {loading ? 'Authenticating...' : 'Sign In'} <ArrowRight size={16} />
            </button>
            
            <div style={{ textAlign: 'center', marginTop: 24, fontSize: 12, color: 'var(--text-muted)' }}>
              Demo Accounts: <br/>
              <strong>Retailer:</strong> admin / admin123 <br/>
              <strong>Customer:</strong> maya / user123
            </div>
          </form>

        </div>
      </div>
    </div>
  );
}
