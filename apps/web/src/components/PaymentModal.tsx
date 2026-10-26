import { useState } from 'react';
import { X, CreditCard, Building2, Banknote, Anchor, CheckCircle, AlertCircle } from 'lucide-react';
import { formatCents } from '../lib/format';
import { useApiClient } from '../hooks/useApi';
import { errorMessage } from '../lib/api';
import type { PaymentDTO } from '../lib/dto';

/* ─── Types ─── */
type PaymentMethod = 'Card' | 'ACH' | 'Cash' | 'Charge to Slip';

interface PaymentModalProps {
  invoiceId: string;
  invoiceNumber: string;
  customerId: string;
  customer: string;
  balanceDue: number; // cents, from the server
  onClose: () => void;
  /** Called only after the server recorded the payment (2xx). */
  onRecorded?: (payment: PaymentDTO) => void;
}

/* ─── Styles ─── */
const mono: React.CSSProperties = { fontFamily: '"JetBrains Mono", monospace' };

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, backgroundColor: 'rgba(10,35,66,0.55)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
  },
  modal: {
    backgroundColor: '#FFFFFF', borderRadius: '8px', width: '520px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '24px 32px', borderBottom: '1px solid #E2E8F0',
  },
  headerTitle: {
    fontSize: '22px', fontWeight: 700, color: '#0A2342', letterSpacing: '-0.02em', margin: 0,
  },
  closeBtn: {
    background: 'none', border: 'none', cursor: 'pointer', color: '#2E4A6B', padding: '4px',
  },
  body: { padding: '32px' },
  summaryBox: {
    backgroundColor: '#F7F9FB', borderRadius: '8px', padding: '20px', marginBottom: '24px',
    border: '1px solid #E2E8F0',
  },
  summaryRow: {
    display: 'flex', justifyContent: 'space-between', fontSize: '14px', color: '#2E4A6B',
    marginBottom: '8px',
  },
  summaryBalance: {
    display: 'flex', justifyContent: 'space-between', fontSize: '18px', fontWeight: 700,
    color: '#0A2342', borderTop: '1px solid #CCCCCC', paddingTop: '12px', marginTop: '4px',
  },
  label: {
    display: 'block', fontSize: '13px', fontWeight: 600, color: '#2E4A6B',
    textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px',
  },
  methodGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginBottom: '24px',
  },
  methodBtn: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px',
    padding: '16px 8px', borderRadius: '8px', border: '2px solid #CCCCCC',
    backgroundColor: '#FFFFFF', cursor: 'pointer', fontSize: '12px', fontWeight: 600,
    color: '#2E4A6B', transition: 'border-color 0.15s, background-color 0.15s',
  },
  methodBtnActive: {
    borderColor: '#0A2342', backgroundColor: '#D6E8F4', color: '#0A2342',
  },
  input: {
    width: '100%', padding: '10px 14px', borderRadius: '6px', border: '1px solid #CCCCCC',
    fontSize: '18px', color: '#0A2342', boxSizing: 'border-box', ...mono, fontWeight: 600,
  },
  footer: {
    display: 'flex', justifyContent: 'flex-end', gap: '12px',
    padding: '24px 32px', borderTop: '1px solid #E2E8F0',
  },
  cancelBtn: {
    padding: '10px 24px', fontSize: '14px', fontWeight: 600, color: '#0A2342',
    backgroundColor: '#FFFFFF', border: '1px solid #CCCCCC', borderRadius: '6px', cursor: 'pointer',
  },
  processBtn: {
    display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '10px 24px',
    fontSize: '14px', fontWeight: 600, color: '#FFFFFF', backgroundColor: '#0A2342',
    border: 'none', borderRadius: '6px', cursor: 'pointer',
  },
  processBtnGreen: {
    display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '10px 24px',
    fontSize: '14px', fontWeight: 600, color: '#FFFFFF', backgroundColor: '#1B5E20',
    border: 'none', borderRadius: '6px', cursor: 'pointer',
  },
  successBox: {
    backgroundColor: '#E8F5E9', borderRadius: '8px', padding: '20px',
    display: 'flex', alignItems: 'center', gap: '12px', color: '#1B5E20',
    fontSize: '15px', fontWeight: 600,
  },
  errorBox: {
    backgroundColor: '#FDECEA', borderRadius: '8px', padding: '20px',
    display: 'flex', alignItems: 'center', gap: '12px', color: '#B71C1C',
    fontSize: '15px', fontWeight: 600,
  },
};

const methods: { value: PaymentMethod; icon: typeof CreditCard; label: string }[] = [
  { value: 'Card', icon: CreditCard, label: 'Card' },
  { value: 'ACH', icon: Building2, label: 'ACH' },
  { value: 'Cash', icon: Banknote, label: 'Cash' },
  { value: 'Charge to Slip', icon: Anchor, label: 'Charge to Slip' },
];

