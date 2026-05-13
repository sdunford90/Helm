import { formatCents } from '../../../lib/format';
import { KpiTile, ReportPage, styles } from '../_lib/ReportPage';

interface MethodRow {
  method: string;
  totalCents: number;
  count: number;
}
interface RevenueData {
  period: { startDate: string; endDate: string };
  revenue: { totalCents: number; paymentCount: number };
  invoiced: { totalCents: number; invoiceCount: number };
  byPaymentMethod: MethodRow[];
}

const METHOD_LABEL: Record<string, string> = {
  CARD: 'Card',
  ACH: 'ACH',
  CASH: 'Cash',
  CHECK: 'Check',
  OTHER: 'Other',
};

export default function RevenueReport() {
  return (
    <ReportPage<RevenueData>
      title="Revenue"
      subtitle="Collected revenue and invoiced totals for the window, with a payment-method breakdown."
      apiPath="/api/reports/revenue"
      render={(data) => {
        const collectionRate = data.invoiced.totalCents > 0
          ? (data.revenue.totalCents / data.invoiced.totalCents) * 100
          : 0;
        return (
          <>
            <div style={styles.kpiRow}>
              <KpiTile label="Collected" value={formatCents(data.revenue.totalCents)} accent="#166534" />
              <KpiTile label="Invoiced" value={formatCents(data.invoiced.totalCents)} />
              <KpiTile
                label="Collection rate"
                value={data.invoiced.totalCents > 0 ? `${collectionRate.toFixed(1)}%` : '—'}
                accent={collectionRate >= 90 ? '#166534' : collectionRate >= 75 ? '#F59E0B' : '#B71C1C'}
              />
              <KpiTile label="Payments" value={data.revenue.paymentCount} />
              <KpiTile label="Invoices" value={data.invoiced.invoiceCount} />
            </div>

            <div style={styles.sectionTitle}>By payment method</div>
            <div style={styles.card}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Method</th>
                    <th style={styles.th}>Count</th>
                    <th style={styles.th}>Volume</th>
                    <th style={styles.th}>Share</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byPaymentMethod
                    .slice()
                    .sort((a, b) => b.totalCents - a.totalCents)
                    .map((m) => (
                      <tr key={m.method}>
                        <td style={{ ...styles.td, fontWeight: 600 }}>{METHOD_LABEL[m.method] ?? m.method}</td>
                        <td style={styles.td}>{m.count}</td>
                        <td style={{ ...styles.td, color: '#166534', fontWeight: 600 }}>{formatCents(m.totalCents)}</td>
                        <td style={styles.td}>
                          {data.revenue.totalCents > 0 ? `${((m.totalCents / data.revenue.totalCents) * 100).toFixed(1)}%` : '—'}
                        </td>
                      </tr>
                    ))}
                  {data.byPaymentMethod.length === 0 && (
                    <tr><td colSpan={4} style={styles.empty}>No collected payments in this window.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        );
      }}
    />
  );
}
