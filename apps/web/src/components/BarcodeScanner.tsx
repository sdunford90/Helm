import { useState, useRef, useEffect, CSSProperties } from 'react';

interface BarcodeScannerProps {
  onScan: (barcode: string) => void;
  mode?: 'serial' | 'camera' | 'auto';
}

type ScanStatus = 'idle' | 'scanning' | 'success' | 'error';

const knownProducts: Record<string, string> = {
  '8901234567890': 'Dock Line 3/8" x 15\'',
  '7654321098765': 'Marine Polish 16oz',
  '1122334455667': 'LED Navigation Light',
  '9988776655443': 'Boat Fender 6" x 22"',
  '5566778899001': 'Zinc Anode Kit',
  '3344556677889': 'Fuel Filter Element',
};

export default function BarcodeScanner({ onScan, mode = 'auto' }: BarcodeScannerProps) {
  const [status, setStatus] = useState<ScanStatus>('idle');
  const [lastBarcode, setLastBarcode] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [activeMode, setActiveMode] = useState<'serial' | 'camera' | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const serialPortRef = useRef<any>(null);
  const readerRef = useRef<ReadableStreamDefaultReader | null>(null);
  const scanningRef = useRef(false);

  useEffect(() => {
    return () => {
      stopScanning();
    };
  }, []);

  const stopScanning = () => {
    scanningRef.current = false;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (readerRef.current) {
      readerRef.current.cancel().catch(() => {});
      readerRef.current = null;
    }
    if (serialPortRef.current) {
      serialPortRef.current.close().catch(() => {});
      serialPortRef.current = null;
    }
    setActiveMode(null);
  };

  const handleBarcode = (barcode: string) => {
    const trimmed = barcode.trim();
    if (!trimmed) return;
    setLastBarcode(trimmed);
    if (knownProducts[trimmed]) {
      setStatus('success');
      onScan(trimmed);
    } else {
      setStatus('error');
      setErrorMsg(`Unknown product: ${trimmed}`);
    }
    setTimeout(() => {
      setStatus((s) => (s === 'success' || s === 'error' ? 'scanning' : s));
      setErrorMsg(null);
    }, 1500);
  };

  const startSerialScanner = async () => {
    try {
      const nav = navigator as any;
      if (!nav.serial) {
        throw new Error('Web Serial API not supported in this browser');
      }
      const port = await nav.serial.requestPort();
      await port.open({ baudRate: 9600 });
      serialPortRef.current = port;
      setActiveMode('serial');
      setStatus('scanning');
      scanningRef.current = true;

      const decoder = new TextDecoderStream();
      port.readable.pipeTo(decoder.writable);
      const reader = decoder.readable.getReader();
      readerRef.current = reader;

      let buffer = '';
      while (scanningRef.current) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          handleBarcode(line);
        }
      }
    } catch (err: any) {
      if (err.name !== 'NotFoundError') {
        setStatus('error');
        setErrorMsg(err.message || 'Serial scanner failed');
        setTimeout(() => {
          setStatus('idle');
          setErrorMsg(null);
        }, 2500);
      }
    }
  };

  const startCameraScanner = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setActiveMode('camera');
      setStatus('scanning');
      scanningRef.current = true;

      const BarcodeDetectorClass = (window as any).BarcodeDetector;
      if (!BarcodeDetectorClass) {
        throw new Error('BarcodeDetector API not supported. Try Chrome on Android or enable flags.');
      }
      const detector = new BarcodeDetectorClass({
        formats: ['code_128', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'qr_code'],
      });

      const scanFrame = async () => {
        if (!scanningRef.current || !videoRef.current) return;
        try {
          const barcodes = await detector.detect(videoRef.current);
          for (const bc of barcodes) {
            if (bc.rawValue) {
              handleBarcode(bc.rawValue);
            }
          }
        } catch {
          // frame detection error, continue
        }
        if (scanningRef.current) {
          requestAnimationFrame(scanFrame);
        }
      };
      requestAnimationFrame(scanFrame);
    } catch (err: any) {
      setStatus('error');
      setErrorMsg(err.message || 'Camera access failed');
      setTimeout(() => {
        setStatus('idle');
        setErrorMsg(null);
      }, 2500);
    }
  };

  const handleScanClick = async () => {
    if (status === 'scanning') {
      stopScanning();
      setStatus('idle');
      return;
    }

    setErrorMsg(null);

    if (mode === 'serial') {
      await startSerialScanner();
    } else if (mode === 'camera') {
      await startCameraScanner();
    } else {
      // auto: try serial first, fall back to camera
      const nav = navigator as any;
      if (nav.serial) {
        try {
          await startSerialScanner();
          return;
        } catch {
          // fall through to camera
        }
      }
      await startCameraScanner();
    }
  };

  const styles: Record<string, CSSProperties> = {
    container: {
      background: '#ffffff',
      borderRadius: 12,
      border: '1px solid #e2e8f0',
      padding: 24,
      maxWidth: 480,
    },
    header: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 16,
    },
    title: {
      fontSize: 16,
      fontWeight: 700,
      color: '#0a2540',
      margin: 0,
    },
    badge: {
      fontSize: 11,
      fontWeight: 600,
      padding: '3px 10px',
      borderRadius: 20,
      background: status === 'scanning' ? '#e0f7fa' : status === 'success' ? '#e8f5e9' : status === 'error' ? '#fce4ec' : '#f1f5f9',
      color: status === 'scanning' ? '#00838f' : status === 'success' ? '#2e7d32' : status === 'error' ? '#c62828' : '#64748b',
    },
    scanButton: {
      width: '100%',
      padding: '12px 24px',
      fontSize: 15,
      fontWeight: 600,
      color: '#ffffff',
      background: status === 'scanning' ? '#ef4444' : 'linear-gradient(135deg, #0ea5e9, #0077b6)',
      backgroundColor: status === 'scanning' ? '#ef4444' : '#0ea5e9',
      border: 'none',
      borderRadius: 8,
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    flash: {
      position: 'absolute' as const,
      inset: 0,
      borderRadius: 12,
      pointerEvents: 'none' as const,
      transition: 'opacity 0.3s ease',
      opacity: status === 'success' ? 0.15 : status === 'error' ? 0.15 : 0,
      background: status === 'success' ? '#22c55e' : status === 'error' ? '#ef4444' : 'transparent',
    },
    videoContainer: {
      marginTop: 16,
      borderRadius: 8,
      overflow: 'hidden',
      background: '#000',
      position: 'relative' as const,
    },
    video: {
      width: '100%',
      display: 'block',
    },
    scanLine: {
      position: 'absolute' as const,
      left: '10%',
      right: '10%',
      height: 2,
      background: '#0ea5e9',
      top: '50%',
      boxShadow: '0 0 8px rgba(14, 165, 233, 0.6)',
      animation: 'scanPulse 1.5s ease-in-out infinite',
    },
    result: {
      marginTop: 16,
      padding: 12,
      borderRadius: 8,
      background: '#f8fafc',
      border: '1px solid #e2e8f0',
    },
    resultLabel: {
      fontSize: 11,
      fontWeight: 600,
      color: '#94a3b8',
      textTransform: 'uppercase' as const,
      letterSpacing: '0.05em',
      marginBottom: 4,
    },
    resultValue: {
      fontSize: 14,
      fontWeight: 600,
      color: '#0a2540',
      fontFamily: 'monospace',
    },
    errorText: {
      marginTop: 12,
      fontSize: 13,
      color: '#ef4444',
      textAlign: 'center' as const,
    },
    modeIndicator: {
      fontSize: 12,
      color: '#64748b',
      textAlign: 'center' as const,
      marginTop: 8,
    },
  };

  return (
    <div style={{ ...styles.container, position: 'relative' }}>
      <div style={styles.flash} />
      <div style={styles.header}>
        <h3 style={styles.title}>Barcode Scanner</h3>
        <span style={styles.badge}>
          {status === 'idle' && 'Ready'}
          {status === 'scanning' && 'Scanning...'}
          {status === 'success' && 'Found'}
          {status === 'error' && 'Error'}
        </span>
      </div>

      <button style={styles.scanButton} onClick={handleScanClick}>
        {status === 'scanning' ? (
          <>
            <span style={{ fontSize: 18 }}>&#9724;</span> Stop Scanning
          </>
        ) : (
          <>
            <span style={{ fontSize: 18 }}>&#9698;</span> Scan Barcode
          </>
        )}
      </button>

      {activeMode && (
        <div style={styles.modeIndicator}>
          Mode: {activeMode === 'serial' ? 'USB/Bluetooth Scanner' : 'Camera'}
        </div>
      )}

      {activeMode === 'camera' && (
        <div style={styles.videoContainer}>
          <video ref={videoRef} style={styles.video} muted playsInline />
          <div style={styles.scanLine} />
        </div>
      )}

      {lastBarcode && (
        <div style={styles.result}>
          <div style={styles.resultLabel}>Last Scanned</div>
          <div style={styles.resultValue}>{lastBarcode}</div>
          {knownProducts[lastBarcode] && (
            <div style={{ fontSize: 13, color: '#22c55e', marginTop: 4, fontWeight: 500 }}>
              {knownProducts[lastBarcode]}
            </div>
          )}
        </div>
      )}

      {errorMsg && <div style={styles.errorText}>{errorMsg}</div>}
    </div>
  );
}
