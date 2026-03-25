import React, { useState, useMemo } from 'react';
import {
  ShoppingCart, Search, Plus, Minus, X, CreditCard,
  Banknote, Building2, DollarSign, Clock, Package,
  AlertTriangle, Trash2,
} from 'lucide-react';
import { useApi } from '../hooks/useApi';

/* ── Types ─────────────────────────────────────────────── */

interface Product {
  id: string;
  sku: string;
  name: string;
  category: string;
  price: number;
  taxRate: number;
  inStock: number;
  reorderPoint: number;
  image?: string;
}

interface CartItem {
  product: Product;
  quantity: number;
}

interface Transaction {
  id: string;
  number: string;
  date: string;
  items: number;
  subtotal: number;
  tax: number;
  total: number;
  method: string;
  cashier: string;
}

/* ── Mock Data ─────────────────────────────────────────── */

const PRODUCTS: Product[] = [
  { id: '1', sku: 'FUEL-REG', name: 'Regular Gas (gal)', category: 'Fuel', price: 4.29, taxRate: 0, inStock: 2400, reorderPoint: 500 },
  { id: '2', sku: 'FUEL-DSL', name: 'Diesel (gal)', category: 'Fuel', price: 4.89, taxRate: 0, inStock: 1800, reorderPoint: 400 },
  { id: '3', sku: 'ICE-BAG', name: 'Bag of Ice (10lb)', category: 'Provisions', price: 3.99, taxRate: 7, inStock: 85, reorderPoint: 20 },
  { id: '4', sku: 'BAIT-SHP', name: 'Live Shrimp (dz)', category: 'Bait & Tackle', price: 8.99, taxRate: 7, inStock: 24, reorderPoint: 10 },
  { id: '5', sku: 'BAIT-MIN', name: 'Minnows (dz)', category: 'Bait & Tackle', price: 5.99, taxRate: 7, inStock: 18, reorderPoint: 8 },
  { id: '6', sku: 'SNK-WTER', name: 'Bottled Water', category: 'Provisions', price: 2.49, taxRate: 7, inStock: 144, reorderPoint: 48 },
  { id: '7', sku: 'SNK-SODA', name: 'Soft Drink (can)', category: 'Provisions', price: 1.99, taxRate: 7, inStock: 200, reorderPoint: 60 },
  { id: '8', sku: 'SUN-SPF', name: 'Sunscreen SPF 50', category: 'Marine Supplies', price: 12.99, taxRate: 7, inStock: 32, reorderPoint: 10 },
  { id: '9', sku: 'MRN-LINE', name: 'Dock Line 3/8" 15\'', category: 'Marine Supplies', price: 18.99, taxRate: 7, inStock: 15, reorderPoint: 5 },
  { id: '10', sku: 'MRN-FEND', name: 'Boat Fender', category: 'Marine Supplies', price: 24.99, taxRate: 7, inStock: 12, reorderPoint: 4 },
  { id: '11', sku: 'APR-HAT', name: 'Marina Cap', category: 'Apparel', price: 22.00, taxRate: 7, inStock: 48, reorderPoint: 12 },
  { id: '12', sku: 'APR-TEE', name: 'Marina T-Shirt', category: 'Apparel', price: 28.00, taxRate: 7, inStock: 36, reorderPoint: 10 },
];

