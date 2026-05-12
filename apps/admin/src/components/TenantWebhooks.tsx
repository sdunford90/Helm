import React, { useCallback, useEffect, useState } from 'react';
import { useApiFetch } from '../lib/api';

// A8 — Tenant outbound webhook destinations. Per-tenant CRUD + delivery log
// reader. Rendered as a tab inside TenantDetail.

interface Destination {
  id: string;
  tenantId: string;
  name: string;
  url: string;
  signingSecret: string;
  events: string[];
  enabled: boolean;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  consecutiveFailures: number;
  disabledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Delivery {
  id: string;
  event: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILED' | string;
  httpStatus: number | null;
  responseSnippet: string | null;
  attempts: number;
  nextRetryAt: string | null;
  createdAt: string;
  deliveredAt: string | null;
}

const card: React.CSSProperties = { background: '#0D1B2A', borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)', padding: 18, marginBottom: 14 };
const label: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6, display: 'block' };
const input: React.CSSProperties = { width: '100%', padding: '8px 12px', fontSize: 13, background: '#070E18', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, color: '#FFFFFF', fontFamily: 'inherit', boxSizing: 'border-box' };
const btnPrimary: React.CSSProperties = { padding: '8px 16px', fontSize: 13, fontWeight: 700, color: '#070E18', background: '#00D4FF', border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' };
const btnGhost: React.CSSProperties = { padding: '7px 14px', fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.7)', background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' };
const btnDanger: React.CSSProperties = { ...btnGhost, color: '#FCA5A5', borderColor: 'rgba(248,113,113,0.4)' };
const statusChip = (s: string): React.CSSProperties => ({
  display: 'inline-block', padding: '1px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
  ...(s === 'SUCCESS' ? { background: 'rgba(34,197,94,0.15)', color: '#86EFAC' } :
      s === 'FAILED' ? { background: 'rgba(248,113,113,0.15)', color: '#FCA5A5' } :
      { background: 'rgba(250,204,21,0.15)', color: '#FDE68A' }),
});

interface Props { tenantId: string; }

