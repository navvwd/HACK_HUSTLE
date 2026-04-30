import { useState, useRef, useEffect } from 'react';
import { Video, Square, UploadCloud, CheckCircle } from 'lucide-react';
import axios from 'axios';

export default function VideoRecordPage({ orderId, token, onComplete }) {
  const videoRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedChunks, setRecordedChunks] = useState([]);
  const [videoUrl, setVideoUrl] = useState(null);
  const [timer, setTimer] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  // Auto-start camera on mount
  useEffect(() => {
    startCamera();
    return () => {
      // Cleanup streams
      if (videoRef.current && videoRef.current.srcObject) {
        videoRef.current.srcObject.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  // Timer logic
  useEffect(() => {
    let interval;
    if (isRecording) {
      interval = setInterval(() => setTimer(t => t + 1), 1000);
    } else {
      clearInterval(interval);
    }
    return () => clearInterval(interval);
  }, [isRecording]);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      setError("Camera access denied or unavailable.");
    }
  };

  const handleStartCaptureClick = () => {
    setRecordedChunks([]);
    setVideoUrl(null);
    setTimer(0);
    
    const stream = videoRef.current.srcObject;
    const mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    
    mediaRecorder.addEventListener('dataavailable', ({ data }) => {
      if (data.size > 0) {
        setRecordedChunks((prev) => prev.concat(data));
      }
    });
    
    mediaRecorderRef.current = mediaRecorder;
    mediaRecorder.start(1000); // chunk every second
    setIsRecording(true);
  };

  const handleStopCaptureClick = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  };

  // When chunks are finalized, create a local URL for preview
  useEffect(() => {
    if (!isRecording && recordedChunks.length > 0 && !videoUrl) {
      const blob = new Blob(recordedChunks, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      setVideoUrl(url);
      if (videoRef.current) {
        videoRef.current.srcObject = null;
        videoRef.current.src = url;
        videoRef.current.controls = true;
      }
    }
  }, [isRecording, recordedChunks, videoUrl]);

  const handleSubmit = async () => {
    if (recordedChunks.length === 0) return;
    setUploading(true);
    
    const blob = new Blob(recordedChunks, { type: 'video/webm' });
    const formData = new FormData();
    formData.append('video', blob, `${orderId}_video.webm`);
    formData.append('order_id', orderId);
    formData.append('token', token);

    try {
      await axios.post('http://127.0.0.1:8000/api/v1/claims/video', formData);
      setSuccess(true);
      setTimeout(() => onComplete(), 2000);
    } catch (err) {
      setError("Failed to upload video.");
    } finally {
      setUploading(false);
    }
  };

  const formatTime = (secs) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  if (success) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 60, marginTop: 40 }}>
        <CheckCircle size={64} style={{ color: 'var(--green)', margin: '0 auto 20px' }} />
        <h3>Video Uploaded Successfully!</h3>
        <p style={{ color: 'var(--text-muted)' }}>Redirecting...</p>
      </div>
    );
  }

  return (
    <div className="animate-fade" style={{ maxWidth: 600, margin: '0 auto', paddingTop: 20 }}>
      <div className="page-header" style={{ marginBottom: 20 }}>
        <h2>Recording Return Video</h2>
        <p>Order: <strong>{orderId}</strong></p>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden', position: 'relative', backgroundColor: '#000' }}>
        <video 
          ref={videoRef} 
          autoPlay 
          playsInline 
          muted={!videoUrl} 
          style={{ width: '100%', display: 'block', maxHeight: 400, objectFit: 'cover' }} 
        />
        
        {isRecording && (
          <div style={{ position: 'absolute', top: 16, right: 16, backgroundColor: 'rgba(0,0,0,0.6)', padding: '4px 12px', borderRadius: 20, color: 'white', display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 10, height: 10, backgroundColor: 'red', borderRadius: '50%', animation: 'pulse 1s infinite' }} />
            {formatTime(timer)}
          </div>
        )}
      </div>

      {error && <div style={{ color: 'var(--red)', marginTop: 16, textAlign: 'center' }}>{error}</div>}

      <div style={{ display: 'flex', gap: 12, marginTop: 20, justifyContent: 'center' }}>
        {!isRecording && !videoUrl && (
          <button className="btn btn-primary" onClick={handleStartCaptureClick} style={{ width: 200 }}>
            <Video size={18} /> Start Recording
          </button>
        )}
        
        {isRecording && (
          <button className="btn btn-primary" onClick={handleStopCaptureClick} style={{ width: 200, backgroundColor: 'var(--red)', borderColor: 'var(--red)' }}>
            <Square size={18} /> Stop Recording
          </button>
        )}

        {!isRecording && videoUrl && (
          <>
            <button className="btn btn-secondary" onClick={() => {
              setVideoUrl(null);
              setRecordedChunks([]);
              startCamera();
            }}>
              Retake
            </button>
            <button className="btn btn-primary" onClick={handleSubmit} disabled={uploading}>
              {uploading ? 'Uploading...' : <><UploadCloud size={18} /> Submit Video</>}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
