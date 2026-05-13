import { formatCents, formatDateOnly } from '../../../lib/format';
import { KpiTile, ReportPage, styles } from '../_lib/ReportPage';

interface AtRisk {
  contractId: string;
  customerName: string;
  customerEmail: string | null;
  endDate: string | null;
  rateCents: number;
}
interface ChurnData {
  period: { startDate: string; endDate: string };
  endedContractCount: number;
  customersChurned: number;
  lostMrrCents: number;
  atRisk30Days: AtRisk[];
  atRiskMrrCents: number;
}

export default function ChurnReport() {
  return (
    <ReportPage<ChurnData>
      title="Churn"
      subtitle="Contracts that ended in the window, customers who left as a result, and the at-risk pipeline for the next 30 days."
      apiPath="/api/reports/churn"
      render={(data) => (
        <>
          <div style={styles.kpiRow}>
            <KpiTile label="Contracts ended" value={data.endedContractCount} accent="#B71C1C" />
            <KpiTile label="Customers churned" value={data.customersChurned} accent="#B71C1C" />
            <KpiTile label="Lost MRR" value={formatCents(data.lostMrrCents)} accent="#B71C1C" />
            <KpiTile
              label="At-risk MRR (30d)"
              value={formatCents(data.atRiskMrrCents)}
              accent={data.atRiskMrrCents > 0 ? '#F59E0B' : '#94A3B8'}
              sub={`${data.atRisk30Days.length} contracts`}
            />
          </div>

          <div style={styles.sectionTitle}>Expiring in the next 30 days (no auto-renew)</div>
          <div style={styles.card}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Customer</th>
                  <th style={styles.th}>Email</th>
                  <th style={styles.th}>Ends</th>
                  <th style={styles.th}>Monthly rate</th>
                </tr>
              </thead>
              <tbody>
                {data.atRisk30Days.map((c) => (
                  <tr key={c.contractId}>
                    <td style={{ ...styles.td, fontWeight: 600 }}>{c.customerName}</td>
                    <td style={styles.td}>{c.customerEmail ?? '—'}</td>
                    <td style={styles.td}>{c.endDate ? formatDateOnly(c.endDate) : '—'}</td>
                    <td style={{ ...styles.td, color: '#F59E0B', fontWeight: 600 }}>{formatCents(c.rateCents)}</td>
                  </tr>
                ))}
                {data.atRisk30Days.length === 0 && (
                  <tr><td colSpan={4} style={styles.empty}>Nothing expiring in the next 30 days.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    />
  );
}
