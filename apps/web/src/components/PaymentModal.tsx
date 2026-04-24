import { useState } from 'react';
import {
  X,
  CreditCard,
  Plus,
  Banknote,
  Anchor,
  CheckCircle,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { formatCents } from '../lib/format';
import { useApi } from '../hooks/useApi';
import { getStripe } from '../lib/stripe.js';
import {
  CheckoutProvider,
  PaymentElement,
  useCheckout,
} from '@stripe/react-stripe-js';

/* ─── Types ─── */
type Step = 'choose' | 'card_on_file_result' | 'new_card' | 'simple_method_result';
type Status = 'idle' | 'processing' | 'success' | 'error';

interface PaymentModalProps {
  invoiceId: string;
  invoiceNumber: string;
  customer: string;
  balanceDue: number; // cents
  onClose: () => void;
  onPaid?: () => void;
}

/* ─── Styles ─── */
const mono: React.CSSProperties = { fontFamily: '"JetBrains Mono", monospace' };

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, backgroundColor: 'rgba(10,35,66,0.55)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
  },
  modal: {
    backgroundColor: '#FFFFFF', borderRadius: '8px', width: '560px',
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
  body: { padding: '24px 32px' },
  summaryBox: {
    backgroundColor: '#F7F9FB', borderRadius: '8px', padding: '16px',
    border: '1px solid #E2E8F0', marginBottom: '20px',
  },
  summaryRow: {
    display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#2E4A6B',
    marginBottom: '6px',
  },
  summaryBalance: {
    display: 'flex', justifyContent: 'space-between', fontSize: '16px', fontWeight: 700,
    color: '#0A2342', borderTop: '1px solid #CCCCCC', paddingTop: '10px', marginTop: '4px',
  },
  methodList: { display: 'grid', gap: '10px' },
  methodBtn: {
    display: 'flex', alignItems: 'center', gap: '12px',
    padding: '16px 20px', borderRadius: '8px', border: '1px solid #CCCCCC',
    backgroundColor: '#FFFFFF', cursor: 'pointer', fontSize: '14px', fontWeight: 600,
    color: '#0A2342', textAlign: 'left', transition: 'border-color 0.15s, background-color 0.15s',
    width: '100%',
  },
  methodBtnPrimary: {
    backgroundColor: '#0A2342', color: '#FFFFFF', border: 'none',
  },
  methodLabel: { flex: 1 },
  methodHint: { fontSize: '12px', fontWeight: 400, opacity: 0.7, marginTop: '2px' },
  footer: {
    display: 'flex', justifyContent: 'flex-end', gap: '12px',
    padding: '20px 32px', borderTop: '1px solid #E2E8F0',
  },
  cancelBtn: {
    padding: '10px 24px', fontSize: '14px', fontWeight: 600, color: '#0A2342',
    backgroundColor: '#FFFFFF', border: '1px solid #CCCCCC', borderRadius: '6px', cursor: 'pointer',
  },
  primaryBtn: {
    padding: '10px 24px', fontSize: '14px', fontWeight: 600, color: '#FFFFFF',
    backgroundColor: '#0A2342', border: 'none', borderRadius: '6px', cursor: 'pointer',
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

/* ─── Main component ─── */

export default function PaymentModal({
  invoiceId,
  invoiceNumber,
  customer,
  balanceDue,
  onClose,
  onPaid,
}: PaymentModalProps) {
  const [step, setStep] = useState<Step>('choose');
  const [status, setStatus] = useState<Status>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [checkoutClientSecret, setCheckoutClientSecret] = useState<string | null>(null);

  const chargeCardOnFile = useApi<{ status: string; requiresAction: boolean }>(
    'post',
    '/api/checkout/charge-card-on-file',
  );
  const createSession = useApi<{ clientSecret: string }>('post', '/api/checkout/invoice-session');
  const recordSimplePayment = useApi('post', '/api/payments');

  const handleCardOnFile = async () => {
    setStatus('processing');
    const result = await chargeCardOnFile.execute({ invoiceId });
    if (result && result.status === 'succeeded') {
      setStatus('success');
      setStep('card_on_file_result');
      onPaid?.();
    } else if (result && result.requiresAction) {
      setErrorMessage('Card requires 3DS authentication. Use "New card" to complete.');
      setStatus('error');
      setStep('card_on_file_result');
    } else {
      setErrorMessage(chargeCardOnFile.error ?? 'Charge failed.');
      setStatus('error');
      setStep('card_on_file_result');
    }
  };

  const handleNewCard = async () => {
    setStatus('processing');
    const result = await createSession.execute({
      invoiceId,
      returnPath: `/billing/invoices/${invoiceId}`,
    });
    if (result?.clientSecret) {
      setCheckoutClientSecret(result.clientSecret);
      setStep('new_card');
      setStatus('idle');
    } else {
      setErrorMessage(createSession.error ?? 'Could not start checkout.');
      setStatus('error');
    }
  };

  const handleSimpleMethod = async (method: 'CASH' | 'CHARGE_TO_SLIP') => {
    setStatus('processing');
    const result = await recordSimplePayment.execute({
      invoiceId,
      amountCents: balanceDue,
      method,
    });
    if (result) {
      setStatus('success');
      setStep('simple_method_result');
      onPaid?.();
    } else {
      setErrorMessage(recordSimplePayment.error ?? 'Payment failed.');
      setStatus('error');
      setStep('simple_method_result');
    }
  };

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} className="helm-modal" onClick={(e) => e.stopPropagation()}>
        <div style={s.header}>
          <h2 style={s.headerTitle}>Record Payment</h2>
          <button style={s.closeBtn} onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div style={s.body}>
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

          {step === 'choose' && (
            <div style={s.methodList}>
              <button
                style={{ ...s.methodBtn, ...s.methodBtnPrimary }}
                onClick={handleCardOnFile}
                disabled={status === 'processing'}
              >
                {status === 'processing' ? <Loader2 size={20} /> : <CreditCard size={20} />}
                <div style={s.methodLabel}>
                  Charge card on file
                  <div style={s.methodHint}>Instant — no form. POS-style.</div>
                </div>
              </button>
              <button
                style={s.methodBtn}
                onClick={handleNewCard}
                disabled={status === 'processing'}
              >
                <Plus size={20} />
                <div style={s.methodLabel}>
                  New card / ACH
                  <div style={s.methodHint}>Enter new card or bank details.</div>
                </div>
              </button>
              <button
                style={s.methodBtn}
                onClick={() => handleSimpleMethod('CASH')}
                disabled={status === 'processing'}
              >
                <Banknote size={20} />
                <div style={s.methodLabel}>Cash</div>
              </button>
              <button
                style={s.methodBtn}
                onClick={() => handleSimpleMethod('CHARGE_TO_SLIP')}
                disabled={status === 'processing'}
              >
                <Anchor size={20} />
                <div style={s.methodLabel}>Charge to slip</div>
              </button>
            </div>
          )}

          {step === 'card_on_file_result' && status === 'success' && (
            <div style={s.successBox}>
              <CheckCircle size={24} />
              Payment of {formatCents(balanceDue)} charged to card on file.
            </div>
          )}
          {step === 'card_on_file_result' && status === 'error' && (
            <div style={s.errorBox}>
              <AlertCircle size={24} />
              {errorMessage}
            </div>
          )}

          {step === 'simple_method_result' && status === 'success' && (
            <div style={s.successBox}>
              <CheckCircle size={24} />
              Payment recorded.
            </div>
          )}
          {step === 'simple_method_result' && status === 'error' && (
            <div style={s.errorBox}>
              <AlertCircle size={24} />
              {errorMessage}
            </div>
          )}

          {step === 'new_card' && checkoutClientSecret && (
            <CheckoutProvider
              stripe={getStripe()}
              options={{
                fetchClientSecret: async () => checkoutClientSecret,
              }}
            >
              <CheckoutPaymentForm onClose={onClose} onPaid={onPaid} />
            </CheckoutProvider>
          )}
        </div>

        <div style={s.footer}>
          <button style={s.cancelBtn} onClick={onClose}>
            {status === 'success' ? 'Close' : 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Embedded Checkout form (new card flow) ─── */

function CheckoutPaymentForm({
  onClose,
  onPaid,
}: {
  onClose: () => void;
  onPaid?: () => void;
}) {
  const checkout = useCheckout();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    setSubmitting(true);
    setError(null);
    const result = await checkout.confirm();
    if (result.type === 'error') {
      setError(result.error.message);
      setSubmitting(false);
      return;
    }
    // Stripe redirects to return_url on success for redirect-required flows.
    // Non-redirect flows fall through here.
    onPaid?.();
    onClose();
  };

  return (
    <div>
      <PaymentElement />
      {error && (
        <div style={{ ...s.errorBox, marginTop: '16px' }}>
          <AlertCircle size={20} />
          {error}
        </div>
      )}
      <button
        style={{ ...s.primaryBtn, marginTop: '16px', width: '100%' }}
        onClick={handleConfirm}
        disabled={submitting}
      >
        {submitting ? 'Processing...' : 'Pay'}
      </button>
    </div>
  );
}
