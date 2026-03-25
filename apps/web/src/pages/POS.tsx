import { useState } from 'react';
import {
  ShoppingCart,
  Search,
  Plus,
  Minus,
  DollarSign,
  CreditCard,
  Banknote,
  Package,
  Clock,
  X,
  Trash2,
  BarChart3,
} from 'lucide-react';

/* ── Types ─────────────────────────────────────────────── */

type Tab = 'terminal' | 'products' | 'transactions' | 'inventory';

interface Product {
  id: string;
  name: string;
  sku: string;
  priceCents: number;
  category: string;
  inStock: number;
}

interface CartItem {
  product: Product;
  quantity: number;
}

interface Transaction {
  id: string;
  date: string;
  items: number;
  totalCents: number;
  method: string;
  cashier: string;
}

/* ── Mock Data ─────────────────────────────────────────── */

const MOCK_PRODUCTS: Product[] = [
  { id: '1', name: 'Dock Line (20ft)', sku: 'DL-20', priceCents: 2499, category: 'Marine Supplies', inStock: 24 },
  { id: '2', name: 'Fender (Medium)', sku: 'FN-MD', priceCents: 1899, category: 'Marine Supplies', inStock: 18 },
  { id: '3', name: 'Sunscreen SPF 50', sku: 'SN-50', priceCents: 1299, category: 'Sun Care', inStock: 36 },
  { id: '4', name: 'Bait (Shrimp, 1lb)', sku: 'BT-SH', priceCents: 899, category: 'Bait & Tackle', inStock: 15 },
  { id: '5', name: 'Ice Bag (10lb)', sku: 'IC-10', priceCents: 499, category: 'Provisions', inStock: 50 },
  { id: '6', name: 'Marina T-Shirt', sku: 'TS-MR', priceCents: 2499, category: 'Apparel', inStock: 42 },
  { id: '7', name: 'Fishing Lure Set', sku: 'FL-ST', priceCents: 1599, category: 'Bait & Tackle', inStock: 22 },
  { id: '8', name: 'Bottled Water (Case)', sku: 'BW-CS', priceCents: 1199, category: 'Provisions', inStock: 28 },
  { id: '9', name: 'Boat Wash (32oz)', sku: 'BW-32', priceCents: 1499, category: 'Marine Supplies', inStock: 14 },
  { id: '10', name: 'Life Jacket (Adult)', sku: 'LJ-AD', priceCents: 3999, category: 'Safety', inStock: 8 },
];

const MOCK_TRANSACTIONS: Transaction[] = [
  { id: 'T001', date: '2026-03-25 14:32', items: 3, totalCents: 5697, method: 'Card', cashier: 'Sarah C.' },
  { id: 'T002', date: '2026-03-25 13:15', items: 1, totalCents: 2499, method: 'Cash', cashier: 'Sarah C.' },
  { id: 'T003', date: '2026-03-25 11:47', items: 5, totalCents: 8895, method: 'Card', cashier: 'Mike T.' },
  { id: 'T004', date: '2026-03-25 10:22', items: 2, totalCents: 3998, method: 'Card', cashier: 'Mike T.' },
  { id: 'T005', date: '2026-03-24 16:50', items: 4, totalCents: 6496, method: 'Cash', cashier: 'Sarah C.' },
];

/* ── Styles ────────────────────────────────────────────── */

