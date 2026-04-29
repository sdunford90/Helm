import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApiFetch } from '../lib/api';

interface AnalyticsTenant {
  id: string;
  name: string;
  subdomain: string;
  status: string;
  saasTier: string | null;
  mrrCents: number;
  healthScore: number;
  atRisk: boolean;
  usage: {
    users: number;
    slips: number;
    customers: number;
    recentPayments: number;
    recentInvoices: number;
  };
}

interface DashboardSummary {
  tenants: { total: number; byStatus: Record<string, number> };
  mrrCents: number;
  platformGmvMonthCents: number;
  platformFeeRevenueMonthCents: number;
  slipsManaged: number;
  openSupportTickets: number;
}

interface SupportTicketsResponse {
  items: Array<{ priority: string; status: string }>;
}

const STATUS_PALETTE: Record<string, { label: string; color: string }> = {
  ACTIVE: { label: 'Active', color: '#4CAF50' },
  TRIAL: { label: 'Trial', color: '#2196F3' },
  GRACE_PERIOD: { label: 'Grace Period', color: '#FF9800' },
  LOCKED: { label: 'Locked', color: '#F44336' },
};

const formatUsd = (cents: number) => {
  if (cents >= 100_000_00) {
    return `$${(cents / 100 / 1_000_000).toFixed(2)}M`;
  }
  if (cents >= 10_000_00) {
    return `$${(cents / 100 / 1_000).toFixed(1)}k`;
  }
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
};

