import { formatCents } from '../../../lib/format';
import { KpiTile, ReportPage, styles } from '../_lib/ReportPage';

interface MethodRow { method: string; amountCents: number; }
interface CashFlowData {
  period: { startDate: string; endDate: string };
  cashInCents: number;
  cashByMethod: MethodRow[];
  refundsOutCents: number;
  poReceivedCents: number;
  poReceivedCount: number;
  netCashCents: number;
}

const METHOD_LABEL: Record<string, string> = {
  CARD: 'Card',
  ACH: 'ACH',
  CASH: 'Cash',
  CHECK: 'Check',
  OTHER: 'Other',
};

export default function CashFlowReport() {
  return (
    <ReportPage<CashFlowData>
      title="Cash Flow"
      subtitle="Direct-method cash flow for the window — payments collected (by rail) minus refunds and PO receipts. The Reconciliation report is the auditor's view on top of this."
      apiPath="/api/reports/cash-flow"
      render={(data) => (
        <>
          <div style={styles.kpiRow}>
            <KpiTile label="Cash in" value={formatCents(data.cashInCents)} accent="#166534" />
            <KpiTile label="Refunds out" value={formatCents(data.refundsOutCents)} accent="#9A3412" />
            <KpiTile
              label="PO receipts"
              value={formatCents(data.poReceivedCents)}
              accent="#9A3412"
              sub={`${data.poReceivedCount} PO${data.poReceivedCount === 1 ? '' : 's'}`}
            />
            <KpiTile
              label="Net cash"
              value={formatCents(data.netCashCents)}
              accent={data.netCashCents >= 0 ? '#166534' : '#B71C1C'}
            />
          </div>

          <div style={styles.sectionTitle}>Cash in by rail</div>
          <div style={styles.card}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Rail</th>
                  <th style={styles.th}>Amount</th>
                  <th style={styles.th}>Share</th>
                </tr>
              </thead>
              <tbody>
                {data.cashByMethod
                  .slice()
                  .sort((a, b) => b.amountCents - a.amountCents)
                  .map((m) => (
                    <tr key={m.method}>
                      <td style={{ ...styles.td, fontWeight: 600 }}>{METHOD_LABEL[m.method] ?? m.method}</td>
                      <td style={{ ...styles.td, color: '#166534', fontWeight: 600 }}>{formatCents(m.amountCents)}</td>
                      <td style={styles.td}>
                        {data.cashInCents > 0 ? `${((m.amountCents / data.cashInCents) * 100).toFixed(1)}%` : '—'}
                      </td>
                    </tr>
                  ))}
                {data.cashByMethod.length === 0 && (
                  <tr><td colSpan={3} style={styles.empty}>No payments collected in this window.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    />
  );
}
