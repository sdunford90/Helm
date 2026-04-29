import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, ChevronRight, Settings, Package,
  Anchor, DollarSign, Edit2, Check, X, ExternalLink,
  Info, ChevronDown,
} from 'lucide-react';
import { api } from '../lib/api';
import { useModules } from '../context/ModulesContext';

/* ── Types ─────────────────────────────────────────────── */

interface GlAccount {
  id: string;
  accountNumber: string;
  name: string;
  type: 'REVENUE' | 'EXPENSE' | 'ASSET' | 'LIABILITY' | 'EQUITY' | string;
  locationId?: string | null;
}

interface DockageRate {
  id: string;
  locationId: string;
  slipType: string;
  monthlyRateCents: number;
  quarterlyRateCents?: number | null;
  annualRateCents?: number | null;
  electricityMode: string;
  electricityRateCents?: number | null;
  glAccountId?: string | null;
  active: boolean;
  location: { name: string };
}

interface ServiceFee {
  id: string;
  locationId: string;
  name: string;
  feeType: string;
  amountCents?: number | null;
  pct?: number | null;
  glAccountId?: string | null;
  active: boolean;
  location: { name: string };
}

interface RentalProductPerLocationRow {
  locationId: string;
  locationName: string;
  override: {
    revenueGlAccountId: string | null;
    cogsGlAccountId: string | null;
    inventoryAssetGlAccountId: string | null;
  };
  effective: {
    revenueGlAccountId: string | null;
    cogsGlAccountId: string | null;
    inventoryAssetGlAccountId: string | null;
  };
}

interface RentalProduct {
  id: string;
  name: string;
  category: string;
  glAccountId?: string | null;
  active: boolean;
  perLocation?: RentalProductPerLocationRow[];
}

interface LocationLite {
  id: string;
  name: string;
  qboConnected: boolean;
}

interface MissingItem {
  kind: 'product' | 'category' | 'dockage_rate' | 'service_fee' | 'rental_product';
  id: string;
  name: string;
  missing: string[];
}

interface MissingMappingWarning {
  locationId: string;
  locationName: string;
  items: MissingItem[];
  totalIssues: number;
}

interface ProductsSummary {
  dockageRates: DockageRate[];
  serviceFees: ServiceFee[];
  rentalProducts: RentalProduct[];
  locations?: LocationLite[];
  glAccounts: GlAccount[];
  unconfiguredCount: number;
  hasGlAccounts: boolean;
  missingMappingWarnings?: MissingMappingWarning[];
}

/* ── Styles ─────────────────────────────────────────────── */

