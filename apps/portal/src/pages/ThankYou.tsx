import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@clerk/clerk-react';
import { CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import type { CSSProperties } from 'react';

const NAVY = '#0A2342';
const CYAN = '#00D4FF';

interface SessionStatus {
  status: string; // 'complete' | 'open' | 'expired'
  paymentStatus: string; // 'paid' | 'unpaid' | 'no_payment_required'
  paymentIntentId: string | null;
  paymentIntentStatus: string | null;
}

const shell: CSSProperties = {
  minHeight: '100vh',
  background: '#F7F9FB',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
};
const card: CSSProperties = {
  background: '#fff',
  borderRadius: 12,
  padding: '40px 48px',
  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  maxWidth: 560,
  width: '100%',
  textAlign: 'center',
};
const headline: CSSProperties = {
  fontSize: 28,
  fontWeight: 700,
  color: NAVY,
  letterSpacing: '-0.02em',
  margin: '16px 0 8px',
};
const sub: CSSProperties = {
  fontSize: 15,
  color: '#2E4A6B',
  lineHeight: 1.6,
  marginBottom: 24,
};
const primaryBtn: CSSProperties = {
  display: 'inline-block',
  padding: '12px 28px',
  background: NAVY,
  color: '#fff',
  textDecoration: 'none',
  borderRadius: 8,
  fontWeight: 600,
  border: 'none',
  cursor: 'pointer',
  fontSize: 14,
};

export default function ThankYou() {
  const [params] = useSearchParams();
  const sessionId = params.get('session_id');
  const navigate = useNavigate();
  const { getToken } = useAuth();

  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<SessionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setError('Missing session id.');
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        const res = await fetch(
          `/api/checkout/session-status?session_id=${encodeURIComponent(sessionId)}`,
          { headers: token ? { Authorization: `Bearer ${token}` } : {} },
        );
        if (!res.ok) throw new Error(`Status ${res.status}`);
        const data = (await res.json()) as SessionStatus;
        if (!cancelled) {
          setStatus(data);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load status');
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, getToken]);

  if (loading) {
    return (
      <div style={shell}>
        <div style={card}>
          <Loader2 size={36} color={NAVY} style={{ animation: 'spin 1s linear infinite' }} />
          <div style={headline}>Confirming payment…</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={shell}>
        <div style={card}>
          <AlertCircle size={48} color="#B71C1C" />
          <div style={headline}>We couldn't confirm your payment</div>
          <p style={sub}>{error}</p>
          <button style={primaryBtn} onClick={() => navigate('/invoices')}>
            Back to invoices
          </button>
        </div>
      </div>
    );
  }

  const isSuccess =
    status?.status === 'complete' && status.paymentStatus === 'paid';

  if (isSuccess) {
    return (
      <div style={shell}>
        <div style={card}>
          <CheckCircle size={56} color="#1B5E20" />
          <div style={headline}>Payment received</div>
          <p style={sub}>
            Thanks — your payment has been processed. A receipt will arrive in your inbox shortly.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
            <button
              style={{ ...primaryBtn, background: '#fff', color: NAVY, border: `1px solid ${NAVY}` }}
              onClick={() => navigate('/invoices')}
            >
              View invoices
            </button>
            <button style={primaryBtn} onClick={() => navigate('/')}>
              Back to dashboard
            </button>
          </div>
          {status.paymentIntentId && (
            <p style={{ marginTop: 24, fontSize: 12, color: '#94A3B8', fontFamily: 'JetBrains Mono, monospace' }}>
              Ref: {status.paymentIntentId}
            </p>
          )}
        </div>
      </div>
    );
  }

  // In-progress or failed case (ACH processing, 3DS required, etc.)
  return (
    <div style={shell}>
      <div style={card}>
        <AlertCircle size={48} color="#856404" />
        <div style={headline}>Payment pending</div>
        <p style={sub}>
          Your payment is still processing. You'll receive an email once it settles. If nothing arrives within a business day, reach out to your marina.
        </p>
        <button style={primaryBtn} onClick={() => navigate('/invoices')}>
          Back to invoices
        </button>
        <p style={{ marginTop: 16, fontSize: 12, color: '#94A3B8' }}>
          Status: {status?.paymentStatus ?? 'unknown'} · {status?.paymentIntentStatus ?? ''}
        </p>
      </div>
    </div>
  );
}
