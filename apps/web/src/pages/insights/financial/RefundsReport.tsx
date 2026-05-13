import { formatCents } from '../../../lib/format';
import { KpiTile, ReportPage, styles } from '../_lib/ReportPage';

interface ReasonRow { reason: string; count: number; totalCents: number; }
interface RefundsData {
  period: { startDate: string; endDate: string };
  refunds: { count: number; totalCents: number; fullRefunds: number; rateOfGross: number };
  gross: { paymentCount: number; totalCents: number };
  disputes: { count: number; totalCents: number };
  byReason: ReasonRow[];
}

export default function RefundsReport() {
  return (
    <ReportPage<RefundsData>
      title="Refunds & Chargebacks"
      subtitle="Refund volume, refund-to-gross rate, top reasons, and chargeback exposure for the window."
      apiPath="/api/reports/refunds-chargebacks"
      render={(data) => (
        <>
          <div style={styles.kpiRow}>
            <KpiTile
              label="Refund volume"
              value={formatCents(data.refunds.totalCents)}
              accent={data.refunds.totalCents > 0 ? '#B71C1C' : '#94A3B8'}
              sub={`${data.refunds.count} refunds`}
            />
            <KpiTile
              label="Refund rate"
              value={`${data.refunds.rateOfGross.toFixed(2)}%`}
              accent={data.refunds.rateOfGross > 5 ? '#B71C1C' : data.refunds.rateOfGross > 2 ? '#F59E0B' : '#166534'}
              sub="of gross"
            />
            <KpiTile label="Full refunds" value={data.refunds.fullRefunds} />
            <KpiTile
              label="Disputes"
              value={data.disputes.count}
              sub={data.disputes.count > 0 ? formatCents(data.disputes.totalCents) : 'no exposure'}
              accent={data.disputes.count > 0 ? '#B71C1C' : '#94A3B8'}
            />
          </div>

          <div style={styles.sectionTitle}>Refunds by reason</div>
          <div style={styles.card}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Reason</th>
                  <th style={styles.th}>Count</th>
                  <th style={styles.th}>Volume</th>
                  <th style={styles.th}>Share</th>
                </tr>
              </thead>
              <tbody>
                {data.byReason.map((r) => (
                  <tr key={r.reason}>
                    <td style={{ ...styles.td, fontWeight: 600, textTransform: 'capitalize' }}>{r.reason}</td>
                    <td style={styles.td}>{r.count}</td>
                    <td style={{ ...styles.td, color: '#B71C1C', fontWeight: 600 }}>{formatCents(r.totalCents)}</td>
                    <td style={styles.td}>
                      {data.refunds.totalCents > 0 ? `${((r.totalCents / data.refunds.totalCents) * 100).toFixed(1)}%` : '—'}
                    </td>
                  </tr>
                ))}
                {data.byReason.length === 0 && (
                  <tr><td colSpan={4} style={styles.empty}>No refunds in this window. 🎉</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    />
  );
}
