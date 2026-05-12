import { Download } from 'lucide-react';
import { formatCents } from '../lib/format';
import { useApi } from '../hooks/useApi';
import { SubNav, BILLING_SUBNAV } from '@helm/ui-kit';

/* ─── Types ─── */
interface AgingRow {
  customer: string;
  current: number;
  days1to30: number;
  days31to60: number;
  days61to90: number;
  days90plus: number;
}

interface ApiAgingDetail {
  invoiceId: string;
  invoiceNumber: string | null;
  customer: { id: string; firstName: string | null; lastName: string | null; email: string | null } | null;
  dueDate: string;
  balanceCents: number;
  daysOverdue: number;
  bucket: 'current' | 'days30' | 'days60' | 'days90' | 'days120plus';
}

interface ApiAgingResponse {
  buckets: { current: number; days30: number; days60: number; days90: number; days120plus: number };
  totalOutstanding: number;
  invoiceCount: number;
  details: ApiAgingDetail[];
}

const BUCKET_TO_FIELD: Record<ApiAgingDetail['bucket'], keyof Omit<AgingRow, 'customer'>> = {
  current: 'current',
  days30: 'days1to30',
  days60: 'days31to60',
  days90: 'days61to90',
  days120plus: 'days90plus',
};

function customerLabel(c: ApiAgingDetail['customer']): string {
  if (!c) return 'Unknown customer';
  const name = `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim();
  return name || c.email || 'Unknown customer';
}

function aggregateRows(details: ApiAgingDetail[]): AgingRow[] {
  const byCustomer = new Map<string, AgingRow>();
  for (const d of details) {
    const key = d.customer?.id ?? `noid:${customerLabel(d.customer)}`;
    let row = byCustomer.get(key);
    if (!row) {
      row = { customer: customerLabel(d.customer), current: 0, days1to30: 0, days31to60: 0, days61to90: 0, days90plus: 0 };
      byCustomer.set(key, row);
    }
    row[BUCKET_TO_FIELD[d.bucket]] += d.balanceCents;
  }
  return Array.from(byCustomer.values()).sort((a, b) => rowTotal(b) - rowTotal(a));
}

/* ─── Helpers ─── */
const rowTotal = (r: AgingRow) => r.current + r.days1to30 + r.days31to60 + r.days61to90 + r.days90plus;
const colSum = (data: AgingRow[], field: keyof Omit<AgingRow, 'customer'>) =>
  data.reduce((s, r) => s + r[field], 0);

/* ─── Styles ─── */
const mono: React.CSSProperties = { fontFamily: 'Inter, system-ui, sans-serif', fontVariantNumeric: 'tabular-nums' };

const s: Record<string, React.CSSProperties> = {
  page: { padding: '32px' },
  title: { fontSize: '36px', fontWeight: 700, color: '#0A2342', letterSpacing: '-0.02em', margin: 0 },
  divider: {
    height: '4px', background: 'linear-gradient(90deg, #00D4FF, transparent)',
    border: 'none', marginTop: '12px', marginBottom: '32px', borderRadius: '2px',
  },
  summaryRow: { display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '16px', marginBottom: '32px' },
  card: {
    backgroundColor: '#FFFFFF', border: '1px solid #CCCCCC', borderRadius: '8px',
    padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  },
  cardLabel: {
    fontSize: '12px', fontWeight: 600, color: '#2E4A6B', textTransform: 'uppercase',
    letterSpacing: '0.05em', marginBottom: '8px',
  },
  cardValue: { fontSize: '24px', fontWeight: 700, ...mono, lineHeight: 1.2 },
  toolbar: {
    display: 'flex', justifyContent: 'flex-end', gap: '8px', marginBottom: '16px',
  },
  exportBtn: {
    display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 16px',
    fontSize: '13px', fontWeight: 600, color: '#0A2342', backgroundColor: '#FFFFFF',
    border: '1px solid #CCCCCC', borderRadius: '6px', cursor: 'pointer',
  },
  tableWrap: {
    borderRadius: '8px', overflow: 'hidden', border: '1px solid #CCCCCC',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '14px' },
  th: {
    textAlign: 'left', padding: '10px 16px', backgroundColor: '#0A2342', color: '#FFFFFF',
    fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em',
    whiteSpace: 'nowrap',
  },
  thRight: {
    textAlign: 'right', padding: '10px 16px', backgroundColor: '#0A2342', color: '#FFFFFF',
    fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em',
  },
  td: { padding: '10px 16px', borderBottom: '1px solid #E2E8F0', color: '#0A2342' },
  tdRight: {
    padding: '10px 16px', borderBottom: '1px solid #E2E8F0', color: '#0A2342',
    textAlign: 'right', ...mono, fontSize: '13px',
  },
  totalsRow: { backgroundColor: '#F2F4F6', fontWeight: 700 },
};

const agingBuckets: { label: string; field: keyof Omit<AgingRow, 'customer'>; color: string }[] = [
  { label: 'Current', field: 'current', color: '#1B5E20' },
  { label: '1-30 Days', field: 'days1to30', color: '#856404' },
  { label: '31-60 Days', field: 'days31to60', color: '#E65100' },
  { label: '61-90 Days', field: 'days61to90', color: '#BF360C' },
  { label: '90+ Days', field: 'days90plus', color: '#B71C1C' },
];

export default function ARaging() {
  const { data: apiAgingData, loading } = useApi<ApiAgingResponse>('get', '/api/reports/ar-aging', { immediate: true });
  const agingData = apiAgingData ? aggregateRows(apiAgingData.details ?? []) : [];

  const grandTotal = agingData.reduce((s, r) => s + rowTotal(r), 0);

  return (
    <div style={s.page}>
      <h1 style={s.title} className="helm-page-title">Billing</h1>
      <hr style={s.divider} />
      <SubNav items={BILLING_SUBNAV} />

      {loading && <div style={{ textAlign: 'center', padding: '24px', color: '#64748B' }}>Loading aging data...</div>}

      {/* Summary Cards */}
      <div style={s.summaryRow} className="helm-stats-grid">
        {agingBuckets.map((b) => {
          const val = colSum(agingData, b.field);
          return (
            <div key={b.label} style={{ ...s.card, borderTop: `3px solid ${b.color}` }}>
              <div style={s.cardLabel as React.CSSProperties}>{b.label}</div>
              <div style={{ ...s.cardValue, color: b.color }}>{formatCents(val)}</div>
            </div>
          );
        })}
      </div>

      {/* Export Toolbar */}
      <div style={s.toolbar}>
        <button style={s.exportBtn}><Download size={14} /> Export CSV</button>
        <button style={s.exportBtn}><Download size={14} /> Export PDF</button>
      </div>

      {/* Aging Table */}
      <div style={s.tableWrap} className="helm-table-wrap">
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>Customer</th>
              <th style={s.thRight}>Current</th>
              <th style={s.thRight}>1-30 Days</th>
              <th style={s.thRight}>31-60 Days</th>
              <th style={s.thRight}>61-90 Days</th>
              <th style={s.thRight}>90+ Days</th>
              <th style={s.thRight}>Total</th>
            </tr>
          </thead>
          <tbody>
            {agingData.map((row, idx) => {
              const total = rowTotal(row);
              return (
                <tr key={row.customer} style={{ backgroundColor: idx % 2 === 1 ? '#D6E8F4' : '#FFFFFF' }}>
                  <td style={{ ...s.td, fontWeight: 500 }}>{row.customer}</td>
                  <td style={s.tdRight}>{row.current > 0 ? formatCents(row.current) : '--'}</td>
                  <td style={{ ...s.tdRight, color: row.days1to30 > 0 ? '#856404' : '#0A2342' }}>
                    {row.days1to30 > 0 ? formatCents(row.days1to30) : '--'}
                  </td>
                  <td style={{ ...s.tdRight, color: row.days31to60 > 0 ? '#E65100' : '#0A2342' }}>
                    {row.days31to60 > 0 ? formatCents(row.days31to60) : '--'}
                  </td>
                  <td style={{ ...s.tdRight, color: row.days61to90 > 0 ? '#BF360C' : '#0A2342' }}>
                    {row.days61to90 > 0 ? formatCents(row.days61to90) : '--'}
                  </td>
                  <td style={{ ...s.tdRight, color: row.days90plus > 0 ? '#B71C1C' : '#0A2342' }}>
                    {row.days90plus > 0 ? formatCents(row.days90plus) : '--'}
                  </td>
                  <td style={{ ...s.tdRight, fontWeight: 700 }}>{formatCents(total)}</td>
                </tr>
              );
            })}
            {agingData.length === 0 && !loading && (
              <tr>
                <td colSpan={7} style={{ ...s.td, textAlign: 'center', color: '#94A3B8', padding: '48px 16px' }}>
                  No A/R aging data yet.
                </td>
              </tr>
            )}
            {/* Totals Row */}
            <tr style={s.totalsRow}>
              <td style={{ ...s.td, fontWeight: 700 }}>TOTAL</td>
              <td style={{ ...s.tdRight, fontWeight: 700 }}>{formatCents(colSum(agingData, 'current'))}</td>
              <td style={{ ...s.tdRight, fontWeight: 700, color: '#856404' }}>{formatCents(colSum(agingData, 'days1to30'))}</td>
              <td style={{ ...s.tdRight, fontWeight: 700, color: '#E65100' }}>{formatCents(colSum(agingData, 'days31to60'))}</td>
              <td style={{ ...s.tdRight, fontWeight: 700, color: '#BF360C' }}>{formatCents(colSum(agingData, 'days61to90'))}</td>
              <td style={{ ...s.tdRight, fontWeight: 700, color: '#B71C1C' }}>{formatCents(colSum(agingData, 'days90plus'))}</td>
              <td style={{ ...s.tdRight, fontWeight: 700, fontSize: '14px' }}>{formatCents(grandTotal)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