const TRANSACTIONS: Transaction[] = [
  { id: '1', number: 'TXN-3042', date: '2026-03-25 11:32 AM', items: 3, subtotal: 12.47, tax: 0.87, total: 13.34, method: 'Card', cashier: 'Jake M.' },
  { id: '2', number: 'TXN-3041', date: '2026-03-25 10:45 AM', items: 1, subtotal: 85.80, tax: 0.00, total: 85.80, method: 'Card', cashier: 'Jake M.' },
  { id: '3', number: 'TXN-3040', date: '2026-03-25 9:18 AM', items: 5, subtotal: 48.94, tax: 3.43, total: 52.37, method: 'Cash', cashier: 'Jake M.' },
  { id: '4', number: 'TXN-3039', date: '2026-03-24 4:52 PM', items: 2, subtotal: 27.98, tax: 1.96, total: 29.94, method: 'Charge to Slip', cashier: 'Maria S.' },
  { id: '5', number: 'TXN-3038', date: '2026-03-24 3:30 PM', items: 1, subtotal: 22.00, tax: 1.54, total: 23.54, method: 'Card', cashier: 'Maria S.' },
  { id: '6', number: 'TXN-3037', date: '2026-03-24 1:15 PM', items: 4, subtotal: 35.96, tax: 2.52, total: 38.48, method: 'Cash', cashier: 'Maria S.' },
  { id: '7', number: 'TXN-3036', date: '2026-03-24 11:00 AM', items: 2, subtotal: 42.58, tax: 0.00, total: 42.58, method: 'Card', cashier: 'Jake M.' },
  { id: '8', number: 'TXN-3035', date: '2026-03-24 9:05 AM', items: 6, subtotal: 62.44, tax: 4.37, total: 66.81, method: 'Card', cashier: 'Jake M.' },
  { id: '9', number: 'TXN-3034', date: '2026-03-23 5:10 PM', items: 1, subtotal: 97.80, tax: 0.00, total: 97.80, method: 'Cash', cashier: 'Maria S.' },
  { id: '10', number: 'TXN-3033', date: '2026-03-23 2:42 PM', items: 3, subtotal: 54.97, tax: 3.85, total: 58.82, method: 'Card', cashier: 'Maria S.' },
];

/* ── Styles ─────────────────────────────────────────────── */

