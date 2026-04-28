import { useEffect, useState } from 'react';
import {
  X,
  CreditCard,
  Plus,
  Banknote,
  Anchor,
  CheckCircle,
  AlertCircle,
  Loader2,
  Building2,
} from 'lucide-react';
import { Link } from 'react-router-dom';
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

interface SavedMethod {
  id: string;
  kind: 'card' | 'bank';
  brand: string;
  label: string;
  last4: string;
  expMonth: number | null;
  expYear: number | null;
  expiry: string | null;
  isDefault: boolean;
}

interface PaymentMethodsResponse {
  methods: SavedMethod[];
  defaultMethodId: string | null;
  autopay: boolean;
  stripeConfigured: boolean;
  locationConnected: boolean;
  locationName: string | null;
}

interface PaymentModalProps {
  invoiceId: string;
  invoiceNumber: string;
  customerId: string;
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
  sectionLabel: {
    fontSize: '11px', fontWeight: 700, color: '#2E4A6B', textTransform: 'uppercase',
    letterSpacing: '0.05em', marginBottom: '8px', marginTop: '4px',
  },
  methodList: { display: 'grid', gap: '10px', marginBottom: '20px' },
  amountRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    gap: '12px', padding: '12px 14px', borderRadius: '8px',
    border: '1px solid #CCCCCC', backgroundColor: '#F7F9FB',
    marginBottom: '12px',
  },
  amountLabel: {
    fontSize: '12px', fontWeight: 600, color: '#0A2342',
  },
  amountHint: {
    fontSize: '11px', fontWeight: 400, color: '#2E4A6B', marginTop: '2px',
  },
  amountInputWrap: {
    display: 'flex', alignItems: 'center', gap: '4px',
    border: '1px solid #CCCCCC', borderRadius: '6px',
    backgroundColor: '#FFFFFF', padding: '6px 10px',
  },
  amountInput: {
    width: '100px', border: 'none', outline: 'none', fontSize: '14px',
    fontWeight: 600, color: '#0A2342', textAlign: 'right',
    fontFamily: '"JetBrains Mono", monospace', backgroundColor: 'transparent',
  },
  amountError: {
    fontSize: '12px', color: '#B71C1C', marginTop: '6px', marginBottom: '12px',
  },
  methodBtn: {
    display: 'flex', alignItems: 'center', gap: '12px',
    padding: '14px 18px', borderRadius: '8px', border: '1px solid #CCCCCC',
    backgroundColor: '#FFFFFF', cursor: 'pointer', fontSize: '14px', fontWeight: 600,
    color: '#0A2342', textAlign: 'left', transition: 'border-color 0.15s, background-color 0.15s',
    width: '100%',
  },
  savedMethodBtn: {
    display: 'flex', alignItems: 'center', gap: '12px',
    padding: '14px 18px', borderRadius: '8px', border: '1px solid #0A2342',
    backgroundColor: '#0A2342', cursor: 'pointer', fontSize: '14px', fontWeight: 600,
    color: '#FFFFFF', textAlign: 'left',
    width: '100%',
  },
  methodLabel: { flex: 1 },
  methodHint: { fontSize: '12px', fontWeight: 400, opacity: 0.7, marginTop: '2px' },
  defaultPill: {
    fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '9999px',
    backgroundColor: '#00D4FF', color: '#0A2342', letterSpacing: '0.04em',
    textTransform: 'uppercase',
  },
  emptyBox: {
    backgroundColor: '#F7F9FB', border: '1px dashed #CCCCCC', borderRadius: '8px',
    padding: '20px', marginBottom: '20px', color: '#2E4A6B', fontSize: '13px',
    lineHeight: 1.5,
  },
  emptyTitle: {
    fontSize: '14px', fontWeight: 700, color: '#0A2342', marginBottom: '6px',
  },
  emptyLink: {
    color: '#0A2342', fontWeight: 600, textDecoration: 'underline',
  },
  loadingBox: {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
    padding: '20px', color: '#64748B', fontSize: '13px', marginBottom: '20px',
  },
  divider: {
    height: '1px', backgroundColor: '#E2E8F0', margin: '16px 0', border: 'none',
  },
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
  expiredPill: {
    fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '9999px',
    backgroundColor: '#FBE9E7', color: '#B71C1C', letterSpacing: '0.04em',
    textTransform: 'uppercase',
  },
  expiredBanner: {
    backgroundColor: '#FFF4E5', border: '1px solid #FFB74D', borderRadius: '8px',
    padding: '12px 14px', marginBottom: '12px', color: '#7A4F01', fontSize: '13px',
    lineHeight: 1.5,
  },
  expiredBannerTitle: {
    fontSize: '13px', fontWeight: 700, color: '#7A4F01', marginBottom: '4px',
    display: 'flex', alignItems: 'center', gap: '6px',
  },
};

