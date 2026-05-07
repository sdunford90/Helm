import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import {
  ArrowLeft,
  Send,
  Ban,
  CheckCircle,
  FileText,
  DollarSign,
  BookOpen,
  Download,
} from 'lucide-react';
import PaymentModal from '../components/PaymentModal';
import { formatCents, formatDate, formatDateOnly } from '../lib/format';

/* ─── Raw API types ─── */
interface ApiLineItem {
  id: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  discountCents: number;
  taxRate: number;
  taxCents: number;
  extendedCents: number;
}

interface ApiPayment {
  id: string;
  amountCents: number;
  refundedCents?: number;
  method: string;
  status: string;
  postedDate: string | null;
}

interface ApiGlEntry {
  id: string;
  debitCents: number;
  creditCents: number;
  description: string | null;
  postedAt: string;
  account: { accountNumber: string; name: string };
}

interface ApiInvoice {
  id: string;
  invoiceNumber: string;
  status: string;
  issuedDate: string | null;
  dueDate: string;
  paymentTerms: string | null;
  totalCents: number;
  balanceCents: number;
  pdfUrl: string | null;
  customer: {
    id: string;
    firstName: string;
    lastName: string;
    email: string | null;
    company: string | null;
  };
  lineItems: ApiLineItem[];
  payments: ApiPayment[];
  glEntries: ApiGlEntry[];
}

/* ─── Normalised display types ─── */
type InvoiceStatus = 'Draft' | 'Issued' | 'Paid' | 'Past Due' | 'Void' | 'Collections';

interface LineItem {
  description: string;
  qty: number;
  unitPrice: number;
  discount: number;
  taxRate: number;
  taxCents: number;
}

type PaymentStatus = 'Completed' | 'Pending' | 'Failed' | 'Refunded' | 'Partially refunded';

interface Payment {
  id: string;
  date: string;
  method: string;
  amount: number;
  refundedCents: number;
  status: PaymentStatus;
}

interface GLEntry {
  date: string;
  account: string;
  description: string;
  debit: number;
  credit: number;
}

interface InvoiceData {
  id: string;
  number: string;
  customerId: string;
  customer: string;
  customerEmail: string | null;
  status: InvoiceStatus;
  issued: string | null;
  due: string;
  terms: string | null;
  totalCents: number;
  balanceCents: number;
  pdfUrl: string | null;
  lines: LineItem[];
  payments: Payment[];
  glEntries: GLEntry[];
}

/* ─── Map API → display ─── */
function normaliseStatus(s: string): InvoiceStatus {
  const map: Record<string, InvoiceStatus> = {
    DRAFT: 'Draft', ISSUED: 'Issued', PAID: 'Paid',
    PAST_DUE: 'Past Due', VOID: 'Void', COLLECTIONS: 'Collections',
  };
  return map[s] ?? 'Draft';
}

function normalisePaymentStatus(s: string): PaymentStatus {
  if (s === 'COMPLETED') return 'Completed';
  if (s === 'FAILED') return 'Failed';
  if (s === 'REFUNDED') return 'Refunded';
  if (s === 'PARTIALLY_REFUNDED') return 'Partially refunded';
  return 'Pending';
}

function mapApiInvoice(raw: ApiInvoice): InvoiceData {
  return {
    id: raw.id,
    number: raw.invoiceNumber,
    customerId: raw.customer.id,
    customer: [raw.customer.firstName, raw.customer.lastName].filter(Boolean).join(' ') || raw.customer.company || 'Unknown',
    customerEmail: raw.customer.email,
    status: normaliseStatus(raw.status),
    issued: raw.issuedDate,
    due: raw.dueDate,
    terms: raw.paymentTerms,
    totalCents: raw.totalCents,
    balanceCents: raw.balanceCents,
    pdfUrl: raw.pdfUrl,
    lines: raw.lineItems.map((li) => ({
      description: li.description,
      qty: li.quantity,
      unitPrice: li.unitPriceCents,
      discount: li.discountCents,
      taxRate: li.taxRate,
      taxCents: li.taxCents,
    })),
    payments: raw.payments.map((p) => ({
      id: p.id,
      date: p.postedDate ?? '',
      method: p.method,
      amount: p.amountCents,
      refundedCents: p.refundedCents ?? 0,
      status: normalisePaymentStatus(p.status),
    })),
    glEntries: (raw.glEntries ?? []).map((g) => ({
      date: g.postedAt,
      account: `${g.account.accountNumber} — ${g.account.name}`,
      description: g.description ?? '',
      debit: g.debitCents,
      credit: g.creditCents,
    })),
  };
}

