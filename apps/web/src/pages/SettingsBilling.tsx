import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle, AlertTriangle, CreditCard, ExternalLink, Loader2 } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { formatCents } from '../lib/format';

interface Tier {
  id: string;
  name: string;
  monthlyFeeCents: number;
  perLocationFeeCents: number;
  storageLimitGb: number;
  stripePriceId: string | null;
}

interface StatusResponse {
  tenantStatus: string;
  saasTierId: string | null;
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
  card: { background: '#FFFFFF', border: '1px solid #CCCCCC', borderRadius: 8, padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: 24 },
  cardLabel: { fontSize: 12, fontWeight: 600, color: '#2E4A6B', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 },
  cardValue: { fontSize: 22, fontWeight: 700, color: NAVY, lineHeight: 1.2 },
  cardRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', fontSize: 14, color: NAVY },
  primaryBtn: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 20px', fontSize: 14, fontWeight: 600, color: '#fff', backgroundColor: NAVY, border: 'none', borderRadius: 6, cursor: 'pointer' },
  secondaryBtn: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 20px', fontSize: 14, fontWeight: 600, color: NAVY, backgroundColor: '#fff', border: `1px solid ${NAVY}`, borderRadius: 6, cursor: 'pointer' },
  tierGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 },
  tierCard: { background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' },
  tierName: { fontSize: 20, fontWeight: 700, color: NAVY, margin: '0 0 8px' },
  tierPrice: { fontSize: 28, fontWeight: 700, color: NAVY, fontFamily: '"JetBrains Mono", monospace' },
  tierPriceUnit: { fontSize: 13, color: '#64748B', fontWeight: 400 },
  tierFeature: { fontSize: 13, color: '#2E4A6B', padding: '6px 0' },
};

export default function SettingsBilling() {
  const [params] = useSearchParams();
  const justCompleted = params.get('success') === 'true';
  const canceled = params.get('canceled') === 'true';

  const status = useApi<StatusResponse>('get', '/api/saas-billing/status', { immediate: true });
  const tiers = useApi<{ tiers: Tier[] }>('get', '/api/saas-billing/tiers', { immediate: true });
  const checkout = useApi<{ url: string }>('post', '/api/saas-billing/checkout');
  const portal = useApi<{ url: string }>('post', '/api/saas-billing/portal');

  const [subscribing, setSubscribing] = useState<string | null>(null);

  useEffect(() => {
    if (justCompleted) {
      // Give the webhook a moment to persist stripeSubscriptionId, then refresh.
      const t = setTimeout(() => status.execute(), 1500);
      return () => clearTimeout(t);
    }
  }, [justCompleted]);

  const handleSubscribe = async (tier: Tier) => {
    if (!tier.stripePriceId) {
      alert('This tier has no Stripe price configured — ask the operator to create one.');
      return;
    }
    setSubscribing(tier.id);
    const result = await checkout.execute({ tierId: tier.id });
    if (result?.url) {
      window.location.href = result.url;
    } else {
      alert(checkout.error ?? 'Could not start checkout');
      setSubscribing(null);
    }
  };

  const handleManage = async () => {
    const result = await portal.execute({});
    if (result?.url) {
      window.location.href = result.url;
    } else {
      alert(portal.error ?? 'Could not open billing portal');
    }
  };

  const sub = status.data?.subscription;
  const activeTier = tiers.data?.tiers.find((t) => t.id === status.data?.saasTierId);
  const periodEnd = sub?.currentPeriodEnd
    ? new Date(sub.currentPeriodEnd * 1000).toLocaleDateString()
    : null;

  return (
    <div style={styles.page}>
      <h1 style={styles.title}>Billing</h1>
      <hr style={styles.divider} />

      {justCompleted && (
        <div style={{ ...styles.banner, ...styles.bannerSuccess }}>
          <CheckCircle size={20} />
          Subscription activated. Welcome aboard.
        </div>
      )}
      {canceled && (
        <div style={{ ...styles.banner, ...styles.bannerInfo }}>
          <AlertTriangle size={20} />
          Checkout canceled — nothing was charged.
        </div>
      )}
      {status.data?.gracePeriodStartedAt && (
        <div style={{ ...styles.banner, ...styles.bannerWarn }}>
          <AlertTriangle size={20} />
          Your most recent subscription payment failed. Stripe will retry automatically, but please update your payment method to avoid interruption.
        </div>
      )}

      {status.loading && (
        <div style={{ padding: 40, textAlign: 'center', color: '#64748B' }}>
          <Loader2 size={24} style={{ animation: 'spin 1s linear infinite' }} />
        </div>
      )}

      {!status.loading && sub && activeTier && (
        <div style={styles.card}>
          <div style={styles.cardLabel}>Current plan</div>
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
            <button style={styles.primaryBtn} onClick={handleManage} disabled={portal.loading}>
              <CreditCard size={16} /> Manage billing
              <ExternalLink size={14} />
            </button>
          </div>
        </div>
      )}

      {!status.loading && !sub && (
        <>
          <div style={styles.card}>
            <div style={styles.cardLabel}>No active subscription</div>
            <div style={{ fontSize: 14, color: '#2E4A6B', marginTop: 8 }}>
              Choose a plan below to start. You'll be redirected to Stripe to complete payment.
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
                    <div style={styles.tierFeature}>
                      + {formatCents(t.perLocationFeeCents)} per additional location
                    </div>
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
