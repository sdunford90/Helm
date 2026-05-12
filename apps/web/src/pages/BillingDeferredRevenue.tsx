import { useMemo } from 'react';
import { SubNav, BILLING_SUBNAV } from '@helm/ui-kit';
import { Clock4, TrendingUp, Wallet } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { formatCents, formatDateOnly } from '../lib/format';

const NAVY = '#0A2342';

interface Schedule {
  id: string;
  tenantId: string;
  invoiceLineItemId: string;
  totalCents: number;
  recognizedCents: number;
  startDate: string;
  endDate: string;
  status: string;
}

interface DeferredResponse {
  scheduleCount: number;
  totalDeferredCents: number;
  totalRecognizedCents: number;
  remainingCents: number;
  schedules: Schedule[];
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: '32px' },
  title: { fontSize: '36px', fontWeight: 700, color: NAVY, letterSpacing: '-0.02em', margin: 0 },
  divider: { height: '4px', background: 'linear-gradient(90deg, #00D4FF, transparent)', border: 'none', marginTop: '12px', marginBottom: '24px', borderRadius: '2px' },
  subtitle: { fontSize: '14px', color: '#64748B', margin: '0 0 24px', lineHeight: 1.55, maxWidth: '780px' },
  kpiGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '24px' },
  kpi: { background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '10px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' },
  kpiHead: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 },
  kpiIcon: { width: 32, height: 32, borderRadius: 8, background: 'rgba(0,212,255,0.10)', color: NAVY, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  kpiLabel: { fontSize: '12px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase' as const, letterSpacing: '0.05em' },
  kpiValue: { fontSize: '26px', fontWeight: 700, color: NAVY, fontVariantNumeric: 'tabular-nums' as const },
  kpiSub: { fontSize: '12px', color: '#94A3B8', marginTop: '6px' },
  tableWrap: { background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '10px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', overflow: 'hidden' },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 13 },
  th: { textAlign: 'left' as const, padding: '12px 16px', background: '#F8FAFC', fontWeight: 700, color: '#475569', fontSize: 11, textTransform: 'uppercase' as const, letterSpacing: '0.05em', borderBottom: '1px solid #E2E8F0' },
  td: { padding: '12px 16px', borderBottom: '1px solid #F1F5F9', color: NAVY, verticalAlign: 'middle' as const },
  tdRight: { textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const },
  bar: { height: 6, borderRadius: 999, background: '#E2E8F0', overflow: 'hidden', minWidth: 120 },
  barFill: { height: '100%', background: '#22C55E' },
  statusBadge: { display: 'inline-block', padding: '2px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' as const },
  empty: { padding: '48px', textAlign: 'center' as const, color: '#94A3B8', fontSize: 14 },
};

const STATUS_STYLE: Record<string, React.CSSProperties> = {
  ACTIVE: { background: '#DBEAFE', color: '#1E40AF' },
  COMPLETED: { background: '#DCFCE7', color: '#166534' },
  CANCELLED: { background: '#FEE2E2', color: '#991B1B' },
};

