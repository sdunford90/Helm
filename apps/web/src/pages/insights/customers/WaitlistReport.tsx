import { KpiTile, ReportPage, styles } from '../_lib/ReportPage';

interface Row { count: number; }
interface SlipTypeRow extends Row { slipType: string; }
interface StatusRow extends Row { status: string; }
interface WaitlistData {
  totalEntries: number;
  bySlipType: SlipTypeRow[];
  byStatus: StatusRow[];
}

export default function WaitlistReport() {
  return (
    <ReportPage<WaitlistData>
      title="Waitlist"
      subtitle="How deep the waitlist is, broken down by slip type and lifecycle status."
      apiPath="/api/reports/waitlist"
      enableDateRange={false}
      render={(data) => (
        <>
          <div style={styles.kpiRow}>
            <KpiTile label="Total entries" value={data.totalEntries} accent="#0EA5E9" />
            <KpiTile label="Slip types tracked" value={data.bySlipType.length} />
            <KpiTile label="Status buckets" value={data.byStatus.length} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div style={styles.card}>
              <div style={{ ...styles.sectionTitle, margin: '12px 16px 4px' }}>By slip type</div>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Slip type</th>
                    <th style={styles.th}>Entries</th>
                  </tr>
                </thead>
                <tbody>
                  {data.bySlipType
                    .slice()
                    .sort((a, b) => b.count - a.count)
                    .map((s) => (
                      <tr key={s.slipType}>
                        <td style={{ ...styles.td, fontWeight: 600 }}>{s.slipType ?? 'Unspecified'}</td>
                        <td style={styles.td}>{s.count}</td>
                      </tr>
                    ))}
                  {data.bySlipType.length === 0 && (
                    <tr><td colSpan={2} style={styles.empty}>No entries.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div style={styles.card}>
              <div style={{ ...styles.sectionTitle, margin: '12px 16px 4px' }}>By status</div>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Status</th>
                    <th style={styles.th}>Entries</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byStatus.map((s) => (
                    <tr key={s.status}>
                      <td style={{ ...styles.td, fontWeight: 600, textTransform: 'capitalize' }}>{s.status}</td>
                      <td style={styles.td}>{s.count}</td>
                    </tr>
                  ))}
                  {data.byStatus.length === 0 && (
                    <tr><td colSpan={2} style={styles.empty}>No entries.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    />
  );
}
