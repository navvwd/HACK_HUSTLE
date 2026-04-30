import { useEffect, useState } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { Camera, ShieldAlert } from 'lucide-react';

export default function QRScanPage({ onScanSuccess }) {
  const [error, setError] = useState('');

  useEffect(() => {
    // Initialize scanner
    const scanner = new Html5QrcodeScanner("reader", { fps: 10, qrbox: { width: 250, height: 250 } }, false);
    
    scanner.render((decodedText) => {
      // Expected URL format: http://localhost:5173/customer/record/ORD-123?token=abc
      try {
        const url = new URL(decodedText);
        const orderId = url.pathname.split('/').pop();
        const token = url.searchParams.get('token');
        if (orderId && token) {
          scanner.clear();
          onScanSuccess(orderId, token);
        } else {
          setError("Invalid QR code format.");
        }
      } catch (e) {
        setError("Invalid QR code URL.");
      }
    }, (errorMessage) => {
      // Ignore scan failures as it continuously scans
    });

    return () => {
      scanner.clear().catch(console.error);
    };
  }, [onScanSuccess]);

  return (
    <div className="animate-fade" style={{ maxWidth: 500, margin: '0 auto', textAlign: 'center', paddingTop: 40 }}>
      <div className="page-header" style={{ marginBottom: 30 }}>
        <h2><Camera style={{ display: 'inline', verticalAlign: 'middle', marginRight: 8 }} /> Scan Return QR</h2>
        <p>Scan the QR code printed on your package receipt to start the return process.</p>
      </div>

      <div className="card">
        <div id="reader" style={{ width: '100%' }}></div>
        {error && (
          <div style={{ color: 'var(--red)', marginTop: 16, fontSize: 14 }}>
            <ShieldAlert size={16} style={{ verticalAlign: 'middle', marginRight: 4 }}/> {error}
          </div>
        )}
      </div>
    </div>
  );
}
