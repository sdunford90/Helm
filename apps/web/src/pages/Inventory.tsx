import React, { useState } from 'react';
import { useApi } from '../hooks/useApi';
import {
  Package, Search, Plus, X, Download, Truck,
  AlertTriangle, ClipboardCheck, BarChart3, Edit2,
  Trash2, Printer, RefreshCw,
} from 'lucide-react';

/* ── Types ─────────────────────────────────────────────── */

interface Product {
  id: string; sku: string; barcode: string; name: string; category: string;
  costCents: number; priceCents: number; taxClass: string; qoh: number;
  reorderPoint: number; glRevenue: string; glCogs: string; trackInventory: boolean; active: boolean;
}

interface PurchaseOrder {
  id: string; poNumber: string; vendor: string; status: 'Draft' | 'Submitted' | 'Partial' | 'Received' | 'Cancelled';
  items: number; totalCostCents: number; expectedDate: string; createdDate: string;
}

interface CountSession {
  id: string; countNumber: string; date: string; startedBy: string; products: number; discrepancies: number; status: 'In Progress' | 'Completed';
}

interface Adjustment {
  id: string; date: string; product: string; sku: string; type: 'Received' | 'Sold' | 'Damaged' | 'Count' | 'Shrinkage' | 'Return';
  qtyChange: number; before: number; after: number; staff: string; notes: string;
}

/* ── Mock Data ─────────────────────────────────────────── */

const PRODUCTS: Product[] = [
  { id: '1', sku: 'FUEL-REG', barcode: '0012345000012', name: 'Regular Gas (gal)', category: 'Fuel', costCents: 365, priceCents: 429, taxClass: 'Exempt', qoh: 2400, reorderPoint: 500, glRevenue: '4400', glCogs: '5100', trackInventory: true, active: true },
  { id: '2', sku: 'FUEL-DSL', barcode: '0012345000029', name: 'Diesel (gal)', category: 'Fuel', costCents: 410, priceCents: 489, taxClass: 'Exempt', qoh: 1800, reorderPoint: 400, glRevenue: '4400', glCogs: '5100', trackInventory: true, active: true },
  { id: '3', sku: 'FUEL-PRM', barcode: '0012345000036', name: 'Premium Gas (gal)', category: 'Fuel', costCents: 408, priceCents: 479, taxClass: 'Exempt', qoh: 1200, reorderPoint: 300, glRevenue: '4400', glCogs: '5100', trackInventory: true, active: true },
  { id: '4', sku: 'ICE-10LB', barcode: '0012345000043', name: 'Bag of Ice (10lb)', category: 'Provisions', costCents: 199, priceCents: 399, taxClass: 'Standard', qoh: 85, reorderPoint: 20, glRevenue: '4500', glCogs: '5200', trackInventory: true, active: true },
  { id: '5', sku: 'BAIT-SHP', barcode: '0012345000050', name: 'Live Shrimp (dz)', category: 'Bait & Tackle', costCents: 499, priceCents: 899, taxClass: 'Standard', qoh: 24, reorderPoint: 10, glRevenue: '4500', glCogs: '5200', trackInventory: true, active: true },
  { id: '6', sku: 'BAIT-MIN', barcode: '0012345000067', name: 'Minnows (dz)', category: 'Bait & Tackle', costCents: 299, priceCents: 599, taxClass: 'Standard', qoh: 18, reorderPoint: 8, glRevenue: '4500', glCogs: '5200', trackInventory: true, active: true },
  { id: '7', sku: 'SNK-WTR', barcode: '0012345000074', name: 'Bottled Water', category: 'Provisions', costCents: 89, priceCents: 249, taxClass: 'Standard', qoh: 144, reorderPoint: 48, glRevenue: '4500', glCogs: '5200', trackInventory: true, active: true },
  { id: '8', sku: 'SNK-SODA', barcode: '0012345000081', name: 'Soft Drink (can)', category: 'Provisions', costCents: 65, priceCents: 199, taxClass: 'Standard', qoh: 200, reorderPoint: 60, glRevenue: '4500', glCogs: '5200', trackInventory: true, active: true },
  { id: '9', sku: 'SUN-SPF', barcode: '0012345000098', name: 'Sunscreen SPF 50', category: 'Marine Supplies', costCents: 699, priceCents: 1299, taxClass: 'Standard', qoh: 32, reorderPoint: 10, glRevenue: '4500', glCogs: '5200', trackInventory: true, active: true },
  { id: '10', sku: 'MRN-LINE', barcode: '0012345000104', name: 'Dock Line 3/8" 15\'', category: 'Marine Supplies', costCents: 999, priceCents: 1899, taxClass: 'Standard', qoh: 15, reorderPoint: 5, glRevenue: '4500', glCogs: '5200', trackInventory: true, active: true },
  { id: '11', sku: 'MRN-FEND', barcode: '0012345000111', name: 'Boat Fender', category: 'Marine Supplies', costCents: 1299, priceCents: 2499, taxClass: 'Standard', qoh: 3, reorderPoint: 4, glRevenue: '4500', glCogs: '5200', trackInventory: true, active: true },
  { id: '12', sku: 'APR-HAT', barcode: '0012345000128', name: 'Marina Cap', category: 'Apparel', costCents: 800, priceCents: 2200, taxClass: 'Standard', qoh: 48, reorderPoint: 12, glRevenue: '4500', glCogs: '5200', trackInventory: true, active: true },
  { id: '13', sku: 'APR-TEE', barcode: '0012345000135', name: 'Marina T-Shirt', category: 'Apparel', costCents: 1000, priceCents: 2800, taxClass: 'Standard', qoh: 36, reorderPoint: 10, glRevenue: '4500', glCogs: '5200', trackInventory: true, active: true },
  { id: '14', sku: 'MRN-OIL', barcode: '0012345000142', name: 'Marine Motor Oil (qt)', category: 'Boat Parts', costCents: 599, priceCents: 1199, taxClass: 'Standard', qoh: 24, reorderPoint: 8, glRevenue: '4500', glCogs: '5200', trackInventory: true, active: true },
  { id: '15', sku: 'MRN-FILT', barcode: '0012345000159', name: 'Oil Filter (universal)', category: 'Boat Parts', costCents: 499, priceCents: 999, taxClass: 'Standard', qoh: 12, reorderPoint: 6, glRevenue: '4500', glCogs: '5200', trackInventory: true, active: true },
];

