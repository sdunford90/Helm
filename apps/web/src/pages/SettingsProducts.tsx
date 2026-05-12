import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, ChevronRight, Settings, Package,
  Anchor, DollarSign, Edit2, Check, X, ExternalLink,
  Info, ChevronDown, Plus, Trash2,
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

type BillingCadence = 'MONTHLY' | 'QUARTERLY' | 'ANNUAL' | 'SEASONAL';

interface DockageRate {
  id: string;
  locationId: string;
  name?: string | null;
  slipType: string;
  billingCadence?: BillingCadence;
  monthlyRateCents: number;
  quarterlyRateCents?: number | null;
  annualRateCents?: number | null;
  seasonalRateCents?: number | null;
  electricityMode: string;
  electricityRateCents?: number | null;
  glAccountId?: string | null;
  taxClass?: string | null;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  active: boolean;
  location: { name: string };
}

const TAX_CLASS_OPTIONS = ['Standard', 'Tax Exempt', 'Reduced', 'Zero-Rated'];
const CADENCE_LABELS: Record<BillingCadence, string> = {
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  ANNUAL: 'Annual',
  SEASONAL: 'Seasonal',
};

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
  // Rental products are non-inventory — only a revenue mapping is
  // configurable. There's no COGS or inventory-asset slot.
  override: {
    revenueGlAccountId: string | null;
  };
  effective: {
    revenueGlAccountId: string | null;
  };
}

interface RentalProduct {
  id: string;
  name: string;
  category: string;
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
    fontFamily: 'Inter, system-ui, sans-serif', fontVariantNumeric: 'tabular-nums',
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
  addBtn: {
    display: 'inline-flex', alignItems: 'center', gap: '4px',
    padding: '6px 12px', borderRadius: '6px', border: '1px solid #0A2342',
    backgroundColor: '#FFFFFF', color: '#0A2342',
    fontSize: '13px', fontWeight: 600, cursor: 'pointer',
  },
  rowActionBtn: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: '28px', height: '28px', borderRadius: '6px',
    border: 'none', cursor: 'pointer', backgroundColor: '#F1F5F9', color: '#475569',
    marginRight: '4px',
  },
  rowDeleteBtn: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: '28px', height: '28px', borderRadius: '6px',
    border: 'none', cursor: 'pointer', backgroundColor: '#FEE2E2', color: '#DC2626',
  },
  modalOverlay: {
    position: 'fixed' as const, inset: 0, backgroundColor: 'rgba(15, 23, 42, 0.55)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    backgroundColor: '#FFFFFF', borderRadius: '12px', width: '480px',
    maxWidth: '92vw', maxHeight: '92vh', overflowY: 'auto' as const,
    boxShadow: '0 20px 50px rgba(0,0,0,0.25)',
  },
  modalHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '16px 20px', borderBottom: '1px solid #E2E8F0',
  },
  modalTitle: { fontSize: '16px', fontWeight: 700, color: '#0A2342', margin: 0 },
  modalBody: { padding: '20px' },
  modalFooter: {
    display: 'flex', justifyContent: 'flex-end', gap: '8px',
    padding: '14px 20px', borderTop: '1px solid #E2E8F0',
  },
  field: { marginBottom: '14px' },
  label: { display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '6px' },
  input: {
    width: '100%', padding: '8px 10px', borderRadius: '6px',
    border: '1px solid #CBD5E1', fontSize: '14px', color: '#0A2342',
    backgroundColor: '#FFFFFF', boxSizing: 'border-box' as const,
  },
  primaryBtn: {
    padding: '8px 14px', borderRadius: '6px', border: 'none',
    backgroundColor: '#0A2342', color: '#FFFFFF',
    fontSize: '13px', fontWeight: 600, cursor: 'pointer',
  },
  secondaryBtn: {
    padding: '8px 14px', borderRadius: '6px', border: '1px solid #CBD5E1',
    backgroundColor: '#FFFFFF', color: '#475569',
    fontSize: '13px', fontWeight: 600, cursor: 'pointer',
  },
  errorText: {
    background: '#FEF2F2', color: '#991B1B', borderRadius: '6px',
    padding: '8px 12px', marginBottom: '10px', fontSize: '12px',
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
  // Defaults to REVENUE — all current cells (dockage, service-fee, rental
  // product) are revenue-only. The prop is preserved so future editors can
  // narrow to other account types without changing this component.
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
  // The tenant-wide legacy FK has been retired; an active rental product
  // counts as one gap for every location that lacks a per-location override
  // (or one for the whole product when the tenant has no locations yet).
  const missingCount = product.active
    ? perLocation.length === 0
      ? 1
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
            Pick a revenue account for each location. Rental products are
            non-inventory, so no COGS or asset mapping is needed.
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
                const missingRevenue = !draft.revenueGlAccountId;
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
                            <option value="">— Not mapped —</option>
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
                        No revenue account mapped — invoices for this location will fall back
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

// Renders a single rental product as one row with one inline Revenue GL
// cell for the currently-selected location. Rental products are non-
// inventory, so there is no COGS or inventory-asset slot. Used only when
// the operator has picked a single location in the top-right switcher;
// the cross-location grid editor (RentalProductRow) is preserved for the
// All-locations view.
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
      override: { revenueGlAccountId: null },
      effective: { revenueGlAccountId: null },
    } as RentalProductPerLocationRow);

  const saveRevenue = async (id: string | null) => {
    await onSavePerLocation(locationId, { revenueGlAccountId: id });
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
          onSave={saveRevenue}
        />
      </td>
    </tr>
  );
}

