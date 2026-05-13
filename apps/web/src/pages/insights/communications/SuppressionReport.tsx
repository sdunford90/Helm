import { formatDate } from '../../../lib/format';
import { KpiTile, ReportPage, styles } from '../_lib/ReportPage';

interface ReasonRow { reason: string; count: number; }
interface SourceRow { source: string; count: number; }
interface RecentRow {
  email: string;
  reason: string;
  source: string;
  createdAt: string;
}
interface SuppressionData {
  period: { startDate: string; endDate: string };
  totalSuppressed: number;
  addedInWindow: number;
  byReason: ReasonRow[];
  bySource: SourceRow[];
  recent: RecentRow[];
}

const REASON_LABEL: Record<string, string> = {
  BOUNCED_HARD: 'Hard bounce',
  COMPLAINED: 'Complaint',
  UNSUBSCRIBED: 'Unsubscribed',
};

export default function SuppressionReport() {
  return (
    <ReportPage<SuppressionData>
      title="Suppression"
      subtitle="Suppression-list growth, top reasons, and the most recent additions. Sources are Resend bounces, complaints, and user unsubscribes."
      apiPath="/api/reports/email-suppression"
      render={(data) => (
        <>
          <div style={styles.kpiRow}>
            <KpiTile label="Total suppressed" value={data.totalSuppressed} />
            <KpiTile
              label="Added this window"
              value={data.addedInWindow}
              accent={data.addedInWindow > 0 ? '#F59E0B' : '#94A3B8'}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div style={styles.card}>
              <div style={{ ...styles.sectionTitle, margin: '12px 16px 4px' }}>By reason</div>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Reason</th>
                    <th style={styles.th}>Count</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byReason.map((r) => (
                    <tr key={r.reason}>
                      <td style={{ ...styles.td, fontWeight: 600 }}>{REASON_LABEL[r.reason] ?? r.reason}</td>
                      <td style={styles.td}>{r.count}</td>
                    </tr>
                  ))}
                  {data.byReason.length === 0 && (
                    <tr><td colSpan={2} style={styles.empty}>No suppressions.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div style={styles.card}>
              <div style={{ ...styles.sectionTitle, margin: '12px 16px 4px' }}>By source</div>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Source</th>
                    <th style={styles.th}>Count</th>
                  </tr>
                </thead>
                <tbody>
                  {data.bySource.map((s) => (
                    <tr key={s.source}>
                      <td style={{ ...styles.td, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 }}>{s.source}</td>
                      <td style={styles.td}>{s.count}</td>
                    </tr>
                  ))}
                  {data.bySource.length === 0 && (
                    <tr><td colSpan={2} style={styles.empty}>—</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div style={styles.sectionTitle}>Recent additions</div>
          <div style={styles.card}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>When</th>
                  <th style={styles.th}>Email</th>
                  <th style={styles.th}>Reason</th>
                  <th style={styles.th}>Source</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((r, idx) => (
                  <tr key={idx}>
                    <td style={{ ...styles.td, color: '#64748B' }}>{formatDate(r.createdAt)}</td>
                    <td style={styles.td}>{r.email}</td>
                    <td style={styles.td}>{REASON_LABEL[r.reason] ?? r.reason}</td>
                    <td style={{ ...styles.td, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 }}>{r.source}</td>
                  </tr>
                ))}
                {data.recent.length === 0 && (
                  <tr><td colSpan={4} style={styles.empty}>No additions in this window.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    />
  );
}
