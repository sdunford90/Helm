import React, { useCallback, useEffect, useState } from 'react';

// ---------------------------------------------------------------------------
// Platform Webhooks console.
//
// Surfaces the two webhook feeds Helm depends on — Stripe Connect / Payments
// and Intuit QuickBooks Online — with a single pane of glass for delivery
// rates and a drill-down to recent failures. Backed by the existing
// /api/admin/health/system endpoint plus the failures endpoints that already
// power the Health page; this page is the dedicated home for them inside
// the Operations section of the admin nav.
// ---------------------------------------------------------------------------

const REFRESH_MS = 30_000;

type FeedKey = 'stripe-payments' | 'stripe-connect' | 'qbo';

interface WebhookStats {
  total: number;
  delivered?: number;
  processed?: number;
  failed: number;
  pending?: number;
  successRate: number;
  sparkline: number[];
}

interface HealthSystemResponse {
  generatedAt: string;
  windowHours: number;
  webhooks: {
    stripePayments: WebhookStats;
    stripeConnect: WebhookStats;
    qbo: WebhookStats;
  };
}

interface FailureItem {
  id: string;
  tenantId?: string | null;
  tenantName?: string | null;
  locationId?: string | null;
  realmId?: string | null;
  attempts?: number;
  error?: string | null;
  receivedAt?: string;
  processedAt?: string | null;
  recordType?: string;
  recordId?: string;
  action?: string;
  occurredAt?: string;
}

const page: React.CSSProperties = { padding: 0 };
const header: React.CSSProperties = { fontSize: 24, fontWeight: 700, color: '#FFFFFF', margin: 0, letterSpacing: '-0.01em' };
const subtitle: React.CSSProperties = { fontSize: 13, color: 'rgba(255,255,255,0.5)', marginTop: 6 };
const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginTop: 24 };
const card: React.CSSProperties = {
  background: '#0D1B2A',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.06)',
  padding: 20,
};
const cardLabel: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 0.6 };
const cardValue: React.CSSProperties = { fontSize: 28, fontWeight: 700, color: '#FFFFFF', marginTop: 6, fontVariantNumeric: 'tabular-nums' };
const cardSub: React.CSSProperties = { fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 6 };
const tabBar: React.CSSProperties = { display: 'flex', gap: 0, borderBottom: '1px solid rgba(255,255,255,0.08)', marginTop: 32 };
const tabBtn = (active: boolean): React.CSSProperties => ({
  padding: '10px 18px',
  background: 'transparent',
  border: 'none',
  borderBottom: active ? '2px solid #00D4FF' : '2px solid transparent',
  color: active ? '#FFFFFF' : 'rgba(255,255,255,0.5)',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: active ? 600 : 500,
  marginBottom: -1,
  fontFamily: 'inherit',
});
const tableWrap: React.CSSProperties = { marginTop: 20, background: '#0D1B2A', borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)', overflow: 'hidden' };
const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 12 };
const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 14px',
  fontSize: 10,
  fontWeight: 700,
  color: 'rgba(255,255,255,0.4)',
  textTransform: 'uppercase',
  letterSpacing: 0.6,
  borderBottom: '1px solid rgba(255,255,255,0.08)',
  background: 'rgba(255,255,255,0.02)',
};
const td: React.CSSProperties = {
  padding: '12px 14px',
  color: 'rgba(255,255,255,0.7)',
  borderBottom: '1px solid rgba(255,255,255,0.04)',
};
const emptyState: React.CSSProperties = { padding: '32px', textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 13 };

