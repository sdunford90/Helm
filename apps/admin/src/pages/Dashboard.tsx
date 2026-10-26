import React from 'react';
import { formatCents, useAdminResource } from '../lib/api';
import { ErrorState, LoadingState } from '../components/StateViews';

// All figures come from the admin API. There is no history endpoint yet,
// so the old "MRR trend" and "recent activity" panels are shown as not available.

interface BillingOverview {
  totalMrrCents: number;
  totalTenants: number;
  activeTenants: number;
  gracePeriodTenants: number;
  lockedTenants: number;
  newTenantsLast30Days: number;
}

interface AnalyticsOverview {
  totalSlips: number;
  totalGmvCents: number;
  platformFeeRevenueMrrCents: number;
  tenantCount: number;
}

interface TenantHealthRow {
  id: string;
  name: string;
  status: string;
  saasTier: string | null;
  mrrCents: number;
  healthScore: number;
  atRisk: boolean;
  usage: { recentPayments: number; recentInvoices: number };
}

interface TenantHealthResponse {
  total: number;
  atRiskCount: number;
  tenants: TenantHealthRow[];
}

function atRiskReason(t: TenantHealthRow): string {
  if (t.status === 'GRACE_PERIOD') return 'In grace period';
  if (t.usage.recentPayments === 0 && t.usage.recentInvoices === 0) return 'No payments or invoices in the last 30 days';
  return `Health score ${t.healthScore}/100`;
}

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

const Dashboard: React.FC = () => {
  const billing = useAdminResource<BillingOverview>('/billing/overview');
  const analytics = useAdminResource<AnalyticsOverview>('/analytics/overview');
  const health = useAdminResource<TenantHealthResponse>('/analytics/tenants');

  if (billing.loading || analytics.loading) return <LoadingState label="Loading platform overview…" />;
  if (billing.error || !billing.data) {
    return <ErrorState title="Could not load billing overview" message={billing.error ?? 'No data returned.'} onRetry={billing.refetch} />;
  }
  if (analytics.error || !analytics.data) {
    return <ErrorState title="Could not load platform analytics" message={analytics.error ?? 'No data returned.'} onRetry={analytics.refetch} />;
  }
  const b = billing.data;
  const a = analytics.data;

  const TENANT_HEALTH = [
    { status: 'Active', count: b.activeTenants, color: '#4CAF50' },
    { status: 'Grace Period', count: b.gracePeriodTenants, color: '#FF9800' },
    { status: 'Locked', count: b.lockedTenants, color: '#F44336' },
  ];
  const totalHealth = TENANT_HEALTH.reduce((acc, seg) => acc + seg.count, 0);
  const atRisk = (health.data?.tenants ?? []).filter((t) => t.atRisk);

  const KPIS = [
    { label: 'Total Tenants', value: String(b.totalTenants), sub: `${b.activeTenants} active / ${b.gracePeriodTenants} grace / ${b.lockedTenants} locked`, color: '#00D4FF' },
    { label: 'Total MRR', value: formatCents(b.totalMrrCents), sub: 'Subscription fees from active tenants', color: '#4CAF50' },
    { label: 'Platform GMV (all time)', value: formatCents(a.totalGmvCents), sub: 'Payments, POS, transient and ramp', color: '#2196F3' },
    { label: 'New Tenants (30 days)', value: String(b.newTenantsLast30Days), sub: 'Created in the last 30 days', color: '#FF9800' },
    { label: 'Total Slips Managed', value: a.totalSlips.toLocaleString('en-US'), sub: `Across ${a.tenantCount} marinas`, color: '#9C27B0' },
  ];

  return (
    <div>
      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
        {KPIS.map((kpi) => (
          <div key={kpi.label} style={card}>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>{kpi.label}</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: kpi.color, marginBottom: 4 }}>{kpi.value}</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>{kpi.sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
        {/* Tenant Health */}
        <div style={card}>
          <div style={cardTitle}>Tenant Health</div>
          <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
            {/* Pie-like visual */}
            <div style={{ position: 'relative', width: 120, height: 120 }}>
              <svg viewBox="0 0 36 36" style={{ width: 120, height: 120, transform: 'rotate(-90deg)' }}>
                {(() => {
                  let offset = 0;
                  return TENANT_HEALTH.map((seg) => {
                    const pct = totalHealth > 0 ? (seg.count / totalHealth) * 100 : 0;
                    const el = (
                      <circle
                        key={seg.status}
                        cx="18" cy="18" r="15.9"
                        fill="none"
                        stroke={seg.color}
                        strokeWidth="3.5"
                        strokeDasharray={`${pct} ${100 - pct}`}
                        strokeDashoffset={`${-offset}`}
                      />
                    );
                    offset += pct;
                    return el;
                  });
                })()}
              </svg>
              <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center' }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#FFF' }}>{totalHealth}</div>
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)' }}>TOTAL</div>
              </div>
            </div>
            <div style={{ flex: 1 }}>
              {TENANT_HEALTH.map((seg) => (
                <div key={seg.status} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 10, height: 10, borderRadius: 2, background: seg.color }} />
                    <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>{seg.status}</span>
                  </div>
                  <span style={{ fontSize: 15, fontWeight: 600, color: '#FFF' }}>{seg.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* MRR Trend */}
        <div style={card}>
          <div style={cardTitle}>MRR Trend</div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', lineHeight: 1.6 }}>
            Not available yet: the API does not keep MRR history, so there is no trend to chart.
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* Recent Activity */}
        <div style={card}>
          <div style={cardTitle}>Recent Activity</div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', lineHeight: 1.6 }}>
            Not available yet: there is no platform activity feed in the API.
          </div>
        </div>

        {/* At-Risk Tenants */}
        <div style={card}>
          <div style={cardTitle}>At-Risk Tenants</div>
          {health.loading && <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>Loading…</div>}
          {health.error && <div style={{ fontSize: 13, color: '#F44336' }}>Could not load tenant health: {health.error}</div>}
          {!health.loading && !health.error && atRisk.length === 0 && (
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>No tenants are flagged as at risk.</div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {atRisk.map((t) => (
              <div key={t.id} style={{ background: 'rgba(244,67,54,0.06)', border: '1px solid rgba(244,67,54,0.15)', borderRadius: 6, padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: '#FFF' }}>{t.name}</span>
                  <span style={{ fontSize: 12, color: '#FF9800' }}>{formatCents(t.mrrCents)}/mo — {t.saasTier ?? 'No tier'}</span>
                </div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>{atRiskReason(t)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
