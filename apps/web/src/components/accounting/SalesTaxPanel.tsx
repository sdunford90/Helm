import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, ChevronDown, ChevronRight, AlertTriangle, Loader2 } from 'lucide-react';
import { api } from '../../lib/api';

interface GlAccount {
  id: string;
  accountNumber: string;
  name: string;
  type: string;
  qboAccountId: string | null;
}

interface TaxRate {
  id: string;
  category: string;
  ratePctBps: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  glAccountId: string | null;
}

interface Jurisdiction {
  id: string;
  code: string;
  name: string;
  kind: 'STATE' | 'COUNTY' | 'CITY' | 'SPECIAL';
  rates: TaxRate[];
}

type KindColor = { bg: string; color: string };
const KIND_COLORS: Record<string, KindColor> = {
  STATE:   { bg: '#EFF6FF', color: '#1D4ED8' },
  COUNTY:  { bg: '#F0FDF4', color: '#166534' },
  CITY:    { bg: '#FFF7ED', color: '#C2410C' },
  SPECIAL: { bg: '#FAF5FF', color: '#7E22CE' },
};

const stl = {
  card: { background: '#FFFFFF', borderRadius: '8px', border: '1px solid #E2E8F0', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', padding: '20px', marginBottom: '12px' } as React.CSSProperties,
  addBtn: { background: '#0A2342', color: '#FFFFFF', border: 'none', borderRadius: '6px', padding: '9px 16px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px' } as React.CSSProperties,
  dangerBtn: { display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '6px 12px', fontSize: '12px', fontWeight: 600, color: '#DC2626', backgroundColor: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '6px', cursor: 'pointer' } as React.CSSProperties,
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: '13px', marginTop: '12px' },
  th: { textAlign: 'left' as const, padding: '8px 12px', background: '#F1F5F9', color: '#475569', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.04em', borderBottom: '1px solid #E2E8F0' },
  td: { padding: '8px 12px', borderBottom: '1px solid #F1F5F9', color: '#0A2342' },
  badge: { display: 'inline-block', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase' as const },
  input: { padding: '8px 10px', border: '1px solid #CBD5E1', borderRadius: '6px', fontSize: '13px', color: '#0A2342', width: '100%', boxSizing: 'border-box' as const },
  select: { padding: '8px 10px', border: '1px solid #CBD5E1', borderRadius: '6px', fontSize: '13px', color: '#0A2342', background: '#FFFFFF', width: '100%', boxSizing: 'border-box' as const },
  formGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '12px' } as React.CSSProperties,
  label: { display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' } as React.CSSProperties,
  error: { color: '#DC2626', fontSize: '13px', marginTop: '8px' } as React.CSSProperties,
};

function fmtBps(bps: number) {
  return (bps / 100).toFixed(2) + '%';
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

interface AddJurFormProps {
  onSave: (data: { code: string; name: string; kind: 'STATE' | 'COUNTY' | 'CITY' | 'SPECIAL' }) => Promise<void>;
  loading: boolean;
  error?: string;
  onCancel: () => void;
}

function AddJurForm({ onSave, loading, error, onCancel }: AddJurFormProps) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'STATE' | 'COUNTY' | 'CITY' | 'SPECIAL'>('STATE');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSave({ code: code.trim(), name: name.trim(), kind });
    setCode(''); setName('');
  };

  return (
    <form onSubmit={(e) => void submit(e)} style={{ marginTop: '16px', padding: '16px', background: '#F8FAFC', borderRadius: '6px', border: '1px solid #E2E8F0' }}>
      <div style={{ fontSize: '13px', fontWeight: 600, color: '#0A2342', marginBottom: '12px' }}>Add Jurisdiction</div>
      <div style={stl.formGrid}>
        <div>
          <label style={stl.label}>Code</label>
          <input style={stl.input} value={code} onChange={(e) => setCode(e.target.value)} placeholder="FL" required />
        </div>
        <div>
          <label style={stl.label}>Name</label>
          <input style={stl.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Florida" required />
        </div>
        <div>
          <label style={stl.label}>Type</label>
          <select style={stl.select} value={kind} onChange={(e) => setKind(e.target.value as 'STATE' | 'COUNTY' | 'CITY' | 'SPECIAL')}>
            <option value="STATE">State</option>
            <option value="COUNTY">County</option>
            <option value="CITY">City</option>
            <option value="SPECIAL">Special District</option>
          </select>
        </div>
      </div>
      {error && <div style={stl.error}>{error}</div>}
      <div style={{ display: 'flex', gap: '8px' }}>
        <button style={stl.addBtn} type="submit" disabled={loading}>
          {loading ? <Loader2 size={13} /> : <Plus size={13} />} Add Jurisdiction
        </button>
        <button
          style={{ ...stl.dangerBtn, color: '#64748B', background: '#F1F5F9', border: '1px solid #E2E8F0' }}
          type="button"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

interface AddRateFormProps {
  jurisdictionId: string;
  glAccounts: GlAccount[];
  onSave: (data: {
    jurisdictionId: string;
    category: string;
    ratePctBps: number;
    effectiveFrom: string;
    effectiveTo: string | null;
    glAccountId: string | null;
  }) => Promise<void>;
  loading: boolean;
  onCancel: () => void;
}

function AddRateForm({ jurisdictionId, glAccounts, onSave, loading, onCancel }: AddRateFormProps) {
  const [category, setCategory] = useState('marina_services');
  const [ratePct, setRatePct] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));
  const [effectiveTo, setEffectiveTo] = useState('');
  const [glAccountId, setGlAccountId] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const bps = Math.round(parseFloat(ratePct) * 100);
    await onSave({
      jurisdictionId,
      category,
      ratePctBps: bps,
      effectiveFrom: new Date(effectiveFrom).toISOString(),
      effectiveTo: effectiveTo ? new Date(effectiveTo).toISOString() : null,
      glAccountId: glAccountId || null,
    });
  };

  const liabilityAccounts = glAccounts.filter((a) => a.type.toUpperCase() === 'LIABILITY');

  return (
    <form onSubmit={(e) => void submit(e)} style={{ marginTop: '12px', padding: '16px', background: '#F8FAFC', borderRadius: '6px', border: '1px solid #E2E8F0' }}>
      <div style={stl.formGrid}>
        <div>
          <label style={stl.label}>Category</label>
          <input style={stl.input} value={category} onChange={(e) => setCategory(e.target.value)} required />
        </div>
        <div>
          <label style={stl.label}>Rate (%)</label>
          <input style={stl.input} type="number" step="0.01" min="0" value={ratePct} onChange={(e) => setRatePct(e.target.value)} placeholder="6.00" required />
        </div>
        <div>
          <label style={stl.label}>Effective From</label>
          <input style={stl.input} type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} required />
        </div>
        <div>
          <label style={stl.label}>Effective To (optional)</label>
          <input style={stl.input} type="date" value={effectiveTo} onChange={(e) => setEffectiveTo(e.target.value)} />
        </div>
      </div>
      <div style={{ marginBottom: '12px' }}>
        <label style={stl.label}>GL Liability Account</label>
        <select style={stl.select} value={glAccountId} onChange={(e) => setGlAccountId(e.target.value)}>
          <option value="">— Default (Sales Tax Payable) —</option>
          {liabilityAccounts.map((a) => (
            <option key={a.id} value={a.id}>{a.accountNumber} — {a.name}{a.qboAccountId ? ' ✓' : ''}</option>
          ))}
        </select>
      </div>
      <div style={{ display: 'flex', gap: '8px' }}>
        <button style={stl.addBtn} type="submit" disabled={loading}>
          {loading ? <Loader2 size={13} /> : null} Save Rate
        </button>
        <button
          style={{ ...stl.dangerBtn, color: '#64748B', background: '#F1F5F9', border: '1px solid #E2E8F0' }}
          type="button"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

export default function SalesTaxPanel() {
  const [jurisdictions, setJurisdictions] = useState<Jurisdiction[]>([]);
  const [glAccounts, setGlAccounts] = useState<GlAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showAddJur, setShowAddJur] = useState(false);
  const [addJurLoading, setAddJurLoading] = useState(false);
  const [addJurError, setAddJurError] = useState('');
  const [addRateFor, setAddRateFor] = useState<string | null>(null);
  const [addRateLoading, setAddRateLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [jRes, aRes] = await Promise.all([
        api.get<{ data: Jurisdiction[] }>('/api/tax/jurisdictions'),
        api.get<{ data: GlAccount[] }>('/api/settings/gl-accounts'),
      ]);
      setJurisdictions(jRes.data ?? []);
      setGlAccounts(aRes.data ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleAddJurisdiction = async (body: { code: string; name: string; kind: 'STATE' | 'COUNTY' | 'CITY' | 'SPECIAL' }) => {
    setAddJurLoading(true);
    setAddJurError('');
    try {
      await api.post('/api/tax/jurisdictions', body);
      setShowAddJur(false);
      await load();
    } catch (e: unknown) {
      setAddJurError(e instanceof Error ? e.message : 'Failed to add jurisdiction');
    } finally {
      setAddJurLoading(false);
    }
  };

  const handleDeleteJurisdiction = async (id: string) => {
    if (!confirm('Delete this jurisdiction and all its rates?')) return;
    try {
      await api.delete(`/api/tax/jurisdictions/${id}`);
      await load();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  const handleAddRate = async (body: {
    jurisdictionId: string;
    category: string;
    ratePctBps: number;
    effectiveFrom: string;
    effectiveTo: string | null;
    glAccountId: string | null;
  }) => {
    setAddRateLoading(true);
    try {
      await api.post('/api/tax/rates', body);
      setAddRateFor(null);
      await load();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Failed to add rate');
    } finally {
      setAddRateLoading(false);
    }
  };

  const handleDeleteRate = async (id: string) => {
    if (!confirm('Delete this rate?')) return;
    try {
      await api.delete(`/api/tax/rates/${id}`);
      await load();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  if (loading) {
    return <div style={{ color: '#94A3B8', fontSize: '14px', padding: '24px', display: 'flex', alignItems: 'center', gap: '8px' }}><Loader2 size={16} /> Loading tax jurisdictions…</div>;
  }

  if (error) {
    return (
      <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '8px', padding: '16px', display: 'flex', alignItems: 'center', gap: '8px', color: '#B91C1C', fontSize: '14px' }}>
        <AlertTriangle size={16} /> {error}
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div style={{ fontSize: '13px', color: '#64748B' }}>
          {jurisdictions.length} jurisdiction{jurisdictions.length !== 1 ? 's' : ''} configured
        </div>
        <button style={stl.addBtn} onClick={() => setShowAddJur(true)}>
          <Plus size={14} /> Add Jurisdiction
        </button>
      </div>

      {showAddJur && (
        <AddJurForm
          onSave={handleAddJurisdiction}
          loading={addJurLoading}
          error={addJurError}
          onCancel={() => setShowAddJur(false)}
        />
      )}

      {jurisdictions.length === 0 && !showAddJur && (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: '#94A3B8', fontSize: '14px', background: '#F8FAFC', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
          No tax jurisdictions configured yet.
        </div>
      )}

      {jurisdictions.map((j) => {
        const colors = KIND_COLORS[j.kind] ?? KIND_COLORS.SPECIAL;
        const isExpanded = expandedId === j.id;

        return (
          <div key={j.id} style={stl.card}>
            <div
              style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer', userSelect: 'none' }}
              onClick={() => setExpandedId(isExpanded ? null : j.id)}
            >
              {isExpanded ? <ChevronDown size={16} color="#64748B" /> : <ChevronRight size={16} color="#64748B" />}
              <span style={{ ...stl.badge, background: colors.bg, color: colors.color }}>{j.kind}</span>
              <span style={{ fontWeight: 700, color: '#0A2342', fontSize: '15px' }}>{j.code}</span>
              <span style={{ color: '#64748B', fontSize: '14px' }}>{j.name}</span>
              <span style={{ marginLeft: 'auto', color: '#94A3B8', fontSize: '13px' }}>
                {j.rates.length} rate{j.rates.length !== 1 ? 's' : ''}
              </span>
              <button
                style={stl.dangerBtn}
                onClick={(e) => { e.stopPropagation(); void handleDeleteJurisdiction(j.id); }}
                type="button"
              >
                <Trash2 size={12} /> Delete
              </button>
            </div>

            {isExpanded && (
              <div style={{ marginTop: '16px' }}>
                {j.rates.length > 0 ? (
                  <table style={stl.table}>
                    <thead>
                      <tr>
                        <th style={stl.th}>Category</th>
                        <th style={stl.th}>Rate</th>
                        <th style={stl.th}>Effective From</th>
                        <th style={stl.th}>Effective To</th>
                        <th style={stl.th}>GL Account</th>
                        <th style={stl.th}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {j.rates.map((r) => {
                        const acct = r.glAccountId ? glAccounts.find((a) => a.id === r.glAccountId) : null;
                        return (
                          <tr key={r.id}>
                            <td style={stl.td}>{r.category}</td>
                            <td style={{ ...stl.td, fontWeight: 600 }}>{fmtBps(r.ratePctBps)}</td>
                            <td style={stl.td}>{fmtDate(r.effectiveFrom)}</td>
                            <td style={{ ...stl.td, color: r.effectiveTo ? '#0A2342' : '#94A3B8' }}>
                              {r.effectiveTo ? fmtDate(r.effectiveTo) : 'Open-ended'}
                            </td>
                            <td style={stl.td}>
                              {acct ? (
                                <span style={{ fontSize: '12px', fontFamily: 'monospace' }}>{acct.accountNumber} — {acct.name}</span>
                              ) : (
                                <span style={{ color: '#94A3B8', fontSize: '12px' }}>Default</span>
                              )}
                            </td>
                            <td style={{ ...stl.td, textAlign: 'right' as const }}>
                              <button style={stl.dangerBtn} onClick={() => void handleDeleteRate(r.id)} type="button">
                                <Trash2 size={12} /> Remove
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : (
                  <p style={{ color: '#94A3B8', fontSize: '13px', margin: '0 0 8px' }}>No rates yet.</p>
                )}

                {addRateFor === j.id ? (
                  <AddRateForm
                    jurisdictionId={j.id}
                    glAccounts={glAccounts}
                    onSave={handleAddRate}
                    loading={addRateLoading}
                    onCancel={() => setAddRateFor(null)}
                  />
                ) : (
                  <button
                    style={{ ...stl.addBtn, fontSize: '12px', padding: '6px 12px', marginTop: '8px', background: '#2E4A6B' }}
                    onClick={() => setAddRateFor(j.id)}
                    type="button"
                  >
                    <Plus size={12} /> Add Rate
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