/* ─── Helpers ─── */
function statusBadge(status: InvoiceStatus): React.CSSProperties {
  const base: React.CSSProperties = {
    display: 'inline-block', padding: '4px 14px', borderRadius: '9999px',
    fontSize: '13px', fontWeight: 600, letterSpacing: '0.02em',
  };
  switch (status) {
    case 'Draft': return { ...base, backgroundColor: '#E2E8F0', color: '#64748B' };
    case 'Issued': return { ...base, backgroundColor: '#0A2342', color: '#FFFFFF' };
    case 'Paid': return { ...base, backgroundColor: '#E8F5E9', color: '#1B5E20' };
    case 'Past Due': return { ...base, backgroundColor: '#FDECEA', color: '#B71C1C' };
    case 'Void': return { ...base, backgroundColor: '#E2E8F0', color: '#94A3B8', textDecoration: 'line-through' };
    case 'Collections': return { ...base, backgroundColor: '#B71C1C', color: '#FFFFFF' };
    default: return base;
  }
}

/* ─── Styles ─── */
const mono: React.CSSProperties = { fontFamily: 'Inter, system-ui, sans-serif', fontVariantNumeric: 'tabular-nums' };

const st: Record<string, React.CSSProperties> = {
  page: { padding: '32px' },
  backBtn: {
    display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '14px',
    color: '#2E4A6B', background: 'none', border: 'none', cursor: 'pointer',
    marginBottom: '16px', padding: 0, fontWeight: 500,
  },
  headerRow: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
    marginBottom: '8px', flexWrap: 'wrap', gap: '16px',
  },
  headerLeft: { display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' },
  invoiceNum: {
    fontSize: '28px', fontWeight: 700, color: '#0A2342', ...mono, letterSpacing: '-0.01em', margin: 0,
  },
  customerName: { fontSize: '18px', color: '#2E4A6B', marginTop: '4px' },
  divider: {
    height: '4px', background: 'linear-gradient(90deg, #00D4FF, transparent)',
    border: 'none', marginTop: '12px', marginBottom: '32px', borderRadius: '2px',
  },
  actions: { display: 'flex', gap: '8px', flexWrap: 'wrap' },
  btnPrimary: {
    display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 18px',
    fontSize: '13px', fontWeight: 600, color: '#FFFFFF', backgroundColor: '#0A2342',
    border: 'none', borderRadius: '6px', cursor: 'pointer',
  },
  btnSecondary: {
    display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 18px',
    fontSize: '13px', fontWeight: 600, color: '#0A2342', backgroundColor: '#FFFFFF',
    border: '1px solid #CCCCCC', borderRadius: '6px', cursor: 'pointer',
  },
  btnDestructive: {
    display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 18px',
    fontSize: '13px', fontWeight: 600, color: '#FFFFFF', backgroundColor: '#B71C1C',
    border: 'none', borderRadius: '6px', cursor: 'pointer',
  },
  metaRow: {
    display: 'flex', gap: '48px', marginBottom: '32px',
  },
  metaItem: {},
  metaLabel: {
    fontSize: '11px', fontWeight: 600, color: '#2E4A6B', textTransform: 'uppercase',
    letterSpacing: '0.05em', marginBottom: '4px',
  },
  metaValue: { fontSize: '15px', color: '#0A2342', fontWeight: 500 },
  section: { marginBottom: '32px' },
  sectionTitle: {
    display: 'flex', alignItems: 'center', gap: '8px', fontSize: '16px', fontWeight: 700,
    color: '#0A2342', marginBottom: '16px',
  },
  tableWrap: {
    borderRadius: '8px', overflow: 'hidden', border: '1px solid #CCCCCC',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '14px' },
  th: {
    textAlign: 'left', padding: '10px 16px', backgroundColor: '#0A2342', color: '#FFFFFF',
    fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em',
    whiteSpace: 'nowrap',
  },
  thRight: {
    textAlign: 'right', padding: '10px 16px', backgroundColor: '#0A2342', color: '#FFFFFF',
    fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em',
  },
  td: { padding: '10px 16px', borderBottom: '1px solid #E2E8F0', color: '#0A2342' },
  tdRight: {
    padding: '10px 16px', borderBottom: '1px solid #E2E8F0', color: '#0A2342',
    textAlign: 'right', ...mono, fontSize: '13px',
  },
  totalsWrap: {
    display: 'flex', justifyContent: 'flex-end', marginTop: '16px',
  },
  totalsBox: { width: '320px' },
  totalsRow: {
    display: 'flex', justifyContent: 'space-between', padding: '6px 0',
    fontSize: '14px', color: '#2E4A6B',
  },
  totalsFinal: {
    display: 'flex', justifyContent: 'space-between', padding: '12px 0',
    fontSize: '20px', fontWeight: 700, color: '#0A2342',
    borderTop: '2px solid #0A2342', marginTop: '8px',
  },
  paymentBadge: {
    display: 'inline-block', padding: '2px 10px', borderRadius: '9999px',
    fontSize: '11px', fontWeight: 600,
  },
  toast: {
    position: 'fixed', bottom: '24px', right: '24px', zIndex: 9999,
    padding: '12px 20px', borderRadius: '8px', fontSize: '14px', fontWeight: 600,
    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
  },
};