function pctLabel(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function rateColor(rate: number): string {
  if (rate >= 0.99) return '#22C55E';
  if (rate >= 0.95) return '#FACC15';
  return '#F87171';
}

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${await res.text().catch(() => res.statusText)}`);
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
  return `${Math.floor(hr / 24)}d ago`;
}

const Webhooks: React.FC = () => {
  const [stats, setStats] = useState<HealthSystemResponse | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [feed, setFeed] = useState<FeedKey>('qbo');
  const [failures, setFailures] = useState<FailureItem[]>([]);
  const [failuresLoading, setFailuresLoading] = useState(false);
  const [failuresError, setFailuresError] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    try {
      const data = await apiFetch<HealthSystemResponse>('/api/admin/health/system');
      setStats(data);
      setStatsError(null);
    } catch (err) {
      setStatsError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const loadFailures = useCallback(async (active: FeedKey) => {
    setFailuresLoading(true);
    try {
      // QBO has a dedicated failures endpoint; Stripe failures are recorded
      // in the audit log under FAILED actions on Payment / Payout etc.
      const url = active === 'qbo'
        ? '/api/admin/health/system/failures?type=qbo-webhooks&limit=50'
        : '/api/admin/health/system/failures?type=audit-errors&limit=50';
      const data = await apiFetch<{ items: FailureItem[] }>(url);
      setFailures(data.items ?? []);
      setFailuresError(null);
    } catch (err) {
      setFailuresError(err instanceof Error ? err.message : String(err));
    } finally {
      setFailuresLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStats();
    const t = setInterval(loadStats, REFRESH_MS);
    return () => clearInterval(t);
  }, [loadStats]);

  useEffect(() => {
    void loadFailures(feed);
  }, [feed, loadFailures]);

  const renderStatCard = (label: string, s: WebhookStats | undefined, sub: string) => {
    if (!s) return null;
    const ok = s.delivered ?? s.processed ?? 0;
    return (
      <div style={card}>
        <div style={cardLabel}>{label}</div>
        <div style={{ ...cardValue, color: rateColor(s.successRate) }}>{pctLabel(s.successRate)}</div>
        <div style={cardSub}>
          {ok.toLocaleString()} delivered · {s.failed.toLocaleString()} failed
          {typeof s.pending === 'number' && s.pending > 0 ? ` · ${s.pending.toLocaleString()} pending` : ''}
        </div>
        <div style={{ ...cardSub, marginTop: 4, fontSize: 11, opacity: 0.7 }}>{sub}</div>
      </div>
    );
  };

  return (
    <div style={page}>
      <h1 style={header}>Webhooks</h1>
      <div style={subtitle}>
        Stripe and QuickBooks delivery health over the last 24 hours. Pulls from the same feed as the System Health page;
        this view is the dedicated home for tracking deliveries and drilling into failures.
      </div>

      {statsError && (
        <div style={{ marginTop: 16, padding: 14, border: '1px solid rgba(244,67,54,0.4)', borderRadius: 8, color: '#FCA5A5', fontSize: 13 }}>
          Could not load stats: {statsError}
        </div>
      )}

      <div style={grid}>
        {renderStatCard('Stripe Payments', stats?.webhooks.stripePayments, 'payment_intent / charge / invoice / checkout events')}
        {renderStatCard('Stripe Connect', stats?.webhooks.stripeConnect, 'account / capability / payout / transfer events')}
        {renderStatCard('QuickBooks Online', stats?.webhooks.qbo, 'realm-level entity-change deliveries')}
      </div>

      <div style={tabBar}>
        <button style={tabBtn(feed === 'qbo')} onClick={() => setFeed('qbo')}>QuickBooks failures</button>
        <button style={tabBtn(feed === 'stripe-payments')} onClick={() => setFeed('stripe-payments')}>Stripe payment failures</button>
      </div>

      <div style={tableWrap}>
        {failuresLoading && failures.length === 0 ? (
          <div style={emptyState}>Loading…</div>
        ) : failuresError ? (
          <div style={emptyState}>Failed to load: {failuresError}</div>
        ) : failures.length === 0 ? (
          <div style={emptyState}>
            No recent failures
            {feed === 'qbo'
              ? ' — every QBO webhook delivery in the window processed successfully.'
              : ' — no FAILED Stripe-related audit entries in the window.'}
          </div>
        ) : (
          <table style={table}>
            <thead>
              <tr>
                {feed === 'qbo' ? (
                  <>
                    <th style={th}>When</th>
                    <th style={th}>Tenant</th>
                    <th style={th}>Realm</th>
                    <th style={th}>Attempts</th>
                    <th style={th}>Error</th>
                  </>
                ) : (
                  <>
                    <th style={th}>When</th>
                    <th style={th}>Tenant</th>
                    <th style={th}>Action</th>
                    <th style={th}>Record</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {failures.map((f) => (
                <tr key={f.id}>
                  {feed === 'qbo' ? (
                    <>
                      <td style={td}>{formatRelative(f.receivedAt)}</td>
                      <td style={td}>{f.tenantName ?? f.tenantId ?? '—'}</td>
                      <td style={{ ...td, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11 }}>{f.realmId ?? '—'}</td>
                      <td style={td}>{f.attempts ?? 0}</td>
                      <td style={{ ...td, color: '#FCA5A5', maxWidth: 380 }} title={f.error ?? ''}>
                        {f.error ? (f.error.length > 90 ? f.error.slice(0, 90) + '…' : f.error) : '—'}
                      </td>
                    </>
                  ) : (
                    <>
                      <td style={td}>{formatRelative(f.occurredAt)}</td>
                      <td style={td}>{f.tenantName ?? f.tenantId ?? '—'}</td>
                      <td style={td}>{f.action ?? '—'}</td>
                      <td style={{ ...td, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11 }}>
                        {f.recordType ?? '—'}{f.recordId ? ` · ${f.recordId.slice(0, 12)}` : ''}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default Webhooks;
