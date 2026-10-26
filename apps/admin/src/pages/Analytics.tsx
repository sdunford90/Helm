import React from 'react';
import { formatCents, useAdminResource } from '../lib/api';
import { ErrorState, LoadingState } from '../components/StateViews';

// Everything on this page comes from the admin API. Time series (GMV trend,
// tenant growth) and feature adoption have no endpoint yet and say so.

interface AnalyticsOverview {
  totalSlips: number;
  totalCustomers: number;
  totalInvoices: number;
  totalTransactions: number;
  totalGmvCents: number;
  breakdown: {
    slipPaymentsCents: number;
    posTransactionsCents: number;
    transientBookingsCents: number;
    rampTicketsCents: number;
  };
  tenantCount: number;
}

interface Tier {
  id: string;
  name: string;
  tenantCount: number;
}

interface TenantHealthRow {
  id: string;
  name: string;
  status: string;
  saasTier: string | null;
  healthScore: number;
  atRisk: boolean;
  usage: { users: number; slips: number; customers: number; recentPayments: number; recentInvoices: number };
}

interface TenantHealthResponse {
  total: number;
  atRiskCount: number;
  tenants: TenantHealthRow[];
}

const TIER_COLORS = ['#2196F3', '#FF9800', '#9C27B0', '#4CAF50', '#00D4FF'];

const card: React.CSSProperties = {
  background: '#0D1B2A',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.06)',
  padding: 20,
};

const cardTitle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: 'rgba(255,255,255,0.5)',
  textTransform: 'uppercase',
  letterSpacing: 1,
  marginBottom: 16,
};

const muted: React.CSSProperties = { fontSize: 13, color: 'rgba(255,255,255,0.5)', lineHeight: 1.6 };

const th: React.CSSProperties = {
  textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.4)',
  textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid rgba(255,255,255,0.06)',
};
const td: React.CSSProperties = { padding: '8px 10px', fontSize: 12, color: 'rgba(255,255,255,0.7)', borderBottom: '1px solid rgba(255,255,255,0.04)' };

const Analytics: React.FC = () => {
  const overview = useAdminResource<AnalyticsOverview>('/analytics/overview');
  const tiers = useAdminResource<Tier[]>('/billing/tiers');
  const health = useAdminResource<TenantHealthResponse>('/analytics/tenants');

  if (overview.loading) return <LoadingState label="Loading platform analytics…" />;
  if (overview.error || !overview.data) {
    return <ErrorState title="Could not load platform analytics" message={overview.error ?? 'No data returned.'} onRetry={overview.refetch} />;
  }
  const o = overview.data;
  const breakdown = [
    { label: 'Slip payments', cents: o.breakdown.slipPaymentsCents, color: '#00D4FF' },
    { label: 'POS', cents: o.breakdown.posTransactionsCents, color: '#4CAF50' },
    { label: 'Transient bookings', cents: o.breakdown.transientBookingsCents, color: '#FF9800' },
    { label: 'Ramp tickets', cents: o.breakdown.rampTicketsCents, color: '#9C27B0' },
  ];
  const maxBreakdown = Math.max(1, ...breakdown.map((b) => b.cents));
  const tierTotal = (tiers.data ?? []).reduce((sum, t) => sum + t.tenantCount, 0);

  return (
    <div>
      {/* GMV */}
      <div style={{ ...card, marginBottom: 20 }}>
        <div style={cardTitle}>Platform GMV (all time): {formatCents(o.totalGmvCents)}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {breakdown.map((b) => (
            <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 150, fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>{b.label}</div>
              <div style={{ flex: 1, height: 10, background: 'rgba(255,255,255,0.04)', borderRadius: 5 }}>
                <div style={{ width: `${(b.cents / maxBreakdown) * 100}%`, height: '100%', background: b.color, borderRadius: 5 }} />
              </div>
              <div style={{ width: 110, textAlign: 'right', fontSize: 12, fontWeight: 600, color: '#FFF' }}>{formatCents(b.cents)}</div>
            </div>
          ))}
        </div>
        <div style={{ ...muted, marginTop: 14, fontSize: 12 }}>
          {o.totalTransactions.toLocaleString('en-US')} transactions · {o.totalSlips.toLocaleString('en-US')} slips · {o.totalCustomers.toLocaleString('en-US')} customers · {o.totalInvoices.toLocaleString('en-US')} invoices across {o.tenantCount} tenants.
          GMV over time is not available yet (the API has no monthly history).
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
        {/* Tier Distribution */}
        <div style={card}>
          <div style={cardTitle}>Tier Distribution</div>
          {tiers.loading && <div style={muted}>Loading…</div>}
          {tiers.error && <div style={{ ...muted, color: '#F44336' }}>Could not load tiers: {tiers.error}</div>}
          {tiers.data && tiers.data.length === 0 && <div style={muted}>No SaaS tiers configured.</div>}
          {tiers.data && tiers.data.length > 0 && (
            <>
              <div style={{ display: 'flex', height: 14, borderRadius: 7, overflow: 'hidden', marginBottom: 16, background: 'rgba(255,255,255,0.04)' }}>
                {tiers.data.map((t, i) => (
                  <div key={t.id} style={{ width: `${tierTotal ? (t.tenantCount / tierTotal) * 100 : 0}%`, background: TIER_COLORS[i % TIER_COLORS.length] }} />
                ))}
              </div>
              {tiers.data.map((t, i) => (
                <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>
                    <span style={{ width: 10, height: 10, borderRadius: 2, background: TIER_COLORS[i % TIER_COLORS.length] }} />
                    {t.name}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#FFF' }}>
                    {t.tenantCount} {tierTotal ? `(${Math.round((t.tenantCount / tierTotal) * 100)}%)` : ''}
                  </span>
                </div>
              ))}
            </>
          )}
        </div>

        {/* Growth / feature adoption */}
        <div style={card}>
          <div style={cardTitle}>Tenant Growth &amp; Feature Adoption</div>
          <div style={muted}>
            Not available yet: the API does not record tenant sign-up/churn history or feature usage, so there is
            nothing to chart. New tenants in the last 30 days are shown on the Dashboard.
          </div>
        </div>
      </div>

      {/* Tenant health */}
      <div style={card}>
        <div style={cardTitle}>
          Tenant Health{health.data ? ` · ${health.data.atRiskCount} at risk of ${health.data.total}` : ''}
        </div>
        {health.loading && <div style={muted}>Loading…</div>}
        {health.error && <div style={{ ...muted, color: '#F44336' }}>Could not load tenant health: {health.error}</div>}
        {health.data && health.data.tenants.length === 0 && <div style={muted}>No tenants yet.</div>}
        {health.data && health.data.tenants.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Tenant', 'Tier', 'Health', 'Users', 'Slips', 'Customers', 'Payments (30d)', 'Invoices (30d)'].map((h) => (
                  <th key={h} style={th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {health.data.tenants.map((t) => (
                <tr key={t.id}>
                  <td style={{ ...td, color: '#FFF', fontWeight: 500 }}>{t.name}</td>
                  <td style={td}>{t.saasTier ?? '—'}</td>
                  <td style={{ ...td, fontWeight: 600, color: t.atRisk ? '#F44336' : t.healthScore >= 70 ? '#4CAF50' : '#FF9800' }}>{t.healthScore}</td>
                  <td style={td}>{t.usage.users}</td>
                  <td style={td}>{t.usage.slips}</td>
                  <td style={td}>{t.usage.customers}</td>
                  <td style={td}>{t.usage.recentPayments}</td>
                  <td style={td}>{t.usage.recentInvoices}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default Analytics;
