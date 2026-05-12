import { useCallback, useEffect, useRef, useState } from 'react';
import {
  X,
  CreditCard,
  Banknote,
  CheckCircle,
  AlertCircle,
  AlertTriangle,
  Loader2,
  Building2,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '@clerk/clerk-react';
import { formatCents } from '../lib/format';
import { useApi } from '../hooks/useApi';
import { getStripeForAccount } from '../lib/stripe.js';
import {
  loadStripeTerminal,
  type Terminal,
  type Reader,
  type ISdkManagedPaymentIntent,
  type DiscoverResult,
  type ErrorResponse,
} from '@stripe/terminal-js';
import {
  Elements,
  CardElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';
import type { Stripe as StripeJs } from '@stripe/stripe-js';

/* ─── Types ─── */
type Step =
  | 'choose'
  | 'card_on_file_result'
  | 'card_flow'
  | 'card_flow_done'
  | 'simple_method_result';
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
const mono: React.CSSProperties = { fontFamily: 'Inter, system-ui, sans-serif', fontVariantNumeric: 'tabular-nums' };

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
    fontFamily: 'Inter, system-ui, sans-serif', fontVariantNumeric: 'tabular-nums', backgroundColor: 'transparent',
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
    display: 'flex', alignItems: 'flex-start', gap: '12px', color: '#1B5E20',
    fontSize: '15px', fontWeight: 600,
  },
  successHint: {
    fontSize: '13px', fontWeight: 400, color: '#1B5E20',
    marginTop: '6px', lineHeight: 1.4,
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
  cardFlowBox: {
    backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '8px',
    padding: '16px',
  },
  readerCard: {
    display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 16px',
    border: '1px solid #E2E8F0', borderRadius: '8px', cursor: 'pointer',
    marginBottom: '8px',
  },
  cnpDivider: {
    display: 'flex', alignItems: 'center', gap: '12px', margin: '20px 0',
  },
  cnpDividerLine: { flex: 1, borderTop: '1px solid #E2E8F0' } as React.CSSProperties,
  cnpDividerText: {
    fontSize: '12px', color: '#94A3B8', fontWeight: 500, whiteSpace: 'nowrap' as const,
  },
  outlineBtn: {
    width: '100%', padding: '10px', background: 'none',
    border: '1px solid #E2E8F0', borderRadius: '8px', cursor: 'pointer',
    fontSize: '13px', color: '#64748B',
  },
  warnBanner: {
    display: 'flex', alignItems: 'flex-start', gap: '10px',
    padding: '12px 14px', background: '#FEF3C7', border: '1px solid #FCD34D',
    borderRadius: '8px', marginBottom: '16px', color: '#92400E',
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
  const [chargedMethodLabel, setChargedMethodLabel] = useState<string | null>(null);
  const [chargedMethodLast4, setChargedMethodLast4] = useState<string | null>(null);
  const [chargedAmountCents, setChargedAmountCents] = useState<number>(balanceDue);
  // Set true when a charge / payment succeeded so the parent invoice page is
  // refetched exactly once when the user dismisses the modal — not while the
  // success screen is still mounted. Prevents the dialog from appearing to
  // vanish before staff can read the confirmation.
  const [pendingPaidNotification, setPendingPaidNotification] = useState(false);
  // Latch that guarantees onPaid fires at most once per successful charge,
  // even if a user manages to click Done + the overlay (or hammer Escape +
  // close) in the same tick before React has re-rendered with the cleared
  // pending flag.
  const dismissedRef = useRef(false);
  // Amount input for charging a saved method or running the new card flow.
  // Defaults to the full balance and is editable so staff can take a partial
  // payment. Stored as a string to allow free-form typing; parsed on submit.
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
    setChargedMethodLabel(null);
    setChargedMethodLast4(null);
    setChargedAmountCents(balanceDue);
    setPendingPaidNotification(false);
    setAmountInput((balanceDue / 100).toFixed(2));
  }, [customerId, invoiceId, balanceDue]);

  const handleDismiss = () => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    if (pendingPaidNotification) {
      setPendingPaidNotification(false);
      onPaid?.();
    } else {
      onClose();
    }
  };

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
    setChargedMethodLabel(method.label);
    setChargedMethodLast4(method.last4);
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
      setPendingPaidNotification(true);
    } else if (result && result.requiresAction) {
      setErrorMessage(
        method.kind === 'bank'
          ? 'Bank account requires verification. Ask the customer to complete it from their portal.'
          : 'Card requires 3DS authentication. Ask the customer to complete it from their portal.',
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

  const handleStartCardFlow = () => {
    if (!amountValid) return;
    setErrorMessage('');
    setStep('card_flow');
  };

  const handleCardFlowComplete = (amountCents: number) => {
    setChargedAmountCents(amountCents);
    setStatus('success');
    setStep('card_flow_done');
    setPendingPaidNotification(true);
  };

  const handleSimpleMethod = async (method: 'CASH') => {
    if (!amountValid || parsedAmountCents === null) return;
    setStatus('processing');
    const result = await recordSimplePayment.execute({
      invoiceId,
      customerId,
      amountCents: parsedAmountCents,
      method,
    });
    if (result) {
      setStatus('success');
      setStep('simple_method_result');
      setPendingPaidNotification(true);
    } else {
      setErrorMessage(recordSimplePayment.error ?? 'Payment failed.');
      setStatus('error');
      setStep('simple_method_result');
    }
  };

  // Stripe is "ready" when the API confirmed a connected account exists.
  const stripeReady =
    !!savedMethods.data?.stripeConfigured && !!savedMethods.data?.locationConnected;
  const stripeExplicitlyUnconfigured =
    !!savedMethods.data &&
    (!savedMethods.data.stripeConfigured || !savedMethods.data.locationConnected);
  const noStripeMessage = stripeExplicitlyUnconfigured
    ? `Stripe is not yet connected for ${
        savedMethods.data?.locationName ?? 'this location'
      }. Saved cards and new card payments are unavailable until it is set up.`
    : null;

  return (
    <div style={s.overlay} onClick={handleDismiss}>
      <div style={s.modal} className="helm-modal" onClick={(e) => e.stopPropagation()}>
        <div style={s.header}>
          <h2 style={s.headerTitle}>Record Payment</h2>
          <button style={s.closeBtn} onClick={handleDismiss}>
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
              {errorMessage && status !== 'processing' && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '8px',
                    padding: '12px 14px',
                    marginBottom: '16px',
                    backgroundColor: '#FFEBEE',
                    border: '1px solid #FFCDD2',
                    borderRadius: '6px',
                    color: '#B71C1C',
                    fontSize: '13px',
                    lineHeight: 1.5,
                  }}
                >
                  <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '1px' }} />
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* Amount input — drives saved-card, new-card, and Cash flows. */}
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
                    , or use the card option below to take a card payment now.
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
                  onClick={handleStartCardFlow}
                  disabled={
                    status === 'processing' ||
                    stripeExplicitlyUnconfigured ||
                    !amountValid
                  }
                >
                  <CreditCard size={20} />
                  <div style={s.methodLabel}>
                    Card (Terminal or keyed)
                    <div style={s.methodHint}>
                      Tap, insert, or swipe on a Stripe Terminal reader, or key a card
                      in by hand.
                    </div>
                  </div>
                </button>
                <button
                  style={s.methodBtn}
                  onClick={() => handleSimpleMethod('CASH')}
                  disabled={status === 'processing' || !amountValid}
                >
                  <Banknote size={20} />
                  <div style={s.methodLabel}>Cash</div>
                </button>
              </div>
            </>
          )}

          {step === 'card_on_file_result' && status === 'success' && (
            <div style={s.successBox}>
              <CheckCircle size={24} />
              <div>
                <div>
                  Charge of {formatCents(chargedAmountCents)} sent to{' '}
                  {chargedMethodLabel ?? (chargedMethodKind === 'bank' ? 'bank account' : 'card')}
                  {chargedMethodLast4 ? ` •••• ${chargedMethodLast4}` : ''}.
                </div>
                <div style={s.successHint}>
                  Payment is being recorded — the invoice balance will update
                  shortly once Stripe confirms.
                </div>
              </div>
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

          {step === 'card_flow' && parsedAmountCents !== null && (
            <InvoiceCardFlow
              invoiceId={invoiceId}
              amountCents={parsedAmountCents}
              onCancel={() => setStep('choose')}
              onComplete={handleCardFlowComplete}
            />
          )}

          {step === 'card_flow_done' && (
            <div style={s.successBox}>
              <CheckCircle size={24} />
              <div>
                <div>
                  Card payment of {formatCents(chargedAmountCents)} recorded.
                </div>
                <div style={s.successHint}>
                  The invoice balance and payment history will refresh when you
                  close this dialog.
                </div>
              </div>
            </div>
          )}
        </div>

        <div style={s.footer}>
          <button
            style={status === 'success' ? s.primaryBtn : s.cancelBtn}
            onClick={handleDismiss}
          >
            {status === 'success' ? 'Done' : 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* Invoice card flow — Stripe Terminal + keyed CNP, invoice-scoped. */

interface StripeReader {
  id: string;
  label: string;
  status: string;
  device_type: string;
}
type CardFlowStatus =
  | 'loading'
  | 'readers'
  | 'connecting'
  | 'collecting'
  | 'processing'
  | 'finalizing'
  | 'cnp'
  | 'cnp_processing'
  | 'error';

function InvoiceCardFlow({
  invoiceId,
  amountCents,
  onCancel,
  onComplete,
}: {
  invoiceId: string;
  amountCents: number;
  onCancel: () => void;
  onComplete: (amountCents: number) => void;
}) {
  const { getToken } = useAuth();
  const [status, setStatus] = useState<CardFlowStatus>('loading');
  const [readers, setReaders] = useState<StripeReader[]>([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [selectedReader, setSelectedReader] = useState<StripeReader | null>(null);
  const [noReaderWarning, setNoReaderWarning] = useState<
    'none' | 'no_reader' | 'discovery_failed'
  >('none');
  const [cnpStripePromise, setCnpStripePromise] =
    useState<Promise<StripeJs | null> | null>(null);
  const [cnpAccountError, setCnpAccountError] = useState('');

  const terminalRef = useRef<Terminal | null>(null);
  const rawReadersRef = useRef<Map<string, Reader>>(new Map());

  const apiCall = useCallback(
    async <T,>(httpMethod: string, path: string, body?: unknown): Promise<T> => {
      const token = await getToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(path, {
        method: httpMethod,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? 'Request failed');
      }
      return res.json() as Promise<T>;
    },
    [getToken],
  );

  const discoverReaders = useCallback(async () => {
    setStatus('loading');
    setErrorMsg('');
    setNoReaderWarning('none');
    rawReadersRef.current.clear();
    try {
      const { secret } = await apiCall<{ secret: string }>(
        'POST',
        '/api/checkout/invoice-card/connection-token',
        { invoiceId },
      );
      const StripeTerminal = await loadStripeTerminal();
      if (!StripeTerminal) throw new Error('Stripe Terminal SDK failed to load');
      const terminal = StripeTerminal.create({
        onFetchConnectionToken: async () => secret,
        onUnexpectedReaderDisconnect: () => {
          setStatus('error');
          setErrorMsg('Reader disconnected unexpectedly.');
        },
      });
      terminalRef.current = terminal;

      const result = (await terminal.discoverReaders({ simulated: false })) as
        | DiscoverResult
        | ErrorResponse;
      if ('error' in result) {
        throw new Error(result.error.message ?? 'Reader discovery failed');
      }
      const sdkReaders = result.discoveredReaders;
      sdkReaders.forEach((r) => rawReadersRef.current.set(r.id, r));

      const merged: StripeReader[] = sdkReaders.map((r) => ({
        id: r.id,
        label: r.label || r.serial_number || 'Reader',
        status: r.status ?? 'online',
        device_type: r.device_type ?? '',
      }));

      setReaders(merged);
      if (merged.length === 0) {
        setNoReaderWarning('no_reader');
        setStatus('cnp');
      } else {
        setStatus('readers');
      }
    } catch {
      setReaders([]);
      setNoReaderWarning('discovery_failed');
      setStatus('cnp');
    }
  }, [apiCall, invoiceId]);

  const connectAndCollect = useCallback(
    async (reader: StripeReader) => {
      if (!terminalRef.current) return;
      setSelectedReader(reader);
      setStatus('connecting');
      try {
        const rawReader = rawReadersRef.current.get(reader.id);
        if (!rawReader) {
          setErrorMsg('Reader not found — try refreshing.');
          setStatus('error');
          return;
        }
        const connectResult = await terminalRef.current.connectReader(rawReader);
        if ('error' in connectResult) {
          setErrorMsg(connectResult.error.message ?? 'Connect failed');
          setStatus('error');
          return;
        }
        setStatus('collecting');
        const { paymentIntentId, clientSecret } = await apiCall<{
          paymentIntentId: string;
          clientSecret: string;
        }>('POST', '/api/checkout/invoice-card/intent', {
          invoiceId,
          amountCents,
          mode: 'terminal',
        });
        const collectResult = await terminalRef.current.collectPaymentMethod(clientSecret);
        if ('error' in collectResult) {
          setErrorMsg(collectResult.error.message ?? 'Card collection cancelled');
          setStatus('error');
          return;
        }
        setStatus('processing');
        const processResult = await terminalRef.current.processPayment(
          collectResult.paymentIntent as ISdkManagedPaymentIntent,
        );
        if ('error' in processResult) {
          setErrorMsg(processResult.error.message ?? 'Payment processing failed');
          setStatus('error');
          return;
        }
        const piId: string = processResult.paymentIntent.id ?? paymentIntentId;
        setStatus('finalizing');
        await apiCall('POST', '/api/checkout/invoice-card/finalize', {
          invoiceId,
          paymentIntentId: piId,
          amountCents,
        });
        onComplete(amountCents);
      } catch (err) {
        setErrorMsg((err as Error).message ?? 'Terminal payment failed');
        setStatus('error');
      }
    },
    [apiCall, amountCents, invoiceId, onComplete],
  );

  // Resolve the connected account, then load Stripe.js scoped to it so
  // confirmCardPayment hits the right account.
  useEffect(() => {
    if (status !== 'cnp' && status !== 'cnp_processing') return;
    if (cnpStripePromise || cnpAccountError) return;
    let cancelled = false;
    void (async () => {
      try {
        const { stripeAccountId } = await apiCall<{ stripeAccountId: string }>(
          'GET',
          `/api/checkout/invoice-card/account?invoiceId=${encodeURIComponent(invoiceId)}`,
        );
        if (cancelled) return;
        if (!stripeAccountId) {
          setCnpAccountError('Stripe is not configured for this invoice.');
          return;
        }
        setCnpStripePromise(getStripeForAccount(stripeAccountId));
      } catch (err) {
        if (cancelled) return;
        setCnpAccountError((err as Error).message ?? 'Could not load payment form');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status, invoiceId, apiCall, cnpStripePromise, cnpAccountError]);

  useEffect(() => {
    void discoverReaders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const formattedAmount = formatCents(amountCents);

  return (
    <div style={s.cardFlowBox}>
      {status === 'loading' && (
        <div style={{ textAlign: 'center', padding: '24px 0' }}>
          <Loader2 size={32} style={{ color: '#0A2342', marginBottom: '12px' }} />
          <div style={{ fontSize: '15px', fontWeight: 600, color: '#0A2342' }}>
            Looking for card readers…
          </div>
          <div style={{ fontSize: '13px', color: '#94A3B8', marginTop: '6px' }}>
            Connecting to Stripe Terminal
          </div>
        </div>
      )}

      {status === 'readers' && (
        <>
          <div
            style={{
              fontSize: '13px',
              fontWeight: 600,
              color: '#0A2342',
              marginBottom: '10px',
            }}
          >
            Available readers — charging {formattedAmount}
          </div>
          {readers.map((r) => (
            <div
              key={r.id}
              style={s.readerCard}
              onClick={() => void connectAndCollect(r)}
            >
              <Wifi size={20} style={{ color: '#22C55E', flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: '14px', color: '#0A2342' }}>
                  {r.label}
                </div>
                <div style={{ fontSize: '12px', color: '#64748B' }}>{r.device_type}</div>
              </div>
              <div style={{ fontSize: '12px', color: '#00D4FF', fontWeight: 600 }}>
                Use →
              </div>
            </div>
          ))}
          <button style={s.outlineBtn} onClick={() => void discoverReaders()}>
            Refresh readers
          </button>
          <div style={s.cnpDivider}>
            <div style={s.cnpDividerLine} />
            <span style={s.cnpDividerText}>or card not present</span>
            <div style={s.cnpDividerLine} />
          </div>
          <button
            style={{
              ...s.outlineBtn,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
            }}
            onClick={() => setStatus('cnp')}
          >
            <CreditCard size={15} /> Manually enter card
          </button>
        </>
      )}

      {status === 'connecting' && (
        <div style={{ textAlign: 'center', padding: '24px 0' }}>
          <Loader2 size={32} style={{ color: '#0A2342', marginBottom: '12px' }} />
          <div style={{ fontSize: '15px', fontWeight: 600, color: '#0A2342' }}>
            Connecting to {selectedReader?.label}…
          </div>
        </div>
      )}

      {status === 'collecting' && (
        <div style={{ textAlign: 'center', padding: '24px 0' }}>
          <CreditCard size={48} style={{ color: '#0A2342', marginBottom: '16px' }} />
          <div style={{ fontSize: '18px', fontWeight: 700, color: '#0A2342' }}>
            Tap, insert, or swipe
          </div>
          <div
            style={{
              fontSize: '32px',
              fontWeight: 700,
              color: '#00D4FF',
              margin: '10px 0',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {formattedAmount}
          </div>
          <div style={{ fontSize: '13px', color: '#64748B' }}>
            Waiting on {selectedReader?.label}
          </div>
        </div>
      )}

      {(status === 'processing' || status === 'finalizing') && (
        <div style={{ textAlign: 'center', padding: '24px 0' }}>
          <Loader2 size={32} style={{ color: '#0A2342', marginBottom: '12px' }} />
          <div style={{ fontSize: '15px', fontWeight: 600, color: '#0A2342' }}>
            {status === 'finalizing' ? 'Recording payment…' : 'Processing…'}
          </div>
        </div>
      )}

      {status === 'error' && (
        <div style={{ textAlign: 'center', padding: '12px 0' }}>
          <AlertTriangle
            size={32}
            style={{ color: '#DC2626', marginBottom: '12px' }}
          />
          <div
            style={{
              fontSize: '15px',
              fontWeight: 600,
              color: '#DC2626',
              marginBottom: '6px',
            }}
          >
            Card payment failed
          </div>
          <div style={{ fontSize: '13px', color: '#64748B', marginBottom: '20px' }}>
            {errorMsg || 'Something went wrong. You can retry or cancel.'}
          </div>
          <button
            style={{
              padding: '10px 24px',
              background: '#0A2342',
              color: '#FFFFFF',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: 600,
              marginBottom: '12px',
            }}
            onClick={() => void discoverReaders()}
          >
            Try Again
          </button>
          <button style={s.outlineBtn} onClick={onCancel}>
            Back
          </button>
        </div>
      )}

      {(status === 'cnp' || status === 'cnp_processing') && (
        <>
          {cnpAccountError && (
            <div
              style={{
                padding: '10px 14px',
                background: '#FEF2F2',
                border: '1px solid #FECACA',
                borderRadius: '6px',
                color: '#DC2626',
                fontSize: '13px',
                marginBottom: '14px',
              }}
            >
              {cnpAccountError}
            </div>
          )}
          {noReaderWarning !== 'none' && (
            <div role="status" style={s.warnBanner}>
              <AlertTriangle
                size={18}
                style={{ color: '#B45309', flexShrink: 0, marginTop: '1px' }}
              />
              <div style={{ fontSize: '13px', lineHeight: 1.4 }}>
                {noReaderWarning === 'discovery_failed' ? (
                  <>
                    <div style={{ fontWeight: 700, marginBottom: '2px' }}>
                      Couldn't check for card readers
                    </div>
                    <div>You can key the card in below, or retry reader discovery.</div>
                  </>
                ) : (
                  <>
                    <div style={{ fontWeight: 700, marginBottom: '2px' }}>
                      No card reader detected
                    </div>
                    <div>You can key the card in below to take this payment.</div>
                  </>
                )}
              </div>
            </div>
          )}
          {cnpStripePromise ? (
            <Elements stripe={cnpStripePromise}>
              <InvoiceCnpForm
                invoiceId={invoiceId}
                amountCents={amountCents}
                apiCall={apiCall}
                onBack={
                  noReaderWarning === 'none'
                    ? () => setStatus('readers')
                    : () => void discoverReaders()
                }
                backLabel={
                  noReaderWarning === 'none'
                    ? '← Back to readers'
                    : '↻ Check for readers again'
                }
                onProcessingChange={(isProcessing) =>
                  setStatus(isProcessing ? 'cnp_processing' : 'cnp')
                }
                onComplete={() => onComplete(amountCents)}
              />
            </Elements>
          ) : !cnpAccountError ? (
            <div
              style={{
                padding: '24px',
                textAlign: 'center',
                color: '#64748B',
                fontSize: '14px',
              }}
            >
              Loading payment form…
            </div>
          ) : (
            <button style={s.outlineBtn} onClick={onCancel}>
              Cancel
            </button>
          )}
        </>
      )}
    </div>
  );
}

function InvoiceCnpForm({
  invoiceId,
  amountCents,
  apiCall,
  onBack,
  backLabel,
  onProcessingChange,
  onComplete,
}: {
  invoiceId: string;
  amountCents: number;
  apiCall: <T,>(method: string, path: string, body?: unknown) => Promise<T>;
  onBack: () => void;
  backLabel: string;
  onProcessingChange: (isProcessing: boolean) => void;
  onComplete: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleCharge = async () => {
    if (!stripe || !elements) return;
    setLoading(true);
    setErrorMsg('');
    onProcessingChange(true);
    try {
      const cardEl = elements.getElement(CardElement);
      if (!cardEl) throw new Error('Card form not ready');

      const created = await apiCall<{ paymentIntentId: string; clientSecret: string }>(
        'POST',
        '/api/checkout/invoice-card/intent',
        { invoiceId, amountCents, mode: 'cnp' },
      );
      if (!created?.clientSecret) throw new Error('Could not start payment');

      const { paymentIntent, error: confirmErr } = await stripe.confirmCardPayment(
        created.clientSecret,
        { payment_method: { card: cardEl } },
      );
      if (confirmErr) {
        throw new Error(confirmErr.message ?? 'Card declined');
      }
      if (!paymentIntent || paymentIntent.status !== 'succeeded') {
        throw new Error(
          `Payment did not complete (${paymentIntent?.status ?? 'unknown'})`,
        );
      }

      await apiCall('POST', '/api/checkout/invoice-card/finalize', {
        invoiceId,
        paymentIntentId: paymentIntent.id,
        amountCents,
      });

      onComplete();
    } catch (err) {
      setErrorMsg((err as Error).message ?? 'Payment failed');
      setLoading(false);
      onProcessingChange(false);
    }
  };

  return (
    <>
      <div style={{ textAlign: 'center', marginBottom: '20px' }}>
        <div
          style={{
            fontSize: '12px',
            color: '#64748B',
            marginBottom: '2px',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          Charging
        </div>
        <div
          style={{
            fontSize: '32px',
            fontWeight: 700,
            color: '#0A2342',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {formatCents(amountCents)}
        </div>
        <div style={{ fontSize: '11px', color: '#94A3B8', marginTop: '4px' }}>
          Card not present — keyed entry
        </div>
      </div>

      <div
        style={{
          padding: '14px 16px',
          border: '1px solid #CBD5E1',
          borderRadius: '8px',
          background: '#FFFFFF',
          marginBottom: '16px',
        }}
      >
        <CardElement
          options={{
            hidePostalCode: false,
            disableLink: true,
            style: {
              base: {
                fontSize: '15px',
                color: '#0A2342',
                '::placeholder': { color: '#94A3B8' },
              },
              invalid: { color: '#DC2626' },
            },
          }}
        />
      </div>

      {errorMsg && (
        <div
          style={{
            padding: '10px 14px',
            background: '#FEF2F2',
            border: '1px solid #FECACA',
            borderRadius: '6px',
            color: '#DC2626',
            fontSize: '13px',
            marginBottom: '14px',
          }}
        >
          {errorMsg}
        </div>
      )}

      <button
        style={{
          width: '100%',
          padding: '13px',
          background: loading ? '#94A3B8' : '#0A2342',
          color: '#FFFFFF',
          border: 'none',
          borderRadius: '8px',
          cursor: loading ? 'not-allowed' : 'pointer',
          fontSize: '15px',
          fontWeight: 700,
        }}
        onClick={() => void handleCharge()}
        disabled={loading || !stripe}
      >
        {loading ? 'Processing…' : `Charge ${formatCents(amountCents)}`}
      </button>
      <button
        style={{
          width: '100%',
          marginTop: '10px',
          padding: '10px',
          background: 'none',
          border: '1px solid #E2E8F0',
          borderRadius: '8px',
          cursor: loading ? 'not-allowed' : 'pointer',
          fontSize: '13px',
          color: '#64748B',
        }}
        onClick={onBack}
        disabled={loading}
      >
        {backLabel}
      </button>
    </>
  );
}
