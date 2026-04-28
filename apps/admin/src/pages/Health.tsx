import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Platform Health monitoring page.
//
// Three tabs (System / Stripe Connect / QuickBooks) backed by the
// /api/admin/health/* endpoints. The active tab auto-refreshes every 30s and
// the failure drilldown opens in a side drawer fed by /health/system/failures.
// ---------------------------------------------------------------------------

const REFRESH_MS = 30_000;

type TabKey = 'system' | 'stripe' | 'qbo';

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'system', label: 'System' },
  { key: 'stripe', label: 'Stripe Connect' },
  { key: 'qbo', label: 'QuickBooks' },
];

const card: React.CSSProperties = {
  background: '#0D1B2A',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.06)',
  padding: 20,
};

const tableHeader: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 12px',
  fontSize: 11,
  fontWeight: 600,
  color: 'rgba(255,255,255,0.4)',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  borderBottom: '1px solid rgba(255,255,255,0.06)',
};

const tableCell: React.CSSProperties = {
  padding: '12px',
  fontSize: 12,
  color: 'rgba(255,255,255,0.7)',
  borderBottom: '1px solid rgba(255,255,255,0.04)',
};

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'in the future';
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

function formatExpiry(iso: string | null, days: number | null): string {
  if (!iso) return 'Never connected';
  if (days === null) return new Date(iso).toLocaleString();
  if (days < 0) return `Expired ${Math.abs(days)}d ago`;
  if (days === 0) return 'Expires today';
  return `Expires in ${days}d`;
}

function statusBadge(status: 'ok' | 'warning' | 'broken' | string): React.CSSProperties {
  const map: Record<string, { bg: string; color: string }> = {
    ok: { bg: 'rgba(76,175,80,0.15)', color: '#4CAF50' },
    warning: { bg: 'rgba(255,152,0,0.15)', color: '#FF9800' },
    broken: { bg: 'rgba(244,67,54,0.15)', color: '#F44336' },
  };
  const s = map[status] ?? map.warning;
  return {
    background: s.bg,
    color: s.color,
    padding: '3px 10px',
    borderRadius: 12,
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    display: 'inline-block',
  };
}

// ---------------------------------------------------------------------------
// Sparkline — tiny inline SVG bar chart for 24 hourly buckets.
// ---------------------------------------------------------------------------

const Sparkline: React.FC<{ data: number[]; color?: string; height?: number; width?: number }> = ({
  data,
  color = '#00D4FF',
  height = 28,
  width = 120,
}) => {
  const max = Math.max(1, ...data);
  const barWidth = width / Math.max(1, data.length);
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      {data.map((v, i) => {
        const h = Math.max(v > 0 ? 2 : 0, (v / max) * height);
        return (
          <rect
            key={i}
            x={i * barWidth}
            y={height - h}
            width={Math.max(1, barWidth - 1)}
            height={h}
            fill={color}
            opacity={v === 0 ? 0.15 : 0.85}
          />
        );
      })}
    </svg>
  );
};

// ---------------------------------------------------------------------------
// Failures drawer
// ---------------------------------------------------------------------------

interface DrawerProps {
  open: boolean;
  title: string;
  loading: boolean;
  items: Array<Record<string, unknown>>;
  onClose: () => void;
  renderItem: (item: any) => React.ReactNode; // eslint-disable-line @typescript-eslint/no-explicit-any
}

const FailuresDrawer: React.FC<DrawerProps> = ({ open, title, loading, items, onClose, renderItem }) => {
  if (!open) return null;
  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width: 480,
        background: '#0A2342',
        borderLeft: '1px solid rgba(255,255,255,0.1)',
        zIndex: 200,
        boxShadow: '-12px 0 40px rgba(0,0,0,0.4)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#FFF' }}>{title}</div>
        <button
          onClick={onClose}
          style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.6)', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', fontSize: 12 }}
        >
          Close
        </button>
      </div>
      <div style={{ padding: 16, overflowY: 'auto', flex: 1 }}>
        {loading && <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>Loading…</div>}
        {!loading && items.length === 0 && (
          <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>No recent failures.</div>
        )}
        {!loading && items.map((it, i) => (
          <div key={(it.id as string) ?? i} style={{ background: '#0D1B2A', borderRadius: 6, padding: 12, marginBottom: 10, border: '1px solid rgba(255,255,255,0.04)' }}>
            {renderItem(it)}
          </div>
        ))}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Types matching the API
