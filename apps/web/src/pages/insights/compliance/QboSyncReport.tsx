import { formatDate } from '../../../lib/format';
import { KpiTile, ReportPage, styles } from '../_lib/ReportPage';

interface FailureRow {
  id: string;
  signature: string;
  attempts: number;
  lastError: string | null;
  receivedAt: string;
}
interface QboSyncData {
  period: { startDate: string; endDate: string };
  connected: boolean;
  connectedAt: string | null;
  lastVendorPullAt: string | null;
  lastBillPullAt: string | null;
  total: number;
  counts: Record<string, number>;
  successRate: number;
  recentFailures: FailureRow[];
}

export default function QboSyncReport() {
  return (
    <ReportPage<QboSyncData>
      title="QBO Sync Health"
      subtitle="QuickBooks Online connection state, recent webhook delivery success, and the failed deliveries that need attention."
      apiPath="/api/reports/qbo-sync"
      render={(data) => (
        <>
          <div style={styles.kpiRow}>
            <KpiTile
              label="Connection"
              value={data.connected ? 'Connected' : 'Not connected'}
              accent={data.connected ? '#166534' : '#B71C1C'}
              sub={data.connected && data.connectedAt ? formatDate(data.connectedAt) : undefined}
            />
            <KpiTile label="Inbound deliveries" value={data.total} />
            <KpiTile
              label="Success rate"
              value={data.total > 0 ? `${data.successRate}%` : '—'}
              accent={data.successRate >= 99 ? '#166534' : data.successRate >= 90 ? '#F59E0B' : '#B71C1C'}
            />
            <KpiTile
              label="Failed"
              value={data.counts.FAILED ?? 0}
              accent={(data.counts.FAILED ?? 0) > 0 ? '#B71C1C' : '#94A3B8'}
            />
          </div>

          <div style={styles.sectionTitle}>Last-pull watermarks</div>
          <div style={styles.kpiRow}>
            <KpiTile label="Vendors" value={data.lastVendorPullAt ? formatDate(data.lastVendorPullAt) : '—'} />
            <KpiTile label="Bills" value={data.lastBillPullAt ? formatDate(data.lastBillPullAt) : '—'} />
          </div>

          <div style={styles.sectionTitle}>Recent failures</div>
          <div style={styles.card}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>When</th>
                  <th style={styles.th}>Attempts</th>
                  <th style={styles.th}>Error</th>
                </tr>
              </thead>
              <tbody>
                {data.recentFailures.map((f) => (
                  <tr key={f.id}>
                    <td style={{ ...styles.td, color: '#64748B' }}>{formatDate(f.receivedAt)}</td>
                    <td style={{ ...styles.td, fontWeight: 600 }}>{f.attempts}</td>
                    <td style={{ ...styles.td, color: '#B71C1C', fontSize: 12 }}>{f.lastError ?? 'No error message'}</td>
                  </tr>
                ))}
                {data.recentFailures.length === 0 && (
                  <tr><td colSpan={3} style={styles.empty}>No failures in this window. 🎉</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    />
  );
}
