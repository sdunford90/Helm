import React, { useEffect, useState } from 'react';
import { Send } from 'lucide-react';
import { useApiFetch } from '../lib/api';

// Plan 52 — Tenant-targeted platform broadcast.
//
// Distinct from /announcements (which writes PlatformAnnouncement banners).
// This page fans out one-shot in-bell notifications to selected tenants'
// staff. Useful for "Hey, your QBO sync was down today, here's what was
// affected" rather than persistent banners.

interface Tenant { id: string; name: string; saasTier?: { id: string; name: string } | null; }
interface Tier { id: string; name: string; }

const page: React.CSSProperties = { padding: 0 };
const header: React.CSSProperties = { fontSize: 24, fontWeight: 700, color: '#FFFFFF', margin: 0, letterSpacing: '-0.01em' };
const subtitle: React.CSSProperties = { fontSize: 13, color: 'rgba(255,255,255,0.5)', marginTop: 6 };
const card: React.CSSProperties = { background: '#0D1B2A', borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)', padding: 20, marginTop: 24 };
const label: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6, display: 'block' };
const input: React.CSSProperties = { width: '100%', padding: '9px 12px', fontSize: 13, background: '#070E18', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, color: '#FFFFFF', fontFamily: 'inherit', boxSizing: 'border-box' };
const btnPrimary: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 18px', fontSize: 13, fontWeight: 700, color: '#070E18', background: '#00D4FF', border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' };

export default function TenantBroadcast() {
  const api = useApiFetch();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [selectedTenants, setSelectedTenants] = useState<Set<string>>(new Set());
  const [selectedTiers, setSelectedTiers] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [audienceRole, setAudienceRole] = useState<'ALL' | 'MARINA_OWNER' | 'TENANT_ADMIN' | 'ACCOUNTING'>('ALL');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<{ tenants: Tenant[] }>('/api/admin/tenants').then((d) => setTenants(d.tenants ?? []));
    void api<{ tiers: Tier[] }>('/api/admin/saas-tiers').then((d) => setTiers(d.tiers ?? [])).catch(() => { /* tiers list optional */ });
  }, [api]);

  const toggleTenant = (id: string) => {
    setSelectedTenants((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleTier = (id: string) => {
    setSelectedTiers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const send = async () => {
    if (!title.trim()) {
      setError('Title is required');
      return;
    }
    if (selectedTenants.size === 0 && selectedTiers.size === 0) {
      setError('Select at least one tenant or tier');
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await api<{ recipientCount: number; tenantIds: string[] }>(
        '/api/admin/tenant-broadcasts',
        {
          method: 'POST',
          body: JSON.stringify({
            tenantIds: Array.from(selectedTenants),
            tierIds: Array.from(selectedTiers),
            title: title.trim(),
            body: body.trim() || undefined,
            linkUrl: linkUrl.trim() || undefined,
            audienceRole,
          }),
        },
      );
      setResult(`Sent to ${r.recipientCount} user${r.recipientCount === 1 ? '' : 's'} across ${r.tenantIds.length} tenant${r.tenantIds.length === 1 ? '' : 's'}.`);
      setTitle('');
      setBody('');
      setLinkUrl('');
      setSelectedTenants(new Set());
      setSelectedTiers(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={page}>
      <h1 style={header}>Tenant Broadcast</h1>
      <div style={subtitle}>
        Push a one-shot notification to every staff member at the selected tenants. Lands in the bell, not as a banner.
        For persistent global announcements, use the Announcements page instead.
      </div>

      <div style={card}>
        <label style={label}>Title (required)</label>
        <input
          style={input}
          value={title}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="QBO sync restored — please verify last 24h"
        />
      </div>

      <div style={card}>
        <label style={label}>Body</label>
        <textarea
          style={{ ...input, height: 100, resize: 'vertical' as const, fontFamily: 'inherit' }}
          value={body}
          maxLength={2000}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Optional details. Plain text only."
        />
      </div>

      <div style={card}>
        <label style={label}>Link URL (optional)</label>
        <input
          style={input}
          value={linkUrl}
          maxLength={500}
          onChange={(e) => setLinkUrl(e.target.value)}
          placeholder="https://… (where the bell click should go)"
        />
      </div>

      <div style={card}>
        <label style={label}>Audience role</label>
        <select
          style={input}
          value={audienceRole}
          onChange={(e) => setAudienceRole(e.target.value as typeof audienceRole)}
        >
          <option value="ALL">Every active staff member</option>
          <option value="MARINA_OWNER">Marina owners only</option>
          <option value="TENANT_ADMIN">Tenant admins only</option>
          <option value="ACCOUNTING">Accounting role only</option>
        </select>
      </div>

      {tiers.length > 0 && (
        <div style={card}>
          <label style={label}>Tiers ({selectedTiers.size} selected)</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {tiers.map((t) => {
              const on = selectedTiers.has(t.id);
              return (
                <button
                  key={t.id}
                  onClick={() => toggleTier(t.id)}
                  style={{
                    padding: '6px 12px', fontSize: 12, fontWeight: 600,
                    borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
                    background: on ? '#00D4FF' : 'transparent',
                    color: on ? '#070E18' : 'rgba(255,255,255,0.7)',
                    border: on ? '1px solid #00D4FF' : '1px solid rgba(255,255,255,0.15)',
                  }}
                >
                  {t.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div style={card}>
        <label style={label}>Tenants ({selectedTenants.size} selected of {tenants.length})</label>
        <div style={{ maxHeight: 300, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {tenants.map((t) => {
            const on = selectedTenants.has(t.id);
            return (
              <label
                key={t.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '6px 10px', borderRadius: 6, cursor: 'pointer',
                  background: on ? 'rgba(0,212,255,0.10)' : 'transparent',
                  fontSize: 13, color: 'rgba(255,255,255,0.85)',
                }}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggleTenant(t.id)}
                  style={{ margin: 0 }}
                />
                <span style={{ flex: 1 }}>{t.name}</span>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
                  {t.saasTier?.name ?? '— no tier —'}
                </span>
              </label>
            );
          })}
        </div>
      </div>

      <div style={{ marginTop: 20, display: 'flex', gap: 12, alignItems: 'center' }}>
        <button style={btnPrimary} onClick={send} disabled={busy}>
          <Send size={14} />
          {busy ? 'Sending…' : 'Send broadcast'}
        </button>
        {result && <span style={{ color: '#4CAF50', fontSize: 13 }}>{result}</span>}
        {error && <span style={{ color: '#F44336', fontSize: 13 }}>{error}</span>}
      </div>
    </div>
  );
}
