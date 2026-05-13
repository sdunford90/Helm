import { KpiTile, ReportPage, styles } from '../_lib/ReportPage';

interface TriggerRow {
  trigger: string;
  sent: number;
  failed: number;
  queued: number;
  total: number;
  successRate: number;
}
interface AutomationsData {
  period: { startDate: string; endDate: string };
  byTrigger: TriggerRow[];
}

export default function AutomationsReport() {
  return (
    <ReportPage<AutomationsData>
      title="Automations"
      subtitle="Rule-by-rule performance for the EmailAutomation engine. Spot the trigger that's silently failing before customers do."
      apiPath="/api/reports/automation-rules"
      render={(data) => {
        const totals = data.byTrigger.reduce(
          (acc, t) => ({
            sent: acc.sent + t.sent,
            failed: acc.failed + t.failed,
            queued: acc.queued + t.queued,
            total: acc.total + t.total,
          }),
          { sent: 0, failed: 0, queued: 0, total: 0 },
        );
        const overallRate = totals.total > 0 ? (totals.sent / totals.total) * 100 : 0;
        return (
          <>
            <div style={styles.kpiRow}>
              <KpiTile label="Runs" value={totals.total} />
              <KpiTile label="Sent" value={totals.sent} accent="#166534" />
              <KpiTile label="Failed" value={totals.failed} accent={totals.failed > 0 ? '#B71C1C' : '#94A3B8'} />
              <KpiTile label="Queued" value={totals.queued} />
              <KpiTile
                label="Overall success"
                value={totals.total > 0 ? `${overallRate.toFixed(1)}%` : '—'}
                accent={overallRate >= 99 ? '#166534' : overallRate >= 95 ? '#F59E0B' : '#B71C1C'}
              />
            </div>

            <div style={styles.sectionTitle}>By trigger</div>
            <div style={styles.card}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Trigger</th>
                    <th style={styles.th}>Sent</th>
                    <th style={styles.th}>Failed</th>
                    <th style={styles.th}>Queued</th>
                    <th style={styles.th}>Total</th>
                    <th style={styles.th}>Success rate</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byTrigger.map((t) => (
                    <tr key={t.trigger}>
                      <td style={{ ...styles.td, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 }}>{t.trigger}</td>
                      <td style={{ ...styles.td, color: '#166534' }}>{t.sent}</td>
                      <td style={{ ...styles.td, color: t.failed > 0 ? '#B71C1C' : '#94A3B8', fontWeight: 600 }}>{t.failed}</td>
                      <td style={styles.td}>{t.queued}</td>
                      <td style={{ ...styles.td, fontWeight: 600 }}>{t.total}</td>
                      <td style={{
                        ...styles.td,
                        fontWeight: 600,
                        color: t.successRate >= 99 ? '#166534' : t.successRate >= 95 ? '#F59E0B' : '#B71C1C',
                      }}>
                        {t.total > 0 ? `${t.successRate}%` : '—'}
                      </td>
                    </tr>
                  ))}
                  {data.byTrigger.length === 0 && (
                    <tr><td colSpan={6} style={styles.empty}>No automation runs in this window.</td></tr>
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
