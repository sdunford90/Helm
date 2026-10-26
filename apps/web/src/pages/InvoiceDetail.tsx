import { useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useApiClient, useResource } from '../hooks/useApi';
import { errorMessage } from '../lib/api';
import { customerName, type CustomerRef, type InvoiceDTO } from '../lib/dto';
import { ErrorState, InlineError, LoadingState } from '../components/StateViews';
import { useToast } from '../components/Toast';
import {
  ArrowLeft,
  Send,
  Ban,
  CheckCircle,
  FileText,
  DollarSign,
  BookOpen,
} from 'lucide-react';
import PaymentModal from '../components/PaymentModal';
import { formatCents, formatDate, humanizeEnum } from '../lib/format';

/* ─── Types ─── */
type InvoiceStatus = 'Draft' | 'Issued' | 'Paid' | 'Past Due' | 'Void' | 'Collections';

interface LineItem {
  description: string;
  qty: number;
  unitPrice: number;
  discount: number;
  tax: number;
  total: number;
}

interface Payment {
  id: string;
  date: string;
  method: string;
  amount: number;
  status: string;
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
  customerRef: CustomerRef | null;
  status: InvoiceStatus;
  issued: string;
  due: string;
  lines: LineItem[];
  subtotal: number;
  tax: number;
  total: number;
  balance: number;
  payments: Payment[];
  glEntries: GLEntry[];
}

/* ─── API mapping (all money comes from the server; nothing is recomputed) ─── */
interface InvoiceDetailDTO extends InvoiceDTO {
  lineItems: {
    description: string;
    quantity: number;
    unitPriceCents: number;
    discountCents: number;
    taxCents: number;
    extendedCents: number;
  }[];
  payments: { id: string; amountCents: number; method: string; status: string; postedDate: string }[];
  glEntries: {
    postedAt: string;
    description?: string | null;
    debitCents: number;
    creditCents: number;
    account?: { accountNumber?: string | null; name?: string | null } | null;
  }[];
}

const STATUS_LABEL: Record<InvoiceDTO['status'], InvoiceStatus> = {
  DRAFT: 'Draft', ISSUED: 'Issued', PAID: 'Paid', PAST_DUE: 'Past Due', VOID: 'Void', COLLECTIONS: 'Collections',
};