/* ── Dockage Rate Modal ─────────────────────────────────── */

interface DockageRateForm {
  id?: string;
  locationId: string;
  name: string;
  slipType: string;
  billingCadence: BillingCadence;
  monthlyRateCents: number | '';
  quarterlyRateCents: number | '';
  annualRateCents: number | '';
  seasonalRateCents: number | '';
  taxClass: string;
  glAccountId: string;
  effectiveFrom: string;
  effectiveTo: string;
  electricityMode: 'METERED' | 'FLAT_FEE';
  electricityRateCents: number | '';
  active: boolean;
}

function DockageRateModal({
  initial,
  locations,
  glAccounts,
  onClose,
  onSave,
}: {
  initial: DockageRateForm | null;
  locations: LocationLite[];
  glAccounts: GlAccount[];
  onClose: () => void;
  onSave: (form: DockageRateForm) => Promise<void>;
}) {
  const [form, setForm] = useState<DockageRateForm>(
    initial ?? {
      locationId: locations[0]?.id ?? '',
      name: '',
      slipType: '',
      billingCadence: 'MONTHLY',
      monthlyRateCents: '',
      quarterlyRateCents: '',
      annualRateCents: '',
      seasonalRateCents: '',
      taxClass: 'Standard',
      glAccountId: '',
      effectiveFrom: '',
      effectiveTo: '',
      electricityMode: 'METERED',
      electricityRateCents: '',
      active: true,
    },
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const upd = <K extends keyof DockageRateForm>(k: K, v: DockageRateForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const handleSave = async () => {
    setErr(null);
    if (!form.locationId) { setErr('Location is required'); return; }
    if (!form.slipType.trim()) { setErr('Slip type is required'); return; }
    if (form.monthlyRateCents === '' || Number(form.monthlyRateCents) < 0) {
      setErr('Monthly rate is required'); return;
    }
    setSaving(true);
    try {
      await onSave(form);
      onClose();
    } catch (e: any) {
      setErr(e?.response?.data?.error ?? e?.message ?? 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={s.modalOverlay} onClick={onClose}>
      <div style={s.modal} onClick={(e) => e.stopPropagation()}>
        <div style={s.modalHeader}>
          <h3 style={s.modalTitle}>{initial?.id ? 'Edit Dockage Rate' : 'Add Dockage Rate'}</h3>
          <button style={s.cancelBtn} onClick={onClose}><X size={14} /></button>
        </div>
        <div style={s.modalBody}>
          {err ? <div style={s.errorText}>{err}</div> : null}
          <div style={s.field}>
            <label style={s.label}>Location *</label>
            <select
              style={s.input}
              value={form.locationId}
              disabled={!!initial?.id}
              onChange={(e) => upd('locationId', e.target.value)}
            >
              <option value="">— Select location —</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>
          <div style={s.field}>
            <label style={s.label}>Plan name</label>
            <input
              style={s.input}
              type="text"
              placeholder='e.g. "2026 Summer Premium"'
              value={form.name}
              onChange={(e) => upd('name', e.target.value)}
            />
          </div>
          <div style={s.field}>
            <label style={s.label}>Slip Type *</label>
            <input
              style={s.input}
              type="text"
              placeholder='e.g. "30ft Open" or "40ft Covered"'
              value={form.slipType}
              onChange={(e) => upd('slipType', e.target.value)}
            />
          </div>
          <div style={s.field}>
            <label style={s.label}>Tax Class</label>
            <select
              style={s.input}
              value={form.taxClass}
              onChange={(e) => upd('taxClass', e.target.value)}
            >
              {TAX_CLASS_OPTIONS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div style={s.field}>
            <label style={s.label}>Revenue GL Account</label>
            <select
              style={s.input}
              value={form.glAccountId}
              onChange={(e) => upd('glAccountId', e.target.value)}
            >
              <option value="">— Not mapped —</option>
              {glAccounts
                .filter((a) => a.type === 'REVENUE')
                .filter((a) => !form.locationId || a.locationId === form.locationId || a.locationId == null)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.accountNumber} · {a.name}
                  </option>
                ))}
            </select>
          </div>
          <div style={s.field}>
            <label style={s.label}>Billing Cadence</label>
            <select
              style={s.input}
              value={form.billingCadence}
              onChange={(e) => upd('billingCadence', e.target.value as BillingCadence)}
            >
              {(['MONTHLY', 'QUARTERLY', 'ANNUAL', 'SEASONAL'] as BillingCadence[]).map((c) => (
                <option key={c} value={c}>{CADENCE_LABELS[c]}</option>
              ))}
            </select>
          </div>
          <div style={s.field}>
            <label style={s.label}>Monthly Rate (USD) *</label>
            <input
              style={s.input}
              type="number"
              step="0.01"
              min="0"
              value={form.monthlyRateCents === '' ? '' : (Number(form.monthlyRateCents) / 100).toFixed(2)}
              onChange={(e) => {
                const v = e.target.value;
                upd('monthlyRateCents', v === '' ? '' : Math.round(parseFloat(v) * 100));
              }}
            />
          </div>
          {form.billingCadence === 'QUARTERLY' && (
            <div style={s.field}>
              <label style={s.label}>Quarterly Rate (USD)</label>
              <input
                style={s.input}
                type="number" step="0.01" min="0"
                value={form.quarterlyRateCents === '' ? '' : (Number(form.quarterlyRateCents) / 100).toFixed(2)}
                onChange={(e) => {
                  const v = e.target.value;
                  upd('quarterlyRateCents', v === '' ? '' : Math.round(parseFloat(v) * 100));
                }}
              />
            </div>
          )}
          {form.billingCadence === 'ANNUAL' && (
            <div style={s.field}>
              <label style={s.label}>Annual Rate (USD)</label>
              <input
                style={s.input}
                type="number" step="0.01" min="0"
                value={form.annualRateCents === '' ? '' : (Number(form.annualRateCents) / 100).toFixed(2)}
                onChange={(e) => {
                  const v = e.target.value;
                  upd('annualRateCents', v === '' ? '' : Math.round(parseFloat(v) * 100));
                }}
              />
            </div>
          )}
          {form.billingCadence === 'SEASONAL' && (
            <div style={s.field}>
              <label style={s.label}>Seasonal Rate (USD)</label>
              <input
                style={s.input}
                type="number" step="0.01" min="0"
                value={form.seasonalRateCents === '' ? '' : (Number(form.seasonalRateCents) / 100).toFixed(2)}
                onChange={(e) => {
                  const v = e.target.value;
                  upd('seasonalRateCents', v === '' ? '' : Math.round(parseFloat(v) * 100));
                }}
              />
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div style={s.field}>
              <label style={s.label}>Effective Start</label>
              <input
                style={s.input}
                type="date"
                value={form.effectiveFrom}
                onChange={(e) => upd('effectiveFrom', e.target.value)}
              />
            </div>
            <div style={s.field}>
              <label style={s.label}>Effective End</label>
              <input
                style={s.input}
                type="date"
                value={form.effectiveTo}
                onChange={(e) => upd('effectiveTo', e.target.value)}
              />
            </div>
          </div>
          <div style={s.field}>
            <label style={s.label}>Electricity</label>
            <select
              style={s.input}
              value={form.electricityMode}
              onChange={(e) => upd('electricityMode', e.target.value as 'METERED' | 'FLAT_FEE')}
            >
              <option value="METERED">Metered</option>
              <option value="FLAT_FEE">Flat fee</option>
            </select>
          </div>
          {form.electricityMode === 'FLAT_FEE' ? (
            <div style={s.field}>
              <label style={s.label}>Flat electricity fee (USD)</label>
              <input
                style={s.input}
                type="number"
                step="0.01"
                min="0"
                value={form.electricityRateCents === '' ? '' : (Number(form.electricityRateCents) / 100).toFixed(2)}
                onChange={(e) => {
                  const v = e.target.value;
                  upd('electricityRateCents', v === '' ? '' : Math.round(parseFloat(v) * 100));
                }}
              />
            </div>
          ) : null}
          <div style={s.field}>
            <label style={{ ...s.label, display: 'flex', alignItems: 'center', gap: '6px' }}>
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => upd('active', e.target.checked)}
              />
              Active
            </label>
          </div>
        </div>
        <div style={s.modalFooter}>
          <button style={s.secondaryBtn} onClick={onClose} disabled={saving}>Cancel</button>
          <button style={s.primaryBtn} onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Service Fee Modal ─────────────────────────────────── */

interface ServiceFeeForm {
  id?: string;
  locationId: string;
  name: string;
  feeType: 'FLAT' | 'PERCENT';
  amountCents: number | '';
  pct: number | '';
  active: boolean;
}

function ServiceFeeModal({
  initial,
  locations,
  onClose,
  onSave,
}: {
  initial: ServiceFeeForm | null;
  locations: LocationLite[];
  onClose: () => void;
  onSave: (form: ServiceFeeForm) => Promise<void>;
}) {
  const [form, setForm] = useState<ServiceFeeForm>(
    initial ?? {
      locationId: locations[0]?.id ?? '',
      name: '',
      feeType: 'FLAT',
      amountCents: '',
      pct: '',
      active: true,
    },
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const upd = <K extends keyof ServiceFeeForm>(k: K, v: ServiceFeeForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const handleSave = async () => {
    setErr(null);
    if (!form.locationId) { setErr('Location is required'); return; }
    if (!form.name.trim()) { setErr('Fee name is required'); return; }
    if (form.feeType === 'FLAT' && (form.amountCents === '' || Number(form.amountCents) < 0)) {
      setErr('Flat amount is required'); return;
    }
    if (form.feeType === 'PERCENT' && (form.pct === '' || Number(form.pct) < 0)) {
      setErr('Percentage is required'); return;
    }
    setSaving(true);
    try {
      await onSave(form);
      onClose();
    } catch (e: any) {
      setErr(e?.response?.data?.error ?? e?.message ?? 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={s.modalOverlay} onClick={onClose}>
      <div style={s.modal} onClick={(e) => e.stopPropagation()}>
        <div style={s.modalHeader}>
          <h3 style={s.modalTitle}>{initial?.id ? 'Edit Service Fee' : 'Add Service Fee'}</h3>
          <button style={s.cancelBtn} onClick={onClose}><X size={14} /></button>
        </div>
        <div style={s.modalBody}>
          {err ? <div style={s.errorText}>{err}</div> : null}
          <div style={s.field}>
            <label style={s.label}>Location *</label>
            <select
              style={s.input}
              value={form.locationId}
              disabled={!!initial?.id}
              onChange={(e) => upd('locationId', e.target.value)}
            >
              <option value="">— Select location —</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>
          <div style={s.field}>
            <label style={s.label}>Fee Name *</label>
            <input
              style={s.input}
              type="text"
              placeholder='e.g. "Pump-out", "Late Payment Fee"'
              value={form.name}
              onChange={(e) => upd('name', e.target.value)}
            />
          </div>
          <div style={s.field}>
            <label style={s.label}>Fee Type *</label>
            <select
              style={s.input}
              value={form.feeType}
              onChange={(e) => upd('feeType', e.target.value as 'FLAT' | 'PERCENT')}
            >
              <option value="FLAT">Flat amount</option>
              <option value="PERCENT">Percentage</option>
            </select>
          </div>
          {form.feeType === 'FLAT' ? (
            <div style={s.field}>
              <label style={s.label}>Amount (USD) *</label>
              <input
                style={s.input}
                type="number"
                step="0.01"
                min="0"
                value={form.amountCents === '' ? '' : (Number(form.amountCents) / 100).toFixed(2)}
                onChange={(e) => {
                  const v = e.target.value;
                  upd('amountCents', v === '' ? '' : Math.round(parseFloat(v) * 100));
                }}
              />
            </div>
          ) : (
            <div style={s.field}>
              <label style={s.label}>Percentage (%) *</label>
              <input
                style={s.input}
                type="number"
                step="0.01"
                min="0"
                value={form.pct === '' ? '' : String(form.pct)}
                onChange={(e) => {
                  const v = e.target.value;
                  upd('pct', v === '' ? '' : parseFloat(v));
                }}
              />
            </div>
          )}
          <div style={s.field}>
            <label style={{ ...s.label, display: 'flex', alignItems: 'center', gap: '6px' }}>
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => upd('active', e.target.checked)}
              />
              Active
            </label>
          </div>
        </div>
        <div style={s.modalFooter}>
          <button style={s.secondaryBtn} onClick={onClose} disabled={saving}>Cancel</button>
          <button style={s.primaryBtn} onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Main component ─────────────────────────────────────── */

export default function SettingsProducts() {
  const { currentLocationId } = useModules();
  const [data, setData] = useState<ProductsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingDockage, setEditingDockage] = useState<DockageRateForm | null>(null);
  const [showDockageModal, setShowDockageModal] = useState(false);
  const [editingFee, setEditingFee] = useState<ServiceFeeForm | null>(null);
  const [showFeeModal, setShowFeeModal] = useState(false);

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

  // Recalculate the unconfigured-count badge after any mapping changes.
  // The legacy tenant-wide FK has been retired, so an active rental product
  // counts as one gap for every location that lacks a per-location revenue
  // override (or one for the whole product when the tenant has no
  // locations).
  const recountUnconfigured = (next: ProductsSummary): number => {
    const drGaps = next.dockageRates.filter((r) => !r.glAccountId).length;
    const sfGaps = next.serviceFees.filter((f) => !f.glAccountId).length;
    const rpGaps = next.rentalProducts
      .filter((p) => p.active)
      .reduce((acc, p) => {
        if (!p.perLocation || p.perLocation.length === 0) {
          return acc + 1;
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

  const saveDockageRate = async (form: DockageRateForm) => {
    const payload = {
      locationId: form.locationId,
      name: form.name.trim() || null,
      slipType: form.slipType.trim(),
      billingCadence: form.billingCadence,
      monthlyRateCents: Number(form.monthlyRateCents),
      quarterlyRateCents: form.quarterlyRateCents === '' ? null : Number(form.quarterlyRateCents),
      annualRateCents: form.annualRateCents === '' ? null : Number(form.annualRateCents),
      seasonalRateCents: form.seasonalRateCents === '' ? null : Number(form.seasonalRateCents),
      taxClass: form.taxClass || 'Standard',
      glAccountId: form.glAccountId || null,
      effectiveFrom: form.effectiveFrom || null,
      effectiveTo: form.effectiveTo || null,
      electricityMode: form.electricityMode,
      electricityRateCents: form.electricityMode === 'FLAT_FEE' && form.electricityRateCents !== ''
        ? Number(form.electricityRateCents)
        : null,
      active: form.active,
    };
    if (form.id) {
      await api.put(`/api/settings/catalog/dockage-rates/${form.id}`, payload);
    } else {
      await api.post('/api/settings/catalog/dockage-rates', payload);
    }
    await load();
  };

  const deleteDockageRate = async (rateId: string, label: string) => {
    if (!window.confirm(`Delete dockage rate "${label}"?`)) return;
    try {
      await api.delete(`/api/settings/catalog/dockage-rates/${rateId}`);
      await load();
    } catch (e: any) {
      window.alert(e?.response?.data?.error ?? 'Failed to delete dockage rate');
    }
  };

  const saveServiceFee = async (form: ServiceFeeForm) => {
    const payload = {
      locationId: form.locationId,
      name: form.name.trim(),
      feeType: form.feeType,
      amountCents: form.feeType === 'FLAT' && form.amountCents !== ''
        ? Number(form.amountCents)
        : null,
      pct: form.feeType === 'PERCENT' && form.pct !== ''
        ? Number(form.pct)
        : null,
      active: form.active,
    };
    if (form.id) {
      await api.put(`/api/settings/catalog/service-fees/${form.id}`, payload);
    } else {
      await api.post('/api/settings/catalog/service-fees', payload);
    }
    await load();
  };

  const deleteServiceFee = async (feeId: string, label: string) => {
    if (!window.confirm(`Delete service fee "${label}"?`)) return;
    try {
      await api.delete(`/api/settings/catalog/service-fees/${feeId}`);
      await load();
    } catch (e: any) {
      window.alert(e?.response?.data?.error ?? 'Failed to delete service fee');
    }
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
      },
    );
    setData((prev) => {
      if (!prev) return prev;
      // The legacy tenant-wide RentalProduct.glAccountId column has been
      // retired, so the per-location override is the sole source for the
      // effective slots. When an override clears a slot the effective
      // value falls back to null, which keeps the badge / unconfigured
      // count in sync with the warning banner without waiting for a
      // refetch.
      const products = prev.rentalProducts.map((p) => {
        if (p.id !== productId) return p;
        const perLocation = (p.perLocation ?? []).map((row) => {
          if (row.locationId !== locationId) return row;
          return {
            ...row,
            override,
            effective: {
              revenueGlAccountId: override.revenueGlAccountId ?? null,
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
          <button
            type="button"
            style={s.addBtn}
            onClick={() => { setEditingDockage(null); setShowDockageModal(true); }}
          >
            <Plus size={14} /> Add rate
          </button>
        </div>
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>Location</th>
              <th style={s.th}>Plan</th>
              <th style={s.th}>Slip Type</th>
              <th style={s.th}>Cadence</th>
              <th style={s.th}>Monthly Rate</th>
              <th style={s.th}>Effective</th>
              <th style={s.th}>Electricity</th>
              <th style={s.th}>GL Account (Revenue)</th>
              <th style={s.th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {dockageRates.length === 0 ? (
              <tr>
                <td colSpan={9} style={s.emptyRow}>
                  No dockage rates configured. Click "Add rate" to create one.
                </td>
              </tr>
            ) : (
              dockageRates.map((rate) => (
                <tr key={rate.id}>
                  <td style={s.td}>
                    <span style={{ fontSize: '13px', color: '#475569' }}>{rate.location.name}</span>
                  </td>
                  <td style={s.td}>
                    <span style={{ fontSize: '13px', color: '#0A2342', fontWeight: 600 }}>
                      {rate.name || <span style={{ color: '#94A3B8', fontWeight: 400 }}>—</span>}
                    </span>
                  </td>
                  <td style={s.td}>
                    <span style={{ ...s.badge, backgroundColor: '#E0F2FE', color: '#0369A1' }}>
                      {rate.slipType}
                    </span>
                  </td>
                  <td style={s.td}>
                    <span style={{ fontSize: '12px', color: '#475569' }}>
                      {CADENCE_LABELS[(rate.billingCadence ?? 'MONTHLY') as BillingCadence]}
                    </span>
                  </td>
                  <td style={s.td}>
                    ${(rate.monthlyRateCents / 100).toFixed(2)}/mo
                  </td>
                  <td style={s.td}>
                    <span style={{ fontSize: '12px', color: '#64748B' }}>
                      {rate.effectiveFrom ? rate.effectiveFrom.slice(0, 10) : '—'}
                      {rate.effectiveTo ? ` → ${rate.effectiveTo.slice(0, 10)}` : ''}
                    </span>
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
                  <td style={s.td}>
                    <button
                      type="button"
                      style={s.rowActionBtn}
                      title="Edit dockage rate"
                      onClick={() => {
                        setEditingDockage({
                          id: rate.id,
                          locationId: rate.locationId,
                          name: rate.name ?? '',
                          slipType: rate.slipType,
                          billingCadence: (rate.billingCadence ?? 'MONTHLY') as BillingCadence,
                          monthlyRateCents: rate.monthlyRateCents,
                          quarterlyRateCents: rate.quarterlyRateCents ?? '',
                          annualRateCents: rate.annualRateCents ?? '',
                          seasonalRateCents: rate.seasonalRateCents ?? '',
                          taxClass: rate.taxClass ?? 'Standard',
                          glAccountId: rate.glAccountId ?? '',
                          effectiveFrom: rate.effectiveFrom ? rate.effectiveFrom.slice(0, 10) : '',
                          effectiveTo: rate.effectiveTo ? rate.effectiveTo.slice(0, 10) : '',
                          electricityMode: (rate.electricityMode === 'FLAT_FEE' ? 'FLAT_FEE' : 'METERED'),
                          electricityRateCents: rate.electricityRateCents ?? '',
                          active: rate.active,
                        });
                        setShowDockageModal(true);
                      }}
                    >
                      <Edit2 size={13} />
                    </button>
                    <button
                      type="button"
                      style={s.rowDeleteBtn}
                      title="Delete dockage rate"
                      onClick={() => deleteDockageRate(rate.id, `${rate.location.name} · ${rate.slipType}`)}
                    >
                      <Trash2 size={13} />
                    </button>
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
          <button
            type="button"
            style={s.addBtn}
            onClick={() => { setEditingFee(null); setShowFeeModal(true); }}
          >
            <Plus size={14} /> Add fee
          </button>
        </div>
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>Fee Name</th>
              <th style={s.th}>Location</th>
              <th style={s.th}>Type</th>
              <th style={s.th}>Amount</th>
              <th style={s.th}>GL Account (Revenue)</th>
              <th style={s.th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {serviceFees.length === 0 ? (
              <tr>
                <td colSpan={6} style={s.emptyRow}>
                  No service fees configured. Click "Add fee" to create one.
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
                  <td style={s.td}>
                    <button
                      type="button"
                      style={s.rowActionBtn}
                      title="Edit service fee"
                      onClick={() => {
                        setEditingFee({
                          id: fee.id,
                          locationId: fee.locationId,
                          name: fee.name,
                          feeType: (fee.feeType === 'PERCENT' ? 'PERCENT' : 'FLAT'),
                          amountCents: fee.amountCents ?? '',
                          pct: fee.pct ?? '',
                          active: fee.active,
                        });
                        setShowFeeModal(true);
                      }}
                    >
                      <Edit2 size={13} />
                    </button>
                    <button
                      type="button"
                      style={s.rowDeleteBtn}
                      title="Delete service fee"
                      onClick={() => deleteServiceFee(fee.id, fee.name)}
                    >
                      <Trash2 size={13} />
                    </button>
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
            to="/rentals"
            style={{ fontSize: '13px', color: '#0A2342', display: 'flex', alignItems: 'center', gap: '4px', textDecoration: 'none' }}
          >
            <Settings size={13} /> Manage products
          </Link>
        </div>
        {rentalProducts.length === 0 ? (
          <div style={s.emptyRow}>
            No rental products configured. Add them on the Rentals page.
          </div>
        ) : currentLocationId ? (
          // Single-location mode: flat one-row-per-product table with a
          // single inline Revenue GL cell. Rental products are non-
          // inventory, so there is no COGS or Inventory Asset slot.
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Product</th>
                <th style={s.th}>Category</th>
                <th style={s.th}>Status</th>
                <th style={s.th}>Revenue GL</th>
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

      {showDockageModal ? (
        <DockageRateModal
          initial={editingDockage}
          locations={data?.locations ?? []}
          glAccounts={glAccounts}
          onClose={() => { setShowDockageModal(false); setEditingDockage(null); }}
          onSave={saveDockageRate}
        />
      ) : null}

      {showFeeModal ? (
        <ServiceFeeModal
          initial={editingFee}
          locations={data?.locations ?? []}
          onClose={() => { setShowFeeModal(false); setEditingFee(null); }}
          onSave={saveServiceFee}
        />
      ) : null}
    </div>
  );
}
