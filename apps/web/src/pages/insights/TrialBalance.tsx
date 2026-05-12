import { useMemo, useState } from 'react';
import { Scale, AlertCircle, Loader2 } from 'lucide-react';
import InsightsShell from './InsightsShell';
import { useApi } from '../../hooks/useApi';
import { formatCents } from '../../lib/format';

const NAVY = '#0A2342';

interface Account {
  accountNumber: string;
  name: string;
  type: string;
  debitsCents: number;
  creditsCents: number;
  netCents: number;
}

interface GlSummary {
  period: { startDate: string; endDate: string };
  accounts: Account[];
}

const TYPE_ORDER: Record<string, number> = {
  ASSET: 1, LIABILITY: 2, EQUITY: 3, REVENUE: 4, EXPENSE: 5,
};

const TYPE_TONE: Record<string, React.CSSProperties> = {
  ASSET: { background: '#DBEAFE', color: '#1E40AF' },
  LIABILITY: { background: '#FFEDD5', color: '#9A3412' },
  EQUITY: { background: '#FAF5FF', color: '#7E22CE' },
  REVENUE: { background: '#DCFCE7', color: '#166534' },
  EXPENSE: { background: '#FEE2E2', color: '#991B1B' },
};

const styles: Record<string, React.CSSProperties> = {
  toolbar: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' as const },
  toolbarLabel: { fontSize: 12, color: '#64748B', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.04em' },
  input: { padding: '6px 10px', border: '1px solid #CBD5E1', borderRadius: 6, fontSize: 13, color: NAVY, background: '#FFFFFF' },
  totalsRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 24 },
  totalCard: { background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 8, padding: '14px 16px' },
  totalLabel: { fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase' as const, letterSpacing: '0.04em' },
  totalValue: { fontSize: 22, fontWeight: 700, color: NAVY, marginTop: 4, fontVariantNumeric: 'tabular-nums' as const },
  card: { background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 10, boxShadow: '0 1px 3px rgba(0,0,0,0.04)', overflow: 'hidden' },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 13 },
  th: { textAlign: 'left' as const, padding: '12px 16px', background: '#F8FAFC', fontWeight: 700, color: '#475569', fontSize: 11, textTransform: 'uppercase' as const, letterSpacing: '0.04em', borderBottom: '1px solid #E2E8F0' },
  thRight: { textAlign: 'right' as const },
  td: { padding: '11px 16px', borderBottom: '1px solid #F1F5F9', color: NAVY, verticalAlign: 'middle' as const },
  tdRight: { textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const },
  typeBadge: { display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.04em' },
  groupHead: { fontSize: 12, fontWeight: 700, color: '#475569', padding: '14px 16px 6px', background: '#FAFBFC', textTransform: 'uppercase' as const, letterSpacing: '0.05em', borderBottom: '1px solid #E2E8F0' },
  totalRow: { background: '#0A2342', color: '#FFFFFF', fontWeight: 700 },
  empty: { padding: 48, textAlign: 'center' as const, color: '#94A3B8', fontSize: 14 },
  err: { display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderRadius: 8, background: '#FEE2E2', color: '#991B1B', fontSize: 13, marginBottom: 16 },
  balanceCheck: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, marginTop: 16 },
  balanced: { background: '#DCFCE7', color: '#166534' },
  unbalanced: { background: '#FEE2E2', color: '#991B1B' },
};

