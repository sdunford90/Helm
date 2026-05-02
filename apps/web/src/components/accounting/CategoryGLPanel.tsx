import React, { useState, useEffect, useCallback } from 'react';
import { Plus, X, AlertTriangle, Lock, Check } from 'lucide-react';
import { api } from '../../lib/api';
import { useModules } from '../../context/ModulesContext';

interface ProductCategory {
  id: string;
  name: string;
  defaultTaxCategory: string | null;
  taxable: boolean;
  active: boolean;
  isFuelCategory?: boolean;
  costingMethod?: 'FIFO' | 'WAC' | null;
}

interface GlAccount {
  id: string;
  accountNumber: string;
  name: string;
  type: string;
  subType: string | null;
  locationId: string | null;
}

interface GlMapping {
  categoryId: string;
  locationId: string;
  revenueGlAccountId: string | null;
  cogsGlAccountId: string | null;
  inventoryAssetGlAccountId: string | null;
}

const stl = {
  card: { background: '#FFFFFF', borderRadius: '8px', border: '1px solid #E2E8F0', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', padding: '24px' } as React.CSSProperties,
  addBtn: { background: '#0A2342', color: '#FFFFFF', border: 'none', borderRadius: '6px', padding: '10px 16px', fontSize: '14px', fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px' } as React.CSSProperties,
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: '13px' },
  th: { textAlign: 'left' as const, padding: '10px 12px', borderBottom: '1px solid #E2E8F0', color: '#64748B', fontWeight: 600, fontSize: '11px', textTransform: 'uppercase' as const, letterSpacing: '0.05em', background: '#F8FAFC' },
  td: { padding: '10px 12px', borderBottom: '1px solid #F1F5F9', color: '#0A2342', verticalAlign: 'middle' as const },
  select: { padding: '6px 8px', border: '1px solid #CBD5E1', borderRadius: '4px', fontSize: '12px', color: '#0A2342', background: '#FFFFFF', width: '100%' } as React.CSSProperties,
  badge: { display: 'inline-flex', alignItems: 'center', gap: '3px', padding: '2px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 600 } as React.CSSProperties,
  overlay: { position: 'fixed' as const, top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: '#FFFFFF', borderRadius: '10px', width: '520px', maxWidth: '90vw', maxHeight: '90vh', overflowY: 'auto' as const, boxShadow: '0 25px 60px rgba(0,0,0,0.18)' },
  modalHeader: { padding: '20px 24px', borderBottom: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  modalTitle: { fontSize: '18px', fontWeight: 700, color: '#0A2342', margin: 0 },
  modalBody: { padding: '24px', display: 'grid', gap: '16px' } as React.CSSProperties,
  modalFooter: { padding: '16px 24px', borderTop: '1px solid #E2E8F0', display: 'flex', justifyContent: 'flex-end', gap: '8px' },
  field: { display: 'flex', flexDirection: 'column' as const, gap: '6px' },
  label: { fontSize: '12px', fontWeight: 600, color: '#475569' } as React.CSSProperties,
  input: { padding: '10px 12px', border: '1px solid #CBD5E1', borderRadius: '6px', fontSize: '14px', color: '#0A2342' } as React.CSSProperties,
  saveBtn: { background: '#0A2342', color: '#FFFFFF', border: 'none', borderRadius: '6px', padding: '10px 20px', fontSize: '14px', fontWeight: 600, cursor: 'pointer' } as React.CSSProperties,
  cancelBtn: { background: '#FFFFFF', color: '#475569', border: '1px solid #CBD5E1', borderRadius: '6px', padding: '10px 20px', fontSize: '14px', fontWeight: 600, cursor: 'pointer' } as React.CSSProperties,
  closeBtn: { background: 'none', border: 'none', cursor: 'pointer', padding: '4px', color: '#64748B' } as React.CSSProperties,
};

interface AddCategoryModalProps {
  onClose: () => void;
  onSave: (payload: { name: string; defaultTaxCategory: string; taxable: boolean; isFuelCategory: boolean }) => Promise<void>;
}

function AddCategoryModal({ onClose, onSave }: AddCategoryModalProps) {
  const [form, setForm] = useState({ name: '', defaultTaxCategory: 'general', taxable: true, isFuelCategory: false });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      await onSave({ ...form, name: form.name.trim() });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={stl.overlay} onClick={onClose}>
      <div style={stl.modal} onClick={(e) => e.stopPropagation()}>
        <div style={stl.modalHeader}>
          <h2 style={stl.modalTitle}>Add Category</h2>
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
            <label style={stl.label}>Default Tax Category</label>
            <select
              style={stl.input}
              value={form.defaultTaxCategory}
              onChange={(e) => setForm((p) => ({ ...p, defaultTaxCategory: e.target.value }))}
              disabled={!form.taxable}
            >
              <option value="general">General</option>
              <option value="food">Food</option>
              <option value="fuel">Fuel</option>
              <option value="exempt">Exempt</option>
            </select>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 600, color: '#0A2342', cursor: 'pointer' }}>
            <input type="checkbox" checked={form.taxable} onChange={(e) => setForm((p) => ({ ...p, taxable: e.target.checked }))} />
            Taxable
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 600, color: '#0A2342', cursor: 'pointer' }}>
            <input type="checkbox" checked={form.isFuelCategory} onChange={(e) => setForm((p) => ({ ...p, isFuelCategory: e.target.checked }))} />
            Fuel Category (locks costing method to FIFO)
          </label>
        </div>
        <div style={stl.modalFooter}>
          <button style={stl.cancelBtn} onClick={onClose} disabled={saving}>Cancel</button>
          <button style={stl.saveBtn} onClick={() => void handleSave()} disabled={saving || !form.name.trim()}>
            {saving ? 'Creating…' : 'Create Category'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CategoryGLPanel() {
  const { currentLocationId } = useModules();
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [glAccounts, setGlAccounts] = useState<GlAccount[]>([]);
  const [mappings, setMappings] = useState<Record<string, GlMapping>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [savingRow, setSavingRow] = useState<string | null>(null);
  const [savingCosting, setSavingCosting] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!currentLocationId) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      // Use the api helper (which auto-injects the Clerk Bearer token via the
      // global token getter wired in App.tsx) instead of raw fetch — without
      // it, this call 302-redirects to the SPA shell in production and the
      // panel renders an empty category list / "Save failed" alerts.
      const [catsRes, accsRes] = await Promise.all([
        api.get<{ categories: ProductCategory[] }>('/api/inventory/categories?includeInactive=false'),
        api.get<{ data: GlAccount[] }>(`/api/settings/gl-accounts`),
      ]);
      const cats: ProductCategory[] = catsRes.categories ?? [];
      setCategories(cats);

      const locationAccs = (accsRes.data ?? []).filter(
        (a) => a.locationId === currentLocationId || a.locationId == null,
      );
      setGlAccounts(locationAccs);

      // Load mappings for each category at this location.
      //
      // The endpoint returns one row per location of the form:
      //   { locationId, locationName, qboConnected,
      //     override:  { revenueGlAccountId, cogsGlAccountId, inventoryAssetGlAccountId },
      //     effective: { revenueGlAccountId, cogsGlAccountId, inventoryAssetGlAccountId } }
      // We previously read the flat shape, so saved mappings looked
      // "Not mapped" after every reload — and the AccountingHub
      // category counter (which reads the DB directly via setup-status)
      // disagreed with the panel ("5/6 mapped" but every dropdown empty).
      type CategoryGlRow = {
        locationId: string;
        locationName: string;
        qboConnected: boolean;
        override?: { revenueGlAccountId: string | null; cogsGlAccountId: string | null; inventoryAssetGlAccountId: string | null };
        effective?: { revenueGlAccountId: string | null; cogsGlAccountId: string | null; inventoryAssetGlAccountId: string | null };
      };
      const mapEntries: Record<string, GlMapping> = {};
      await Promise.all(
        cats.map(async (cat) => {
          const empty: GlMapping = { categoryId: cat.id, locationId: currentLocationId, revenueGlAccountId: null, cogsGlAccountId: null, inventoryAssetGlAccountId: null };
          try {
            const m = await api.get<{ data: CategoryGlRow[] }>(
              `/api/settings/product-categories/${cat.id}/gl-mappings`,
            );
            const row = (m.data ?? []).find((x) => x.locationId === currentLocationId);
            const slots = row?.effective ?? row?.override ?? null;
            mapEntries[cat.id] = slots
              ? {
                  categoryId: cat.id,
                  locationId: currentLocationId,
                  revenueGlAccountId: slots.revenueGlAccountId ?? null,
                  cogsGlAccountId: slots.cogsGlAccountId ?? null,
                  inventoryAssetGlAccountId: slots.inventoryAssetGlAccountId ?? null,
                }
              : empty;
          } catch {
            mapEntries[cat.id] = empty;
          }
        }),
      );
      setMappings(mapEntries);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [currentLocationId]);

  useEffect(() => { void load(); }, [load]);

  const handleMappingChange = async (categoryId: string, field: keyof Pick<GlMapping, 'revenueGlAccountId' | 'cogsGlAccountId' | 'inventoryAssetGlAccountId'>, value: string | null) => {
    if (!currentLocationId) return;
    const prev = mappings[categoryId];
    const next = { ...prev, [field]: value };
    setMappings((m) => ({ ...m, [categoryId]: next }));
    setSavingRow(categoryId);
    try {
      await api.put(
        `/api/settings/product-categories/${categoryId}/gl-mappings/${currentLocationId}`,
        {
          revenueGlAccountId: next.revenueGlAccountId,
          cogsGlAccountId: next.cogsGlAccountId,
          inventoryAssetGlAccountId: next.inventoryAssetGlAccountId,
        },
      );
    } catch (e: unknown) {
      setMappings((m) => ({ ...m, [categoryId]: prev }));
      alert(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSavingRow(null);
    }
  };

  const handleCostingChange = async (categoryId: string, method: 'FIFO' | 'WAC') => {
    setSavingCosting(categoryId);
    try {
      await api.put(`/api/inventory/categories/${categoryId}`, { costingMethod: method });
      setCategories((prev) => prev.map((c) => c.id === categoryId ? { ...c, costingMethod: method } : c));
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Failed to update costing method');
    } finally {
      setSavingCosting(null);
    }
  };

  const handleAddCategory = async (payload: { name: string; defaultTaxCategory: string; taxable: boolean; isFuelCategory: boolean }) => {
    await api.post('/api/inventory/categories', payload);
    setShowAdd(false);
    await load();
  };

  const accountsOfType = (type: string) => glAccounts.filter((a) => a.type === type);

  const isComplete = (categoryId: string) => {
    const m = mappings[categoryId];
    return m && m.revenueGlAccountId && m.cogsGlAccountId && m.inventoryAssetGlAccountId;
  };

  if (!currentLocationId) {
    return <div style={stl.card}><div style={{ color: '#64748B', fontSize: '14px' }}>Select a location to manage category GL mappings.</div></div>;
  }

  if (loading) {
    return <div style={{ color: '#94A3B8', fontSize: '14px', padding: '24px' }}>Loading categories…</div>;
  }

  if (error) {
    return (
      <div style={{ ...stl.card, border: '1px solid #FECACA', background: '#FEF2F2' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#B91C1C', fontSize: '14px' }}>
          <AlertTriangle size={16} /> {error}
        </div>
      </div>
    );
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div style={{ fontSize: '13px', color: '#64748B' }}>
          {categories.filter((c) => isComplete(c.id)).length} of {categories.length} categories fully mapped
        </div>
        <button style={stl.addBtn} onClick={() => setShowAdd(true)}>
          <Plus size={14} /> Add Category
        </button>
      </div>

      <div style={{ ...stl.card, padding: 0, overflow: 'hidden' }}>
        {categories.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#94A3B8', fontSize: '14px' }}>
            No categories yet. Create one to set GL mappings.
          </div>
        ) : (
          <table style={stl.table}>
            <thead>
              <tr>
                <th style={stl.th}>Category</th>
                <th style={stl.th}>Costing</th>
                <th style={stl.th}>Revenue GL</th>
                <th style={stl.th}>COGS GL</th>
                <th style={stl.th}>Inventory Asset GL</th>
                <th style={stl.th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((cat) => {
                const mapping = mappings[cat.id];
                const complete = isComplete(cat.id);
                const isSaving = savingRow === cat.id;
                const isSavingCosting = savingCosting === cat.id;

                return (
                  <tr key={cat.id} style={{ opacity: isSaving ? 0.7 : 1 }}>
                    <td style={{ ...stl.td, fontWeight: 600 }}>{cat.name}</td>
                    <td style={stl.td}>
                      {cat.isFuelCategory ? (
                        <span style={{ ...stl.badge, background: '#EFF6FF', color: '#1E40AF' }}>
                          <Lock size={10} /> FIFO (Fuel)
                        </span>
                      ) : (
                        <select
                          style={{ ...stl.select, width: 'auto', minWidth: '80px' }}
                          value={cat.costingMethod ?? 'WAC'}
                          disabled={isSavingCosting}
                          onChange={(e) => void handleCostingChange(cat.id, e.target.value as 'FIFO' | 'WAC')}
                        >
                          <option value="WAC">WAC</option>
                          <option value="FIFO">FIFO</option>
                        </select>
                      )}
                    </td>
                    <td style={stl.td}>
                      <select
                        style={stl.select}
                        value={mapping?.revenueGlAccountId ?? ''}
                        disabled={isSaving}
                        onChange={(e) => void handleMappingChange(cat.id, 'revenueGlAccountId', e.target.value || null)}
                      >
                        <option value="">— Not mapped —</option>
                        {accountsOfType('REVENUE').map((a) => (
                          <option key={a.id} value={a.id}>{a.accountNumber} · {a.name}</option>
                        ))}
                      </select>
                    </td>
                    <td style={stl.td}>
                      <select
                        style={stl.select}
                        value={mapping?.cogsGlAccountId ?? ''}
                        disabled={isSaving}
                        onChange={(e) => void handleMappingChange(cat.id, 'cogsGlAccountId', e.target.value || null)}
                      >
                        <option value="">— Not mapped —</option>
                        {accountsOfType('EXPENSE').map((a) => (
                          <option key={a.id} value={a.id}>{a.accountNumber} · {a.name}</option>
                        ))}
                      </select>
                    </td>
                    <td style={stl.td}>
                      <select
                        style={stl.select}
                        value={mapping?.inventoryAssetGlAccountId ?? ''}
                        disabled={isSaving}
                        onChange={(e) => void handleMappingChange(cat.id, 'inventoryAssetGlAccountId', e.target.value || null)}
                      >
                        <option value="">— Not mapped —</option>
                        {accountsOfType('ASSET').map((a) => (
                          <option key={a.id} value={a.id}>{a.accountNumber} · {a.name}</option>
                        ))}
                      </select>
                    </td>
                    <td style={stl.td}>
                      {complete ? (
                        <span style={{ ...stl.badge, background: '#DCFCE7', color: '#15803D' }}>
                          <Check size={11} /> Complete
                        </span>
                      ) : (
                        <span style={{ ...stl.badge, background: '#FEF3C7', color: '#92400E' }}>
                          <AlertTriangle size={11} /> Incomplete
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {showAdd && (
        <AddCategoryModal
          onClose={() => setShowAdd(false)}
          onSave={handleAddCategory}
        />
      )}
    </>
  );
}
