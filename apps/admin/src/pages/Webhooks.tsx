import React, { useCallback, useEffect, useState } from 'react';

// ---------------------------------------------------------------------------
// Platform Webhooks console.
//
// Surfaces Stripe Connect / Payments + Intuit QBO webhook health with a
// single pane of glass for delivery rates, drilldown to failures, all-
// deliveries listing (A2), and a per-row retry action for failed QBO
// deliveries (A1). Backed by /api/admin/health/system (24h aggregates),
// /api/admin/health/system/failures (failure drilldown), and
// /api/admin/webhooks/qbo (all-deliveries + retry).
// ---------------------------------------------------------------------------

const REFRESH_MS = 30_000;

type QboTab = 'failed' | 'all';

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

interface QboDelivery {
  id: string;
  tenantId?: string | null;
  tenantName?: string | null;
  locationId?: string | null;
  realmId?: string | null;
  attempts?: number;
  status?: string;
  error?: string | null;
  receivedAt: string;
  processedAt: string | null;
}

interface StripeFailure {
  id: string;
  tenantId?: string | null;
  tenantName?: string | null;
  recordType?: string;
  recordId?: string;
  action?: string;
  occurredAt?: string;
}

const page: React.CSSProperties = { padding: 0 };
const header: React.CSSProperties = { fontSize: 24, fontWeight: 700, color: '#FFFFFF', margin: 0, letterSpacing: '-0.01em' };
const subtitle: React.CSSProperties = { fontSize: 13, color: 'rgba(255,255,255,0.5)', marginTop: 6 };
const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginTop: 24 };
const card: React.CSSProperties = { background: '#0D1B2A', borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)', padding: 20 };
const cardLabel: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 0.6 };
const cardValue: React.CSSProperties = { fontSize: 28, fontWeight: 700, color: '#FFFFFF', marginTop: 6, fontVariantNumeric: 'tabular-nums' };
const cardSub: React.CSSProperties = { fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 6 };
const tabBar: React.CSSProperties = { display: 'flex', gap: 0, borderBottom: '1px solid rgba(255,255,255,0.08)', marginTop: 32 };
const tableWrap: React.CSSProperties = { marginTop: 20, background: '#0D1B2A', borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)', overflow: 'hidden' };
const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 12 };
const th: React.CSSProperties = { textAlign: 'left', padding: '10px 14px', fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 0.6, borderBottom: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)' };
const td: React.CSSProperties = { padding: '12px 14px', color: 'rgba(255,255,255,0.7)', borderBottom: '1px solid rgba(255,255,255,0.04)' };
const emptyState: React.CSSProperties = { padding: '32px', textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 13 };
const retryBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px',
  background: 'rgba(0,212,255,0.10)', border: '1px solid rgba(0,212,255,0.3)',
  borderRadius: 6, color: '#00D4FF', fontSize: 11, fontWeight: 600, cursor: 'pointer',
  fontFamily: 'inherit',
};
const statusBadge = (status: string): React.CSSProperties => {
  const tone = status === 'PROCESSED' ? { background: 'rgba(34,197,94,0.15)', color: '#86EFAC' } :
               status === 'FAILED'    ? { background: 'rgba(248,113,113,0.15)', color: '#FCA5A5' } :
               status === 'PENDING'   ? { background: 'rgba(250,204,21,0.15)', color: '#FDE68A' } :
                                        { background: 'rgba(148,163,184,0.15)', color: '#CBD5E1' };
  return { ...tone, display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700, letterSpacing: 0.4 };
};

function tabBtn(active: boolean): React.CSSProperties {
  return {
    padding: '10px 18px', background: 'transparent', border: 'none',
    borderBottom: active ? '2px solid #00D4FF' : '2px solid transparent',
    color: active ? '#FFFFFF' : 'rgba(255,255,255,0.5)',
    cursor: 'pointer', fontSize: 13,
    fontWeight: active ? 600 : 500,
    marginBottom: -1, fontFamily: 'inherit',
  };
}

