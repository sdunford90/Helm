import React, { useCallback, useEffect, useState } from 'react';

// ---------------------------------------------------------------------------
// Platform queue dashboard (A5).
//
// Surfaces depth + 24-hour throughput + success rate for every BullMQ queue
// in the system. Pulls from /api/admin/health/system which already returns
// per-queue stats; here they get a focused table view instead of being
// buried in the Health page's grid. Auto-refresh every 30s.
// ---------------------------------------------------------------------------

const REFRESH_MS = 30_000;

interface QueueCounts {
  active?: number;
  waiting?: number;
  delayed?: number;
  failed?: number;
  paused?: number;
  completed?: number;
}

interface Queue {
  name: string;
  isPaused: boolean;
  counts: QueueCounts;
  jobs24h: {
    completed: number;
    failed: number;
    successRate: number;
    failedSparkline: number[];
    truncated: boolean;
  };
}

interface HealthSystemResponse {
  generatedAt: string;
  windowHours: number;
  queues: Queue[];
}

const page: React.CSSProperties = { padding: 0 };
const header: React.CSSProperties = { fontSize: 24, fontWeight: 700, color: '#FFFFFF', margin: 0, letterSpacing: '-0.01em' };
const subtitle: React.CSSProperties = { fontSize: 13, color: 'rgba(255,255,255,0.5)', marginTop: 6 };
const tableWrap: React.CSSProperties = { marginTop: 24, background: '#0D1B2A', borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)', overflow: 'hidden' };
const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13 };
const th: React.CSSProperties = { textAlign: 'left', padding: '10px 14px', fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 0.6, borderBottom: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)' };
const td: React.CSSProperties = { padding: '12px 14px', color: 'rgba(255,255,255,0.7)', borderBottom: '1px solid rgba(255,255,255,0.04)' };
const tdRight: React.CSSProperties = { textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
const sparkBar: React.CSSProperties = { display: 'inline-block', width: 3, marginRight: 1, background: '#F87171', verticalAlign: 'bottom', borderRadius: 1 };

function pctLabel(rate: number): string { return `${Math.round(rate * 100)}%`; }
function rateColor(rate: number): string {
  if (rate >= 0.99) return '#22C55E';
  if (rate >= 0.95) return '#FACC15';
  return '#F87171';
}
function depthColor(depth: number, failed: number): string {
  if (failed > 0) return '#FCA5A5';
  if (depth > 100) return '#FACC15';
  return 'rgba(255,255,255,0.85)';
}

function pauseBadge(isPaused: boolean): React.CSSProperties {
  return isPaused
    ? { display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700, background: 'rgba(250,204,21,0.18)', color: '#FDE68A' }
    : { display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700, background: 'rgba(34,197,94,0.15)', color: '#86EFAC' };
}

function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  return (
    <div style={{ display: 'inline-flex', alignItems: 'flex-end', height: 18 }}>
      {values.map((v, i) => (
        <div key={i} style={{ ...sparkBar, height: `${Math.max(1, (v / max) * 18)}px`, opacity: v === 0 ? 0.25 : 1 }} />
      ))}
    </div>
  );
}

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text().catch(() => res.statusText)}`);
  return res.json() as Promise<T>;
}

const Queues: React.FC = () => {
  const [data, setData] = useState<HealthSystemResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<HealthSystemResponse>('/api/admin/health/system');
      setData(res);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  const queues = data?.queues ?? [];

  return (
    <div style={page}>
      <h1 style={header}>Queues</h1>
      <div style={subtitle}>
        BullMQ workers — current depth, 24-hour throughput, and recent failure rate. Failed jobs
        link through to the Health page's drilldown for stack traces.
      </div>

      {error && (
        <div style={{ marginTop: 16, padding: 14, border: '1px solid rgba(244,67,54,0.4)', borderRadius: 8, color: '#FCA5A5', fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={tableWrap}>
        {!data ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>Loading…</div>
        ) : queues.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>No queues registered.</div>
        ) : (
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Queue</th>
                <th style={th}>State</th>
                <th style={{ ...th, ...tdRight }}>Waiting</th>
                <th style={{ ...th, ...tdRight }}>Active</th>
                <th style={{ ...th, ...tdRight }}>Delayed</th>
                <th style={{ ...th, ...tdRight }}>Failed</th>
                <th style={{ ...th, ...tdRight }}>24h ok</th>
                <th style={{ ...th, ...tdRight }}>24h failed</th>
                <th style={{ ...th, ...tdRight }}>Success rate</th>
                <th style={th}>Failures (24h)</th>
              </tr>
            </thead>
            <tbody>
              {queues.map((q) => {
                const depth = (q.counts.waiting ?? 0) + (q.counts.active ?? 0) + (q.counts.delayed ?? 0);
                return (
                  <tr key={q.name}>
                    <td style={{ ...td, fontWeight: 600, color: '#FFFFFF' }}>{q.name}</td>
                    <td style={td}>
                      <span style={pauseBadge(q.isPaused)}>{q.isPaused ? 'paused' : 'running'}</span>
                    </td>
                    <td style={{ ...td, ...tdRight, color: depthColor(depth, q.counts.failed ?? 0) }}>{(q.counts.waiting ?? 0).toLocaleString()}</td>
                    <td style={{ ...td, ...tdRight }}>{(q.counts.active ?? 0).toLocaleString()}</td>
                    <td style={{ ...td, ...tdRight }}>{(q.counts.delayed ?? 0).toLocaleString()}</td>
                    <td style={{ ...td, ...tdRight, color: (q.counts.failed ?? 0) > 0 ? '#FCA5A5' : 'rgba(255,255,255,0.4)' }}>
                      {(q.counts.failed ?? 0).toLocaleString()}
                    </td>
                    <td style={{ ...td, ...tdRight }}>{q.jobs24h.completed.toLocaleString()}</td>
                    <td style={{ ...td, ...tdRight, color: q.jobs24h.failed > 0 ? '#FCA5A5' : 'rgba(255,255,255,0.4)' }}>
                      {q.jobs24h.failed.toLocaleString()}
                    </td>
                    <td style={{ ...td, ...tdRight, color: rateColor(q.jobs24h.successRate), fontWeight: 700 }}>
                      {pctLabel(q.jobs24h.successRate)}
                    </td>
                    <td style={td}>
                      <Sparkline values={q.jobs24h.failedSparkline} />
                      {q.jobs24h.truncated && <span style={{ marginLeft: 6, fontSize: 10, color: '#FACC15' }}>truncated</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ marginTop: 16, fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
        Auto-refresh every {REFRESH_MS / 1000}s. Stats window: last 24h.
      </div>
    </div>
  );
};

export default Queues;
