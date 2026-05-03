import { useState, useCallback, useMemo } from 'react';
import { X, Plus, Trash2, Save, Send, Package, Tag, Anchor, Wrench, Sailboat } from 'lucide-react';
import { formatCents } from '../lib/format';
import { useApi } from '../hooks/useApi';

/* ─── Types ─── */

type LineKind = 'PRODUCT' | 'CUSTOM';
type DiscountMode = 'AMOUNT' | 'PERCENT';

interface LineItem {
  id: number;
  kind: LineKind;
  productId: string | null;
  glAccountId: string | null;
  description: string;
  qty: number;
  unitPrice: number; // cents
  taxRate: number;   // percentage e.g. 7
  // Per-line discount. Stored as the raw cashier input (dollars or percent)
  // plus a mode flag; cents are derived in lineDiscount(). Toggling $/%
  // resets the value to 0 so a "10" never silently flips between $10 and
  // 10% — the cashier always re-enters the number in the new unit.
  discountMode: DiscountMode;
  discountValue: number; // dollars when AMOUNT, percent (0-100) when PERCENT
  pickerOpen: boolean;
  pickerQuery: string;
}

interface InvoiceFormProps {
  onClose: () => void;
  currentLocationId: string | null;
  onSaveDraft?: (data: Record<string, unknown>) => Promise<{ id: string } | null | undefined>;
  onFinalize?: (data: Record<string, unknown>) => Promise<{ id: string } | null | undefined>;
}

interface CustomerOption {
  id: string;
  firstName: string;
  lastName: string;
  company?: string | null;
}

interface ApiProduct {
  id: string;
  name: string;
  sku: string | null;
  priceCents: number;
  taxClass: string | null;
}

interface ApiGlAccount {
  id: string;
  accountNumber: string;
  name: string;
  type: string;
  active: boolean;
  isActive: boolean;
}

interface ApiServiceFee {
  id: string;
  name: string;
  feeType: 'FLAT' | 'PERCENT';
  amountCents: number | null;
  pct: number | null;
  glAccountId: string | null;
  active: boolean;
  glMappings?: { glAccountId: string | null }[];
}

interface ApiDockageRate {
  id: string;
  slipType: string;
  monthlyRateCents: number;
  quarterlyRateCents: number | null;
  annualRateCents: number | null;
  glAccountId: string | null;
  active: boolean;
  glMappings?: { glAccountId: string | null }[];
}

interface ApiRentalProduct {
  id: string;
  name: string;
  category: string | null;
  basePriceCents: number;
  hourlyRateCents: number | null;
  dailyRateCents: number | null;
  weeklyRateCents: number | null;
  active: boolean;
  glMappings?: { revenueGlAccountId: string | null }[];
}

type CatalogKind = 'PRODUCT' | 'SERVICE_FEE' | 'DOCKAGE' | 'RENTAL';

interface CatalogItem {
  kind: CatalogKind;
  id: string;
  label: string;
  sublabel?: string;
  priceCents: number;
  glAccountId: string | null;     // resolved revenue GL (per-location mapping → fallback)
  productId: string | null;        // only set for true Product items
  needsManualPrice: boolean;       // true for percent service fees etc.
}

