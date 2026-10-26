import React, { useState } from 'react';
import { formatCents, useAdminResource } from '../lib/api';
import { ErrorState, LoadingState, NotAvailable } from '../components/StateViews';

interface BillingOverview {
  totalMrrCents: number;
  totalArrCents: number;
  totalTenants: number;
  activeTenants: number;
  gracePeriodTenants: number;
  lockedTenants: number;
  churnRate: number;
  arpuCents: number;
}

interface Tier {
  id: string;
  name: string;
  monthlyFeeCents: number;
  perLocationFeeCents: number;
  achFeeRate: number;
  cardFeeRate: number;
  storageLimitGb: number;
  tenantCount: number;
}

const TIER_COLORS = ['#2196F3', '#FF9800', '#9C27B0', '#4CAF50', '#00D4FF'];

const card: React.CSSProperties = {
  background: '#0D1B2A',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.06)',
  padding: 20,
};

const tabBtn = (active: boolean): React.CSSProperties => ({
  padding: '10px 20px',
  fontSize: 13,
  fontWeight: active ? 600 : 400,
  color: active ? '#00D4FF' : 'rgba(255,255,255,0.5)',
  background: 'transparent',
  border: 'none',
  borderBottom: active ? '2px solid #00D4FF' : '2px solid transparent',
  cursor: 'pointer',
});

/** Fee rates come back as fractions (0.029) or percentages (2.9) depending on seed data; show both sanely. */
function formatRate(rate: number): string {
  const pct = rate < 1 ? rate * 100 : rate;
  return `${pct.toFixed(2).replace(/\.?0+$/, '')}%`;
}

const Billing: React.FC = () => {
  const [tab, setTab] = useState<'invoices' | 'tiers'>('invoices');
  const overview = useAdminResource<BillingOverview>('/billing/overview');
  const tiers = useAdminResource<Tier[]>(tab === 'tiers' ? '/billing/tiers' : null);

  const o = overview.data;
  const STATS = o
    ? [
        { label: 'Total MRR', value: formatCents(o.totalMrrCents), change: `${formatCents(o.totalArrCents)} ARR`, color: '#4CAF50' },
        { label: 'Active Tenants', value: String(o.activeTenants), change: `${o.totalTenants} total`, color: '#2196F3' },
        { label: 'Locked / Grace', value: `${o.lockedTenants} / ${o.gracePeriodTenants}`, change: `${(o.churnRate * 100).toFixed(1)}% locked`, color: '#FF9800' },
        { label: 'Avg Revenue / Tenant', value: formatCents(o.arpuCents), change: 'Active tenants only', color: '#9C27B0' },
      ]
    : [];

  return (
    <div>
      {/* Stats */}
      {overview.loading && <LoadingState label="Loading billing overview…" />}
      {overview.error && <ErrorState title="Could not load billing overview" message={overview.error} onRetry={overview.refetch} />}
      {o && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
          {STATS.map((s) => (
            <div key={s.label} style={card}>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>{s.label}</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>{s.change}</div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', marginBottom: 20, marginTop: o ? 0 : 24, display: 'flex' }}>
        <button onClick={() => setTab('invoices')} style={tabBtn(tab === 'invoices')}>Invoices</button>
        <button onClick={() => setTab('tiers')} style={tabBtn(tab === 'tiers')}>Tiers</button>
      </div>

      {/* Invoices Tab */}
      {tab === 'invoices' && (
        <NotAvailable
          title="SaaS invoicing is not available yet"
          message="The API keeps platform invoices in server memory only (there is no SaaS invoice table), so they would disappear on restart. Invoice history and monthly generation will appear here once invoices are stored."
        />
      )}

      {/* Tiers Tab */}
      {tab === 'tiers' && (
        <>
          {tiers.loading && <LoadingState label="Loading tiers…" />}
          {tiers.error && <ErrorState title="Could not load tiers" message={tiers.error} onRetry={tiers.refetch} />}
          {tiers.data && tiers.data.length === 0 && <NotAvailable title="No tiers configured" message="No SaaS pricing tiers exist yet." />}
          {tiers.data && tiers.data.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
              {tiers.data.map((tier, i) => {
                const color = TIER_COLORS[i % TIER_COLORS.length];
                const rows = [
                  `${formatCents(tier.perLocationFeeCents)} per extra location`,
                  `ACH fee ${formatRate(tier.achFeeRate)}`,
                  `Card fee ${formatRate(tier.cardFeeRate)}`,
                  `${tier.storageLimitGb} GB storage`,
                ];
                return (
                  <div key={tier.id} style={{ ...card, borderTop: `3px solid ${color}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                      <div>
                        <div style={{ fontSize: 18, fontWeight: 700, color: '#FFF' }}>{tier.name}</div>
                        <div style={{ fontSize: 22, fontWeight: 700, color, marginTop: 4 }}>{formatCents(tier.monthlyFeeCents)}/mo</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 28, fontWeight: 700, color: '#FFF' }}>{tier.tenantCount}</div>
                        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>tenants</div>
                      </div>
                    </div>
                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 16 }}>
                      {rows.map((f) => (
                        <div key={f} style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', padding: '4px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ color }}>+</span> {f}
                        </div>
                      ))}
                    </div>
                    <button
                      disabled
                      title="Coming soon: tier editing from this screen is not built yet."
                      style={{ width: '100%', marginTop: 16, background: 'transparent', border: `1px solid ${color}`, color, borderRadius: 6, padding: '8px', fontSize: 12, fontWeight: 600, cursor: 'not-allowed', opacity: 0.5 }}
                    >
                      Edit Tier (coming soon)
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default Billing;