export default function InvoiceDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [showPayment, setShowPayment] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const { data: rawInvoice, loading: loadingInvoice, execute: refetchInvoice } = useApi<ApiInvoice>(
    'get', `/api/invoices/${id}`, { immediate: true }
  );

  const loading = loadingInvoice;

  function showToast(message: string, type: 'success' | 'error') {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }

  async function handleFinalize() {
    setActionLoading('finalize');
    try {
      const res = await fetch(`/api/invoices/${id}/finalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || 'Failed to finalize invoice');
      }
      showToast('Invoice finalized successfully', 'success');
      await refetchInvoice();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to finalize invoice', 'error');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleSend() {
    setActionLoading('send');
    try {
      const res = await fetch(`/api/invoices/${id}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || 'Failed to send invoice');
      }
      showToast('Invoice queued for delivery', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to send invoice', 'error');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleVoid() {
    if (!window.confirm('Are you sure you want to void this invoice? This cannot be undone.')) return;
    setActionLoading('void');
    try {
      const res = await fetch(`/api/invoices/${id}/void`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || 'Failed to void invoice');
      }
      showToast('Invoice voided', 'success');
      await refetchInvoice();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to void invoice', 'error');
    } finally {
      setActionLoading(null);
    }
  }

  function handleDownloadPdf() {
    window.open(`/api/invoices/${id}/pdf`, '_blank');
  }

  if (!rawInvoice && !loading) {
    return (
      <div style={st.page}>
        <button style={st.backBtn} onClick={() => navigate('/billing')}>
          <ArrowLeft size={16} /> Back to Billing
        </button>
        <div style={{ textAlign: 'center', padding: '48px 16px', color: '#B71C1C', fontSize: '16px', fontWeight: 600 }}>
          Invoice not found.
        </div>
      </div>
    );
  }

  if (!rawInvoice) {
    return (
      <div style={st.page}>
        <button style={st.backBtn} onClick={() => navigate('/billing')}>
          <ArrowLeft size={16} /> Back to Billing
        </button>
        <div style={{ textAlign: 'center', padding: '24px', color: '#64748B' }}>Loading invoice...</div>
      </div>
    );
  }

  const invoice = mapApiInvoice(rawInvoice);

  const subtotal = invoice.lines.reduce((s, l) => s + (l.qty * l.unitPrice - l.discount), 0);
  const totalTax = invoice.lines.reduce((s, l) => s + l.taxCents, 0);
  const total = subtotal + totalTax;
  const paymentsApplied = invoice.payments
    .filter((p) => p.status === 'Completed')
    .reduce((s, p) => s + p.amount, 0);
  const balanceDue = invoice.balanceCents ?? (total - paymentsApplied);

  const busy = (key: string) => actionLoading === key;

  return (
    <div style={st.page}>
      {/* Toast */}
      {toast && (
        <div style={{
          ...st.toast,
          backgroundColor: toast.type === 'success' ? '#1B5E20' : '#B71C1C',
          color: '#FFFFFF',
        }}>
          {toast.message}
        </div>
      )}

      {/* Back */}
      <button style={st.backBtn} onClick={() => navigate('/billing')}>
        <ArrowLeft size={16} /> Back to Billing
      </button>

      {/* Header */}
      <div style={st.headerRow}>
        <div>
          <div style={st.headerLeft}>
            <h1 style={st.invoiceNum}>{invoice.number}</h1>
            <span style={statusBadge(invoice.status)}>{invoice.status}</span>
          </div>
          <div style={st.customerName}>{invoice.customer}</div>
        </div>
        <div style={st.actions}>
          {invoice.status === 'Draft' && (
            <button
              style={{ ...st.btnPrimary, opacity: busy('finalize') ? 0.7 : 1 }}
              onClick={handleFinalize}
              disabled={busy('finalize')}
            >
              <CheckCircle size={14} /> {busy('finalize') ? 'Finalizing…' : 'Finalize'}
            </button>
          )}
          {(invoice.status === 'Issued' || invoice.status === 'Past Due') && (
            <>
              <button
                style={{ ...st.btnSecondary, opacity: busy('send') ? 0.7 : 1 }}
                onClick={handleSend}
                disabled={busy('send')}
              >
                <Send size={14} /> {busy('send') ? 'Sending…' : 'Send'}
              </button>
              <button style={st.btnPrimary} onClick={() => setShowPayment(true)}>
                <DollarSign size={14} /> Record Payment
              </button>
            </>
          )}
          {invoice.status !== 'Void' && (
            <button
              style={{ ...st.btnSecondary, opacity: busy('pdf') ? 0.7 : 1 }}
              onClick={handleDownloadPdf}
              disabled={busy('pdf')}
            >
              <Download size={14} /> Download PDF
            </button>
          )}
          {invoice.status !== 'Void' && invoice.status !== 'Paid' && (
            <button
              style={{ ...st.btnDestructive, opacity: busy('void') ? 0.7 : 1 }}
              onClick={handleVoid}
              disabled={busy('void')}
            >
              <Ban size={14} /> {busy('void') ? 'Voiding…' : 'Void'}
            </button>
          )}
        </div>
      </div>
      <hr style={st.divider} />

      {/* Meta */}
      <div style={st.metaRow}>
        <div style={st.metaItem}>
          <div style={st.metaLabel as React.CSSProperties}>Issued</div>
          <div style={st.metaValue}>{formatDateOnly(invoice.issued)}</div>
        </div>
        <div style={st.metaItem}>
          <div style={st.metaLabel as React.CSSProperties}>Due</div>
          <div style={st.metaValue}>{formatDateOnly(invoice.due)}</div>
        </div>
        <div style={st.metaItem}>
          <div style={st.metaLabel as React.CSSProperties}>Terms</div>
          <div style={st.metaValue}>{invoice.terms ?? '—'}</div>
        </div>
        {invoice.customerEmail && (
          <div style={st.metaItem}>
            <div style={st.metaLabel as React.CSSProperties}>Customer Email</div>
            <div style={st.metaValue}>{invoice.customerEmail}</div>
          </div>
        )}
      </div>

      {/* Line Items */}
      <div style={st.section}>
        <div style={st.sectionTitle}><FileText size={18} /> Line Items</div>
        <div style={st.tableWrap} className="helm-table-wrap">
          <table style={st.table}>
            <thead>
              <tr>
                <th style={st.th}>Description</th>
                <th style={st.thRight}>Qty</th>
                <th style={st.thRight}>Unit Price</th>
                <th style={st.thRight}>Discount</th>
                <th style={st.thRight}>Tax</th>
                <th style={st.thRight}>Total</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((line, idx) => {
                const ext = line.qty * line.unitPrice - line.discount;
                return (
                  <tr key={idx} style={{ backgroundColor: idx % 2 === 1 ? '#D6E8F4' : '#FFFFFF' }}>
                    <td style={st.td}>{line.description}</td>
                    <td style={st.tdRight}>{line.qty}</td>
                    <td style={st.tdRight}>{formatCents(line.unitPrice)}</td>
                    <td style={st.tdRight}>{line.discount > 0 ? `(${formatCents(line.discount)})` : '--'}</td>
                    <td style={st.tdRight}>{formatCents(line.taxCents)}</td>
                    <td style={{ ...st.tdRight, fontWeight: 600 }}>{formatCents(ext + line.taxCents)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div style={st.totalsWrap}>
          <div style={st.totalsBox}>
            <div style={st.totalsRow}>
              <span>Subtotal</span>
              <span style={{ ...mono, fontWeight: 600, color: '#0A2342' }}>{formatCents(subtotal)}</span>
            </div>
            {totalTax > 0 && (
              <div style={st.totalsRow}>
                <span>Tax</span>
                <span style={{ ...mono, fontSize: '13px' }}>{formatCents(totalTax)}</span>
              </div>
            )}
            <div style={{ ...st.totalsRow, fontWeight: 600, color: '#0A2342' }}>
              <span>Total</span>
              <span style={mono}>{formatCents(total)}</span>
            </div>
            {paymentsApplied > 0 && (
              <div style={{ ...st.totalsRow, color: '#1B5E20' }}>
                <span>Payments Applied</span>
                <span style={{ ...mono, fontWeight: 600 }}>({formatCents(paymentsApplied)})</span>
              </div>
            )}
            <div style={st.totalsFinal}>
              <span>Balance Due</span>
              <span style={{ ...mono, color: balanceDue > 0 ? '#B71C1C' : '#1B5E20' }}>
                {formatCents(balanceDue)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Payment History */}
      <div style={st.section}>
        <div style={st.sectionTitle}><DollarSign size={18} /> Payment History</div>
        {invoice.payments.length === 0 ? (
          <div style={{ color: '#94A3B8', fontSize: '14px', padding: '16px 0' }}>
            No payments recorded.
          </div>
        ) : (
          <div style={st.tableWrap} className="helm-table-wrap">
            <table style={st.table}>
              <thead>
                <tr>
                  <th style={st.th}>Date</th>
                  <th style={st.th}>Method</th>
                  <th style={st.thRight}>Amount</th>
                  <th style={st.th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {invoice.payments.map((p, idx) => (
                  <tr key={p.id} style={{ backgroundColor: idx % 2 === 1 ? '#D6E8F4' : '#FFFFFF' }}>
                    <td style={st.td}>{p.date ? formatDate(p.date) : '—'}</td>
                    <td style={st.td}>{p.method}</td>
                    <td style={{ ...st.tdRight, fontWeight: 600 }}>
                      {formatCents(p.amount)}
                      {p.status === 'Partially refunded' && p.refundedCents > 0 ? (
                        <div style={{ fontSize: '12px', fontWeight: 400, color: '#64748B', marginTop: '2px' }}>
                          {formatCents(p.refundedCents)} refunded
                        </div>
                      ) : null}
                    </td>
                    <td style={st.td}>
                      <span style={{
                        ...st.paymentBadge,
                        backgroundColor:
                          p.status === 'Completed' ? '#E8F5E9'
                          : p.status === 'Pending' ? '#FFF3CD'
                          : p.status === 'Refunded' ? '#E2E8F0'
                          : p.status === 'Partially refunded' ? '#E0F2FE'
                          : '#FDECEA',
                        color:
                          p.status === 'Completed' ? '#1B5E20'
                          : p.status === 'Pending' ? '#856404'
                          : p.status === 'Refunded' ? '#475569'
                          : p.status === 'Partially refunded' ? '#075985'
                          : '#B71C1C',
                      }}>
                        {p.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* GL Entries */}
      {invoice.glEntries.length > 0 && (
        <div style={st.section}>
          <div style={st.sectionTitle}><BookOpen size={18} /> Journal Entries</div>
          <div style={st.tableWrap} className="helm-table-wrap">
            <table style={st.table}>
              <thead>
                <tr>
                  <th style={st.th}>Date</th>
                  <th style={st.th}>Account</th>
                  <th style={st.th}>Description</th>
                  <th style={st.thRight}>Debit</th>
                  <th style={st.thRight}>Credit</th>
                </tr>
              </thead>
              <tbody>
                {invoice.glEntries.map((gl, idx) => (
                  <tr key={idx} style={{ backgroundColor: idx % 2 === 1 ? '#D6E8F4' : '#FFFFFF' }}>
                    <td style={st.td}>{formatDate(gl.date)}</td>
                    <td style={{ ...st.td, ...mono, fontSize: '13px' }}>{gl.account}</td>
                    <td style={st.td}>{gl.description}</td>
                    <td style={st.tdRight}>{gl.debit > 0 ? formatCents(gl.debit) : '--'}</td>
                    <td style={st.tdRight}>{gl.credit > 0 ? formatCents(gl.credit) : '--'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Payment Modal */}
      {showPayment && id && (
        <PaymentModal
          invoiceId={id}
          invoiceNumber={invoice.number}
          customerId={invoice.customerId}
          customer={invoice.customer}
          balanceDue={balanceDue}
          onClose={() => setShowPayment(false)}
          onPaid={() => {
            setShowPayment(false);
            refetchInvoice();
          }}
        />
      )}
    </div>
  );
}