// Build a human-friendly reason from the live analytics payload.
function reasonFor(t: AnalyticsTenant): string {
  if (t.status === 'GRACE_PERIOD') return 'Payment failed — grace period';
  if (t.status === 'LOCKED') return 'Account locked after grace period';
  if (t.usage.recentPayments === 0 && t.usage.recentInvoices === 0)
    return 'No payments or invoices in the last 30 days';
  if (t.healthScore < 40) return `Low health score (${t.healthScore})`;
  return 'Flagged for follow-up';
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
  const navigate = useNavigate();
  const apiFetch = useApiFetch();

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [highPriorityCount, setHighPriorityCount] = useState<number | null>(null);

  const [atRisk, setAtRisk] = useState<AnalyticsTenant[]>([]);
  const [atRiskLoading, setAtRiskLoading] = useState(true);

  useEffect(() => {
    let aborted = false;
    apiFetch<DashboardSummary>('/api/admin/dashboard/summary')
      .then((data) => { if (!aborted) setSummary(data); })
      .catch((err: Error) => { if (!aborted) setSummaryError(err.message); })
      .finally(() => { if (!aborted) setSummaryLoading(false); });
    return () => { aborted = true; };
  }, [apiFetch]);

  useEffect(() => {
    let aborted = false;
    apiFetch<SupportTicketsResponse>('/api/admin/support/tickets?limit=100')
      .then((data) => {
        if (aborted) return;
        const open = data.items.filter(
          (t) => t.status === 'open' || t.status === 'in_progress' || t.status === 'waiting_on_customer',
        );
        const high = open.filter((t) => t.priority === 'high' || t.priority === 'urgent').length;
        setHighPriorityCount(high);
      })
      .catch(() => { if (!aborted) setHighPriorityCount(null); });
    return () => { aborted = true; };
  }, [apiFetch]);

  useEffect(() => {
    let aborted = false;
    apiFetch<{ tenants: AnalyticsTenant[] }>('/api/admin/analytics/tenants')
      .then((data) => {
        if (aborted) return;
        // Tenants flagged at-risk first; otherwise fall back to the
        // lowest-health-score tenants so the widget is still useful when
        // nothing has tripped the at-risk heuristic.
        const flagged = data.tenants.filter((t) => t.atRisk);
        const fallback = [...data.tenants].sort(
          (a, b) => a.healthScore - b.healthScore,
        );
        const list = flagged.length ? flagged : fallback;
        setAtRisk(list.slice(0, 5));
      })
      .catch(() => { if (!aborted) setAtRisk([]); })
      .finally(() => { if (!aborted) setAtRiskLoading(false); });
    return () => { aborted = true; };
  }, [apiFetch]);

  const tenantSegments = summary
    ? Object.entries(summary.tenants.byStatus)
        .filter(([, count]) => count > 0)
        .map(([status, count]) => ({
          status: STATUS_PALETTE[status]?.label ?? status,
          count,
          color: STATUS_PALETTE[status]?.color ?? '#94A3B8',
        }))
    : [];
  const totalHealth = tenantSegments.reduce((a, b) => a + b.count, 0);

  const renderKpi = (
    label: string,
    color: string,
    value: React.ReactNode,
    sub: React.ReactNode,
  ) => (
    <div style={card}>
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color, marginBottom: 4 }}>{value}</div>
      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>{sub}</div>
    </div>
  );

  const placeholder = summaryLoading ? '…' : '—';

  const tenantBreakdownText = summary
    ? `${summary.tenants.byStatus.ACTIVE ?? 0} active / ${summary.tenants.byStatus.TRIAL ?? 0} trial / ${summary.tenants.byStatus.LOCKED ?? 0} locked`
    : placeholder;

  const ticketSubText = summary
    ? highPriorityCount === null
      ? 'across all tenants'
      : `${highPriorityCount} high priority`
    : placeholder;

  return (
    <div>
      {summaryError && (
        <div style={{
          background: 'rgba(244,67,54,0.08)', border: '1px solid rgba(244,67,54,0.2)',
          borderRadius: 8, padding: 12, color: '#F44336', fontSize: 13, marginBottom: 16,
        }}>
          Couldn't load platform KPIs: {summaryError}
        </div>
      )}

      {/* KPI Cards — sourced from /api/admin/dashboard/summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
        {renderKpi('Total Tenants', '#00D4FF',
          summary ? summary.tenants.total : placeholder,
          tenantBreakdownText)}
        {renderKpi('Total MRR', '#4CAF50',
          summary ? formatUsd(summary.mrrCents) : placeholder,
          'Active SaaS subscriptions')}
        {renderKpi('Platform GMV This Month', '#2196F3',
          summary ? formatUsd(summary.platformGmvMonthCents) : placeholder,
          'Across all marinas')}
        {renderKpi('Platform Fee Revenue', '#FF9800',
          summary ? formatUsd(summary.platformFeeRevenueMonthCents) : placeholder,
          'SaaS revenue this month')}
        {renderKpi('Total Slips Managed', '#9C27B0',
          summary ? summary.slipsManaged.toLocaleString() : placeholder,
          summary ? `Across ${summary.tenants.total} marina${summary.tenants.total === 1 ? '' : 's'}` : ' ')}
        {renderKpi('Support Tickets Open', '#F44336',
          summary ? summary.openSupportTickets : placeholder,
          ticketSubText)}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
        {/* Tenant Health */}
        <div style={card}>
          <div style={cardTitle}>Tenant Health</div>
          {summaryLoading ? (
            <div style={{ padding: 20, textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>Loading…</div>
          ) : tenantSegments.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>
              No tenants yet.
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
              {/* Pie-like visual */}
              <div style={{ position: 'relative', width: 120, height: 120 }}>
                <svg viewBox="0 0 36 36" style={{ width: 120, height: 120, transform: 'rotate(-90deg)' }}>
                  {(() => {
                    let offset = 0;
                    return tenantSegments.map((seg) => {
                      const pct = (seg.count / totalHealth) * 100;
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
                {tenantSegments.map((seg) => (
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
          )}
        </div>

        {/* Quick links — replaces the synthetic MRR-trend bar chart so the
            dashboard never invents numbers we don't actually track. */}
        <div style={card}>
          <div style={cardTitle}>Jump to</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {[
              { label: 'Tenants', sub: 'Manage all tenants', path: '/tenants' },
              { label: 'Trials', sub: 'Onboarding tracker', path: '/trials' },
              { label: 'Billing', sub: 'SaaS invoices & MRR', path: '/billing' },
              { label: 'Support', sub: 'Tickets across tenants', path: '/support' },
              { label: 'Analytics', sub: 'Cross-tenant reports', path: '/analytics' },
              { label: 'Health', sub: 'System status', path: '/health' },
            ].map((item) => (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                style={{
                  textAlign: 'left',
                  background: 'rgba(0,212,255,0.06)',
                  border: '1px solid rgba(0,212,255,0.18)',
                  borderRadius: 6,
                  padding: '12px 14px',
                  cursor: 'pointer',
                  color: '#FFF',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600, color: '#00D4FF', marginBottom: 2 }}>{item.label}</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>{item.sub}</div>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* At-Risk Tenants */}
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ ...cardTitle, marginBottom: 0 }}>At-Risk Tenants</div>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>Click a row to deep-dive</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {atRiskLoading ? (
              <div style={{ padding: 20, textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>Loading…</div>
            ) : atRisk.length === 0 ? (
              <div style={{ padding: 20, textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>
                No at-risk tenants right now.
              </div>
            ) : (
              atRisk.map((t) => (
                <div
                  key={t.id}
                  onClick={() => navigate(`/tenants/${t.id}/deep-dive`)}
                  style={{ background: 'rgba(244,67,54,0.06)', border: '1px solid rgba(244,67,54,0.15)', borderRadius: 6, padding: 14, cursor: 'pointer', transition: 'background 0.15s' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(244,67,54,0.12)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(244,67,54,0.06)')}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: '#FFF' }}>{t.name}</span>
                    <span style={{ fontSize: 12, color: '#FF9800' }}>
                      ${Math.round(t.mrrCents / 100)}/mo{t.saasTier ? ` — ${t.saasTier}` : ''}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>{reasonFor(t)}</span>
                    <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>health: {t.healthScore}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Status snapshot */}
        <div style={card}>
          <div style={cardTitle}>Platform Status</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>Open support tickets</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#FFF' }}>
                {summary ? summary.openSupportTickets : placeholder}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>High / urgent priority</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#FFF' }}>
                {highPriorityCount === null ? placeholder : highPriorityCount}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>Slips managed (all tenants)</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#FFF' }}>
                {summary ? summary.slipsManaged.toLocaleString() : placeholder}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0' }}>
              <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>Platform GMV this month</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#FFF' }}>
                {summary ? formatUsd(summary.platformGmvMonthCents) : placeholder}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