export default function PaymentModal({ invoiceId, invoiceNumber, customerId, customer, balanceDue, onClose, onRecorded }: PaymentModalProps) {
  const client = useApiClient();
  const [method, setMethod] = useState<PaymentMethod>('Cash');
  const [amount, setAmount] = useState((balanceDue / 100).toFixed(2));
  const [status, setStatus] = useState<'idle' | 'processing' | 'success' | 'error'>('idle');
  const [errorText, setErrorText] = useState('');
  const [recordedCents, setRecordedCents] = useState(0);

  const amountCents = Math.round(Number(amount) * 100);
  const amountProblem =
    !amount.trim() || !Number.isFinite(amountCents) || amountCents <= 0
      ? 'Enter an amount greater than $0.00.'
      : amountCents > balanceDue
        ? `Amount exceeds the balance due (${formatCents(balanceDue)}).`
        : null;

  const handleProcess = async () => {
    if (amountProblem || status === 'processing') return;
    setStatus('processing');
    setErrorText('');
    try {
      const payment = await client.post<PaymentDTO>('/payments', {
        invoiceId,
        customerId,
        amountCents,
        method: method === 'Card' ? 'CARD' : method === 'ACH' ? 'ACH' : method === 'Cash' ? 'CASH' : 'CHARGE_TO_SLIP',
      });
      // Only a 2xx response reaches this line.
      setRecordedCents(payment?.amountCents ?? amountCents);
      setStatus('success');
      onRecorded?.(payment);
    } catch (err) {
      setErrorText(errorMessage(err));
      setStatus('error');
    }
  };

  const buttonLabel = method === 'Card' || method === 'ACH'
    ? 'Charge Payment Method on File'
    : method === 'Cash'
      ? 'Record Cash Payment'
      : 'Charge to Slip';

  return (
    <div style={s.overlay} onClick={() => { if (status !== 'processing') onClose(); }}>
      <div style={s.modal} className="helm-modal" role="dialog" aria-modal="true" aria-label="Record payment" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={s.header}>
          <h2 style={s.headerTitle}>Record Payment</h2>
          <button style={s.closeBtn} onClick={onClose} disabled={status === 'processing'} aria-label="Close"><X size={20} /></button>
        </div>

        {/* Body */}
        <div style={s.body}>
          {/* Invoice Summary */}
          <div style={s.summaryBox}>
            <div style={s.summaryRow}>
              <span>Invoice</span>
              <span style={{ ...mono, fontWeight: 600, color: '#0A2342' }}>{invoiceNumber}</span>
            </div>
            <div style={s.summaryRow}>
              <span>Customer</span>
              <span style={{ fontWeight: 600, color: '#0A2342' }}>{customer}</span>
            </div>
            <div style={s.summaryBalance}>
              <span>Balance Due</span>
              <span style={mono}>{formatCents(balanceDue)}</span>
            </div>
          </div>

          {status === 'idle' || status === 'processing' ? (
            <>
              {/* Payment Method */}
              <label style={s.label}>Payment Method</label>
              <div style={s.methodGrid}>
                {methods.map((m) => (
                  <button
                    key={m.value}
                    style={{
                      ...s.methodBtn,
                      ...(method === m.value ? s.methodBtnActive : {}),
                    } as React.CSSProperties}
                    onClick={() => setMethod(m.value)}
                  >
                    <m.icon size={20} />
                    {m.label}
                  </button>
                ))}
              </div>

              {/* Amount */}
              <div style={{ marginBottom: '24px' }}>
                <label style={s.label}>Amount</label>
                <input
                  style={s.input}
                  type="number"
                  min={0}
                  step={0.01}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
                {amountProblem && amount.trim() !== '' && (
                  <div style={{ fontSize: '12px', color: '#B71C1C', marginTop: '6px' }}>{amountProblem}</div>
                )}
                {(method === 'Card' || method === 'ACH') && (
                  <div style={{ fontSize: '12px', color: '#64748B', marginTop: '6px' }}>
                    Charges the customer's saved {method === 'ACH' ? 'bank account' : 'card'} in Stripe. Fails if Stripe is not connected or no payment method is on file.
                  </div>
                )}
                {!amountProblem && amountCents < balanceDue && (
                  <div style={{ fontSize: '12px', color: '#856404', marginTop: '6px' }}>
                    Partial payment -- remaining balance will be {formatCents(balanceDue - amountCents)}
                  </div>
                )}
              </div>
            </>
          ) : status === 'success' ? (
            <div style={s.successBox}>
              <CheckCircle size={24} />
              Payment of {formatCents(recordedCents)} recorded.
            </div>
          ) : (
            <div style={s.errorBox}>
              <AlertCircle size={24} />
              <div>
                <div>The payment was not recorded.</div>
                <div style={{ fontWeight: 400, fontSize: '13px', marginTop: '4px' }}>{errorText}</div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={s.footer}>
          <button style={s.cancelBtn} onClick={onClose} disabled={status === 'processing'}>
            {status === 'success' ? 'Close' : 'Cancel'}
          </button>
          {status === 'error' && (
            <button style={s.processBtn} onClick={() => setStatus('idle')}>Try Again</button>
          )}
          {(status === 'idle' || status === 'processing') && (
            <button
              style={{
                ...(method === 'Cash' || method === 'Charge to Slip' ? s.processBtnGreen : s.processBtn),
                opacity: amountProblem || status === 'processing' ? 0.6 : 1,
                cursor: amountProblem || status === 'processing' ? 'not-allowed' : 'pointer',
              }}
              disabled={!!amountProblem || status === 'processing'}
              onClick={handleProcess}
            >
              {status === 'processing' ? 'Processing…' : buttonLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