function toInvoiceData(dto: InvoiceDetailDTO): InvoiceData {
  return {
    id: dto.id,
    number: dto.invoiceNumber,
    customerId: dto.customerId,
    customer: customerName(dto.customer),
    customerRef: dto.customer ?? null,
    status: STATUS_LABEL[dto.status] ?? 'Draft',
    issued: dto.issuedDate,
    due: dto.dueDate,
    lines: (dto.lineItems ?? []).map((l) => ({
      description: l.description,
      qty: l.quantity,
      unitPrice: l.unitPriceCents,
      discount: l.discountCents ?? 0,
      tax: l.taxCents ?? 0,
      total: (l.extendedCents ?? 0) + (l.taxCents ?? 0),
    })),
    subtotal: dto.subtotalCents,
    tax: dto.taxCents,
    total: dto.totalCents,
    balance: dto.balanceCents,
    payments: (dto.payments ?? []).map((p) => ({
      id: p.id,
      date: p.postedDate,
      method: humanizeEnum(p.method),
      amount: p.amountCents,
      status: humanizeEnum(p.status),
    })),
    glEntries: (dto.glEntries ?? []).map((g) => ({
      date: g.postedAt,
      account: [g.account?.accountNumber, g.account?.name].filter(Boolean).join(' - ') || '—',
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
const mono: React.CSSProperties = { fontFamily: '"JetBrains Mono", monospace' };

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
};

export default function InvoiceDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [showPayment, setShowPayment] = useState(false);
  const [busy, setBusy] = useState<null | 'finalize' | 'send' | 'void'>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const client = useApiClient();
  const toast = useToast();

  const { data: invoice, loading, error, notFound, refetch } = useResource<InvoiceData, InvoiceDetailDTO>(
    id ? `/invoices/${id}` : null,
    { map: toInvoiceData },
  );

  const canPay = !!invoice && invoice.balance > 0 && ['Issued', 'Past Due', 'Collections'].includes(invoice.status);

  // Honour the ?action=pay deep link from the Billing list.
  useEffect(() => {
    if (invoice && searchParams.get('action') === 'pay') {
      if (canPay) setShowPayment(true);
      searchParams.delete('action');
      setSearchParams(searchParams, { replace: true });
    }
  }, [invoice, canPay, searchParams, setSearchParams]);

  const runAction = async (action: 'finalize' | 'send' | 'void') => {
    if (!invoice || busy) return;
    if (action === 'void' && !window.confirm(`Void invoice ${invoice.number}? This reverses its journal entries and cannot be undone.`)) return;
    setBusy(action);
    setActionError(null);
    try {
      await client.post(`/invoices/${invoice.id}/${action}`);
      toast.success(
        action === 'finalize' ? `Invoice ${invoice.number} finalized` : action === 'send' ? `Invoice ${invoice.number} queued for email delivery` : `Invoice ${invoice.number} voided`,
      );
      refetch();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return <div style={st.page}><LoadingState label="Loading invoice…" /></div>;
  }
  if (notFound || !invoice) {
    return (
      <div style={st.page}>
        <button style={st.backBtn} onClick={() => navigate('/billing')}>
          <ArrowLeft size={16} /> Back to Billing
        </button>
        {notFound ? (
          <ErrorState title="Invoice not found" message={`There is no invoice with id ${id}. It may have been deleted, or the link is wrong.`} />
        ) : (
          <ErrorState title="Could not load this invoice" message={error} onRetry={refetch} />
        )}
      </div>
    );
  }

  const paymentsApplied = invoice.payments
    .filter((p) => p.status === 'Completed')
    .reduce((s, p) => s + p.amount, 0);
  const balanceDue = invoice.balance;

  return (
    <div style={st.page}>
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
          <div style={st.customerName}>
            <Link to={`/customers/${invoice.customerId}`} style={{ color: '#2E4A6B' }}>{invoice.customer}</Link>
          </div>
        </div>
        <div style={st.actions}>
          {invoice.status === 'Draft' && (
            <button style={st.btnPrimary} disabled={!!busy} onClick={() => runAction('finalize')}>
              <CheckCircle size={14} /> {busy === 'finalize' ? 'Finalizing…' : 'Finalize'}
            </button>
          )}
          {(invoice.status === 'Issued' || invoice.status === 'Past Due' || invoice.status === 'Collections') && (
            <button style={st.btnSecondary} disabled={!!busy} onClick={() => runAction('send')}>
              <Send size={14} /> {busy === 'send' ? 'Sending…' : 'Send'}
            </button>
          )}
          {canPay && (
            <button style={st.btnPrimary} disabled={!!busy} onClick={() => setShowPayment(true)}>
              <DollarSign size={14} /> Record Payment
            </button>
          )}
          {invoice.status !== 'Void' && invoice.status !== 'Paid' && (
            <button style={st.btnDestructive} disabled={!!busy} onClick={() => runAction('void')}>
              <Ban size={14} /> {busy === 'void' ? 'Voiding…' : 'Void'}
            </button>
          )}
        </div>
      </div>
      <hr style={st.divider} />
      {actionError && <div style={{ marginBottom: 16 }}><InlineError message={actionError} /></div>}

      {/* Meta */}
      <div style={st.metaRow}>
        <div style={st.metaItem}>
          <div style={st.metaLabel as React.CSSProperties}>Issued</div>
          <div style={st.metaValue}>{formatDate(invoice.issued)}</div>
        </div>
        <div style={st.metaItem}>
          <div style={st.metaLabel as React.CSSProperties}>Due</div>
          <div style={st.metaValue}>{formatDate(invoice.due)}</div>
        </div>
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
              {invoice.lines.map((line, idx) => (
                <tr key={idx} style={{ backgroundColor: idx % 2 === 1 ? '#D6E8F4' : '#FFFFFF' }}>
                  <td style={st.td}>{line.description}</td>
                  <td style={st.tdRight}>{line.qty}</td>
                  <td style={st.tdRight}>{formatCents(line.unitPrice)}</td>
                  <td style={st.tdRight}>{line.discount > 0 ? `(${formatCents(line.discount)})` : '--'}</td>
                  <td style={st.tdRight}>{formatCents(line.tax)}</td>
                  <td style={{ ...st.tdRight, fontWeight: 600 }}>{formatCents(line.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div style={st.totalsWrap}>
          <div style={st.totalsBox}>
            <div style={st.totalsRow}>
              <span>Subtotal</span>
              <span style={{ ...mono, fontWeight: 600, color: '#0A2342' }}>{formatCents(invoice.subtotal)}</span>
            </div>
            <div style={st.totalsRow}>
              <span>Tax</span>
              <span style={{ ...mono, fontSize: '13px' }}>{formatCents(invoice.tax)}</span>
            </div>
            <div style={{ ...st.totalsRow, fontWeight: 600, color: '#0A2342' }}>
              <span>Total</span>
              <span style={mono}>{formatCents(invoice.total)}</span>
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
                    <td style={st.td}>{formatDate(p.date)}</td>
                    <td style={st.td}>{p.method}</td>
                    <td style={{ ...st.tdRight, fontWeight: 600 }}>{formatCents(p.amount)}</td>
                    <td style={st.td}>
                      <span style={{
                        ...st.paymentBadge,
                        backgroundColor: p.status === 'Completed' ? '#E8F5E9' : p.status === 'Pending' ? '#FFF3CD' : '#FDECEA',
                        color: p.status === 'Completed' ? '#1B5E20' : p.status === 'Pending' ? '#856404' : '#B71C1C',
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
              {invoice.glEntries.length === 0 && (
                <tr><td colSpan={5} style={{ ...st.td, color: '#64748B', textAlign: 'center' }}>No journal entries yet (drafts are posted when finalized).</td></tr>
              )}
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

      {/* Payment Modal */}
      {showPayment && (
        <PaymentModal
          invoiceId={invoice.id}
          invoiceNumber={invoice.number}
          customerId={invoice.customerId}
          customer={invoice.customer}
          balanceDue={balanceDue}
          onClose={() => setShowPayment(false)}
          onRecorded={() => refetch()}
        />
      )}
    </div>
  );
}
