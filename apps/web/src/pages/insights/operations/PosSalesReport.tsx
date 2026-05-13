import { formatCents } from '../../../lib/format';
import { KpiTile, ReportPage, styles } from '../_lib/ReportPage';

interface PosData {
  period: { startDate: string; endDate: string };
  transactionCount: number;
  subtotalCents: number;
  taxCents: number;
  tipCents: number;
  totalCents: number;
  shiftCount: number;
}

export default function PosSalesReport() {
  return (
    <ReportPage<PosData>
      title="POS Sales"
      subtitle="Transactions, tax, tips, and shift counts across the cash drawer for the chosen window."
      apiPath="/api/reports/pos-sales"
      render={(data) => (
        <>
          <div style={styles.kpiRow}>
            <KpiTile label="Transactions" value={data.transactionCount} />
            <KpiTile label="Gross" value={formatCents(data.totalCents)} accent="#166534" />
            <KpiTile label="Subtotal" value={formatCents(data.subtotalCents)} />
            <KpiTile label="Tax collected" value={formatCents(data.taxCents)} />
            <KpiTile label="Tips" value={formatCents(data.tipCents)} accent="#0EA5E9" />
            <KpiTile label="Shifts" value={data.shiftCount} />
          </div>
          <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 8 }}>
            Drill-downs by terminal, category, void/refund mix land in Phase 5b.
          </div>
        </>
      )}
    />
  );
}
