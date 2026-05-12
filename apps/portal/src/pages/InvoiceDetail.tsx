import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@clerk/clerk-react';
import { ArrowLeft, CreditCard, CheckCircle, Loader2, AlertCircle } from 'lucide-react';
import type { CSSProperties } from 'react';
import { usePortalApi, formatCents, formatDate } from '../lib/api';

const NAVY = '#0A2342';
const CYAN = '#00D4FF';

interface LineItem {
  id: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  taxCents: number;
  extendedCents: number;
}

interface Payment {
  id: string;
  amountCents: number;
  method: string;
  status: string;
  postedDate: string;
}

interface Invoice {
  id: string;
  invoiceNumber: string;
  status: string;
  issuedDate: string;
  dueDate: string;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  balanceCents: number;
  lineItems: LineItem[];
  payments: Payment[];
}

const card: CSSProperties = {
  background: '#fff',
  borderRadius: 12,
  padding: 24,
  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
};

export default function InvoiceDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { getToken } = useAuth();

  const { data, loading, error, execute } = usePortalApi<Invoice>(
    'get',
    `/api/portal/invoices/${id}`,
    { immediate: true },
  );
  useEffect(() => {
    void execute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  async function startPayment() {
    if (!data || data.balanceCents <= 0) return;
    setPaying(true);
    setPayError(null);
    try {
      const token = await getToken();
      const res = await fetch('/api/checkout/invoice-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          invoiceId: data.id,
          // Include the invoiceId in the return path so ThankYou.tsx can pass it
          // to the session-status endpoint — required to retrieve the session from
          // the correct location-specific Stripe account.
          returnPath: `/thank-you?invoiceId=${encodeURIComponent(data.id)}`,
          uiMode: 'hosted',
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      const { url } = (await res.json()) as { url?: string };
      if (!url) throw new Error('Checkout URL not returned');
      window.location.href = url;
    } catch (err) {
      setPayError(err instanceof Error ? err.message : 'Could not start payment');
      setPaying(false);
    }
  }

  if (loading) {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: '#64748B' }}>
        <Loader2 size={28} style={{ animation: 'spin 1s linear infinite' }} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ padding: 24 }}>
        <button
          onClick={() => navigate('/invoices')}
          style={{
            background: 'none',
            border: 'none',
            color: CYAN,
            fontSize: 13,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            cursor: 'pointer',
            marginBottom: 16,
          }}
        >
          <ArrowLeft size={14} /> Back to invoices
        </button>
        <div style={{ ...card, borderLeft: `4px solid #DC2626` }}>
          <div style={{ fontWeight: 600, color: '#DC2626', marginBottom: 8 }}>
            We couldn't load this invoice
          </div>
          <div style={{ color: '#64748B', fontSize: 13 }}>
            {error ?? 'Invoice not found.'}
          </div>
        </div>
      </div>
    );
  }

  const statusBadge = (status: string): CSSProperties => ({
    display: 'inline-block',
    padding: '4px 12px',
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 600,
    background:
      status === 'PAID' ? '#E6FAF0' :
      status === 'PAST_DUE' || status === 'COLLECTIONS' ? '#FFE6E6' :
      status === 'ISSUED' ? '#FFF8E6' : '#F1F5F9',
    color:
      status === 'PAID' ? '#0D9F6E' :
      status === 'PAST_DUE' || status === 'COLLECTIONS' ? '#DC2626' :
      status === 'ISSUED' ? '#D97706' : '#64748B',
  });

  const canPay = data.balanceCents > 0 && data.status !== 'VOID' && data.status !== 'PAID';

  return (
    <div>
      <button
        onClick={() => navigate('/invoices')}
        style={{
          background: 'none',
          border: 'none',
          color: CYAN,
          fontSize: 13,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          cursor: 'pointer',
          marginBottom: 16,
        }}
      >
        <ArrowLeft size={14} /> Back to invoices
      </button>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: NAVY, margin: 0, fontFamily: 'Inter, system-ui, sans-serif', fontVariantNumeric: 'tabular-nums' }}>
            {data.invoiceNumber}
          </h1>
          <div style={{ fontSize: 13, color: '#64748B', marginTop: 6 }}>
            Issued {formatDate(data.issuedDate)} · Due {formatDate(data.dueDate)}
          </div>
        </div>
        <span style={statusBadge(data.status)}>{data.status.replace(/_/g, ' ')}</span>
      </div>

      {payError && (
        <div
          style={{
            ...card,
            borderLeft: `4px solid #DC2626`,
            background: '#FEF2F2',
            display: 'flex',
            gap: 12,
            alignItems: 'flex-start',
            marginBottom: 20,
          }}
        >
          <AlertCircle size={20} color="#DC2626" />
          <div style={{ fontSize: 13, color: '#7F1D1D' }}>{payError}</div>
        </div>
      )}

      {/* Line items */}
      <div style={{ ...card, marginBottom: 20 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, color: NAVY, marginBottom: 16 }}>Line Items</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '8px 0', fontSize: 11, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #E2E8F0' }}>
                Description
              </th>
              <th style={{ textAlign: 'right', padding: '8px 0', fontSize: 11, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #E2E8F0' }}>
                Qty
              </th>
              <th style={{ textAlign: 'right', padding: '8px 0', fontSize: 11, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #E2E8F0' }}>
                Unit
              </th>
              <th style={{ textAlign: 'right', padding: '8px 0', fontSize: 11, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #E2E8F0' }}>
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {data.lineItems.map((li) => (
              <tr key={li.id}>
                <td style={{ padding: '12px 0', fontSize: 13, color: NAVY }}>{li.description}</td>
                <td style={{ padding: '12px 0', textAlign: 'right', fontSize: 13, color: NAVY }}>{li.quantity}</td>
                <td style={{ padding: '12px 0', textAlign: 'right', fontSize: 13, color: NAVY, fontFamily: 'Inter, system-ui, sans-serif', fontVariantNumeric: 'tabular-nums' }}>
                  {formatCents(li.unitPriceCents)}
                </td>
                <td style={{ padding: '12px 0', textAlign: 'right', fontSize: 13, fontWeight: 600, color: NAVY, fontFamily: 'Inter, system-ui, sans-serif', fontVariantNumeric: 'tabular-nums' }}>
                  {formatCents(li.extendedCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ borderTop: '1px solid #E2E8F0', marginTop: 12, paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#64748B' }}>
            <span>Subtotal</span>
            <span style={{ fontFamily: 'Inter, system-ui, sans-serif', fontVariantNumeric: 'tabular-nums' }}>{formatCents(data.subtotalCents)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#64748B' }}>
            <span>Tax</span>
            <span style={{ fontFamily: 'Inter, system-ui, sans-serif', fontVariantNumeric: 'tabular-nums' }}>{formatCents(data.taxCents)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 16, fontWeight: 700, color: NAVY, marginTop: 8 }}>
            <span>Total</span>
            <span style={{ fontFamily: 'Inter, system-ui, sans-serif', fontVariantNumeric: 'tabular-nums' }}>{formatCents(data.totalCents)}</span>
          </div>
        </div>
      </div>

      {/* Payments */}
      {data.payments.length > 0 && (
        <div style={{ ...card, marginBottom: 20 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: NAVY, marginBottom: 16 }}>Payments</h2>
          {data.payments.map((p) => (
            <div
              key={p.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '10px 0',
                borderBottom: '1px solid #F1F5F9',
                fontSize: 13,
              }}
            >
              <div>
                <div style={{ color: NAVY, fontWeight: 600 }}>{p.method}</div>
                <div style={{ color: '#64748B', fontSize: 12 }}>{formatDate(p.postedDate)}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ color: NAVY, fontFamily: 'Inter, system-ui, sans-serif', fontVariantNumeric: 'tabular-nums' }}>
                  {formatCents(p.amountCents)}
                </div>
                <div
                  style={{
                    color: p.status === 'COMPLETED' ? '#0D9F6E' : p.status === 'FAILED' ? '#DC2626' : '#D97706',
                    fontSize: 12,
                  }}
                >
                  {p.status}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pay action */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 20, ...card }}>
        <div>
          <div style={{ fontSize: 12, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Balance due
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, color: data.balanceCents > 0 ? '#DC2626' : '#0D9F6E', fontFamily: 'Inter, system-ui, sans-serif', fontVariantNumeric: 'tabular-nums' }}>
            {formatCents(data.balanceCents)}
          </div>
        </div>
        {canPay ? (
          <button
            onClick={startPayment}
            disabled={paying}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '12px 24px',
              background: NAVY,
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 600,
              cursor: paying ? 'not-allowed' : 'pointer',
              opacity: paying ? 0.7 : 1,
            }}
          >
            {paying ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <CreditCard size={16} />}
            {paying ? 'Opening…' : 'Pay invoice'}
          </button>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#0D9F6E', fontWeight: 600 }}>
            <CheckCircle size={18} /> {data.status === 'PAID' ? 'Paid' : 'No balance'}
          </div>
        )}
      </div>
    </div>
  );
}
