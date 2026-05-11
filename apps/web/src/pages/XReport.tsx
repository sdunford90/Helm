// X-Report preview page (Task #320). Read-only mid-shift / pre-Z-out
// snapshot of any shift the caller can see. Renders the same printable
// layout as the locked Z-report so managers can spot-check totals,
// declared tenders, and cash-drawer math before committing to Z-out.
//
// Wired at /pos/x-report/:shiftId. Calls GET /api/pos/shifts/:id/x-report
// (never writes). The page is intentionally separate from /pos/z-reports
// because X-reports have no Z number, no GL journal, and no email step —
// they're a preview, not a record.
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Printer, Loader2, AlertTriangle } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import type { PosZOutSnapshot } from '@helm/shared-types';

const NAVY = '#0A2342';

function fmt(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

const sec: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  color: '#64748B',
  borderBottom: '1px solid #E2E8F0',
  padding: '14px 0 6px',
  marginTop: 12,
};

const row = (
  label: React.ReactNode,
  value: React.ReactNode,
  bold = false,
): React.ReactElement => (
  <div
    style={{
      display: 'flex',
      justifyContent: 'space-between',
      padding: '5px 0',
      fontWeight: bold ? 700 : 400,
      fontVariantNumeric: 'tabular-nums',
      fontSize: 13,
    }}
  >
    <span>{label}</span>
    <span>{value}</span>
  </div>
);