export default function BillingDeferredRevenue() {
  const { data, loading, error } = useApi<DeferredResponse>('get', '/api/reports/deferred-revenue', { immediate: true });

  const sortedSchedules = useMemo(() => {
    if (!data?.schedules) return [];
    return [...data.schedules].sort((a, b) =>
      new Date(b.startDate).getTime() - new Date(a.startDate).getTime(),
    );
  }, [data]);

  const recognitionPct = data && data.totalDeferredCents > 0
    ? data.totalRecognizedCents / data.totalDeferredCents
    : 0;

  return (
    <div style={styles.page}>
      <h1 style={styles.title} className="helm-page-title">Billing</h1>
      <hr style={styles.divider} />
      <SubNav items={BILLING_SUBNAV} />

      <p style={styles.subtitle}>
        Prepaid contract revenue that hasn't been recognized yet. Each schedule represents an invoice line item billed up front
        (a quarterly or annual slip fee, for example); the recognized amount is the portion that's already been booked to
        revenue through the recognition job.
      </p>

      {error && (
        <div style={{ padding: 16, background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#991B1B', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
          Failed to load deferred revenue: {error}
        </div>
      )}

      <div style={styles.kpiGrid}>
        <div style={styles.kpi}>
          <div style={styles.kpiHead}>
            <div style={styles.kpiIcon}><Wallet size={18} /></div>
            <div style={styles.kpiLabel}>Total Deferred</div>
          </div>
          <div style={styles.kpiValue}>{loading ? '…' : formatCents(data?.totalDeferredCents ?? 0)}</div>
          <div style={styles.kpiSub}>Across {data?.scheduleCount ?? 0} schedule{data?.scheduleCount === 1 ? '' : 's'}</div>
        </div>
        <div style={styles.kpi}>
          <div style={styles.kpiHead}>
            <div style={styles.kpiIcon}><TrendingUp size={18} /></div>
            <div style={styles.kpiLabel}>Recognized</div>
          </div>
          <div style={styles.kpiValue}>{loading ? '…' : formatCents(data?.totalRecognizedCents ?? 0)}</div>
          <div style={styles.kpiSub}>{Math.round(recognitionPct * 100)}% of total deferred</div>
        </div>
        <div style={styles.kpi}>
          <div style={styles.kpiHead}>
            <div style={styles.kpiIcon}><Clock4 size={18} /></div>
            <div style={styles.kpiLabel}>Remaining</div>
          </div>
          <div style={styles.kpiValue}>{loading ? '…' : formatCents(data?.remainingCents ?? 0)}</div>
          <div style={styles.kpiSub}>Yet to be recognized</div>
        </div>
      </div>

      <div style={styles.tableWrap}>
        {loading ? (
          <div style={styles.empty}>Loading schedules…</div>
        ) : sortedSchedules.length === 0 ? (
          <div style={styles.empty}>
            No deferred revenue schedules yet. They're created automatically when an invoice line item bills more than one
            recognition period up front (e.g. an annual slip contract).
          </div>
        ) : (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Period</th>
                <th style={styles.th}>Status</th>
                <th style={{ ...styles.th, ...styles.tdRight }}>Total</th>
                <th style={{ ...styles.th, ...styles.tdRight }}>Recognized</th>
                <th style={{ ...styles.th, ...styles.tdRight }}>Remaining</th>
                <th style={styles.th}>Progress</th>
              </tr>
            </thead>
            <tbody>
              {sortedSchedules.map((s) => {
                const remaining = s.totalCents - s.recognizedCents;
                const pct = s.totalCents > 0 ? s.recognizedCents / s.totalCents : 0;
                return (
                  <tr key={s.id}>
                    <td style={styles.td}>
                      <div style={{ fontWeight: 600 }}>{formatDateOnly(s.startDate)}</div>
                      <div style={{ fontSize: 12, color: '#64748B' }}>through {formatDateOnly(s.endDate)}</div>
                    </td>
                    <td style={styles.td}>
                      <span style={{ ...styles.statusBadge, ...(STATUS_STYLE[s.status] ?? { background: '#F1F5F9', color: '#475569' }) }}>
                        {s.status}
                      </span>
                    </td>
                    <td style={{ ...styles.td, ...styles.tdRight }}>{formatCents(s.totalCents)}</td>
                    <td style={{ ...styles.td, ...styles.tdRight, color: '#166534' }}>{formatCents(s.recognizedCents)}</td>
                    <td style={{ ...styles.td, ...styles.tdRight, color: '#64748B' }}>{formatCents(remaining)}</td>
                    <td style={styles.td}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={styles.bar}>
                          <div style={{ ...styles.barFill, width: `${Math.min(100, pct * 100)}%` }} />
                        </div>
                        <span style={{ fontSize: 12, color: '#64748B', minWidth: 36, textAlign: 'right' }}>
                          {Math.round(pct * 100)}%
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
