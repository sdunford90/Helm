import { formatCents } from '../../../lib/format';
import { KpiTile, ReportPage, styles } from '../_lib/ReportPage';

interface AccountRow {
  accountNumber: string;
  name: string;
  type: 'REVENUE' | 'EXPENSE';
  debitsCents: number;
  creditsCents: number;
  netCents: number;
}
interface PnlData {
  period: { startDate: string; endDate: string };
  revenue: AccountRow[];
  revenueTotalCents: number;
  expense: AccountRow[];
  expenseTotalCents: number;
  netIncomeCents: number;
}

export default function PnlReport() {
  return (
    <ReportPage<PnlData>
      title="P&L / Income Statement"
      subtitle="Revenue and expense from the GL for the chosen window, plus the net-income summary an accountant signs off at close."
      apiPath="/api/reports/pnl"
      render={(data) => (
        <>
          <div style={styles.kpiRow}>
            <KpiTile label="Revenue" value={formatCents(data.revenueTotalCents)} accent="#166534" />
            <KpiTile label="Expense" value={formatCents(data.expenseTotalCents)} accent="#9A3412" />
            <KpiTile
              label="Net income"
              value={formatCents(data.netIncomeCents)}
              accent={data.netIncomeCents >= 0 ? '#166534' : '#B71C1C'}
            />
          </div>

          <div style={styles.sectionTitle}>Revenue</div>
          <div style={styles.card}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>#</th>
                  <th style={styles.th}>Account</th>
                  <th style={styles.th}>Debits</th>
                  <th style={styles.th}>Credits</th>
                  <th style={styles.th}>Net</th>
                </tr>
              </thead>
              <tbody>
                {data.revenue.map((a) => (
                  <tr key={a.accountNumber}>
                    <td style={{ ...styles.td, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: '#64748B' }}>{a.accountNumber}</td>
                    <td style={{ ...styles.td, fontWeight: 600 }}>{a.name}</td>
                    <td style={{ ...styles.td, color: '#64748B' }}>{formatCents(a.debitsCents)}</td>
                    <td style={{ ...styles.td, color: '#64748B' }}>{formatCents(a.creditsCents)}</td>
                    <td style={{ ...styles.td, color: '#166534', fontWeight: 600 }}>{formatCents(a.netCents)}</td>
                  </tr>
                ))}
                {data.revenue.length === 0 && (
                  <tr><td colSpan={5} style={styles.empty}>No revenue accounts posted in this window.</td></tr>
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td style={{ ...styles.td, fontWeight: 700 }} colSpan={4}>Total revenue</td>
                  <td style={{ ...styles.td, fontWeight: 700, color: '#166534' }}>{formatCents(data.revenueTotalCents)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div style={styles.sectionTitle}>Expense</div>
          <div style={styles.card}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>#</th>
                  <th style={styles.th}>Account</th>
                  <th style={styles.th}>Debits</th>
                  <th style={styles.th}>Credits</th>
                  <th style={styles.th}>Net</th>
                </tr>
              </thead>
              <tbody>
                {data.expense.map((a) => (
                  <tr key={a.accountNumber}>
                    <td style={{ ...styles.td, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: '#64748B' }}>{a.accountNumber}</td>
                    <td style={{ ...styles.td, fontWeight: 600 }}>{a.name}</td>
                    <td style={{ ...styles.td, color: '#64748B' }}>{formatCents(a.debitsCents)}</td>
                    <td style={{ ...styles.td, color: '#64748B' }}>{formatCents(a.creditsCents)}</td>
                    <td style={{ ...styles.td, color: '#9A3412', fontWeight: 600 }}>{formatCents(a.netCents)}</td>
                  </tr>
                ))}
                {data.expense.length === 0 && (
                  <tr><td colSpan={5} style={styles.empty}>No expense accounts posted in this window.</td></tr>
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td style={{ ...styles.td, fontWeight: 700 }} colSpan={4}>Total expense</td>
                  <td style={{ ...styles.td, fontWeight: 700, color: '#9A3412' }}>{formatCents(data.expenseTotalCents)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    />
  );
}