const st: Record<string, React.CSSProperties> = {
  page: { padding: '32px' },
  title: { fontSize: '36px', fontWeight: 700, color: '#0A2342', letterSpacing: '-0.02em', margin: 0 },
  divider: { height: '4px', background: 'linear-gradient(90deg, #00D4FF, transparent)', border: 'none', marginTop: '12px', marginBottom: '32px', borderRadius: '2px' },
  shiftBanner: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 24px', background: '#0A2342', borderRadius: '8px', marginBottom: '24px', color: '#FFFFFF' },
  shiftInfo: { display: 'flex', alignItems: 'center', gap: '32px' },
  shiftLabel: { fontSize: '11px', textTransform: 'uppercase' as const, letterSpacing: '0.05em', color: '#00D4FF', marginBottom: '2px' },
  shiftValue: { fontSize: '15px', fontWeight: 600, color: '#FFFFFF' },
  tabs: { display: 'flex', gap: '0', borderBottom: '2px solid #E2E8F0', marginBottom: '24px' },
  tab: { padding: '10px 24px', fontSize: '14px', fontWeight: 600, border: 'none', background: 'none', cursor: 'pointer', color: '#64748B', borderBottom: '2px solid transparent', marginBottom: '-2px', transition: 'all 0.15s' },
  tabActive: { color: '#0A2342', borderBottom: '2px solid #00D4FF' },
  saleLayout: { display: 'grid', gridTemplateColumns: '1fr 380px', gap: '24px' },
  searchWrap: { position: 'relative' as const, marginBottom: '16px' },
  searchIcon: { position: 'absolute' as const, left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#64748B', pointerEvents: 'none' as const },
  searchInput: { width: '100%', padding: '10px 12px 10px 36px', fontSize: '14px', border: '1px solid #CCC', borderRadius: '4px', color: '#0A2342', boxSizing: 'border-box' as const },
  prodGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '12px' },
  prodCard: { background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '16px', cursor: 'pointer', textAlign: 'center' as const, transition: 'box-shadow 0.15s' },
  prodName: { fontSize: '14px', fontWeight: 600, color: '#0A2342', marginBottom: '4px' },
  prodPrice: { fontSize: '16px', fontWeight: 700, color: '#0A2342', fontFamily: '"JetBrains Mono", monospace' },
  prodCat: { fontSize: '11px', color: '#64748B', marginTop: '4px' },
  cart: { background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column' as const, maxHeight: 'calc(100vh - 280px)' },
  cartHeader: { padding: '16px 20px', borderBottom: '1px solid #E2E8F0', fontSize: '16px', fontWeight: 700, color: '#0A2342', display: 'flex', alignItems: 'center', gap: '8px' },
  cartItems: { flex: 1, overflow: 'auto', padding: '12px 20px' },
  cartItem: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #F1F5F9' },
  cartItemName: { fontSize: '14px', fontWeight: 600, color: '#0A2342', flex: 1 },
  qtyControls: { display: 'flex', alignItems: 'center', gap: '8px' },
  qtyBtn: { width: '28px', height: '28px', borderRadius: '4px', border: '1px solid #CCC', background: '#FFFFFF', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#0A2342' },
  cartFooter: { borderTop: '2px solid #0A2342', padding: '16px 20px' },
  cartRow: { display: 'flex', justifyContent: 'space-between', fontSize: '14px', color: '#2E4A6B', marginBottom: '6px' },
  cartTotal: { display: 'flex', justifyContent: 'space-between', fontSize: '20px', fontWeight: 700, color: '#0A2342', marginBottom: '16px', fontFamily: '"JetBrains Mono", monospace' },
  payBtns: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' },
  payBtn: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '12px', fontSize: '14px', fontWeight: 600, borderRadius: '6px', cursor: 'pointer', border: '1px solid #E2E8F0', background: '#FFFFFF', color: '#0A2342', transition: 'background 0.15s' },
  payBtnPrimary: { background: '#0A2342', color: '#FFFFFF', border: '1px solid #0A2342' },
  filterBar: { display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px', flexWrap: 'wrap' as const },
  tableWrap: { background: '#FFFFFF', borderRadius: '8px', border: '1px solid #E2E8F0', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', overflow: 'hidden' },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: '14px' },
  th: { textAlign: 'left' as const, padding: '12px 16px', fontSize: '12px', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.05em', color: '#FFFFFF', backgroundColor: '#0A2342', borderBottom: '2px solid #00D4FF' },
  td: { padding: '12px 16px', color: '#0A2342', borderBottom: '1px solid #E2E8F0' },
  badge: { display: 'inline-block', padding: '2px 10px', fontSize: '12px', fontWeight: 600, borderRadius: '9999px' },
  mono: { fontFamily: '"JetBrains Mono", monospace', fontSize: '14px' },
  addBtn: { display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 20px', fontSize: '14px', fontWeight: 600, color: '#FFFFFF', backgroundColor: '#0A2342', border: 'none', borderRadius: '6px', cursor: 'pointer', whiteSpace: 'nowrap' as const },
  select: { padding: '8px 12px', fontSize: '14px', border: '1px solid #CCC', borderRadius: '4px', color: '#0A2342', background: '#FFFFFF', cursor: 'pointer' },
  overlay: { position: 'fixed' as const, inset: 0, backgroundColor: 'rgba(10, 35, 66, 0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: '#FFFFFF', borderRadius: '8px', width: '480px', maxHeight: '90vh', overflow: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.12)' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '24px 32px 16px', borderBottom: '1px solid #E2E8F0' },
  modalTitle: { fontSize: '22px', fontWeight: 700, color: '#0A2342', margin: 0 },
  closeBtn: { background: 'none', border: 'none', cursor: 'pointer', color: '#2E4A6B', padding: '4px' },
  modalBody: { padding: '24px 32px' },
  field: { display: 'flex', flexDirection: 'column' as const, gap: '4px', marginBottom: '16px' },
  label: { fontSize: '13px', fontWeight: 600, color: '#0A2342' },
  input: { padding: '8px 12px', fontSize: '14px', border: '1px solid #CCC', borderRadius: '4px', color: '#0A2342', outline: 'none', boxSizing: 'border-box' as const, width: '100%' },
  modalFooter: { display: 'flex', justifyContent: 'flex-end', gap: '12px', padding: '16px 32px 24px', borderTop: '1px solid #E2E8F0' },
  cancelBtn: { padding: '8px 24px', fontSize: '14px', fontWeight: 600, color: '#2E4A6B', background: '#FFFFFF', border: '1px solid #CCC', borderRadius: '6px', cursor: 'pointer' },
  saveBtn: { padding: '8px 24px', fontSize: '14px', fontWeight: 600, color: '#FFFFFF', backgroundColor: '#0A2342', border: 'none', borderRadius: '6px', cursor: 'pointer' },
  emptyCart: { padding: '40px 20px', textAlign: 'center' as const, color: '#64748B' },
};

const stockStatus = (product: Product): { label: string; bg: string; color: string } => {
  if (product.inStock === 0) return { label: 'Out of Stock', bg: '#FDE8E8', color: '#9B1C1C' };
  if (product.inStock <= product.reorderPoint) return { label: 'Low Stock', bg: '#FFF3CD', color: '#856404' };
  return { label: 'In Stock', bg: '#DEF7EC', color: '#03543F' };
};

/* ── Shift Modal ───────────────────────────────────────── */

function OpenShiftModal({ onClose, onOpen }: { onClose: () => void; onOpen: (name: string, float: number) => void }) {
  const [name, setName] = useState('');
  const [float, setFloat] = useState('100.00');
  return (
    <div style={st.overlay} onClick={onClose}>
      <div style={st.modal} onClick={(e) => e.stopPropagation()}>
        <div style={st.modalHeader}>
          <h2 style={st.modalTitle}>Open Shift</h2>
          <button style={st.closeBtn} onClick={onClose}><X size={20} /></button>
        </div>
        <div style={st.modalBody}>
          <div style={st.field}>
            <label style={st.label}>Cashier Name *</label>
            <input style={st.input} placeholder="e.g. Jake M." value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div style={st.field}>
            <label style={st.label}>Opening Float ($)</label>
            <input style={st.input} type="number" value={float} onChange={(e) => setFloat(e.target.value)} />
          </div>
        </div>
        <div style={st.modalFooter}>
          <button style={st.cancelBtn} onClick={onClose}>Cancel</button>
          <button style={st.saveBtn} onClick={() => { onOpen(name || 'Jake M.', parseFloat(float) || 100); onClose(); }}>Open Shift</button>
        </div>
      </div>
    </div>
  );
}

/* ── Payment Modal ─────────────────────────────────────── */

function PaymentModal({ total, method, onClose }: { total: number; method: string; onClose: () => void }) {
  const [tendered, setTendered] = useState(method === 'Cash' ? '' : total.toFixed(2));
  const change = method === 'Cash' ? Math.max(0, (parseFloat(tendered) || 0) - total) : 0;
  return (
    <div style={st.overlay} onClick={onClose}>
      <div style={st.modal} onClick={(e) => e.stopPropagation()}>
        <div style={st.modalHeader}>
          <h2 style={st.modalTitle}>Payment — {method}</h2>
          <button style={st.closeBtn} onClick={onClose}><X size={20} /></button>
        </div>
        <div style={st.modalBody}>
          <div style={{ textAlign: 'center', marginBottom: '24px' }}>
            <div style={{ fontSize: '14px', color: '#64748B', marginBottom: '4px' }}>Total Due</div>
            <div style={{ fontSize: '36px', fontWeight: 700, color: '#0A2342', fontFamily: '"JetBrains Mono", monospace' }}>${total.toFixed(2)}</div>
          </div>
          {method === 'Cash' && (
            <>
              <div style={st.field}>
                <label style={st.label}>Amount Tendered</label>
                <input style={{ ...st.input, fontSize: '20px', textAlign: 'center', fontFamily: '"JetBrains Mono", monospace' }} type="number" value={tendered} onChange={(e) => setTendered(e.target.value)} />
              </div>
              <div style={{ textAlign: 'center', padding: '12px', background: '#DEF7EC', borderRadius: '8px', marginBottom: '16px' }}>
                <div style={{ fontSize: '13px', color: '#03543F' }}>Change Due</div>
                <div style={{ fontSize: '24px', fontWeight: 700, color: '#03543F', fontFamily: '"JetBrains Mono", monospace' }}>${change.toFixed(2)}</div>
              </div>
            </>
          )}
          {method === 'Card' && (
            <div style={{ textAlign: 'center', padding: '24px', background: '#F8FAFC', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
              <CreditCard size={32} style={{ color: '#2E4A6B', marginBottom: '8px' }} />
              <div style={{ color: '#64748B', fontSize: '14px' }}>Waiting for card tap or insert...</div>
            </div>
          )}
          {method === 'Charge to Slip' && (
            <div style={st.field}>
              <label style={st.label}>Slip Number</label>
              <input style={st.input} placeholder="e.g. A-01" />
            </div>
          )}
        </div>
        <div style={st.modalFooter}>
          <button style={st.cancelBtn} onClick={onClose}>Cancel</button>
          <button style={st.saveBtn} onClick={onClose}>Complete Payment</button>
        </div>
      </div>
    </div>
  );
}

/* ── Main Component ─────────────────────────────────────── */

export default function POS() {
  const [tab, setTab] = useState<'sale' | 'transactions' | 'products' | 'inventory'>('sale');
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [shiftOpen, setShiftOpen] = useState(true);
  const [shiftCashier] = useState('Jake M.');
  const [shiftFloat] = useState(100);
  const [showShiftModal, setShowShiftModal] = useState(false);
  const [paymentModal, setPaymentModal] = useState<{ method: string } | null>(null);
  const [editingQtyId, setEditingQtyId] = useState<string | null>(null);
  const [editingQtyValue, setEditingQtyValue] = useState('');
  const [fuelQtyInputs, setFuelQtyInputs] = useState<Record<string, string>>({});

  // API calls with fallback to mock data
  const { data: apiProducts, loading: loadingProducts } = useApi<Product[]>('get', '/api/pos/products', { immediate: true });
  const { data: apiTransactions, loading: loadingTxns } = useApi<Transaction[]>('get', '/api/pos/transactions', { immediate: true });
  const { data: apiShift } = useApi<{ cashier: string; float: number; openedAt: string } | null>('get', '/api/pos/shifts/current', { immediate: true });
  const createTransaction = useApi<Transaction>('post', '/api/pos/transactions');
  const openShift = useApi<{ cashier: string; float: number }>('post', '/api/pos/shifts');

  const posProducts = useMemo(() => apiProducts ?? PRODUCTS, [apiProducts]);
  const transactions = useMemo(() => apiTransactions ?? TRANSACTIONS, [apiTransactions]);

  const loading = loadingProducts || loadingTxns;

  const addToCart = (product: Product, qty?: number) => {
    const addQty = qty ?? 1;
    if (addQty <= 0) return;
    setCart((prev) => {
      const existing = prev.find((i) => i.product.id === product.id);
      if (existing) return prev.map((i) => i.product.id === product.id ? { ...i, quantity: i.quantity + addQty } : i);
      return [...prev, { product, quantity: addQty }];
    });
  };

  const updateQty = (productId: string, delta: number) => {
    setCart((prev) => prev.map((i) => i.product.id === productId ? { ...i, quantity: Math.max(0, Math.round((i.quantity + delta) * 1000) / 1000) } : i).filter((i) => i.quantity > 0));
  };

  const setQtyAbsolute = (productId: string, newQty: number) => {
    if (newQty <= 0) {
      setCart((prev) => prev.filter((i) => i.product.id !== productId));
    } else {
      setCart((prev) => prev.map((i) => i.product.id === productId ? { ...i, quantity: Math.round(newQty * 1000) / 1000 } : i));
    }
  };

  const formatQty = (qty: number): string => {
    if (Number.isInteger(qty)) return qty.toString();
    return qty.toFixed(3).replace(/0+$/, '');
  };

  const cartItemCount = cart.reduce((s, i) => s + i.quantity, 0);
  const cartItemCountDisplay = Number.isInteger(cartItemCount) ? cartItemCount.toString() : cartItemCount.toFixed(3).replace(/0+$/, '');

  const subtotal = cart.reduce((s, i) => s + i.product.price * i.quantity, 0);
  const tax = cart.reduce((s, i) => s + i.product.price * i.quantity * (i.product.taxRate / 100), 0);
  const total = subtotal + tax;
  const runningTotal = transactions.filter((t) => t.date.includes('2026-03-25')).reduce((s, t) => s + t.total, 0) + total;

  const tabItems: { key: typeof tab; label: string }[] = [
    { key: 'sale', label: 'New Sale' },
    { key: 'transactions', label: 'Transactions' },
    { key: 'products', label: 'Products' },
    { key: 'inventory', label: 'Inventory' },
  ];

  return (
    <div style={st.page}>
      <h1 style={st.title}>Point of Sale</h1>
      <hr style={st.divider} />

      {loading && <div style={{ textAlign: 'center', padding: '24px', color: '#64748B' }}>Loading POS data...</div>}

      {/* Shift Banner */}
      {shiftOpen ? (
        <div style={st.shiftBanner}>
          <div style={st.shiftInfo}>
            <div><div style={st.shiftLabel}>Cashier</div><div style={st.shiftValue}>{shiftCashier}</div></div>
            <div><div style={st.shiftLabel}>Opened At</div><div style={st.shiftValue}>8:00 AM</div></div>
            <div><div style={st.shiftLabel}>Opening Float</div><div style={st.shiftValue}>${shiftFloat.toFixed(2)}</div></div>
            <div><div style={st.shiftLabel}>Running Total</div><div style={{ ...st.shiftValue, color: '#00D4FF' }}>${runningTotal.toFixed(2)}</div></div>
          </div>
          <button style={{ ...st.addBtn, backgroundColor: '#DC2626' }} onClick={() => setShiftOpen(false)}>Close Shift</button>
        </div>
      ) : (
        <div style={{ ...st.shiftBanner, background: '#F8FAFC', border: '1px solid #E2E8F0', justifyContent: 'center' }}>
          <button style={st.addBtn} onClick={() => setShowShiftModal(true)}>
            <Clock size={16} /> Open Shift
          </button>
        </div>
      )}

      {/* Tabs */}
      <div style={st.tabs}>
        {tabItems.map((t) => (
          <button key={t.key} style={{ ...st.tab, ...(tab === t.key ? st.tabActive : {}) }} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* New Sale */}
      {tab === 'sale' && (
        <div style={st.saleLayout}>
          <div>
            <div style={st.searchWrap}>
              <Search size={16} style={st.searchIcon} />
              <input style={st.searchInput} placeholder="Search or scan product..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div style={st.prodGrid}>
              {posProducts.filter((p) => !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.category.toLowerCase().includes(search.toLowerCase())).map((p) => {
                const isFuel = p.category === 'Fuel';
                return (
                  <div key={p.id} style={st.prodCard}
                    onClick={() => { if (!isFuel) addToCart(p); }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 12px rgba(0,0,0,0.12)'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = 'none'; }}>
                    <Package size={24} style={{ color: '#2E4A6B', marginBottom: '8px' }} />
                    <div style={st.prodName}>{p.name}</div>
                    <div style={st.prodPrice}>${p.price.toFixed(2)}</div>
                    <div style={st.prodCat}>{p.category}</div>
                    {isFuel && (
                      <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '4px' }} onClick={(e) => e.stopPropagation()}>
                        <label style={{ fontSize: '12px', fontWeight: 600, color: '#64748B' }}>Qty:</label>
                        <input
                          style={{ width: '60px', padding: '4px 6px', fontSize: '13px', border: '1px solid #CCC', borderRadius: '4px', textAlign: 'center', fontFamily: '"JetBrains Mono", monospace' }}
                          type="number"
                          step="any"
                          placeholder="0.000"
                          value={fuelQtyInputs[p.id] || ''}
                          onChange={(e) => setFuelQtyInputs((prev) => ({ ...prev, [p.id]: e.target.value }))}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              const qty = parseFloat(fuelQtyInputs[p.id] || '0');
                              if (qty > 0) { addToCart(p, qty); setFuelQtyInputs((prev) => ({ ...prev, [p.id]: '' })); }
                            }
                          }}
                        />
                        <button
                          style={{ padding: '4px 8px', fontSize: '12px', fontWeight: 600, background: '#0A2342', color: '#FFF', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                          onClick={() => {
                            const qty = parseFloat(fuelQtyInputs[p.id] || '0');
                            if (qty > 0) { addToCart(p, qty); setFuelQtyInputs((prev) => ({ ...prev, [p.id]: '' })); }
                          }}
                        >
                          Add
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div style={st.cart}>
            <div style={st.cartHeader}><ShoppingCart size={18} /> Cart ({cartItemCountDisplay} items)</div>
            {cart.length === 0 ? (
              <div style={st.emptyCart}>
                <ShoppingCart size={32} style={{ color: '#CBD5E1', marginBottom: '8px' }} />
                <div>Cart is empty</div>
                <div style={{ fontSize: '13px', marginTop: '4px' }}>Click products to add them</div>
              </div>
            ) : (
              <div style={st.cartItems}>
                {cart.map((item) => (
                  <div key={item.product.id} style={st.cartItem}>
                    <div>
                      <div style={st.cartItemName}>{item.product.name}</div>
                      <div style={{ fontSize: '12px', color: '#64748B' }}>${item.product.price.toFixed(2)} ea</div>
                    </div>
                    <div style={st.qtyControls}>
                      <button style={st.qtyBtn} onClick={() => updateQty(item.product.id, -1)}><Minus size={14} /></button>
                      {editingQtyId === item.product.id ? (
                        <input
                          style={{ ...st.mono, width: '56px', textAlign: 'center', padding: '2px 4px', fontSize: '14px', border: '1px solid #00D4FF', borderRadius: '4px', outline: 'none' }}
                          type="number"
                          step="any"
                          autoFocus
                          value={editingQtyValue}
                          onChange={(e) => setEditingQtyValue(e.target.value)}
                          onBlur={() => {
                            const parsed = parseFloat(editingQtyValue);
                            if (!isNaN(parsed) && parsed > 0) setQtyAbsolute(item.product.id, parsed);
                            setEditingQtyId(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); }
                            if (e.key === 'Escape') { setEditingQtyId(null); }
                          }}
                        />
                      ) : (
                        <span
                          style={{ ...st.mono, minWidth: '28px', textAlign: 'center', cursor: 'pointer', padding: '2px 4px', borderRadius: '4px', background: '#F1F5F9' }}
                          title="Click to edit quantity"
                          onClick={() => { setEditingQtyId(item.product.id); setEditingQtyValue(item.quantity.toString()); }}
                        >
                          {formatQty(item.quantity)}
                        </span>
                      )}
                      <button style={st.qtyBtn} onClick={() => updateQty(item.product.id, 1)}><Plus size={14} /></button>
                      <span style={{ ...st.mono, minWidth: '60px', textAlign: 'right' }}>${(item.product.price * item.quantity).toFixed(2)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div style={st.cartFooter}>
              <div style={st.cartRow}><span>Subtotal</span><span>${subtotal.toFixed(2)}</span></div>
              <div style={st.cartRow}><span>Tax</span><span>${tax.toFixed(2)}</span></div>
              <div style={st.cartTotal}><span>Total</span><span>${total.toFixed(2)}</span></div>
              <div style={st.payBtns}>
                <button style={{ ...st.payBtn, ...st.payBtnPrimary }} onClick={() => total > 0 && setPaymentModal({ method: 'Card' })}><CreditCard size={16} /> Card</button>
                <button style={st.payBtn} onClick={() => total > 0 && setPaymentModal({ method: 'Cash' })}><Banknote size={16} /> Cash</button>
                <button style={st.payBtn} onClick={() => total > 0 && setPaymentModal({ method: 'ACH' })}><Building2 size={16} /> ACH</button>
                <button style={st.payBtn} onClick={() => total > 0 && setPaymentModal({ method: 'Charge to Slip' })}><DollarSign size={16} /> Charge to Slip</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Transactions */}
      {tab === 'transactions' && (
        <>
          <div style={st.filterBar}>
            <div style={{ ...st.searchWrap, flex: 1 }}>
              <Search size={16} style={st.searchIcon} />
              <input style={st.searchInput} placeholder="Search transactions..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <input style={st.input} type="date" defaultValue="2026-03-23" />
            <span style={{ color: '#64748B' }}>to</span>
            <input style={st.input} type="date" defaultValue="2026-03-25" />
          </div>
          <div style={st.tableWrap}>
            <table style={st.table}>
              <thead>
                <tr>
                  <th style={st.th}>Transaction #</th>
                  <th style={st.th}>Date / Time</th>
                  <th style={st.th}>Items</th>
                  <th style={st.th}>Subtotal</th>
                  <th style={st.th}>Tax</th>
                  <th style={st.th}>Total</th>
                  <th style={st.th}>Payment</th>
                  <th style={st.th}>Cashier</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((t, idx) => {
                  const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#D6E8F4';
                  return (
                    <tr key={t.id}>
                      <td style={{ ...st.td, backgroundColor: rowBg, fontWeight: 600 }}>{t.number}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg, fontSize: '13px' }}>{t.date}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg, textAlign: 'center' }}>{t.items}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono }}>${t.subtotal.toFixed(2)}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono }}>${t.tax.toFixed(2)}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono, fontWeight: 600 }}>${t.total.toFixed(2)}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>
                        <span style={{ ...st.badge, backgroundColor: '#E0F7FF', color: '#0A2342' }}>{t.method}</span>
                      </td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>{t.cashier}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Products */}
      {tab === 'products' && (
        <>
          <div style={st.filterBar}>
            <div style={{ ...st.searchWrap, flex: 1 }}>
              <Search size={16} style={st.searchIcon} />
              <input style={st.searchInput} placeholder="Search products..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <select style={st.select}>
              <option value="">All Categories</option>
              <option>Fuel</option>
              <option>Provisions</option>
              <option>Bait & Tackle</option>
              <option>Marine Supplies</option>
              <option>Apparel</option>
            </select>
            <button style={st.addBtn}><Plus size={16} /> Add Product</button>
          </div>
          <div style={st.tableWrap}>
            <table style={st.table}>
              <thead>
                <tr>
                  <th style={st.th}>SKU</th>
                  <th style={st.th}>Name</th>
                  <th style={st.th}>Category</th>
                  <th style={st.th}>Price</th>
                  <th style={st.th}>Tax Rate</th>
                  <th style={st.th}>In Stock</th>
                  <th style={st.th}>Reorder Pt</th>
                  <th style={st.th}>Status</th>
                  <th style={st.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {posProducts.filter((p) => !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.sku.toLowerCase().includes(search.toLowerCase())).map((p, idx) => {
                  const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#D6E8F4';
                  const ss = stockStatus(p);
                  return (
                    <tr key={p.id}>
                      <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono }}>{p.sku}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg, fontWeight: 600 }}>{p.name}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>{p.category}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono }}>${p.price.toFixed(2)}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>{p.taxRate}%</td>
                      <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono }}>{p.inStock}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono }}>{p.reorderPoint}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>
                        <span style={{ ...st.badge, backgroundColor: ss.bg, color: ss.color }}>{ss.label}</span>
                      </td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>
                        <button style={{ background: 'none', border: 'none', color: '#00D4FF', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}>Edit</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Inventory */}
      {tab === 'inventory' && (
        <>
          <div style={st.filterBar}>
            <div style={{ flex: 1 }} />
            <button style={st.addBtn}><Package size={16} /> Create Purchase Order</button>
          </div>
          <div style={st.tableWrap}>
            <table style={st.table}>
              <thead>
                <tr>
                  <th style={st.th}>Product</th>
                  <th style={st.th}>SKU</th>
                  <th style={st.th}>Current Stock</th>
                  <th style={st.th}>Reorder Point</th>
                  <th style={st.th}>Last Restocked</th>
                  <th style={st.th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {[...posProducts].sort((a, b) => {
                  const aRatio = a.inStock / a.reorderPoint;
                  const bRatio = b.inStock / b.reorderPoint;
                  return aRatio - bRatio;
                }).map((p, idx) => {
                  const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#D6E8F4';
                  const ss = stockStatus(p);
                  const restockDates = ['2026-03-20', '2026-03-18', '2026-03-15', '2026-03-22', '2026-03-19', '2026-03-21', '2026-03-17', '2026-03-14', '2026-03-16', '2026-03-13', '2026-03-12', '2026-03-11'];
                  return (
                    <tr key={p.id} style={{ backgroundColor: ss.label === 'Low Stock' ? '#FFFBEB' : ss.label === 'Out of Stock' ? '#FEF2F2' : 'transparent' }}>
                      <td style={{ ...st.td, backgroundColor: rowBg, fontWeight: 600 }}>{p.name}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono }}>{p.sku}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono }}>{p.inStock}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono }}>{p.reorderPoint}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>{restockDates[idx] || '2026-03-10'}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>
                        <span style={{ ...st.badge, backgroundColor: ss.bg, color: ss.color }}>
                          {ss.label === 'Low Stock' && <AlertTriangle size={12} style={{ marginRight: '4px', verticalAlign: 'middle' }} />}
                          {ss.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {showShiftModal && <OpenShiftModal onClose={() => setShowShiftModal(false)} onOpen={() => { setShiftOpen(true); }} />}
      {paymentModal && <PaymentModal total={total} method={paymentModal.method} onClose={() => { setPaymentModal(null); setCart([]); }} />}
    </div>
  );
}