const s: Record<string, React.CSSProperties> = {
  page: { padding: '32px' },
  title: { fontSize: '36px', fontWeight: 700, color: '#0A2342', letterSpacing: '-0.02em', margin: 0 },
  divider: { height: '4px', background: 'linear-gradient(90deg, #00D4FF, transparent)', border: 'none', marginTop: '12px', marginBottom: '32px', borderRadius: '2px' },
  tabs: { display: 'flex', gap: '4px', marginBottom: '24px', borderBottom: '2px solid #E2E8F0' },
  tab: { padding: '10px 20px', fontSize: '14px', fontWeight: 600, color: '#64748B', background: 'none', border: 'none', cursor: 'pointer', borderBottom: '2px solid transparent', marginBottom: '-2px' },
  tabActive: { color: '#0A2342', borderBottom: '2px solid #0A2342' },
  terminal: { display: 'grid', gridTemplateColumns: '1fr 380px', gap: '24px' },
  productGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '12px' },
  productTile: { background: '#FFF', borderRadius: '8px', border: '1px solid #E2E8F0', padding: '16px', cursor: 'pointer', textAlign: 'center' as const, transition: 'box-shadow 0.15s' },
  tileName: { fontSize: '14px', fontWeight: 600, color: '#0A2342', margin: '0 0 4px 0' },
  tilePrice: { fontSize: '16px', fontWeight: 700, color: '#0A2342' },
  tileSku: { fontSize: '11px', color: '#64748B' },
  cart: { background: '#FFF', borderRadius: '10px', border: '1px solid #E2E8F0', padding: '20px', display: 'flex', flexDirection: 'column' as const, height: 'fit-content', position: 'sticky' as const, top: '32px' },
  cartTitle: { fontSize: '18px', fontWeight: 700, color: '#0A2342', margin: '0 0 16px 0' },
  cartItem: { display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 0', borderBottom: '1px solid #E2E8F0' },
  cartItemName: { flex: 1, fontSize: '14px', fontWeight: 600, color: '#0A2342' },
  qtyBtn: { width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #CCC', borderRadius: '4px', background: '#FFF', cursor: 'pointer', fontSize: '14px' },
  cartTotal: { display: 'flex', justifyContent: 'space-between', padding: '16px 0', fontSize: '18px', fontWeight: 700, color: '#0A2342', borderTop: '2px solid #0A2342', marginTop: '8px' },
  payBtn: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '12px', fontSize: '15px', fontWeight: 600, color: '#FFF', borderRadius: '8px', border: 'none', cursor: 'pointer', marginTop: '8px' },
  metricGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '24px' },
  metricCard: { background: '#FFF', borderRadius: '10px', border: '1px solid #E2E8F0', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' },
  metricLabel: { fontSize: '13px', color: '#64748B', margin: '0 0 4px 0' },
  metricValue: { fontSize: '28px', fontWeight: 700, color: '#0A2342', margin: 0 },
  table: { width: '100%', borderCollapse: 'collapse' as const, borderRadius: '8px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' },
  th: { backgroundColor: '#0A2342', color: '#FFF', padding: '12px 16px', fontSize: '13px', fontWeight: 600, textAlign: 'left' as const },
  td: { padding: '12px 16px', fontSize: '14px', color: '#0A2342', borderBottom: '1px solid #E2E8F0' },
  searchWrap: { position: 'relative' as const, display: 'flex', alignItems: 'center', marginBottom: '16px' },
  searchIcon: { position: 'absolute' as const, left: '10px', color: '#2E4A6B', pointerEvents: 'none' as const },
  searchInput: { padding: '8px 12px 8px 34px', fontSize: '14px', color: '#0A2342', border: '1px solid #CCC', borderRadius: '6px', backgroundColor: '#FFF', width: '100%', outline: 'none' },
  badge: { display: 'inline-block', padding: '2px 10px', borderRadius: '9999px', fontSize: '11px', fontWeight: 600 },
};

const fmt = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/* ── Component ─────────────────────────────────────────── */