// ---------------------------------------------------------------------------

interface QueueStat {
  name: string;
  isPaused: boolean;
  counts: { active: number; waiting: number; delayed: number; failed: number; paused: number; completed: number };
  jobs24h: { completed: number; failed: number; successRate: number; failedSparkline: number[]; truncated?: boolean };
}

interface SystemHealth {
  generatedAt: string;
  windowHours: number;
  queues: QueueStat[];
  webhooks: {
    stripePayments: { total: number; delivered: number; failed: number; successRate: number; sparkline: number[] };
    stripeConnect: { total: number; delivered: number; failed: number; successRate: number; sparkline: number[] };
    qbo: { total: number; processed: number; failed: number; pending: number; successRate: number; sparkline: number[] };
  };
  apiErrors: {
    total: number;
    sparkline: number[];
    byTenant: Array<{ tenantId: string; tenantName: string; count: number }>;
  };
}

interface StripeAccountRow {
  scope: 'location' | 'tenant';
  id: string;
  tenantId: string;
  tenantName: string;
  locationId: string | null;
  locationName: string | null;
  stripeAccountId: string;
  onboardingComplete: boolean;
  chargesEnabled: boolean | null;
  detailsSubmitted: boolean | null;
  capabilityRefreshedAt: string | null;
  payoutsEnabled: boolean | null;
  missingRequirements: string[];
  status: 'ok' | 'warning' | 'broken';
  lastSuccessfulActivity: { type: string; paymentId: string; amountCents: number; at: string } | null;
}

interface QboConnectionRow {
  scope: 'location' | 'tenant';
  id: string;
  tenantId: string;
  tenantName: string;
  locationId: string | null;
  locationName: string | null;
  realmId: string;
  companyName: string | null;
  tokenExpiresAt: string | null;
  tokenExpiresInDays: number | null;
  connectedAt: string | null;
  lastSuccessfulSyncAt: string | null;
  lastSyncError: string | null;
  lastSyncErrorAt: string | null;
  pendingRetryCount: number;
  reconnectRequired: boolean;
  status: 'ok' | 'warning' | 'broken';
}

// ---------------------------------------------------------------------------
// System tab
// ---------------------------------------------------------------------------