const POS_DATA: PurchaseOrder[] = [
  { id: '1', poNumber: 'PO-0042', vendor: 'Gulf Coast Petroleum', status: 'Received', items: 3, totalCostCents: 2195000, expectedDate: '2026-03-22', createdDate: '2026-03-18' },
  { id: '2', poNumber: 'PO-0043', vendor: 'Marine Supply Distributors', status: 'Partial', items: 5, totalCostCents: 89500, expectedDate: '2026-03-25', createdDate: '2026-03-20' },
  { id: '3', poNumber: 'PO-0044', vendor: 'Coastal Bait & Tackle', status: 'Submitted', items: 2, totalCostCents: 45000, expectedDate: '2026-03-28', createdDate: '2026-03-24' },
  { id: '4', poNumber: 'PO-0045', vendor: 'Marina Apparel Co.', status: 'Draft', items: 4, totalCostCents: 125000, expectedDate: '2026-04-05', createdDate: '2026-03-25' },
  { id: '5', poNumber: 'PO-0041', vendor: 'Gulf Coast Petroleum', status: 'Received', items: 2, totalCostCents: 1650000, expectedDate: '2026-03-15', createdDate: '2026-03-10' },
];

const COUNTS: CountSession[] = [
  { id: '1', countNumber: 'CNT-012', date: '2026-03-25', startedBy: 'Jake Martinez', products: 15, discrepancies: 3, status: 'In Progress' },
  { id: '2', countNumber: 'CNT-011', date: '2026-03-18', startedBy: 'Maria Santos', products: 15, discrepancies: 1, status: 'Completed' },
  { id: '3', countNumber: 'CNT-010', date: '2026-03-11', startedBy: 'Jake Martinez', products: 15, discrepancies: 2, status: 'Completed' },
  { id: '4', countNumber: 'CNT-009', date: '2026-03-04', startedBy: 'Maria Santos', products: 15, discrepancies: 0, status: 'Completed' },
];

