import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@clerk/clerk-react';
import { Plus, Trash2, X, Tag, ArrowLeft, Search, ToggleLeft, ToggleRight, Edit2 } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { api } from '../lib/api';

// Per-location auto-applied POS discounts. CRUD UI for the discount engine
// implemented in apps/api/src/routes/pos-discounts.ts.
//
// Spec recap (kept here so future edits don't drift from product intent):
//   • Customer-gated — discounts only apply when a customer is attached
//     to the sale at POS.
//   • Target = exactly ONE of (product category, single product). Enforced
//     in both the Zod schema and the form below.
//   • PERCENT (basis points, 1..10000) OR AMOUNT (cents off line). Stored
//     as integers; we convert at the form boundary.
//   • Eligibility = "all customers" OR explicit allow-list. The picker
//     below holds the allow-list.
//   • No stacking — best-per-line wins (decided server-side).

type Location = { id: string; name: string; tenantId?: string };
type Product = { id: string; name: string; sku: string };
type Category = { id: string; name: string };
type Customer = { id: string; firstName: string | null; lastName: string | null; email: string | null; company: string | null };

type Discount = {
  id: string;
  name: string;
  kind: 'PERCENT' | 'AMOUNT';
  value: number;
  productCategoryId: string | null;
  productId: string | null;
  appliesToAllCustomers: boolean;
  active: boolean;
  productCategory: { id: string; name: string } | null;
  product: { id: string; name: string; sku: string } | null;
  location: { id: string; name: string } | null;
  _count?: { eligibleCustomers: number };
};

type DiscountFull = Discount & {
  eligibleCustomers: Array<{ customerId: string; customer: Customer }>;
};

