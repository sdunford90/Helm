import React, { useState, useEffect, useCallback } from 'react';
import { Save, AlertTriangle } from 'lucide-react';
import { api } from '../../lib/api';
import { useModules } from '../../context/ModulesContext';

interface PostingAccountsResponse {
  locationId: string;
  qboConnected: boolean;
  accounts: {
    arGlAccountId: string | null;
    undepositedFundsGlAccountId: string | null;
    deferredRevenueGlAccountId: string | null;
    defaultRevenueGlAccountId: string | null;
    salesTaxGlAccountId: string | null;
    earlyTerminationGlAccountId: string | null;
    achReturnFeeGlAccountId: string | null;
    bankGlAccountId: string | null;
  };
  candidates: Array<{
    id: string;
    accountNumber: string;
    name: string;
    type: string;
    locationId: string | null;
    qboAccountId: string | null;
  }>;
}

type AccountsPayload = PostingAccountsResponse['accounts'];

const SLOTS = [
  { key: 'arGlAccountId' as const, label: 'Accounts Receivable (A/R)', types: null as string[] | null, required: false },
  { key: 'undepositedFundsGlAccountId' as const, label: 'Undeposited Funds', types: null, required: false },
  { key: 'deferredRevenueGlAccountId' as const, label: 'Deferred Revenue', types: ['LIABILITY'] as string[], required: false },
  { key: 'defaultRevenueGlAccountId' as const, label: 'Default Revenue', types: ['REVENUE'] as string[], required: true },
  { key: 'salesTaxGlAccountId' as const, label: 'Sales Tax Payable', types: ['LIABILITY'] as string[], required: true },
  { key: 'earlyTerminationGlAccountId' as const, label: 'Early Termination Income', types: ['REVENUE'] as string[], required: true },
  { key: 'achReturnFeeGlAccountId' as const, label: 'ACH Return Fee Revenue', types: ['REVENUE'] as string[], required: true },
  { key: 'bankGlAccountId' as const, label: 'Bank Account (Operating)', types: ['BANK', 'ASSET'] as string[], required: false },
] as const;

const stl = {
  card: { background: '#FFFFFF', borderRadius: '8px', border: '1px solid #E2E8F0', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', padding: '24px' } as React.CSSProperties,
  label: { fontSize: '12px', fontWeight: 600, color: '#475569' } as React.CSSProperties,
  select: { padding: '8px 10px', border: '1px solid #CBD5E1', borderRadius: '6px', fontSize: '13px', color: '#0A2342', width: '100%', background: '#FFFFFF' } as React.CSSProperties,
  saveBtn: { background: '#0A2342', color: '#FFFFFF', border: 'none', borderRadius: '6px', padding: '10px 20px', fontSize: '14px', fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px' } as React.CSSProperties,
  requiredBadge: { display: 'inline-block', padding: '1px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: 600, background: '#FEF3C7', color: '#92400E', marginLeft: '6px' } as React.CSSProperties,
};

export default function PostingAccountsPanel() {
  const { currentLocationId } = useModules();
  const [data, setData] = useState<PostingAccountsResponse | null>(null);
  const [form, setForm] = useState<AccountsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!currentLocationId) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const r = await api.get<PostingAccountsResponse>(
        `/api/settings/locations/${currentLocationId}/posting-accounts`,
      );
      setData(r);
      setForm({ ...r.accounts });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to load posting accounts';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [currentLocationId]);

  useEffect(() => { void load(); }, [load]);

  const handleSave = async () => {
    if (!currentLocationId || !form) return;
    setSaving(true);
    setSaveError(null);
    try {
      await api.put<PostingAccountsResponse>(
        `/api/settings/locations/${currentLocationId}/posting-accounts`,
        form,
      );
      await load();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Save failed';
      setSaveError(msg);
    } finally {
      setSaving(false);
    }
  };

  if (!currentLocationId) {
    return <div style={stl.card}><div style={{ color: '#64748B', fontSize: '14px' }}>Select a location to manage posting accounts.</div></div>;
  }

  if (loading) {
    return <div style={{ color: '#94A3B8', fontSize: '14px', padding: '24px' }}>Loading posting accounts…</div>;
  }

  if (error) {
    return (
      <div style={{ ...stl.card, border: '1px solid #FECACA', background: '#FEF2F2' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#B91C1C', fontSize: '14px' }}>
          <AlertTriangle size={16} /> {error}
        </div>
        <div style={{ marginTop: '12px', fontSize: '13px', color: '#64748B' }}>
          Make sure this location is connected to QuickBooks and chart of accounts has been synced.
        </div>
      </div>
    );
  }

  const candidates = data?.candidates ?? [];
  const hasCandidates = candidates.length > 0;

  const filteredCandidates = (types: string[] | null) => {
    if (!types || types.length === 0) return candidates;
    return candidates.filter((c) => types.includes(c.type));
  };

  const dirty = form && data ? JSON.stringify(form) !== JSON.stringify(data.accounts) : false;

  return (
    <div style={stl.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
        <div>
          <div style={{ fontSize: '16px', fontWeight: 700, color: '#0A2342' }}>Posting Accounts</div>
          <div style={{ fontSize: '13px', color: '#64748B', marginTop: '4px' }}>
            Map system accounts to GL accounts from the chart of accounts. These control where invoices, payments, and revenue post.
          </div>
        </div>
        {dirty && (
          <button style={stl.saveBtn} onClick={handleSave} disabled={saving}>
            <Save size={14} /> {saving ? 'Saving…' : 'Save Changes'}
          </button>
        )}
      </div>

      {!hasCandidates && (
        <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '6px', padding: '12px 16px', fontSize: '13px', color: '#92400E', marginBottom: '20px' }}>
          <strong>No GL accounts available.</strong> Connect QuickBooks and sync the chart of accounts to enable account mapping.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px' }}>
        {SLOTS.map(({ key, label, types, required }) => {
          const options = filteredCandidates(types ? [...types] : null);
          const currentVal = form?.[key] ?? '';

          return (
            <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={stl.label}>
                {label}
                {required && data?.qboConnected && <span style={stl.requiredBadge}>Required</span>}
              </label>
              <select
                style={stl.select}
                value={currentVal ?? ''}
                disabled={!hasCandidates || saving}
                onChange={(e) => {
                  const v = e.target.value === '' ? null : e.target.value;
                  setForm((prev) => prev ? { ...prev, [key]: v } : null);
                }}
              >
                <option value="">{required && data?.qboConnected ? '— Required: select an account —' : '— Use tenant default —'}</option>
                {options.length === 0 ? (
                  <option value="" disabled>No matching accounts in chart</option>
                ) : (
                  options.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.accountNumber} · {c.name}{c.qboAccountId ? ' · QBO' : ''}
                    </option>
                  ))
                )}
              </select>
              {required && data?.qboConnected && !currentVal && (
                <span style={{ fontSize: '11px', color: '#B45309', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <AlertTriangle size={11} /> Not mapped — required for QB sync
                </span>
              )}
            </div>
          );
        })}
      </div>

      {saveError && (
        <div style={{ marginTop: '12px', padding: '10px 14px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '6px', fontSize: '13px', color: '#B91C1C' }}>
          {saveError}
        </div>
      )}

      {dirty && (
        <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end' }}>
          <button style={stl.saveBtn} onClick={handleSave} disabled={saving}>
            <Save size={14} /> {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      )}
    </div>
  );
}
