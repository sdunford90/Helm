import { useState, useEffect } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { CreditCard, Building2, Star, Trash2, Plus, ToggleLeft, ToggleRight, Loader, AlertCircle } from 'lucide-react';
import type { CSSProperties } from 'react';
import { usePortalApi } from '../lib/api';

const NAVY = '#0A2342';
const CYAN = '#00D4FF';

const card: CSSProperties = {
  background: '#fff',
  borderRadius: 12,
  padding: 24,
  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
};

interface PaymentMethod {
  id: string;
  type: string;
  label: string;
  last4: string;
  expiry: string | null;
  expMonth: number | null;
  expYear: number | null;
  isDefault: boolean;
  kind: 'card' | 'bank';
}

function isCardExpired(method: PaymentMethod, now: Date = new Date()): boolean {
  if (method.kind !== 'card') return false;
  if (!method.expMonth || !method.expYear) return false;
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  if (method.expYear < currentYear) return true;
  if (method.expYear === currentYear && method.expMonth < currentMonth) return true;
  return false;
}

interface PaymentMethodsResponse {
  methods: PaymentMethod[];
  autopay: boolean;
  defaultMethodId: string | null;
}

interface SetupSessionResponse {
  url: string;
}

async function authedFetch(url: string, options: RequestInit, token: string | null): Promise<Response> {
  return fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });
}

