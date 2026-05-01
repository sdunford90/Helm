import { useState } from 'react';
import { Download, Loader2, AlertCircle } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { formatCents } from '../lib/format';
import { useModules } from '../context/ModulesContext';

const NAVY = '#0A2342';

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 32 },
  title: { fontSize: 36, fontWeight: 700, color: NAVY, letterSpacing: '-0.02em', margin: 0 },
  divider: { height: 4, background: 'linear-gradient(90deg, #00D4FF, transparent)', border: 'none', marginTop: 12, marginBottom: 32, borderRadius: 2 },
  filterBar: { display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' as const, marginBottom: 28 },
  label: { display: 'block', fontSize: 12, fontWeight: 600, color: '#2E4A6B', marginBottom: 4 },
  input: { padding: '8px 12px', borderRadius: 6, border: '1px solid #CBD5E1', fontSize: 13, color: NAVY },
  primaryBtn: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 18px', fontSize: 13, fontWeight: 600, color: '#fff', backgroundColor: NAVY, border: 'none', borderRadius: 6, cursor: 'pointer' },
  secondaryBtn: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 18px', fontSize: 13, fontWeight: 600, color: NAVY, backgroundColor: '#fff', border: `1px solid ${NAVY}`, borderRadius: 6, cursor: 'pointer' },
  statGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 28 },
  statCard: { background: '#fff', border: '1px solid #E2E8F0', borderRadius: 8, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' },
  statLabel: { fontSize: 12, fontWeight: 600, color: '#2E4A6B', textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: 6 },
  statValue: { fontSize: 24, fontWeight: 700, color: NAVY, fontFamily: '"JetBrains Mono", monospace' },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 14, background: '#fff', border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden' },
  th: { textAlign: 'left' as const, padding: '12px 16px', background: '#F8FAFC', fontWeight: 600, color: '#2E4A6B', borderBottom: '1px solid #E2E8F0', fontSize: 12, textTransform: 'uppercase' as const, letterSpacing: '0.05em' },
  td: { padding: '12px 16px', borderBottom: '1px solid #F1F5F9', color: NAVY },
  tdMono: { padding: '12px 16px', borderBottom: '1px solid #F1F5F9', color: NAVY, fontFamily: '"JetBrains Mono", monospace', textAlign: 'right' as const },
  badge: { display: 'inline-block', padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.04em' },
  totalRow: { background: '#F8FAFC', fontWeight: 700 },
  emptyState: { textAlign: 'center' as const, padding: '60px 20px', color: '#94A3B8', fontSize: 14 },
  errorBox: { display: 'flex', alignItems: 'center', gap: 8, padding: 16, borderRadius: 8, background: '#FEF2F2', color: '#DC2626', fontSize: 14, marginBottom: 16 },
};

type Kind = 'STATE' | 'COUNTY' | 'CITY' | 'SPECIAL';

const KIND_COLORS: Record<Kind, { bg: string; color: string }> = {
  STATE:   { bg: '#EFF6FF', color: '#1D4ED8' },
  COUNTY:  { bg: '#F0FDF4', color: '#166534' },
  CITY:    { bg: '#FFF7ED', color: '#C2410C' },
  SPECIAL: { bg: '#FAF5FF', color: '#7E22CE' },
};

interface JurisdictionSummary {
  jurisdictionId: string;
  code: string;
  name: string;
  kind: Kind;
  invoiceCount: number;
  taxableCents: number;
  taxCents: number;
}

interface SalesTaxReport {
  startDate: string;
  endDate: string;
  totalInvoices: number;
  totalTaxableCents: number;
  totalTaxCents: number;
  jurisdictions: JurisdictionSummary[];
}

function fmtIsoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function effectiveRate(j: JurisdictionSummary) {
  if (j.taxableCents === 0) return '—';
  return ((j.taxCents / j.taxableCents) * 100).toFixed(3) + '%';
}

export default function ReportsSalesTax() {
  const { currentLocationId } = useModules();
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [startDate, setStartDate] = useState(fmtIsoDate(firstOfMonth));
  const [endDate, setEndDate] = useState(fmtIsoDate(now));

  const report = useApi<SalesTaxReport>('get', '/api/reports/sales-tax');

  const handleRun = () => {
    const query: Record<string, string> = { startDate, endDate };
    if (currentLocationId) query.locationId = currentLocationId;
    report.execute({ query });
  };

  const handleExportCsv = () => {
    const data = report.data;
    if (!data) return;

    const rows = [
      ['Jurisdiction Code', 'Name', 'Type', 'Invoice Count', 'Taxable Amount', 'Tax Collected', 'Effective Rate'],
      ...data.jurisdictions.map(j => [
        j.code,
        j.name,
        j.kind,
        j.invoiceCount.toString(),
        (j.taxableCents / 100).toFixed(2),
        (j.taxCents / 100).toFixed(2),
        effectiveRate(j),
      ]),
      ['TOTAL', '', '', data.totalInvoices.toString(), (data.totalTaxableCents / 100).toFixed(2), (data.totalTaxCents / 100).toFixed(2), ''],
    ];

    const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sales-tax-${startDate}-to-${endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={styles.page}>
      <h1 style={styles.title}>Sales Tax Report</h1>
      <hr style={styles.divider} />

      <div style={styles.filterBar}>
        <div>
          <label style={styles.label}>Start Date</label>
          <input style={styles.input} type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
        </div>
        <div>
          <label style={styles.label}>End Date</label>
          <input style={styles.input} type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
        </div>
        <button style={styles.primaryBtn} onClick={handleRun} disabled={report.loading}>
          {report.loading ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : null}
          Run Report
        </button>
        {report.data && (
          <button style={styles.secondaryBtn} onClick={handleExportCsv}>
            <Download size={14} /> Export CSV
          </button>
        )}
      </div>

      {report.error && (
        <div style={styles.errorBox}>
          <AlertCircle size={16} /> {report.error}
        </div>
      )}

      {report.data && (
        <>
          <div style={styles.statGrid}>
            <div style={styles.statCard}>
              <div style={styles.statLabel}>Invoices</div>
              <div style={styles.statValue}>{report.data.totalInvoices.toLocaleString()}</div>
            </div>
            <div style={styles.statCard}>
              <div style={styles.statLabel}>Taxable Sales</div>
              <div style={styles.statValue}>{formatCents(report.data.totalTaxableCents)}</div>
            </div>
            <div style={styles.statCard}>
              <div style={styles.statLabel}>Tax Collected</div>
              <div style={styles.statValue}>{formatCents(report.data.totalTaxCents)}</div>
            </div>
            <div style={styles.statCard}>
              <div style={styles.statLabel}>Jurisdictions</div>
              <div style={styles.statValue}>{report.data.jurisdictions.length}</div>
            </div>
          </div>

          {report.data.jurisdictions.length === 0 ? (
            <div style={styles.emptyState}>No tax data found for this period.</div>
          ) : (
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Type</th>
                  <th style={styles.th}>Code</th>
                  <th style={styles.th}>Jurisdiction</th>
                  <th style={{ ...styles.th, textAlign: 'right' }}>Invoices</th>
                  <th style={{ ...styles.th, textAlign: 'right' }}>Taxable Sales</th>
                  <th style={{ ...styles.th, textAlign: 'right' }}>Tax Collected</th>
                  <th style={{ ...styles.th, textAlign: 'right' }}>Eff. Rate</th>
                </tr>
              </thead>
              <tbody>
                {report.data.jurisdictions.map(j => {
                  const colors = KIND_COLORS[j.kind] ?? KIND_COLORS.SPECIAL;
                  return (
                    <tr key={j.jurisdictionId}>
                      <td style={styles.td}>
                        <span style={{ ...styles.badge, background: colors.bg, color: colors.color }}>{j.kind}</span>
                      </td>
                      <td style={{ ...styles.td, fontWeight: 600 }}>{j.code}</td>
                      <td style={styles.td}>{j.name}</td>
                      <td style={styles.tdMono}>{j.invoiceCount.toLocaleString()}</td>
                      <td style={styles.tdMono}>{formatCents(j.taxableCents)}</td>
                      <td style={styles.tdMono}>{formatCents(j.taxCents)}</td>
                      <td style={styles.tdMono}>{effectiveRate(j)}</td>
                    </tr>
                  );
                })}
                <tr style={styles.totalRow}>
                  <td style={styles.td} colSpan={3}>Total</td>
                  <td style={styles.tdMono}>{report.data.totalInvoices.toLocaleString()}</td>
                  <td style={styles.tdMono}>{formatCents(report.data.totalTaxableCents)}</td>
                  <td style={styles.tdMono}>{formatCents(report.data.totalTaxCents)}</td>
                  <td style={styles.tdMono}>—</td>
                </tr>
              </tbody>
            </table>
          )}
        </>
      )}

      {!report.data && !report.loading && !report.error && (
        <div style={styles.emptyState}>Select a date range and click Run Report to view sales tax data.</div>
      )}
    </div>
  );
}