const ADJUSTMENTS: Adjustment[] = [
  { id: '1', date: '2026-03-25 10:30', product: 'Boat Fender', sku: 'MRN-FEND', type: 'Sold', qtyChange: -2, before: 5, after: 3, staff: 'Tom A.', notes: '' },
  { id: '2', date: '2026-03-25 09:15', product: 'Regular Gas', sku: 'FUEL-REG', type: 'Sold', qtyChange: -45, before: 2445, after: 2400, staff: 'Jake M.', notes: 'Customer: James H.' },
  { id: '3', date: '2026-03-24 16:00', product: 'Marina Cap', sku: 'APR-HAT', type: 'Sold', qtyChange: -2, before: 50, after: 48, staff: 'Maria S.', notes: '' },
  { id: '4', date: '2026-03-24 14:20', product: 'Live Shrimp', sku: 'BAIT-SHP', type: 'Damaged', qtyChange: -6, before: 30, after: 24, staff: 'Jake M.', notes: 'Expired — disposed' },
  { id: '5', date: '2026-03-22 08:00', product: 'Regular Gas', sku: 'FUEL-REG', type: 'Received', qtyChange: 3000, before: 1445, after: 4445, staff: 'Jake M.', notes: 'PO-0042 Gulf Coast' },
  { id: '6', date: '2026-03-22 08:00', product: 'Diesel', sku: 'FUEL-DSL', type: 'Received', qtyChange: 2500, before: 800, after: 3300, staff: 'Jake M.', notes: 'PO-0042 Gulf Coast' },
  { id: '7', date: '2026-03-18 15:30', product: 'Dock Line', sku: 'MRN-LINE', type: 'Count', qtyChange: -2, before: 17, after: 15, staff: 'Maria S.', notes: 'Physical count adjustment' },
  { id: '8', date: '2026-03-18 15:30', product: 'Sunscreen SPF 50', sku: 'SUN-SPF', type: 'Shrinkage', qtyChange: -1, before: 33, after: 32, staff: 'Maria S.', notes: 'Missing from shelf' },
  { id: '9', date: '2026-03-15 09:00', product: 'Bottled Water', sku: 'SNK-WTR', type: 'Received', qtyChange: 96, before: 48, after: 144, staff: 'Jake M.', notes: 'PO-0041' },
  { id: '10', date: '2026-03-14 11:00', product: 'Marina T-Shirt', sku: 'APR-TEE', type: 'Return', qtyChange: 2, before: 34, after: 36, staff: 'Maria S.', notes: 'Customer return — wrong size' },
];

/* ── Helpers ───────────────────────────────────────────── */

const fmt = (cents: number) => '$' + (cents / 100).toFixed(2);
const stockStatus = (p: Product) => p.qoh === 0 ? { label: 'Out of Stock', bg: '#FDE8E8', color: '#9B1C1C' } : p.qoh <= p.reorderPoint ? { label: 'Low Stock', bg: '#FFF3CD', color: '#856404' } : { label: 'In Stock', bg: '#DEF7EC', color: '#03543F' };
const adjTypeColors: Record<string, { bg: string; color: string }> = { Received: { bg: '#DEF7EC', color: '#03543F' }, Sold: { bg: '#D6E8F4', color: '#0A2342' }, Damaged: { bg: '#FDE8E8', color: '#9B1C1C' }, Count: { bg: '#E0F7FF', color: '#0A2342' }, Shrinkage: { bg: '#FFF3CD', color: '#856404' }, Return: { bg: '#F3E8FF', color: '#6B21A8' } };
const poStatusColors: Record<string, { bg: string; color: string }> = { Draft: { bg: '#F3F4F6', color: '#64748B' }, Submitted: { bg: '#E0F7FF', color: '#0A2342' }, Partial: { bg: '#FFF3CD', color: '#856404' }, Received: { bg: '#DEF7EC', color: '#03543F' }, Cancelled: { bg: '#FDE8E8', color: '#9B1C1C' } };

/* ── Styles ─────────────────────────────────────────────── */

