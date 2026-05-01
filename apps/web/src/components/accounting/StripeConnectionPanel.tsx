import React, { useState, useEffect, useCallback } from 'react';
import { CreditCard, RefreshCw, Plug, Unplug, Check, AlertTriangle } from 'lucide-react';
import { useModules } from '../../context/ModulesContext';

interface StripeLocationStatus {
  connected: boolean;
  accountId: string | null;
  onboardingComplete: boolean;
  chargesEnabled: boolean | null;
  payoutsEnabled: boolean | null;
  detailsSubmitted: boolean | null;
  requirementsCurrentlyDue: string[];
  requirementsPastDue: string[];
  requirementsPending: string[];
  disabledReason: string | null;
}

const stl = {
  card: { background: '#FFFFFF', borderRadius: '8px', border: '1px solid #E2E8F0', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', padding: '24px' } as React.CSSProperties,
  pill: (connected: boolean): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: '4px',
    padding: '4px 10px', borderRadius: '999px',
    fontSize: '12px', fontWeight: 600,
    backgroundColor: connected ? '#EDE9FE' : '#F1F5F9',
    color: connected ? '#5B21B6' : '#64748B',
  }),
  warningPill: { display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '4px 10px', borderRadius: '999px', fontSize: '12px', fontWeight: 600, backgroundColor: '#FEF3C7', color: '#92400E' } as React.CSSProperties,
  btn: { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 14px', fontSize: '13px', fontWeight: 600, border: '1px solid #E2E8F0', borderRadius: '6px', cursor: 'pointer', backgroundColor: '#F8FAFC', color: '#0A2342' } as React.CSSProperties,
  primary: { backgroundColor: '#635BFF', color: '#FFFFFF', borderColor: '#635BFF' } as React.CSSProperties,
  danger: { backgroundColor: '#FEF2F2', color: '#B91C1C', borderColor: '#FECACA' } as React.CSSProperties,
  meta: { fontSize: '13px', color: '#64748B', marginTop: '4px' } as React.CSSProperties,
  actions: { display: 'flex', gap: '8px', marginTop: '16px', flexWrap: 'wrap' as const },
  reqBox: { marginTop: '16px', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '6px', padding: '12px 16px', fontSize: '13px', color: '#78350F', lineHeight: 1.6 } as React.CSSProperties,
  reqHeader: { fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.05em', color: '#92400E', marginBottom: '6px' },
  reqList: { margin: 0, paddingLeft: '18px', fontSize: '12px' },
  webhookNote: { marginTop: '16px', padding: '12px 14px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '8px', display: 'flex', alignItems: 'flex-start', gap: '8px' } as React.CSSProperties,
};

function openOAuthPopup(url: string, onComplete: () => void) {
  const popup = window.open(url, 'stripe-onboarding', 'width=600,height=800,scrollbars=yes,resizable=yes');
  if (!popup) {
    window.location.href = url;
    return;
  }
  const interval = setInterval(() => {
    if (popup.closed) {
      clearInterval(interval);
      onComplete();
    }
  }, 500);
}

export default function StripeConnectionPanel() {
  const { currentLocationId } = useModules();
  const [status, setStatus] = useState<StripeLocationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const load = useCallback(async () => {
    if (!currentLocationId) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/settings/locations/${currentLocationId}`, { credentials: 'include' });
      if (!r.ok) {
        throw new Error(`Failed to load location (HTTP ${r.status})`);
      }
      const body = await r.json() as { location: { stripeAccountId: string | null; stripeOnboardingComplete: boolean } };
      const loc = body.location;

      // Always also pull the live Stripe status for capabilities + outstanding
      // requirements when an account exists. The live read is the source of
      // truth — `stripeOnboardingComplete` lags webhook delivery.
      let live: Omit<StripeLocationStatus, 'connected' | 'accountId' | 'onboardingComplete'> = {
        chargesEnabled: null,
        payoutsEnabled: null,
        detailsSubmitted: null,
        requirementsCurrentlyDue: [],
        requirementsPastDue: [],
        requirementsPending: [],
        disabledReason: null,
      };
      if (loc.stripeAccountId) {
        try {
          const lr = await fetch('/api/settings/stripe/refresh-status', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ locationId: currentLocationId }),
          });
          if (lr.ok) {
            // Server returns camelCase (see apps/api/src/routes/settings.ts):
            //   { chargesEnabled, payoutsEnabled, detailsSubmitted,
            //     requirements: { currentlyDue, pastDue, eventuallyDue,
            //                     pendingVerification, disabledReason } }
            const lbody = await lr.json() as {
              chargesEnabled?: boolean;
              payoutsEnabled?: boolean;
              detailsSubmitted?: boolean;
              requirements?: {
                currentlyDue?: string[];
                pastDue?: string[];
                pendingVerification?: string[];
                disabledReason?: string | null;
              };
            };
            live = {
              chargesEnabled: lbody.chargesEnabled ?? null,
              payoutsEnabled: lbody.payoutsEnabled ?? null,
              detailsSubmitted: lbody.detailsSubmitted ?? null,
              requirementsCurrentlyDue: lbody.requirements?.currentlyDue ?? [],
              requirementsPastDue: lbody.requirements?.pastDue ?? [],
              requirementsPending: lbody.requirements?.pendingVerification ?? [],
              disabledReason: lbody.requirements?.disabledReason ?? null,
            };
          }
        } catch {
          /* non-fatal — fall back to cached fields only */
        }
      }

      setStatus({
        connected: !!loc.stripeAccountId && (live.chargesEnabled === true || loc.stripeOnboardingComplete),
        accountId: loc.stripeAccountId,
        onboardingComplete: loc.stripeOnboardingComplete,
        ...live,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to load Stripe status';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [currentLocationId]);

  useEffect(() => { void load(); }, [load]);

  const handleConnect = async () => {
    if (!currentLocationId) return;
    setBusy(true);
    try {
      const r = await fetch('/api/settings/stripe/connect', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locationId: currentLocationId }),
      });
      const body = await r.json() as { url?: string; error?: string };
      if (body.url) {
        openOAuthPopup(body.url, () => { void load(); });
      } else {
        alert(body.error ?? 'Stripe connect failed');
      }
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Connect failed');
    } finally {
      setBusy(false);
    }
  };

  const handleRefresh = async () => {
    setBusy(true);
    try { await load(); } finally { setBusy(false); }
  };

  const handleDisconnect = async () => {
    if (!currentLocationId) return;
    setBusy(true);
    setConfirmDisconnect(false);
    try {
      const r = await fetch('/api/settings/stripe/disconnect', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locationId: currentLocationId, confirm: true }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({} as { error?: string }));
        throw new Error(body.error ?? `Disconnect failed (HTTP ${r.status})`);
      }
      await load();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Disconnect failed');
    } finally {
      setBusy(false);
    }
  };

  if (!currentLocationId) {
    return (
      <div style={stl.card}>
        <div style={{ color: '#64748B', fontSize: '14px' }}>Select a location to manage Stripe Payments.</div>
      </div>
    );
  }

  if (loading) {
    return <div style={{ color: '#94A3B8', fontSize: '14px', padding: '24px' }}>Loading Stripe status…</div>;
  }

  if (error) {
    return (
      <div style={{ ...stl.card, border: '1px solid #FECACA', background: '#FEF2F2' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#B91C1C', fontSize: '14px' }}>
          <AlertTriangle size={16} /> {error}
        </div>
      </div>
    );
  }

  const connected = status?.connected ?? false;
  const onboardingIncomplete = !!status?.accountId && !connected;

  return (
    <>
      <div style={stl.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <div style={{ fontSize: '16px', fontWeight: 700, color: '#0A2342', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <CreditCard size={18} style={{ color: '#635BFF' }} /> Stripe Payments
            </div>
            <div style={stl.meta}>
              {connected ? (
                <>
                  <span style={stl.pill(true)}><Check size={12} /> Connected</span>
                  {status?.accountId && <span style={{ marginLeft: '8px', color: '#94A3B8' }}>****{status.accountId.slice(-4)}</span>}
                </>
              ) : onboardingIncomplete ? (
                <span style={stl.warningPill}><AlertTriangle size={12} /> Onboarding incomplete</span>
              ) : (
                <span style={stl.pill(false)}>Not connected</span>
              )}
            </div>
            <div style={{ fontSize: '13px', color: '#64748B', marginTop: '8px' }}>
              Each location collects payments into its own Stripe account so funds, fees, and 1099-Ks stay separated by property.
            </div>
          </div>
          <div style={stl.actions}>
            {connected || onboardingIncomplete ? (
              <>
                <button style={stl.btn} onClick={handleRefresh} disabled={busy}>
                  <RefreshCw size={14} /> {busy ? 'Refreshing…' : 'Refresh status'}
                </button>
                {onboardingIncomplete && (
                  <button style={{ ...stl.btn, ...stl.primary }} onClick={handleConnect} disabled={busy}>
                    <Plug size={14} /> Continue onboarding
                  </button>
                )}
                <button
                  style={{ ...stl.btn, ...stl.danger }}
                  onClick={() => setConfirmDisconnect(true)}
                  disabled={busy}
                >
                  <Unplug size={14} /> Disconnect
                </button>
              </>
            ) : (
              <button style={{ ...stl.btn, ...stl.primary }} onClick={handleConnect} disabled={busy}>
                <Plug size={14} /> {busy ? 'Connecting…' : 'Connect Stripe'}
              </button>
            )}
          </div>
        </div>

        {(status?.requirementsCurrentlyDue.length ?? 0) + (status?.requirementsPastDue.length ?? 0) + (status?.requirementsPending.length ?? 0) > 0 && (
          <div style={stl.reqBox}>
            {status!.requirementsPastDue.length > 0 && (
              <div style={{ marginBottom: '10px' }}>
                <div style={stl.reqHeader}>Past due — Stripe has disabled this account</div>
                <ul style={stl.reqList}>
                  {status!.requirementsPastDue.map((c) => <li key={c}><code style={{ fontFamily: 'monospace' }}>{c}</code></li>)}
                </ul>
              </div>
            )}
            {status!.requirementsCurrentlyDue.length > 0 && (
              <div style={{ marginBottom: '10px' }}>
                <div style={stl.reqHeader}>Currently due</div>
                <ul style={stl.reqList}>
                  {status!.requirementsCurrentlyDue.map((c) => <li key={c}><code style={{ fontFamily: 'monospace' }}>{c}</code></li>)}
                </ul>
              </div>
            )}
            {status!.requirementsPending.length > 0 && (
              <div>
                <div style={stl.reqHeader}>Pending Stripe verification</div>
                <ul style={stl.reqList}>
                  {status!.requirementsPending.map((c) => <li key={c}><code style={{ fontFamily: 'monospace' }}>{c}</code></li>)}
                </ul>
              </div>
            )}
            {status!.disabledReason && (
              <div style={{ marginTop: '8px', fontSize: '12px' }}>
                <strong>Disabled reason:</strong> <code style={{ fontFamily: 'monospace' }}>{status!.disabledReason}</code>
              </div>
            )}
          </div>
        )}

        {!connected && !onboardingIncomplete && (
          <div style={{ marginTop: '16px', background: '#F0F9FF', border: '1px solid #BAE6FD', borderRadius: '6px', padding: '12px 16px', fontSize: '13px', color: '#075985', lineHeight: 1.5 }}>
            Connect this location to a Stripe account to start accepting card payments at the POS, online checkout, and recurring billing for slip rentals.
          </div>
        )}

        <div style={stl.webhookNote}>
          <CreditCard size={14} style={{ color: '#64748B', marginTop: '2px', flexShrink: 0 }} />
          <div style={{ fontSize: '12px', color: '#475569', lineHeight: 1.5 }}>
            <strong style={{ color: '#0A2342' }}>Webhooks: managed centrally.</strong>{' '}
            Stripe Connect delivers events for every connected location to one Helm endpoint, registered once at the platform level. No webhook setup is needed inside this location's Stripe Express dashboard.
          </div>
        </div>
      </div>

      {confirmDisconnect && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={() => setConfirmDisconnect(false)}>
          <div style={{ background: '#FFFFFF', borderRadius: '10px', width: '440px', maxWidth: '90vw', boxShadow: '0 25px 60px rgba(0,0,0,0.18)', padding: '24px' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: '18px', fontWeight: 700, color: '#0A2342', marginBottom: '12px' }}>
              Disconnect Stripe?
            </div>
            <div style={{ fontSize: '14px', color: '#64748B', marginBottom: '20px', lineHeight: 1.5 }}>
              Payments at this location will stop working until reconnected. Existing payment history is preserved.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                style={{ background: '#FFFFFF', color: '#475569', border: '1px solid #CBD5E1', borderRadius: '6px', padding: '10px 20px', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}
                onClick={() => setConfirmDisconnect(false)}
              >
                Cancel
              </button>
              <button
                style={{ background: '#B91C1C', color: '#FFFFFF', border: 'none', borderRadius: '6px', padding: '10px 20px', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}
                onClick={handleDisconnect}
                disabled={busy}
              >
                {busy ? 'Disconnecting…' : 'Yes, Disconnect'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
