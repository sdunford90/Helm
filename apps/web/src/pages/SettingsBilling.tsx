import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@clerk/clerk-react';
import { CheckCircle, AlertTriangle, CreditCard, ExternalLink, Loader2 } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { formatCents } from '../lib/format';
import SubNav, { SETTINGS_SUBNAV } from '../components/SubNav';

interface Tier {
  id: string;
  name: string;
  monthlyFeeCents: number;
  perLocationFeeCents: number;
  storageLimitGb: number;
  stripePriceId: string | null;
}

interface LocationSummary {
  id: string;
  name: string;
  active: boolean;
  saasTierId: string | null;
  subscriptionStatus: string | null;
  hasStripeCustomer: boolean;
  hasSubscription: boolean;
  gracePeriodStartedAt: string | null;
}

interface StatusResponse {
  locationId: string;
  locationName: string;
  saasTierId: string | null;
  subscriptionStatus: string | null;
  gracePeriodStartedAt: string | null;
  subscription: {
    id: string;
    status: string;
    currentPeriodEnd: number | null;
    cancelAtPeriodEnd: boolean;
  } | null;
}

const NAVY = '#0A2342';

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 32 },
  title: { fontSize: 36, fontWeight: 700, color: NAVY, letterSpacing: '-0.02em', margin: 0 },
  divider: { height: 4, background: 'linear-gradient(90deg, #00D4FF, transparent)', border: 'none', marginTop: 12, marginBottom: 32, borderRadius: 2 },
  banner: { padding: 16, borderRadius: 8, marginBottom: 24, display: 'flex', alignItems: 'center', gap: 12, fontSize: 14, fontWeight: 500 },
  bannerSuccess: { background: '#E8F5E9', color: '#1B5E20' },
  bannerWarn: { background: '#FFF3CD', color: '#856404' },
  bannerInfo: { background: '#D6E8F4', color: '#0A2342' },
  bannerError: { background: '#FDE0E0', color: '#922B21' },
  card: { background: '#FFFFFF', border: '1px solid #CCCCCC', borderRadius: 8, padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: 24 },
  cardLabel: { fontSize: 12, fontWeight: 600, color: '#2E4A6B', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 },
  cardValue: { fontSize: 22, fontWeight: 700, color: NAVY, lineHeight: 1.2 },
  cardRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', fontSize: 14, color: NAVY },
  primaryBtn: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 20px', fontSize: 14, fontWeight: 600, color: '#fff', backgroundColor: NAVY, border: 'none', borderRadius: 6, cursor: 'pointer' },
  secondaryBtn: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 20px', fontSize: 14, fontWeight: 600, color: NAVY, backgroundColor: '#fff', border: `1px solid ${NAVY}`, borderRadius: 6, cursor: 'pointer' },
  tierGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 },
  tierCard: { background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' },
  tierName: { fontSize: 20, fontWeight: 700, color: NAVY, margin: '0 0 8px' },
  tierPrice: { fontSize: 28, fontWeight: 700, color: NAVY, fontFamily: 'Inter, system-ui, sans-serif', fontVariantNumeric: 'tabular-nums' },
  tierPriceUnit: { fontSize: 13, color: '#64748B', fontWeight: 400 },
  tierFeature: { fontSize: 13, color: '#2E4A6B', padding: '6px 0' },
  locPicker: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 24, flexWrap: 'wrap' },
  locPickerLabel: { fontSize: 13, color: '#2E4A6B', fontWeight: 600 },
  locSelect: { padding: '8px 12px', border: '1px solid #CCC', borderRadius: 6, fontSize: 14, color: NAVY, background: '#fff', minWidth: 240 },
};