const st: Record<string, React.CSSProperties> = {
  page: { padding: '32px' },
  title: { fontSize: '36px', fontWeight: 700, color: '#0A2342', letterSpacing: '-0.02em', margin: 0 },
  divider: { height: '4px', background: 'linear-gradient(90deg, #00D4FF, transparent)', border: 'none', marginTop: '12px', marginBottom: '32px', borderRadius: '2px' },
  statsRow: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '28px' },
  statCard: { background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '16px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' },
  statLabel: { fontSize: '11px', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.05em', color: '#64748B', marginBottom: '4px' },
  statValue: { fontSize: '22px', fontWeight: 700, color: '#0A2342', fontFamily: '"JetBrains Mono", monospace' },
  statSub: { fontSize: '12px', color: '#2E4A6B', marginTop: '2px' },
  tabs: { display: 'flex', borderBottom: '2px solid #E2E8F0', marginBottom: '24px' },
  tab: { padding: '10px 24px', fontSize: '14px', fontWeight: 600, border: 'none', background: 'none', cursor: 'pointer', color: '#64748B', borderBottom: '2px solid transparent', marginBottom: '-2px' },
  tabActive: { color: '#0A2342', borderBottom: '2px solid #00D4FF' },
  filterBar: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' as const },
  searchWrap: { position: 'relative' as const, flex: 1, minWidth: '200px' },
  searchIcon: { position: 'absolute' as const, left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#64748B', pointerEvents: 'none' as const },
  searchInput: { width: '100%', padding: '8px 12px 8px 36px', fontSize: '14px', border: '1px solid #CCC', borderRadius: '4px', color: '#0A2342', boxSizing: 'border-box' as const },
  select: { padding: '8px 12px', fontSize: '14px', border: '1px solid #CCC', borderRadius: '4px', color: '#0A2342', background: '#FFFFFF', cursor: 'pointer' },
  addBtn: { display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 20px', fontSize: '14px', fontWeight: 600, color: '#FFFFFF', backgroundColor: '#0A2342', border: 'none', borderRadius: '6px', cursor: 'pointer', whiteSpace: 'nowrap' as const },
  outlineBtn: { display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', fontSize: '13px', fontWeight: 600, color: '#0A2342', backgroundColor: '#FFFFFF', border: '1px solid #CCC', borderRadius: '6px', cursor: 'pointer' },
  tableWrap: { background: '#FFFFFF', borderRadius: '8px', border: '1px solid #E2E8F0', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', overflow: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: '13px' },
  th: { textAlign: 'left' as const, padding: '10px 12px', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.05em', color: '#FFFFFF', backgroundColor: '#0A2342', borderBottom: '2px solid #00D4FF', whiteSpace: 'nowrap' as const },
  td: { padding: '10px 12px', color: '#0A2342', borderBottom: '1px solid #E2E8F0' },
  mono: { fontFamily: '"JetBrains Mono", monospace', fontSize: '13px' },
  badge: { display: 'inline-block', padding: '2px 8px', fontSize: '11px', fontWeight: 600, borderRadius: '9999px' },
};

/* ── Component ─────────────────────────────────────────── */

type Tab = 'products' | 'po' | 'counts' | 'adjustments' | 'valuation';

export default function Inventory() {
  const [tab, setTab] = useState<Tab>('products');
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('All');
  const [lowOnly, setLowOnly] = useState(false);

  const totalValue = PRODUCTS.reduce((s, p) => s + p.qoh * p.costCents, 0);
  const lowCount = PRODUCTS.filter((p) => p.qoh <= p.reorderPoint && p.qoh > 0).length;
  const outCount = PRODUCTS.filter((p) => p.qoh === 0).length;
  const openPOs = POS_DATA.filter((p) => p.status === 'Submitted' || p.status === 'Partial').length;
  const categories = ['All', ...Array.from(new Set(PRODUCTS.map((p) => p.category)))];

  const filteredProducts = PRODUCTS.filter((p) => {
    if (catFilter !== 'All' && p.category !== catFilter) return false;
    if (lowOnly && p.qoh > p.reorderPoint) return false;
    if (search) { const q = search.toLowerCase(); return p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || p.barcode.includes(q); }
    return true;
  });

  const tabItems: { key: Tab; label: string }[] = [
    { key: 'products', label: 'Products' },
    { key: 'po', label: 'Purchase Orders' },
    { key: 'counts', label: 'Inventory Counts' },
    { key: 'adjustments', label: 'Adjustments' },
    { key: 'valuation', label: 'Valuation' },
  ];

  return (
    <div style={st.page}>
      <h1 style={st.title}>Inventory Management</h1>
      <hr style={st.divider} />

      <div style={st.statsRow}>
        <div style={{ ...st.statCard, borderTop: '3px solid #00D4FF' }}>
          <div style={st.statLabel}>Total Products</div>
          <div style={st.statValue}>{PRODUCTS.length}</div>
          <div style={st.statSub}>{PRODUCTS.filter((p) => p.active).length} active</div>
        </div>
        <div style={st.statCard}>
          <div style={st.statLabel}>Inventory Value</div>
          <div style={st.statValue}>{fmt(totalValue)}</div>
          <div style={st.statSub}>At cost (FIFO)</div>
        </div>
        <div style={{ ...st.statCard, borderTop: (lowCount + outCount) > 0 ? '3px solid #F59E0B' : undefined }}>
          <div style={st.statLabel}>Stock Alerts</div>
          <div style={{ ...st.statValue, color: (lowCount + outCount) > 0 ? '#856404' : '#03543F' }}>{lowCount + outCount}</div>
          <div style={st.statSub}>{lowCount} low, {outCount} out</div>
        </div>
        <div style={st.statCard}>
          <div style={st.statLabel}>Open POs</div>
          <div style={st.statValue}>{openPOs}</div>
          <div style={st.statSub}>{POS_DATA.filter((p) => p.status === 'Draft').length} draft</div>
        </div>
      </div>

      <div style={st.tabs}>
        {tabItems.map((t) => <button key={t.key} style={{ ...st.tab, ...(tab === t.key ? st.tabActive : {}) }} onClick={() => setTab(t.key)}>{t.label}</button>)}
      </div>

      {/* Products */}
      {tab === 'products' && (<>
        <div style={st.filterBar}>
          <div style={st.searchWrap}><Search size={16} style={st.searchIcon} /><input style={st.searchInput} placeholder="Search name, SKU, barcode..." value={search} onChange={(e) => setSearch(e.target.value)} /></div>
          <select style={st.select} value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>{categories.map((c) => <option key={c}>{c}</option>)}</select>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#0A2342', cursor: 'pointer' }}><input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} /> Low Stock Only</label>
          <button style={st.outlineBtn}><Printer size={14} /> Print Labels</button>
          <button style={st.addBtn}><Plus size={16} /> Add Product</button>
        </div>
        <div style={st.tableWrap}>
          <table style={st.table}>
            <thead><tr>
              <th style={st.th}>SKU</th><th style={st.th}>Barcode</th><th style={st.th}>Name</th><th style={st.th}>Category</th>
              <th style={st.th}>Cost</th><th style={st.th}>Price</th><th style={st.th}>Margin</th><th style={st.th}>QOH</th>
              <th style={st.th}>Reorder</th><th style={st.th}>Status</th><th style={st.th}>GL Rev</th><th style={st.th}>Actions</th>
            </tr></thead>
            <tbody>
              {filteredProducts.map((p, idx) => { const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#D6E8F4'; const ss = stockStatus(p); const margin = p.priceCents > 0 ? ((p.priceCents - p.costCents) / p.priceCents * 100).toFixed(0) : '0'; return (
                <tr key={p.id}>
                  <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono, fontWeight: 600 }}>{p.sku}</td>
                  <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono, fontSize: '11px' }}>{p.barcode}</td>
                  <td style={{ ...st.td, backgroundColor: rowBg, fontWeight: 600 }}>{p.name}</td>
                  <td style={{ ...st.td, backgroundColor: rowBg }}>{p.category}</td>
                  <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono }}>{fmt(p.costCents)}</td>
                  <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono }}>{fmt(p.priceCents)}</td>
                  <td style={{ ...st.td, backgroundColor: rowBg, color: '#03543F', fontWeight: 600 }}>{margin}%</td>
                  <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono, fontWeight: 700, color: p.qoh <= p.reorderPoint ? '#856404' : '#0A2342' }}>{p.qoh}</td>
                  <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono }}>{p.reorderPoint}</td>
                  <td style={{ ...st.td, backgroundColor: rowBg }}><span style={{ ...st.badge, backgroundColor: ss.bg, color: ss.color }}>{ss.label}</span></td>
                  <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono, fontSize: '11px' }}>{p.glRevenue}</td>
                  <td style={{ ...st.td, backgroundColor: rowBg }}>
                    <button style={{ background: 'none', border: 'none', color: '#00D4FF', cursor: 'pointer', marginRight: '8px' }}><Edit2 size={14} /></button>
                    <button style={{ background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer' }}><Trash2 size={14} /></button>
                  </td>
                </tr>
              ); })}
            </tbody>
          </table>
        </div>
      </>)}

      {/* Purchase Orders */}
      {tab === 'po' && (<>
        <div style={st.filterBar}><div style={{ flex: 1 }} /><button style={st.addBtn}><Plus size={16} /> Create PO</button></div>
        <div style={st.tableWrap}><table style={st.table}><thead><tr>
          <th style={st.th}>PO #</th><th style={st.th}>Vendor</th><th style={st.th}>Items</th><th style={st.th}>Total Cost</th><th style={st.th}>Expected</th><th style={st.th}>Created</th><th style={st.th}>Status</th><th style={st.th}>Actions</th>
        </tr></thead><tbody>
          {POS_DATA.map((po, idx) => { const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#D6E8F4'; const sc = poStatusColors[po.status]; return (
            <tr key={po.id}>
              <td style={{ ...st.td, backgroundColor: rowBg, fontWeight: 700 }}>{po.poNumber}</td>
              <td style={{ ...st.td, backgroundColor: rowBg }}>{po.vendor}</td>
              <td style={{ ...st.td, backgroundColor: rowBg, textAlign: 'center' }}>{po.items}</td>
              <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono }}>{fmt(po.totalCostCents)}</td>
              <td style={{ ...st.td, backgroundColor: rowBg }}>{po.expectedDate}</td>
              <td style={{ ...st.td, backgroundColor: rowBg }}>{po.createdDate}</td>
              <td style={{ ...st.td, backgroundColor: rowBg }}><span style={{ ...st.badge, backgroundColor: sc.bg, color: sc.color }}>{po.status}</span></td>
              <td style={{ ...st.td, backgroundColor: rowBg }}>
                {(po.status === 'Submitted' || po.status === 'Partial') && <button style={{ ...st.outlineBtn, padding: '4px 10px', fontSize: '12px' }}><Truck size={12} /> Receive</button>}
                {po.status === 'Draft' && <button style={{ ...st.outlineBtn, padding: '4px 10px', fontSize: '12px' }}>Submit</button>}
              </td>
            </tr>
          ); })}
        </tbody></table></div>
      </>)}

      {/* Counts */}
      {tab === 'counts' && (<>
        <div style={st.filterBar}><div style={{ flex: 1 }} /><button style={st.addBtn}><ClipboardCheck size={16} /> Start Count</button></div>
        <div style={st.tableWrap}><table style={st.table}><thead><tr>
          <th style={st.th}>Count #</th><th style={st.th}>Date</th><th style={st.th}>Started By</th><th style={st.th}>Products</th><th style={st.th}>Discrepancies</th><th style={st.th}>Status</th>
        </tr></thead><tbody>
          {COUNTS.map((c, idx) => { const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#D6E8F4'; return (
            <tr key={c.id}>
              <td style={{ ...st.td, backgroundColor: rowBg, fontWeight: 700 }}>{c.countNumber}</td>
              <td style={{ ...st.td, backgroundColor: rowBg }}>{c.date}</td>
              <td style={{ ...st.td, backgroundColor: rowBg }}>{c.startedBy}</td>
              <td style={{ ...st.td, backgroundColor: rowBg, textAlign: 'center' }}>{c.products}</td>
              <td style={{ ...st.td, backgroundColor: rowBg, textAlign: 'center', color: c.discrepancies > 0 ? '#856404' : '#03543F', fontWeight: 600 }}>{c.discrepancies}</td>
              <td style={{ ...st.td, backgroundColor: rowBg }}><span style={{ ...st.badge, backgroundColor: c.status === 'In Progress' ? '#E0F7FF' : '#DEF7EC', color: c.status === 'In Progress' ? '#0A2342' : '#03543F' }}>{c.status}</span></td>
            </tr>
          ); })}
        </tbody></table></div>
      </>)}

      {/* Adjustments */}
      {tab === 'adjustments' && (<>
        <div style={st.filterBar}>
          <div style={st.searchWrap}><Search size={16} style={st.searchIcon} /><input style={st.searchInput} placeholder="Search product..." value={search} onChange={(e) => setSearch(e.target.value)} /></div>
          <button style={st.addBtn}><Plus size={16} /> Manual Adjustment</button>
        </div>
        <div style={st.tableWrap}><table style={st.table}><thead><tr>
          <th style={st.th}>Date</th><th style={st.th}>Product</th><th style={st.th}>SKU</th><th style={st.th}>Type</th><th style={st.th}>Qty Change</th><th style={st.th}>Before</th><th style={st.th}>After</th><th style={st.th}>Staff</th><th style={st.th}>Notes</th>
        </tr></thead><tbody>
          {ADJUSTMENTS.map((a, idx) => { const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#D6E8F4'; const tc = adjTypeColors[a.type]; return (
            <tr key={a.id}>
              <td style={{ ...st.td, backgroundColor: rowBg, fontSize: '12px' }}>{a.date}</td>
              <td style={{ ...st.td, backgroundColor: rowBg, fontWeight: 600 }}>{a.product}</td>
              <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono }}>{a.sku}</td>
              <td style={{ ...st.td, backgroundColor: rowBg }}><span style={{ ...st.badge, backgroundColor: tc.bg, color: tc.color }}>{a.type}</span></td>
              <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono, fontWeight: 700, color: a.qtyChange > 0 ? '#03543F' : '#9B1C1C' }}>{a.qtyChange > 0 ? '+' : ''}{a.qtyChange}</td>
              <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono }}>{a.before}</td>
              <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono }}>{a.after}</td>
              <td style={{ ...st.td, backgroundColor: rowBg }}>{a.staff}</td>
              <td style={{ ...st.td, backgroundColor: rowBg, color: a.notes ? '#0A2342' : '#94A3B8', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.notes || '—'}</td>
            </tr>
          ); })}
        </tbody></table></div>
      </>)}

      {/* Valuation */}
      {tab === 'valuation' && (<>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px', marginBottom: '24px' }}>
          <div style={st.statCard}><div style={st.statLabel}>Total Cost Value</div><div style={st.statValue}>{fmt(totalValue)}</div></div>
          <div style={st.statCard}><div style={st.statLabel}>Total Retail Value</div><div style={st.statValue}>{fmt(PRODUCTS.reduce((s, p) => s + p.qoh * p.priceCents, 0))}</div></div>
          <div style={st.statCard}><div style={st.statLabel}>Avg Margin</div><div style={st.statValue}>{(PRODUCTS.reduce((s, p) => s + (p.priceCents > 0 ? (p.priceCents - p.costCents) / p.priceCents * 100 : 0), 0) / PRODUCTS.length).toFixed(1)}%</div></div>
        </div>
        <div style={st.filterBar}><div style={{ flex: 1 }} /><button style={st.outlineBtn}><Download size={14} /> Export CSV</button></div>
        <div style={st.tableWrap}><table style={st.table}><thead><tr>
          <th style={st.th}>Product</th><th style={st.th}>SKU</th><th style={st.th}>QOH</th><th style={st.th}>Unit Cost</th><th style={st.th}>Total Cost</th><th style={st.th}>Retail Price</th><th style={st.th}>Total Retail</th><th style={st.th}>Margin %</th>
        </tr></thead><tbody>
          {PRODUCTS.map((p, idx) => { const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#D6E8F4'; const margin = p.priceCents > 0 ? ((p.priceCents - p.costCents) / p.priceCents * 100) : 0; return (
            <tr key={p.id}>
              <td style={{ ...st.td, backgroundColor: rowBg, fontWeight: 600 }}>{p.name}</td>
              <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono }}>{p.sku}</td>
              <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono, textAlign: 'right' }}>{p.qoh.toLocaleString()}</td>
              <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono, textAlign: 'right' }}>{fmt(p.costCents)}</td>
              <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono, textAlign: 'right', fontWeight: 600 }}>{fmt(p.qoh * p.costCents)}</td>
              <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono, textAlign: 'right' }}>{fmt(p.priceCents)}</td>
              <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono, textAlign: 'right' }}>{fmt(p.qoh * p.priceCents)}</td>
              <td style={{ ...st.td, backgroundColor: rowBg, textAlign: 'right', fontWeight: 600, color: margin > 40 ? '#03543F' : margin > 20 ? '#0A2342' : '#856404' }}>{margin.toFixed(1)}%</td>
            </tr>
          ); })}
        </tbody>
        <tfoot><tr style={{ fontWeight: 700, backgroundColor: '#F1F5F9' }}>
          <td colSpan={4} style={{ ...st.td, textAlign: 'right', fontWeight: 700 }}>TOTALS:</td>
          <td style={{ ...st.td, ...st.mono, textAlign: 'right', fontWeight: 700 }}>{fmt(totalValue)}</td>
          <td style={st.td}></td>
          <td style={{ ...st.td, ...st.mono, textAlign: 'right', fontWeight: 700 }}>{fmt(PRODUCTS.reduce((s, p) => s + p.qoh * p.priceCents, 0))}</td>
          <td style={st.td}></td>
        </tr></tfoot></table></div>
      </>)}
    </div>
  );
}
