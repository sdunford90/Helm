import { formatDate } from '../../../lib/format';
import { KpiTile, ReportPage, styles } from '../_lib/ReportPage';

interface DestinationRow {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  disabledAt: string | null;
  consecutiveFailures: number;
  deliveryCount: number;
  successCount: number;
  failedCount: number;
  successRate: number;
}
interface FailureRow {
  destination: string;
  event: string;
  httpStatus: number | null;
  responseSnippet: string | null;
  createdAt: string;
}
interface WebhooksData {
  period: { startDate: string; endDate: string };
  destinationCount: number;
  enabledDestinations: number;
  disabledDestinations: number;
  totalDeliveries: number;
  totalSuccess: number;
  totalFailed: number;
  successRate: number;
  byDestination: DestinationRow[];
  recentFailures: FailureRow[];
}

export default function WebhooksReport() {
  return (
    <ReportPage<WebhooksData>
      title="Webhooks"
      subtitle="Outbound webhook delivery — destinations, per-destination success, and the failures that need a human."
      apiPath="/api/reports/webhook-deliveries"
      render={(data) => (
        <>
          <div style={styles.kpiRow}>
            <KpiTile label="Destinations" value={data.destinationCount} sub={`${data.enabledDestinations} enabled`} />
            <KpiTile label="Deliveries" value={data.totalDeliveries} />
            <KpiTile
              label="Success rate"
              value={data.totalDeliveries > 0 ? `${data.successRate}%` : '—'}
              accent={data.successRate >= 99 ? '#166534' : data.successRate >= 95 ? '#F59E0B' : '#B71C1C'}
            />
            <KpiTile
              label="Failed"
              value={data.totalFailed}
              accent={data.totalFailed > 0 ? '#B71C1C' : '#94A3B8'}
            />
            <KpiTile
              label="Auto-disabled"
              value={data.disabledDestinations}
              accent={data.disabledDestinations > 0 ? '#B71C1C' : '#94A3B8'}
            />
          </div>

          <div style={styles.sectionTitle}>By destination</div>
          <div style={styles.card}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Destination</th>
                  <th style={styles.th}>Status</th>
                  <th style={styles.th}>Deliveries</th>
                  <th style={styles.th}>Success</th>
                  <th style={styles.th}>Failed</th>
                  <th style={styles.th}>Success rate</th>
                  <th style={styles.th}>Consec. fails</th>
                </tr>
              </thead>
              <tbody>
                {data.byDestination.map((d) => (
                  <tr key={d.id}>
                    <td style={{ ...styles.td, fontWeight: 600 }}>
                      {d.name}
                      <div style={{ fontSize: 11, color: '#94A3B8', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{d.url}</div>
                    </td>
                    <td style={{ ...styles.td, fontWeight: 700, color: d.enabled ? '#166534' : '#B71C1C' }}>
                      {d.enabled ? 'Enabled' : 'Disabled'}
                    </td>
                    <td style={styles.td}>{d.deliveryCount}</td>
                    <td style={{ ...styles.td, color: '#166534' }}>{d.successCount}</td>
                    <td style={{ ...styles.td, color: d.failedCount > 0 ? '#B71C1C' : '#94A3B8' }}>{d.failedCount}</td>
                    <td style={styles.td}>{d.deliveryCount > 0 ? `${d.successRate}%` : '—'}</td>
                    <td style={{ ...styles.td, color: d.consecutiveFailures > 0 ? '#B71C1C' : '#94A3B8', fontWeight: 600 }}>
                      {d.consecutiveFailures}
                    </td>
                  </tr>
                ))}
                {data.byDestination.length === 0 && (
                  <tr><td colSpan={7} style={styles.empty}>No webhook destinations configured.</td></tr>
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
                  <th style={styles.th}>Destination</th>
                  <th style={styles.th}>Event</th>
                  <th style={styles.th}>HTTP</th>
                  <th style={styles.th}>Response</th>
                </tr>
              </thead>
              <tbody>
                {data.recentFailures.map((f, idx) => (
                  <tr key={idx}>
                    <td style={{ ...styles.td, color: '#64748B' }}>{formatDate(f.createdAt)}</td>
                    <td style={{ ...styles.td, fontWeight: 600 }}>{f.destination}</td>
                    <td style={{ ...styles.td, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 }}>{f.event}</td>
                    <td style={{ ...styles.td, color: '#B71C1C', fontWeight: 600 }}>{f.httpStatus ?? '—'}</td>
                    <td style={{ ...styles.td, color: '#64748B', fontSize: 12, maxWidth: 400 }}>{f.responseSnippet ?? '—'}</td>
                  </tr>
                ))}
                {data.recentFailures.length === 0 && (
                  <tr><td colSpan={5} style={styles.empty}>No failures in this window. 🎉</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    />
  );
}