const s: Record<string, React.CSSProperties> = {
  page: { padding: '32px', maxWidth: '1100px' },
  header: { marginBottom: '8px' },
  title: { fontSize: '32px', fontWeight: 700, color: '#0A2342', letterSpacing: '-0.02em', margin: 0 },
  subtitle: { fontSize: '14px', color: '#64748B', marginTop: '4px', marginBottom: '0' },
  divider: {
    height: '4px', background: 'linear-gradient(90deg, #00D4FF, transparent)',
    border: 'none', marginTop: '12px', marginBottom: '28px', borderRadius: '2px',
  },
  breadcrumb: {
    display: 'flex', alignItems: 'center', gap: '6px',
    fontSize: '13px', color: '#64748B', marginBottom: '20px',
  },
  breadcrumbLink: { color: '#0A2342', textDecoration: 'none', fontWeight: 500 },
  warningBanner: {
    display: 'flex', alignItems: 'flex-start', gap: '12px',
    padding: '14px 18px', borderRadius: '8px',
    backgroundColor: '#FFF8E1', border: '1px solid #F59E0B',
    marginBottom: '24px',
  },
  warningText: { fontSize: '14px', color: '#92400E', lineHeight: '1.5' },
  infoBanner: {
    display: 'flex', alignItems: 'center', gap: '12px',
    padding: '12px 18px', borderRadius: '8px',
    backgroundColor: '#F0F9FF', border: '1px solid #BAE6FD',
    marginBottom: '24px', fontSize: '13px', color: '#0369A1',
  },
  sectionCard: {
    background: '#FFFFFF', borderRadius: '10px',
    border: '1px solid #E2E8F0', boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
    marginBottom: '24px', overflow: 'hidden',
  },
  sectionHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '16px 20px', borderBottom: '1px solid #E2E8F0',
    backgroundColor: '#F8FAFC',
  },
  sectionTitle: {
    display: 'flex', alignItems: 'center', gap: '10px',
    fontSize: '15px', fontWeight: 700, color: '#0A2342',
  },
  sectionCount: {
    fontSize: '12px', fontWeight: 600, color: '#64748B',
    backgroundColor: '#E2E8F0', borderRadius: '9999px',
    padding: '2px 8px',
  },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: '14px' },
  th: {
    padding: '10px 16px', backgroundColor: '#F1F5F9',
    fontSize: '11px', fontWeight: 600, color: '#64748B',
    textTransform: 'uppercase' as const, letterSpacing: '0.05em',
    textAlign: 'left' as const, borderBottom: '1px solid #E2E8F0',
  },
  td: { padding: '12px 16px', borderBottom: '1px solid #F1F5F9', color: '#0A2342', verticalAlign: 'middle' as const },
  badge: {
    display: 'inline-block', padding: '2px 8px', borderRadius: '9999px',
    fontSize: '11px', fontWeight: 600,
  },
  select: {
    padding: '6px 10px', borderRadius: '6px', border: '1px solid #CBD5E1',
    fontSize: '13px', color: '#0A2342', backgroundColor: '#FFFFFF',
    cursor: 'pointer', minWidth: '200px',
  },
  saveBtn: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: '28px', height: '28px', borderRadius: '6px',
    border: 'none', cursor: 'pointer', backgroundColor: '#DCFCE7', color: '#16A34A',
  },
  cancelBtn: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: '28px', height: '28px', borderRadius: '6px',
    border: 'none', cursor: 'pointer', backgroundColor: '#FEE2E2', color: '#DC2626',
  },
  editBtn: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: '28px', height: '28px', borderRadius: '6px',
    border: 'none', cursor: 'pointer', backgroundColor: '#F1F5F9', color: '#475569',
  },
  glTag: {
    display: 'inline-flex', alignItems: 'center', gap: '4px',
    padding: '3px 8px', borderRadius: '4px',
    fontSize: '12px', fontWeight: 600,
    backgroundColor: '#EEF2FF', color: '#4338CA',
    fontFamily: '"JetBrains Mono", monospace',
  },
  noGlTag: {
    display: 'inline-flex', alignItems: 'center', gap: '4px',
    padding: '3px 8px', borderRadius: '4px',
    fontSize: '12px', fontWeight: 500,
    backgroundColor: '#FEF3C7', color: '#92400E',
    border: '1px dashed #F59E0B',
  },
  emptyRow: {
    padding: '32px 16px', textAlign: 'center' as const,
    color: '#94A3B8', fontSize: '14px',
  },
};

/* ── GL account selector cell ──── */

function GlAccountCell({
  currentId,
  glAccounts,
  onSave,
  locationId,
  accountType = 'REVENUE',
  qboConnected,
}: {
  currentId: string | null | undefined;
  glAccounts: GlAccount[];
  onSave: (glAccountId: string | null) => Promise<void>;
  locationId?: string | null;
  // Defaults to REVENUE for backwards compatibility (dockage/service-fee
  // cells are revenue-only). Single-location rental editors pass EXPENSE
  // for COGS and ASSET for inventory.
  accountType?: GlAccount['type'];
  // When known, mirrors backend `validateGlAccountForLocation`: QBO-connected
  // locations may *only* select location-scoped accounts; non-QBO locations
  // may select location-scoped OR tenant-wide accounts as a union.
  qboConnected?: boolean;
}) {
  const filtered = (() => {
    const ofType = glAccounts.filter((a) => a.type === accountType);
    if (!locationId) return ofType;
    if (qboConnected === true) {
      return ofType.filter((a) => a.locationId === locationId);
    }
    if (qboConnected === false) {
      return ofType.filter(
        (a) => a.locationId === locationId || a.locationId == null,
      );
    }
    // Legacy fallback for callers (dockage/service-fee) that don't know
    // QBO state: prefer location-scoped accounts; only show tenant-wide
    // accounts if the location has none of its own. Matches the prior
    // behavior so existing call sites don't change semantics.
    const locScoped = ofType.filter((a) => a.locationId === locationId);
    if (locScoped.length > 0) return locScoped;
    return ofType.filter((a) => a.locationId == null);
  })();
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState(currentId ?? '');
  const [saving, setSaving] = useState(false);

  const current = glAccounts.find((a) => a.id === currentId);
  const options = filtered;

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(selected || null);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {current ? (
          <span style={s.glTag}>
            {current.accountNumber} · {current.name}
          </span>
        ) : (
          <span style={s.noGlTag}>
            <AlertTriangle size={11} />
            Not assigned
          </span>
        )}
        <button
          style={s.editBtn}
          title="Assign GL account"
          onClick={() => { setSelected(currentId ?? ''); setEditing(true); }}
        >
          <Edit2 size={13} />
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
      <select
        style={s.select}
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        autoFocus
      >
        <option value="">— No GL account —</option>
        {options.map((a) => (
          <option key={a.id} value={a.id}>
            {a.accountNumber} · {a.name}
          </option>
        ))}
      </select>
      <button style={s.saveBtn} onClick={handleSave} disabled={saving} title="Save">
        <Check size={14} />
      </button>
      <button style={s.cancelBtn} onClick={() => setEditing(false)} title="Cancel">
        <X size={14} />
      </button>
    </div>
  );
}