const st: Record<string, React.CSSProperties> = {
  page: { padding: '32px', maxWidth: '1100px' },
  title: { fontSize: '28px', fontWeight: 700, color: '#0A2342', margin: 0 },
  subtitle: { color: '#64748B', marginTop: '4px', fontSize: '14px' },
  divider: { height: '4px', background: 'linear-gradient(90deg, #00D4FF, transparent)', border: 'none', marginTop: '12px', marginBottom: '24px', borderRadius: '2px' },
  card: { background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', marginBottom: '20px' },
  row: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' as const },
  label: { fontSize: '13px', fontWeight: 600, color: '#0A2342', display: 'block', marginBottom: '4px' },
  input: { padding: '8px 12px', fontSize: '14px', border: '1px solid #CBD5E1', borderRadius: '4px', color: '#0A2342', outline: 'none', width: '100%', boxSizing: 'border-box' as const },
  select: { padding: '8px 12px', fontSize: '14px', border: '1px solid #CBD5E1', borderRadius: '4px', color: '#0A2342', background: '#FFFFFF', cursor: 'pointer', width: '100%', boxSizing: 'border-box' as const },
  primary: { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 16px', fontSize: '14px', fontWeight: 600, color: '#FFFFFF', backgroundColor: '#0A2342', border: 'none', borderRadius: '6px', cursor: 'pointer' },
  outline: { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 16px', fontSize: '14px', fontWeight: 600, color: '#0A2342', backgroundColor: '#FFFFFF', border: '1px solid #CBD5E1', borderRadius: '6px', cursor: 'pointer' },
  danger: { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 10px', fontSize: '13px', fontWeight: 600, color: '#DC2626', background: 'none', border: 'none', cursor: 'pointer' },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: '14px' },
  th: { textAlign: 'left' as const, padding: '10px 12px', fontSize: '12px', fontWeight: 600, textTransform: 'uppercase' as const, color: '#FFFFFF', backgroundColor: '#0A2342' },
  td: { padding: '10px 12px', color: '#0A2342', borderBottom: '1px solid #E2E8F0' },
  badge: { display: 'inline-block', padding: '2px 8px', fontSize: '11px', fontWeight: 600, borderRadius: '9999px', background: '#E0F2FE', color: '#075985' },
  inactiveBadge: { background: '#F1F5F9', color: '#64748B' },
};

function customerLabel(c: Customer): string {
  return (
    [c.firstName, c.lastName].filter(Boolean).join(' ') ||
    c.company ||
    c.email ||
    c.id.slice(0, 8)
  );
}

function formatValue(d: Pick<Discount, 'kind' | 'value'>): string {
  if (d.kind === 'PERCENT') {
    const pct = d.value / 100;
    return `${Number.isInteger(pct) ? pct.toFixed(0) : pct.toString()}%`;
  }
  return `$${(d.value / 100).toFixed(2)}`;
}

export default function SettingsPosDiscounts(): React.ReactElement {
  const { getToken } = useAuth();
  const navigate = useNavigate();

  const { data: locsResp } = useApi<{ data: Location[] } | Location[]>('get', '/api/locations', { immediate: true });
  const locations: Location[] = useMemo(() => {
    const r = locsResp as any;
    if (!r) return [];
    if (Array.isArray(r)) return r;
    if (Array.isArray(r.data)) return r.data;
    return [];
  }, [locsResp]);
  const [locationId, setLocationId] = useState<string>('');
  useEffect(() => {
    if (!locationId && locations.length > 0) setLocationId(locations[0].id);
  }, [locations, locationId]);

  const listPath = locationId
    ? `/api/pos/discounts?locationId=${encodeURIComponent(locationId)}&includeInactive=true`
    : '/api/pos/discounts?includeInactive=true';
  const { data: listResp, execute: refresh, loading: loadingList } = useApi<{ data: Discount[] }>(
    'get', listPath, { immediate: !!locationId },
  );
  const discounts = listResp?.data ?? [];

  // Catalog data for the form (categories + products) — scoped per location.
  const { data: cats } = useApi<{ data: Category[] } | Category[]>('get', '/api/inventory/categories', { immediate: true });
  const categories: Category[] = Array.isArray(cats as any) ? (cats as any) : ((cats as any)?.data ?? []);
  const productsPath = locationId ? `/api/pos/products?locationId=${encodeURIComponent(locationId)}` : '/api/pos/products';
  const { data: prodResp } = useApi<{ data: Product[] }>('get', productsPath, { immediate: !!locationId });
  const products: Product[] = prodResp?.data ?? [];

  // Editor state
  const [editor, setEditor] = useState<{ open: boolean; id: string | null }>({ open: false, id: null });
  const [form, setForm] = useState({
    name: '',
    kind: 'PERCENT' as 'PERCENT' | 'AMOUNT',
    value: '', // user types percent ("10") or dollars ("5.00")
    targetType: 'category' as 'category' | 'product',
    productCategoryId: '',
    productId: '',
    appliesToAllCustomers: true,
    eligibleCustomerIds: [] as string[],
    eligibleCustomerLabels: {} as Record<string, string>,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Customer picker for the allow-list
  const [custSearch, setCustSearch] = useState('');
  const [custHits, setCustHits] = useState<Customer[]>([]);
  useEffect(() => {
    const q = custSearch.trim();
    if (q.length < 2) { setCustHits([]); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const token = await getToken();
        const r = await api.get<{ data: Customer[] }>(`/api/customers?search=${encodeURIComponent(q)}&pageSize=10`, token);
        if (!cancelled) setCustHits(r.data ?? []);
      } catch { if (!cancelled) setCustHits([]); }
    }, 220);
    return () => { cancelled = true; clearTimeout(t); };
  }, [custSearch, getToken]);

  function openNew(): void {
    setForm({
      name: '', kind: 'PERCENT', value: '',
      targetType: 'category', productCategoryId: '', productId: '',
      appliesToAllCustomers: true, eligibleCustomerIds: [], eligibleCustomerLabels: {},
    });
    setError(null);
    setEditor({ open: true, id: null });
  }

  async function openEdit(d: Discount): Promise<void> {
    setError(null);
    try {
      const token = await getToken();
      const full = await api.get<DiscountFull>(`/api/pos/discounts/${d.id}`, token);
      const labels: Record<string, string> = {};
      for (const ec of full.eligibleCustomers) labels[ec.customerId] = customerLabel(ec.customer);
      setForm({
        name: full.name,
        kind: full.kind,
        value: full.kind === 'PERCENT' ? (full.value / 100).toString() : (full.value / 100).toFixed(2),
        targetType: full.productId ? 'product' : 'category',
        productCategoryId: full.productCategoryId ?? '',
        productId: full.productId ?? '',
        appliesToAllCustomers: full.appliesToAllCustomers,
        eligibleCustomerIds: full.eligibleCustomers.map((ec) => ec.customerId),
        eligibleCustomerLabels: labels,
      });
      setEditor({ open: true, id: d.id });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function closeEditor(): void {
    setEditor({ open: false, id: null });
    setError(null);
    setCustSearch('');
    setCustHits([]);
  }

  async function save(): Promise<void> {
    setError(null);
    if (!form.name.trim()) { setError('Name is required'); return; }
    const targetField = form.targetType === 'category' ? form.productCategoryId : form.productId;
    if (!targetField) {
      setError(form.targetType === 'category' ? 'Pick a category' : 'Pick a product');
      return;
    }
    const numericValue = parseFloat(form.value);
    if (Number.isNaN(numericValue) || numericValue <= 0) {
      setError('Enter a positive value');
      return;
    }
    // PERCENT: convert "10" → 1000 basis points. AMOUNT: "5.00" → 500 cents.
    const intValue = form.kind === 'PERCENT'
      ? Math.round(numericValue * 100)
      : Math.round(numericValue * 100);
    if (form.kind === 'PERCENT' && intValue > 10000) {
      setError('Percent cannot exceed 100%');
      return;
    }

    const payload = {
      name: form.name.trim(),
      kind: form.kind,
      value: intValue,
      productCategoryId: form.targetType === 'category' ? form.productCategoryId : null,
      productId: form.targetType === 'product' ? form.productId : null,
      appliesToAllCustomers: form.appliesToAllCustomers,
      eligibleCustomerIds: form.appliesToAllCustomers ? [] : form.eligibleCustomerIds,
    };

    setSaving(true);
    try {
      const token = await getToken();
      if (editor.id) {
        await api.put(`/api/pos/discounts/${editor.id}`, payload, token);
      } else {
        await api.post('/api/pos/discounts', { ...payload, locationId }, token);
      }
      closeEditor();
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(d: Discount): Promise<void> {
    try {
      const token = await getToken();
      await api.put(`/api/pos/discounts/${d.id}`, { active: !d.active }, token);
      await refresh();
    } catch (err) {
      alert((err as Error).message);
    }
  }

  async function remove(d: Discount): Promise<void> {
    if (!confirm(`Deactivate discount "${d.name}"? Past sales keep their reference; the rule simply stops auto-applying.`)) return;
    try {
      const token = await getToken();
      await api.delete(`/api/pos/discounts/${d.id}`, token);
      await refresh();
    } catch (err) {
      alert((err as Error).message);
    }
  }

  return (
    <div style={st.page}>
      <button onClick={() => navigate('/settings')} style={{ ...st.outline, marginBottom: '16px' }}>
        <ArrowLeft size={14} /> Back to settings
      </button>
      <h1 style={st.title}><Tag size={22} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '8px' }} />POS Discounts</h1>
      <div style={st.subtitle}>
        Per-location, auto-applied at the register when a customer is attached to the sale.
        Best discount per line wins — discounts never stack.
      </div>
      <hr style={st.divider} />

      <div style={st.card}>
        <div style={st.row}>
          <div style={{ flex: 1, minWidth: '220px' }}>
            <label style={st.label}>Location</label>
            <select style={st.select} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              {locations.length === 0 && <option value="">No locations</option>}
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <button style={{ ...st.primary, alignSelf: 'flex-end' }} onClick={openNew} disabled={!locationId}>
            <Plus size={14} /> New discount
          </button>
        </div>

        {loadingList && <div style={{ color: '#64748B', fontSize: '13px' }}>Loading…</div>}
        {!loadingList && discounts.length === 0 && (
          <div style={{ padding: '32px', textAlign: 'center', color: '#64748B' }}>
            No discounts configured for this location yet.
          </div>
        )}
        {!loadingList && discounts.length > 0 && (
          <table style={st.table}>
            <thead>
              <tr>
                <th style={st.th}>Name</th>
                <th style={st.th}>Type</th>
                <th style={st.th}>Value</th>
                <th style={st.th}>Target</th>
                <th style={st.th}>Eligibility</th>
                <th style={st.th}>Status</th>
                <th style={st.th}></th>
              </tr>
            </thead>
            <tbody>
              {discounts.map((d) => (
                <tr key={d.id}>
                  <td style={st.td}><strong>{d.name}</strong></td>
                  <td style={st.td}>{d.kind === 'PERCENT' ? 'Percent' : 'Amount off'}</td>
                  <td style={st.td}>{formatValue(d)}</td>
                  <td style={st.td}>
                    {d.product
                      ? <>Product: {d.product.name}</>
                      : d.productCategory
                        ? <>Category: {d.productCategory.name}</>
                        : <span style={{ color: '#94A3B8' }}>—</span>}
                  </td>
                  <td style={st.td}>
                    {d.appliesToAllCustomers
                      ? <span style={st.badge}>All customers</span>
                      : <>{d._count?.eligibleCustomers ?? 0} customers</>}
                  </td>
                  <td style={st.td}>
                    <span style={{ ...st.badge, ...(d.active ? {} : st.inactiveBadge) }}>
                      {d.active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td style={st.td}>
                    <button style={st.danger} onClick={() => openEdit(d)} title="Edit">
                      <Edit2 size={14} />
                    </button>
                    <button style={st.danger} onClick={() => toggleActive(d)} title={d.active ? 'Deactivate' : 'Reactivate'}>
                      {d.active ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                    </button>
                    <button style={st.danger} onClick={() => remove(d)} title="Delete">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Editor modal ─────────────────────────────────────── */}
      {editor.open && (
        <div
          onClick={closeEditor}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#FFFFFF', borderRadius: '10px', padding: '28px', width: '560px', maxWidth: '90vw', maxHeight: '90vh', overflow: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <h2 style={{ margin: 0, fontSize: '20px', color: '#0A2342' }}>
                {editor.id ? 'Edit discount' : 'New discount'}
              </h2>
              <button onClick={closeEditor} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B' }}>
                <X size={18} />
              </button>
            </div>

            <div style={{ marginBottom: '14px' }}>
              <label style={st.label}>Name</label>
              <input style={st.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Member 10% off fuel" />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
              <div>
                <label style={st.label}>Type</label>
                <select style={st.select} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as 'PERCENT' | 'AMOUNT' })}>
                  <option value="PERCENT">Percent off</option>
                  <option value="AMOUNT">Amount off (per line)</option>
                </select>
              </div>
              <div>
                <label style={st.label}>{form.kind === 'PERCENT' ? 'Percent' : 'Amount ($)'}</label>
                <input
                  style={st.input}
                  type="number"
                  step={form.kind === 'PERCENT' ? '0.01' : '0.01'}
                  min="0"
                  value={form.value}
                  onChange={(e) => setForm({ ...form, value: e.target.value })}
                  placeholder={form.kind === 'PERCENT' ? '10' : '5.00'}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '12px', marginBottom: '14px' }}>
              <div>
                <label style={st.label}>Applies to</label>
                <select
                  style={st.select}
                  value={form.targetType}
                  onChange={(e) => setForm({ ...form, targetType: e.target.value as 'category' | 'product', productCategoryId: '', productId: '' })}
                >
                  <option value="category">Category</option>
                  <option value="product">Single product</option>
                </select>
              </div>
              <div>
                <label style={st.label}>{form.targetType === 'category' ? 'Category' : 'Product'}</label>
                {form.targetType === 'category' ? (
                  <select style={st.select} value={form.productCategoryId} onChange={(e) => setForm({ ...form, productCategoryId: e.target.value })}>
                    <option value="">— Select category —</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                ) : (
                  <select style={st.select} value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })}>
                    <option value="">— Select product —</option>
                    {products.map((p) => <option key={p.id} value={p.id}>{p.name}{p.sku ? ` (${p.sku})` : ''}</option>)}
                  </select>
                )}
              </div>
            </div>

            <div style={{ marginBottom: '14px' }}>
              <label style={{ ...st.label, display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={form.appliesToAllCustomers}
                  onChange={(e) => setForm({ ...form, appliesToAllCustomers: e.target.checked })}
                />
                Apply to every attached customer
              </label>
              <div style={{ fontSize: '12px', color: '#64748B', marginTop: '4px' }}>
                Off = only the specific customers selected below qualify. Either way, a customer
                must be attached at the register for the discount to fire.
              </div>
            </div>

            {!form.appliesToAllCustomers && (
              <div style={{ marginBottom: '14px' }}>
                <label style={st.label}>Eligible customers</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                  <Search size={14} style={{ color: '#64748B' }} />
                  <input
                    style={st.input}
                    placeholder="Search to add…"
                    value={custSearch}
                    onChange={(e) => setCustSearch(e.target.value)}
                  />
                </div>
                {custHits.length > 0 && (
                  <div style={{ maxHeight: '140px', overflow: 'auto', border: '1px solid #E2E8F0', borderRadius: '4px', marginBottom: '8px' }}>
                    {custHits.map((c) => {
                      const already = form.eligibleCustomerIds.includes(c.id);
                      const label = customerLabel(c);
                      return (
                        <div
                          key={c.id}
                          onClick={() => {
                            if (already) return;
                            setForm((f) => ({
                              ...f,
                              eligibleCustomerIds: [...f.eligibleCustomerIds, c.id],
                              eligibleCustomerLabels: { ...f.eligibleCustomerLabels, [c.id]: label },
                            }));
                            setCustSearch('');
                            setCustHits([]);
                          }}
                          style={{ padding: '6px 10px', cursor: already ? 'default' : 'pointer', borderBottom: '1px solid #F1F5F9', fontSize: '13px', color: already ? '#94A3B8' : '#0A2342' }}
                        >
                          {label} {already && '(added)'}
                        </div>
                      );
                    })}
                  </div>
                )}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {form.eligibleCustomerIds.length === 0 && (
                    <span style={{ color: '#94A3B8', fontSize: '12px' }}>No customers added yet.</span>
                  )}
                  {form.eligibleCustomerIds.map((id) => (
                    <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 10px', background: '#E0F2FE', color: '#075985', borderRadius: '9999px', fontSize: '12px' }}>
                      {form.eligibleCustomerLabels[id] ?? id.slice(0, 8)}
                      <X
                        size={12}
                        style={{ cursor: 'pointer' }}
                        onClick={() =>
                          setForm((f) => ({
                            ...f,
                            eligibleCustomerIds: f.eligibleCustomerIds.filter((x) => x !== id),
                          }))
                        }
                      />
                    </span>
                  ))}
                </div>
              </div>
            )}

            {error && (
              <div style={{ padding: '8px 12px', background: '#FEF2F2', color: '#991B1B', border: '1px solid #FCA5A5', borderRadius: '4px', marginBottom: '12px', fontSize: '13px' }}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button style={st.outline} onClick={closeEditor}>Cancel</button>
              <button style={st.primary} onClick={save} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
