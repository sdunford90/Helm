import React, { useState, useMemo } from 'react';
import {
  Fuel as FuelIcon, Search, Plus, X, DollarSign,
  TrendingUp, Droplets, Truck, Edit2,
} from 'lucide-react';
import { useApi } from '../hooks/useApi';

/* ── Types ─────────────────────────────────────────────── */

interface FuelSale {
  id: string;
  date: string;
  customer: string;
  fuelType: string;
  gallons: number;
  pricePerGal: number;
  total: number;
  pump: number;
  staff: string;
  method: string;
}

interface FuelType {
  id: string;
  type: string;
  label: string;
  pricePerGal: number;
  costPerGal: number;
  tankCapacity: number;
  currentLevel: number;
}

interface Delivery {
  id: string;
  date: string;
  supplier: string;
  fuelType: string;
  gallons: number;
  costPerGal: number;
  totalCost: number;
  tankAfter: number;
}

/* ── Mock Data ─────────────────────────────────────────── */

const FUEL_TYPES: FuelType[] = [
  { id: '1', type: 'REGULAR', label: 'Regular Gas', pricePerGal: 4.29, costPerGal: 3.65, tankCapacity: 5000, currentLevel: 2400 },
  { id: '2', type: 'PREMIUM', label: 'Premium Gas', pricePerGal: 4.79, costPerGal: 4.08, tankCapacity: 3000, currentLevel: 1800 },
  { id: '3', type: 'DIESEL', label: 'Diesel', pricePerGal: 4.89, costPerGal: 4.10, tankCapacity: 4000, currentLevel: 2200 },
];

const SALES: FuelSale[] = [
  { id: '1', date: '2026-03-25 09:15 AM', customer: 'James Harborview', fuelType: 'Diesel', gallons: 45.2, pricePerGal: 4.89, total: 221.03, pump: 2, staff: 'Jake M.', method: 'Card' },
  { id: '2', date: '2026-03-25 08:42 AM', customer: 'Sarah Mitchell', fuelType: 'Regular', gallons: 32.8, pricePerGal: 4.29, total: 140.71, pump: 1, staff: 'Jake M.', method: 'Card' },
  { id: '3', date: '2026-03-25 07:30 AM', customer: 'Walk-up Guest', fuelType: 'Regular', gallons: 18.5, pricePerGal: 4.29, total: 79.37, pump: 1, staff: 'Jake M.', method: 'Cash' },
  { id: '4', date: '2026-03-24 04:15 PM', customer: 'David Tidewater', fuelType: 'Diesel', gallons: 82.0, pricePerGal: 4.89, total: 400.98, pump: 2, staff: 'Maria S.', method: 'Charge to Slip' },
  { id: '5', date: '2026-03-24 02:30 PM', customer: 'Coastal Charters', fuelType: 'Diesel', gallons: 120.5, pricePerGal: 4.89, total: 589.25, pump: 2, staff: 'Maria S.', method: 'Card' },
  { id: '6', date: '2026-03-24 11:00 AM', customer: 'Elena Windward', fuelType: 'Regular', gallons: 22.0, pricePerGal: 4.29, total: 94.38, pump: 1, staff: 'Jake M.', method: 'Card' },
  { id: '7', date: '2026-03-24 09:45 AM', customer: 'Walk-up Guest', fuelType: 'Premium', gallons: 15.0, pricePerGal: 4.79, total: 71.85, pump: 1, staff: 'Jake M.', method: 'Cash' },
  { id: '8', date: '2026-03-23 03:20 PM', customer: 'Blue Water Excursions', fuelType: 'Diesel', gallons: 200.0, pricePerGal: 4.89, total: 978.00, pump: 2, staff: 'Maria S.', method: 'Card' },
  { id: '9', date: '2026-03-23 10:00 AM', customer: 'Robert Chen', fuelType: 'Regular', gallons: 28.5, pricePerGal: 4.29, total: 122.27, pump: 1, staff: 'Jake M.', method: 'Card' },
  { id: '10', date: '2026-03-23 08:30 AM', customer: 'Walk-up Guest', fuelType: 'Regular', gallons: 12.0, pricePerGal: 4.29, total: 51.48, pump: 1, staff: 'Jake M.', method: 'Cash' },
];