const TenantWebhooks: React.FC<Props> = ({ tenantId }) => {
  const apiFetch = useApiFetch();
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [events, setEvents] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [newEvents, setNewEvents] = useState<Set<string>>(new Set());
  const [expandedSecret, setExpandedSecret] = useState<string | null>(null);
  const [deliveriesFor, setDeliveriesFor] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);

  const load = useCallback(async () => {
    try {
      const [destBody, evBody] = await Promise.all([
        apiFetch<{ destinations: Destination[] }>(`/api/admin/tenants/${tenantId}/webhooks`),
        apiFetch<{ events: string[] }>(`/api/admin/webhooks/events`),
      ]);
      setDestinations(destBody.destinations ?? []);
      setEvents(evBody.events ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [apiFetch, tenantId]);

  useEffect(() => { void load(); }, [load]);

  async function create() {
    if (!newName.trim() || !newUrl.trim() || newEvents.size === 0) return;
    try {
      await apiFetch(`/api/admin/tenants/${tenantId}/webhooks`, {
        method: 'POST',
        body: JSON.stringify({ name: newName.trim(), url: newUrl.trim(), events: Array.from(newEvents) }),
      });
      setNewName(''); setNewUrl(''); setNewEvents(new Set()); setAdding(false);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  }

  async function toggleEnabled(d: Destination) {
    try {
      await apiFetch(`/api/admin/tenants/${tenantId}/webhooks/${d.id}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled: !d.enabled }),
      });
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  }

  async function remove(d: Destination) {
    if (!confirm(`Delete destination "${d.name}"? This stops all future deliveries to ${d.url}.`)) return;
    try {
      await apiFetch(`/api/admin/tenants/${tenantId}/webhooks/${d.id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  }

  async function openDeliveries(id: string) {
    if (deliveriesFor === id) {
      setDeliveriesFor(null);
      return;
    }
    setDeliveriesFor(id);
    try {
      const body = await apiFetch<{ deliveries: Delivery[] }>(`/api/admin/tenants/${tenantId}/webhooks/${id}/deliveries`);
      setDeliveries(body.deliveries ?? []);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
      setDeliveriesFor(null);
    }
  }

  return (
    <div>
      <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', marginBottom: 16 }}>
        Outbound destinations the tenant has subscribed to. Every dispatched event is signed with
        the destination&apos;s HMAC secret. Auto-disabled after 25 consecutive failures; re-enabling
        resets the counter.
      </div>

      {error && (
        <div style={{ padding: 12, border: '1px solid rgba(244,67,54,0.4)', borderRadius: 6, color: '#FCA5A5', fontSize: 13, marginBottom: 12 }}>
          {error}
        </div>
      )}

      {!adding ? (
        <button style={btnPrimary} onClick={() => setAdding(true)}>+ Add destination</button>
      ) : (
        <div style={card}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#FFFFFF', marginBottom: 12 }}>New destination</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12, marginBottom: 12 }}>
            <div><label style={label}>Name</label><input style={input} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="My ERP" /></div>
            <div><label style={label}>URL</label><input style={input} value={newUrl} onChange={(e) => setNewUrl(e.target.value)} placeholder="https://example.com/helm-webhook" /></div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={label}>Events to subscribe to</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {events.map((ev) => {
                const on = newEvents.has(ev);
                return (
                  <button
                    key={ev}
                    type="button"
                    onClick={() => setNewEvents((prev) => {
                      const next = new Set(prev);
                      if (next.has(ev)) next.delete(ev); else next.add(ev);
                      return next;
                    })}
                    style={{
                      padding: '4px 10px', borderRadius: 999, fontSize: 11, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                      border: on ? '1px solid #00D4FF' : '1px solid rgba(255,255,255,0.12)',
                      background: on ? 'rgba(0,212,255,0.15)' : 'transparent',
                      color: on ? '#FFFFFF' : 'rgba(255,255,255,0.55)',
                      cursor: 'pointer',
                    }}
                  >
                    {ev}
                  </button>
                );
              })}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={{ ...btnPrimary, opacity: !newName.trim() || !newUrl.trim() || newEvents.size === 0 ? 0.4 : 1 }} disabled={!newName.trim() || !newUrl.trim() || newEvents.size === 0} onClick={create}>Create</button>
            <button style={btnGhost} onClick={() => { setAdding(false); setNewName(''); setNewUrl(''); setNewEvents(new Set()); }}>Cancel</button>
          </div>
        </div>
      )}

      {destinations.length === 0 ? (
        <div style={{ ...card, textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>
          No destinations configured. Add one above to start delivering events.
        </div>
      ) : destinations.map((d) => (
        <div key={d.id} style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 10 }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: '#FFFFFF' }}>{d.name}</span>
                <span style={statusChip(d.enabled ? 'SUCCESS' : 'FAILED')}>{d.enabled ? 'ENABLED' : 'DISABLED'}</span>
                {d.consecutiveFailures > 0 && (
                  <span style={{ fontSize: 11, color: '#FCA5A5' }}>{d.consecutiveFailures} consecutive failures</span>
                )}
              </div>
              <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11, color: 'rgba(255,255,255,0.55)', marginTop: 4 }}>{d.url}</div>
              <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {d.events.map((e) => <span key={e} style={{ padding: '1px 6px', borderRadius: 4, background: 'rgba(255,255,255,0.05)', fontSize: 10, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: 'rgba(255,255,255,0.6)' }}>{e}</span>)}
              </div>
              {expandedSecret === d.id && (
                <div style={{ marginTop: 8, padding: 8, borderRadius: 6, background: '#070E18', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11, color: 'rgba(255,255,255,0.7)', wordBreak: 'break-all' }}>
                  {d.signingSecret}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              <button style={btnGhost} onClick={() => setExpandedSecret((cur) => cur === d.id ? null : d.id)}>
                {expandedSecret === d.id ? 'Hide secret' : 'Show secret'}
              </button>
              <button style={btnGhost} onClick={() => openDeliveries(d.id)}>
                {deliveriesFor === d.id ? 'Close deliveries' : 'View deliveries'}
              </button>
              <button style={btnGhost} onClick={() => toggleEnabled(d)}>
                {d.enabled ? 'Disable' : 'Enable'}
              </button>
              <button style={btnDanger} onClick={() => remove(d)}>Delete</button>
            </div>
          </div>

          {deliveriesFor === d.id && (
            <div style={{ marginTop: 10, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 10 }}>
              {deliveries.length === 0 ? (
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', fontStyle: 'italic' }}>No deliveries yet.</div>
              ) : (
                <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left', padding: '6px 8px', fontSize: 10, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 0.6 }}>When</th>
                      <th style={{ textAlign: 'left', padding: '6px 8px', fontSize: 10, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 0.6 }}>Event</th>
                      <th style={{ textAlign: 'left', padding: '6px 8px', fontSize: 10, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 0.6 }}>Status</th>
                      <th style={{ textAlign: 'left', padding: '6px 8px', fontSize: 10, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 0.6 }}>HTTP</th>
                      <th style={{ textAlign: 'left', padding: '6px 8px', fontSize: 10, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 0.6 }}>Response</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deliveries.map((dl) => (
                      <tr key={dl.id}>
                        <td style={{ padding: '6px 8px', color: 'rgba(255,255,255,0.7)' }}>{new Date(dl.createdAt).toLocaleString()}</td>
                        <td style={{ padding: '6px 8px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: 'rgba(255,255,255,0.7)' }}>{dl.event}</td>
                        <td style={{ padding: '6px 8px' }}><span style={statusChip(dl.status)}>{dl.status}</span></td>
                        <td style={{ padding: '6px 8px', color: 'rgba(255,255,255,0.7)' }}>{dl.httpStatus ?? '—'}</td>
                        <td style={{ padding: '6px 8px', color: 'rgba(255,255,255,0.55)', maxWidth: 380, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={dl.responseSnippet ?? ''}>
                          {dl.responseSnippet ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

export default TenantWebhooks;