function pctLabel(rate: number): string { return `${Math.round(rate * 100)}%`; }
function rateColor(rate: number): string {
  if (rate >= 0.99) return '#22C55E';
  if (rate >= 0.95) return '#FACC15';
  return '#F87171';
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
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

  // QBO sub-tab: failed (default) vs all deliveries.
  const [qboTab, setQboTab] = useState<QboTab>('failed');
  const [qboRows, setQboRows] = useState<QboDelivery[]>([]);
  const [qboLoading, setQboLoading] = useState(false);
  const [qboError, setQboError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);

  // Stripe payment failures (audit-log driven).
  const [stripeRows, setStripeRows] = useState<StripeFailure[]>([]);
  const [stripeLoading, setStripeLoading] = useState(false);
  const [stripeError, setStripeError] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    try {
      const data = await apiFetch<HealthSystemResponse>('/api/admin/health/system');
      setStats(data);
      setStatsError(null);
    } catch (err) {
      setStatsError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const loadQbo = useCallback(async (tab: QboTab) => {
    setQboLoading(true);
    try {
      if (tab === 'failed') {
        const data = await apiFetch<{ items: QboDelivery[] }>(
          '/api/admin/health/system/failures?type=qbo-webhooks&limit=100',
        );
        setQboRows(data.items.map((r) => ({ ...r, status: 'FAILED' })));
      } else {
        const data = await apiFetch<{ items: QboDelivery[] }>(
          '/api/admin/webhooks/qbo?limit=200',
        );
        setQboRows(data.items);
      }
      setQboError(null);
    } catch (err) {
      setQboError(err instanceof Error ? err.message : String(err));
    } finally {
      setQboLoading(false);
    }
  }, []);

  const loadStripeFailures = useCallback(async () => {
    setStripeLoading(true);
    try {
      const data = await apiFetch<{ items: StripeFailure[] }>(
        '/api/admin/health/system/failures?type=audit-errors&limit=50',
      );
      setStripeRows(data.items ?? []);
      setStripeError(null);
    } catch (err) {
      setStripeError(err instanceof Error ? err.message : String(err));
    } finally {
      setStripeLoading(false);
    }
  }, []);

  async function retry(id: string) {
    setRetrying(id);
    try {
      const result = await apiFetch<{ status: string; error?: string }>(
        `/api/admin/webhooks/qbo/${id}/retry`, { method: 'POST' },
      );
      if (result.status === 'FAILED') {
        alert(`Retry failed: ${result.error ?? 'unknown error'}`);
      }
      await loadQbo(qboTab);
      await loadStats();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setRetrying(null);
    }
  }

  useEffect(() => {
    void loadStats();
    const t = setInterval(loadStats, REFRESH_MS);
    return () => clearInterval(t);
  }, [loadStats]);

  useEffect(() => { void loadQbo(qboTab); }, [qboTab, loadQbo]);
  useEffect(() => { void loadStripeFailures(); }, [loadStripeFailures]);

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
        Stripe and QuickBooks delivery health over the last 24 hours. Failed QBO deliveries can be retried inline.
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

      {/* QuickBooks deliveries */}
      <div style={{ marginTop: 32 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#FFFFFF', marginBottom: 4 }}>QuickBooks deliveries</div>
        <div style={tabBar}>
          <button style={tabBtn(qboTab === 'failed')} onClick={() => setQboTab('failed')}>Failed only</button>
          <button style={tabBtn(qboTab === 'all')} onClick={() => setQboTab('all')}>All deliveries</button>
        </div>
        <div style={tableWrap}>
          {qboLoading && qboRows.length === 0 ? (
            <div style={emptyState}>Loading…</div>
          ) : qboError ? (
            <div style={emptyState}>Failed to load: {qboError}</div>
          ) : qboRows.length === 0 ? (
            <div style={emptyState}>
              {qboTab === 'failed'
                ? 'No recent failures — every QBO webhook delivery in the window processed successfully.'
                : 'No QBO webhook deliveries in the window.'}
            </div>
          ) : (
            <table style={table}>
              <thead>
                <tr>
                  <th style={th}>When</th>
                  <th style={th}>Status</th>
                  <th style={th}>Tenant</th>
                  <th style={th}>Realm</th>
                  <th style={th}>Attempts</th>
                  <th style={th}>Error</th>
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {qboRows.map((r) => (
                  <tr key={r.id}>
                    <td style={td}>{formatRelative(r.receivedAt)}</td>
                    <td style={td}>
                      <span style={statusBadge(r.status ?? '—')}>{r.status ?? '—'}</span>
                    </td>
                    <td style={td}>{r.tenantName ?? r.tenantId ?? '—'}</td>
                    <td style={{ ...td, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11 }}>
                      {r.realmId ?? '—'}
                    </td>
                    <td style={td}>{r.attempts ?? 0}</td>
                    <td style={{ ...td, color: r.error ? '#FCA5A5' : 'rgba(255,255,255,0.4)', maxWidth: 320 }} title={r.error ?? ''}>
                      {r.error ? (r.error.length > 80 ? r.error.slice(0, 80) + '…' : r.error) : '—'}
                    </td>
                    <td style={td}>
                      {r.status === 'FAILED' && (
                        <button
                          style={{ ...retryBtn, opacity: retrying === r.id ? 0.5 : 1 }}
                          disabled={retrying === r.id}
                          onClick={() => retry(r.id)}
                        >
                          {retrying === r.id ? '…' : 'Retry'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Stripe payment failures */}
      <div style={{ marginTop: 32 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#FFFFFF', marginBottom: 4 }}>Stripe payment failures</div>
        <div style={{ ...subtitle, marginTop: 2, marginBottom: 8 }}>
          Drawn from audit-log entries on Payment / Payout records.
        </div>
        <div style={tableWrap}>
          {stripeLoading && stripeRows.length === 0 ? (
            <div style={emptyState}>Loading…</div>
          ) : stripeError ? (
            <div style={emptyState}>Failed to load: {stripeError}</div>
          ) : stripeRows.length === 0 ? (
            <div style={emptyState}>No FAILED Stripe-related audit entries in the window.</div>
          ) : (
            <table style={table}>
              <thead>
                <tr>
                  <th style={th}>When</th>
                  <th style={th}>Tenant</th>
                  <th style={th}>Action</th>
                  <th style={th}>Record</th>
                </tr>
              </thead>
              <tbody>
                {stripeRows.map((r) => (
                  <tr key={r.id}>
                    <td style={td}>{formatRelative(r.occurredAt)}</td>
                    <td style={td}>{r.tenantName ?? r.tenantId ?? '—'}</td>
                    <td style={td}>{r.action ?? '—'}</td>
                    <td style={{ ...td, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11 }}>
                      {r.recordType ?? '—'}{r.recordId ? ` · ${r.recordId.slice(0, 12)}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};

export default Webhooks;