const DELIVERIES: Delivery[] = [
  { id: '1', date: '2026-03-22', supplier: 'Gulf Coast Petroleum', fuelType: 'Regular', gallons: 3000, costPerGal: 3.65, totalCost: 10950, tankAfter: 4200 },
  { id: '2', date: '2026-03-22', supplier: 'Gulf Coast Petroleum', fuelType: 'Diesel', gallons: 2500, costPerGal: 4.10, totalCost: 10250, tankAfter: 3800 },
  { id: '3', date: '2026-03-15', supplier: 'Marine Fuel Distributors', fuelType: 'Premium', gallons: 1500, costPerGal: 4.08, totalCost: 6120, tankAfter: 2600 },
  { id: '4', date: '2026-03-08', supplier: 'Gulf Coast Petroleum', fuelType: 'Regular', gallons: 2500, costPerGal: 3.62, totalCost: 9050, tankAfter: 3900 },
];

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
};

/* ── Modals ─────────────────────────────────────────────── */

function RecordSaleModal({ fuelTypes, onClose, onSave }: { fuelTypes: FuelType[]; onClose: () => void; onSave: (s: FuelSale) => void }) {
  const [customer, setCustomer] = useState('');
  const [fuelTypeId, setFuelTypeId] = useState(fuelTypes[0]?.id ?? '');
  const [gallons, setGallons] = useState('');
  const [pump, setPump] = useState('1');
  const [method, setMethod] = useState('Card');
  const ft = fuelTypes.find((f) => f.id === fuelTypeId);
  const total = ft ? parseFloat(gallons || '0') * ft.pricePerGal : 0;
  return (
    <div style={st.overlay} onClick={onClose}>
      <div style={st.modal} className="helm-modal" onClick={(e) => e.stopPropagation()}>
        <div style={st.modalHeader}><h2 style={st.modalTitle}>Record Fuel Sale</h2><button style={st.closeBtn} onClick={onClose}><X size={20} /></button></div>
        <div style={st.modalBody}>
          <div style={st.field}><label style={st.label}>Customer / Vessel</label><input style={st.input} value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="Name or slip # (leave blank for walk-up)" /></div>
          <div style={st.row2}>
            <div style={st.field}><label style={st.label}>Fuel Type *</label>
              <select style={st.input} value={fuelTypeId} onChange={(e) => setFuelTypeId(e.target.value)}>
                {fuelTypes.map((f) => <option key={f.id} value={f.id}>{f.label} (${f.pricePerGal.toFixed(2)}/gal)</option>)}
              </select>
            </div>
            <div style={st.field}><label style={st.label}>Pump #</label>
              <select style={st.input} value={pump} onChange={(e) => setPump(e.target.value)}>
                <option value="1">Pump 1</option><option value="2">Pump 2</option><option value="3">Pump 3</option>
              </select>
            </div>
          </div>
          <div style={st.row2}>
            <div style={st.field}><label style={st.label}>Gallons Dispensed *</label><input style={st.input} type="number" step="0.1" value={gallons} onChange={(e) => setGallons(e.target.value)} placeholder="0.0" /></div>
            <div style={st.field}><label style={st.label}>Payment Method</label>
              <select style={st.input} value={method} onChange={(e) => setMethod(e.target.value)}>
                <option>Card</option><option>Cash</option><option>Charge to Slip</option><option>ACH</option>
              </select>
            </div>
          </div>
          {total > 0 && (
            <div style={{ padding: '12px 16px', background: '#E0F7FF', borderRadius: '6px', border: '1px solid #00D4FF', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '14px', color: '#0A2342', fontWeight: 600 }}>Sale Total</span>
              <span style={{ fontSize: '20px', fontWeight: 700, color: '#0A2342', fontFamily: '"JetBrains Mono", monospace' }}>${total.toFixed(2)}</span>
            </div>
          )}
        </div>
        <div style={st.modalFooter}>
          <button style={st.cancelBtn} onClick={onClose}>Cancel</button>
          <button style={st.saveBtn} onClick={() => {
            if (!gallons || !ft) return;
            const now = new Date();
            const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
            const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${timeStr}`;
            onSave({ id: String(Date.now()), date: dateStr, customer: customer || 'Walk-up Guest', fuelType: ft.label, gallons: parseFloat(gallons), pricePerGal: ft.pricePerGal, total: Math.round(total * 100) / 100, pump: parseInt(pump), staff: 'Current User', method });
            onClose();
          }}>Record Sale</button>
        </div>
      </div>
    </div>
  );
}

function LogDeliveryModal({ fuelTypes, onClose, onSave }: { fuelTypes: FuelType[]; onClose: () => void; onSave: (d: Delivery) => void }) {
  const [supplier, setSupplier] = useState('');
  const [fuelTypeId, setFuelTypeId] = useState(fuelTypes[0]?.id ?? '');
  const [gallons, setGallons] = useState('');
  const [costPerGal, setCostPerGal] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const total = parseFloat(gallons || '0') * parseFloat(costPerGal || '0');
  const ft = fuelTypes.find((f) => f.id === fuelTypeId);
  return (
    <div style={st.overlay} onClick={onClose}>
      <div style={st.modal} className="helm-modal" onClick={(e) => e.stopPropagation()}>
        <div style={st.modalHeader}><h2 style={st.modalTitle}>Log Fuel Delivery</h2><button style={st.closeBtn} onClick={onClose}><X size={20} /></button></div>
        <div style={st.modalBody}>
          <div style={st.field}><label style={st.label}>Supplier *</label><input style={st.input} value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="e.g. Gulf Coast Petroleum" /></div>
          <div style={st.row2}>
            <div style={st.field}><label style={st.label}>Fuel Type *</label>
              <select style={st.input} value={fuelTypeId} onChange={(e) => setFuelTypeId(e.target.value)}>
                {fuelTypes.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
            </div>
            <div style={st.field}><label style={st.label}>Delivery Date</label><input style={st.input} type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          </div>
          <div style={st.row2}>
            <div style={st.field}><label style={st.label}>Gallons Received *</label><input style={st.input} type="number" value={gallons} onChange={(e) => setGallons(e.target.value)} placeholder="0" /></div>
            <div style={st.field}><label style={st.label}>Cost / Gallon ($)</label><input style={st.input} type="number" step="0.01" value={costPerGal} onChange={(e) => setCostPerGal(e.target.value)} placeholder="0.00" /></div>
          </div>
          {total > 0 && (
            <div style={{ padding: '12px 16px', background: '#E0F7FF', borderRadius: '6px', border: '1px solid #00D4FF', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '14px', color: '#0A2342', fontWeight: 600 }}>Total Cost</span>
              <span style={{ fontSize: '20px', fontWeight: 700, color: '#0A2342', fontFamily: '"JetBrains Mono", monospace' }}>${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
          )}
        </div>
        <div style={st.modalFooter}>
          <button style={st.cancelBtn} onClick={onClose}>Cancel</button>
          <button style={st.saveBtn} onClick={() => {
            if (!supplier || !gallons || !ft) return;
            const tankAfter = ft.currentLevel + parseFloat(gallons);
            onSave({ id: String(Date.now()), date, supplier, fuelType: ft.label, gallons: parseFloat(gallons), costPerGal: parseFloat(costPerGal || '0'), totalCost: Math.round(total), tankAfter });
            onClose();
          }}>Log Delivery</button>
        </div>
      </div>
    </div>
  );
}

function UpdatePriceModal({ fuelType, onClose, onSave }: { fuelType: FuelType; onClose: () => void; onSave: (id: string, retail: number, cost: number) => void }) {
  const [retail, setRetail] = useState(String(fuelType.pricePerGal));
  const [cost, setCost] = useState(String(fuelType.costPerGal));
  const newMargin = parseFloat(retail || '0') - parseFloat(cost || '0');
  const newMarginPct = parseFloat(retail || '0') > 0 ? (newMargin / parseFloat(retail)) * 100 : 0;
  return (
    <div style={st.overlay} onClick={onClose}>
      <div style={{ ...st.modal, width: '400px' }} onClick={(e) => e.stopPropagation()}>
        <div style={st.modalHeader}><h2 style={st.modalTitle}>Update Price — {fuelType.label}</h2><button style={st.closeBtn} onClick={onClose}><X size={20} /></button></div>
        <div style={st.modalBody}>
          <div style={st.field}><label style={st.label}>Retail Price ($/gal) *</label><input style={{ ...st.input, fontSize: '18px', fontFamily: '"JetBrains Mono", monospace' }} type="number" step="0.01" value={retail} onChange={(e) => setRetail(e.target.value)} autoFocus /></div>
          <div style={st.field}><label style={st.label}>Cost Price ($/gal)</label><input style={{ ...st.input, fontFamily: '"JetBrains Mono", monospace' }} type="number" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} /></div>
          <div style={{ padding: '12px 16px', background: newMargin > 0 ? '#DEF7EC' : '#FDE8E8', borderRadius: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
            <span style={{ fontSize: '13px', color: '#64748B', fontWeight: 600 }}>Projected Margin</span>
            <span style={{ fontSize: '16px', fontWeight: 700, color: newMargin > 0 ? '#03543F' : '#9B1C1C', fontFamily: '"JetBrains Mono", monospace' }}>
              ${newMargin.toFixed(2)}/gal ({newMarginPct.toFixed(1)}%)
            </span>
          </div>
        </div>
        <div style={st.modalFooter}>
          <button style={st.cancelBtn} onClick={onClose}>Cancel</button>
          <button style={st.saveBtn} onClick={() => { onSave(fuelType.id, parseFloat(retail), parseFloat(cost)); onClose(); }}>Update Price</button>
        </div>
      </div>
    </div>
  );
}

/* ── Main Component ─────────────────────────────────────── */

export default function Fuel() {
  const [tab, setTab] = useState<'sales' | 'pricing' | 'deliveries' | 'tanks'>('sales');
  const [modal, setModal] = useState<'recordSale' | 'logDelivery' | { updatePrice: FuelType } | null>(null);

  const { data: apiFuelTypes, loading: loadingTypes } = useApi<FuelType[]>('get', '/api/fuel/types', { immediate: true });
  const { data: apiSales, loading: loadingSales } = useApi<FuelSale[]>('get', '/api/fuel/sales', { immediate: true });
  const { data: apiDeliveries, loading: loadingDeliveries } = useApi<Delivery[]>('get', '/api/fuel/deliveries', { immediate: true });
  const { data: apiTankLevels } = useApi<FuelType[]>('get', '/api/fuel/tank-levels', { immediate: true });

  const [localFuelTypes, setLocalFuelTypes] = useState<FuelType[]>([]);
  const [localSales, setLocalSales] = useState<FuelSale[]>([]);
  const [localDeliveries, setLocalDeliveries] = useState<FuelSale[]>([]);

  const fuelTypes = useMemo(() => localFuelTypes.length > 0 ? localFuelTypes : (apiFuelTypes ?? FUEL_TYPES), [localFuelTypes, apiFuelTypes]);
  const sales = useMemo(() => localSales.length > 0 ? localSales : (apiSales ?? SALES), [localSales, apiSales]);
  const deliveries = useMemo(() => apiDeliveries ?? DELIVERIES, [apiDeliveries]);
  const tankData = useMemo(() => localFuelTypes.length > 0 ? localFuelTypes : (apiTankLevels ?? fuelTypes), [localFuelTypes, apiTankLevels, fuelTypes]);

  const loading = loadingTypes || loadingSales || loadingDeliveries;

  const todaySales = sales.filter((s) => s.date.startsWith('2026-03-25'));
  const todayGallons = todaySales.reduce((s, sale) => s + sale.gallons, 0);
  const todayRevenue = todaySales.reduce((s, sale) => s + sale.total, 0);
  const avgMargin = fuelTypes.reduce((s, ft) => s + (ft.pricePerGal - ft.costPerGal), 0) / fuelTypes.length;

  const tabItems: { key: typeof tab; label: string }[] = [
    { key: 'sales', label: 'Sales Log' },
    { key: 'pricing', label: 'Pricing' },
    { key: 'deliveries', label: 'Deliveries' },
    { key: 'tanks', label: 'Tank Levels' },
  ];

  const tankColor = (pct: number) => pct > 50 ? '#22C55E' : pct > 25 ? '#F59E0B' : '#EF4444';

  const handleSaveSale = (s: FuelSale) => {
    setLocalSales((prev) => [s, ...(prev.length > 0 ? prev : (apiSales ?? SALES))]);
  };

  const handleSaveDelivery = (d: Delivery) => {
    setLocalFuelTypes((prev) => {
      const base = prev.length > 0 ? prev : (apiFuelTypes ?? FUEL_TYPES);
      return base.map((ft) => ft.label === d.fuelType ? { ...ft, currentLevel: Math.min(ft.tankCapacity, ft.currentLevel + d.gallons) } : ft);
    });
  };

  const handleUpdatePrice = (id: string, retail: number, cost: number) => {
    setLocalFuelTypes((prev) => {
      const base = prev.length > 0 ? prev : (apiFuelTypes ?? FUEL_TYPES);
      return base.map((ft) => ft.id === id ? { ...ft, pricePerGal: retail, costPerGal: cost } : ft);
    });
  };

  return (
    <div style={st.page}>
      <h1 style={st.title} className="helm-page-title">Fuel Management</h1>
      <hr style={st.divider} />

      {loading && <div style={{ textAlign: 'center', padding: '24px', color: '#64748B' }}>Loading fuel data...</div>}

      <div style={st.statsRow} className="helm-stats-grid">
        <div style={{ ...st.statCard, borderTop: '3px solid #00D4FF' }}>
          <div style={st.statLabel}>Gallons Sold Today</div>
          <div style={st.statValue}>{todayGallons.toFixed(1)}</div>
          <div style={st.statSub}>{todaySales.length} transactions</div>
        </div>
        <div style={st.statCard}>
          <div style={st.statLabel}>Revenue Today</div>
          <div style={st.statValue}>${todayRevenue.toFixed(2)}</div>
          <div style={st.statSub}>All fuel types</div>
        </div>
        <div style={st.statCard}>
          <div style={st.statLabel}>Avg Margin</div>
          <div style={st.statValue}>${avgMargin.toFixed(2)}/gal</div>
          <div style={st.statSub}>Across all types</div>
        </div>
        <div style={st.statCard}>
          <div style={st.statLabel}>Tank Status</div>
          <div style={st.statValue}>{fuelTypes.every((ft) => ft.currentLevel / ft.tankCapacity > 0.25) ? 'Good' : 'Low'}</div>
          <div style={st.statSub}>{fuelTypes.filter((ft) => ft.currentLevel / ft.tankCapacity <= 0.25).length} tanks need refill</div>
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
                  <th style={st.th}>Staff</th>
                  <th style={st.th}>Payment</th>
                </tr>
              </thead>
              <tbody>
                {sales.map((s, idx) => {
                  const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#D6E8F4';
                  return (
                    <tr key={s.id} style={{ backgroundColor: rowBg }}>
                      <td style={{ ...st.td, fontSize: '13px' }}>{s.date}</td>
                      <td style={{ ...st.td, fontWeight: 600 }}>{s.customer}</td>
                      <td style={st.td}>{s.fuelType}</td>
                      <td style={{ ...st.td, ...st.mono }}>{s.gallons.toFixed(1)}</td>
                      <td style={{ ...st.td, ...st.mono }}>${s.pricePerGal.toFixed(2)}</td>
                      <td style={{ ...st.td, ...st.mono, fontWeight: 600 }}>${s.total.toFixed(2)}</td>
                      <td style={{ ...st.td, textAlign: 'center' }}>#{s.pump}</td>
                      <td style={st.td}>{s.staff}</td>
                      <td style={st.td}>{s.method}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'pricing' && (
        <div style={st.pricingGrid}>
          {fuelTypes.map((ft) => (
            <div key={ft.id} style={st.priceCard}>
              <div style={st.priceLabel}><FuelIcon size={20} style={{ color: '#00D4FF' }} /> {ft.label}</div>
              <div style={st.priceRow}>
                <span style={st.priceRowLabel}>Retail Price</span>
                <span style={{ ...st.priceRowValue, color: '#0A2342' }}>${ft.pricePerGal.toFixed(2)}/gal</span>
              </div>
              <div style={st.priceRow}>
                <span style={st.priceRowLabel}>Cost</span>
                <span style={st.priceRowValue}>${ft.costPerGal.toFixed(2)}/gal</span>
              </div>
              <div style={st.priceRow}>
                <span style={st.priceRowLabel}>Margin</span>
                <span style={{ ...st.priceRowValue, color: '#22C55E' }}>${(ft.pricePerGal - ft.costPerGal).toFixed(2)}/gal</span>
              </div>
              <div style={{ ...st.priceRow, borderBottom: 'none' }}>
                <span style={st.priceRowLabel}>Margin %</span>
                <span style={{ ...st.priceRowValue, color: '#22C55E' }}>{(((ft.pricePerGal - ft.costPerGal) / ft.pricePerGal) * 100).toFixed(1)}%</span>
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
                {deliveries.map((d, idx) => {
                  const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#D6E8F4';
                  return (
                    <tr key={d.id} style={{ backgroundColor: rowBg }}>
                      <td style={st.td}>{d.date}</td>
                      <td style={{ ...st.td, fontWeight: 600 }}>{d.supplier}</td>
                      <td style={st.td}>{d.fuelType}</td>
                      <td style={{ ...st.td, ...st.mono }}>{d.gallons.toLocaleString()}</td>
                      <td style={{ ...st.td, ...st.mono }}>${d.costPerGal.toFixed(2)}</td>
                      <td style={{ ...st.td, ...st.mono, fontWeight: 600 }}>${d.totalCost.toLocaleString()}</td>
                      <td style={{ ...st.td, ...st.mono }}>{d.tankAfter.toLocaleString()} gal</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'tanks' && (
        <div style={st.tankGrid}>
          {tankData.map((ft) => {
            const pct = Math.round((ft.currentLevel / ft.tankCapacity) * 100);
            const daysRemaining = Math.round(ft.currentLevel / 50);
            return (
              <div key={ft.id} style={st.tankCard}>
                <div style={st.tankLabel}>{ft.label}</div>
                <div style={st.tankBar}>
                  <div style={{ ...st.tankFill, height: `${pct}%`, backgroundColor: tankColor(pct) }} />
                </div>
                <div style={{ fontSize: '28px', fontWeight: 700, color: '#0A2342', fontFamily: '"JetBrains Mono", monospace' }}>{pct}%</div>
                <div style={st.tankText}>{ft.currentLevel.toLocaleString()} / {ft.tankCapacity.toLocaleString()} gal</div>
                <div style={{ ...st.tankText, fontWeight: 600, color: daysRemaining < 14 ? '#EF4444' : '#22C55E' }}>~{daysRemaining} days remaining</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modals */}
      {modal === 'recordSale' && (
        <RecordSaleModal fuelTypes={fuelTypes} onClose={() => setModal(null)} onSave={handleSaveSale} />
      )}
      {modal === 'logDelivery' && (
        <LogDeliveryModal fuelTypes={fuelTypes} onClose={() => setModal(null)} onSave={handleSaveDelivery} />
      )}
      {modal !== null && typeof modal === 'object' && 'updatePrice' in modal && (
        <UpdatePriceModal fuelType={modal.updatePrice} onClose={() => setModal(null)} onSave={handleUpdatePrice} />
      )}
    </div>
  );
}
