import { formatDate } from '../../../lib/format';
import { KpiTile, ReportPage, styles } from '../_lib/ReportPage';

interface ActionRow { action: string; count: number; }
interface ActorRow { actor: string; count: number; }
interface EventRow {
  id: string;
  action: string;
  actor: string;
  ipAddress: string | null;
  createdAt: string;
}
interface AdminActionsData {
  period: { startDate: string; endDate: string };
  totalEvents: number;
  byAction: ActionRow[];
  byActor: ActorRow[];
  recent: EventRow[];
}

export default function AdminActionsReport() {
  return (
    <ReportPage<AdminActionsData>
      title="Admin Actions"
      subtitle="Every platform-side action on this tenant — impersonations, flag toggles, exports, locks — with actor and timestamp attribution."
      apiPath="/api/reports/admin-actions"
      render={(data) => (
        <>
          <div style={styles.kpiRow}>
            <KpiTile label="Events" value={data.totalEvents} />
            <KpiTile label="Action types" value={data.byAction.length} />
            <KpiTile label="Unique actors" value={data.byActor.length} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div style={styles.card}>
              <div style={{ ...styles.sectionTitle, margin: '12px 16px 4px' }}>By action</div>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Action</th>
                    <th style={styles.th}>Count</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byAction.map((a) => (
                    <tr key={a.action}>
                      <td style={{ ...styles.td, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 }}>{a.action}</td>
                      <td style={styles.td}>{a.count}</td>
                    </tr>
                  ))}
                  {data.byAction.length === 0 && (
                    <tr><td colSpan={2} style={styles.empty}>No admin events in this window.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div style={styles.card}>
              <div style={{ ...styles.sectionTitle, margin: '12px 16px 4px' }}>By actor</div>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Actor</th>
                    <th style={styles.th}>Events</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byActor.map((a) => (
                    <tr key={a.actor}>
                      <td style={{ ...styles.td, fontWeight: 600 }}>{a.actor}</td>
                      <td style={styles.td}>{a.count}</td>
                    </tr>
                  ))}
                  {data.byActor.length === 0 && (
                    <tr><td colSpan={2} style={styles.empty}>—</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div style={styles.sectionTitle}>Latest 100 events</div>
          <div style={styles.card}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>When</th>
                  <th style={styles.th}>Actor</th>
                  <th style={styles.th}>Action</th>
                  <th style={styles.th}>IP</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((e) => (
                  <tr key={e.id}>
                    <td style={{ ...styles.td, color: '#64748B' }}>{formatDate(e.createdAt)}</td>
                    <td style={styles.td}>{e.actor}</td>
                    <td style={{ ...styles.td, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 }}>{e.action}</td>
                    <td style={{ ...styles.td, color: '#94A3B8' }}>{e.ipAddress ?? '—'}</td>
                  </tr>
                ))}
                {data.recent.length === 0 && (
                  <tr><td colSpan={4} style={styles.empty}>No admin events in this window.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    />
  );
}