/* ─── Helpers ─── */

export function isCardExpired(method: SavedMethod, now: Date = new Date()): boolean {
  if (method.kind !== 'card') return false;
  if (!method.expMonth || !method.expYear) return false;
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1; // 1-12
  if (method.expYear < currentYear) return true;
  if (method.expYear === currentYear && method.expMonth < currentMonth) return true;
  return false;
}

/* ─── Main component ─── */

export default function PaymentModal({
  invoiceId,
  invoiceNumber,
  customerId,
  customer,
  balanceDue,
  onClose,
  onPaid,
}: PaymentModalProps) {
  const [step, setStep] = useState<Step>('choose');
  const [status, setStatus] = useState<Status>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [chargingMethodId, setChargingMethodId] = useState<string | null>(null);
  const [chargedMethodKind, setChargedMethodKind] = useState<'card' | 'bank' | null>(null);
  const [chargedAmountCents, setChargedAmountCents] = useState<number>(balanceDue);
  const [checkoutClientSecret, setCheckoutClientSecret] = useState<string | null>(null);
  // Amount input for charging a saved method. Defaults to the full balance
  // and is editable so staff can take a partial payment (deposit, instalment).
  // Stored as a string to allow free-form typing; parsed on submit.
  const [amountInput, setAmountInput] = useState<string>(
    (balanceDue / 100).toFixed(2),
  );

  const savedMethods = useApi<PaymentMethodsResponse>(
    'get',
    `/api/customers/${customerId}/payment-methods`,
    { immediate: true },
  );
  const chargeCardOnFile = useApi<{ status: string; requiresAction: boolean }>(
    'post',
    '/api/checkout/charge-card-on-file',
  );
  const createSession = useApi<{ clientSecret: string }>('post', '/api/checkout/invoice-session');
  const recordSimplePayment = useApi('post', '/api/payments');

  // Sort saved methods so the default one is shown first.
  const methods = savedMethods.data?.methods ?? [];
  const sortedMethods = [...methods].sort((a, b) => {
    if (a.isDefault && !b.isDefault) return -1;
    if (!a.isDefault && b.isDefault) return 1;
    return 0;
  });

  // Reset transient state when the customer changes (defensive). Also reseed
  // the amount field so a freshly-opened modal shows the current balance.
  useEffect(() => {
    setStep('choose');
    setStatus('idle');
    setErrorMessage('');
    setChargingMethodId(null);
    setChargedMethodKind(null);
    setChargedAmountCents(balanceDue);
    setAmountInput((balanceDue / 100).toFixed(2));
  }, [customerId, invoiceId, balanceDue]);

  // Parse the amount input into cents. Accepts decimals like "12.5" and
  // whole-dollar values. Returns null when the input is empty or invalid.
  const parsedAmountCents = (() => {
    const trimmed = amountInput.trim();
    if (!trimmed) return null;
    const num = Number(trimmed);
    if (!Number.isFinite(num)) return null;
    return Math.round(num * 100);
  })();
  const amountValid =
    parsedAmountCents !== null &&
    parsedAmountCents > 0 &&
    parsedAmountCents <= balanceDue;
  const amountErrorMsg = (() => {
    if (parsedAmountCents === null) return 'Enter an amount.';
    if (parsedAmountCents <= 0) return 'Amount must be greater than zero.';
    if (parsedAmountCents > balanceDue) {
      return `Amount can't exceed the balance due (${formatCents(balanceDue)}).`;
    }
    return null;
  })();

  const handleChargeSavedMethod = async (method: SavedMethod) => {
    if (!amountValid || parsedAmountCents === null) return;
    if (isCardExpired(method)) {
      const proceed = window.confirm(
        `This card looks expired (${method.expiry ?? 'past expiry date'}) and the bank ` +
          `will likely decline the charge. Ask the customer to add a new payment method ` +
          `from their portal or the Billing tab on their customer record.\n\n` +
          `Attempt the charge anyway?`,
      );
      if (!proceed) return;
    }
    setChargingMethodId(method.id);
    setChargedMethodKind(method.kind);
    setChargedAmountCents(parsedAmountCents);
    setStatus('processing');
    const result = await chargeCardOnFile.execute({
      invoiceId,
      paymentMethodId: method.id,
      amountCents: parsedAmountCents,
    });
    if (result && result.status === 'succeeded') {
      setStatus('success');
      setStep('card_on_file_result');
      onPaid?.();
    } else if (result && result.requiresAction) {
      setErrorMessage(
        method.kind === 'bank'
          ? 'Bank account requires verification. Use "New card / ACH" to complete.'
          : 'Card requires 3DS authentication. Use "New card / ACH" to complete.',
      );
      setStatus('error');
      setStep('card_on_file_result');
    } else {
      setErrorMessage(chargeCardOnFile.error ?? 'Charge failed.');
      setStatus('error');
      setStep('card_on_file_result');
    }
    setChargingMethodId(null);
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

  // Stripe is "ready" when the API confirmed a connected account exists.
  const stripeReady =
    !!savedMethods.data?.stripeConfigured && !!savedMethods.data?.locationConnected;
  // Only block the new-card flow when Stripe is *explicitly* reported as
  // unconfigured. A transient fetch error or an in-flight load shouldn't
  // prevent staff from opening the new-card form.
  const stripeExplicitlyUnconfigured =
    !!savedMethods.data &&
    (!savedMethods.data.stripeConfigured || !savedMethods.data.locationConnected);
  const noStripeMessage = stripeExplicitlyUnconfigured
    ? `Stripe is not yet connected for ${
        savedMethods.data?.locationName ?? 'this location'
      }. Saved cards and new card payments are unavailable until it is set up.`
    : null;

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
            <>
              {/* Saved methods section */}
              <div style={s.sectionLabel}>Saved methods on file</div>

              {savedMethods.loading && (
                <div style={s.loadingBox}>
                  <Loader2 size={16} /> Loading saved cards…
                </div>
              )}

              {!savedMethods.loading && savedMethods.error && (
                <div style={s.emptyBox}>
                  <div style={s.emptyTitle}>Couldn't load saved methods</div>
                  {savedMethods.error}
                </div>
              )}

              {!savedMethods.loading && !savedMethods.error && noStripeMessage && (
                <div style={s.emptyBox}>
                  <div style={s.emptyTitle}>Stripe not connected</div>
                  {noStripeMessage}
                </div>
              )}

              {!savedMethods.loading &&
                !savedMethods.error &&
                stripeReady &&
                sortedMethods.length === 0 && (
                  <div style={s.emptyBox}>
                    <div style={s.emptyTitle}>No saved cards or banks</div>
                    This customer doesn't have any payment methods on file yet.{' '}
                    <Link
                      to={`/customers/${customerId}?tab=billing`}
                      style={s.emptyLink}
                      onClick={onClose}
                    >
                      Add one from their Billing tab
                    </Link>
                    , or use a new card below.
                  </div>
                )}

              {!savedMethods.loading && stripeReady && sortedMethods.length > 0 && (
                <>
                  {sortedMethods.some((m) => isCardExpired(m)) && (
                    <div style={s.expiredBanner}>
                      <div style={s.expiredBannerTitle}>
                        <AlertCircle size={14} />
                        Expired card on file
                      </div>
                      One or more saved cards are past their expiry date and will likely
                      be declined. Ask the customer to add a new payment method from their
                      portal, or open their{' '}
                      <Link
                        to={`/customers/${customerId}?tab=billing`}
                        style={{ ...s.emptyLink, color: '#7A4F01' }}
                        onClick={onClose}
                      >
                        Billing tab
                      </Link>{' '}
                      to add one for them.
                    </div>
                  )}
                  <div style={s.amountRow}>
                    <div>
                      <div style={s.amountLabel}>Amount to charge</div>
                      <div style={s.amountHint}>
                        Defaults to the full balance — edit for a partial payment.
                      </div>
                    </div>
                    <div
                      style={{
                        ...s.amountInputWrap,
                        borderColor: amountErrorMsg ? '#B71C1C' : '#CCCCCC',
                      }}
                    >
                      <span style={{ color: '#2E4A6B', fontWeight: 600 }}>$</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={amountInput}
                        onChange={(e) => setAmountInput(e.target.value)}
                        disabled={status === 'processing'}
                        style={s.amountInput}
                        aria-label="Amount to charge"
                      />
                    </div>
                  </div>
                  {amountErrorMsg && (
                    <div style={s.amountError}>{amountErrorMsg}</div>
                  )}
                  <div style={s.methodList}>
                    {sortedMethods.map((m) => {
                      const isCharging = chargingMethodId === m.id;
                      const Icon = m.kind === 'bank' ? Building2 : CreditCard;
                      const expired = isCardExpired(m);
                      const disabled = status === 'processing' || !amountValid;
                      return (
                        <button
                          key={m.id}
                          style={{
                            ...s.savedMethodBtn,
                            opacity:
                              (status === 'processing' && !isCharging) || !amountValid
                                ? 0.5
                                : 1,
                            cursor: disabled ? 'not-allowed' : 'pointer',
                            ...(expired
                              ? {
                                  backgroundColor: '#FFFFFF',
                                  color: '#0A2342',
                                  border: '1px solid #E57373',
                                }
                              : {}),
                          }}
                          onClick={() => handleChargeSavedMethod(m)}
                          disabled={disabled}
                        >
                          {isCharging ? (
                            <Loader2 size={20} />
                          ) : (
                            <Icon size={20} color={expired ? '#B71C1C' : undefined} />
                          )}
                          <div style={s.methodLabel}>
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                              }}
                            >
                              {m.label} •••• {m.last4}
                              {m.isDefault && (
                                <span style={s.defaultPill}>Default</span>
                              )}
                              {expired && (
                                <span style={s.expiredPill}>Expired</span>
                              )}
                            </div>
                            <div
                              style={{
                                ...s.methodHint,
                                ...(expired
                                  ? { color: '#B71C1C', opacity: 1 }
                                  : {}),
                              }}
                            >
                              {isCharging
                                ? 'Charging…'
                                : expired
                                  ? `Expired ${m.expiry ?? ''} · Charge will likely be declined`
                                  : m.kind === 'bank'
                                    ? 'Charge bank account on file'
                                    : m.expiry
                                      ? `Expires ${m.expiry} · Charge instantly`
                                      : 'Charge instantly'}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}

              <hr style={s.divider} />

              {/* Other methods */}
              <div style={s.sectionLabel}>Other methods</div>
              <div style={s.methodList}>
                <button
                  style={s.methodBtn}
                  onClick={handleNewCard}
                  disabled={status === 'processing' || stripeExplicitlyUnconfigured}
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
            </>
          )}

          {step === 'card_on_file_result' && status === 'success' && (
            <div style={s.successBox}>
              <CheckCircle size={24} />
              Payment of {formatCents(chargedAmountCents)} charged to{' '}
              {chargedMethodKind === 'bank' ? 'bank account on file' : 'card on file'}.
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
