import { KpiTile, ReportPage, styles } from '../_lib/ReportPage';

interface StageRow { stage: string; count: number; }
interface SourceRow { source: string; count: number; }
interface PipelineData {
  period: { startDate: string; endDate: string };
  totalLeads: number;
  won: number;
  lost: number;
  conversionRate: string;
  byStage: StageRow[];
  bySource: SourceRow[];
}

const STAGE_LABEL: Record<string, string> = {
  NEW: 'New',
  CONTACTED: 'Contacted',
  QUALIFIED: 'Qualified',
  TOURED: 'Toured',
  PROPOSAL: 'Proposal sent',
  WON: 'Won',
  LOST: 'Lost',
};

export default function PipelineReport() {
  return (
    <ReportPage<PipelineData>
      title="Pipeline & Lead Conversion"
      subtitle="Lead volume in the window, stage-by-stage funnel, and where the converting leads are coming from."
      apiPath="/api/reports/lead-conversion"
      render={(data) => (
        <>
          <div style={styles.kpiRow}>
            <KpiTile label="Leads created" value={data.totalLeads} />
            <KpiTile label="Won" value={data.won} accent="#166534" />
            <KpiTile label="Lost" value={data.lost} accent="#B71C1C" />
            <KpiTile label="Conversion" value={`${data.conversionRate}%`} accent="#0EA5E9" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div style={styles.card}>
              <div style={{ ...styles.sectionTitle, margin: '12px 16px 4px' }}>Stage funnel</div>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Stage</th>
                    <th style={styles.th}>Count</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byStage.map((s) => (
                    <tr key={s.stage}>
                      <td style={{ ...styles.td, fontWeight: 600 }}>{STAGE_LABEL[s.stage] ?? s.stage}</td>
                      <td style={styles.td}>{s.count}</td>
                    </tr>
                  ))}
                  {data.byStage.length === 0 && (
                    <tr><td colSpan={2} style={styles.empty}>No leads yet.</td></tr>
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
                  {data.bySource
                    .slice()
                    .sort((a, b) => b.count - a.count)
                    .map((s) => (
                      <tr key={s.source}>
                        <td style={{ ...styles.td, fontWeight: 600 }}>{s.source}</td>
                        <td style={styles.td}>{s.count}</td>
                      </tr>
                    ))}
                  {data.bySource.length === 0 && (
                    <tr><td colSpan={2} style={styles.empty}>No leads in this window.</td></tr>
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