function defaultStart(): string {
  // First day of the current year.
  return `${new Date().getFullYear()}-01-01`;
}
function defaultEnd(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function TrialBalance() {
  const [startDate, setStartDate] = useState(defaultStart());
  const [endDate, setEndDate] = useState(defaultEnd());

  const path = `/api/reports/gl-summary?startDate=${startDate}&endDate=${endDate}`;
  const { data, loading, error } = useApi<GlSummary>('get', path, { immediate: true });

  const grouped = useMemo(() => {
    if (!data?.accounts) return [];
    const byType = new Map<string, Account[]>();
    for (const a of data.accounts) {
      const arr = byType.get(a.type) ?? [];
      arr.push(a);
      byType.set(a.type, arr);
    }
    const types = Array.from(byType.keys()).sort(
      (a, b) => (TYPE_ORDER[a] ?? 99) - (TYPE_ORDER[b] ?? 99),
    );
    return types.map((t) => ({
      type: t,
      accounts: (byType.get(t) ?? []).sort((a, b) => a.accountNumber.localeCompare(b.accountNumber)),
    }));
  }, [data]);

  const totals = useMemo(() => {
    if (!data?.accounts) return { debits: 0, credits: 0 };
    let d = 0, c = 0;
    for (const a of data.accounts) { d += a.debitsCents; c += a.creditsCents; }
    return { debits: d, credits: c };
  }, [data]);

  const balanced = totals.debits === totals.credits;
  const diff = totals.debits - totals.credits;

  return (
    <InsightsShell
      title="Trial Balance"
      subtitle="Period debits, credits, and net per GL account. The trial-balance check at the bottom confirms total debits equal total credits — a foundational close-readiness signal."
    >
      <div style={styles.toolbar}>
        <span style={styles.toolbarLabel}>From</span>
        <input type="date" style={styles.input} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        <span style={styles.toolbarLabel}>Through</span>
        <input type="date" style={styles.input} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
      </div>

      {error && (
        <div style={styles.err}><AlertCircle size={16} /> {error}</div>
      )}

      {loading && !data ? (
        <div style={styles.empty}><Loader2 size={20} /></div>
      ) : data && data.accounts.length === 0 ? (
        <div style={styles.card}>
          <div style={styles.empty}>
            No GL activity in this period. Try widening the date range.
          </div>
        </div>
      ) : data ? (
        <>
          <div style={styles.totalsRow}>
            <div style={styles.totalCard}>
              <div style={styles.totalLabel}>Total Debits</div>
              <div style={styles.totalValue}>{formatCents(totals.debits)}</div>
            </div>
            <div style={styles.totalCard}>
              <div style={styles.totalLabel}>Total Credits</div>
              <div style={styles.totalValue}>{formatCents(totals.credits)}</div>
            </div>
            <div style={styles.totalCard}>
              <div style={styles.totalLabel}>Variance</div>
              <div style={{ ...styles.totalValue, color: balanced ? '#166534' : '#991B1B' }}>
                {formatCents(diff)}
              </div>
            </div>
          </div>

          <div style={styles.card}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={{ ...styles.th, width: 110 }}>Account</th>
                  <th style={styles.th}>Name</th>
                  <th style={{ ...styles.th, width: 90 }}>Type</th>
                  <th style={{ ...styles.th, ...styles.thRight, width: 140 }}>Debits</th>
                  <th style={{ ...styles.th, ...styles.thRight, width: 140 }}>Credits</th>
                  <th style={{ ...styles.th, ...styles.thRight, width: 140 }}>Net</th>
                </tr>
              </thead>
              <tbody>
                {grouped.map((g) => (
                  <>
                    <tr key={`hdr-${g.type}`}>
                      <td colSpan={6} style={styles.groupHead}>{g.type}</td>
                    </tr>
                    {g.accounts.map((a) => (
                      <tr key={a.accountNumber}>
                        <td style={{ ...styles.td, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontWeight: 600 }}>
                          {a.accountNumber}
                        </td>
                        <td style={styles.td}>{a.name}</td>
                        <td style={styles.td}>
                          <span style={{ ...styles.typeBadge, ...(TYPE_TONE[a.type] ?? { background: '#F1F5F9', color: '#475569' }) }}>
                            {a.type}
                          </span>
                        </td>
                        <td style={{ ...styles.td, ...styles.tdRight }}>{formatCents(a.debitsCents)}</td>
                        <td style={{ ...styles.td, ...styles.tdRight }}>{formatCents(a.creditsCents)}</td>
                        <td style={{ ...styles.td, ...styles.tdRight, color: a.netCents < 0 ? '#991B1B' : NAVY }}>
                          {formatCents(a.netCents)}
                        </td>
                      </tr>
                    ))}
                  </>
                ))}
                <tr style={styles.totalRow}>
                  <td style={{ ...styles.td, color: '#FFFFFF' }} colSpan={3}>
                    TOTAL
                  </td>
                  <td style={{ ...styles.td, ...styles.tdRight, color: '#FFFFFF' }}>
                    {formatCents(totals.debits)}
                  </td>
                  <td style={{ ...styles.td, ...styles.tdRight, color: '#FFFFFF' }}>
                    {formatCents(totals.credits)}
                  </td>
                  <td style={{ ...styles.td, ...styles.tdRight, color: '#FFFFFF' }}>
                    {formatCents(diff)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div style={{ ...styles.balanceCheck, ...(balanced ? styles.balanced : styles.unbalanced) }}>
            <Scale size={16} />
            {balanced
              ? 'Trial balance — debits equal credits.'
              : `Out of balance by ${formatCents(Math.abs(diff))}. Investigate unposted entries.`}
          </div>
        </>
      ) : null}
    </InsightsShell>
  );
}
