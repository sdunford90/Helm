import { formatCents } from '../../../lib/format';
import { KpiTile, ReportPage, styles } from '../_lib/ReportPage';

interface MethodRow {
  method: string;
  count: number;
  grossCents: number;
  netCents: number;
  refundedCents: number;
  avgTicketCents: number;
  sharePct: number;
}
interface CardRailData {
  period: { startDate: string; endDate: string };
  paymentCount: number;
  totalGrossCents: number;
  totalRefundedCents: number;
  byMethod: MethodRow[];
}

const METHOD_LABEL: Record<string, string> = {
  CARD: 'Card',
  ACH: 'ACH',
  CASH: 'Cash',
  CHECK: 'Check',
  OTHER: 'Other',
};

export default function CardRailMixReport() {
  return (
    <ReportPage<CardRailData>
      title="Card Rail Mix"
      subtitle="Where money actually arrives — card vs. ACH vs. cash vs. check — with average ticket and refund drag per rail."
      apiPath="/api/reports/card-rail-mix"
      render={(data) => (
        <>
          <div style={styles.kpiRow}>
            <KpiTile label="Payments" value={data.paymentCount} />
            <KpiTile label="Gross volume" value={formatCents(data.totalGrossCents)} accent="#166534" />
            <KpiTile
              label="Refunds"
              value={formatCents(data.totalRefundedCents)}
              accent={data.totalRefundedCents > 0 ? '#B71C1C' : '#94A3B8'}
            />
            <KpiTile
              label="Net"
              value={formatCents(data.totalGrossCents - data.totalRefundedCents)}
            />
          </div>

          <div style={styles.sectionTitle}>By rail</div>
          <div style={styles.card}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Rail</th>
                  <th style={styles.th}>Count</th>
                  <th style={styles.th}>Gross</th>
                  <th style={styles.th}>Refunded</th>
                  <th style={styles.th}>Net</th>
                  <th style={styles.th}>Avg ticket</th>
                  <th style={styles.th}>Share</th>
                </tr>
              </thead>
              <tbody>
                {data.byMethod.map((m) => (
                  <tr key={m.method}>
                    <td style={{ ...styles.td, fontWeight: 600 }}>{METHOD_LABEL[m.method] ?? m.method}</td>
                    <td style={styles.td}>{m.count}</td>
                    <td style={{ ...styles.td, color: '#166534', fontWeight: 600 }}>{formatCents(m.grossCents)}</td>
                    <td style={{ ...styles.td, color: m.refundedCents > 0 ? '#B71C1C' : '#94A3B8' }}>{formatCents(m.refundedCents)}</td>
                    <td style={styles.td}>{formatCents(m.netCents)}</td>
                    <td style={styles.td}>{formatCents(m.avgTicketCents)}</td>
                    <td style={styles.td}>{m.sharePct.toFixed(1)}%</td>
                  </tr>
                ))}
                {data.byMethod.length === 0 && (
                  <tr><td colSpan={7} style={styles.empty}>No completed payments in this window.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    />
  );
}
