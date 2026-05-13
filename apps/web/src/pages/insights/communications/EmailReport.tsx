import { formatDate } from '../../../lib/format';
import { KpiTile, ReportPage, styles } from '../_lib/ReportPage';

interface StatusRow { status: string; count: number; }
interface FailureRow {
  recipient: string | null;
  subject: string | null;
  trigger: string;
  error: string | null;
  createdAt: string;
}
interface EmailData {
  period: { startDate: string; endDate: string };
  total: number;
  sent: number;
  failed: number;
  successRate: number;
  byStatus: StatusRow[];
  recentFailures: FailureRow[];
}

export default function EmailReport() {
  return (
    <ReportPage<EmailData>
      title="Email"
      subtitle="Outbound email — volume, deliverability, and the failed sends that need attention. Data is sourced from EmailAutomationLog (Resend-backed)."
      apiPath="/api/reports/email-stats"
      render={(data) => (
        <>
          <div style={styles.kpiRow}>
            <KpiTile label="Sent" value={data.sent} accent="#166534" />
            <KpiTile label="Failed" value={data.failed} accent={data.failed > 0 ? '#B71C1C' : '#94A3B8'} />
            <KpiTile label="Total" value={data.total} />
            <KpiTile
              label="Success rate"
              value={data.total > 0 ? `${data.successRate}%` : '—'}
              accent={data.successRate >= 99 ? '#166534' : data.successRate >= 95 ? '#F59E0B' : '#B71C1C'}
            />
          </div>

          <div style={styles.sectionTitle}>Status breakdown</div>
          <div style={styles.card}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Status</th>
                  <th style={styles.th}>Count</th>
                </tr>
              </thead>
              <tbody>
                {data.byStatus.map((s) => (
                  <tr key={s.status}>
                    <td style={{ ...styles.td, fontWeight: 600 }}>{s.status}</td>
                    <td style={styles.td}>{s.count}</td>
                  </tr>
                ))}
                {data.byStatus.length === 0 && (
                  <tr><td colSpan={2} style={styles.empty}>No email sends in this window.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div style={styles.sectionTitle}>Recent failures</div>
          <div style={styles.card}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>When</th>
                  <th style={styles.th}>Recipient</th>
                  <th style={styles.th}>Subject</th>
                  <th style={styles.th}>Error</th>
                </tr>
              </thead>
              <tbody>
                {data.recentFailures.map((f, idx) => (
                  <tr key={idx}>
                    <td style={{ ...styles.td, color: '#64748B' }}>{formatDate(f.createdAt)}</td>
                    <td style={styles.td}>{f.recipient ?? '—'}</td>
                    <td style={styles.td}>{f.subject ?? '—'}</td>
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
