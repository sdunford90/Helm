import React, { useState, useMemo } from 'react';
import {
  Fuel as FuelIcon, Plus, X, Truck, Edit2,
} from 'lucide-react';
import { useAuth } from '@clerk/clerk-react';
import { useApi } from '../hooks/useApi';
import { api } from '../lib/api';

/* ── API Response Types ─────────────────────────────────── */

interface ApiFuelType {
  id: string;
  type: string;
  priceCentsPerGallon: number;
  costCentsPerGallon: number;
  marginCents: number;
  tankCapacityGallons: number;
  currentLevelGallons: number;
  levelPercent: number;
}

interface ApiFuelSale {
  id: string;
  date: string;
  customerName: string;
  fuelType: string;
  gallons: number;
  pricePerGallon: number;
  totalCents: number;
  pumpNumber: number;
  staffName: string;
  paymentMethod: string;
}

interface ApiDelivery {
  id: string;
  date: string;
  supplier: string;
  fuelType: string;
  gallons: number;
  costPerGallon: number;
  totalCostCents: number;
  tankLevelAfter: number | null;
}

interface ApiTank {
  type: string;
  capacityGallons: number;
  currentGallons: number;
  levelPercent: number;
  estimatedDaysRemaining: number;
}

/* ── Sale / Delivery form payload types ─────────────────── */

interface SalePayload {
  fuelType: string;
  gallons: number;
  pumpNumber: number;
  paymentMethod: string;
  guestName?: string;
}

interface DeliveryPayload {
  supplier: string;
  fuelType: string;
  gallons: number;
  costCentsPerGallon: number;
  tankLevelAfterGallons?: number;
}

/* ── Helpers ────────────────────────────────────────────── */

const FUEL_LABEL: Record<string, string> = {
  REGULAR: 'Regular Gas',
  PREMIUM: 'Premium Gas',
  DIESEL: 'Diesel',
};

const PAYMENT_METHOD_API: Record<string, string> = {
  Card: 'CARD',
  Cash: 'CASH',
  'Charge to Slip': 'CHARGE_TO_SLIP',
};

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
};

const fmtDateShort = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const fmtCents = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const fmtCentsPerGal = (cents: number) => `$${(cents / 100).toFixed(2)}/gal`;
const fmtTotal = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* ── Styles ─────────────────────────────────────────────── */