const SystemTab: React.FC<{
  data: SystemHealth | null;
  loading: boolean;
  openDrilldown: (title: string, fetcher: () => Promise<Array<Record<string, unknown>>>, render: (i: any) => React.ReactNode) => void; // eslint-disable-line @typescript-eslint/no-explicit-any
}> = ({ data, loading, openDrilldown }) => {
  if (loading && !data) {
    return <div style={{ textAlign: 'center', padding: 48, color: 'rgba(255,255,255,0.4)', fontSize: 14 }}>Loading system health…</div>;
  }
  if (!data) {
    return <div style={{ textAlign: 'center', padding: 48, color: 'rgba(244,67,54,0.7)', fontSize: 14 }}>Failed to load system health.</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Webhook + API summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
        <SummaryCard
          label="Stripe Payments (24h)"
          value={`${Math.round(data.webhooks.stripePayments.successRate * 100)}%`}
          sub={`${data.webhooks.stripePayments.delivered.toLocaleString()} delivered · ${data.webhooks.stripePayments.failed} failed`}
          sparkline={data.webhooks.stripePayments.sparkline}
          sparklineColor={data.webhooks.stripePayments.failed > 0 ? '#F44336' : '#4CAF50'}
          drilldownLabel={data.webhooks.stripePayments.failed > 0 ? `View ${data.webhooks.stripePayments.failed} failed` : undefined}
          onDrilldown={
            data.webhooks.stripePayments.failed > 0
              ? () =>
                  openDrilldown(
                    'Failed payment webhook deliveries',
                    async () => {
                      const res = await apiFetch<{ items: Array<Record<string, unknown>> }>(
                        '/api/admin/health/system/failures?type=audit-errors&limit=50',
                      );
                      // The audit-errors drilldown returns all failures; the
                      // UI filters to PAYMENT recordType for the payments card.
                      return res.items.filter((it) => it.recordType === 'Payment');
                    },
                    (it) => (
                      <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                          <span style={{ color: '#FFF', fontWeight: 600, fontSize: 13 }}>{it.tenantName ?? it.tenantId}</span>
                          <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>{formatRelative(it.occurredAt)}</span>
                        </div>
                        <div style={{ fontSize: 11, color: '#FF9800', fontFamily: 'ui-monospace', marginBottom: 4 }}>{it.action}</div>
                        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>payment {it.recordId}</div>
                      </>
                    ),
                  )
              : undefined
          }
        />
        <SummaryCard
          label="Stripe Connect (24h)"
          value={data.webhooks.stripeConnect.total.toLocaleString()}
          sub={`${data.webhooks.stripeConnect.delivered.toLocaleString()} processed events (delivery only)`}
          sparkline={data.webhooks.stripeConnect.sparkline}
          sparklineColor="#2196F3"
        />
        <SummaryCard
          label="QBO Webhooks (24h)"
          value={data.webhooks.qbo.total.toLocaleString()}
          sub={`${data.webhooks.qbo.failed} failed · ${data.webhooks.qbo.pending} pending`}
          sparkline={data.webhooks.qbo.sparkline}
          sparklineColor={data.webhooks.qbo.failed > 0 ? '#F44336' : '#4CAF50'}
          drilldownLabel={data.webhooks.qbo.failed > 0 ? `View ${data.webhooks.qbo.failed} failed` : undefined}
          onDrilldown={() =>
            openDrilldown(
              'Failed QBO webhook deliveries',
              async () => {
                const res = await apiFetch<{ items: Array<Record<string, unknown>> }>('/api/admin/health/system/failures?type=qbo-webhooks&limit=50');
                return res.items;
              },
              (it) => (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ color: '#FFF', fontWeight: 600, fontSize: 13 }}>{it.tenantName ?? '(unrouted)'}</span>
                    <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>{formatRelative(it.receivedAt)}</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>realm {it.realmId} · {it.attempts} attempts</div>
                  <div style={{ fontSize: 12, color: '#F44336', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{it.error ?? 'Unknown error'}</div>
                </>
              ),
            )
          }
        />
        <SummaryCard
          label="API Errors (24h)"
          value={data.apiErrors.total.toLocaleString()}
          sub={`${data.apiErrors.byTenant.length} tenants affected`}
          sparkline={data.apiErrors.sparkline}
          sparklineColor={data.apiErrors.total > 0 ? '#FF9800' : '#4CAF50'}
          drilldownLabel={data.apiErrors.total > 0 ? 'View recent failures' : undefined}
          onDrilldown={() =>
            openDrilldown(
              'Recent failures (audit log)',
              async () => {
                const res = await apiFetch<{ items: Array<Record<string, unknown>> }>('/api/admin/health/system/failures?type=audit-errors&limit=50');
                return res.items;
              },
              (it) => (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ color: '#FFF', fontWeight: 600, fontSize: 13 }}>{it.tenantName ?? it.tenantId}</span>
                    <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>{formatRelative(it.occurredAt)}</span>
                  </div>
                  <div style={{ fontSize: 11, color: '#FF9800', fontFamily: 'ui-monospace', marginBottom: 4 }}>{it.action}</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>{it.recordType} · {it.recordId}</div>
                </>
              ),
            )
          }
        />
      </div>

      {/* Top tenants by API errors */}
      {data.apiErrors.byTenant.length > 0 && (
        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
            API errors by tenant (top 10)
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {data.apiErrors.byTenant.map((t) => (
              <div key={t.tenantId} style={{ background: '#070E18', borderRadius: 6, padding: '8px 14px', border: '1px solid rgba(255,255,255,0.05)' }}>
                <span style={{ fontSize: 12, color: '#FFF', fontWeight: 500 }}>{t.tenantName}</span>
                <span style={{ marginLeft: 10, color: '#FF9800', fontWeight: 700, fontSize: 13 }}>{t.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Queue table */}
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
          Background workers
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Worker', 'Status', 'Active', 'Waiting', 'Delayed', 'Completed (24h)', 'Failed (24h)', 'Success rate', 'Trend'].map((h) => (
                <th key={h} style={tableHeader}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.queues.map((q) => {
              const sr = Math.round(q.jobs24h.successRate * 100);
              const srColor = sr >= 99 ? '#4CAF50' : sr >= 95 ? '#FF9800' : '#F44336';
              return (
                <tr key={q.name}>
                  <td style={{ ...tableCell, color: '#FFF', fontWeight: 500 }}>{q.name}</td>
                  <td style={tableCell}>
                    <span style={statusBadge(q.isPaused ? 'warning' : 'ok')}>{q.isPaused ? 'Paused' : 'Running'}</span>
                  </td>
                  <td style={tableCell}>{q.counts.active}</td>
                  <td style={tableCell}>{q.counts.waiting}</td>
                  <td style={tableCell}>{q.counts.delayed}</td>
                  <td style={tableCell}>{q.jobs24h.completed.toLocaleString()}</td>
                  <td style={tableCell}>
                    {q.jobs24h.failed > 0 ? (
                      <button
                        onClick={() =>
                          openDrilldown(
                            `Failed jobs · ${q.name}`,
                            async () => {
                              const res = await apiFetch<{ items: Array<Record<string, unknown>> }>(`/api/admin/health/system/failures?type=queue&queue=${q.name}&limit=50`);
                              return res.items;
                            },
                            (it) => (
                              <>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                                  <span style={{ color: '#FFF', fontWeight: 600, fontSize: 13 }}>{it.name}</span>
                                  <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>{formatRelative(it.failedAt)}</span>
                                </div>
                                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>job {it.id} · {it.attemptsMade} attempts</div>
                                <div style={{ fontSize: 12, color: '#F44336', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{it.failedReason ?? 'Unknown error'}</div>
                              </>
                            ),
                          )
                        }
                        style={{ background: 'transparent', border: 'none', color: '#F44336', cursor: 'pointer', fontWeight: 600, fontSize: 12, textDecoration: 'underline' }}
                      >
                        {q.jobs24h.failed.toLocaleString()}
                      </button>
                    ) : (
                      <span style={{ color: 'rgba(255,255,255,0.4)' }}>0</span>
                    )}
                  </td>
                  <td style={{ ...tableCell, color: srColor, fontWeight: 600 }}>
                    {sr}%
                    {q.jobs24h.truncated && (
                      <span title="Sample truncated at 5,000 jobs — actual rate may differ" style={{ marginLeft: 4, color: '#FF9800', fontWeight: 700 }}>*</span>
                    )}
                  </td>
                  <td style={tableCell}>
                    <Sparkline data={q.jobs24h.failedSparkline} color={q.jobs24h.failed > 0 ? '#F44336' : '#4CAF50'} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const SummaryCard: React.FC<{
  label: string;
  value: string;
  sub: string;
  sparkline: number[];
  sparklineColor?: string;
  drilldownLabel?: string;
  onDrilldown?: () => void;
}> = ({ label, value, sub, sparkline, sparklineColor, drilldownLabel, onDrilldown }) => (
  <div style={card}>
    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>{label}</div>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
      <div>
        <div style={{ fontSize: 26, fontWeight: 700, color: '#FFF', marginBottom: 4 }}>{value}</div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>{sub}</div>
      </div>
      <Sparkline data={sparkline} color={sparklineColor} />
    </div>
    {drilldownLabel && onDrilldown && (
      <button
        onClick={onDrilldown}
        style={{ marginTop: 10, background: 'transparent', border: '1px solid rgba(0,212,255,0.3)', color: '#00D4FF', borderRadius: 4, padding: '4px 10px', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}
      >
        {drilldownLabel} →
      </button>
    )}
  </div>
);

// ---------------------------------------------------------------------------
// Stripe Connect tab
// ---------------------------------------------------------------------------

type SortKey = 'tenant' | 'status' | 'lastActivity';

const StripeTab: React.FC<{
  rows: StripeAccountRow[] | null;
  loading: boolean;
  refreshAccount: (row: StripeAccountRow) => Promise<void>;
}> = ({ rows, loading, refreshAccount }) => {
  const [sortKey, setSortKey] = useState<SortKey>('status');
  const [refreshingId, setRefreshingId] = useState<string | null>(null);

  const sorted = useMemo(() => {
    if (!rows) return [];
    const order = { broken: 0, warning: 1, ok: 2 } as const;
    return [...rows].sort((a, b) => {
      if (sortKey === 'status') {
        const d = order[a.status] - order[b.status];
        if (d !== 0) return d;
        return a.tenantName.localeCompare(b.tenantName);
      }
      if (sortKey === 'lastActivity') {
        const at = a.lastSuccessfulActivity?.at ?? '';
        const bt = b.lastSuccessfulActivity?.at ?? '';
        return bt.localeCompare(at);
      }
      return a.tenantName.localeCompare(b.tenantName);
    });
  }, [rows, sortKey]);

  if (loading && !rows) {
    return <div style={{ textAlign: 'center', padding: 48, color: 'rgba(255,255,255,0.4)', fontSize: 14 }}>Loading Stripe Connect health…</div>;
  }
  if (!rows) {
    return <div style={{ textAlign: 'center', padding: 48, color: 'rgba(244,67,54,0.7)', fontSize: 14 }}>Failed to load Stripe Connect health.</div>;
  }

  const summary = {
    total: rows.length,
    broken: rows.filter((r) => r.status === 'broken').length,
    warning: rows.filter((r) => r.status === 'warning').length,
    ok: rows.filter((r) => r.status === 'ok').length,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
        <SummaryCard label="Total Accounts" value={`${summary.total}`} sub="Connected via Stripe Connect" sparkline={[]} />
        <SummaryCard label="Healthy" value={`${summary.ok}`} sub="Charges enabled" sparkline={[]} sparklineColor="#4CAF50" />
        <SummaryCard label="Warnings" value={`${summary.warning}`} sub="Capability data stale" sparkline={[]} sparklineColor="#FF9800" />
        <SummaryCard label="Broken" value={`${summary.broken}`} sub="Onboarding incomplete or charges off" sparkline={[]} sparklineColor="#F44336" />
      </div>

      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 1 }}>
            Connected accounts
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>Sort by</span>
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              style={{ background: '#070E18', border: '1px solid rgba(255,255,255,0.1)', color: '#FFF', borderRadius: 4, padding: '4px 8px', fontSize: 12 }}
            >
              <option value="status">Status</option>
              <option value="tenant">Tenant</option>
              <option value="lastActivity">Last activity</option>
            </select>
          </div>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Tenant', 'Location', 'Account', 'Status', 'Charges', 'Payouts', 'Details', 'Missing', 'Last activity', ''].map((h) => (
                <th key={h} style={tableHeader}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td colSpan={10} style={{ textAlign: 'center', padding: 32, color: 'rgba(255,255,255,0.3)' }}>
                  No connected Stripe accounts yet.
                </td>
              </tr>
            )}
            {sorted.map((r) => (
              <tr key={`${r.scope}:${r.id}`}>
                <td style={{ ...tableCell, color: '#FFF', fontWeight: 500 }}>
                  <a href={`/tenants/${r.tenantId}`} style={{ color: '#FFF', textDecoration: 'none' }}>
                    {r.tenantName}
                  </a>
                </td>
                <td style={tableCell}>{r.locationName ?? <em style={{ color: 'rgba(255,255,255,0.3)' }}>tenant-level</em>}</td>
                <td style={{ ...tableCell, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>{r.stripeAccountId}</td>
                <td style={tableCell}><span style={statusBadge(r.status)}>{r.status}</span></td>
                <td style={{ ...tableCell, color: r.chargesEnabled ? '#4CAF50' : r.chargesEnabled === false ? '#F44336' : 'rgba(255,255,255,0.4)' }}>
                  {r.chargesEnabled === null ? '—' : r.chargesEnabled ? 'Enabled' : 'Disabled'}
                </td>
                <td style={{ ...tableCell, color: r.payoutsEnabled ? '#4CAF50' : r.payoutsEnabled === false ? '#F44336' : 'rgba(255,255,255,0.4)' }}>
                  {r.payoutsEnabled === null ? '—' : r.payoutsEnabled ? 'Enabled' : 'Disabled'}
                </td>
                <td style={{ ...tableCell, color: r.detailsSubmitted ? '#4CAF50' : 'rgba(255,255,255,0.5)' }}>
                  {r.detailsSubmitted === null ? '—' : r.detailsSubmitted ? 'Submitted' : 'Pending'}
                </td>
                <td style={tableCell}>
                  {r.missingRequirements.length === 0 ? (
                    <span style={{ color: 'rgba(255,255,255,0.3)' }}>None</span>
                  ) : (
                    <span style={{ color: '#FF9800', fontSize: 11 }}>{r.missingRequirements.join(', ')}</span>
                  )}
                </td>
                <td style={tableCell}>
                  {r.lastSuccessfulActivity ? (
                    <span title={r.lastSuccessfulActivity.at}>
                      ${(r.lastSuccessfulActivity.amountCents / 100).toFixed(2)} · {formatRelative(r.lastSuccessfulActivity.at)}
                    </span>
                  ) : (
                    <span style={{ color: 'rgba(255,255,255,0.3)' }}>No payments</span>
                  )}
                </td>
                <td style={tableCell}>
                  <button
                    onClick={async () => {
                      setRefreshingId(`${r.scope}:${r.id}`);
                      try {
                        await refreshAccount(r);
                      } finally {
                        setRefreshingId(null);
                      }
                    }}
                    disabled={refreshingId === `${r.scope}:${r.id}`}
                    style={{ background: 'transparent', border: '1px solid rgba(0,212,255,0.3)', color: '#00D4FF', borderRadius: 4, padding: '4px 10px', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}
                  >
                    {refreshingId === `${r.scope}:${r.id}` ? 'Refreshing…' : 'Refresh'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// QuickBooks tab
// ---------------------------------------------------------------------------

const QboTab: React.FC<{
  rows: QboConnectionRow[] | null;
  loading: boolean;
  reconnectOnly: boolean;
  setReconnectOnly: (v: boolean) => void;
  openDrilldown: (title: string, fetcher: () => Promise<Array<Record<string, unknown>>>, render: (i: any) => React.ReactNode) => void; // eslint-disable-line @typescript-eslint/no-explicit-any
}> = ({ rows, loading, reconnectOnly, setReconnectOnly, openDrilldown }) => {
  const [sortKey, setSortKey] = useState<'status' | 'tenant' | 'lastSync' | 'expiry'>('status');

  const sorted = useMemo(() => {
    if (!rows) return [];
    const order = { broken: 0, warning: 1, ok: 2 } as const;
    return [...rows].sort((a, b) => {
      if (sortKey === 'status') {
        const d = order[a.status] - order[b.status];
        if (d !== 0) return d;
        return a.tenantName.localeCompare(b.tenantName);
      }
      if (sortKey === 'lastSync') {
        return (b.lastSuccessfulSyncAt ?? '').localeCompare(a.lastSuccessfulSyncAt ?? '');
      }
      if (sortKey === 'expiry') {
        const ae = a.tokenExpiresInDays ?? 999;
        const be = b.tokenExpiresInDays ?? 999;
        return ae - be;
      }
      return a.tenantName.localeCompare(b.tenantName);
    });
  }, [rows, sortKey]);

  if (loading && !rows) {
    return <div style={{ textAlign: 'center', padding: 48, color: 'rgba(255,255,255,0.4)', fontSize: 14 }}>Loading QuickBooks health…</div>;
  }
  if (!rows) {
    return <div style={{ textAlign: 'center', padding: 48, color: 'rgba(244,67,54,0.7)', fontSize: 14 }}>Failed to load QuickBooks health.</div>;
  }

  const summary = {
    total: rows.length,
    broken: rows.filter((r) => r.status === 'broken').length,
    warning: rows.filter((r) => r.status === 'warning').length,
    ok: rows.filter((r) => r.status === 'ok').length,
    pendingRetries: rows.reduce((sum, r) => sum + r.pendingRetryCount, 0),
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
        <SummaryCard label="Total Connections" value={`${summary.total}`} sub="QuickBooks Online linked" sparkline={[]} />
        <SummaryCard label="Reconnect Required" value={`${summary.broken}`} sub="Token expired or missing" sparkline={[]} sparklineColor="#F44336" />
        <SummaryCard label="Warnings" value={`${summary.warning}`} sub="Sync errors or expiring soon" sparkline={[]} sparklineColor="#FF9800" />
        <SummaryCard
          label="Pending Retries"
          value={`${summary.pendingRetries}`}
          sub="Sync refs + webhook deliveries"
          sparkline={[]}
          sparklineColor={summary.pendingRetries > 0 ? '#FF9800' : '#4CAF50'}
          drilldownLabel={summary.pendingRetries > 0 ? 'View failed syncs' : undefined}
          onDrilldown={() =>
            openDrilldown(
              'Failed QBO inventory syncs',
              async () => {
                const res = await apiFetch<{ items: Array<Record<string, unknown>> }>('/api/admin/health/system/failures?type=qbo-syncs&limit=50');
                return res.items;
              },
              (it) => (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ color: '#FFF', fontWeight: 600, fontSize: 13 }}>{it.tenantName ?? it.tenantId}</span>
                    <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>{formatRelative(it.erroredAt)}</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>{it.qboType} · {it.sourceType} {it.sourceId} · retry #{it.retryCount}</div>
                  <div style={{ fontSize: 12, color: '#F44336', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{it.error}</div>
                </>
              ),
            )
          }
        />
      </div>

      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 1 }}>
            QuickBooks connections
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'rgba(255,255,255,0.6)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={reconnectOnly}
                onChange={(e) => setReconnectOnly(e.target.checked)}
              />
              Reconnect required only
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>Sort by</span>
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as typeof sortKey)}
                style={{ background: '#070E18', border: '1px solid rgba(255,255,255,0.1)', color: '#FFF', borderRadius: 4, padding: '4px 8px', fontSize: 12 }}
              >
                <option value="status">Status</option>
                <option value="tenant">Tenant</option>
                <option value="lastSync">Last sync</option>
                <option value="expiry">Token expiry</option>
              </select>
            </div>
          </div>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Tenant', 'Location', 'Realm', 'Status', 'Token', 'Last sync', 'Last error', 'Pending'].map((h) => (
                <th key={h} style={tableHeader}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', padding: 32, color: 'rgba(255,255,255,0.3)' }}>
                  No QuickBooks connections {reconnectOnly ? 'requiring reconnect.' : 'yet.'}
                </td>
              </tr>
            )}
            {sorted.map((r) => (
              <tr key={`${r.scope}:${r.id}`}>
                <td style={{ ...tableCell, color: '#FFF', fontWeight: 500 }}>
                  <a href={`/tenants/${r.tenantId}`} style={{ color: '#FFF', textDecoration: 'none' }}>{r.tenantName}</a>
                </td>
                <td style={tableCell}>{r.locationName ?? <em style={{ color: 'rgba(255,255,255,0.3)' }}>tenant-level</em>}</td>
                <td style={{ ...tableCell, fontFamily: 'ui-monospace', fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>{r.realmId}</td>
                <td style={tableCell}>
                  <span style={statusBadge(r.status)}>{r.reconnectRequired ? 'Reconnect' : r.status}</span>
                </td>
                <td style={{ ...tableCell, color: r.reconnectRequired ? '#F44336' : (r.tokenExpiresInDays ?? 999) < 7 ? '#FF9800' : 'rgba(255,255,255,0.7)' }}>
                  {formatExpiry(r.tokenExpiresAt, r.tokenExpiresInDays)}
                </td>
                <td style={tableCell} title={r.lastSuccessfulSyncAt ?? ''}>{formatRelative(r.lastSuccessfulSyncAt)}</td>
                <td style={tableCell}>
                  {r.lastSyncError ? (
                    <span style={{ color: '#F44336', fontSize: 11, fontFamily: 'ui-monospace' }} title={r.lastSyncError}>
                      {r.lastSyncError.length > 60 ? `${r.lastSyncError.slice(0, 60)}…` : r.lastSyncError}
                    </span>
                  ) : (
                    <span style={{ color: 'rgba(255,255,255,0.3)' }}>None</span>
                  )}
                </td>
                <td style={{ ...tableCell, color: r.pendingRetryCount > 0 ? '#FF9800' : 'rgba(255,255,255,0.4)', fontWeight: r.pendingRetryCount > 0 ? 600 : 400 }}>
                  {r.pendingRetryCount}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Page shell
// ---------------------------------------------------------------------------

const Health: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabKey>('system');

  const [systemData, setSystemData] = useState<SystemHealth | null>(null);
  const [stripeData, setStripeData] = useState<StripeAccountRow[] | null>(null);
  const [qboData, setQboData] = useState<QboConnectionRow[] | null>(null);
  const [reconnectOnly, setReconnectOnly] = useState(false);

  const [systemLoading, setSystemLoading] = useState(false);
  const [stripeLoading, setStripeLoading] = useState(false);
  const [qboLoading, setQboLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  // Drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTitle, setDrawerTitle] = useState('');
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerItems, setDrawerItems] = useState<Array<Record<string, unknown>>>([]);
  const drawerRender = useRef<((i: Record<string, unknown>) => React.ReactNode) | null>(null);

  const openDrilldown = useCallback(
    async (
      title: string,
      fetcher: () => Promise<Array<Record<string, unknown>>>,
      render: (i: Record<string, unknown>) => React.ReactNode,
    ) => {
      setDrawerOpen(true);
      setDrawerTitle(title);
      setDrawerLoading(true);
      setDrawerItems([]);
      drawerRender.current = render;
      try {
        const items = await fetcher();
        setDrawerItems(items);
      } catch (err) {
        console.error('Failed to load drilldown', err);
        setDrawerItems([]);
      } finally {
        setDrawerLoading(false);
      }
    },
    [],
  );

  const loadSystem = useCallback(async () => {
    setSystemLoading(true);
    try {
      const data = await apiFetch<SystemHealth>('/api/admin/health/system');
      setSystemData(data);
    } catch (err) {
      console.error('Failed to load system health', err);
      setSystemData(null);
    } finally {
      setSystemLoading(false);
    }
  }, []);

  const loadStripe = useCallback(async () => {
    setStripeLoading(true);
    try {
      const data = await apiFetch<{ items: StripeAccountRow[] }>('/api/admin/health/stripe-connect');
      setStripeData(data.items);
    } catch (err) {
      console.error('Failed to load stripe health', err);
      setStripeData(null);
    } finally {
      setStripeLoading(false);
    }
  }, []);

  const loadQbo = useCallback(async () => {
    setQboLoading(true);
    try {
      const url = `/api/admin/health/quickbooks${reconnectOnly ? '?reconnect=true' : ''}`;
      const data = await apiFetch<{ items: QboConnectionRow[] }>(url);
      setQboData(data.items);
    } catch (err) {
      console.error('Failed to load qbo health', err);
      setQboData(null);
    } finally {
      setQboLoading(false);
    }
  }, [reconnectOnly]);

  const refreshActiveTab = useCallback(async () => {
    if (activeTab === 'system') await loadSystem();
    else if (activeTab === 'stripe') await loadStripe();
    else if (activeTab === 'qbo') await loadQbo();
    setLastRefresh(new Date());
  }, [activeTab, loadSystem, loadStripe, loadQbo]);

  // Initial + reactive load when tab or filter changes
  useEffect(() => {
    refreshActiveTab();
  }, [refreshActiveTab]);

  // Auto-refresh every 30s while a tab is active
  useEffect(() => {
    const id = setInterval(() => {
      refreshActiveTab();
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [refreshActiveTab]);

  const refreshStripeAccount = useCallback(
    async (row: StripeAccountRow) => {
      try {
        await apiFetch('/api/admin/health/stripe-connect/refresh', {
          method: 'POST',
          body: JSON.stringify({
            stripeAccountId: row.stripeAccountId,
            scope: row.scope,
            recordId: row.scope === 'location' ? row.locationId : row.tenantId,
            tenantId: row.tenantId,
          }),
        });
        await loadStripe();
      } catch (err) {
        console.error('Refresh failed', err);
      }
    },
    [loadStripe],
  );

  return (
    <div>
      {/* Tab bar + manual refresh */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 4, background: '#0D1B2A', padding: 4, borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)' }}>
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              style={{
                background: activeTab === t.key ? '#0A2342' : 'transparent',
                border: '1px solid',
                borderColor: activeTab === t.key ? '#00D4FF' : 'transparent',
                color: activeTab === t.key ? '#00D4FF' : 'rgba(255,255,255,0.6)',
                borderRadius: 6,
                padding: '8px 18px',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
            {lastRefresh ? `Updated ${formatRelative(lastRefresh.toISOString())} · auto-refresh 30s` : 'Loading…'}
          </span>
          <button
            onClick={refreshActiveTab}
            disabled={systemLoading || stripeLoading || qboLoading}
            style={{ background: '#0A2342', color: '#00D4FF', border: '1px solid #00D4FF', borderRadius: 6, padding: '7px 16px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
          >
            Refresh now
          </button>
        </div>
      </div>

      {activeTab === 'system' && (
        <SystemTab data={systemData} loading={systemLoading} openDrilldown={openDrilldown} />
      )}
      {activeTab === 'stripe' && (
        <StripeTab rows={stripeData} loading={stripeLoading} refreshAccount={refreshStripeAccount} />
      )}
      {activeTab === 'qbo' && (
        <QboTab
          rows={qboData}
          loading={qboLoading}
          reconnectOnly={reconnectOnly}
          setReconnectOnly={setReconnectOnly}
          openDrilldown={openDrilldown}
        />
      )}

      <FailuresDrawer
        open={drawerOpen}
        title={drawerTitle}
        loading={drawerLoading}
        items={drawerItems}
        onClose={() => setDrawerOpen(false)}
        renderItem={(item) => (drawerRender.current ? drawerRender.current(item) : null)}
      />
    </div>
  );
};

export default Health;