/* ─── Styles ─── */
const mono: React.CSSProperties = { fontFamily: '"JetBrains Mono", monospace' };

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, backgroundColor: 'rgba(10,35,66,0.55)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
  },
  modal: {
    backgroundColor: '#FFFFFF', borderRadius: '8px', width: '880px', maxHeight: '90vh',
    overflow: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '24px 32px', borderBottom: '1px solid #E2E8F0',
  },
  headerTitle: {
    fontSize: '22px', fontWeight: 700, color: '#0A2342', letterSpacing: '-0.02em', margin: 0,
  },
  closeBtn: {
    background: 'none', border: 'none', cursor: 'pointer', color: '#2E4A6B', padding: '4px',
  },
  body: { padding: '32px' },
  fieldGroup: { marginBottom: '24px' },
  label: {
    display: 'block', fontSize: '13px', fontWeight: 600, color: '#2E4A6B',
    textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px',
  },
  input: {
    width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #CCCCCC',
    fontSize: '14px', color: '#0A2342', boxSizing: 'border-box',
  },
  customerDropdown: {
    position: 'absolute', top: '100%', left: 0, right: 0, backgroundColor: '#FFFFFF',
    border: '1px solid #CCCCCC', borderRadius: '0 0 6px 6px', maxHeight: '180px',
    overflowY: 'auto', zIndex: 10, boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
  },
  customerOption: {
    padding: '8px 12px', fontSize: '14px', color: '#0A2342', cursor: 'pointer',
    borderBottom: '1px solid #F2F4F6',
  },
  row: { display: 'flex', gap: '16px' },
  lineCard: {
    border: '1px solid #E2E8F0', borderRadius: '8px', padding: '12px',
    marginBottom: '8px', backgroundColor: '#FAFBFC',
  },
  lineGrid: {
    display: 'grid', gridTemplateColumns: '2.1fr 0.5fr 0.9fr 1.1fr 0.6fr 0.9fr 32px',
    gap: '8px', alignItems: 'center',
  },
  lineHeader: {
    display: 'grid', gridTemplateColumns: '2.1fr 0.5fr 0.9fr 1.1fr 0.6fr 0.9fr 32px',
    gap: '8px', marginBottom: '8px', padding: '0 12px',
  },
  discountWrap: {
    display: 'flex', alignItems: 'stretch', border: '1px solid #CCCCCC',
    borderRadius: '6px', overflow: 'hidden', backgroundColor: '#FFFFFF',
  },
  discountInput: {
    flex: 1, padding: '8px 8px', border: 'none', fontSize: '13px',
    color: '#0A2342', boxSizing: 'border-box', width: '100%', outline: 'none',
    ...mono, textAlign: 'right',
  },
  discountToggle: {
    padding: '0 8px', fontSize: '12px', fontWeight: 700, color: '#2E4A6B',
    backgroundColor: '#F2F4F6', border: 'none', borderLeft: '1px solid #CCCCCC',
    cursor: 'pointer', minWidth: '28px',
  },
  lineInput: {
    padding: '8px 10px', borderRadius: '6px', border: '1px solid #CCCCCC',
    fontSize: '13px', color: '#0A2342', boxSizing: 'border-box', width: '100%',
  },
  lineInputMono: {
    padding: '8px 10px', borderRadius: '6px', border: '1px solid #CCCCCC',
    fontSize: '13px', color: '#0A2342', boxSizing: 'border-box', width: '100%',
    ...mono, textAlign: 'right',
  },
  removeBtn: {
    background: 'none', border: 'none', cursor: 'pointer', color: '#B71C1C', padding: '4px',
  },
  addLineBtn: {
    display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 14px',
    fontSize: '13px', fontWeight: 600, color: '#0A2342', backgroundColor: '#F2F4F6',
    border: '1px solid #CCCCCC', borderRadius: '6px', cursor: 'pointer', marginTop: '4px',
  },
  pickerWrap: { position: 'relative' },
  pickerDropdown: {
    position: 'absolute', top: '100%', left: 0, right: 0, backgroundColor: '#FFFFFF',
    border: '1px solid #CCCCCC', borderRadius: '0 0 6px 6px', maxHeight: '220px',
    overflowY: 'auto', zIndex: 20, boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
  },
  pickerOption: {
    padding: '8px 12px', fontSize: '13px', color: '#0A2342', cursor: 'pointer',
    borderBottom: '1px solid #F2F4F6', display: 'flex', justifyContent: 'space-between', gap: '8px',
  },
  pickerOptionMuted: {
    padding: '10px 12px', fontSize: '12px', color: '#64748B', borderBottom: '1px solid #F2F4F6',
  },
  pickerCustomOption: {
    padding: '10px 12px', fontSize: '13px', fontWeight: 600, color: '#0A2342', cursor: 'pointer',
    backgroundColor: '#F2F4F6', display: 'flex', alignItems: 'center', gap: '8px',
  },
  lineMeta: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    marginTop: '8px', fontSize: '12px', color: '#64748B', gap: '12px',
  },
  metaTag: {
    display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 8px',
    borderRadius: '12px', fontSize: '11px', fontWeight: 600,
  },
  metaTagProduct: { backgroundColor: '#E0F2FE', color: '#075985' },
  metaTagCustom: { backgroundColor: '#FEF3C7', color: '#92400E' },
  metaTagMissing: { backgroundColor: '#FEE2E2', color: '#991B1B' },
  glSelect: {
    flex: 1, padding: '6px 10px', borderRadius: '6px', border: '1px solid #CCCCCC',
    fontSize: '12px', color: '#0A2342', backgroundColor: '#FFFFFF',
  },
  linkBtn: {
    background: 'none', border: 'none', color: '#0A2342', textDecoration: 'underline',
    cursor: 'pointer', fontSize: '12px', padding: 0,
  },
  totalsSection: {
    display: 'flex', justifyContent: 'flex-end', marginTop: '24px',
  },
  totalsTable: { width: '280px' },
  totalsRow: {
    display: 'flex', justifyContent: 'space-between', padding: '6px 0',
    fontSize: '14px', color: '#0A2342',
  },
  totalsFinal: {
    display: 'flex', justifyContent: 'space-between', padding: '10px 0',
    fontSize: '18px', fontWeight: 700, color: '#0A2342', borderTop: '2px solid #0A2342',
    marginTop: '4px',
  },
  footer: {
    display: 'flex', justifyContent: 'flex-end', gap: '12px',
    padding: '24px 32px', borderTop: '1px solid #E2E8F0',
  },
  secondaryBtn: {
    display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '10px 24px',
    fontSize: '14px', fontWeight: 600, color: '#0A2342', backgroundColor: '#FFFFFF',
    border: '1px solid #CCCCCC', borderRadius: '6px', cursor: 'pointer',
  },
  primaryBtn: {
    display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '10px 24px',
    fontSize: '14px', fontWeight: 600, color: '#FFFFFF', backgroundColor: '#0A2342',
    border: 'none', borderRadius: '6px', cursor: 'pointer',
  },
  colLabel: {
    fontSize: '11px', fontWeight: 600, color: '#2E4A6B', textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
};

