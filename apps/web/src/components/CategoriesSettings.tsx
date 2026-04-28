import React, { useEffect, useState } from 'react';
import { Plus, X, Edit2, Tag } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { useToast } from './Toast';

// Product Category settings — owns default GL accounts (revenue, COGS,
// inventory asset) and a default tax category + taxable flag for inventory
// products. Products inherit these defaults via productCategoryId; the
// per-product fields act as overrides.

interface ProductCategory {
  id: string;
  name: string;
  defaultRevenueGlAccountId: string | null;
  defaultCogsGlAccountId: string | null;
  defaultInventoryAssetGlAccountId: string | null;
  defaultTaxCategory: string | null;
  taxable: boolean;
  active: boolean;
}

interface GlAccount {
  id: string;
  accountNumber: string;
  name: string;
  type: string;
  subType: string | null;
}

const stl = {
  card: { background: '#FFFFFF', borderRadius: '8px', border: '1px solid #E2E8F0', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', padding: '24px' } as React.CSSProperties,
  addBtn: { background: '#0A2342', color: '#FFFFFF', border: 'none', borderRadius: '6px', padding: '10px 16px', fontSize: '14px', fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px' } as React.CSSProperties,
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: '14px' },
  th: { textAlign: 'left' as const, padding: '12px 16px', borderBottom: '1px solid #E2E8F0', color: '#64748B', fontWeight: 600, fontSize: '12px', textTransform: 'uppercase' as const, letterSpacing: '0.05em' },
  td: { padding: '12px 16px', borderBottom: '1px solid #F1F5F9', color: '#0A2342' },
  iconBtn: { background: 'none', border: 'none', cursor: 'pointer', padding: '4px', color: '#64748B' } as React.CSSProperties,
  overlay: { position: 'fixed' as const, top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: '#FFFFFF', borderRadius: '10px', width: '560px', maxWidth: '90vw', maxHeight: '90vh', overflowY: 'auto' as const, boxShadow: '0 25px 60px rgba(0,0,0,0.18)' },
  modalHeader: { padding: '20px 24px', borderBottom: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  modalTitle: { fontSize: '18px', fontWeight: 700, color: '#0A2342', margin: 0 },
  modalBody: { padding: '24px', display: 'grid', gap: '16px' } as React.CSSProperties,
  modalFooter: { padding: '16px 24px', borderTop: '1px solid #E2E8F0', display: 'flex', justifyContent: 'flex-end', gap: '8px' },
  field: { display: 'flex', flexDirection: 'column' as const, gap: '6px' },
  label: { fontSize: '12px', fontWeight: 600, color: '#475569' },
  input: { padding: '10px 12px', border: '1px solid #CBD5E1', borderRadius: '6px', fontSize: '14px', color: '#0A2342' },
  saveBtn: { background: '#0A2342', color: '#FFFFFF', border: 'none', borderRadius: '6px', padding: '10px 20px', fontSize: '14px', fontWeight: 600, cursor: 'pointer' } as React.CSSProperties,
  cancelBtn: { background: '#FFFFFF', color: '#475569', border: '1px solid #CBD5E1', borderRadius: '6px', padding: '10px 20px', fontSize: '14px', fontWeight: 600, cursor: 'pointer' } as React.CSSProperties,
  closeBtn: { background: 'none', border: 'none', cursor: 'pointer', padding: '4px', color: '#64748B' } as React.CSSProperties,
  badge: { display: 'inline-block', padding: '2px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 600 },
};

function accountLabel(a: GlAccount | undefined | null) {
  if (!a) return '—';
  return `${a.accountNumber} — ${a.name}`;
}

function CategoryModal({
  initial,
  revenueAccts,
  cogsAccts,
  assetAccts,
  taxCategories,
  onClose,
  onSave,
}: {
  initial: ProductCategory | null;
  revenueAccts: GlAccount[];
  cogsAccts: GlAccount[];
  assetAccts: GlAccount[];
  taxCategories: string[];
  onClose: () => void;
  onSave: (payload: Partial<ProductCategory>) => Promise<void>;
}) {
  const [form, setForm] = useState({
    name: initial?.name ?? '',
    defaultRevenueGlAccountId: initial?.defaultRevenueGlAccountId ?? '',
    defaultCogsGlAccountId: initial?.defaultCogsGlAccountId ?? '',
    defaultInventoryAssetGlAccountId: initial?.defaultInventoryAssetGlAccountId ?? '',
    defaultTaxCategory: initial?.defaultTaxCategory ?? 'general',
    taxable: initial?.taxable ?? true,
    active: initial?.active ?? true,
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      await onSave({
        name: form.name.trim(),
        defaultRevenueGlAccountId: form.defaultRevenueGlAccountId || null,
        defaultCogsGlAccountId: form.defaultCogsGlAccountId || null,
        defaultInventoryAssetGlAccountId: form.defaultInventoryAssetGlAccountId || null,
        defaultTaxCategory: form.defaultTaxCategory || null,
        taxable: form.taxable,
        active: form.active,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={stl.overlay} onClick={onClose}>
      <div style={stl.modal} onClick={(e) => e.stopPropagation()}>
        <div style={stl.modalHeader}>
          <h2 style={stl.modalTitle}>{initial ? 'Edit Category' : 'New Category'}</h2>
          <button style={stl.closeBtn} onClick={onClose}><X size={20} /></button>
        </div>
        <div style={stl.modalBody}>
          <div style={stl.field}>
            <label style={stl.label}>Category Name *</label>
            <input
              style={stl.input}
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              placeholder="e.g. Fuel, Provisions, Bait & Tackle"
            />
          </div>

          <div style={stl.field}>
            <label style={stl.label}>Default Revenue Account</label>
            <select
              style={stl.input}
              value={form.defaultRevenueGlAccountId}
              onChange={(e) => setForm((p) => ({ ...p, defaultRevenueGlAccountId: e.target.value }))}
            >
              <option value="">— None —</option>
              {revenueAccts.map((a) => <option key={a.id} value={a.id}>{accountLabel(a)}</option>)}
            </select>
          </div>

          <div style={stl.field}>
            <label style={stl.label}>Default COGS Account</label>
            <select
              style={stl.input}
              value={form.defaultCogsGlAccountId}
              onChange={(e) => setForm((p) => ({ ...p, defaultCogsGlAccountId: e.target.value }))}
            >
              <option value="">— None —</option>
              {cogsAccts.map((a) => <option key={a.id} value={a.id}>{accountLabel(a)}</option>)}
            </select>
          </div>

          <div style={stl.field}>
            <label style={stl.label}>Default Inventory Asset Account</label>
            <select
              style={stl.input}
              value={form.defaultInventoryAssetGlAccountId}
              onChange={(e) => setForm((p) => ({ ...p, defaultInventoryAssetGlAccountId: e.target.value }))}
            >
              <option value="">— None —</option>
              {assetAccts.map((a) => <option key={a.id} value={a.id}>{accountLabel(a)}</option>)}
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '16px', alignItems: 'end' }}>
            <div style={stl.field}>
              <label style={stl.label}>Default Tax Category</label>
              <select
                style={stl.input}
                value={form.defaultTaxCategory}
                onChange={(e) => setForm((p) => ({ ...p, defaultTaxCategory: e.target.value }))}
                disabled={!form.taxable}
              >
                {taxCategories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 600, color: '#0A2342', paddingBottom: '10px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={form.taxable}
                onChange={(e) => setForm((p) => ({ ...p, taxable: e.target.checked }))}
              />
              Taxable
            </label>
          </div>

          {initial && (
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 600, color: '#0A2342', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm((p) => ({ ...p, active: e.target.checked }))}
              />
              Active
            </label>
          )}
        </div>
        <div style={stl.modalFooter}>
          <button style={stl.cancelBtn} onClick={onClose} disabled={saving}>Cancel</button>
          <button style={stl.saveBtn} onClick={handleSave} disabled={saving || !form.name.trim()}>
            {saving ? 'Saving…' : initial ? 'Save Changes' : 'Create Category'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CategoriesSettings() {
  const toast = useToast();
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ProductCategory | null>(null);
  const [adding, setAdding] = useState(false);

  // Reference data for the modal dropdowns. Filtered server-side by GL type.
  const { data: revenueAccountsData } = useApi<{ accounts: GlAccount[] }>(
    'get', '/api/inventory/gl-accounts?type=REVENUE', { immediate: true },
  );
  const { data: cogsAccountsData } = useApi<{ accounts: GlAccount[] }>(
    'get', '/api/inventory/gl-accounts?type=EXPENSE,COGS', { immediate: true },
  );
  const { data: assetAccountsData } = useApi<{ accounts: GlAccount[] }>(
    'get', '/api/inventory/gl-accounts?type=ASSET', { immediate: true },
  );
  const { data: taxCategoriesData } = useApi<{ categories: string[] }>(
    'get', '/api/inventory/tax-categories', { immediate: true },
  );

  const revenueAccts = revenueAccountsData?.accounts ?? [];
  const cogsAccts = cogsAccountsData?.accounts ?? [];
  const assetAccts = assetAccountsData?.accounts ?? [];
  const taxCategories = taxCategoriesData?.categories ?? ['general'];

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/inventory/categories?includeInactive=true');
      const body = await res.json();
      if (res.ok) setCategories(body.categories ?? []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  // The active-only filter in the table mirrors the inventory product form's
  // category dropdown so the user sees what creators see.
  const activeCount = categories.filter((c) => c.active).length;

  const handleSave = async (payload: Partial<ProductCategory>) => {
    try {
      const url = editing
        ? `/api/inventory/categories/${editing.id}`
        : '/api/inventory/categories';
      const method = editing ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      toast.success(editing ? 'Category updated' : 'Category created', payload.name ?? '');
      setAdding(false);
      setEditing(null);
      await refresh();
    } catch (err) {
      toast.error('Save failed', err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const handleDelete = async (cat: ProductCategory) => {
    if (!window.confirm(`Deactivate "${cat.name}"? Products linked to this category will keep their settings.`)) return;
    try {
      const res = await fetch(`/api/inventory/categories/${cat.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success('Category deactivated', cat.name);
      await refresh();
    } catch (err) {
      toast.error('Delete failed', err instanceof Error ? err.message : 'Unknown error');
    }
  };

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
        <div>
          <div style={{ fontSize: '18px', fontWeight: 700, color: '#0A2342', marginBottom: '4px' }}>Product Categories</div>
          <div style={{ fontSize: '13px', color: '#64748B' }}>
            Categories own default GL accounts and tax settings. Products inherit these
            defaults; per-product overrides win when set.
          </div>
        </div>
        <button style={stl.addBtn} onClick={() => { setAdding(true); setEditing(null); }}>
          <Plus size={14} /> Add Category
        </button>
      </div>

      <div style={{ ...stl.card, padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: '32px', textAlign: 'center', color: '#94A3B8', fontSize: '13px' }}>Loading…</div>
        ) : categories.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#94A3B8' }}>
            <Tag size={32} style={{ margin: '0 auto 12px', display: 'block', color: '#CBD5E1' }} />
            <div style={{ fontSize: '14px', fontWeight: 600, color: '#475569' }}>No categories yet</div>
            <div style={{ fontSize: '13px', marginTop: '4px' }}>Create one to set GL & tax defaults for your products.</div>
          </div>
        ) : (
          <table style={stl.table}>
            <thead>
              <tr style={{ background: '#F8FAFC' }}>
                <th style={stl.th}>Name</th>
                <th style={stl.th}>Revenue</th>
                <th style={stl.th}>COGS</th>
                <th style={stl.th}>Inv. Asset</th>
                <th style={stl.th}>Tax</th>
                <th style={stl.th}>Status</th>
                <th style={{ ...stl.th, textAlign: 'right' as const }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((c) => (
                <tr key={c.id}>
                  <td style={{ ...stl.td, fontWeight: 600 }}>{c.name}</td>
                  <td style={stl.td}>{accountLabel(revenueAccts.find((a) => a.id === c.defaultRevenueGlAccountId))}</td>
                  <td style={stl.td}>{accountLabel(cogsAccts.find((a) => a.id === c.defaultCogsGlAccountId))}</td>
                  <td style={stl.td}>{accountLabel(assetAccts.find((a) => a.id === c.defaultInventoryAssetGlAccountId))}</td>
                  <td style={stl.td}>
                    {c.taxable
                      ? (c.defaultTaxCategory ?? 'general')
                      : <span style={{ ...stl.badge, background: '#FEE2E2', color: '#991B1B' }}>Exempt</span>}
                  </td>
                  <td style={stl.td}>
                    {c.active
                      ? <span style={{ ...stl.badge, background: '#DEF7EC', color: '#03543F' }}>Active</span>
                      : <span style={{ ...stl.badge, background: '#F1F5F9', color: '#64748B' }}>Inactive</span>}
                  </td>
                  <td style={{ ...stl.td, textAlign: 'right' as const }}>
                    <button style={stl.iconBtn} title="Edit" onClick={() => { setEditing(c); setAdding(false); }}>
                      <Edit2 size={16} />
                    </button>
                    {c.active && (
                      <button style={stl.iconBtn} title="Deactivate" onClick={() => handleDelete(c)}>
                        <X size={16} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ marginTop: '12px', fontSize: '12px', color: '#64748B' }}>
        {activeCount} active {activeCount === 1 ? 'category' : 'categories'} · {categories.length - activeCount} inactive
      </div>

      {(adding || editing) && (
        <CategoryModal
          initial={editing}
          revenueAccts={revenueAccts}
          cogsAccts={cogsAccts}
          assetAccts={assetAccts}
          taxCategories={taxCategories}
          onClose={() => { setAdding(false); setEditing(null); }}
          onSave={handleSave}
        />
      )}
    </>
  );
}
