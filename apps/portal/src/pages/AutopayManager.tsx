import { CSSProperties, useEffect, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { CreditCard, Calendar, AlertCircle, Loader2, ToggleLeft, ToggleRight } from 'lucide-react';
import { formatCents, formatDate } from '../lib/api';

// P10 — Autopay management. Surfaces autopay state, the default payment
// method, a warning if the card is expired, and a projected list of
// upcoming auto-pay charges for the next 60 days so a slip-holder
// can plan ahead.

const NAVY = '#0A2342';

interface UpcomingCharge {
  contractId: string;
  slipNumber: string | null;
  amountCents: number;
  chargeDate: string;
  billingCycle: string;
}

interface UpcomingResponse {
  horizonDays: number;
  totalCents: number;
  items: UpcomingCharge[];
}

const styles: Record<string, CSSProperties> = {
  page: { padding: 32, maxWidth: 900 },
  title: { fontSize: 32, fontWeight: 700, color: NAVY, margin: 0, letterSpacing: '-0.02em' },
  subtitle: { fontSize: 14, color: '#64748B', marginTop: 6, maxWidth: 720 },
  divider: { height: 4, background: 'linear-gradient(90deg, #00D4FF, transparent)', border: 'none', marginTop: 16, marginBottom: 24, borderRadius: 2 },
  card: { background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.04)', padding: 24, marginBottom: 16 },
  row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, marginBottom: 14 },
  toggleBtn: { display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 18px', fontSize: 14, fontWeight: 700, color: '#FFFFFF', background: NAVY, border: 'none', borderRadius: 8, cursor: 'pointer' },
  statusLabel: { fontSize: 13, fontWeight: 700, padding: '4px 10px', borderRadius: 999 },
  statusOn: { background: '#DCFCE7', color: '#166534' },
  statusOff: { background: '#F1F5F9', color: '#64748B' },
  warning: { display: 'flex', alignItems: 'center', gap: 10, padding: 14, background: '#FEF3C7', color: '#92400E', borderRadius: 8, fontSize: 13, marginTop: 12 },
  sectionLabel: { fontSize: 12, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 },
  upcomingRow: { display: 'grid', gridTemplateColumns: '90px 1fr 120px', gap: 14, alignItems: 'center', padding: '12px 0', borderBottom: '1px solid #F1F5F9', fontSize: 14 },
  empty: { padding: 32, textAlign: 'center', color: '#94A3B8', fontSize: 13 },
  loading: { padding: 32, textAlign: 'center', color: '#94A3B8' },
};

export default function AutopayManager() {
  const { getToken } = useAuth();
  const [autopay, setAutopay] = useState<boolean | null>(null);
  const [upcoming, setUpcoming] = useState<UpcomingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function loadAll() {
    try {
      const token = await getToken();
      const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
      const [apRes, upRes] = await Promise.all([
        fetch('/api/portal/autopay', { headers }),
        fetch('/api/portal/autopay/upcoming?days=60', { headers }),
      ]);
      if (!apRes.ok) throw new Error(`Autopay status (${apRes.status})`);
      if (!upRes.ok) throw new Error(`Upcoming charges (${upRes.status})`);
      const ap = await apRes.json();
      const up = await upRes.json();
      setAutopay(!!ap.autopay);
      setUpcoming(up);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => { void loadAll(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function toggle() {
    if (autopay === null || busy) return;
    setBusy(true);
    try {
      const token = await getToken();
      const res = await fetch('/api/portal/autopay', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ autopay: !autopay }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Toggle failed (${res.status})`);
      }
      const body = await res.json();
      setAutopay(!!body.autopay);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Toggle failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={styles.page}>
      <h1 style={styles.title}>Auto-pay</h1>
      <div style={styles.subtitle}>
        Charge your default card automatically when an invoice is issued. The marina can still pause
        autopay on individual invoices when needed.
      </div>
      <hr style={styles.divider} />

      {error && (
        <div style={styles.warning}><AlertCircle size={16} /> {error}</div>
      )}

      <div style={styles.card}>
        <div style={styles.row}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <CreditCard size={20} color={NAVY} />
              <span style={{ fontSize: 16, fontWeight: 700, color: NAVY }}>Auto-pay</span>
              {autopay !== null && (
                <span style={{ ...styles.statusLabel, ...(autopay ? styles.statusOn : styles.statusOff) }}>
                  {autopay ? 'ON' : 'OFF'}
                </span>
              )}
            </div>
            <div style={{ fontSize: 13, color: '#64748B', marginTop: 6 }}>
              Your default card is charged for new dockage invoices the day they're issued.
              Update or change cards under <a href="/payments" style={{ color: NAVY, fontWeight: 600 }}>Payment Methods</a>.
            </div>
          </div>
          <button
            style={{ ...styles.toggleBtn, opacity: autopay === null || busy ? 0.5 : 1 }}
            disabled={autopay === null || busy}
            onClick={toggle}
          >
            {busy ? <Loader2 size={14} /> : autopay ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
            {autopay ? 'Turn off' : 'Turn on'}
          </button>
        </div>
      </div>

      <div style={styles.card}>
        <div style={styles.sectionLabel}>
          <Calendar size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />
          Upcoming charges (next 60 days)
        </div>
        {upcoming === null ? (
          <div style={styles.loading}><Loader2 size={20} /></div>
        ) : upcoming.items.length === 0 ? (
          <div style={styles.empty}>
            No projected charges in the next 60 days based on your active dockage contracts.
          </div>
        ) : (
          <>
            <div style={{ ...styles.upcomingRow, fontWeight: 700, color: '#475569', fontSize: 11, textTransform: 'uppercase' as const, letterSpacing: '0.04em', borderBottom: '1px solid #E2E8F0', padding: '8px 0' }}>
              <span>Date</span>
              <span>For</span>
              <span style={{ textAlign: 'right' }}>Amount</span>
            </div>
            {upcoming.items.map((it, idx) => (
              <div key={idx} style={styles.upcomingRow}>
                <span style={{ fontWeight: 600 }}>{formatDate(it.chargeDate)}</span>
                <span>Slip {it.slipNumber ?? '—'} <span style={{ color: '#94A3B8', fontSize: 12 }}>· {it.billingCycle.toLowerCase()}</span></span>
                <span style={{ textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const, fontWeight: 600 }}>
                  {formatCents(it.amountCents)}
                </span>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 16, marginTop: 4, fontWeight: 700, color: NAVY, borderTop: '2px solid #E2E8F0', fontSize: 15 }}>
              <span>Total projected</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' as const }}>{formatCents(upcoming.totalCents)}</span>
            </div>
          </>
        )}
        <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 12 }}>
          Projection based on your active dockage contracts and their billing cadence. Actual invoices may differ.
        </div>
      </div>
    </div>
  );
}
