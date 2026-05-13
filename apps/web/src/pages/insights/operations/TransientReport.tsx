import { formatCents } from '../../../lib/format';
import { KpiTile, ReportPage, styles } from '../_lib/ReportPage';

interface TransientData {
  period: { startDate: string; endDate: string };
  bookingCount: number;
  totalRevenueCents: number;
  avgStayNights: string;
  byStatus: Record<string, number>;
}

const STATUS_LABEL: Record<string, string> = {
  BOOKED: 'Booked',
  CHECKED_IN: 'Checked in',
  CHECKED_OUT: 'Checked out',
  OVERSTAY: 'Overstay',
  CANCELLED: 'Cancelled',
};
const STATUS_ACCENT: Record<string, string> = {
  OVERSTAY: '#B71C1C',
  CHECKED_IN: '#166534',
  CANCELLED: '#94A3B8',
};

export default function TransientReport() {
  return (
    <ReportPage<TransientData>
      title="Transient Activity"
      subtitle="Bookings, average stay length, and the overstay queue — the verbs that turn the most reservation revenue."
      apiPath="/api/reports/transient"
      render={(data) => {
        const overstay = data.byStatus.OVERSTAY ?? 0;
        return (
          <>
            <div style={styles.kpiRow}>
              <KpiTile label="Bookings" value={data.bookingCount} />
              <KpiTile label="Revenue" value={formatCents(data.totalRevenueCents)} accent="#166534" />
              <KpiTile label="Avg stay" value={`${data.avgStayNights} nights`} />
              <KpiTile label="Overstaying" value={overstay} accent={overstay > 0 ? '#B71C1C' : '#94A3B8'} />
            </div>

            <div style={styles.sectionTitle}>Status breakdown</div>
            <div style={styles.card}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Status</th>
                    <th style={styles.th}>Count</th>
                    <th style={styles.th}>Share</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(data.byStatus).map(([s, n]) => (
                    <tr key={s}>
                      <td style={{ ...styles.td, fontWeight: 600, color: STATUS_ACCENT[s] ?? undefined }}>
                        {STATUS_LABEL[s] ?? s}
                      </td>
                      <td style={styles.td}>{n}</td>
                      <td style={styles.td}>
                        {data.bookingCount > 0 ? `${((n / data.bookingCount) * 100).toFixed(1)}%` : '—'}
                      </td>
                    </tr>
                  ))}
                  {Object.keys(data.byStatus).length === 0 && (
                    <tr><td colSpan={3} style={styles.empty}>No bookings in this window.</td></tr>
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
