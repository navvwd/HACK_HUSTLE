import { useState } from 'react';
import { MapPin, KeyRound, Camera, CheckCircle, AlertTriangle } from 'lucide-react';

export default function DeliveryVerification({ onNavigate }) {
  const [step, setStep] = useState(1);
  const [locationVerified, setLocationVerified] = useState(false);
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [otpVerified, setOtpVerified] = useState(false);
  const [videoProof, setVideoProof] = useState(false);

  const handleLocationCheck = () => {
    // Mock location check
    setTimeout(() => {
      setLocationVerified(true);
      setStep(2);
    }, 1500);
  };

  const handleOtpChange = (index, value) => {
    if (value.length > 1) value = value.slice(-1);
    const newOtp = [...otp];
    newOtp[index] = value;
    setOtp(newOtp);

    // Auto focus next input
    if (value && index < 5) {
      document.getElementById(`otp-${index + 1}`)?.focus();
    }
  };

  const verifyOtp = () => {
    if (otp.join('') === '123456') {
      setOtpVerified(true);
      setStep(3);
    } else {
      alert("Invalid OTP. Try 123456 for demo.");
    }
  };

  return (
    <div style={{ maxWidth: 600, margin: '40px auto', padding: '0 20px' }}>
      <div className="page-header" style={{ textAlign: 'center', marginBottom: 40 }}>
        <h2>Secure Delivery Verification</h2>
        <p>To complete your delivery and prevent lost packages, please verify your order.</p>
      </div>

      <div className="card animate-fade">
        {/* STEP 1: LOCATION */}
        <div style={{ padding: 20, borderBottom: '1px solid rgba(255,255,255,0.1)', opacity: step >= 1 ? 1 : 0.4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <div style={{ width: 32, height: 32, borderRadius: 16, background: locationVerified ? 'var(--green)' : 'rgba(59, 130, 246, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {locationVerified ? <CheckCircle size={18} color="#000" /> : <MapPin size={18} color="var(--accent)" />}
            </div>
            <h3 style={{ margin: 0, fontSize: 18 }}>Step 1: Location Check</h3>
          </div>
          <p style={{ color: 'var(--text-muted)', marginLeft: 44, fontSize: 14 }}>
            Please ensure you are within the exact delivery location coordinates.
          </p>
          {!locationVerified && step === 1 && (
            <button className="btn btn-secondary" style={{ marginLeft: 44, marginTop: 12 }} onClick={handleLocationCheck}>
              <MapPin size={16} /> Verify GPS Location
            </button>
          )}
        </div>

        {/* STEP 2: OTP */}
        <div style={{ padding: 20, borderBottom: '1px solid rgba(255,255,255,0.1)', opacity: step >= 2 ? 1 : 0.4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <div style={{ width: 32, height: 32, borderRadius: 16, background: otpVerified ? 'var(--green)' : 'rgba(147, 51, 234, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {otpVerified ? <CheckCircle size={18} color="#000" /> : <KeyRound size={18} color="#a855f7" />}
            </div>
            <h3 style={{ margin: 0, fontSize: 18 }}>Step 2: OTP Verification</h3>
          </div>
          <p style={{ color: 'var(--text-muted)', marginLeft: 44, fontSize: 14 }}>
            Enter the 6-digit PIN sent to your registered mobile number.
          </p>
          {step === 2 && !otpVerified && (
            <div style={{ marginLeft: 44, marginTop: 16 }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                {otp.map((digit, i) => (
                  <input key={i} id={`otp-${i}`} type="text" maxLength="1" value={digit} onChange={(e) => handleOtpChange(i, e.target.value)} style={{ width: 40, height: 48, textAlign: 'center', fontSize: 20, background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#fff' }} />
                ))}
              </div>
              <button className="btn btn-primary" onClick={verifyOtp}>Verify OTP</button>
            </div>
          )}
        </div>

        {/* STEP 3: VIDEO PROOF */}
        <div style={{ padding: 20, opacity: step >= 3 ? 1 : 0.4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <div style={{ width: 32, height: 32, borderRadius: 16, background: videoProof ? 'var(--green)' : 'rgba(239, 68, 68, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {videoProof ? <CheckCircle size={18} color="#000" /> : <Camera size={18} color="var(--red)" />}
            </div>
            <h3 style={{ margin: 0, fontSize: 18 }}>Step 3: Delivery Proof (High Value)</h3>
          </div>
          <p style={{ color: 'var(--text-muted)', marginLeft: 44, fontSize: 14 }}>
            Because this is a high-value order, please confirm the package condition.
          </p>
          {step === 3 && !videoProof && (
            <div style={{ marginLeft: 44, marginTop: 12 }}>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
                Scan the QR code on your package to open the in-app camera and record the unboxing.
              </p>
              <button className="btn btn-primary" onClick={() => onNavigate && onNavigate('scan')}>
                <Camera size={16} /> Scan Package QR
              </button>
            </div>
          )}
        </div>

      </div>

      {videoProof && (
        <div className="animate-scale" style={{ marginTop: 24, padding: 20, background: 'rgba(34, 197, 94, 0.1)', border: '1px solid var(--green)', borderRadius: 12, textAlign: 'center' }}>
          <CheckCircle size={48} color="var(--green)" style={{ margin: '0 auto 12px' }} />
          <h3 style={{ color: 'var(--green)', margin: '0 0 8px 0' }}>Order Successfully Delivered!</h3>
          <p style={{ color: 'var(--text-muted)', margin: 0 }}>This secure verification prevents false "Item Not Received" claims.</p>
        </div>
      )}

      <div style={{ marginTop: 32, padding: 16, background: 'rgba(255,255,255,0.02)', borderRadius: 8, display: 'flex', gap: 12 }}>
        <AlertTriangle color="var(--orange)" size={24} style={{ flexShrink: 0 }} />
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          <strong>Anti-Fraud Mechanism:</strong> This strict verification sequence guarantees non-repudiation. If a user later files an INR (Item Not Received) claim, the system immediately flags it as <strong>RED (Score: 90)</strong> because the exact GPS coordinates and their secure OTP were captured at the moment of delivery.
        </div>
      </div>
    </div>
  );
}