export default function XReport() {
  const { shiftId } = useParams<{ shiftId: string }>();
  const { data, loading, error } = useApi<{ snapshot: PosZOutSnapshot; shiftStatus: string }>(
    'get',
    `/api/pos/shifts/${shiftId}/x-report`,
    { immediate: true },
  );

  const handlePrint = () => window.print();

  if (loading) {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: '#64748B' }}>
        <Loader2 size={24} className="spin" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div style={{ padding: 32 }}>
        <div style={{ padding: 16, background: '#FEE2E2', borderRadius: 6, color: '#991B1B' }}>
          {(error as unknown as Error)?.message ?? String(error ?? '') ?? 'Shift not found'}
        </div>
      </div>
    );
  }

  const s = data.snapshot;
  const isLive = data.shiftStatus === 'OPEN';

  return (
    <div style={{ padding: 32, maxWidth: 720, margin: '0 auto' }}>
      <div className="noprint" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <Link
          to="/pos"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            color: NAVY,
            textDecoration: 'none',
            fontSize: 14,
          }}
        >
          <ArrowLeft size={16} /> Back to POS
        </Link>
        <div style={{ marginLeft: 'auto' }}>
          <button
            onClick={handlePrint}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 14px',
              background: '#fff',
              border: '1px solid #CBD5E1',
              borderRadius: 6,
              color: NAVY,
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <Printer size={14} /> Print
          </button>
        </div>
      </div>

      <div
        style={{
          background: '#fff',
          border: '1px solid #E2E8F0',
          borderRadius: 8,
          padding: 32,
          color: NAVY,
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <div
            style={{
              fontSize: 11,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: '#64748B',
            }}
          >
            X-Report (preview)
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, margin: '4px 0' }}>
            {isLive ? 'Live shift' : 'Closed shift'}
          </div>
          <div style={{ fontSize: 13, color: '#475569' }}>
            Generated {new Date().toLocaleString()}
          </div>
          {s.cashierName && (
            <div style={{ fontSize: 13, color: '#475569' }}>Cashier: {s.cashierName}</div>
          )}
          <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 4 }}>
            Shift {(shiftId ?? '').slice(0, 8)} · {new Date(s.openedAt).toLocaleTimeString()} →{' '}
            {s.closedAt ? new Date(s.closedAt).toLocaleTimeString() : 'in progress'}
          </div>
        </div>

        <div
          style={{
            margin: '8px 0 16px',
            padding: 10,
            background: '#FEF3C7',
            color: '#92400E',
            borderRadius: 6,
            fontSize: 12,
            textAlign: 'center',
          }}
        >
          Not a final record. Run Z-out from the Z-Reports page to lock these totals.
        </div>

        <div style={sec}>Sales</div>
        {row('Gross sales', fmt(s.grossSalesCents))}
        {row('Discounts', `-${fmt(s.discountsCents)}`)}
        {row('Refunds', `-${fmt(s.refundsCents)}`)}
        {row('Net sales', fmt(s.netSalesCents), true)}
        {row('Tax', fmt(s.taxCents))}
        {row('Tips', fmt(s.tipsCents))}
        {row('Grand total', fmt(s.totalCents), true)}

        <div style={sec}>Tenders (net of refunds)</div>
        {row('Cash', fmt(s.tenders.cash.netCents))}
        {row(
          `Card — Terminal (${s.tenders.cardTerminal.count})`,
          fmt(s.tenders.cardTerminal.netCents),
        )}
        {row(`Card — CNP (${s.tenders.cardCnp.count})`, fmt(s.tenders.cardCnp.netCents))}
        {row('ACH', fmt(s.tenders.ach.netCents))}
        {row('Check (declared)', fmt(s.tenders.check.declaredCents))}
        {row(
          `Charge to A/R (${s.tenders.chargeToAr.count})`,
          fmt(s.tenders.chargeToAr.netCents),
        )}
        {row('Other (declared)', fmt(s.tenders.other.declaredCents))}

        <div style={sec}>Cash drawer</div>
        {row('Opening float', fmt(s.cashDrawer.openingFloatCents))}
        {row('Cash sales', `+${fmt(s.cashDrawer.cashSalesCents)}`)}
        {row('Cash refunds', `-${fmt(s.cashDrawer.cashRefundsCents)}`)}
        {row('Paid-outs', `-${fmt(s.cashDrawer.paidOutsCents)}`)}
        {row('Expected', fmt(s.cashDrawer.expectedCents), true)}
        {row(
          'Counted',
          s.cashDrawer.countedCents > 0 ? fmt(s.cashDrawer.countedCents) : '— not counted',
        )}
        {row(
          'Variance',
          <span
            style={{
              color:
                s.cashDrawer.varianceCents === 0
                  ? '#059669'
                  : s.cashDrawer.varianceCents > 0
                    ? '#059669'
                    : '#DC2626',
            }}
          >
            {s.cashDrawer.varianceCents >= 0 ? '+' : ''}
            {fmt(s.cashDrawer.varianceCents)}
          </span>,
          true,
        )}

        {s.salesByCategory.length > 0 && (
          <>
            <div style={sec}>By category</div>
            {s.salesByCategory.map((c) => (
              <div key={c.categoryId ?? c.categoryName}>{row(c.categoryName, fmt(c.netCents))}</div>
            ))}
          </>
        )}

        <div style={sec}>Stripe verification</div>
        {row('POS card total', fmt(s.stripeMatching.expectedCardCents))}
        {row(
          s.stripeMatching.verifiedAgainstStripe
            ? 'Captured at Stripe'
            : 'Captured at Stripe (skipped — Stripe not configured)',
          `${fmt(s.stripeMatching.capturedSumCents)} · ${s.stripeMatching.capturedCount} PI`,
        )}
        {(s.stripeMatching.unmatchedRowIds.length > 0
          || s.stripeMatching.uncapturedRowIds.length > 0
          || s.stripeMatching.unverifiedRowIds.length > 0) && (
          <div
            style={{
              marginTop: 16,
              padding: 12,
              background: '#FEF3C7',
              color: '#92400E',
              borderRadius: 6,
              fontSize: 13,
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
            }}
          >
            <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              {s.stripeMatching.unmatchedRowIds.length > 0 && (
                <div>{s.stripeMatching.unmatchedRowIds.length} card sale(s) without a Stripe PaymentIntent id.</div>
              )}
              {s.stripeMatching.uncapturedRowIds.length > 0 && (
                <div>{s.stripeMatching.uncapturedRowIds.length} card sale(s) whose PaymentIntent has not succeeded.</div>
              )}
              {s.stripeMatching.unverifiedRowIds.length > 0 && (
                <div>{s.stripeMatching.unverifiedRowIds.length} card sale(s) whose PaymentIntent could not be retrieved from Stripe.</div>
              )}
            </div>
          </div>
        )}
      </div>

      <style>{`
        @media print {
          .noprint { display: none !important; }
          body, html { background: #fff !important; }
        }
      `}</style>
    </div>
  );
}
