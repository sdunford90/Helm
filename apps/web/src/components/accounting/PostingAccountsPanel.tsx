import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Save, AlertTriangle, CheckCircle2 } from 'lucide-react';
import {
  POSTING_ACCOUNT_GROUPS,
  POSTING_ACCOUNT_SPECS,
  type GlPinGroup,
  type PostingAccountSpec,
} from '@helm/shared-types';
import { api } from '../../lib/api';
import { useModules } from '../../context/ModulesContext';

// Plan 94 — Posting accounts panel, spec-driven.
//
// Each pin's dropdown is pre-filtered to accounts whose QBO subType matches
// the pin's purpose (AR shows only AccountsReceivable rows, Tips shows only
// OtherCurrentLiabilities, etc.). When exactly one account matches a pin's
// filter and the operator hasn't picked anything else, we surface it as a
// suggestion they can confirm in one click.

interface Candidate {
  id: string;
  accountNumber: string;
  name: string;
  type: string;
  subType: string | null;
  locationId: string | null;
  qboAccountId: string | null;
}

interface PostingAccountsResponse {
  locationId: string;
  qboConnected: boolean;
  accounts: Record<string, string | null>;
  specs: PostingAccountSpec[];
  candidatesByField: Record<string, Candidate[]>;
}

const stl = {
  pageCard: {
    background: '#FFFFFF', borderRadius: 10, border: '1px solid #E2E8F0',
    boxShadow: '0 1px 3px rgba(0,0,0,0.05)', padding: 20, marginBottom: 16,
  } as React.CSSProperties,
  groupHeader: {
    fontSize: 12, fontWeight: 700, color: '#475569',
    textTransform: 'uppercase', letterSpacing: '0.06em',
    margin: '4px 0 12px',
  } as React.CSSProperties,
  row: {
    display: 'grid', gridTemplateColumns: '240px 1fr 24px',
    gap: 12, alignItems: 'center', padding: '10px 0',
    borderBottom: '1px solid #F1F5F9',
  } as React.CSSProperties,
  rowLabel: { fontSize: 13, fontWeight: 600, color: '#0A2342' } as React.CSSProperties,
  rowHint: { fontSize: 11, color: '#94A3B8', marginTop: 2 } as React.CSSProperties,
  select: {
    padding: '8px 10px', border: '1px solid #CBD5E1', borderRadius: 6,
    fontSize: 13, color: '#0A2342', width: '100%', background: '#FFFFFF',
  } as React.CSSProperties,
  requiredBadge: {
    display: 'inline-block', padding: '1px 6px', borderRadius: 4,
    fontSize: 10, fontWeight: 700, background: '#FEF3C7', color: '#92400E', marginLeft: 6,
  } as React.CSSProperties,
  filledBadge: {
    color: '#166534', marginLeft: 6, fontSize: 14,
  } as React.CSSProperties,
  noMatch: {
    fontSize: 11, color: '#9A3412', marginTop: 4,
    fontStyle: 'italic',
  } as React.CSSProperties,
  saveBtn: {
    background: '#0A2342', color: '#FFFFFF', border: 'none', borderRadius: 6,
    padding: '10px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
    display: 'inline-flex', alignItems: 'center', gap: 6,
  } as React.CSSProperties,
};

