import { formatCents } from '../../../lib/format';
import { KpiTile, ReportPage, styles } from '../_lib/ReportPage';

interface ReconciliationData {
  period: { startDate: string; endDate: string };
  glRevenueCents: number;
  stripeCollectedCents: number;
  stripePaymentCount: number;
  invoicedCents: number;
  invoiceCount: number;
  refundsCents: number;
  varianceCents: number;
}

export default function ReconciliationReport() {
  return (
    <ReportPage<ReconciliationData>
      title="Reconciliation"
      subtitle="Three-way check across the GL, Stripe-completed payments, and invoiced amounts. Positive variance means revenue recognized without seen cash; negative means cash arrived without a posted journal."
      apiPath="/api/reports/reconciliation"
      render={(data) => {
        const tolerance = Math.abs(data.varianceCents) < 100;
        const variance = data.varianceCents;
        return (
          <>
            <div style={styles.kpiRow}>
              <KpiTile label="GL revenue" value={formatCents(data.glRevenueCents)} accent="#7E22CE" />
              <KpiTile
                label="Stripe collected"
                value={formatCents(data.stripeCollectedCents)}
                accent="#0EA5E9"
                sub={`${data.stripePaymentCount} card payments`}
              />
              <KpiTile
                label="Invoiced"
                value={formatCents(data.invoicedCents)}
                accent="#166534"
                sub={`${data.invoiceCount} invoices`}
              />
              <KpiTile
                label="Refunds"
                value={formatCents(data.refundsCents)}
                accent={data.refundsCents > 0 ? '#9A3412' : '#94A3B8'}
              />
              <KpiTile
                label="Variance"
                value={formatCents(variance)}
                accent={tolerance ? '#166534' : variance > 0 ? '#F59E0B' : '#B71C1C'}
                sub={tolerance ? 'within $1 tolerance' : variance > 0 ? 'recognized > collected' : 'collected > recognized'}
              />
            </div>

            <div style={styles.card}>
              <div style={{ padding: 20 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#0A2342', marginBottom: 8 }}>
                  Variance formula
                </div>
                <code style={{ fontSize: 12, color: '#475569', display: 'block', background: '#F8FAFC', padding: 12, borderRadius: 6 }}>
                  variance = GL revenue − (Stripe collected − Refunds)<br />
                  = {formatCents(data.glRevenueCents)} − ({formatCents(data.stripeCollectedCents)} − {formatCents(data.refundsCents)})<br />
                  = {formatCents(variance)}
                </code>
                <div style={{ fontSize: 12, color: '#64748B', marginTop: 12, lineHeight: 1.6 }}>
                  A variance under $1 is the normal monthly-close target. Larger amounts mean either revenue was recognized
                  on manual receipts that haven't been reconciled to Stripe, or that cash arrived through a non-card rail
                  (ACH/cash/check) that this card-rail comparison doesn't capture. Use Cash Flow + Card Rail Mix to drill in.
                </div>
              </div>
            </div>
          </>
        );
      }}
    />
  );
}
