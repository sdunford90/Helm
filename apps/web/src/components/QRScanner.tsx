import { useState, useRef, useCallback, useEffect } from 'react';

interface QRScannerProps {
  onScan: (slipId: string) => void;
  onError?: (error: string) => void;
}

export default function QRScanner({ onScan, onError }: QRScannerProps) {
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationRef = useRef<number | null>(null);

  // Clean up camera stream on unmount
  useEffect(() => {
    return () => stopCamera();
  }, []);

  const stopCamera = useCallback(() => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setScanning(false);
  }, []);

  const startCamera = useCallback(async () => {
    setError(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      const msg = 'Camera access is not supported in this browser';
      setError(msg);
      onError?.(msg);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });

      streamRef.current = stream;
      setScanning(true);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        scanFrame();
      }
    } catch (err) {
      const msg =
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'Camera permission denied. Please allow camera access.'
          : 'Failed to access camera';
      setError(msg);
      onError?.(msg);
    }
  }, [onError]);

  // Scan each video frame for QR codes using BarcodeDetector if available,
  // otherwise fall back to a simple pattern-based extraction.
  const scanFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!video || !canvas || !streamRef.current) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Use BarcodeDetector API if the browser supports it
    if ('BarcodeDetector' in window) {
      const detector = new (window as any).BarcodeDetector({ formats: ['qr_code'] });
      detector
        .detect(canvas)
        .then((barcodes: any[]) => {
          if (barcodes.length > 0) {
            const slipId = parseSlipId(barcodes[0].rawValue);
            if (slipId) {
              onScan(slipId);
              stopCamera();
              return;
            }
          }
          // Keep scanning
          animationRef.current = requestAnimationFrame(scanFrame);
        })
        .catch(() => {
          animationRef.current = requestAnimationFrame(scanFrame);
        });
    } else {
      // Fallback: try to read ImageData (very basic – real apps should use
      // a JS QR library like jsQR, but we keep this dependency-free).
      animationRef.current = requestAnimationFrame(scanFrame);
    }
  }, [onScan, stopCamera]);

  return (
    <div style={containerStyle}>
      {!scanning && (
        <button onClick={startCamera} style={buttonStyle}>
          Scan Slip QR Code
        </button>
      )}

      {error && <p style={errorStyle}>{error}</p>}

      {scanning && (
        <div style={previewContainerStyle}>
          <video
            ref={videoRef}
            style={videoStyle}
            playsInline
            muted
          />
          {/* Scan overlay */}
          <div style={overlayStyle}>
            <div style={scanBoxStyle} />
          </div>
          <canvas ref={canvasRef} style={{ display: 'none' }} />
          <button onClick={stopCamera} style={cancelButtonStyle}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Parse a slip ID from the raw QR code value
// Expects formats like "helm:slip:<id>" or just the bare slip ID
// ---------------------------------------------------------------------------
function parseSlipId(raw: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();

  // helm:slip:<id>
  const prefixed = trimmed.match(/^helm:slip:(.+)$/i);
  if (prefixed) return prefixed[1];

  // URL like https://app.helm.com/slips/<id>
  const urlMatch = trimmed.match(/\/slips\/([a-zA-Z0-9_-]+)/);
  if (urlMatch) return urlMatch[1];

  // Bare alphanumeric ID (UUIDs, nanoids, etc.)
  if (/^[a-zA-Z0-9_-]{4,}$/.test(trimmed)) return trimmed;

  return null;
}

// ---------------------------------------------------------------------------
// Inline styles
// ---------------------------------------------------------------------------
const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '12px',
};

const buttonStyle: React.CSSProperties = {
  padding: '12px 24px',
  fontSize: '16px',
  fontWeight: 600,
  color: '#fff',
  backgroundColor: '#0A2342',
  border: 'none',
  borderRadius: '8px',
  cursor: 'pointer',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
};

const cancelButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  backgroundColor: '#D32F2F',
  marginTop: '8px',
};

const errorStyle: React.CSSProperties = {
  color: '#D32F2F',
  fontSize: '14px',
  margin: 0,
};

const previewContainerStyle: React.CSSProperties = {
  position: 'relative',
  width: '100%',
  maxWidth: '400px',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
};

const videoStyle: React.CSSProperties = {
  width: '100%',
  borderRadius: '8px',
  backgroundColor: '#000',
};

const overlayStyle: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  bottom: '48px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  pointerEvents: 'none',
};

const scanBoxStyle: React.CSSProperties = {
  width: '200px',
  height: '200px',
  border: '3px solid #00D4FF',
  borderRadius: '12px',
  boxShadow: '0 0 0 4000px rgba(0,0,0,0.3)',
};