export default function PostingAccountsPanel() {
  const { currentLocationId } = useModules();
  const [data, setData] = useState<PostingAccountsResponse | null>(null);
  const [draft, setDraft] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  const load = useCallback(async () => {
    if (!currentLocationId) {
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const r = await api.get<PostingAccountsResponse>(
        `/api/settings/locations/${currentLocationId}/posting-accounts`,
      );
      setData(r);
      setDraft({ ...r.accounts });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [currentLocationId]);

  useEffect(() => { void load(); }, [load]);

  const grouped = useMemo(() => {
    if (!data) return null;
    const map = new Map<GlPinGroup, PostingAccountSpec[]>();
    for (const spec of POSTING_ACCOUNT_SPECS) {
      if (!map.has(spec.group)) map.set(spec.group, []);
      map.get(spec.group)!.push(spec);
    }
    return map;
  }, [data]);

  const handleSave = async () => {
    if (!currentLocationId || !data) return;
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, string | null> = {};
      for (const spec of POSTING_ACCOUNT_SPECS) {
        const current = data.accounts[spec.field] ?? null;
        const next = draft[spec.field] ?? null;
        if (current !== next) body[spec.field] = next;
      }
      if (Object.keys(body).length === 0) {
        setSavedFlash(true);
        setTimeout(() => setSavedFlash(false), 1500);
        return;
      }
      await api.put<PostingAccountsResponse>(
        `/api/settings/locations/${currentLocationId}/posting-accounts`,
        body,
      );
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (!currentLocationId) {
    return (
      <div style={stl.pageCard}>
        <div style={{ color: '#64748B' }}>Pick a location to configure posting accounts.</div>
      </div>
    );
  }
  if (loading && !data) {
    return <div style={stl.pageCard}><div style={{ color: '#64748B' }}>Loading…</div></div>;
  }
  if (!data) return null;

  const requiredMissing = POSTING_ACCOUNT_SPECS
    .filter((s) => s.required && !draft[s.field])
    .length;

  return (
    <div>
      <div style={stl.pageCard}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#0A2342' }}>Posting accounts</div>
            <div style={{ fontSize: 12, color: '#64748B', marginTop: 4 }}>
              {data.qboConnected ? 'QBO-connected location.' : 'Manual chart.'} Dropdowns are filtered to accounts whose QBO subType matches each pin.
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {requiredMissing > 0 && (
              <span style={{ fontSize: 12, color: '#9A3412', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <AlertTriangle size={14} />
                {requiredMissing} required pin{requiredMissing === 1 ? '' : 's'} missing
              </span>
            )}
            {savedFlash && (
              <span style={{ fontSize: 12, color: '#166534', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <CheckCircle2 size={14} /> Saved
              </span>
            )}
            <button style={stl.saveBtn} onClick={handleSave} disabled={saving}>
              <Save size={14} />
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
        {error && (
          <div style={{ marginTop: 12, padding: 10, background: '#FEE2E2', color: '#991B1B', borderRadius: 6, fontSize: 12 }}>
            {error}
          </div>
        )}
      </div>

      {POSTING_ACCOUNT_GROUPS.map((group) => {
        const specs = grouped?.get(group);
        if (!specs || specs.length === 0) return null;
        return (
          <div key={group} style={stl.pageCard}>
            <div style={stl.groupHeader}>{group}</div>
            {specs.map((spec) => {
              const candidates = data.candidatesByField[spec.field] ?? [];
              const value = draft[spec.field] ?? '';
              const noMatch = candidates.length === 0;
              const filled = Boolean(value);
              return (
                <div key={spec.field} style={stl.row}>
                  <div>
                    <div style={stl.rowLabel}>
                      {spec.label}
                      {spec.required && <span style={stl.requiredBadge}>required</span>}
                      {filled && <CheckCircle2 size={14} style={stl.filledBadge as React.CSSProperties} />}
                    </div>
                    {spec.description && <div style={stl.rowHint}>{spec.description}</div>}
                  </div>
                  <div>
                    <select
                      style={stl.select}
                      value={value}
                      onChange={(e) => setDraft((d) => ({ ...d, [spec.field]: e.target.value || null }))}
                      disabled={noMatch}
                    >
                      <option value="">
                        {noMatch
                          ? `No matching accounts in chart (subType: ${spec.subType.join(', ')})`
                          : `— Select — (${candidates.length} match${candidates.length === 1 ? '' : 'es'})`}
                      </option>
                      {candidates.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.accountNumber} · {c.name}
                          {c.subType ? ` (${c.subType})` : ''}
                        </option>
                      ))}
                    </select>
                    {noMatch && (
                      <div style={stl.noMatch}>
                        Add an account with subType <code>{spec.subType.join(' / ')}</code> in QuickBooks, then sync your chart.
                      </div>
                    )}
                  </div>
                  <div />
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