const st: Record<string, React.CSSProperties> = {
  page: { padding: '32px' },
  title: { fontSize: '36px', fontWeight: 700, color: '#0A2342', letterSpacing: '-0.02em', margin: 0 },
  divider: { height: '4px', background: 'linear-gradient(90deg, #00D4FF, transparent)', border: 'none', marginTop: '12px', marginBottom: '32px', borderRadius: '2px' },
  statsRow: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px', marginBottom: '32px' },
  statCard: { background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' },
  statLabel: { fontSize: '12px', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.05em', color: '#64748B', marginBottom: '4px' },
  statValue: { fontSize: '24px', fontWeight: 700, color: '#0A2342', fontFamily: '"JetBrains Mono", monospace' },
  statSub: { fontSize: '13px', color: '#2E4A6B', marginTop: '2px' },
  tabs: { display: 'flex', gap: '0', borderBottom: '2px solid #E2E8F0', marginBottom: '24px' },
  tab: { padding: '10px 24px', fontSize: '14px', fontWeight: 600, border: 'none', background: 'none', cursor: 'pointer', color: '#64748B', borderBottom: '2px solid transparent', marginBottom: '-2px' },
  tabActive: { color: '#0A2342', borderBottom: '2px solid #00D4FF' },
  filterBar: { display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px', flexWrap: 'wrap' as const },
  addBtn: { display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 20px', fontSize: '14px', fontWeight: 600, color: '#FFFFFF', backgroundColor: '#0A2342', border: 'none', borderRadius: '6px', cursor: 'pointer', whiteSpace: 'nowrap' as const },
  tableWrap: { background: '#FFFFFF', borderRadius: '8px', border: '1px solid #E2E8F0', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', overflow: 'hidden' },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: '14px' },
  th: { textAlign: 'left' as const, padding: '12px 16px', fontSize: '12px', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.05em', color: '#FFFFFF', backgroundColor: '#0A2342', borderBottom: '2px solid #00D4FF' },
  td: { padding: '12px 16px', color: '#0A2342', borderBottom: '1px solid #E2E8F0' },
  mono: { fontFamily: '"JetBrains Mono", monospace', fontSize: '14px' },
  pricingGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', marginBottom: '24px' },
  priceCard: { background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '12px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' },
  priceLabel: { fontSize: '18px', fontWeight: 700, color: '#0A2342', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' },
  priceRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #F1F5F9' },
  priceRowLabel: { fontSize: '14px', color: '#64748B' },
  priceRowValue: { fontSize: '16px', fontWeight: 600, color: '#0A2342', fontFamily: '"JetBrains Mono", monospace' },
  tankGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '24px' },
  tankCard: { background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '12px', padding: '24px', textAlign: 'center' as const, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' },
  tankLabel: { fontSize: '18px', fontWeight: 700, color: '#0A2342', marginBottom: '16px' },
  tankBar: { width: '80px', height: '200px', borderRadius: '8px', background: '#F1F5F9', border: '2px solid #E2E8F0', margin: '0 auto 16px', position: 'relative' as const, overflow: 'hidden' },
  tankFill: { position: 'absolute' as const, bottom: 0, left: 0, right: 0, borderRadius: '0 0 6px 6px', transition: 'height 0.3s' },
  tankText: { fontSize: '13px', color: '#64748B', marginTop: '8px' },
  overlay: { position: 'fixed' as const, inset: 0, backgroundColor: 'rgba(10,35,66,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: '#FFFFFF', borderRadius: '8px', width: '480px', maxHeight: '90vh', overflow: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '24px 32px 16px', borderBottom: '1px solid #E2E8F0' },
  modalTitle: { fontSize: '20px', fontWeight: 700, color: '#0A2342', margin: 0 },
  closeBtn: { background: 'none', border: 'none', cursor: 'pointer', color: '#64748B', padding: '4px' },
  modalBody: { padding: '24px 32px' },
  field: { display: 'flex', flexDirection: 'column' as const, gap: '4px', marginBottom: '16px' },
  label: { fontSize: '13px', fontWeight: 600, color: '#0A2342' },
  input: { padding: '8px 12px', fontSize: '14px', border: '1px solid #CCC', borderRadius: '4px', color: '#0A2342', outline: 'none', boxSizing: 'border-box' as const, width: '100%' },
  row2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' },
  modalFooter: { display: 'flex', justifyContent: 'flex-end', gap: '12px', padding: '16px 32px 24px', borderTop: '1px solid #E2E8F0' },
  cancelBtn: { padding: '8px 24px', fontSize: '14px', fontWeight: 600, color: '#2E4A6B', background: '#FFFFFF', border: '1px solid #CCC', borderRadius: '6px', cursor: 'pointer' },
  saveBtn: { padding: '8px 24px', fontSize: '14px', fontWeight: 600, color: '#FFFFFF', backgroundColor: '#0A2342', border: 'none', borderRadius: '6px', cursor: 'pointer' },
  emptyState: { padding: '48px 24px', textAlign: 'center' as const, color: '#64748B', fontSize: '14px' },
};

/* ── Modals ─────────────────────────────────────────────── */

function RecordSaleModal({
  fuelTypes,
  onClose,
  onSave,
}: {
  fuelTypes: ApiFuelType[];
  onClose: () => void;
  onSave: (p: SalePayload) => Promise<boolean>;
}) {
  const [customer, setCustomer] = useState('');
  const [fuelTypeIdx, setFuelTypeIdx] = useState(0);
  const [gallons, setGallons] = useState('');
  const [pump, setPump] = useState('1');
  const [method, setMethod] = useState('Card');
  const [saving, setSaving] = useState(false);
  const ft = fuelTypes[fuelTypeIdx];
  const totalCents = ft ? Math.round(parseFloat(gallons || '0') * ft.priceCentsPerGallon) : 0;

  const handleSave = async () => {
    if (!gallons || !ft) return;
    setSaving(true);
    try {
      const ok = await onSave({
        fuelType: ft.type,
        gallons: parseFloat(gallons),
        pumpNumber: parseInt(pump),
        paymentMethod: PAYMENT_METHOD_API[method] ?? 'CARD',
        guestName: customer || undefined,
      });
      if (ok) onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={st.overlay} onClick={onClose}>
      <div style={st.modal} className="helm-modal" onClick={(e) => e.stopPropagation()}>
        <div style={st.modalHeader}>
          <h2 style={st.modalTitle}>Record Fuel Sale</h2>
          <button style={st.closeBtn} onClick={onClose}><X size={20} /></button>
        </div>
        <div style={st.modalBody}>
          <div style={st.field}>
            <label style={st.label}>Customer / Vessel</label>
            <input style={st.input} value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="Name or slip # (leave blank for walk-up)" />
          </div>
          <div style={st.row2}>
            <div style={st.field}>
              <label style={st.label}>Fuel Type *</label>
              <select style={st.input} value={fuelTypeIdx} onChange={(e) => setFuelTypeIdx(parseInt(e.target.value))}>
                {fuelTypes.map((f, i) => (
                  <option key={f.id} value={i}>{FUEL_LABEL[f.type] ?? f.type} ({fmtCentsPerGal(f.priceCentsPerGallon)})</option>
                ))}
              </select>
            </div>
            <div style={st.field}>
              <label style={st.label}>Pump #</label>
              <select style={st.input} value={pump} onChange={(e) => setPump(e.target.value)}>
                <option value="1">Pump 1</option><option value="2">Pump 2</option><option value="3">Pump 3</option>
              </select>
            </div>
          </div>
          <div style={st.row2}>
            <div style={st.field}>
              <label style={st.label}>Gallons Dispensed *</label>
              <input style={st.input} type="number" step="0.1" value={gallons} onChange={(e) => setGallons(e.target.value)} placeholder="0.0" />
            </div>
            <div style={st.field}>
              <label style={st.label}>Payment Method</label>
              <select style={st.input} value={method} onChange={(e) => setMethod(e.target.value)}>
                <option>Card</option><option>Cash</option><option>Charge to Slip</option>
              </select>
            </div>
          </div>
          {totalCents > 0 && (
            <div style={{ padding: '12px 16px', background: '#E0F7FF', borderRadius: '6px', border: '1px solid #00D4FF', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '14px', color: '#0A2342', fontWeight: 600 }}>Sale Total</span>
              <span style={{ fontSize: '20px', fontWeight: 700, color: '#0A2342', fontFamily: '"JetBrains Mono", monospace' }}>{fmtCents(totalCents)}</span>
            </div>
          )}
        </div>
        <div style={st.modalFooter}>
          <button style={st.cancelBtn} onClick={onClose}>Cancel</button>
          <button style={{ ...st.saveBtn, opacity: saving || !gallons || !ft ? 0.6 : 1 }} onClick={handleSave} disabled={saving || !gallons || !ft}>
            {saving ? 'Saving…' : 'Record Sale'}
          </button>
        </div>
      </div>
    </div>
  );
}

function LogDeliveryModal({
  fuelTypes,
  onClose,
  onSave,
}: {
  fuelTypes: ApiFuelType[];
  onClose: () => void;
  onSave: (p: DeliveryPayload) => Promise<boolean>;
}) {
  const [supplier, setSupplier] = useState('');
  const [fuelTypeIdx, setFuelTypeIdx] = useState(0);
  const [gallons, setGallons] = useState('');
  const [costPerGal, setCostPerGal] = useState('');
  const [saving, setSaving] = useState(false);
  const ft = fuelTypes[fuelTypeIdx];
  const totalCostCents = Math.round(parseFloat(gallons || '0') * parseFloat(costPerGal || '0') * 100);

  const handleSave = async () => {
    if (!supplier || !gallons || !ft) return;
    setSaving(true);
    try {
      const ok = await onSave({
        supplier,
        fuelType: ft.type,
        gallons: parseFloat(gallons),
        costCentsPerGallon: Math.round(parseFloat(costPerGal || '0') * 100),
      });
      if (ok) onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={st.overlay} onClick={onClose}>
      <div style={st.modal} className="helm-modal" onClick={(e) => e.stopPropagation()}>
        <div style={st.modalHeader}>
          <h2 style={st.modalTitle}>Log Fuel Delivery</h2>
          <button style={st.closeBtn} onClick={onClose}><X size={20} /></button>
        </div>
        <div style={st.modalBody}>
          <div style={st.field}>
            <label style={st.label}>Supplier *</label>
            <input style={st.input} value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="e.g. Gulf Coast Petroleum" />
          </div>
          <div style={st.row2}>
            <div style={st.field}>
              <label style={st.label}>Fuel Type *</label>
              <select style={st.input} value={fuelTypeIdx} onChange={(e) => setFuelTypeIdx(parseInt(e.target.value))}>
                {fuelTypes.map((f, i) => <option key={f.id} value={i}>{FUEL_LABEL[f.type] ?? f.type}</option>)}
              </select>
            </div>
            <div style={st.field}>
              <label style={st.label}>Gallons Received *</label>
              <input style={st.input} type="number" value={gallons} onChange={(e) => setGallons(e.target.value)} placeholder="0" />
            </div>
          </div>
          <div style={st.field}>
            <label style={st.label}>Cost / Gallon ($)</label>
            <input style={st.input} type="number" step="0.01" value={costPerGal} onChange={(e) => setCostPerGal(e.target.value)} placeholder="0.00" />
          </div>
          {totalCostCents > 0 && (
            <div style={{ padding: '12px 16px', background: '#E0F7FF', borderRadius: '6px', border: '1px solid #00D4FF', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '14px', color: '#0A2342', fontWeight: 600 }}>Total Cost</span>
              <span style={{ fontSize: '20px', fontWeight: 700, color: '#0A2342', fontFamily: '"JetBrains Mono", monospace' }}>{fmtTotal(totalCostCents)}</span>
            </div>
          )}
        </div>
        <div style={st.modalFooter}>
          <button style={st.cancelBtn} onClick={onClose}>Cancel</button>
          <button style={{ ...st.saveBtn, opacity: saving || !supplier || !gallons || !ft ? 0.6 : 1 }} onClick={handleSave} disabled={saving || !supplier || !gallons || !ft}>
            {saving ? 'Saving…' : 'Log Delivery'}
          </button>
        </div>
      </div>
    </div>
  );
}

function UpdatePriceModal({
  fuelType,
  onClose,
  onSave,
}: {
  fuelType: ApiFuelType;
  onClose: () => void;
  onSave: (id: string, priceCents: number, costCents: number) => Promise<void>;
}) {
  const [retail, setRetail] = useState(String((fuelType.priceCentsPerGallon / 100).toFixed(2)));
  const [cost, setCost] = useState(String((fuelType.costCentsPerGallon / 100).toFixed(2)));
  const [saving, setSaving] = useState(false);
  const newMargin = parseFloat(retail || '0') - parseFloat(cost || '0');
  const newMarginPct = parseFloat(retail || '0') > 0 ? (newMargin / parseFloat(retail)) * 100 : 0;

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(fuelType.id, Math.round(parseFloat(retail) * 100), Math.round(parseFloat(cost) * 100));
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={st.overlay} onClick={onClose}>
      <div style={{ ...st.modal, width: '400px' }} onClick={(e) => e.stopPropagation()}>
        <div style={st.modalHeader}>
          <h2 style={st.modalTitle}>Update Price — {FUEL_LABEL[fuelType.type] ?? fuelType.type}</h2>
          <button style={st.closeBtn} onClick={onClose}><X size={20} /></button>
        </div>
        <div style={st.modalBody}>
          <div style={st.field}>
            <label style={st.label}>Retail Price ($/gal) *</label>
            <input style={{ ...st.input, fontSize: '18px', fontFamily: '"JetBrains Mono", monospace' }} type="number" step="0.01" value={retail} onChange={(e) => setRetail(e.target.value)} autoFocus />
          </div>
          <div style={st.field}>
            <label style={st.label}>Cost Price ($/gal)</label>
            <input style={{ ...st.input, fontFamily: '"JetBrains Mono", monospace' }} type="number" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} />
          </div>
          <div style={{ padding: '12px 16px', background: newMargin > 0 ? '#DEF7EC' : '#FDE8E8', borderRadius: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
            <span style={{ fontSize: '13px', color: '#64748B', fontWeight: 600 }}>Projected Margin</span>
            <span style={{ fontSize: '16px', fontWeight: 700, color: newMargin > 0 ? '#03543F' : '#9B1C1C', fontFamily: '"JetBrains Mono", monospace' }}>
              ${newMargin.toFixed(2)}/gal ({newMarginPct.toFixed(1)}%)
            </span>
          </div>
        </div>
        <div style={st.modalFooter}>
          <button style={st.cancelBtn} onClick={onClose}>Cancel</button>
          <button style={{ ...st.saveBtn, opacity: saving ? 0.6 : 1 }} onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Update Price'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Main Component ─────────────────────────────────────── */

export default function Fuel() {
  const [tab, setTab] = useState<'sales' | 'pricing' | 'deliveries' | 'tanks'>('sales');
  const [modal, setModal] = useState<'recordSale' | 'logDelivery' | { updatePrice: ApiFuelType } | null>(null);

  const { data: typesResp, loading: loadingTypes, execute: refreshTypes } = useApi<{ fuelTypes: ApiFuelType[] }>('get', '/api/fuel/types', { immediate: true });
  const { data: salesResp, loading: loadingSales, execute: refreshSales } = useApi<{ sales: ApiFuelSale[]; total: number }>('get', '/api/fuel/sales', { immediate: true });
  const { data: deliveriesResp, loading: loadingDeliveries, execute: refreshDeliveries } = useApi<{ deliveries: ApiDelivery[]; total: number }>('get', '/api/fuel/deliveries', { immediate: true });
  const { data: tanksResp, execute: refreshTanks } = useApi<{ tanks: ApiTank[] }>('get', '/api/fuel/tank-levels', { immediate: true });

  const { getToken } = useAuth();
  const createSale = useApi<unknown>('post', '/api/fuel/sales');
  const createDelivery = useApi<unknown>('post', '/api/fuel/deliveries');

  const fuelTypes = useMemo(() => typesResp?.fuelTypes ?? [], [typesResp]);
  const sales = useMemo(() => salesResp?.sales ?? [], [salesResp]);
  const deliveries = useMemo(() => deliveriesResp?.deliveries ?? [], [deliveriesResp]);
  const tanks = useMemo(() => tanksResp?.tanks ?? [], [tanksResp]);

  const loading = loadingTypes || loadingSales || loadingDeliveries;

  const todaySales = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return sales.filter((s) => s.date.startsWith(today));
  }, [sales]);

  const todayGallons = todaySales.reduce((s, sale) => s + sale.gallons, 0);
  const todayRevenueCents = todaySales.reduce((s, sale) => s + sale.totalCents, 0);
  const avgMarginCents = fuelTypes.length > 0
    ? fuelTypes.reduce((s, ft) => s + ft.marginCents, 0) / fuelTypes.length
    : 0;
  const lowTankCount = tanks.filter((t) => t.levelPercent <= 25).length;
  const allTanksOk = tanks.length > 0 && tanks.every((t) => t.levelPercent > 25);

  const tankColor = (pct: number) => pct > 50 ? '#22C55E' : pct > 25 ? '#F59E0B' : '#EF4444';

  const tabItems: { key: typeof tab; label: string }[] = [
    { key: 'sales', label: 'Sales Log' },
    { key: 'pricing', label: 'Pricing' },
    { key: 'deliveries', label: 'Deliveries' },
    { key: 'tanks', label: 'Tank Levels' },
  ];

  const handleSaveSale = async (payload: SalePayload): Promise<boolean> => {
    const result = await createSale.execute(payload);
    if (result === null) return false;
    await Promise.all([refreshSales(), refreshTypes(), refreshTanks()]);
    return true;
  };

  const handleSaveDelivery = async (payload: DeliveryPayload): Promise<boolean> => {
    const result = await createDelivery.execute(payload);
    if (result === null) return false;
    await Promise.all([refreshDeliveries(), refreshTypes(), refreshTanks()]);
    return true;
  };

  const handleUpdatePrice = async (id: string, priceCents: number, costCents: number) => {
    const token = await getToken();
    await api.put(`/fuel/types/${id}/price`, { priceCentsPerGallon: priceCents, costCentsPerGallon: costCents }, token);
    await refreshTypes();
  };

  return (
    <div style={st.page}>
      <h1 style={st.title} className="helm-page-title">Fuel Management</h1>
      <hr style={st.divider} />

      {loading && <div style={{ textAlign: 'center', padding: '24px', color: '#64748B' }}>Loading fuel data…</div>}

      <div style={st.statsRow} className="helm-stats-grid">
        <div style={{ ...st.statCard, borderTop: '3px solid #00D4FF' }}>
          <div style={st.statLabel}>Gallons Sold Today</div>
          <div style={st.statValue}>{todayGallons.toFixed(1)}</div>
          <div style={st.statSub}>{todaySales.length} transaction{todaySales.length !== 1 ? 's' : ''}</div>
        </div>
        <div style={st.statCard}>
          <div style={st.statLabel}>Revenue Today</div>
          <div style={st.statValue}>{fmtCents(todayRevenueCents)}</div>
          <div style={st.statSub}>All fuel types</div>
        </div>
        <div style={st.statCard}>
          <div style={st.statLabel}>Avg Margin</div>
          <div style={st.statValue}>{fmtCents(avgMarginCents)}/gal</div>
          <div style={st.statSub}>Across all types</div>
        </div>
        <div style={st.statCard}>
          <div style={st.statLabel}>Tank Status</div>
          <div style={st.statValue}>{tanks.length === 0 ? '—' : allTanksOk ? 'Good' : 'Low'}</div>
          <div style={st.statSub}>{lowTankCount} tank{lowTankCount !== 1 ? 's' : ''} need refill</div>
        </div>
      </div>

      <div style={st.tabs} className="helm-tabs">
        {tabItems.map((t) => (
          <button key={t.key} style={{ ...st.tab, ...(tab === t.key ? st.tabActive : {}) }} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>

      {tab === 'sales' && (
        <>
          <div style={st.filterBar} className="helm-filter-bar">
            <div style={{ flex: 1 }} />
            <button style={st.addBtn} onClick={() => setModal('recordSale')}><Plus size={16} /> Record Sale</button>
          </div>
          <div style={st.tableWrap} className="helm-table-wrap">
            <table style={st.table}>
              <thead>
                <tr>
                  <th style={st.th}>Date / Time</th>
                  <th style={st.th}>Customer</th>
                  <th style={st.th}>Fuel Type</th>
                  <th style={st.th}>Gallons</th>
                  <th style={st.th}>Price/Gal</th>
                  <th style={st.th}>Total</th>
                  <th style={st.th}>Pump</th>
                  <th style={st.th}>Payment</th>
                </tr>
              </thead>
              <tbody>
                {loadingSales && sales.length === 0 && (
                  <tr><td colSpan={8} style={st.emptyState}>Loading sales…</td></tr>
                )}
                {!loadingSales && sales.length === 0 && (
                  <tr><td colSpan={8} style={st.emptyState}>
                    No fuel sales recorded yet. Click "Record Sale" to add the first one.
                  </td></tr>
                )}
                {sales.map((s, idx) => {
                  const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#D6E8F4';
                  return (
                    <tr key={s.id} style={{ backgroundColor: rowBg }}>
                      <td style={{ ...st.td, fontSize: '13px' }}>{fmtDate(s.date)}</td>
                      <td style={{ ...st.td, fontWeight: 600 }}>{s.customerName}</td>
                      <td style={st.td}>{FUEL_LABEL[s.fuelType] ?? s.fuelType}</td>
                      <td style={{ ...st.td, ...st.mono }}>{s.gallons.toFixed(1)}</td>
                      <td style={{ ...st.td, ...st.mono }}>{fmtCentsPerGal(s.pricePerGallon)}</td>
                      <td style={{ ...st.td, ...st.mono, fontWeight: 600 }}>{fmtCents(s.totalCents)}</td>
                      <td style={{ ...st.td, textAlign: 'center' }}>#{s.pumpNumber}</td>
                      <td style={st.td}>{s.paymentMethod}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'pricing' && (
        <>
          {!loadingTypes && fuelTypes.length === 0 && (
            <div style={st.emptyState}>No fuel types configured.</div>
          )}
          <div style={st.pricingGrid}>
            {fuelTypes.map((ft) => (
              <div key={ft.id} style={st.priceCard}>
                <div style={st.priceLabel}><FuelIcon size={20} style={{ color: '#00D4FF' }} /> {FUEL_LABEL[ft.type] ?? ft.type}</div>
                <div style={st.priceRow}>
                  <span style={st.priceRowLabel}>Retail Price</span>
                  <span style={{ ...st.priceRowValue, color: '#0A2342' }}>{fmtCentsPerGal(ft.priceCentsPerGallon)}</span>
                </div>
                <div style={st.priceRow}>
                  <span style={st.priceRowLabel}>Cost</span>
                  <span style={st.priceRowValue}>{fmtCentsPerGal(ft.costCentsPerGallon)}</span>
                </div>
                <div style={st.priceRow}>
                  <span style={st.priceRowLabel}>Margin</span>
                  <span style={{ ...st.priceRowValue, color: '#22C55E' }}>{fmtCentsPerGal(ft.marginCents)}</span>
                </div>
                <div style={{ ...st.priceRow, borderBottom: 'none' }}>
                  <span style={st.priceRowLabel}>Margin %</span>
                  <span style={{ ...st.priceRowValue, color: '#22C55E' }}>
                    {ft.priceCentsPerGallon > 0 ? ((ft.marginCents / ft.priceCentsPerGallon) * 100).toFixed(1) : '0.0'}%
                  </span>
                </div>
                <button
                  style={{ ...st.addBtn, marginTop: '16px', width: '100%', justifyContent: 'center' }}
                  onClick={() => setModal({ updatePrice: ft })}
                >
                  <Edit2 size={14} /> Update Price
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === 'deliveries' && (
        <>
          <div style={st.filterBar} className="helm-filter-bar">
            <div style={{ flex: 1 }} />
            <button style={st.addBtn} onClick={() => setModal('logDelivery')}><Truck size={16} /> Log Delivery</button>
          </div>
          <div style={st.tableWrap} className="helm-table-wrap">
            <table style={st.table}>
              <thead>
                <tr>
                  <th style={st.th}>Date</th>
                  <th style={st.th}>Supplier</th>
                  <th style={st.th}>Fuel Type</th>
                  <th style={st.th}>Gallons</th>
                  <th style={st.th}>Cost/Gal</th>
                  <th style={st.th}>Total Cost</th>
                  <th style={st.th}>Tank After</th>
                </tr>
              </thead>
              <tbody>
                {loadingDeliveries && deliveries.length === 0 && (
                  <tr><td colSpan={7} style={st.emptyState}>Loading deliveries…</td></tr>
                )}
                {!loadingDeliveries && deliveries.length === 0 && (
                  <tr><td colSpan={7} style={st.emptyState}>
                    No deliveries logged yet. Click "Log Delivery" to record one.
                  </td></tr>
                )}
                {deliveries.map((d, idx) => {
                  const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#D6E8F4';
                  return (
                    <tr key={d.id} style={{ backgroundColor: rowBg }}>
                      <td style={st.td}>{fmtDateShort(d.date)}</td>
                      <td style={{ ...st.td, fontWeight: 600 }}>{d.supplier}</td>
                      <td style={st.td}>{FUEL_LABEL[d.fuelType] ?? d.fuelType}</td>
                      <td style={{ ...st.td, ...st.mono }}>{d.gallons.toLocaleString()}</td>
                      <td style={{ ...st.td, ...st.mono }}>{fmtCentsPerGal(d.costPerGallon)}</td>
                      <td style={{ ...st.td, ...st.mono, fontWeight: 600 }}>{fmtTotal(d.totalCostCents)}</td>
                      <td style={{ ...st.td, ...st.mono }}>{d.tankLevelAfter != null ? `${d.tankLevelAfter.toLocaleString()} gal` : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'tanks' && (
        <>
          {!loadingTypes && tanks.length === 0 && (
            <div style={st.emptyState}>No tank data available.</div>
          )}
          <div style={st.tankGrid}>
            {tanks.map((t) => (
              <div key={t.type} style={st.tankCard}>
                <div style={st.tankLabel}>{FUEL_LABEL[t.type] ?? t.type}</div>
                <div style={st.tankBar}>
                  <div style={{ ...st.tankFill, height: `${t.levelPercent}%`, backgroundColor: tankColor(t.levelPercent) }} />
                </div>
                <div style={{ fontSize: '28px', fontWeight: 700, color: '#0A2342', fontFamily: '"JetBrains Mono", monospace' }}>{t.levelPercent}%</div>
                <div style={st.tankText}>{t.currentGallons.toLocaleString()} / {t.capacityGallons.toLocaleString()} gal</div>
                <div style={{ ...st.tankText, fontWeight: 600, color: t.estimatedDaysRemaining < 14 ? '#EF4444' : '#22C55E' }}>~{t.estimatedDaysRemaining} days remaining</div>
              </div>
            ))}
          </div>
        </>
      )}

      {modal === 'recordSale' && fuelTypes.length > 0 && (
        <RecordSaleModal fuelTypes={fuelTypes} onClose={() => setModal(null)} onSave={handleSaveSale} />
      )}
      {modal === 'logDelivery' && fuelTypes.length > 0 && (
        <LogDeliveryModal fuelTypes={fuelTypes} onClose={() => setModal(null)} onSave={handleSaveDelivery} />
      )}
      {modal !== null && typeof modal === 'object' && 'updatePrice' in modal && (
        <UpdatePriceModal fuelType={modal.updatePrice} onClose={() => setModal(null)} onSave={handleUpdatePrice} />
      )}
    </div>
  );
}
