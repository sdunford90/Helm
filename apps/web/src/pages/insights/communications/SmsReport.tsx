import { formatDate } from '../../../lib/format';
import { KpiTile, ReportPage, styles } from '../_lib/ReportPage';

interface FailureRow {
  recipient: string | null;
  trigger: string;
  error: string | null;
  createdAt: string;
}
interface SmsData {
  period: { startDate: string; endDate: string };
  total: number;
  sent: number;
  failed: number;
  successRate: number;
  recentFailures: FailureRow[];
}

export default function SmsReport() {
  return (
    <ReportPage<SmsData>
      title="SMS"
      subtitle="Outbound SMS volume and delivery health, sourced from EmailAutomationLog rows that targeted a phone number (Twilio-backed)."
      apiPath="/api/reports/sms-stats"
      render={(data) => (
        <>
          <div style={styles.kpiRow}>
            <KpiTile label="Sent" value={data.sent} accent="#166534" />
            <KpiTile label="Failed" value={data.failed} accent={data.failed > 0 ? '#B71C1C' : '#94A3B8'} />
            <KpiTile label="Total" value={data.total} />
            <KpiTile
              label="Success rate"
              value={data.total > 0 ? `${data.successRate}%` : '—'}
              accent={data.successRate >= 98 ? '#166534' : data.successRate >= 92 ? '#F59E0B' : '#B71C1C'}
            />
          </div>

          <div style={styles.sectionTitle}>Recent failures</div>
          <div style={styles.card}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>When</th>
                  <th style={styles.th}>Recipient</th>
                  <th style={styles.th}>Trigger</th>
                  <th style={styles.th}>Error</th>
                </tr>
              </thead>
              <tbody>
                {data.recentFailures.map((f, idx) => (
                  <tr key={idx}>
                    <td style={{ ...styles.td, color: '#64748B' }}>{formatDate(f.createdAt)}</td>
                    <td style={styles.td}>{f.recipient ?? '—'}</td>
                    <td style={{ ...styles.td, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 }}>{f.trigger}</td>
                    <td style={{ ...styles.td, color: '#B71C1C', fontSize: 12 }}>{f.error ?? '—'}</td>
                  </tr>
                ))}
                {data.recentFailures.length === 0 && (
                  <tr><td colSpan={4} style={styles.empty}>No failures in this window. 🎉</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    />
  );
}
