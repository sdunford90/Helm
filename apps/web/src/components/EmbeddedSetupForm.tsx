import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import type { Stripe } from '@stripe/stripe-js';
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from '@stripe/react-stripe-js';
import { getStripeForAccount } from '../lib/stripe.js';

/* ─────────────────────────────────────────────────────────────────────────
 * EmbeddedSetupForm
 *
 * Shared inline (Elements-based) "save a payment method" form used by both
 * the customer profile's Cards on File modal and the invoice Record Payment
 * modal. Mounts a Stripe PaymentElement bound to a SetupIntent on a
 * specific Connect account and confirms it without leaving the page.
 *
 * Per-account Stripe.js
 *   SetupIntents minted on a connected account can ONLY be confirmed by a
 *   Stripe.js instance that was initialized with `{ stripeAccount }` set
 *   to that same account id — otherwise confirmSetup() resolves with
 *   "No such setupintent". We can't reuse the platform-scoped singleton
 *   from `getStripe()`, and we can't reuse the POS per-account cache
 *   either (different VITE keys, different lifecycle), so this component
 *   loads its own Stripe.js instance keyed on the connected account.
 *   Memoized via useMemo so a re-render doesn't refetch Stripe.js.
 *
 * Confirm without redirect
 *   `confirmSetup({ redirect: 'if_required' })` keeps the staff in the
 *   modal for normal card/ACH flows. If a flow truly requires a redirect
 *   (rare for SetupIntents), Stripe handles it and our onSuccess is not
 *   invoked.
 * ─────────────────────────────────────────────────────────────────────── */

interface EmbeddedSetupFormProps {
  // SetupIntent client secret returned by the backend.
  clientSecret: string;
  // Connected Stripe account id the SetupIntent was created on. Stripe.js
  // must be initialized with this account or confirmSetup() will fail.
  stripeAccountId: string;
  // 'card' or 'bank' — drives the form layout and which payment method
  // type the PaymentElement renders.
  type: 'card' | 'bank';
  onSuccess: () => void;
  onCancel: () => void;
}

export default function EmbeddedSetupForm({
  clientSecret,
  stripeAccountId,
  type,
  onSuccess,
  onCancel,
}: EmbeddedSetupFormProps) {
  // Per-account Stripe.js instance. Reuses the project-wide
  // `getStripeForAccount` cache so repeated modal opens for the same
  // location don't refetch Stripe.js, and so we don't duplicate the
  // missing-key warning logic. Memoized locally on the account id so the
  // <Elements> wrapper keeps a stable promise reference across re-renders.
  const stripePromise = useMemo<Promise<Stripe | null>>(
    () => getStripeForAccount(stripeAccountId),
    [stripeAccountId],
  );

  return (
    <Elements
      stripe={stripePromise}
      options={{
        clientSecret,
        appearance: { theme: 'stripe' },
      }}
    >
      <InnerForm type={type} onSuccess={onSuccess} onCancel={onCancel} />
    </Elements>
  );
}

function InnerForm({
  type,
  onSuccess,
  onCancel,
}: {
  type: 'card' | 'bank';
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // Defensive: clear any stale error when the form remounts.
  useEffect(() => {
    setError(null);
  }, []);

  const handleConfirm = async () => {
    if (!stripe || !elements) return;
    setSubmitting(true);
    setError(null);

    // Run the Element's own client-side validation first so the user
    // sees inline field errors instead of a confusing API error.
    const submitResult = await elements.submit();
    if (submitResult.error) {
      setError(submitResult.error.message ?? 'Please check the form and try again.');
      setSubmitting(false);
      return;
    }

    // No return_url so Stripe stays in-page for non-redirect flows. For
    // the rare flow that genuinely needs a redirect, omitting return_url
    // would surface an error here, which we then show to the user.
    const result = await stripe.confirmSetup({
      elements,
      redirect: 'if_required',
    });

    if (result.error) {
      setError(result.error.message ?? 'Could not save payment method.');
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
    onSuccess();
  };

  return (
    <div>
      {!ready && (
        <div style={loadingStyle}>
          <Loader2 size={16} /> Loading {type === 'bank' ? 'bank' : 'card'} form…
        </div>
      )}
      <PaymentElement
        options={{
          // Limit the rendered method to the SetupIntent's configured
          // type so staff don't see a card tab inside the "add bank" form.
          paymentMethodOrder: type === 'bank' ? ['us_bank_account'] : ['card'],
          // This form is for staff manually entering a customer's payment
          // info on the customer's behalf — it should NEVER offer to save
          // the customer's data into Stripe Link, prompt for a Link login,
          // or try to autofill from the staff member's own Link account.
          // Same goes for Apple Pay / Google Pay: those are buyer-present
          // wallets that don't make sense in a staff-entry workflow.
          wallets: {
            link: 'never',
            applePay: 'never',
            googlePay: 'never',
          },
        }}
        onReady={() => setReady(true)}
      />
      {error && (
        <div style={errorStyle}>
          <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '1px' }} />
          <span>{error}</span>
        </div>
      )}
      <div style={footerStyle}>
        <button
          type="button"
          style={cancelBtnStyle}
          onClick={onCancel}
          disabled={submitting}
        >
          Cancel
        </button>
        <button
          type="button"
          style={{
            ...primaryBtnStyle,
            opacity: submitting || !stripe || !ready ? 0.6 : 1,
            cursor: submitting || !stripe || !ready ? 'not-allowed' : 'pointer',
          }}
          onClick={handleConfirm}
          disabled={submitting || !stripe || !ready}
        >
          {submitting
            ? 'Saving…'
            : type === 'bank'
              ? 'Save bank account'
              : 'Save card'}
        </button>
      </div>
    </div>
  );
}

const loadingStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '8px',
  padding: '12px',
  color: '#64748B',
  fontSize: '13px',
};

const errorStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: '8px',
  marginTop: '12px',
  padding: '10px 12px',
  backgroundColor: '#FFEBEE',
  border: '1px solid #FFCDD2',
  borderRadius: '6px',
  color: '#B71C1C',
  fontSize: '13px',
};

const footerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: '12px',
  marginTop: '16px',
};

const cancelBtnStyle: React.CSSProperties = {
  padding: '10px 18px',
  fontSize: '14px',
  fontWeight: 600,
  color: '#0A2342',
  backgroundColor: '#FFFFFF',
  border: '1px solid #CCCCCC',
  borderRadius: '6px',
  cursor: 'pointer',
};

const primaryBtnStyle: React.CSSProperties = {
  padding: '10px 18px',
  fontSize: '14px',
  fontWeight: 600,
  color: '#FFFFFF',
  backgroundColor: '#0A2342',
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer',
};
