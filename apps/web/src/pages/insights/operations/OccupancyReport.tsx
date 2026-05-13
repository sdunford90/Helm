import { Anchor } from 'lucide-react';
import { KpiTile, ReportPage, styles } from '../_lib/ReportPage';

interface DockRow {
  dock: string | null;
  total: number;
  occupied: number;
  maintenance: number;
  vacant: number;
  rate: string;
}
interface OccupancyData {
  summary: { total: number; occupied: number; vacant: number; maintenance: number; reserved: number; occupancyRate: string };
  byDock: DockRow[];
}

export default function OccupancyReport() {
  return (
    <ReportPage<OccupancyData>
      title="Slip Occupancy"
      subtitle="How many slips are leased right now, broken down by dock — and the maintenance & reservation overhead that's eating into capacity."
      apiPath="/api/reports/occupancy"
      enableDateRange={false}
      render={(data) => {
        const { summary, byDock } = data;
        return (
          <>
            <div style={styles.kpiRow}>
              <KpiTile label="Occupancy" value={`${summary.occupancyRate}%`} accent="#0EA5E9" />
              <KpiTile label="Occupied" value={summary.occupied} sub={`of ${summary.total}`} />
              <KpiTile label="Vacant" value={summary.vacant} />
              <KpiTile label="Reserved" value={summary.reserved} />
              <KpiTile label="Maintenance" value={summary.maintenance} accent="#F59E0B" />
            </div>

            <div style={styles.card}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}><Anchor size={12} style={{ marginRight: 6, verticalAlign: 'middle' }} />Dock</th>
                    <th style={styles.th}>Total slips</th>
                    <th style={styles.th}>Occupied</th>
                    <th style={styles.th}>Vacant</th>
                    <th style={styles.th}>Maintenance</th>
                    <th style={styles.th}>Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {byDock.map((d) => (
                    <tr key={d.dock ?? '_none'}>
                      <td style={{ ...styles.td, fontWeight: 600 }}>{d.dock ?? '— No dock —'}</td>
                      <td style={styles.td}>{d.total}</td>
                      <td style={{ ...styles.td, color: '#166534', fontWeight: 600 }}>{d.occupied}</td>
                      <td style={styles.td}>{d.vacant}</td>
                      <td style={{ ...styles.td, color: d.maintenance > 0 ? '#9A3412' : '#94A3B8' }}>{d.maintenance}</td>
                      <td style={styles.td}><strong>{d.rate}%</strong></td>
                    </tr>
                  ))}
                  {byDock.length === 0 && (
                    <tr><td colSpan={6} style={styles.empty}>No slips configured.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        );
      }}
    />
  );
}
