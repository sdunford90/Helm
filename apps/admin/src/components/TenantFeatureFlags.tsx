import React, { useCallback, useEffect, useState } from 'react';
import { useApiFetch } from '../lib/api';

// A6 — Per-tenant feature-flag editor. Renders as a tab inside TenantDetail.
// Loads the resolved flag set from /api/admin/tenants/:id/feature-flags,
// PUTs a toggle to override the default, DELETEs the row to revert.

interface ResolvedFlag {
  key: string;
  label: string;
  description: string;
  category: 'Reporting' | 'Communications' | 'Beta' | 'Billing' | 'Ops';
  defaultEnabled: boolean;
  enabled: boolean;
  hasOverride: boolean;
  overrideReason: string | null;
  overrideUpdatedAt: string | null;
  overrideUpdatedBy: string | null;
}

const card: React.CSSProperties = { background: '#0D1B2A', borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)', overflow: 'hidden', marginBottom: 16 };
const categoryHead: React.CSSProperties = { padding: '10px 16px', fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 0.6, background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid rgba(255,255,255,0.06)' };
const row: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 80px 110px', gap: 14, padding: '14px 16px', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.04)' };
const label: React.CSSProperties = { color: '#FFFFFF', fontSize: 14, fontWeight: 600 };
const desc: React.CSSProperties = { color: 'rgba(255,255,255,0.55)', fontSize: 12, marginTop: 4, lineHeight: 1.45 };
const overrideMeta: React.CSSProperties = { fontSize: 11, color: '#FCA5A5', marginTop: 4 };
const keyMono: React.CSSProperties = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 10, color: 'rgba(255,255,255,0.35)' };
const toggleBox: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'center' };
const enabledChip = (on: boolean): React.CSSProperties => ({
  display: 'inline-block', padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, letterSpacing: 0.4,
  ...(on ? { background: 'rgba(34,197,94,0.18)', color: '#86EFAC' } : { background: 'rgba(148,163,184,0.15)', color: 'rgba(255,255,255,0.55)' }),
});
const btnGhost: React.CSSProperties = { padding: '5px 10px', fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.7)', background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' };

interface Props {
  tenantId: string;
}

const TenantFeatureFlags: React.FC<Props> = ({ tenantId }) => {
  const apiFetch = useApiFetch();
  const [flags, setFlags] = useState<ResolvedFlag[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const body = await apiFetch<{ flags: ResolvedFlag[] }>(`/api/admin/tenants/${tenantId}/feature-flags`);
      setFlags(body.flags ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [apiFetch, tenantId]);

  useEffect(() => { void load(); }, [load]);

  async function toggle(f: ResolvedFlag, nextEnabled: boolean) {
    setPendingKey(f.key);
    try {
      const reasonMaybe = window.prompt(
        `Set "${f.label}" to ${nextEnabled ? 'ON' : 'OFF'} for this tenant.\n\n` +
        `Optional: reason for the change (shown in the audit log).`,
        '',
      );
      // window.prompt returns null when the user hits Cancel — bail.
      if (reasonMaybe === null) {
        setPendingKey(null);
        return;
      }
      await apiFetch(`/api/admin/tenants/${tenantId}/feature-flags/${encodeURIComponent(f.key)}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled: nextEnabled, reason: reasonMaybe.trim() || null }),
      });
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingKey(null);
    }
  }

  async function clearOverride(f: ResolvedFlag) {
    if (!confirm(`Revert "${f.label}" to its default (${f.defaultEnabled ? 'ON' : 'OFF'})?`)) return;
    setPendingKey(f.key);
    try {
      await apiFetch(`/api/admin/tenants/${tenantId}/feature-flags/${encodeURIComponent(f.key)}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingKey(null);
    }
  }

  if (error) {
    return (
      <div style={{ padding: 12, border: '1px solid rgba(244,67,54,0.4)', borderRadius: 6, color: '#FCA5A5', fontSize: 13 }}>
        {error}
      </div>
    );
  }

  // Group by category.
  const byCategory = new Map<string, ResolvedFlag[]>();
  for (const f of flags) {
    const arr = byCategory.get(f.category) ?? [];
    arr.push(f);
    byCategory.set(f.category, arr);
  }

  const overrideCount = flags.filter((f) => f.hasOverride).length;

  return (
    <div>
      <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', marginBottom: 16 }}>
        Per-tenant overrides for experimental features. Defaults live in code; this page records explicit on/off
        decisions for one tenant. Currently overridden: <strong style={{ color: '#FFFFFF' }}>{overrideCount}</strong> of{' '}
        <strong style={{ color: '#FFFFFF' }}>{flags.length}</strong>.
      </div>

      {Array.from(byCategory.entries()).map(([cat, list]) => (
        <div key={cat} style={card}>
          <div style={categoryHead}>{cat}</div>
          {list.map((f) => (
            <div key={f.key} style={row}>
              <div>
                <div style={label}>{f.label}</div>
                <div style={desc}>{f.description}</div>
                <div style={keyMono}>{f.key}{!f.hasOverride && ` · default ${f.defaultEnabled ? 'ON' : 'OFF'}`}</div>
                {f.hasOverride && (
                  <div style={overrideMeta}>
                    Overridden{f.overrideReason ? ` — "${f.overrideReason}"` : ''}
                    {f.overrideUpdatedAt && ` · ${new Date(f.overrideUpdatedAt).toLocaleString()}`}
                  </div>
                )}
              </div>
              <div style={toggleBox}>
                <span style={enabledChip(f.enabled)}>{f.enabled ? 'ON' : 'OFF'}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <button
                  style={{ ...btnGhost, opacity: pendingKey === f.key ? 0.5 : 1 }}
                  disabled={pendingKey === f.key}
                  onClick={() => toggle(f, !f.enabled)}
                >
                  {f.enabled ? 'Disable' : 'Enable'}
                </button>
                {f.hasOverride && (
                  <button
                    style={{ ...btnGhost, color: '#94A3B8' }}
                    disabled={pendingKey === f.key}
                    onClick={() => clearOverride(f)}
                  >
                    Revert
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};

export default TenantFeatureFlags;