let nextId = 1;
function blankLine(): LineItem {
  return {
    id: nextId++,
    kind: 'PRODUCT',
    productId: null,
    glAccountId: null,
    description: '',
    qty: 1,
    unitPrice: 0,
    taxRate: 7,
    discountMode: 'AMOUNT',
    discountValue: 0,
    pickerOpen: false,
    pickerQuery: '',
  };
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

const customerDisplayName = (c: CustomerOption) =>
  c.company ?? `${c.firstName} ${c.lastName}`.trim();

export default function InvoiceForm({ onClose, currentLocationId, onSaveDraft, onFinalize }: InvoiceFormProps) {
  const [customerId, setCustomerId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerOpen, setCustomerOpen] = useState(false);
  const [issuedDate, setIssuedDate] = useState(todayIso());
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineItem[]>([blankLine()]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const locQs = currentLocationId ? `?locationId=${encodeURIComponent(currentLocationId)}` : '';
  const { data: apiCustomers } = useApi<{ data: CustomerOption[] }>(
    'get', '/api/customers', { immediate: true },
  );
  const { data: apiProductsResp } = useApi<{ data: ApiProduct[] }>(
    'get', `/api/pos/products${locQs}`, { immediate: true },
  );
  const { data: apiGlResp } = useApi<{ data: ApiGlAccount[] }>(
    'get', `/api/settings/gl-accounts${locQs}`, { immediate: true },
  );
  const { data: apiServiceFeesResp } = useApi<{ data: ApiServiceFee[] }>(
    'get', `/api/settings/catalog/service-fees${locQs}`, { immediate: true },
  );
  const { data: apiDockageResp } = useApi<{ data: ApiDockageRate[] }>(
    'get', `/api/settings/catalog/dockage-rates${locQs}`, { immediate: true },
  );
  const { data: apiRentalsResp } = useApi<{ data: ApiRentalProduct[] }>(
    'get', `/api/rentals/products${locQs}`, { immediate: true },
  );

  const customers = apiCustomers?.data ?? [];
  const products = useMemo(() => apiProductsResp?.data ?? [], [apiProductsResp]);
  const productById = useMemo(() => {
    const m = new Map<string, ApiProduct>();
    for (const p of products) m.set(p.id, p);
    return m;
  }, [products]);
  const revenueGlAccounts = useMemo(() => {
    return (apiGlResp?.data ?? []).filter(
      (g) => g.type === 'REVENUE' && g.active && g.isActive,
    );
  }, [apiGlResp]);

  // ── Build a unified catalog (products + service fees + dockage rates +
  // rental products) so the cashier can pick anything sellable from one
  // typeahead. Resolved GL prefers the per-location mapping, falling back to
  // the catalog item's own glAccountId, then null (which forces the cashier to
  // pick a revenue GL inline). All cents prices are best-effort defaults; the
  // user can still adjust qty/unit price per line.
  const catalog: CatalogItem[] = useMemo(() => {
    const items: CatalogItem[] = [];

    for (const p of products) {
      items.push({
        kind: 'PRODUCT', id: p.id,
        label: p.name,
        sublabel: p.sku ?? undefined,
        priceCents: p.priceCents,
        glAccountId: null,
        productId: p.id,
        needsManualPrice: false,
      });
    }

    for (const f of (apiServiceFeesResp?.data ?? []).filter((f) => f.active)) {
      const mappingGl = f.glMappings?.[0]?.glAccountId ?? null;
      const isPct = f.feeType === 'PERCENT';
      items.push({
        kind: 'SERVICE_FEE', id: `fee:${f.id}`,
        label: f.name,
        sublabel: isPct ? `Service fee · ${f.pct ?? 0}%` : 'Flat service fee',
        priceCents: isPct ? 0 : (f.amountCents ?? 0),
        glAccountId: mappingGl ?? f.glAccountId ?? null,
        productId: null,
        needsManualPrice: isPct || (f.amountCents ?? 0) <= 0,
      });
    }

    for (const d of (apiDockageResp?.data ?? []).filter((d) => d.active)) {
      const mappingGl = d.glMappings?.[0]?.glAccountId ?? null;
      items.push({
        kind: 'DOCKAGE', id: `dock:${d.id}`,
        label: `${d.slipType} — Monthly Slip`,
        sublabel: 'Dockage rate',
        priceCents: d.monthlyRateCents,
        glAccountId: mappingGl ?? d.glAccountId ?? null,
        productId: null,
        needsManualPrice: false,
      });
    }

    for (const r of (apiRentalsResp?.data ?? []).filter((r) => r.active)) {
      const mappingGl = r.glMappings?.[0]?.revenueGlAccountId ?? null;
      const price = r.dailyRateCents ?? r.basePriceCents ?? r.hourlyRateCents ?? 0;
      const period = r.dailyRateCents != null ? 'per day'
        : r.hourlyRateCents != null && r.basePriceCents === 0 ? 'per hour'
        : 'base';
      items.push({
        kind: 'RENTAL', id: `rent:${r.id}`,
        label: r.name,
        sublabel: r.category ? `Rental · ${r.category} (${period})` : `Rental (${period})`,
        priceCents: price,
        glAccountId: mappingGl,
        productId: null,
        needsManualPrice: price <= 0,
      });
    }

    return items;
  }, [products, apiServiceFeesResp, apiDockageResp, apiRentalsResp]);

  const filteredCustomers = customers.filter((c) =>
    customerDisplayName(c).toLowerCase().includes(customerName.toLowerCase())
  );

  const catalogMatches = (q: string): CatalogItem[] => {
    const needle = q.trim().toLowerCase();
    const list = needle
      ? catalog.filter((i) => `${i.label} ${i.sublabel ?? ''}`.toLowerCase().includes(needle))
      : catalog;
    // Keep grouped output: products first, then services/dockage/rentals,
    // up to 30 total to keep the dropdown usable on phones.
    const order: Record<CatalogKind, number> = { PRODUCT: 0, SERVICE_FEE: 1, DOCKAGE: 2, RENTAL: 3 };
    return [...list].sort((a, b) => order[a.kind] - order[b.kind]).slice(0, 30);
  };

  const updateLine = useCallback((id: number, patch: Partial<LineItem>) => {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }, []);

  const removeLine = (id: number) => {
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((l) => l.id !== id)));
  };

  const addLine = () => setLines((prev) => [...prev, blankLine()]);

  const selectCatalogItemForLine = (lineId: number, item: CatalogItem) => {
    if (item.kind === 'PRODUCT') {
      updateLine(lineId, {
        kind: 'PRODUCT',
        productId: item.productId,
        glAccountId: null,
        description: item.label,
        unitPrice: item.priceCents,
        pickerOpen: false,
        pickerQuery: item.label,
      });
    } else {
      // Service fees, dockage rates, and rental products are sent as
      // CUSTOM lines with the resolved revenue GL. If we couldn't resolve
      // a GL (no per-location mapping and no fallback) the cashier will
      // see the inline GL dropdown and pick one.
      const desc = item.sublabel ? `${item.label} — ${item.sublabel}` : item.label;
      updateLine(lineId, {
        kind: 'CUSTOM',
        productId: null,
        glAccountId: item.glAccountId,
        description: desc,
        unitPrice: item.priceCents,
        pickerOpen: false,
        pickerQuery: '',
      });
    }
  };

  const switchToCustom = (lineId: number) => {
    updateLine(lineId, {
      kind: 'CUSTOM',
      productId: null,
      glAccountId: null,
      pickerOpen: false,
    });
  };

  const switchToProduct = (lineId: number) => {
    updateLine(lineId, {
      kind: 'PRODUCT',
      productId: null,
      glAccountId: null,
      description: '',
      pickerQuery: '',
    });
  };

  const lineGross = (l: LineItem) => l.qty * l.unitPrice;
  const lineDiscount = (l: LineItem): number => {
    const gross = lineGross(l);
    if (gross <= 0 || l.discountValue <= 0) return 0;
    if (l.discountMode === 'PERCENT') {
      const pct = Math.min(100, l.discountValue);
      return Math.min(gross, Math.round(gross * (pct / 100)));
    }
    // AMOUNT — cashier types dollars; clamp to gross so we never go negative.
    return Math.min(gross, Math.round(l.discountValue * 100));
  };
  const lineNet = (l: LineItem) => Math.max(0, lineGross(l) - lineDiscount(l));
  const lineTax = (l: LineItem) => Math.round(lineNet(l) * (l.taxRate / 100));
  const subtotal = lines.reduce((sum, l) => sum + lineNet(l), 0);
  const totalTax = lines.reduce((sum, l) => sum + lineTax(l), 0);
  const total = subtotal + totalTax;

  const lineHasResolvedAccount = (l: LineItem): boolean =>
    (l.kind === 'PRODUCT' && !!l.productId) ||
    (l.kind === 'CUSTOM' && !!l.glAccountId);

  const buildPayload = () => {
    const validLines = lines.filter(
      (l) => l.description.trim() && l.unitPrice > 0 && l.qty > 0 && lineHasResolvedAccount(l),
    );
    return {
      customerId,
      issuedDate,
      dueDate,
      notes,
      locationId: currentLocationId,
      lineItems: validLines.map((l) => ({
        description: l.description.trim(),
        quantity: l.qty,
        unitPriceCents: l.unitPrice,
        discountCents: lineDiscount(l),
        productId: l.kind === 'PRODUCT' ? l.productId : null,
        glAccountId: l.kind === 'CUSTOM' ? l.glAccountId : null,
      })),
    };
  };

  const validate = (): boolean => {
    if (!customerId) { setError('Please select a customer from the list.'); return false; }
    if (!issuedDate) { setError('Please set an issue date.'); return false; }
    if (!dueDate) { setError('Please set a due date.'); return false; }
    const nonEmpty = lines.filter((l) => l.description.trim() || l.unitPrice > 0 || l.productId || l.glAccountId);
    if (nonEmpty.length === 0) {
      setError('Please add at least one line item.');
      return false;
    }
    for (const l of nonEmpty) {
      if (!lineHasResolvedAccount(l)) {
        setError('Each line must be linked to a product or to a revenue account.');
        return false;
      }
      if (!l.description.trim()) { setError('Each line needs a description.'); return false; }
      if (l.qty <= 0) { setError('Quantities must be greater than zero.'); return false; }
      if (l.unitPrice <= 0) { setError('Unit prices must be greater than zero.'); return false; }
    }
    setError('');
    return true;
  };

  const submit = async (
    handler: ((data: Record<string, unknown>) => Promise<{ id: string } | null | undefined>) | undefined,
  ) => {
    if (!validate()) return;
    setSaving(true);
    try {
      // No handler wired (e.g. Dashboard quick action stub) — just close.
      if (!handler) { onClose(); return; }
      const result = await handler(buildPayload());
      if (result && result.id) {
        onClose();
      } else {
        setError('Failed to create invoice. Please review the fields and try again.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create invoice.');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveDraft = () => submit(onSaveDraft);
  const handleFinalize = () => submit(onFinalize);

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} className="helm-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={s.header}>
          <h2 style={s.headerTitle}>Create Invoice</h2>
          <button style={s.closeBtn} onClick={onClose}><X size={20} /></button>
        </div>

        {/* Body */}
        <div style={s.body}>
          {/* Customer Picker */}
          <div style={{ ...s.fieldGroup, position: 'relative' }}>
            <label style={s.label}>Customer</label>
            <input
              style={s.input}
              placeholder="Search for a customer..."
              value={customerName}
              onChange={(e) => { setCustomerName(e.target.value); setCustomerId(''); setCustomerOpen(true); }}
              onFocus={() => setCustomerOpen(true)}
              onBlur={() => setTimeout(() => setCustomerOpen(false), 150)}
            />
            {customerOpen && customerName.length > 0 && filteredCustomers.length > 0 && (
              <div style={s.customerDropdown as React.CSSProperties}>
                {filteredCustomers.map((c) => {
                  const name = customerDisplayName(c);
                  return (
                    <div
                      key={c.id}
                      style={s.customerOption}
                      onMouseDown={() => { setCustomerId(c.id); setCustomerName(name); setCustomerOpen(false); }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = '#D6E8F4'; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = '#FFFFFF'; }}
                    >
                      {name}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Issue date, Due date & Notes */}
          <div style={{ ...s.row, marginBottom: '24px' }}>
            <div style={{ flex: 1 }}>
              <label style={s.label}>Issue Date</label>
              <input
                type="date"
                style={s.input}
                value={issuedDate}
                onChange={(e) => setIssuedDate(e.target.value)}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={s.label}>Due Date</label>
              <input
                type="date"
                style={s.input}
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
            <div style={{ flex: 2 }}>
              <label style={s.label}>Notes</label>
              <input
                style={s.input}
                placeholder="Optional notes..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>

          {/* Line Items */}
          <label style={{ ...s.label, marginBottom: '12px' }}>Line Items</label>
          <div style={s.lineHeader}>
            <span style={s.colLabel as React.CSSProperties}>Item</span>
            <span style={s.colLabel as React.CSSProperties}>Qty</span>
            <span style={s.colLabel as React.CSSProperties}>Unit Price</span>
            <span style={s.colLabel as React.CSSProperties}>Discount</span>
            <span style={s.colLabel as React.CSSProperties}>Tax %</span>
            <span style={{ ...s.colLabel as React.CSSProperties, textAlign: 'right' }}>Total</span>
            <span />
          </div>
          {lines.map((line) => {
            const linkedProduct = line.productId ? productById.get(line.productId) : null;
            const hasLinkedItem = line.kind === 'PRODUCT' ? !!linkedProduct : false;
            const matches = catalogMatches(line.pickerQuery);
            return (
              <div key={line.id} style={s.lineCard}>
                <div style={s.lineGrid}>
                  {/* Item picker */}
                  <div style={s.pickerWrap}>
                    <input
                      style={s.lineInput}
                      placeholder={line.kind === 'CUSTOM' && !line.glAccountId
                        ? 'Description (custom service charge)'
                        : 'Search products, services, dockage, rentals...'}
                      value={line.kind === 'CUSTOM' || hasLinkedItem
                        ? line.description
                        : line.pickerQuery}
                      onChange={(e) => {
                        if (line.kind === 'CUSTOM' || hasLinkedItem) {
                          // Description is editable after picking — keep the
                          // resolved productId/glAccountId so the cashier can
                          // append context like "— slip B14".
                          updateLine(line.id, { description: e.target.value });
                        } else {
                          updateLine(line.id, { pickerQuery: e.target.value, pickerOpen: true });
                        }
                      }}
                      onFocus={() => {
                        if (line.kind === 'PRODUCT' && !linkedProduct) {
                          updateLine(line.id, { pickerOpen: true });
                        }
                      }}
                      onBlur={() => setTimeout(() => updateLine(line.id, { pickerOpen: false }), 150)}
                    />
                    {line.pickerOpen && line.kind === 'PRODUCT' && !linkedProduct && (
                      <div style={s.pickerDropdown as React.CSSProperties}>
                        {matches.length === 0 && (
                          <div style={s.pickerOptionMuted}>
                            No catalog items match. Try the custom option below.
                          </div>
                        )}
                        {matches.map((m) => (
                          <div
                            key={`${m.kind}:${m.id}`}
                            style={s.pickerOption}
                            onMouseDown={() => selectCatalogItemForLine(line.id, m)}
                            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = '#D6E8F4'; }}
                            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = '#FFFFFF'; }}
                          >
                            <span style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                              {m.kind === 'PRODUCT' && <Package size={12} style={{ color: '#075985', flexShrink: 0 }} />}
                              {m.kind === 'SERVICE_FEE' && <Wrench size={12} style={{ color: '#92400E', flexShrink: 0 }} />}
                              {m.kind === 'DOCKAGE' && <Anchor size={12} style={{ color: '#0A2342', flexShrink: 0 }} />}
                              {m.kind === 'RENTAL' && <Sailboat size={12} style={{ color: '#166534', flexShrink: 0 }} />}
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {m.label}
                                {m.sublabel && (
                                  <span style={{ color: '#64748B', marginLeft: 6, fontSize: 11 }}>
                                    {m.sublabel}
                                  </span>
                                )}
                              </span>
                            </span>
                            <span style={mono}>
                              {m.priceCents > 0 ? formatCents(m.priceCents) : '—'}
                            </span>
                          </div>
                        ))}
                        <div
                          style={s.pickerCustomOption}
                          onMouseDown={() => switchToCustom(line.id)}
                          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = '#E0E7EE'; }}
                          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = '#F2F4F6'; }}
                        >
                          <Tag size={14} /> Use a custom service charge instead
                        </div>
                      </div>
                    )}
                  </div>
                  <input
                    style={s.lineInputMono as React.CSSProperties}
                    type="number"
                    min={0.01}
                    step={0.01}
                    value={line.qty}
                    onChange={(e) => updateLine(line.id, { qty: parseFloat(e.target.value) || 0 })}
                  />
                  <input
                    style={s.lineInputMono as React.CSSProperties}
                    type="number"
                    min={0}
                    step={0.01}
                    placeholder="0.00"
                    value={line.unitPrice ? (line.unitPrice / 100).toFixed(2) : ''}
                    onChange={(e) => updateLine(line.id, { unitPrice: Math.round(parseFloat(e.target.value || '0') * 100) })}
                  />
                  <div style={s.discountWrap as React.CSSProperties} title="Per-line discount">
                    <input
                      style={s.discountInput as React.CSSProperties}
                      type="number"
                      min={0}
                      step={line.discountMode === 'PERCENT' ? 1 : 0.01}
                      placeholder={line.discountMode === 'PERCENT' ? '0' : '0.00'}
                      value={line.discountValue ? line.discountValue : ''}
                      onChange={(e) => updateLine(line.id, { discountValue: Math.max(0, parseFloat(e.target.value || '0') || 0) })}
                    />
                    <button
                      type="button"
                      style={s.discountToggle as React.CSSProperties}
                      onClick={() => updateLine(line.id, {
                        discountMode: line.discountMode === 'AMOUNT' ? 'PERCENT' : 'AMOUNT',
                        discountValue: 0,
                      })}
                      title={line.discountMode === 'AMOUNT' ? 'Switch to percent' : 'Switch to dollar amount'}
                    >
                      {line.discountMode === 'AMOUNT' ? '$' : '%'}
                    </button>
                  </div>
                  <input
                    style={s.lineInputMono as React.CSSProperties}
                    type="number"
                    min={0}
                    step={0.5}
                    value={line.taxRate}
                    onChange={(e) => updateLine(line.id, { taxRate: parseFloat(e.target.value) || 0 })}
                  />
                  <div style={{ ...mono, textAlign: 'right', fontSize: '13px', fontWeight: 600, color: '#0A2342', padding: '8px 4px' }}>
                    {formatCents(lineNet(line) + lineTax(line))}
                    {lineDiscount(line) > 0 && (
                      <div style={{ fontSize: '11px', fontWeight: 500, color: '#64748B' }}>
                        −{formatCents(lineDiscount(line))} off
                      </div>
                    )}
                  </div>
                  <button
                    style={s.removeBtn}
                    onClick={() => removeLine(line.id)}
                    disabled={lines.length === 1}
                    title="Remove line"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>

                {/* Line meta — shows the linked product or the GL picker for custom */}
                <div style={s.lineMeta}>
                  {line.kind === 'PRODUCT' && linkedProduct && (
                    <>
                      <span style={{ ...s.metaTag, ...s.metaTagProduct }}>
                        <Package size={11} /> {linkedProduct.name}{linkedProduct.sku ? ` · ${linkedProduct.sku}` : ''}
                      </span>
                      <button style={s.linkBtn} onClick={() => switchToProduct(line.id)}>
                        Change item
                      </button>
                    </>
                  )}
                  {line.kind === 'PRODUCT' && !linkedProduct && (
                    <>
                      <span style={{ ...s.metaTag, ...s.metaTagMissing }}>
                        Pick a product or switch to custom
                      </span>
                      <button style={s.linkBtn} onClick={() => switchToCustom(line.id)}>
                        Use custom service charge
                      </button>
                    </>
                  )}
                  {line.kind === 'CUSTOM' && (
                    <>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
                        <span style={{ ...s.metaTag, ...s.metaTagCustom, whiteSpace: 'nowrap' }}>
                          <Tag size={11} /> Custom
                        </span>
                        <select
                          style={s.glSelect as React.CSSProperties}
                          value={line.glAccountId ?? ''}
                          onChange={(e) => updateLine(line.id, { glAccountId: e.target.value || null })}
                        >
                          <option value="">— Pick a revenue account —</option>
                          {revenueGlAccounts.map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.accountNumber} · {g.name}
                            </option>
                          ))}
                        </select>
                      </span>
                      <button style={s.linkBtn} onClick={() => switchToProduct(line.id)}>
                        Pick a product instead
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
          <button style={s.addLineBtn} onClick={addLine}>
            <Plus size={14} /> Add Line Item
          </button>

          {/* Totals */}
          <div style={s.totalsSection}>
            <div style={s.totalsTable}>
              {(() => {
                const totalDiscount = lines.reduce((sum, l) => sum + lineDiscount(l), 0);
                const grossSubtotal = subtotal + totalDiscount;
                return (
                  <>
                    {totalDiscount > 0 && (
                      <div style={s.totalsRow}>
                        <span>Items Total</span>
                        <span style={{ ...mono, fontWeight: 600 }}>{formatCents(grossSubtotal)}</span>
                      </div>
                    )}
                    {totalDiscount > 0 && (
                      <div style={{ ...s.totalsRow, color: '#B45309' }}>
                        <span>Discounts</span>
                        <span style={{ ...mono, fontWeight: 600 }}>−{formatCents(totalDiscount)}</span>
                      </div>
                    )}
                  </>
                );
              })()}
              <div style={s.totalsRow}>
                <span>Subtotal</span>
                <span style={{ ...mono, fontWeight: 600 }}>{formatCents(subtotal)}</span>
              </div>
              <div style={s.totalsRow}>
                <span>Tax (preview)</span>
                <span style={{ ...mono, fontWeight: 600 }}>{formatCents(totalTax)}</span>
              </div>
              <div style={s.totalsFinal}>
                <span>Total</span>
                <span style={mono}>{formatCents(total)}</span>
              </div>
              <div style={{ fontSize: '11px', color: '#64748B', marginTop: '4px', textAlign: 'right' }}>
                Final tax is computed by the server using the location's tax rules.
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={s.footer}>
          {error && <span style={{ fontSize: '13px', color: '#B71C1C', flex: 1, alignSelf: 'center' }}>{error}</span>}
          <button style={s.secondaryBtn} onClick={onClose}>Cancel</button>
          <button style={{ ...s.secondaryBtn, opacity: saving ? 0.7 : 1 }} onClick={handleSaveDraft} disabled={saving}>
            <Save size={16} /> {saving ? 'Saving...' : 'Save as Draft'}
          </button>
          <button style={{ ...s.primaryBtn, opacity: saving ? 0.7 : 1 }} onClick={handleFinalize} disabled={saving}>
            <Send size={16} /> {saving ? 'Saving...' : 'Save & Finalize'}
          </button>
        </div>
      </div>
    </div>
  );
}