export default function POS() {
  const [tab, setTab] = useState<Tab>('terminal');
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [shiftOpen, setShiftOpen] = useState(true);

  const addToCart = (product: Product) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.product.id === product.id);
      if (existing) return prev.map((c) => c.product.id === product.id ? { ...c, quantity: c.quantity + 1 } : c);
      return [...prev, { product, quantity: 1 }];
    });
  };

  const updateQty = (productId: string, delta: number) => {
    setCart((prev) => prev.map((c) => c.product.id === productId ? { ...c, quantity: Math.max(0, c.quantity + delta) } : c).filter((c) => c.quantity > 0));
  };

  const cartTotal = cart.reduce((s, c) => s + c.product.priceCents * c.quantity, 0);
  const taxCents = Math.round(cartTotal * 0.07);
  const grandTotal = cartTotal + taxCents;

  const filteredProducts = MOCK_PRODUCTS.filter((p) =>
    !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.sku.toLowerCase().includes(search.toLowerCase()),
  );

  const todaySales = MOCK_TRANSACTIONS.filter((t) => t.date.startsWith('2026-03-25')).reduce((s, t) => s + t.totalCents, 0);
  const todayCount = MOCK_TRANSACTIONS.filter((t) => t.date.startsWith('2026-03-25')).length;

  return (
    <div style={s.page}>
      <h1 style={s.title}>Point of Sale</h1>
      <hr style={s.divider} />

      {/* Shift Status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: shiftOpen ? '#E8F5E9' : '#FDECEA', padding: '8px 16px', borderRadius: '8px' }}>
          <Clock size={16} color={shiftOpen ? '#1B5E20' : '#B71C1C'} />
          <span style={{ fontSize: '14px', fontWeight: 600, color: shiftOpen ? '#1B5E20' : '#B71C1C' }}>
            {shiftOpen ? 'Shift Open — Sarah C.' : 'No Active Shift'}
          </span>
        </div>
        <button
          onClick={() => setShiftOpen(!shiftOpen)}
          style={{ padding: '8px 16px', fontSize: '13px', fontWeight: 600, color: '#0A2342', background: '#FFF', border: '1px solid #0A2342', borderRadius: '6px', cursor: 'pointer' }}
        >
          {shiftOpen ? 'Close Shift' : 'Open Shift'}
        </button>
      </div>

      {/* Tabs */}
      <div style={s.tabs}>
        {(['terminal', 'transactions', 'products', 'inventory'] as Tab[]).map((t) => (
          <button key={t} style={{ ...s.tab, ...(tab === t ? s.tabActive : {}) }} onClick={() => setTab(t)}>
            {t === 'terminal' ? 'Register' : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* Terminal */}
      {tab === 'terminal' && (
        <div style={s.terminal}>
          <div>
            <div style={s.searchWrap}>
              <Search size={16} style={s.searchIcon} />
              <input style={s.searchInput} placeholder="Search products by name or SKU..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div style={s.productGrid}>
              {filteredProducts.map((p) => (
                <div key={p.id} style={s.productTile} onClick={() => addToCart(p)}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = 'none'; }}>
                  <p style={s.tileName}>{p.name}</p>
                  <p style={s.tilePrice}>{fmt(p.priceCents)}</p>
                  <p style={s.tileSku}>{p.sku} · {p.inStock} in stock</p>
                </div>
              ))}
            </div>
          </div>

          <div style={s.cart}>
            <h3 style={s.cartTitle}><ShoppingCart size={18} /> Current Sale</h3>
            {cart.length === 0 && <p style={{ color: '#64748B', fontSize: '14px', textAlign: 'center', padding: '24px 0' }}>Tap a product to add it</p>}
            {cart.map((c) => (
              <div key={c.product.id} style={s.cartItem}>
                <div style={s.cartItemName}>
                  {c.product.name}
                  <div style={{ fontSize: '12px', color: '#64748B' }}>{fmt(c.product.priceCents)} each</div>
                </div>
                <button style={s.qtyBtn} onClick={() => updateQty(c.product.id, -1)}><Minus size={14} /></button>
                <span style={{ fontSize: '14px', fontWeight: 600, minWidth: '20px', textAlign: 'center' }}>{c.quantity}</span>
                <button style={s.qtyBtn} onClick={() => updateQty(c.product.id, 1)}><Plus size={14} /></button>
                <span style={{ fontSize: '14px', fontWeight: 600, minWidth: '60px', textAlign: 'right' }}>{fmt(c.product.priceCents * c.quantity)}</span>
              </div>
            ))}
            {cart.length > 0 && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', fontSize: '14px', color: '#64748B' }}>
                  <span>Subtotal</span><span>{fmt(cartTotal)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: '14px', color: '#64748B' }}>
                  <span>Tax (7%)</span><span>{fmt(taxCents)}</span>
                </div>
                <div style={s.cartTotal}>
                  <span>Total</span><span>{fmt(grandTotal)}</span>
                </div>
                <button style={{ ...s.payBtn, backgroundColor: '#0A2342' }} onClick={() => { setCart([]); }}>
                  <CreditCard size={18} /> Pay with Card
                </button>
                <button style={{ ...s.payBtn, backgroundColor: '#1B5E20' }} onClick={() => { setCart([]); }}>
                  <Banknote size={18} /> Pay with Cash
                </button>
                <button style={{ ...s.payBtn, backgroundColor: '#B71C1C' }} onClick={() => setCart([])}>
                  <Trash2 size={18} /> Clear Cart
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Transactions */}
      {tab === 'transactions' && (
        <>
          <div style={s.metricGrid}>
            <div style={s.metricCard}><p style={s.metricLabel}>Today's Sales</p><p style={s.metricValue}>{fmt(todaySales)}</p></div>
            <div style={s.metricCard}><p style={s.metricLabel}>Transactions</p><p style={s.metricValue}>{todayCount}</p></div>
            <div style={s.metricCard}><p style={s.metricLabel}>Avg Transaction</p><p style={s.metricValue}>{todayCount > 0 ? fmt(Math.round(todaySales / todayCount)) : '$0.00'}</p></div>
            <div style={s.metricCard}><p style={s.metricLabel}>Items Sold</p><p style={s.metricValue}>{MOCK_TRANSACTIONS.filter((t) => t.date.startsWith('2026-03-25')).reduce((s, t) => s + t.items, 0)}</p></div>
          </div>
          <table style={s.table}>
            <thead><tr><th style={s.th}>ID</th><th style={s.th}>Date</th><th style={s.th}>Items</th><th style={s.th}>Total</th><th style={s.th}>Method</th><th style={s.th}>Cashier</th></tr></thead>
            <tbody>
              {MOCK_TRANSACTIONS.map((t, idx) => (
                <tr key={t.id} style={{ backgroundColor: idx % 2 === 0 ? '#FFF' : '#D6E8F4' }}>
                  <td style={s.td}>{t.id}</td><td style={s.td}>{t.date}</td><td style={s.td}>{t.items}</td><td style={s.td}>{fmt(t.totalCents)}</td>
                  <td style={s.td}><span style={{ ...s.badge, backgroundColor: t.method === 'Card' ? '#D6E8F4' : '#E8F5E9', color: t.method === 'Card' ? '#0A2342' : '#1B5E20' }}>{t.method}</span></td>
                  <td style={s.td}>{t.cashier}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* Products */}
      {tab === 'products' && (
        <table style={s.table}>
          <thead><tr><th style={s.th}>Name</th><th style={s.th}>SKU</th><th style={s.th}>Category</th><th style={s.th}>Price</th><th style={s.th}>In Stock</th></tr></thead>
          <tbody>
            {MOCK_PRODUCTS.map((p, idx) => (
              <tr key={p.id} style={{ backgroundColor: idx % 2 === 0 ? '#FFF' : '#D6E8F4' }}>
                <td style={s.td}>{p.name}</td><td style={s.td}>{p.sku}</td><td style={s.td}>{p.category}</td><td style={s.td}>{fmt(p.priceCents)}</td>
                <td style={s.td}><span style={{ fontWeight: 600, color: p.inStock < 10 ? '#DC2626' : '#1B5E20' }}>{p.inStock}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Inventory */}
      {tab === 'inventory' && (
        <>
          <div style={s.metricGrid}>
            <div style={s.metricCard}><p style={s.metricLabel}>Total Products</p><p style={s.metricValue}>{MOCK_PRODUCTS.length}</p></div>
            <div style={s.metricCard}><p style={s.metricLabel}>Total Units</p><p style={s.metricValue}>{MOCK_PRODUCTS.reduce((s, p) => s + p.inStock, 0)}</p></div>
            <div style={s.metricCard}><p style={s.metricLabel}>Low Stock Items</p><p style={{ ...s.metricValue, color: '#DC2626' }}>{MOCK_PRODUCTS.filter((p) => p.inStock < 10).length}</p></div>
            <div style={s.metricCard}><p style={s.metricLabel}>Inventory Value</p><p style={s.metricValue}>{fmt(MOCK_PRODUCTS.reduce((s, p) => s + p.priceCents * p.inStock, 0))}</p></div>
          </div>
          <table style={s.table}>
            <thead><tr><th style={s.th}>Product</th><th style={s.th}>SKU</th><th style={s.th}>On Hand</th><th style={s.th}>Value</th><th style={s.th}>Status</th></tr></thead>
            <tbody>
              {MOCK_PRODUCTS.sort((a, b) => a.inStock - b.inStock).map((p, idx) => (
                <tr key={p.id} style={{ backgroundColor: idx % 2 === 0 ? '#FFF' : '#D6E8F4' }}>
                  <td style={s.td}>{p.name}</td><td style={s.td}>{p.sku}</td><td style={s.td}>{p.inStock}</td><td style={s.td}>{fmt(p.priceCents * p.inStock)}</td>
                  <td style={s.td}>
                    <span style={{ ...s.badge, backgroundColor: p.inStock < 10 ? '#FDECEA' : p.inStock < 20 ? '#FFF3CD' : '#E8F5E9', color: p.inStock < 10 ? '#B71C1C' : p.inStock < 20 ? '#856404' : '#1B5E20' }}>
                      {p.inStock < 10 ? 'Low Stock' : p.inStock < 20 ? 'Moderate' : 'In Stock'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
