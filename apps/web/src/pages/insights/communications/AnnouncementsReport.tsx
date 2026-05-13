import { formatDate } from '../../../lib/format';
import { KpiTile, ReportPage, styles } from '../_lib/ReportPage';

interface AnnouncementRow {
  id: string;
  subject: string;
  channels: string;
  isEmergency: boolean;
  sentAt: string | null;
  totalDeliveries: number;
  delivered: number;
  failed: number;
  opened: number;
  openRate: number;
}
interface AnnouncementsData {
  period: { startDate: string; endDate: string };
  totalAnnouncements: number;
  totalDeliveries: number;
  announcements: AnnouncementRow[];
}

export default function AnnouncementsReport() {
  return (
    <ReportPage<AnnouncementsData>
      title="Announcements"
      subtitle="Each broadcast you've sent, its reach, and how many recipients opened it (Portal-delivery & email-open backed)."
      apiPath="/api/reports/announcement-reach"
      render={(data) => (
        <>
          <div style={styles.kpiRow}>
            <KpiTile label="Announcements sent" value={data.totalAnnouncements} />
            <KpiTile label="Total deliveries" value={data.totalDeliveries} accent="#166534" />
            <KpiTile
              label="Avg open rate"
              value={
                data.announcements.length > 0
                  ? `${(
                    data.announcements.reduce((s, a) => s + a.openRate, 0) / data.announcements.length
                  ).toFixed(1)}%`
                  : '—'
              }
              accent="#0EA5E9"
            />
          </div>

          <div style={styles.card}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Subject</th>
                  <th style={styles.th}>Channels</th>
                  <th style={styles.th}>Sent</th>
                  <th style={styles.th}>Delivered</th>
                  <th style={styles.th}>Opened</th>
                  <th style={styles.th}>Open rate</th>
                  <th style={styles.th}>Failed</th>
                </tr>
              </thead>
              <tbody>
                {data.announcements.map((a) => (
                  <tr key={a.id}>
                    <td style={{ ...styles.td, fontWeight: 600 }}>
                      {a.isEmergency && (
                        <span style={{ marginRight: 6, padding: '2px 6px', fontSize: 10, fontWeight: 700, color: '#B71C1C', background: '#FEE2E2', borderRadius: 4 }}>
                          EMERGENCY
                        </span>
                      )}
                      {a.subject}
                    </td>
                    <td style={styles.td}>{a.channels}</td>
                    <td style={{ ...styles.td, color: '#64748B' }}>{a.sentAt ? formatDate(a.sentAt) : '—'}</td>
                    <td style={styles.td}>{a.delivered}</td>
                    <td style={{ ...styles.td, color: '#166534', fontWeight: 600 }}>{a.opened}</td>
                    <td style={styles.td}>{a.delivered > 0 ? `${a.openRate}%` : '—'}</td>
                    <td style={{ ...styles.td, color: a.failed > 0 ? '#B71C1C' : '#94A3B8' }}>{a.failed}</td>
                  </tr>
                ))}
                {data.announcements.length === 0 && (
                  <tr><td colSpan={7} style={styles.empty}>No announcements sent in this window.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    />
  );
}
