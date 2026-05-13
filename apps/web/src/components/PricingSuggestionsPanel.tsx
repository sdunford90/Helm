// Plan 14 — Surface algorithmic pricing suggestions to operators.
//
// The cron at `cron-algorithmic-pricing` writes `AlgorithmicSuggestion` rows
// every Sunday with proposed rate changes for each rental pricing rule.
// Until now the rows existed but no UI consumed them. This panel lists
// every PENDING suggestion and lets a manager accept (push the new rate
// onto the pricing rule) or ignore (mark IGNORED so it stops surfacing).

import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { api } from '../lib/api';
import { formatCents, formatDate } from '../lib/format';

interface Suggestion {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'IGNORED';
  pricingRuleId: string | null;
  pricingRule: { id: string; name: string; type: string } | null;
  currentPriceCents: number;
  suggestedPriceCents: number;
  reason: string | null;
  confidenceScore: number | null;
  createdAt: string;
}

const NAVY = '#0A2342';

const styles: Record<string, React.CSSProperties> = {
  card: {
    background: '#FFFFFF',
    border: '1px solid #E2E8F0',
    borderRadius: 10,
    padding: 16,
  },
  headerRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  title: { fontSize: 16, fontWeight: 700, color: NAVY, margin: 0 },
  subtitle: { fontSize: 12, color: '#64748B', margin: 0 },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 13 },
  th: {
    textAlign: 'left' as const, padding: '10px 12px',
    fontSize: 11, fontWeight: 700, color: '#475569',
    textTransform: 'uppercase' as const, letterSpacing: '0.04em',
    borderBottom: '1px solid #E2E8F0',
  },
  td: { padding: '10px 12px', borderBottom: '1px solid #F1F5F9', color: NAVY, verticalAlign: 'middle' as const },
  acceptBtn: {
    background: '#166534', color: '#FFF', border: 0, borderRadius: 6,
    padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
  },
  ignoreBtn: {
    background: '#FFFFFF', color: '#475569', border: '1px solid #CBD5E1', borderRadius: 6,
    padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', marginLeft: 6,
  },
  empty: { padding: 24, textAlign: 'center' as const, color: '#94A3B8', fontSize: 13 },
  badge: {
    display: 'inline-block', padding: '2px 8px', borderRadius: 999,
    fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase' as const,
  },
};

export default function PricingSuggestionsPanel() {
  const { getToken } = useAuth();
  const [data, setData] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await api.get<{ data: Suggestion[] }>('/api/rentals/pricing/suggestions', token);
      setData(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);

  const apply = async (id: string, action: 'ACCEPTED' | 'REJECTED') => {
    setBusyId(id);
    try {
      const token = await getToken();
      await api.put(`/api/rentals/pricing/suggestions/${id}`, { action }, token);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const pending = data.filter((s) => s.status === 'PENDING');

  return (
    <div style={styles.card}>
      <div style={styles.headerRow}>
        <div>
          <h3 style={styles.title}>Pricing suggestions</h3>
          <p style={styles.subtitle}>
            {pending.length === 0
              ? 'No pending suggestions right now. The algorithm runs every Sunday at midnight.'
              : `${pending.length} pending suggestion${pending.length === 1 ? '' : 's'} — review and apply.`}
          </p>
        </div>
        <button style={styles.ignoreBtn} onClick={load} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div style={{ padding: 12, background: '#FEE2E2', color: '#991B1B', borderRadius: 8, fontSize: 12, marginBottom: 12 }}>
          {error}
        </div>
      )}

      {!loading && pending.length === 0 && !error && (
        <div style={styles.empty}>Nothing to review.</div>
      )}

      {pending.length > 0 && (
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Rule</th>
              <th style={styles.th}>Current</th>
              <th style={styles.th}>Suggested</th>
              <th style={styles.th}>Δ</th>
              <th style={styles.th}>Reason</th>
              <th style={styles.th}>When</th>
              <th style={styles.th}></th>
            </tr>
          </thead>
          <tbody>
            {pending.map((s) => {
              const delta = s.suggestedPriceCents - s.currentPriceCents;
              const deltaPct = s.currentPriceCents > 0 ? (delta / s.currentPriceCents) * 100 : 0;
              const up = delta > 0;
              return (
                <tr key={s.id}>
                  <td style={{ ...styles.td, fontWeight: 600 }}>
                    {s.pricingRule?.name ?? '(unattached rule)'}
                    {s.pricingRule?.type && (
                      <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>{s.pricingRule.type}</div>
                    )}
                  </td>
                  <td style={styles.td}>{formatCents(s.currentPriceCents)}</td>
                  <td style={{ ...styles.td, fontWeight: 600 }}>{formatCents(s.suggestedPriceCents)}</td>
                  <td style={{ ...styles.td, color: up ? '#166534' : '#B71C1C', fontWeight: 600 }}>
                    {up ? '+' : ''}{formatCents(delta)} ({deltaPct.toFixed(1)}%)
                  </td>
                  <td style={{ ...styles.td, fontSize: 12, color: '#64748B', maxWidth: 360 }}>
                    {s.reason ?? '—'}
                    {s.confidenceScore !== null && (
                      <span style={{ ...styles.badge, background: '#F1F5F9', color: '#475569', marginLeft: 6 }}>
                        {Math.round(s.confidenceScore * 100)}% conf
                      </span>
                    )}
                  </td>
                  <td style={{ ...styles.td, fontSize: 12, color: '#64748B' }}>{formatDate(s.createdAt)}</td>
                  <td style={{ ...styles.td, textAlign: 'right' as const, whiteSpace: 'nowrap' as const }}>
                    <button
                      style={styles.acceptBtn}
                      disabled={busyId === s.id}
                      onClick={() => apply(s.id, 'ACCEPTED')}
                    >
                      Accept
                    </button>
                    <button
                      style={styles.ignoreBtn}
                      disabled={busyId === s.id}
                      onClick={() => apply(s.id, 'REJECTED')}
                    >
                      Ignore
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
