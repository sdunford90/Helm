import { formatDateOnly } from '../../../lib/format';
import { KpiTile, ReportPage, styles } from '../_lib/ReportPage';

interface Period {
  id: string;
  location: string;
  locationId: string;
  periodStart: string;
  periodEnd: string;
  closedAt: string | null;
  notes: string | null;
}
interface PeriodCloseData {
  total: number;
  closed: number;
  open: number;
  closeRate: number;
  periods: Period[];
}

export default function PeriodCloseReport() {
  return (
    <ReportPage<PeriodCloseData>
      title="Period Close"
      subtitle="Open vs. closed accounting periods across locations. The list below shows close attestations and any operator notes."
      apiPath="/api/reports/period-close"
      enableDateRange={false}
      render={(data) => (
        <>
          <div style={styles.kpiRow}>
            <KpiTile label="Periods tracked" value={data.total} />
            <KpiTile label="Closed" value={data.closed} accent="#166534" />
            <KpiTile label="Open" value={data.open} accent={data.open > 0 ? '#F59E0B' : '#166534'} />
            <KpiTile label="Close rate" value={`${data.closeRate}%`} accent="#0EA5E9" />
          </div>

          <div style={styles.card}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Location</th>
                  <th style={styles.th}>Period</th>
                  <th style={styles.th}>Status</th>
                  <th style={styles.th}>Closed</th>
                  <th style={styles.th}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {data.periods.map((p) => (
                  <tr key={p.id}>
                    <td style={{ ...styles.td, fontWeight: 600 }}>{p.location}</td>
                    <td style={styles.td}>
                      {formatDateOnly(p.periodStart)} — {formatDateOnly(p.periodEnd)}
                    </td>
                    <td style={{
                      ...styles.td,
                      fontWeight: 700,
                      color: p.closedAt ? '#166534' : '#F59E0B',
                    }}>
                      {p.closedAt ? 'CLOSED' : 'OPEN'}
                    </td>
                    <td style={{ ...styles.td, color: '#64748B' }}>{p.closedAt ? formatDateOnly(p.closedAt) : '—'}</td>
                    <td style={{ ...styles.td, color: '#64748B', fontSize: 12 }}>{p.notes ?? '—'}</td>
                  </tr>
                ))}
                {data.periods.length === 0 && (
                  <tr><td colSpan={5} style={styles.empty}>No periods configured yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    />
  );
}
