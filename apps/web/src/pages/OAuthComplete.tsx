import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

export default function OAuthComplete() {
  const [params] = useSearchParams();
  const success = params.get('success') !== 'false';
  const provider = params.get('provider') ?? 'service';
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    const msg = { type: 'helm_oauth_complete', provider, success };
    if (window.opener) {
      try {
        window.opener.postMessage(msg, window.location.origin);
      } catch {
        try { window.opener.postMessage(msg, '*'); } catch { /* cross-origin */ }
      }
      const t = setTimeout(() => {
        window.close();
        setClosed(true);
      }, 800);
      return () => clearTimeout(t);
    } else {
      setClosed(true);
    }
  }, [provider, success]);

  const label = provider === 'qbo' ? 'QuickBooks Online'
    : provider === 'stripe' ? 'Stripe'
    : provider.charAt(0).toUpperCase() + provider.slice(1);

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      height: '100vh', fontFamily: 'system-ui, sans-serif', background: '#F8FAFC',
    }}>
      <div style={{
        background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '16px',
        padding: '48px 40px', textAlign: 'center', maxWidth: '360px', boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
      }}>
        {success ? (
          <>
            <div style={{ fontSize: '52px', marginBottom: '16px' }}>✓</div>
            <div style={{ fontSize: '22px', fontWeight: 700, color: '#0A2342', marginBottom: '8px' }}>{label} connected!</div>
            <div style={{ fontSize: '14px', color: '#64748B' }}>
              {closed ? 'You can close this window.' : 'Closing this window…'}
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: '52px', marginBottom: '16px' }}>✕</div>
            <div style={{ fontSize: '22px', fontWeight: 700, color: '#DC2626', marginBottom: '8px' }}>Connection failed</div>
            <div style={{ fontSize: '14px', color: '#64748B', marginBottom: '20px' }}>
              Something went wrong. Please close this window and try again.
            </div>
            <button
              style={{ padding: '10px 24px', background: '#0A2342', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: 600 }}
              onClick={() => window.close()}
            >
              Close Window
            </button>
          </>
        )}
      </div>
    </div>
  );
}