export default function SettingsBilling() {
  const [params, setParams] = useSearchParams();
  const justCompleted = params.get('success') === 'true';
  const canceled = params.get('canceled') === 'true';
  const initialLocationId = params.get('locationId');

  const { getToken } = useAuth();
  const locations = useApi<{ locations: LocationSummary[] }>(
    'get',
    '/api/saas-billing/locations',
    { immediate: true },
  );
  const tiers = useApi<{ tiers: Tier[] }>('get', '/api/saas-billing/tiers', { immediate: true });

  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(initialLocationId);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [subscribing, setSubscribing] = useState<string | null>(null);
  const [managing, setManaging] = useState(false);

  const fetchStatus = useCallback(
    async (locationId: string) => {
      setStatusLoading(true);
      setStatusError(null);
      try {
        const token = await getToken();
        const res = await fetch(
          `/api/saas-billing/locations/${locationId}/status`,
          { headers: token ? { Authorization: `Bearer ${token}` } : {} },
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `Failed to load status (${res.status})`);
        }
        const data = (await res.json()) as StatusResponse;
        setStatus(data);
      } catch (err) {
        setStatusError(err instanceof Error ? err.message : 'Failed to load subscription');
        setStatus(null);
      } finally {
        setStatusLoading(false);
      }
    },
    [getToken],
  );

  // Auto-select the first location once we have data, unless one is already pinned via URL.
  useEffect(() => {
    if (selectedLocationId) return;
    const list = locations.data?.locations ?? [];
    if (list.length > 0) {
      setSelectedLocationId(list[0].id);
    }
  }, [locations.data, selectedLocationId]);

  // Whenever the selected location changes, refresh its status.
  useEffect(() => {
    if (!selectedLocationId) return;
    void fetchStatus(selectedLocationId);
  }, [selectedLocationId, fetchStatus]);

  // Persist the selected location in the URL so deep-links work.
  useEffect(() => {
    if (!selectedLocationId) return;
    if (params.get('locationId') !== selectedLocationId) {
      const next = new URLSearchParams(params);
      next.set('locationId', selectedLocationId);
      setParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLocationId]);

  // After Stripe redirects back with success=true, give the webhook a beat
  // and re-pull the per-location status.
  useEffect(() => {
    if (justCompleted && selectedLocationId) {
      const t = setTimeout(() => fetchStatus(selectedLocationId), 1500);
      return () => clearTimeout(t);
    }
  }, [justCompleted, selectedLocationId, fetchStatus]);

  const locationList = useMemo(
    () => locations.data?.locations ?? [],
    [locations.data],
  );
  const selectedLocation = useMemo(
    () => locationList.find((l) => l.id === selectedLocationId) ?? null,
    [locationList, selectedLocationId],
  );

  const handleSubscribe = async (tier: Tier) => {
    if (!selectedLocationId) {
      setActionError('Pick a location first.');
      return;
    }
    if (!tier.stripePriceId) {
      setActionError('This tier has no Stripe price configured — ask the operator to create one.');
      return;
    }
    setActionError(null);
    setSubscribing(tier.id);
    try {
      const token = await getToken();
      const res = await fetch(
        `/api/saas-billing/locations/${selectedLocationId}/checkout`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ tierId: tier.id }),
        },
      );
      const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !body.url) {
        throw new Error(body.error ?? 'Could not start checkout');
      }
      window.location.href = body.url;
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not start checkout');
      setSubscribing(null);
    }
  };

  const handleManage = async () => {
    if (!selectedLocationId) {
      setActionError('Pick a location first.');
      return;
    }
    setActionError(null);
    setManaging(true);
    try {
      const token = await getToken();
      const res = await fetch(
        `/api/saas-billing/locations/${selectedLocationId}/portal`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({}),
        },
      );
      const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !body.url) {
        throw new Error(body.error ?? 'Could not open billing portal');
      }
      window.location.href = body.url;
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not open billing portal');
      setManaging(false);
    }
  };

  const sub = status?.subscription;
  const activeTier = tiers.data?.tiers.find((t) => t.id === status?.saasTierId);
  const periodEnd = sub?.currentPeriodEnd
    ? new Date(sub.currentPeriodEnd * 1000).toLocaleDateString()
    : null;

  return (
    <div style={styles.page}>
      <h1 style={styles.title}>Settings</h1>
      <hr style={styles.divider} />

      <SubNav items={SETTINGS_SUBNAV} />

      {justCompleted && (
        <div style={{ ...styles.banner, ...styles.bannerSuccess }}>
          <CheckCircle size={20} />
          Subscription activated for {status?.locationName ?? 'this location'}. Welcome aboard.
        </div>
      )}
      {canceled && (
        <div style={{ ...styles.banner, ...styles.bannerInfo }}>
          <AlertTriangle size={20} />
          Checkout canceled — nothing was charged.
        </div>
      )}
      {status?.gracePeriodStartedAt && (
        <div style={{ ...styles.banner, ...styles.bannerWarn }}>
          <AlertTriangle size={20} />
          The most recent payment for {status.locationName} failed. Stripe will retry automatically, but please update your payment method to avoid interruption.
        </div>
      )}
      {(actionError || statusError) && (
        <div style={{ ...styles.banner, ...styles.bannerError }}>
          <AlertTriangle size={20} />
          {actionError ?? statusError}
        </div>
      )}

      {/* Location picker. Each marina (= location) has its own subscription. */}
      {locationList.length > 1 && (
        <div style={styles.locPicker}>
          <span style={styles.locPickerLabel}>Location:</span>
          <select
            style={styles.locSelect}
            value={selectedLocationId ?? ''}
            onChange={(e) => setSelectedLocationId(e.target.value)}
          >
            {locationList.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
                {l.hasSubscription
                  ? ` — ${l.subscriptionStatus ?? 'active'}`
                  : ' — not subscribed'}
              </option>
            ))}
          </select>
        </div>
      )}

      {(locations.loading || (selectedLocationId && statusLoading)) && (
        <div style={{ padding: 40, textAlign: 'center', color: '#64748B' }}>
          <Loader2 size={24} style={{ animation: 'spin 1s linear infinite' }} />
        </div>
      )}

      {!locations.loading && locationList.length === 0 && (
        <div style={styles.card}>
          <div style={styles.cardLabel}>No locations</div>
          <div style={{ fontSize: 14, color: '#2E4A6B', marginTop: 8 }}>
            You don't have access to any locations yet. Ask your platform admin to add one.
          </div>
        </div>
      )}

      {!statusLoading && selectedLocation && sub && activeTier && (
        <div style={styles.card}>
          <div style={styles.cardLabel}>Current plan — {selectedLocation.name}</div>
          <div style={styles.cardValue}>{activeTier.name}</div>
          <div style={{ marginTop: 16 }}>
            <div style={styles.cardRow}>
              <span>Status</span>
              <span style={{ fontWeight: 600, textTransform: 'capitalize' }}>{sub.status}</span>
            </div>
            <div style={styles.cardRow}>
              <span>{sub.cancelAtPeriodEnd ? 'Access ends' : 'Next billing date'}</span>
              <span style={{ fontWeight: 600 }}>{periodEnd ?? '—'}</span>
            </div>
            <div style={styles.cardRow}>
              <span>Monthly fee</span>
              <span style={{ fontWeight: 600 }}>{formatCents(activeTier.monthlyFeeCents)}</span>
            </div>
          </div>
          <div style={{ marginTop: 20, display: 'flex', gap: 12 }}>
            <button style={styles.primaryBtn} onClick={handleManage} disabled={managing}>
              <CreditCard size={16} /> {managing ? 'Opening…' : 'Manage billing'}
              <ExternalLink size={14} />
            </button>
          </div>
        </div>
      )}

      {!statusLoading && selectedLocation && !sub && (
        <>
          <div style={styles.card}>
            <div style={styles.cardLabel}>No active subscription — {selectedLocation.name}</div>
            <div style={{ fontSize: 14, color: '#2E4A6B', marginTop: 8 }}>
              Choose a plan below to start. You'll be redirected to Stripe to complete payment for this location.
            </div>
          </div>

          <h2 style={{ ...styles.title, fontSize: 22, marginBottom: 16 }}>Choose a plan</h2>
          {tiers.loading ? (
            <div style={{ color: '#64748B' }}>Loading plans…</div>
          ) : (
            <div style={styles.tierGrid}>
              {(tiers.data?.tiers ?? []).map((t) => (
                <div key={t.id} style={styles.tierCard}>
                  <h3 style={styles.tierName}>{t.name}</h3>
                  <div style={styles.tierPrice}>
                    {formatCents(t.monthlyFeeCents)}
                    <span style={styles.tierPriceUnit}> / month</span>
                  </div>
                  <div style={{ marginTop: 16 }}>
                    <div style={styles.tierFeature}>Per-location subscription</div>
                    <div style={styles.tierFeature}>{t.storageLimitGb} GB document storage</div>
                  </div>
                  <button
                    style={{ ...styles.primaryBtn, width: '100%', marginTop: 20, justifyContent: 'center' }}
                    onClick={() => handleSubscribe(t)}
                    disabled={subscribing !== null || !t.stripePriceId}
                  >
                    {subscribing === t.id ? 'Redirecting…' : t.stripePriceId ? 'Subscribe' : 'Not configured'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