export default function PaymentMethods() {
  const { getToken } = useAuth();
  const [autopay, setAutopay] = useState(false);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [setupReturn] = useState(() => new URLSearchParams(window.location.search).get('setup'));

  const { data, loading, error, execute: fetchMethods } = usePortalApi<PaymentMethodsResponse>(
    'get',
    '/api/portal/payment-methods',
    { immediate: true },
  );

  const { execute: createSetupSession } = usePortalApi<SetupSessionResponse>(
    'post',
    '/api/portal/payment-methods/setup-session',
  );

  const { execute: updateAutopay } = usePortalApi<{ autopay: boolean }>(
    'put',
    '/api/portal/autopay',
  );

  useEffect(() => {
    if (data) {
      setMethods(data.methods);
      setAutopay(data.autopay);
    }
  }, [data]);

  // The default payment method drives every off-session autopay charge,
  // so an expired default means the next attempt will fail. Compute this
  // once and reuse it to gate the autopay toggle and the warning banner.
  const defaultMethod = methods.find((m) => m.isDefault) ?? null;
  const defaultExpired = defaultMethod ? isCardExpired(defaultMethod) : false;
  const autopayCandidates = methods.filter(
    (m) => !m.isDefault && !isCardExpired(m),
  );

  const handleToggleAutopay = async () => {
    const next = !autopay;
    // Block turning autopay ON when the default card is expired — Stripe
    // would decline the next charge. Disabling is always allowed so the
    // customer can quiet the warning while they fix the card.
    if (next && defaultExpired) {
      setErrorMsg(
        'Your default card is expired. Choose a different default payment method or add a new card before turning on auto-pay.',
      );
      return;
    }
    setErrorMsg(null);
    setAutopay(next);
    try {
      await updateAutopay({ autopay: next });
    } catch {
      setAutopay(!next);
    }
  };

  const handleAddCard = async (type: 'card' | 'bank') => {
    setErrorMsg(null);
    setActionLoading(`add-${type}`);
    try {
      const returnUrl = `${window.location.origin}/payments`;
      const result = await createSetupSession({ type, returnUrl });
      if (result?.url) {
        window.location.href = result.url;
      } else {
        setErrorMsg('Could not start payment setup. Please try again.');
      }
    } catch {
      setErrorMsg('Failed to start payment setup. Please try again.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleSetDefault = async (pmId: string) => {
    setErrorMsg(null);
    setActionLoading(`default-${pmId}`);
    try {
      const token = await getToken();
      const res = await authedFetch(
        `/api/portal/payment-methods/${pmId}/default`,
        { method: 'PUT', body: JSON.stringify({}) },
        token,
      );
      if (!res.ok) throw new Error('Failed to set default');
      const refreshed = await fetchMethods();
      if (refreshed) {
        setMethods(refreshed.methods);
        setAutopay(refreshed.autopay);
      }
    } catch {
      setErrorMsg('Failed to set default payment method.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRemove = async (pmId: string) => {
    if (!window.confirm('Remove this payment method?')) return;
    setErrorMsg(null);
    setActionLoading(`remove-${pmId}`);
    try {
      const token = await getToken();
      const res = await authedFetch(
        `/api/portal/payment-methods/${pmId}`,
        { method: 'DELETE', headers: {} },
        token,
      );
      if (!res.ok) throw new Error('Failed to remove');
      setMethods((prev) => prev.filter((m) => m.id !== pmId));
    } catch {
      setErrorMsg('Failed to remove payment method.');
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: NAVY, marginBottom: 4 }}>Payment Methods</h1>
          <p style={{ color: '#64748B', fontSize: 14 }}>Manage your saved payment methods and auto-pay settings.</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={() => handleAddCard('card')}
            disabled={actionLoading === 'add-card'}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '10px 18px', borderRadius: 8, border: 'none',
              background: CYAN, color: NAVY, fontSize: 14, fontWeight: 600,
              cursor: actionLoading === 'add-card' ? 'not-allowed' : 'pointer',
              opacity: actionLoading === 'add-card' ? 0.7 : 1,
            }}
          >
            {actionLoading === 'add-card' ? <Loader size={15} /> : <Plus size={16} />}
            Add Card
          </button>
          <button
            onClick={() => handleAddCard('bank')}
            disabled={actionLoading === 'add-bank'}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '10px 18px', borderRadius: 8,
              border: `1.5px solid ${NAVY}`, background: '#fff',
              color: NAVY, fontSize: 14, fontWeight: 600,
              cursor: actionLoading === 'add-bank' ? 'not-allowed' : 'pointer',
              opacity: actionLoading === 'add-bank' ? 0.7 : 1,
            }}
          >
            {actionLoading === 'add-bank' ? <Loader size={15} /> : <Building2 size={16} />}
            Add Bank (ACH)
          </button>
        </div>
      </div>

      {/* Success banner on return from Stripe setup */}
      {setupReturn === 'success' && (
        <div style={{
          ...card, marginBottom: 16,
          background: '#E6FAF0', border: '1px solid #6EE7B7',
          display: 'flex', alignItems: 'center', gap: 10, color: '#0D9F6E',
        }}>
          <Star size={18} />
          <span style={{ fontSize: 14, fontWeight: 600 }}>Payment method added successfully!</span>
        </div>
      )}

      {/* Error banner */}
      {errorMsg && (
        <div style={{
          ...card, marginBottom: 16,
          background: '#FFF0F0', border: '1px solid #FCA5A5',
          display: 'flex', alignItems: 'center', gap: 10, color: '#DC2626',
        }}>
          <AlertCircle size={18} />
          <span style={{ fontSize: 14 }}>{errorMsg}</span>
        </div>
      )}

      {/* Auto-Pay Toggle */}
      <div style={{ ...card, marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: NAVY, marginBottom: 4 }}>Auto-Pay</h2>
          <p style={{ color: '#64748B', fontSize: 13 }}>
            Automatically pay invoices on their due date using your default payment method.
          </p>
        </div>
        <button
          onClick={handleToggleAutopay}
          disabled={!autopay && defaultExpired}
          title={
            !autopay && defaultExpired
              ? 'Your default card is expired. Choose a different default before turning on auto-pay.'
              : autopay
                ? 'Click to turn auto-pay off'
                : 'Click to turn auto-pay on'
          }
          style={{
            background: 'none', border: 'none', padding: 0,
            cursor: !autopay && defaultExpired ? 'not-allowed' : 'pointer',
            opacity: !autopay && defaultExpired ? 0.5 : 1,
          }}
        >
          {autopay ? <ToggleRight size={40} color="#0D9F6E" /> : <ToggleLeft size={40} color="#94A3B8" />}
        </button>
      </div>

      {/* Loud warning when auto-pay is on but the default card is expired */}
      {autopay && defaultExpired && (
        <div style={{
          ...card, marginBottom: 24,
          background: '#FFEBEE', border: '1px solid #E57373',
          color: '#B71C1C',
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <AlertCircle size={20} style={{ flexShrink: 0, marginTop: 2 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>
                Auto-pay is on but your default card is expired
              </div>
              <div style={{ fontSize: 14, lineHeight: 1.5, marginBottom: autopayCandidates.length > 0 ? 12 : 0 }}>
                Your next automatic payment will be declined. Pick a different default
                payment method below, or add a new card above.
              </div>
              {autopayCandidates.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {autopayCandidates.map((m) => {
                    const busy = actionLoading === `default-${m.id}`;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => handleSetDefault(m.id)}
                        disabled={!!actionLoading}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 6,
                          padding: '8px 14px', borderRadius: 6,
                          border: '1px solid #B71C1C', background: '#FFFFFF',
                          color: '#B71C1C', fontSize: 13, fontWeight: 600,
                          cursor: actionLoading ? 'wait' : 'pointer',
                        }}
                      >
                        {busy ? <Loader size={14} /> : <Star size={14} />}
                        Use {m.label} ending in {m.last4}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Payment Methods List */}
      {loading ? (
        <div style={{ ...card, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, color: '#64748B', padding: 48 }}>
          <Loader size={20} /> <span>Loading payment methods…</span>
        </div>
      ) : error ? (
        <div style={{ ...card, textAlign: 'center', padding: 48, color: '#DC2626' }}>
          <AlertCircle size={24} style={{ marginBottom: 8 }} />
          <p style={{ margin: 0 }}>Could not load payment methods. Please refresh the page.</p>
        </div>
      ) : methods.length === 0 ? (
        <div style={{ ...card, textAlign: 'center', padding: 48, border: '2px dashed #E2E8F0', color: '#64748B' }}>
          <CreditCard size={40} color="#CBD5E1" style={{ marginBottom: 12 }} />
          <p style={{ fontSize: 15, fontWeight: 600, color: NAVY, margin: '0 0 8px' }}>No payment methods on file</p>
          <p style={{ fontSize: 13, margin: 0 }}>
            Add a card or bank account above to enable auto-pay and faster invoice payment.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {methods.some((pm) => isCardExpired(pm)) && (
            <div style={{
              ...card,
              background: '#FFF4E5', border: '1px solid #FFB74D',
              display: 'flex', alignItems: 'flex-start', gap: 12,
              color: '#7A4F01',
            }}>
              <AlertCircle size={18} style={{ flexShrink: 0, marginTop: 1 }} />
              <div style={{ fontSize: 14, lineHeight: 1.5 }}>
                <div style={{ fontWeight: 700, marginBottom: 2 }}>
                  Expired card on file
                </div>
                One or more of your saved cards is past its expiry date and will likely
                be declined. Add a new card above, then remove the expired one.
              </div>
            </div>
          )}
          {methods.map((pm) => {
            const expired = isCardExpired(pm);
            return (
            <div
              key={pm.id}
              style={{
                ...card,
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                border: expired
                  ? '2px solid #E57373'
                  : pm.isDefault
                    ? `2px solid ${CYAN}`
                    : '2px solid transparent',
                background: expired ? '#FFF8F7' : '#fff',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{
                  width: 48, height: 48, borderRadius: 10,
                  background: expired
                    ? '#FBE9E7'
                    : pm.kind === 'bank' ? '#EDE9FE' : '#EFF6FF',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {pm.kind === 'bank'
                    ? <Building2 size={22} color="#8B5CF6" />
                    : <CreditCard size={22} color={expired ? '#B71C1C' : '#3B82F6'} />}
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 15, fontWeight: 600, color: NAVY }}>
                      {pm.label} ending in {pm.last4}
                    </span>
                    {pm.isDefault && (
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        padding: '2px 8px', borderRadius: 12,
                        background: '#E6FAF0', color: '#0D9F6E',
                        fontSize: 11, fontWeight: 600,
                      }}>
                        <Star size={10} /> Default
                      </span>
                    )}
                    {expired && (
                      <span style={{
                        display: 'inline-flex', alignItems: 'center',
                        padding: '2px 8px', borderRadius: 12,
                        background: '#FBE9E7', color: '#B71C1C',
                        fontSize: 11, fontWeight: 700,
                        textTransform: 'uppercase', letterSpacing: '0.04em',
                      }}>
                        Expired
                      </span>
                    )}
                  </div>
                  <div style={{
                    fontSize: 13,
                    color: expired ? '#B71C1C' : '#64748B',
                    marginTop: 2,
                    fontWeight: expired ? 600 : 400,
                  }}>
                    {pm.expiry
                      ? expired
                        ? `Expired ${pm.expiry}`
                        : `Expires ${pm.expiry}`
                      : 'Bank account (ACH)'}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {!pm.isDefault && (
                  <button
                    onClick={() => handleSetDefault(pm.id)}
                    disabled={!!actionLoading}
                    style={{
                      padding: '6px 14px', borderRadius: 6,
                      border: '1px solid #E2E8F0', background: '#fff',
                      color: '#64748B', fontSize: 13, fontWeight: 500,
                      cursor: actionLoading ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {actionLoading === `default-${pm.id}` ? <Loader size={13} /> : 'Set Default'}
                  </button>
                )}
                <button
                  onClick={() => handleRemove(pm.id)}
                  disabled={!!actionLoading}
                  style={{
                    background: 'none', border: 'none',
                    color: '#DC2626', cursor: actionLoading ? 'not-allowed' : 'pointer',
                    padding: 4, opacity: actionLoading === `remove-${pm.id}` ? 0.5 : 1,
                  }}
                  title="Remove"
                >
                  {actionLoading === `remove-${pm.id}` ? <Loader size={16} /> : <Trash2 size={16} />}
                </button>
              </div>
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
