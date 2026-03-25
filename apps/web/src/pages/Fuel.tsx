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
};

/* ── Main Component ─────────────────────────────────────── */

export default function Fuel() {
  const [tab, setTab] = useState<'sales' | 'pricing' | 'deliveries' | 'tanks'>('sales');

  // API calls with fallback to mock data
  const { data: apiFuelTypes, loading: loadingTypes } = useApi<FuelType[]>('get', '/api/fuel/types', { immediate: true });
  const { data: apiSales, loading: loadingSales } = useApi<FuelSale[]>('get', '/api/fuel/sales', { immediate: true });
  const { data: apiDeliveries, loading: loadingDeliveries } = useApi<Delivery[]>('get', '/api/fuel/deliveries', { immediate: true });
  const { data: apiTankLevels } = useApi<FuelType[]>('get', '/api/fuel/tank-levels', { immediate: true });
  const recordSale = useApi<FuelSale>('post', '/api/fuel/sales');

  const fuelTypes = useMemo(() => apiFuelTypes ?? FUEL_TYPES, [apiFuelTypes]);
  const sales = useMemo(() => apiSales ?? SALES, [apiSales]);
  const deliveries = useMemo(() => apiDeliveries ?? DELIVERIES, [apiDeliveries]);
  const tankData = useMemo(() => apiTankLevels ?? fuelTypes, [apiTankLevels, fuelTypes]);

  const loading = loadingTypes || loadingSales || loadingDeliveries;

  const todaySales = sales.filter((s) => s.date.startsWith('2026-03-25'));
  const todayGallons = todaySales.reduce((s, sale) => s + sale.gallons, 0);
  const todayRevenue = todaySales.reduce((s, sale) => s + sale.total, 0);
  const avgMargin = FUEL_TYPES.reduce((s, ft) => s + (ft.pricePerGal - ft.costPerGal), 0) / FUEL_TYPES.length;

  const tabItems: { key: typeof tab; label: string }[] = [
    { key: 'sales', label: 'Sales Log' },
    { key: 'pricing', label: 'Pricing' },
    { key: 'deliveries', label: 'Deliveries' },
    { key: 'tanks', label: 'Tank Levels' },
  ];

  const tankColor = (pct: number) => pct > 50 ? '#22C55E' : pct > 25 ? '#F59E0B' : '#EF4444';

  return (
    <div style={st.page}>
      <h1 style={st.title}>Fuel Management</h1>
      <hr style={st.divider} />

      <div style={st.statsRow}>
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
          <div style={st.statValue}>{FUEL_TYPES.every((ft) => ft.currentLevel / ft.tankCapacity > 0.25) ? 'Good' : 'Low'}</div>
          <div style={st.statSub}>{FUEL_TYPES.filter((ft) => ft.currentLevel / ft.tankCapacity <= 0.25).length} tanks need refill</div>
        </div>
      </div>

      <div style={st.tabs}>
        {tabItems.map((t) => (
          <button key={t.key} style={{ ...st.tab, ...(tab === t.key ? st.tabActive : {}) }} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>

      {tab === 'sales' && (
        <>
          <div style={st.filterBar}>
            <div style={{ flex: 1 }} />
            <button style={st.addBtn}><Plus size={16} /> Record Sale</button>
          </div>
          <div style={st.tableWrap}>
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
                {SALES.map((s, idx) => {
                  const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#D6E8F4';
                  return (
                    <tr key={s.id}>
                      <td style={{ ...st.td, backgroundColor: rowBg, fontSize: '13px' }}>{s.date}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg, fontWeight: 600 }}>{s.customer}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>{s.fuelType}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono }}>{s.gallons.toFixed(1)}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono }}>${s.pricePerGal.toFixed(2)}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono, fontWeight: 600 }}>${s.total.toFixed(2)}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg, textAlign: 'center' }}>#{s.pump}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>{s.staff}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>{s.method}</td>
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
          {FUEL_TYPES.map((ft) => (
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
              <button style={{ ...st.addBtn, marginTop: '16px', width: '100%', justifyContent: 'center' }}><Edit2 size={14} /> Update Price</button>
            </div>
          ))}
        </div>
      )}

      {tab === 'deliveries' && (
        <>
          <div style={st.filterBar}>
            <div style={{ flex: 1 }} />
            <button style={st.addBtn}><Truck size={16} /> Log Delivery</button>
          </div>
          <div style={st.tableWrap}>
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
                {DELIVERIES.map((d, idx) => {
                  const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#D6E8F4';
                  return (
                    <tr key={d.id}>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>{d.date}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg, fontWeight: 600 }}>{d.supplier}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>{d.fuelType}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono }}>{d.gallons.toLocaleString()}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono }}>${d.costPerGal.toFixed(2)}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono, fontWeight: 600 }}>${d.totalCost.toLocaleString()}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono }}>{d.tankAfter.toLocaleString()} gal</td>
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
          {FUEL_TYPES.map((ft) => {
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
    </div>
  );
}
