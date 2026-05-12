import React, { useCallback, useEffect, useState } from 'react';

// A11 — Impersonation Log. Dedicated read of /api/admin/activity filtered
// to IMPERSONATION_STARTED + IMPERSONATION_ENDED rows. Surfaces the
// required reason (from detailsJson.reason) prominently so an audit
// reviewer can see *why* each session happened without expanding raw JSON.

interface ActivityRow {
  id: string;
  actorEmail: string | null;
  actorName: string | null;
  actorAdminRole: string | null;
  action: string;
  targetTenantId: string | null;
  targetTenant: { id: string; name: string; subdomain: string | null } | null;
  detailsJson: unknown;
  ipAddress: string | null;
  createdAt: string;
}

interface ApiResponse {
  items: ActivityRow[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

const page: React.CSSProperties = { padding: 0 };
const header: React.CSSProperties = { fontSize: 24, fontWeight: 700, color: '#FFFFFF', margin: 0, letterSpacing: '-0.01em' };
const subtitle: React.CSSProperties = { fontSize: 13, color: 'rgba(255,255,255,0.5)', marginTop: 6 };
const toolbar: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 20, marginBottom: 16 };
const input: React.CSSProperties = { padding: '7px 12px', fontSize: 13, background: '#070E18', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, color: '#FFFFFF', fontFamily: 'inherit' };
const card: React.CSSProperties = { background: '#0D1B2A', borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)', overflow: 'hidden' };
const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13 };
const th: React.CSSProperties = { textAlign: 'left', padding: '10px 14px', fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 0.6, borderBottom: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)' };
const td: React.CSSProperties = { padding: '12px 14px', color: 'rgba(255,255,255,0.7)', borderBottom: '1px solid rgba(255,255,255,0.04)', verticalAlign: 'top' };
const reasonCell: React.CSSProperties = { ...td, fontStyle: 'italic', color: 'rgba(255,255,255,0.85)', maxWidth: 420 };
const actionChip = (action: string): React.CSSProperties => {
  const tone =
    action === 'IMPERSONATION_STARTED' ? { background: 'rgba(250,204,21,0.15)', color: '#FDE68A' } :
                                         { background: 'rgba(148,163,184,0.15)', color: '#CBD5E1' };
  return { ...tone, display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700, letterSpacing: 0.4 };
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString();
}
function pullReason(details: unknown): string {
  if (!details || typeof details !== 'object') return '—';
  const r = (details as Record<string, unknown>).reason;
  return typeof r === 'string' ? r : '—';
}

const ImpersonationLog: React.FC = () => {
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [actorFilter, setActorFilter] = useState('');
  const [tenantFilter, setTenantFilter] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ action: 'IMPERSONATION_STARTED', limit: '100' });
      if (actorFilter.trim()) params.set('actor', actorFilter.trim());
      if (tenantFilter.trim()) params.set('tenantId', tenantFilter.trim());
      const res = await fetch(`/api/admin/activity?${params.toString()}`);
      if (!res.ok) throw new Error(`API ${res.status}`);
      const body: ApiResponse = await res.json();
      setRows(body.items ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [actorFilter, tenantFilter]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div style={page}>
      <h1 style={header}>Impersonation Log</h1>
      <div style={subtitle}>
        Every IMPERSONATION_STARTED event with the required reason inline. Sessions auto-expire after 1 hour;
        the staff-facing top-bar banner gives the impersonator an explicit End-Session button.
      </div>

      <div style={toolbar}>
        <input
          style={input}
          placeholder="Filter by actor (email / name)"
          value={actorFilter}
          onChange={(e) => setActorFilter(e.target.value)}
        />
        <input
          style={input}
          placeholder="Filter by tenant id"
          value={tenantFilter}
          onChange={(e) => setTenantFilter(e.target.value)}
        />
        <button
          style={{ padding: '7px 14px', fontSize: 12, fontWeight: 600, background: '#00D4FF', color: '#070E18', border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' }}
          onClick={() => void load()}
        >
          Refresh
        </button>
      </div>

      {error && (
        <div style={{ padding: 12, border: '1px solid rgba(244,67,54,0.4)', borderRadius: 6, color: '#FCA5A5', fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}

      <div style={card}>
        <table style={table}>
          <thead>
            <tr>
              <th style={th}>When</th>
              <th style={th}>Action</th>
              <th style={th}>Actor</th>
              <th style={th}>Target tenant</th>
              <th style={th}>Reason</th>
              <th style={th}>IP</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: 'rgba(255,255,255,0.4)' }}>
                No impersonation events match this filter.
              </td></tr>
            ) : rows.map((r) => (
              <tr key={r.id}>
                <td style={td}>{formatTime(r.createdAt)}</td>
                <td style={td}><span style={actionChip(r.action)}>{r.action}</span></td>
                <td style={td}>
                  <div style={{ color: '#FFFFFF' }}>{r.actorName ?? '—'}</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
                    {r.actorEmail ?? '—'}{r.actorAdminRole ? ` · ${r.actorAdminRole}` : ''}
                  </div>
                </td>
                <td style={td}>
                  {r.targetTenant ? (
                    <>
                      <div style={{ color: '#FFFFFF' }}>{r.targetTenant.name}</div>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>{r.targetTenant.subdomain ?? '—'}</div>
                    </>
                  ) : (
                    r.targetTenantId ?? '—'
                  )}
                </td>
                <td style={reasonCell}>{pullReason(r.detailsJson)}</td>
                <td style={{ ...td, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11 }}>
                  {r.ipAddress ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ImpersonationLog;
