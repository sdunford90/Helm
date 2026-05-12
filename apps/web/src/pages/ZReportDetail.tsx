// Z-Report detail page (Task #320). Renders the locked snapshot in a
// printable layout with Print + Email actions. Read-only by design.
import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '@clerk/clerk-react';
import { ArrowLeft, Printer, Mail, Loader2, AlertTriangle } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { api } from '../lib/api';
import type { PosZOutSnapshot, ZReport } from '@helm/shared-types';

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

export default function ZReportDetail() {
  const { id } = useParams<{ id: string }>();
  const { getToken } = useAuth();
  const { data, loading, error } = useApi<ZReport & { snapshot: PosZOutSnapshot }>(
    'get',
    `/api/pos/z-reports/${id}`,
    { immediate: true },
  );

  const [emailTo, setEmailTo] = useState('');
  const [emailing, setEmailing] = useState(false);
  const [emailMsg, setEmailMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const handlePrint = () => window.print();

  const handleEmail = async () => {
    if (!id) return;
    setEmailing(true);
    setEmailMsg(null);
    try {
      const token = await getToken();
      // Empty `emailTo` → server falls back to the location's
      // configured Z-report distribution list.
      const body: { to?: string } = {};
      const trimmed = emailTo.trim();
      if (trimmed) body.to = trimmed;
      await api.post(`/api/pos/z-reports/${id}/email`, body, token);
      setEmailMsg({
        kind: 'ok',
        text: trimmed ? `Sent to ${trimmed}` : 'Sent to configured distribution list',
      });
      setEmailTo('');
    } catch (err) {
      setEmailMsg({
        kind: 'err',
        text: (err as Error).message ?? 'Failed to send email',
      });
    } finally {
      setEmailing(false);
    }
  };

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
          {(error as unknown as Error)?.message ?? String(error ?? '') ?? 'Z-report not found'}
        </div>
      </div>
    );
  }

  const s = data.snapshot;

  return (
    <div style={{ padding: 32, maxWidth: 720, margin: '0 auto' }}>
      {/* No-print toolbar */}
      <div className="noprint" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <Link
          to="/pos/z-reports"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            color: NAVY,
            textDecoration: 'none',
            fontSize: 14,
          }}
        >
          <ArrowLeft size={16} /> All Z-reports
        </Link>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
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

      {/* Email form */}
      <div
        className="noprint"
        style={{
          display: 'flex',
          gap: 8,
          marginBottom: 24,
          padding: 12,
          background: '#F8FAFC',
          border: '1px solid #E2E8F0',
          borderRadius: 6,
        }}
      >
        <Mail size={18} color="#64748B" style={{ alignSelf: 'center' }} />
        <input
          type="email"
          placeholder="Leave blank to use configured list"
          value={emailTo}
          onChange={(e) => setEmailTo(e.target.value)}
          style={{
            flex: 1,
            padding: '8px 12px',
            border: '1px solid #CBD5E1',
            borderRadius: 6,
            fontSize: 14,
          }}
        />
        <button
          disabled={emailing}
          onClick={handleEmail}
          style={{
            padding: '8px 16px',
            background: NAVY,
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            fontSize: 14,
            fontWeight: 600,
            cursor: emailing ? 'wait' : 'pointer',
            opacity: emailing ? 0.6 : 1,
          }}
        >
          {emailing ? 'Sending…' : 'Send'}
        </button>
        {emailMsg && (
          <span
            style={{
              alignSelf: 'center',
              fontSize: 13,
              color: emailMsg.kind === 'ok' ? '#059669' : '#DC2626',
            }}
          >
            {emailMsg.text}
          </span>
        )}
      </div>

      {/* Printable card */}
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
            Z-Report
          </div>
          <div style={{ fontSize: 32, fontWeight: 700, margin: '4px 0' }}>
            #{data.zNumber}
          </div>
          <div style={{ fontSize: 13, color: '#475569' }}>
            {new Date(data.generatedAt).toLocaleString()}
          </div>
          {s.cashierName && (
            <div style={{ fontSize: 13, color: '#475569' }}>Cashier: {s.cashierName}</div>
          )}
          <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 4 }}>
            Shift {data.shiftId.slice(0, 8)} · {new Date(s.openedAt).toLocaleTimeString()} →{' '}
            {s.closedAt ? new Date(s.closedAt).toLocaleTimeString() : '—'}
          </div>
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
        {row('Counted', fmt(s.cashDrawer.countedCents))}
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
              <div key={c.categoryId ?? c.categoryName}>
                {row(c.categoryName, fmt(c.netCents))}
              </div>
            ))}
          </>
        )}

        {s.topProducts.length > 0 && (
          <>
            <div style={sec}>Top products</div>
            {s.topProducts.map((p, i) => (
              <div key={p.productId ?? `p-${i}`}>
                {row(`${p.productName} × ${p.quantity}`, fmt(p.netCents))}
              </div>
            ))}
          </>
        )}

        {s.discountsApplied.length > 0 && (
          <>
            <div style={sec}>Discounts applied</div>
            {s.discountsApplied.map((d) => (
              <div key={d.label}>
                {row(`${d.label} (${d.count})`, `-${fmt(d.totalCents)}`)}
              </div>
            ))}
          </>
        )}

        {s.refundsList.length > 0 && (
          <>
            <div style={sec}>Refunds ({s.refundsList.length})</div>
            {s.refundsList.map((r) => (
              <div key={r.transactionId}>
                {row(
                  `${new Date(r.refundedAt).toLocaleTimeString()} · ${r.transactionId.slice(0, 8)}`,
                  fmt(r.totalCents),
                )}
              </div>
            ))}
          </>
        )}

        {s.tenderReconciliation && s.tenderReconciliation.diffCents !== 0 && (
          <div
            style={{
              marginTop: 16,
              padding: 12,
              background: '#FEE2E2',
              color: '#991B1B',
              borderRadius: 6,
              fontSize: 13,
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
            }}
          >
            <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>
                Tenders do not reconcile to revenue
              </div>
              <div>
                Revenue + tax + tips total {fmt(s.tenderReconciliation.expectedCents)} but
                recorded tenders total {fmt(s.tenderReconciliation.actualCents)} (gap{' '}
                {fmt(s.tenderReconciliation.diffCents)}).
              </div>
              {s.tenderReconciliation.missingTenderRowIds.length > 0 && (
                <div style={{ marginTop: 4 }}>
                  {s.tenderReconciliation.missingTenderRowIds.length} sale(s) have no
                  recorded payment row:{' '}
                  <span style={{ fontFamily: 'monospace', fontSize: 12 }}>
                    {s.tenderReconciliation.missingTenderRowIds.join(', ')}
                  </span>
                </div>
              )}
            </div>
          </div>
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

        {data.notes && (
          <div
            style={{
              marginTop: 16,
              padding: 12,
              background: '#F8FAFC',
              border: '1px solid #E2E8F0',
              borderRadius: 6,
              fontSize: 13,
            }}
          >
            <div
              style={{
                fontSize: 11,
                color: '#64748B',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                marginBottom: 4,
              }}
            >
              Notes
            </div>
            {data.notes}
          </div>
        )}

        <div
          style={{
            marginTop: 16,
            paddingTop: 12,
            borderTop: '1px solid #E2E8F0',
            fontSize: 11,
            color: '#94A3B8',
            textAlign: 'center',
          }}
        >
          Locked snapshot · read-only · GL journal {data.glJournalId ?? 'none (zero-sum shift)'}
        </div>
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
