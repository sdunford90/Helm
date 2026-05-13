import { formatCents } from '../../../lib/format';
import { KpiTile, ReportPage, styles } from '../_lib/ReportPage';

interface Cohort {
  cohort: string;
  customers: number;
  totalLtvCents: number;
  avgLtvCents: number;
}
interface TopCustomer {
  customerId: string;
  name: string;
  ltvCents: number;
}
interface LtvData {
  totalCustomers: number;
  totalLtvCents: number;
  avgLtvCents: number;
  medianLtvCents: number;
  cohorts: Cohort[];
  topCustomers: TopCustomer[];
}

function fmtCohort(ym: string): string {
  const [y, m] = ym.split('-');
  return new Date(Date.UTC(Number(y), Number(m) - 1, 1)).toLocaleString('en-US', {
    month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

export default function LtvReport() {
  return (
    <ReportPage<LtvData>
      title="Customer LTV"
      subtitle="Lifetime value per customer, broken down by signup cohort. Mean vs. median tells you whether one whale is skewing the average."
      apiPath="/api/reports/customer-ltv"
      enableDateRange={false}
      render={(data) => (
        <>
          <div style={styles.kpiRow}>
            <KpiTile label="Customers" value={data.totalCustomers} />
            <KpiTile label="Avg LTV" value={formatCents(data.avgLtvCents)} accent="#0EA5E9" />
            <KpiTile label="Median LTV" value={formatCents(data.medianLtvCents)} />
            <KpiTile label="Total LTV" value={formatCents(data.totalLtvCents)} accent="#166534" />
          </div>

          <div style={styles.sectionTitle}>By signup cohort</div>
          <div style={styles.card}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Cohort</th>
                  <th style={styles.th}>Customers</th>
                  <th style={styles.th}>Total LTV</th>
                  <th style={styles.th}>Avg LTV</th>
                </tr>
              </thead>
              <tbody>
                {data.cohorts.map((c) => (
                  <tr key={c.cohort}>
                    <td style={{ ...styles.td, fontWeight: 600 }}>{fmtCohort(c.cohort)}</td>
                    <td style={styles.td}>{c.customers}</td>
                    <td style={{ ...styles.td, fontWeight: 600 }}>{formatCents(c.totalLtvCents)}</td>
                    <td style={{ ...styles.td, color: '#166534' }}>{formatCents(c.avgLtvCents)}</td>
                  </tr>
                ))}
                {data.cohorts.length === 0 && (
                  <tr><td colSpan={4} style={styles.empty}>No customers yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div style={styles.sectionTitle}>Top 20 customers</div>
          <div style={styles.card}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Rank</th>
                  <th style={styles.th}>Customer</th>
                  <th style={styles.th}>Lifetime value</th>
                </tr>
              </thead>
              <tbody>
                {data.topCustomers.map((c, idx) => (
                  <tr key={c.customerId}>
                    <td style={{ ...styles.td, fontWeight: 600 }}>{idx + 1}</td>
                    <td style={styles.td}>{c.name || '— Unnamed —'}</td>
                    <td style={{ ...styles.td, color: '#166534', fontWeight: 600 }}>{formatCents(c.ltvCents)}</td>
                  </tr>
                ))}
                {data.topCustomers.length === 0 && (
                  <tr><td colSpan={3} style={styles.empty}>No payments recorded yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    />
  );
}
