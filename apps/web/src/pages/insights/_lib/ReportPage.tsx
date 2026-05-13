import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlertCircle, Loader2, Download } from 'lucide-react';
import InsightsShell from '../InsightsShell';
import { useApi } from '../../../hooks/useApi';

// Shared report-page primitive for the Insights surface.
//
// Each Phase-5 report file builds an instance of this: it owns the date-range
// state, the fetch lifecycle, the standard error/loading chrome, the KPI
// strip, and the export-CSV affordance. Report-specific rendering happens in
// the `render` prop (gets the typed payload back).

const NAVY = '#0A2342';

interface DateRange { startDate: string; endDate: string; }

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
function isoNDaysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

export const styles: Record<string, React.CSSProperties> = {
  toolbar: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' as const },
  toolbarLabel: {
    fontSize: 12, color: '#64748B', fontWeight: 600,
    textTransform: 'uppercase' as const, letterSpacing: '0.04em',
  },
  input: { padding: '6px 10px', border: '1px solid #CBD5E1', borderRadius: 6, fontSize: 13, color: NAVY, background: '#FFFFFF' },
  exportBtn: {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '6px 12px', border: '1px solid #CBD5E1', borderRadius: 6,
    fontSize: 12, fontWeight: 600, color: NAVY, background: '#FFFFFF', cursor: 'pointer',
  },
  err: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '12px 14px', borderRadius: 8, background: '#FEE2E2',
    color: '#991B1B', fontSize: 13, marginBottom: 16,
  },
  empty: { padding: 48, textAlign: 'center' as const, color: '#94A3B8', fontSize: 14 },
  kpiRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 20 },
  kpiCard: { background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 8, padding: '14px 16px' },
  kpiLabel: { fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase' as const, letterSpacing: '0.04em' },
  kpiValue: { fontSize: 24, fontWeight: 700, color: NAVY, marginTop: 4, fontVariantNumeric: 'tabular-nums' as const },
  kpiSub: { fontSize: 11, color: '#94A3B8', marginTop: 2 },
  card: { background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 13 },
  th: {
    textAlign: 'left' as const, padding: '12px 16px', background: '#F8FAFC',
    fontWeight: 700, color: '#475569', fontSize: 11,
    textTransform: 'uppercase' as const, letterSpacing: '0.04em',
    borderBottom: '1px solid #E2E8F0',
  },
  td: { padding: '12px 16px', borderBottom: '1px solid #F1F5F9', color: NAVY, verticalAlign: 'middle' as const },
  sectionTitle: { fontSize: 14, fontWeight: 700, color: NAVY, margin: '24px 0 12px', textTransform: 'uppercase' as const, letterSpacing: '0.04em' },
};

export interface KpiTileProps {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  accent?: string;
}

export function KpiTile({ label, value, sub, accent = NAVY }: KpiTileProps) {
  return (
    <div style={styles.kpiCard}>
      <div style={styles.kpiLabel}>{label}</div>
      <div style={{ ...styles.kpiValue, color: accent }}>{value}</div>
      {sub && <div style={styles.kpiSub}>{sub}</div>}
    </div>
  );
}

export interface ReportPageProps<TData> {
  title: string;
  subtitle?: string;
  /** Path on the API, *without* date params — those get appended automatically. */
  apiPath: string;
  /** Pass `false` to hide the date range picker for reports that don't accept one. */
  enableDateRange?: boolean;
  /** Default range; defaults to last 30 days. */
  defaultRange?: DateRange;
  /** Optional CSV export href (a separate endpoint or a query flag). */
  csvHref?: (range: DateRange) => string;
  render: (data: TData, range: DateRange) => ReactNode;
}

export function ReportPage<TData>({
  title,
  subtitle,
  apiPath,
  enableDateRange = true,
  defaultRange,
  csvHref,
  render,
}: ReportPageProps<TData>) {
  const [range, setRange] = useState<DateRange>(() => defaultRange ?? {
    startDate: isoNDaysAgo(30),
    endDate: todayIso(),
  });

  const url = useMemo(() => {
    if (!enableDateRange) return apiPath;
    const sep = apiPath.includes('?') ? '&' : '?';
    return `${apiPath}${sep}startDate=${range.startDate}&endDate=${range.endDate}`;
  }, [apiPath, enableDateRange, range.startDate, range.endDate]);

  const { data, loading, error, execute } = useApi<TData>('get', url, { immediate: false });

  useEffect(() => {
    execute().catch(() => { /* surfaced via state */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  return (
    <InsightsShell title={title} subtitle={subtitle}>
      <div style={styles.toolbar}>
        {enableDateRange && (
          <>
            <span style={styles.toolbarLabel}>From</span>
            <input
              type="date"
              value={range.startDate}
              max={range.endDate}
              style={styles.input}
              onChange={(e) => setRange((r) => ({ ...r, startDate: e.target.value }))}
            />
            <span style={styles.toolbarLabel}>To</span>
            <input
              type="date"
              value={range.endDate}
              min={range.startDate}
              max={todayIso()}
              style={styles.input}
              onChange={(e) => setRange((r) => ({ ...r, endDate: e.target.value }))}
            />
          </>
        )}
        {csvHref && (
          <a href={csvHref(range)} style={styles.exportBtn} download>
            <Download size={14} /> Export CSV
          </a>
        )}
      </div>

      {error && (
        <div style={styles.err}><AlertCircle size={16} /> {error}</div>
      )}

      {loading && !data ? (
        <div style={styles.empty}><Loader2 size={20} /></div>
      ) : data ? (
        render(data, range)
      ) : null}
    </InsightsShell>
  );
}
