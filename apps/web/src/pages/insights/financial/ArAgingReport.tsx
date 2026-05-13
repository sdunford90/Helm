import { Link } from 'react-router-dom';
import { formatCents, formatDateOnly } from '../../../lib/format';
import { KpiTile, ReportPage, styles } from '../_lib/ReportPage';

interface Detail {
  invoiceId: string;
  invoiceNumber: string;
  customer: { id: string; firstName: string; lastName: string; email: string | null } | null;
  dueDate: string;
  balanceCents: number;
  daysOverdue: number;
  bucket: keyof Buckets;
}
type Buckets = { current: number; days30: number; days60: number; days90: number; days120plus: number };
interface ArData {
  buckets: Buckets;
  totalOutstanding: number;
  invoiceCount: number;
  details: Detail[];
}

const BUCKET_LABEL: Record<keyof Buckets, string> = {
  current: 'Current',
  days30: '1–30 days',
  days60: '31–60 days',
  days90: '61–90 days',
  days120plus: '90+ days',
};
const BUCKET_ACCENT: Record<keyof Buckets, string> = {
  current: '#0EA5E9',
  days30: '#F59E0B',
  days60: '#FB923C',
  days90: '#DC2626',
  days120plus: '#B71C1C',
};

export default function ArAgingReport() {
  return (
    <ReportPage<ArData>
      title="A/R Aging"
      subtitle="Outstanding invoice balances bucketed by overdue days. Insights view adds drilldown links into the source invoice."
      apiPath="/api/reports/ar-aging"
      enableDateRange={false}
      render={(data) => (
        <>
          <div style={styles.kpiRow}>
            <KpiTile label="Outstanding" value={formatCents(data.totalOutstanding)} accent="#B71C1C" />
            <KpiTile label="Open invoices" value={data.invoiceCount} />
            {(Object.keys(data.buckets) as (keyof Buckets)[]).map((k) => (
              <KpiTile
                key={k}
                label={BUCKET_LABEL[k]}
                value={formatCents(data.buckets[k])}
                accent={BUCKET_ACCENT[k]}
              />
            ))}
          </div>

          <div style={styles.sectionTitle}>Open invoices</div>
          <div style={styles.card}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Invoice</th>
                  <th style={styles.th}>Customer</th>
                  <th style={styles.th}>Due</th>
                  <th style={styles.th}>Days overdue</th>
                  <th style={styles.th}>Bucket</th>
                  <th style={styles.th}>Balance</th>
                </tr>
              </thead>
              <tbody>
                {data.details
                  .slice()
                  .sort((a, b) => b.daysOverdue - a.daysOverdue)
                  .slice(0, 200)
                  .map((d) => (
                    <tr key={d.invoiceId}>
                      <td style={{ ...styles.td, fontWeight: 600 }}>
                        <Link to={`/billing/invoices/${d.invoiceId}`} style={{ color: '#0A2342', textDecoration: 'none' }}>
                          {d.invoiceNumber}
                        </Link>
                      </td>
                      <td style={styles.td}>
                        {d.customer ? `${d.customer.firstName} ${d.customer.lastName}` : '—'}
                      </td>
                      <td style={styles.td}>{formatDateOnly(d.dueDate)}</td>
                      <td style={{ ...styles.td, fontWeight: 600, color: d.daysOverdue > 0 ? '#B71C1C' : '#94A3B8' }}>
                        {d.daysOverdue}
                      </td>
                      <td style={{ ...styles.td, color: BUCKET_ACCENT[d.bucket], fontWeight: 600 }}>
                        {BUCKET_LABEL[d.bucket]}
                      </td>
                      <td style={{ ...styles.td, fontWeight: 600 }}>{formatCents(d.balanceCents)}</td>
                    </tr>
                  ))}
                {data.details.length === 0 && (
                  <tr><td colSpan={6} style={styles.empty}>Nothing outstanding. 🎉</td></tr>
                )}
              </tbody>
            </table>
            {data.details.length > 200 && (
              <div style={{ ...styles.empty, padding: 12 }}>
                Showing the 200 most overdue invoices. Export CSV for the full list.
              </div>
            )}
          </div>
        </>
      )}
    />
  );
}
