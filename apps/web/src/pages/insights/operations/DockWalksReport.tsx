import { KpiTile, ReportPage, styles } from '../_lib/ReportPage';

interface ViolationRow { type: string; count: number; }
interface DockWalkData {
  period: { startDate: string; endDate: string };
  totalWalks: number;
  completed: number;
  completionRate: string;
  violationsByType: ViolationRow[];
  totalViolations: number;
  pumpOuts: number;
}

export default function DockWalksReport() {
  return (
    <ReportPage<DockWalkData>
      title="Dock Walks"
      subtitle="How many walks were run, completion rate by staff, and which violation categories repeat most."
      apiPath="/api/reports/dock-walk-summary"
      render={(data) => (
        <>
          <div style={styles.kpiRow}>
            <KpiTile label="Walks started" value={data.totalWalks} />
            <KpiTile label="Completed" value={data.completed} accent="#166534" />
            <KpiTile label="Completion rate" value={`${data.completionRate}%`} accent="#0EA5E9" />
            <KpiTile label="Total findings" value={data.totalViolations} accent="#9A3412" />
            <KpiTile label="Pump-outs" value={data.pumpOuts} />
          </div>

          <div style={styles.sectionTitle}>Findings by category</div>
          <div style={styles.card}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Category</th>
                  <th style={styles.th}>Count</th>
                  <th style={styles.th}>Share</th>
                </tr>
              </thead>
              <tbody>
                {data.violationsByType.sort((a, b) => b.count - a.count).map((v) => (
                  <tr key={v.type}>
                    <td style={{ ...styles.td, fontWeight: 600 }}>{v.type}</td>
                    <td style={styles.td}>{v.count}</td>
                    <td style={styles.td}>
                      {data.totalViolations > 0 ? `${((v.count / data.totalViolations) * 100).toFixed(1)}%` : '—'}
                    </td>
                  </tr>
                ))}
                {data.violationsByType.length === 0 && (
                  <tr><td colSpan={3} style={styles.empty}>No findings recorded in this window.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    />
  );
}
