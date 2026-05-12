import { useState, useEffect } from 'react';
import { Plus, Trash2, ChevronDown, ChevronRight, Loader2, Link2 } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { useModules } from '../context/ModulesContext';
import { SubNav, SETTINGS_SUBNAV } from '@helm/ui-kit';

const NAVY = '#0A2342';

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 32 },
  title: { fontSize: 36, fontWeight: 700, color: NAVY, letterSpacing: '-0.02em', margin: 0 },
  divider: { height: 4, background: 'linear-gradient(90deg, #00D4FF, transparent)', border: 'none', marginTop: 12, marginBottom: 32, borderRadius: 2 },
  section: { marginBottom: 32 },
  sectionTitle: { fontSize: 18, fontWeight: 700, color: NAVY, marginBottom: 12 },
  card: { background: '#fff', border: '1px solid #E2E8F0', borderRadius: 8, padding: 24, marginBottom: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 14 },
  th: { textAlign: 'left' as const, padding: '10px 12px', background: '#F8FAFC', fontWeight: 600, color: '#2E4A6B', borderBottom: '1px solid #E2E8F0', fontSize: 12, textTransform: 'uppercase' as const, letterSpacing: '0.05em' },
  td: { padding: '10px 12px', borderBottom: '1px solid #F1F5F9', color: NAVY, verticalAlign: 'middle' as const },
  badge: { display: 'inline-block', padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.04em' },
  primaryBtn: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 18px', fontSize: 13, fontWeight: 600, color: '#fff', backgroundColor: NAVY, border: 'none', borderRadius: 6, cursor: 'pointer' },
  dangerBtn: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', fontSize: 12, fontWeight: 600, color: '#DC2626', backgroundColor: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 6, cursor: 'pointer' },
  input: { width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid #CBD5E1', fontSize: 13, color: NAVY, boxSizing: 'border-box' as const },
  select: { width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid #CBD5E1', fontSize: 13, color: NAVY, background: '#fff', boxSizing: 'border-box' as const },
  formGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 16 },
  label: { display: 'block', fontSize: 12, fontWeight: 600, color: '#2E4A6B', marginBottom: 4 },
  error: { color: '#DC2626', fontSize: 13, marginTop: 8 },
  emptyState: { textAlign: 'center' as const, padding: '40px 20px', color: '#94A3B8', fontSize: 14 },
  qboBadge: { display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600, background: '#E8F5E9', color: '#166534' },
  hint: { fontSize: 11, color: '#94A3B8', marginTop: 3 },
};

type Kind = 'STATE' | 'COUNTY' | 'CITY' | 'SPECIAL';

interface GlAccount {
  id: string;
  accountNumber: string;
  name: string;
  type: string;
  isDeferredRevenue: boolean;
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
  kind: Kind;
  rates: TaxRate[];
}

const KIND_COLORS: Record<Kind, { bg: string; color: string }> = {
  STATE:   { bg: '#EFF6FF', color: '#1D4ED8' },
  COUNTY:  { bg: '#F0FDF4', color: '#166534' },
  CITY:    { bg: '#FFF7ED', color: '#C2410C' },
  SPECIAL: { bg: '#FAF5FF', color: '#7E22CE' },
};

function fmtBps(bps: number) {
  return (bps / 100).toFixed(2) + '%';
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function GlAccountSelect({
  accounts,
  value,
  onChange,
  filterType,
  placeholder = '— system default —',
}: {
  accounts: GlAccount[];
  value: string;
  onChange: (v: string) => void;
  filterType?: string;
  placeholder?: string;
}) {
  const filtered = filterType
    ? accounts.filter(a => a.type.toUpperCase() === filterType.toUpperCase())
    : accounts;

  return (
    <div>
      <select style={styles.select} value={value} onChange={e => onChange(e.target.value)}>
        <option value="">{placeholder}</option>
        {filtered.map(a => (
          <option key={a.id} value={a.id}>
            {a.accountNumber} — {a.name}{a.qboAccountId ? ' ✓' : ''}
          </option>
        ))}
      </select>
      <div style={styles.hint}>
        Accounts marked ✓ are linked to QuickBooks Online
      </div>
    </div>
  );
}

interface AddJurisdictionFormProps {
  onSave: (data: { code: string; name: string; kind: Kind }) => Promise<void>;
  loading: boolean;
  error?: string;
}

function AddJurisdictionForm({ onSave, loading, error }: AddJurisdictionFormProps) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<Kind>('STATE');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSave({ code: code.trim(), name: name.trim(), kind });
    setCode('');
    setName('');
  };

  return (
    <form onSubmit={submit}>
      <div style={styles.formGrid}>
        <div>
          <label style={styles.label}>Code</label>
          <input style={styles.input} value={code} onChange={e => setCode(e.target.value)} placeholder="FL" required />
        </div>
        <div>
          <label style={styles.label}>Name</label>
          <input style={styles.input} value={name} onChange={e => setName(e.target.value)} placeholder="Florida" required />
        </div>
        <div>
          <label style={styles.label}>Type</label>
          <select style={styles.select} value={kind} onChange={e => setKind(e.target.value as Kind)}>
            <option value="STATE">State</option>
            <option value="COUNTY">County</option>
            <option value="CITY">City</option>
            <option value="SPECIAL">Special District</option>
          </select>
        </div>
      </div>
      {error && <div style={styles.error}>{error}</div>}
      <button style={styles.primaryBtn} type="submit" disabled={loading}>
        {loading ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Plus size={14} />}
        Add Jurisdiction
      </button>
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
}

function AddRateForm({ jurisdictionId, glAccounts, onSave, loading }: AddRateFormProps) {
  const [category, setCategory] = useState('marina_services');
  const [ratePct, setRatePct] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));
  const [effectiveTo, setEffectiveTo] = useState('');
  const [glAccountId, setGlAccountId] = useState('');
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        style={{ ...styles.primaryBtn, fontSize: 12, padding: '6px 12px', marginTop: 8, background: '#2E4A6B' }}
        onClick={() => setOpen(true)}
        type="button"
      >
        <Plus size={12} /> Add Rate
      </button>
    );
  }

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
    setOpen(false);
    setRatePct('');
    setEffectiveTo('');
    setGlAccountId('');
  };

  return (
    <form onSubmit={submit} style={{ marginTop: 12, padding: 16, background: '#F8FAFC', borderRadius: 6, border: '1px solid #E2E8F0' }}>
      <div style={styles.formGrid}>
        <div>
          <label style={styles.label}>Category</label>
          <input style={styles.input} value={category} onChange={e => setCategory(e.target.value)} placeholder="marina_services" required />
        </div>
        <div>
          <label style={styles.label}>Rate (%)</label>
          <input style={styles.input} type="number" step="0.01" min="0" value={ratePct} onChange={e => setRatePct(e.target.value)} placeholder="6.00" required />
        </div>
        <div>
          <label style={styles.label}>Effective From</label>
          <input style={styles.input} type="date" value={effectiveFrom} onChange={e => setEffectiveFrom(e.target.value)} required />
        </div>
        <div>
          <label style={styles.label}>Effective To (optional)</label>
          <input style={styles.input} type="date" value={effectiveTo} onChange={e => setEffectiveTo(e.target.value)} />
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={styles.label}>
          GL Liability Account
          <span style={{ fontWeight: 400, color: '#94A3B8', marginLeft: 6 }}>— where tax collected is credited</span>
        </label>
        <GlAccountSelect
          accounts={glAccounts}
          value={glAccountId}
          onChange={setGlAccountId}
          filterType="LIABILITY"
          placeholder="— default (2400 Sales Tax Payable) —"
        />
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button style={styles.primaryBtn} type="submit" disabled={loading}>
          {loading ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : null}
          Save Rate
        </button>
        <button
          style={{ ...styles.dangerBtn, color: '#64748B', background: '#F1F5F9', border: '1px solid #E2E8F0' }}
          type="button"
          onClick={() => setOpen(false)}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

export default function SettingsTaxRates() {
  const { currentLocationId } = useModules();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const glAccountsQs = currentLocationId ? `?locationId=${encodeURIComponent(currentLocationId)}` : '';
  const jurisdictionsQs = currentLocationId ? `?locationId=${encodeURIComponent(currentLocationId)}` : '';
  const glAccountsResp = useApi<{ data: GlAccount[] }>('get', `/api/settings/gl-accounts${glAccountsQs}`, { immediate: true });
  const jurisdictions = useApi<{ data: Jurisdiction[] }>('get', `/api/tax/jurisdictions${jurisdictionsQs}`, { immediate: true });

  // Re-fetch when the location filter changes
  useEffect(() => {
    glAccountsResp.execute();
    jurisdictions.execute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentLocationId]);
  const createJurisdiction = useApi<{ data: Jurisdiction }>('post', '/api/tax/jurisdictions');
  const deleteJurisdiction = useApi<void>('delete', '/api/tax/jurisdictions/:id');
  const createRate = useApi<{ data: TaxRate }>('post', '/api/tax/rates');
  const deleteRate = useApi<void>('delete', '/api/tax/rates/:id');

  const rows: Jurisdiction[] = jurisdictions.data?.data ?? [];
  const glAccounts: GlAccount[] = glAccountsResp.data?.data ?? [];

  const glAccountLabel = (id: string | null) => {
    if (!id) return null;
    const acct = glAccounts.find(a => a.id === id);
    if (!acct) return id;
    return `${acct.accountNumber} — ${acct.name}`;
  };

  const handleAddJurisdiction = async (body: { code: string; name: string; kind: Kind }) => {
    await createJurisdiction.execute({ body });
    jurisdictions.execute();
  };

  const handleDeleteJurisdiction = async (id: string) => {
    if (!confirm('Delete this jurisdiction and all its rates?')) return;
    await (deleteJurisdiction as any).execute({ urlParams: { id } });
    jurisdictions.execute();
  };

  const handleAddRate = async (body: {
    jurisdictionId: string;
    category: string;
    ratePctBps: number;
    effectiveFrom: string;
    effectiveTo: string | null;
    glAccountId: string | null;
  }) => {
    await createRate.execute({ body });
    jurisdictions.execute();
  };

  const handleDeleteRate = async (id: string) => {
    if (!confirm('Delete this rate?')) return;
    await (deleteRate as any).execute({ urlParams: { id } });
    jurisdictions.execute();
  };

  return (
    <div style={styles.page}>
      <h1 style={styles.title}>Settings</h1>
      <hr style={styles.divider} />

      <SubNav items={SETTINGS_SUBNAV} />

      <div style={styles.section}>
        <div style={styles.sectionTitle}>Add Jurisdiction</div>
        <div style={styles.card}>
          <AddJurisdictionForm
            onSave={handleAddJurisdiction}
            loading={createJurisdiction.loading}
            error={createJurisdiction.error ?? undefined}
          />
        </div>
      </div>

      <div style={styles.section}>
        <div style={styles.sectionTitle}>Configured Jurisdictions</div>
        {jurisdictions.loading && (
          <div style={styles.emptyState}><Loader2 size={20} /></div>
        )}
        {!jurisdictions.loading && rows.length === 0 && (
          <div style={styles.emptyState}>No jurisdictions configured yet. Add one above.</div>
        )}
        {rows.map(j => {
          const colors = KIND_COLORS[j.kind] ?? KIND_COLORS.SPECIAL;
          const isExpanded = expandedId === j.id;
          return (
            <div key={j.id} style={styles.card}>
              <div
                style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', userSelect: 'none' }}
                onClick={() => setExpandedId(isExpanded ? null : j.id)}
              >
                {isExpanded ? <ChevronDown size={16} color="#64748B" /> : <ChevronRight size={16} color="#64748B" />}
                <span style={{ ...styles.badge, background: colors.bg, color: colors.color }}>{j.kind}</span>
                <span style={{ fontWeight: 700, color: NAVY, fontSize: 15 }}>{j.code}</span>
                <span style={{ color: '#64748B', fontSize: 14 }}>{j.name}</span>
                <span style={{ marginLeft: 'auto', color: '#94A3B8', fontSize: 13 }}>
                  {j.rates.length} rate{j.rates.length !== 1 ? 's' : ''}
                </span>
                <button
                  style={styles.dangerBtn}
                  onClick={e => { e.stopPropagation(); handleDeleteJurisdiction(j.id); }}
                  type="button"
                >
                  <Trash2 size={12} /> Delete
                </button>
              </div>

              {isExpanded && (
                <div style={{ marginTop: 16 }}>
                  {j.rates.length > 0 ? (
                    <table style={styles.table}>
                      <thead>
                        <tr>
                          <th style={styles.th}>Category</th>
                          <th style={styles.th}>Rate</th>
                          <th style={styles.th}>Effective From</th>
                          <th style={styles.th}>Effective To</th>
                          <th style={styles.th}>GL Liability Account</th>
                          <th style={styles.th}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {j.rates.map(r => {
                          const label = glAccountLabel(r.glAccountId);
                          const acct = r.glAccountId ? glAccounts.find(a => a.id === r.glAccountId) : null;
                          return (
                            <tr key={r.id}>
                              <td style={styles.td}>{r.category}</td>
                              <td style={{ ...styles.td, fontFamily: 'Inter, system-ui, sans-serif', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                                {fmtBps(r.ratePctBps)}
                              </td>
                              <td style={styles.td}>{fmtDate(r.effectiveFrom)}</td>
                              <td style={{ ...styles.td, color: r.effectiveTo ? NAVY : '#94A3B8' }}>
                                {r.effectiveTo ? fmtDate(r.effectiveTo) : 'Open-ended'}
                              </td>
                              <td style={styles.td}>
                                {label ? (
                                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <span style={{ fontFamily: 'Inter, system-ui, sans-serif', fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>{label}</span>
                                    {acct?.qboAccountId && (
                                      <span style={styles.qboBadge}><Link2 size={9} /> QBO</span>
                                    )}
                                  </span>
                                ) : (
                                  <span style={{ color: '#94A3B8', fontSize: 12 }}>Default (2400)</span>
                                )}
                              </td>
                              <td style={{ ...styles.td, textAlign: 'right' }}>
                                <button style={styles.dangerBtn} onClick={() => handleDeleteRate(r.id)} type="button">
                                  <Trash2 size={12} /> Remove
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  ) : (
                    <p style={{ color: '#94A3B8', fontSize: 13, margin: '0 0 8px' }}>No rates yet.</p>
                  )}
                  <AddRateForm
                    jurisdictionId={j.id}
                    glAccounts={glAccounts}
                    onSave={handleAddRate}
                    loading={createRate.loading}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
