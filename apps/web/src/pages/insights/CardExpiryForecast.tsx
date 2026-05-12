import { useMemo, useState } from 'react';
import { CreditCard, Phone, Mail, Loader2, AlertCircle } from 'lucide-react';
import InsightsShell from './InsightsShell';
import { useApi } from '../../hooks/useApi';

const NAVY = '#0A2342';

interface Bucket {
  month: string;
  count: number;
}

interface CardItem {
  customerId: string;
  customerName: string;
  email: string | null;
  phone: string | null;
  brand: string | null;
  last4: string | null;
  expMonth: number;
  expYear: number;
  expiryLabel: string;
}

interface Forecast {
  within: number;
  totalCards: number;
  summary: Bucket[];
  items: CardItem[];
}

const styles: Record<string, React.CSSProperties> = {
  toolbar: { display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16, flexWrap: 'wrap' as const },
  toolbarLabel: { fontSize: 12, color: '#64748B', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.04em' },
  select: { padding: '6px 10px', border: '1px solid #CBD5E1', borderRadius: 6, fontSize: 13, color: NAVY, background: '#FFFFFF' },
  bucketRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginBottom: 24 },
  bucket: { background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 8, padding: '14px 16px' },
  bucketLabel: { fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase' as const, letterSpacing: '0.04em' },
  bucketValue: { fontSize: 24, fontWeight: 700, color: NAVY, marginTop: 4, fontVariantNumeric: 'tabular-nums' as const },
  card: { background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 10, boxShadow: '0 1px 3px rgba(0,0,0,0.04)', overflow: 'hidden' },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 13 },
  th: { textAlign: 'left' as const, padding: '12px 16px', background: '#F8FAFC', fontWeight: 700, color: '#475569', fontSize: 11, textTransform: 'uppercase' as const, letterSpacing: '0.04em', borderBottom: '1px solid #E2E8F0' },
  td: { padding: '12px 16px', borderBottom: '1px solid #F1F5F9', color: NAVY, verticalAlign: 'middle' as const },
  empty: { padding: 48, textAlign: 'center' as const, color: '#94A3B8', fontSize: 14 },
  err: { display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderRadius: 8, background: '#FEE2E2', color: '#991B1B', fontSize: 13, marginBottom: 16 },
  brandBadge: { display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700, background: '#F1F5F9', color: '#475569', textTransform: 'uppercase' as const },
  contactLink: { color: NAVY, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 },
};

export default function CardExpiryForecast() {
  const [within, setWithin] = useState(6);
  const { data, loading, error } = useApi<Forecast>(
    'get',
    `/api/reports/card-expiry-forecast?within=${within}`,
    { immediate: true },
  );

  const groupedItems = useMemo(() => {
    if (!data?.items) return new Map<string, CardItem[]>();
    const m = new Map<string, CardItem[]>();
    for (const it of data.items) {
      const arr = m.get(it.expiryLabel) ?? [];
      arr.push(it);
      m.set(it.expiryLabel, arr);
    }
    return m;
  }, [data]);

  return (
    <InsightsShell
      title="Card Expiry Forecast"
      subtitle="Saved cards that expire in the upcoming months. Drives proactive outreach so autopay doesn't fail at the worst time."
    >
      <div style={styles.toolbar}>
        <span style={styles.toolbarLabel}>Looking ahead</span>
        <select
          style={styles.select}
          value={within}
          onChange={(e) => setWithin(Number(e.target.value))}
        >
          <option value={3}>3 months</option>
          <option value={6}>6 months</option>
          <option value={12}>12 months</option>
          <option value={24}>24 months</option>
        </select>
        {data && (
          <span style={{ fontSize: 13, color: '#64748B' }}>
            <strong style={{ color: NAVY }}>{data.totalCards}</strong> card{data.totalCards === 1 ? '' : 's'} expiring
          </span>
        )}
      </div>

      {error && (
        <div style={styles.err}><AlertCircle size={16} /> {error}</div>
      )}

      {loading && !data ? (
        <div style={styles.empty}><Loader2 size={20} /></div>
      ) : data && data.totalCards === 0 ? (
        <div style={styles.card}>
          <div style={styles.empty}>
            No saved cards expire in the next {within} month{within === 1 ? '' : 's'}.
          </div>
        </div>
      ) : data ? (
        <>
          <div style={styles.bucketRow}>
            {data.summary.map((b) => (
              <div key={b.month} style={styles.bucket}>
                <div style={styles.bucketLabel}>{b.month}</div>
                <div style={styles.bucketValue}>{b.count}</div>
              </div>
            ))}
          </div>

          <div style={styles.card}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Expires</th>
                  <th style={styles.th}>Customer</th>
                  <th style={styles.th}>Card</th>
                  <th style={styles.th}>Contact</th>
                </tr>
              </thead>
              <tbody>
                {Array.from(groupedItems.entries()).map(([month, items]) => (
                  items.map((it, idx) => (
                    <tr key={`${month}-${it.customerId}-${idx}`}>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap' as const, fontWeight: idx === 0 ? 700 : 400, color: idx === 0 ? NAVY : 'transparent' }}>
                        {idx === 0 ? month : '·'}
                      </td>
                      <td style={styles.td}>
                        <div style={{ fontWeight: 600 }}>{it.customerName}</div>
                      </td>
                      <td style={styles.td}>
                        <span style={styles.brandBadge}>{it.brand ?? '—'}</span>
                        <span style={{ marginLeft: 8, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: '#64748B' }}>
                          •••• {it.last4 ?? '—'}
                        </span>
                      </td>
                      <td style={styles.td}>
                        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' as const }}>
                          {it.email && (
                            <a href={`mailto:${it.email}`} style={styles.contactLink}>
                              <Mail size={12} /> {it.email}
                            </a>
                          )}
                          {it.phone && (
                            <a href={`tel:${it.phone}`} style={styles.contactLink}>
                              <Phone size={12} /> {it.phone}
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <CreditCard size={12} />
            Data refreshes daily from the card-expiry reminder sweep. Cards already expired are excluded.
          </div>
        </>
      ) : null}
    </InsightsShell>
  );
}
