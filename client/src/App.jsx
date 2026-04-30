import { useState } from 'react';
import './index.css';
import Dashboard from './pages/Dashboard';
import ReturnForm from './pages/ReturnForm';
import DamageAnalysis from './pages/DamageAnalysis';
import ReceiptAnalysis from './pages/ReceiptAnalysis';
import ReviewQueue from './pages/ReviewQueue';
import PipelineView from './pages/PipelineView';
import DemoPanel from './pages/DemoPanel';
import DamagedProductCapture from './pages/DamagedProductCapture';
import QRScanPage from './pages/QRScanPage';
import VideoRecordPage from './pages/VideoRecordPage';
import LoginPage from './pages/LoginPage';
import DeliveryVerification from './pages/DeliveryVerification';
import ReturnChatPage from './pages/ReturnChatPage';
import FraudIntelligencePage from './pages/FraudIntelligencePage';
import { Shield, LayoutDashboard, FileText, Camera, Receipt, Users, GitBranch, Zap, Video, QrCode, LogOut, MapPin, MessageSquare, Brain } from 'lucide-react';

const RETAILER_NAV = [
  { id: 'dashboard', label: 'Admin Dashboard', icon: LayoutDashboard },
  { id: 'fraud_intel', label: 'Fraud Intelligence', icon: Brain },
  { id: 'review', label: 'Review Queue', icon: Users },
  { id: 'pipeline', label: 'Pipeline View', icon: GitBranch },
  { id: 'damage', label: 'Damage Analysis', icon: Camera },
  { id: 'receipt', label: 'Receipt Check', icon: Receipt },
  { id: 'demo', label: 'Demo Scenarios', icon: Zap },
];

const CUSTOMER_NAV = [
  { id: 'chat_return', label: 'AI Return Chat', icon: MessageSquare },
  { id: 'scan', label: 'Scan Return QR', icon: QrCode },
  { id: 'submit', label: 'File Return (Manual)', icon: FileText },
  { id: 'camera', label: 'Live Capture', icon: Video },
  { id: 'delivery', label: 'Delivery Check', icon: MapPin },
];

export default function App() {
  const [user, setUser] = useState(null); // { token, role, customer_id, username }
  const [page, setPage] = useState('dashboard');
  const [scanContext, setScanContext] = useState({ orderId: null, token: null });

  const handleLogin = (userData) => {
    setUser(userData);
    setPage(userData.role === 'admin' ? 'dashboard' : 'chat_return');
  };

  const handleLogout = () => {
    setUser(null);
  };

  const handleScanSuccess = (orderId, token) => {
    setScanContext({ orderId, token });
    setPage('record_video');
  };

  const renderPage = () => {
    switch (page) {
      case 'dashboard': return <Dashboard />;
      case 'fraud_intel': return <FraudIntelligencePage />;
      case 'chat_return': return <ReturnChatPage />;
      case 'scan': return <QRScanPage onScanSuccess={handleScanSuccess} />;
      case 'record_video': return <VideoRecordPage orderId={scanContext.orderId} token={scanContext.token} onComplete={() => setPage('submit')} />;
      case 'submit': return <ReturnForm />;
      case 'damage': return <DamageAnalysis />;
      case 'camera': return <DamagedProductCapture onCapture={() => setPage('submit')} />;
      case 'receipt': return <ReceiptAnalysis />;
      case 'delivery': return <DeliveryVerification onNavigate={setPage} />;
      case 'review': return <ReviewQueue />;
      case 'pipeline': return <PipelineView />;
      case 'demo': return <DemoPanel />;
      default: return <Dashboard />;
    }
  };

  if (!user) {
    return <LoginPage onLoginSuccess={handleLogin} />;
  }

  const activeNav = user.role === 'admin' ? RETAILER_NAV : CUSTOMER_NAV;

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="logo-icon"><Shield size={20} /></div>
          <div>
            <h1>ReturnGuard</h1>
            <span style={{ textTransform: 'capitalize' }}>{user.role} Portal</span>
          </div>
        </div>
        
        {activeNav.map(n => (
          <div key={n.id} className={`nav-item ${page === n.id ? 'active' : ''}`} onClick={() => setPage(n.id)}>
            <n.icon size={18} />
            {n.label}
          </div>
        ))}
        
        <div style={{ flex: 1 }} />
        
        <div className="nav-item" onClick={handleLogout} style={{ color: 'var(--red)', marginTop: 'auto' }}>
          <LogOut size={18} />
          Logout ({user.username})
        </div>
        
        <div style={{ padding: '12px 14px', fontSize: '11px', color: 'var(--text-muted)' }}>
          v2.0 · 6 Fraud Vectors<br />Context-Aware Fusion Active
        </div>
      </aside>
      <main className="main-content">
        {renderPage()}
      </main>
    </div>
  );
}
