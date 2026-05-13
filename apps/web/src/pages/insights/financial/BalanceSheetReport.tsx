import { formatCents, formatDateOnly } from '../../../lib/format';
import { KpiTile, ReportPage, styles } from '../_lib/ReportPage';

interface AccountRow {
  accountNumber: string;
  name: string;
  type: 'ASSET' | 'LIABILITY' | 'EQUITY';
  balanceCents: number;
}
interface BalanceSheetData {
  asOf: string;
  assets: AccountRow[];
  assetsTotalCents: number;
  liabilities: AccountRow[];
  liabilitiesTotalCents: number;
  equity: AccountRow[];
  equityTotalCents: number;
  balanceCheckCents: number;
}

function Section({ title, accent, rows, totalCents }: { title: string; accent: string; rows: AccountRow[]; totalCents: number }) {
  return (
    <>
      <div style={styles.sectionTitle}>{title}</div>
      <div style={styles.card}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>#</th>
              <th style={styles.th}>Account</th>
              <th style={styles.th}>Balance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.accountNumber}>
                <td style={{ ...styles.td, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: '#64748B' }}>{a.accountNumber}</td>
                <td style={{ ...styles.td, fontWeight: 600 }}>{a.name}</td>
                <td style={{ ...styles.td, color: accent, fontWeight: 600 }}>{formatCents(a.balanceCents)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={3} style={styles.empty}>No accounts.</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td style={{ ...styles.td, fontWeight: 700 }} colSpan={2}>Total {title.toLowerCase()}</td>
              <td style={{ ...styles.td, fontWeight: 700, color: accent }}>{formatCents(totalCents)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}

export default function BalanceSheetReport() {
  return (
    <ReportPage<BalanceSheetData>
      title="Balance Sheet"
      subtitle="As-of-date snapshot of every ASSET, LIABILITY, and EQUITY account in the GL. The 'books balanced' KPI should always be $0.00; anything else is a posting error."
      apiPath="/api/reports/balance-sheet"
      render={(data) => (
        <>
          <div style={styles.kpiRow}>
            <KpiTile label="As of" value={formatDateOnly(data.asOf)} />
            <KpiTile label="Assets" value={formatCents(data.assetsTotalCents)} accent="#0EA5E9" />
            <KpiTile label="Liabilities" value={formatCents(data.liabilitiesTotalCents)} accent="#9A3412" />
            <KpiTile label="Equity" value={formatCents(data.equityTotalCents)} accent="#7E22CE" />
            <KpiTile
              label="Books balanced"
              value={formatCents(data.balanceCheckCents)}
              accent={Math.abs(data.balanceCheckCents) < 100 ? '#166534' : '#B71C1C'}
              sub={Math.abs(data.balanceCheckCents) < 100 ? 'within $1 tolerance' : 'investigate variance'}
            />
          </div>

          <Section title="Assets" accent="#0EA5E9" rows={data.assets} totalCents={data.assetsTotalCents} />
          <Section title="Liabilities" accent="#9A3412" rows={data.liabilities} totalCents={data.liabilitiesTotalCents} />
          <Section title="Equity" accent="#7E22CE" rows={data.equity} totalCents={data.equityTotalCents} />
        </>
      )}
    />
  );
}