/* ── Rental product row with per-location GL editor ─────── */

function RentalProductRow({
  product,
  glAccounts,
  locations,
  onSavePerLocation,
}: {
  product: RentalProduct;
  glAccounts: GlAccount[];
  locations: LocationLite[];
  onSavePerLocation: (
    locationId: string,
    override: RentalProductPerLocationRow['override'],
  ) => Promise<void>;
}) {
  const locById = new Map(locations.map((l) => [l.id, l]));
  const [expanded, setExpanded] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, RentalProductPerLocationRow['override']>>({});
  const [savingLoc, setSavingLoc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const perLocation = product.perLocation ?? [];
  // Once mappings exist for a location, the legacy tenant-wide FK is no
  // longer the source of truth there; show only locations that lack an
  // effective revenue account in the badge.
  const missingCount = product.active
    ? perLocation.length === 0
      ? (product.glAccountId ? 0 : 1)
      : perLocation.filter((row) => !row.effective.revenueGlAccountId).length
    : 0;

  // Filter the master GL list to accounts available to the location for the
  // requested type. Mirrors the backend `validateGlAccountForLocation` policy:
  //   - QBO-connected location  -> only that location's accounts are valid
  //   - non-QBO location        -> location-scoped accounts AND tenant-wide
  //                                accounts (locationId === null) are both
  //                                offered (union, not exclusive fallback)
  const accountsForLocation = (locationId: string, type: GlAccount['type']) => {
    const loc = locById.get(locationId);
    const qboConnected = !!loc?.qboConnected;
    const ofType = glAccounts.filter((a) => a.type === type);
    if (qboConnected) {
      return ofType.filter((a) => a.locationId === locationId);
    }
    return ofType.filter(
      (a) => a.locationId === locationId || a.locationId == null,
    );
  };

  const draftFor = (row: RentalProductPerLocationRow): RentalProductPerLocationRow['override'] =>
    drafts[row.locationId] ?? row.override;

  const updateDraft = (
    locationId: string,
    field: keyof RentalProductPerLocationRow['override'],
    value: string | null,
    current: RentalProductPerLocationRow['override'],
  ) => {
    setDrafts((prev) => ({
      ...prev,
      [locationId]: { ...current, [field]: value },
    }));
  };

  const handleSave = async (row: RentalProductPerLocationRow) => {
    setSavingLoc(row.locationId);
    setError(null);
    try {
      await onSavePerLocation(row.locationId, draftFor(row));
      setDrafts((prev) => {
        const copy = { ...prev };
        delete copy[row.locationId];
        return copy;
      });
    } catch (e: any) {
      setError(e?.response?.data?.error ?? e?.message ?? 'Failed to save mapping');
    } finally {
      setSavingLoc(null);
    }
  };

  const fieldDef: Array<{
    field: keyof RentalProductPerLocationRow['override'];
    label: string;
    type: GlAccount['type'];
  }> = [
    { field: 'revenueGlAccountId', label: 'Revenue', type: 'REVENUE' },
    { field: 'cogsGlAccountId', label: 'COGS', type: 'EXPENSE' },
    { field: 'inventoryAssetGlAccountId', label: 'Inventory Asset', type: 'ASSET' },
  ];

  return (
    <div style={{
      border: '1px solid #E2E8F0', borderRadius: '8px',
      marginBottom: '12px', background: '#FFFFFF',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 16px', cursor: 'pointer',
      }}
        onClick={() => setExpanded((v) => !v)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <ChevronDown
            size={16}
            style={{
              transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
              transition: 'transform 120ms ease-out', color: '#475569',
            }}
          />
          <div style={{ fontWeight: 600, color: '#0A2342' }}>{product.name}</div>
          <span style={{ ...s.badge, backgroundColor: '#FFF7ED', color: '#C2410C' }}>
            {product.category || 'Uncategorized'}
          </span>
          <span style={{
            ...s.badge,
            backgroundColor: product.active ? '#DCFCE7' : '#F1F5F9',
            color: product.active ? '#15803D' : '#64748B',
          }}>
            {product.active ? 'Active' : 'Inactive'}
          </span>
        </div>
        <div>
          {missingCount > 0 ? (
            <span style={s.noGlTag}>
              <AlertTriangle size={11} />
              {missingCount} location{missingCount !== 1 ? 's' : ''} unmapped
            </span>
          ) : (
            <span style={{ ...s.glTag, backgroundColor: '#DCFCE7', color: '#15803D' }}>
              <Check size={11} /> All locations mapped
            </span>
          )}
        </div>
      </div>

      {expanded ? (
        <div style={{ borderTop: '1px solid #E2E8F0', padding: '12px 16px', background: '#F8FAFC' }}>
          <div style={{ fontSize: '12px', color: '#64748B', marginBottom: '10px' }}>
            Pick a revenue, COGS, and inventory account for each location.
            QuickBooks-connected locations require an account from their own
            chart of accounts; other locations may use the tenant-wide chart.
          </div>
          {error ? (
            <div style={{
              background: '#FEF2F2', color: '#991B1B', borderRadius: '6px',
              padding: '8px 12px', marginBottom: '10px', fontSize: '12px',
            }}>
              {error}
            </div>
          ) : null}
          {perLocation.length === 0 ? (
            <div style={{ fontSize: '13px', color: '#64748B' }}>
              No locations configured for this tenant.
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '10px' }}>
              {perLocation.map((row) => {
                const draft = draftFor(row);
                const dirty = drafts[row.locationId] !== undefined;
                const missingRevenue = !draft.revenueGlAccountId && !product.glAccountId;
                return (
                  <div key={row.locationId} style={{
                    background: '#FFFFFF', border: '1px solid #E2E8F0',
                    borderRadius: '6px', padding: '10px 12px',
                  }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      marginBottom: '8px',
                    }}>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: '#0A2342' }}>
                        {row.locationName}
                      </div>
                      <button
                        style={{
                          padding: '4px 12px', borderRadius: '6px', border: 'none',
                          cursor: dirty && savingLoc !== row.locationId ? 'pointer' : 'default',
                          backgroundColor: dirty ? '#0A2342' : '#E2E8F0',
                          color: dirty ? '#FFFFFF' : '#94A3B8',
                          fontSize: '12px', fontWeight: 600,
                        }}
                        disabled={!dirty || savingLoc === row.locationId}
                        onClick={() => handleSave(row)}
                      >
                        {savingLoc === row.locationId ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                    {fieldDef.map(({ field, label, type }) => {
                      const accounts = accountsForLocation(row.locationId, type);
                      return (
                        <div key={field} style={{
                          display: 'grid', gridTemplateColumns: '120px 1fr',
                          gap: '8px', alignItems: 'center', marginBottom: '4px',
                        }}>
                          <label style={{ fontSize: '12px', color: '#475569' }}>{label}</label>
                          <select
                            style={{ ...s.select, padding: '6px 10px', fontSize: '12px', minWidth: 0 }}
                            value={draft[field] ?? ''}
                            onChange={(e) => updateDraft(row.locationId, field, e.target.value || null, draft)}
                          >
                            <option value="">
                              {field === 'revenueGlAccountId' && product.glAccountId
                                ? '— Inherit tenant-wide default —'
                                : '— Not mapped —'}
                            </option>
                            {accounts.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.accountNumber} · {a.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      );
                    })}
                    {missingRevenue ? (
                      <div style={{ fontSize: '11px', color: '#9B1C1C', marginTop: '4px' }}>
                        No effective revenue account — invoices for this location will fall back
                        to the General Revenue account.
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

/* ── Single-location flat rental row ───────────────────── */

// Renders a single rental product as one row with three inline GL cells
// (Revenue / COGS / Inventory Asset) for the currently-selected location.
// Used only when the operator has picked a single location in the top-right
// switcher; the cross-location grid editor (RentalProductRow) is preserved
// for the All-locations view.
function FlatRentalProductRow({
  product,
  glAccounts,
  locationId,
  qboConnected,
  onSavePerLocation,
}: {
  product: RentalProduct;
  glAccounts: GlAccount[];
  locationId: string;
  qboConnected: boolean;
  onSavePerLocation: (
    locationId: string,
    override: RentalProductPerLocationRow['override'],
  ) => Promise<void>;
}) {
  // The API in single-location mode narrows perLocation to exactly one
  // entry for the requested location. Fall back to an empty override if
  // the entry is missing (e.g. a product that has never been mapped).
  const row =
    product.perLocation?.find((r) => r.locationId === locationId) ??
    ({
      locationId,
      locationName: '',
      override: {
        revenueGlAccountId: null,
        cogsGlAccountId: null,
        inventoryAssetGlAccountId: null,
      },
      effective: {
        revenueGlAccountId: null,
        cogsGlAccountId: null,
        inventoryAssetGlAccountId: null,
      },
    } as RentalProductPerLocationRow);

  // Each cell saves the merged override (preserving the other two fields)
  // because the per-location PUT endpoint is whole-record, not partial.
  const saveField = (
    field: keyof RentalProductPerLocationRow['override'],
  ) => async (id: string | null) => {
    await onSavePerLocation(locationId, { ...row.override, [field]: id });
  };

  return (
    <tr>
      <td style={s.td}>
        <div style={{ fontWeight: 600, color: '#0A2342' }}>{product.name}</div>
      </td>
      <td style={s.td}>
        <span style={{ ...s.badge, backgroundColor: '#FFF7ED', color: '#C2410C' }}>
          {product.category || 'Uncategorized'}
        </span>
      </td>
      <td style={s.td}>
        <span style={{
          ...s.badge,
          backgroundColor: product.active ? '#DCFCE7' : '#F1F5F9',
          color: product.active ? '#15803D' : '#64748B',
        }}>
          {product.active ? 'Active' : 'Inactive'}
        </span>
      </td>
      <td style={s.td}>
        <GlAccountCell
          currentId={row.effective.revenueGlAccountId}
          glAccounts={glAccounts}
          locationId={locationId}
          qboConnected={qboConnected}
          accountType="REVENUE"
          onSave={saveField('revenueGlAccountId')}
        />
      </td>
      <td style={s.td}>
        <GlAccountCell
          currentId={row.effective.cogsGlAccountId}
          glAccounts={glAccounts}
          locationId={locationId}
          qboConnected={qboConnected}
          accountType="EXPENSE"
          onSave={saveField('cogsGlAccountId')}
        />
      </td>
      <td style={s.td}>
        <GlAccountCell
          currentId={row.effective.inventoryAssetGlAccountId}
          glAccounts={glAccounts}
          locationId={locationId}
          qboConnected={qboConnected}
          accountType="ASSET"
          onSave={saveField('inventoryAssetGlAccountId')}
        />
      </td>
    </tr>
  );
}

/* ── Main component ─────────────────────────────────────── */

export default function SettingsProducts() {
  const { currentLocationId } = useModules();
  const [data, setData] = useState<ProductsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = currentLocationId
        ? `/api/settings/catalog/products-summary?locationId=${encodeURIComponent(currentLocationId)}`
        : '/api/settings/catalog/products-summary';
      const res = await api.get<{ data: ProductsSummary }>(url);
      setData(res.data);
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Failed to load product catalog');
    } finally {
      setLoading(false);
    }
  }, [currentLocationId]);

  useEffect(() => { load(); }, [load]);

  // Recalculate the unconfigured-count badge after any mapping changes. Per-
  // location overrides take precedence over the tenant-wide legacy FK; an
  // active rental product counts as one gap for every location that has
  // neither an override nor a usable legacy fallback.
  const recountUnconfigured = (next: ProductsSummary): number => {
    const drGaps = next.dockageRates.filter((r) => !r.glAccountId).length;
    const sfGaps = next.serviceFees.filter((f) => !f.glAccountId).length;
    const rpGaps = next.rentalProducts
      .filter((p) => p.active)
      .reduce((acc, p) => {
        if (!p.perLocation || p.perLocation.length === 0) {
          return acc + (p.glAccountId ? 0 : 1);
        }
        return acc + p.perLocation.filter((row) => !row.effective.revenueGlAccountId).length;
      }, 0);
    return drGaps + sfGaps + rpGaps;
  };

  const saveDockageRateGl = async (rateId: string, glAccountId: string | null) => {
    const rate = data?.dockageRates.find((r) => r.id === rateId);
    if (!rate) return;
    await api.put(
      `/api/settings/catalog/dockage-rates/${rateId}/gl-mappings/${rate.locationId}`,
      { glAccountId },
    );
    setData((prev) => {
      if (!prev) return prev;
      const rates = prev.dockageRates.map((r) => r.id === rateId ? { ...r, glAccountId } : r);
      const next = { ...prev, dockageRates: rates };
      return { ...next, unconfiguredCount: recountUnconfigured(next) };
    });
  };

  const saveServiceFeeGl = async (feeId: string, glAccountId: string | null) => {
    const fee = data?.serviceFees.find((f) => f.id === feeId);
    if (!fee) return;
    await api.put(
      `/api/settings/catalog/service-fees/${feeId}/gl-mappings/${fee.locationId}`,
      { glAccountId },
    );
    setData((prev) => {
      if (!prev) return prev;
      const fees = prev.serviceFees.map((f) => f.id === feeId ? { ...f, glAccountId } : f);
      const next = { ...prev, serviceFees: fees };
      return { ...next, unconfiguredCount: recountUnconfigured(next) };
    });
  };

  const saveRentalProductPerLocationGl = async (
    productId: string,
    locationId: string,
    override: RentalProductPerLocationRow['override'],
  ) => {
    await api.put(
      `/api/settings/catalog/rental-products/${productId}/gl-mappings/${locationId}`,
      {
        revenueGlAccountId: override.revenueGlAccountId,
        cogsGlAccountId: override.cogsGlAccountId,
        inventoryAssetGlAccountId: override.inventoryAssetGlAccountId,
      },
    );
    setData((prev) => {
      if (!prev) return prev;
      // Mirror the backend resolver: once a location is QBO-connected the
      // tenant-wide RentalProduct.glAccountId is no longer a valid revenue
      // fallback (it points outside that location's chart). Honoring that
      // here keeps the badge / unconfigured count in sync with the warning
      // banner without waiting for a refetch.
      const loc = prev.locations?.find((l) => l.id === locationId);
      const qboConnected = !!loc?.qboConnected;
      const products = prev.rentalProducts.map((p) => {
        if (p.id !== productId) return p;
        const legacyRevenue = qboConnected ? null : p.glAccountId ?? null;
        const perLocation = (p.perLocation ?? []).map((row) => {
          if (row.locationId !== locationId) return row;
          return {
            ...row,
            override,
            effective: {
              revenueGlAccountId: override.revenueGlAccountId ?? legacyRevenue,
              cogsGlAccountId: override.cogsGlAccountId ?? null,
              inventoryAssetGlAccountId: override.inventoryAssetGlAccountId ?? null,
            },
          };
        });
        return { ...p, perLocation };
      });
      const next = { ...prev, rentalProducts: products };
      return { ...next, unconfiguredCount: recountUnconfigured(next) };
    });
  };

  if (loading) {
    return (
      <div style={{ padding: '48px 32px', textAlign: 'center', color: '#64748B' }}>
        Loading product catalog…
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '32px' }}>
        <div style={{ ...s.warningBanner, marginBottom: 0 }}>
          <AlertTriangle size={18} color="#F59E0B" style={{ flexShrink: 0, marginTop: '2px' }} />
          <span style={s.warningText}>{error}</span>
        </div>
      </div>
    );
  }

  const glAccounts = data?.glAccounts ?? [];
  const dockageRates = data?.dockageRates ?? [];
  const serviceFees = data?.serviceFees ?? [];
  const rentalProducts = data?.rentalProducts ?? [];
  const unconfigured = data?.unconfiguredCount ?? 0;
  const hasGlAccounts = data?.hasGlAccounts ?? false;

  return (
    <div style={s.page}>
      <div style={s.breadcrumb}>
        <Link to="/settings" style={s.breadcrumbLink}>Settings</Link>
        <ChevronRight size={14} />
        <span>Products &amp; Revenue</span>
      </div>

      <div style={s.header}>
        <h1 style={s.title} className="helm-page-title">Products &amp; Revenue</h1>
        <p style={s.subtitle}>
          Assign GL accounts to each product and service type to ensure revenue posts to the correct accounts.
        </p>
      </div>
      <hr style={s.divider} />

      {!hasGlAccounts && (
        <div style={s.warningBanner}>
          <AlertTriangle size={18} color="#F59E0B" style={{ flexShrink: 0, marginTop: '2px' }} />
          <div style={s.warningText}>
            <strong>No revenue GL accounts configured.</strong>{' '}
            You must{' '}
            <Link to="/billing/chart-of-accounts" style={{ color: '#D97706', fontWeight: 600 }}>
              set up your Chart of Accounts
            </Link>
            {' '}before you can assign GL accounts to products.
            Until mappings are configured, all revenue will post to the hardcoded General Revenue fallback account.
          </div>
        </div>
      )}

      {hasGlAccounts && unconfigured > 0 && (
        <div style={s.warningBanner}>
          <AlertTriangle size={18} color="#F59E0B" style={{ flexShrink: 0, marginTop: '2px' }} />
          <div style={s.warningText}>
            <strong>{unconfigured} product{unconfigured !== 1 ? 's' : ''} without a GL account mapping.</strong>{' '}
            Revenue from these will fall back to the General Revenue account (4500) when invoices are generated.
            Assign a GL account to each item below to enable proper account routing.
          </div>
        </div>
      )}

      {data?.missingMappingWarnings && data.missingMappingWarnings.length > 0 && (
        <div style={s.warningBanner}>
          <AlertTriangle size={18} color="#F59E0B" style={{ flexShrink: 0, marginTop: '2px' }} />
          <div style={s.warningText}>
            <strong>QuickBooks-connected locations are missing GL mappings:</strong>
            <ul style={{ margin: '6px 0 0 0', paddingLeft: '18px' }}>
              {data.missingMappingWarnings.map((w) => (
                <li key={w.locationId}>
                  <strong>{w.locationName}:</strong> {w.totalIssues} item
                  {w.totalIssues === 1 ? '' : 's'} (
                  {w.items.slice(0, 3).map((it) => it.name).join(', ')}
                  {w.items.length > 3 ? `, +${w.items.length - 3} more` : ''})
                  {' — '}
                  <Link
                    to="/settings/quickbooks"
                    style={{ color: '#92400E', fontWeight: 600 }}
                  >
                    review in QuickBooks Setup
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {hasGlAccounts && unconfigured === 0 && (
        <div style={s.infoBanner}>
          <Check size={16} color="#0369A1" />
          All products have GL account assignments. Revenue will post to the configured accounts.
        </div>
      )}

      {/* ── Dockage Rates ── */}
      <div style={s.sectionCard}>
        <div style={s.sectionHeader}>
          <div style={s.sectionTitle}>
            <Anchor size={18} color="#0A2342" />
            Dockage Rates
            <span style={s.sectionCount}>{dockageRates.length}</span>
          </div>
          <Link
            to="/settings"
            style={{ fontSize: '13px', color: '#0A2342', display: 'flex', alignItems: 'center', gap: '4px', textDecoration: 'none' }}
          >
            <Settings size={13} /> Manage rates
          </Link>
        </div>
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>Location</th>
              <th style={s.th}>Slip Type</th>
              <th style={s.th}>Monthly Rate</th>
              <th style={s.th}>Electricity</th>
              <th style={s.th}>GL Account (Revenue)</th>
            </tr>
          </thead>
          <tbody>
            {dockageRates.length === 0 ? (
              <tr>
                <td colSpan={5} style={s.emptyRow}>
                  No dockage rates configured. Add them in Settings → Catalog.
                </td>
              </tr>
            ) : (
              dockageRates.map((rate) => (
                <tr key={rate.id}>
                  <td style={s.td}>
                    <span style={{ fontSize: '13px', color: '#475569' }}>{rate.location.name}</span>
                  </td>
                  <td style={s.td}>
                    <span style={{ ...s.badge, backgroundColor: '#E0F2FE', color: '#0369A1' }}>
                      {rate.slipType}
                    </span>
                  </td>
                  <td style={s.td}>
                    ${(rate.monthlyRateCents / 100).toFixed(2)}/mo
                  </td>
                  <td style={s.td}>
                    <span style={{ ...s.badge, backgroundColor: '#F0FDF4', color: '#16A34A' }}>
                      {rate.electricityMode === 'FLAT_FEE'
                        ? `Flat $${((rate.electricityRateCents ?? 0) / 100).toFixed(2)}`
                        : 'Metered'}
                    </span>
                  </td>
                  <td style={s.td}>
                    <GlAccountCell
                      currentId={rate.glAccountId}
                      glAccounts={glAccounts}
                      locationId={rate.locationId}
                      onSave={(id) => saveDockageRateGl(rate.id, id)}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ── Service Fees ── */}
      <div style={s.sectionCard}>
        <div style={s.sectionHeader}>
          <div style={s.sectionTitle}>
            <DollarSign size={18} color="#0A2342" />
            Service Fees
            <span style={s.sectionCount}>{serviceFees.length}</span>
          </div>
          <Link
            to="/settings"
            style={{ fontSize: '13px', color: '#0A2342', display: 'flex', alignItems: 'center', gap: '4px', textDecoration: 'none' }}
          >
            <Settings size={13} /> Manage fees
          </Link>
        </div>
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>Fee Name</th>
              <th style={s.th}>Location</th>
              <th style={s.th}>Type</th>
              <th style={s.th}>Amount</th>
              <th style={s.th}>GL Account (Revenue)</th>
            </tr>
          </thead>
          <tbody>
            {serviceFees.length === 0 ? (
              <tr>
                <td colSpan={5} style={s.emptyRow}>
                  No service fees configured. Add them in Settings → Catalog.
                </td>
              </tr>
            ) : (
              serviceFees.map((fee) => (
                <tr key={fee.id}>
                  <td style={s.td}>{fee.name}</td>
                  <td style={s.td}>
                    <span style={{ fontSize: '13px', color: '#475569' }}>{fee.location.name}</span>
                  </td>
                  <td style={s.td}>
                    <span style={{ ...s.badge, backgroundColor: '#F5F3FF', color: '#6D28D9' }}>
                      {fee.feeType}
                    </span>
                  </td>
                  <td style={s.td}>
                    {fee.feeType === 'FLAT' && fee.amountCents != null
                      ? `$${(fee.amountCents / 100).toFixed(2)}`
                      : fee.pct != null
                      ? `${fee.pct}%`
                      : '—'}
                  </td>
                  <td style={s.td}>
                    <GlAccountCell
                      currentId={fee.glAccountId}
                      glAccounts={glAccounts}
                      locationId={fee.locationId}
                      onSave={(id) => saveServiceFeeGl(fee.id, id)}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ── Rental Products ── */}
      <div style={s.sectionCard}>
        <div style={s.sectionHeader}>
          <div style={s.sectionTitle}>
            <Package size={18} color="#0A2342" />
            Rental Products
            <span style={s.sectionCount}>{rentalProducts.length}</span>
          </div>
          <Link
            to="/settings?tab=catalog&section=rentals"
            style={{ fontSize: '13px', color: '#0A2342', display: 'flex', alignItems: 'center', gap: '4px', textDecoration: 'none' }}
          >
            <Settings size={13} /> Manage products
          </Link>
        </div>
        {rentalProducts.length === 0 ? (
          <div style={s.emptyRow}>
            No rental products configured. Add them in Settings → Catalog.
          </div>
        ) : currentLocationId ? (
          // Single-location mode: flat one-row-per-product table with three
          // inline GL cells. Each cell saves a merged override so the other
          // two fields are preserved on the per-location PUT.
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Product</th>
                <th style={s.th}>Category</th>
                <th style={s.th}>Status</th>
                <th style={s.th}>Revenue GL</th>
                <th style={s.th}>COGS GL</th>
                <th style={s.th}>Inventory Asset GL</th>
              </tr>
            </thead>
            <tbody>
              {rentalProducts.map((product) => (
                <FlatRentalProductRow
                  key={product.id}
                  product={product}
                  glAccounts={glAccounts}
                  locationId={currentLocationId}
                  qboConnected={
                    !!data?.locations?.find((l) => l.id === currentLocationId)?.qboConnected
                  }
                  onSavePerLocation={(locationId, override) =>
                    saveRentalProductPerLocationGl(product.id, locationId, override)
                  }
                />
              ))}
            </tbody>
          </table>
        ) : (
          <div style={{ padding: '8px 16px 16px 16px' }}>
            {rentalProducts.map((product) => (
              <RentalProductRow
                key={product.id}
                product={product}
                glAccounts={glAccounts}
                locations={data?.locations ?? []}
                onSavePerLocation={(locationId, override) =>
                  saveRentalProductPerLocationGl(product.id, locationId, override)
                }
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Info footer ── */}
      <div style={{
        padding: '16px 20px', borderRadius: '8px',
        backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0',
        fontSize: '13px', color: '#64748B', lineHeight: '1.6',
      }}>
        <strong style={{ color: '#0A2342', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
          <Info size={14} /> How GL account mapping works
        </strong>
        When an invoice is generated, Helm resolves the revenue GL account for each line item from the product's
        configured mapping above. If a product has no GL account assigned, revenue posts to the General Revenue
        fallback account (4500) and a warning is logged.{' '}
        <Link to="/billing/chart-of-accounts" style={{ color: '#0A2342', fontWeight: 600 }}>
          Manage your Chart of Accounts <ExternalLink size={11} style={{ verticalAlign: 'middle' }} />
        </Link>
        {' '}to add or edit revenue accounts, then assign them to products here.
      </div>
    </div>
  );
}
