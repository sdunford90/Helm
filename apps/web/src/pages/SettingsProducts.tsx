import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, ChevronRight, Settings, Package, Zap,
  Anchor, DollarSign, Edit2, Check, X, ExternalLink,
  Info, Plus, ChevronDown,
} from 'lucide-react';
import { api } from '../lib/api';

/* ── Types ─────────────────────────────────────────────── */

interface GlAccount {
  id: string;
  accountNumber: string;
  name: string;
  type: string;
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

interface RentalProduct {
  id: string;
  name: string;
  category: string;
  glAccountId?: string | null;
  active: boolean;
}

interface MissingItem {
  kind: 'product' | 'category' | 'dockage_rate' | 'service_fee';
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
}: {
  currentId: string | null | undefined;
  glAccounts: GlAccount[];
  onSave: (glAccountId: string | null) => Promise<void>;
  locationId?: string | null;
}) {
  // For per-location mappings, prefer location-scoped accounts. Tenant-wide
  // accounts (locationId == null) are only allowed as a fallback when the
  // location has no per-location chart of accounts pulled yet (i.e. is not
  // QBO-connected). The backend mapping validator enforces the same rule, so
  // showing tenant-wide options once a location has its own accounts would
  // produce save failures.
  const filtered = (() => {
    if (!locationId) return glAccounts;
    const locScoped = glAccounts.filter((a) => a.locationId === locationId);
    if (locScoped.length > 0) return locScoped;
    return glAccounts.filter((a) => a.locationId == null);
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

/* ── Main component ─────────────────────────────────────── */

export default function SettingsProducts() {
  const [data, setData] = useState<ProductsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ data: ProductsSummary }>('/api/settings/catalog/products-summary');
      setData(res.data);
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Failed to load product catalog');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

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
      return {
        ...prev,
        dockageRates: rates,
        unconfiguredCount:
          rates.filter((r) => !r.glAccountId).length +
          prev.serviceFees.filter((f) => !f.glAccountId).length +
          prev.rentalProducts.filter((p) => p.active && !p.glAccountId).length,
      };
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
      return {
        ...prev,
        serviceFees: fees,
        unconfiguredCount:
          prev.dockageRates.filter((r) => !r.glAccountId).length +
          fees.filter((f) => !f.glAccountId).length +
          prev.rentalProducts.filter((p) => p.active && !p.glAccountId).length,
      };
    });
  };

  const saveRentalProductGl = async (productId: string, glAccountId: string | null) => {
    await api.put(`/api/settings/catalog/rental-products/${productId}/gl-account`, { glAccountId });
    setData((prev) => {
      if (!prev) return prev;
      const products = prev.rentalProducts.map((p) => p.id === productId ? { ...p, glAccountId } : p);
      return {
        ...prev,
        rentalProducts: products,
        unconfiguredCount:
          prev.dockageRates.filter((r) => !r.glAccountId).length +
          prev.serviceFees.filter((f) => !f.glAccountId).length +
          products.filter((p) => p.active && !p.glAccountId).length,
      };
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
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>Product Name</th>
              <th style={s.th}>Category</th>
              <th style={s.th}>Status</th>
              <th style={s.th}>GL Account (Revenue)</th>
            </tr>
          </thead>
          <tbody>
            {rentalProducts.length === 0 ? (
              <tr>
                <td colSpan={4} style={s.emptyRow}>
                  No rental products configured. Add them in Settings → Catalog.
                </td>
              </tr>
            ) : (
              rentalProducts.map((product) => (
                <tr key={product.id}>
                  <td style={s.td}>{product.name}</td>
                  <td style={s.td}>
                    <span style={{ ...s.badge, backgroundColor: '#FFF7ED', color: '#C2410C' }}>
                      {product.category}
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
                      currentId={product.glAccountId}
                      glAccounts={glAccounts}
                      onSave={(id) => saveRentalProductGl(product.id, id)}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
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
