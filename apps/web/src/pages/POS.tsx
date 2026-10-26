import React, { useState, useMemo, useEffect } from 'react';
import {
  ShoppingCart, Search, Plus, Minus, X, CreditCard,
  Banknote, Building2, DollarSign, Clock, Package,
  AlertTriangle, Trash2, RotateCcw,
} from 'lucide-react';
import { useApiClient, useList } from '../hooks/useApi';
import { errorMessage } from '../lib/api';
import { formatDateTime, humanizeEnum, todayKey, dateKey } from '../lib/format';
import type { CustomerRef } from '../lib/dto';
import CustomerPicker from '../components/CustomerPicker';
import { ErrorState, InlineError, LoadingState } from '../components/StateViews';

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
  cartItems?: CartItem[];
}

/* ── API mapping ───────────────────────────────────────── */

interface ProductDTO {
  id: string;
  name: string;
  sku?: string | null;
  departmentId?: string | null;
  priceCents: number;
  trackInventory: boolean;
  reorderQty?: number | null;
  inventory?: { qtyOnHand: number }[];
}

interface ShiftDTO {
  id: string;
  cashierId: string;
  openedAt: string;
  openingFloatCents: number;
  status: 'OPEN' | 'CLOSED' | 'RECONCILED';
}

interface TransactionDTO {
  id: string;
  cashierId?: string | null;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  status: string; // the API stores the payment method here (CASH/CARD/...)
  createdAt: string;
  lineItems?: { productId?: string | null; quantity: number; unitPriceCents: number; product?: ProductDTO | null }[];
}

function toProduct(p: ProductDTO): Product {
  return {
    id: p.id,
    sku: p.sku ?? '',
    name: p.name,
    category: p.departmentId ?? 'General',
    price: p.priceCents / 100,
    // Tax is calculated by the server per tax class when the sale is saved.
    taxRate: 0,
    inStock: p.trackInventory ? (p.inventory ?? []).reduce((sum, i) => sum + i.qtyOnHand, 0) : Number.POSITIVE_INFINITY,
    reorderPoint: p.reorderQty ?? 0,
  };
}

function toTransaction(t: TransactionDTO): Transaction {
  return {
    id: t.id,
    number: t.id.slice(0, 8).toUpperCase(),
    date: t.createdAt,
    items: (t.lineItems ?? []).reduce((sum, li) => sum + li.quantity, 0),
    subtotal: t.subtotalCents / 100,
    tax: t.taxCents / 100,
    total: t.totalCents / 100,
    method: humanizeEnum(t.status),
    cashier: '—',
    cartItems: (t.lineItems ?? [])
      .filter((li) => li.product)
      .map((li) => ({ product: toProduct(li.product as ProductDTO), quantity: li.quantity })),
  };
}

const METHOD_ENUM: Record<string, 'CASH' | 'CARD' | 'ACH' | 'CHARGE_TO_ACCOUNT'> = {
  Cash: 'CASH', Card: 'CARD', ACH: 'ACH', 'Charge to Slip': 'CHARGE_TO_ACCOUNT',
};


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

function OpenShiftModal({ onClose, onOpened }: { onClose: () => void; onOpened: () => void }) {
  const client = useApiClient();
  const [float, setFloat] = useState('100.00');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = async () => {
    const cents = Math.round(Number(float) * 100);
    if (!(cents >= 0)) { setError('Enter the opening float.'); return; }
    setSaving(true);
    setError(null);
    try {
      await client.post('/pos/shifts/open', { openingFloatCents: cents });
      onOpened();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div style={st.overlay} onClick={() => { if (!saving) onClose(); }}>
      <div style={st.modal} className="helm-modal" onClick={(e) => e.stopPropagation()}>
        <div style={st.modalHeader}>
          <h2 style={st.modalTitle}>Open Shift</h2>
          <button style={st.closeBtn} onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        <div style={st.modalBody}>
          {error && <div style={{ marginBottom: 12 }}><InlineError message={error} /></div>}
          <p style={{ fontSize: 13, color: '#64748B', marginBottom: 12 }}>The shift is opened for the signed-in user.</p>
          <div style={st.field}>
            <label style={st.label}>Opening Float ($)</label>
            <input style={st.input} type="number" step="0.01" value={float} onChange={(e) => setFloat(e.target.value)} />
          </div>
        </div>
        <div style={st.modalFooter}>
          <button style={st.cancelBtn} onClick={onClose} disabled={saving}>Cancel</button>
          <button style={{ ...st.saveBtn, opacity: saving ? 0.7 : 1 }} disabled={saving} onClick={open}>{saving ? 'Opening…' : 'Open Shift'}</button>
        </div>
      </div>
    </div>
  );
}

/* ── Payment Modal ─────────────────────────────────────── */

function PaymentModal({
  total, method, onClose, onComplete,
}: {
  total: number;
  method: string;
  onClose: () => void;
  /** Must resolve only when the server saved the sale; throws otherwise. */
  onComplete: (method: string, customer: CustomerRef | null) => Promise<{ total: number }>;
}) {
  const [tendered, setTendered] = useState(method === 'Cash' ? '' : total.toFixed(2));
  const [customer, setCustomer] = useState<CustomerRef | null>(null);
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedTotal, setSavedTotal] = useState(total);
  const change = method === 'Cash' ? Math.max(0, (parseFloat(tendered) || 0) - total) : 0;

  const blocked = (method === 'Cash' && !(parseFloat(tendered) >= total)) || (method === 'Charge to Slip' && !customer);
  const handleComplete = async () => {
    if (blocked || saving) return;
    setSaving(true);
    setError(null);
    try {
      const result = await onComplete(method, customer);
      setSavedTotal(result.total);
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={st.overlay} onClick={done || saving ? undefined : onClose}>
      <div style={st.modal} className="helm-modal" onClick={(e) => e.stopPropagation()}>
        <div style={st.modalHeader}>
          <h2 style={st.modalTitle}>Payment — {method}</h2>
          <button style={st.closeBtn} onClick={onClose}><X size={20} /></button>
        </div>
        <div style={st.modalBody}>
          {done ? (
            <div style={{ textAlign: 'center', padding: '32px 0' }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>✓</div>
              <div style={{ fontSize: '20px', fontWeight: 700, color: '#03543F' }}>Sale Recorded</div>
              <div style={{ fontSize: '14px', color: '#64748B', marginTop: '8px' }}>${savedTotal.toFixed(2)} recorded as {method} (total includes server-calculated tax)</div>
              {method === 'Cash' && change > 0 && (
                <div style={{ fontSize: '16px', fontWeight: 600, color: '#0A2342', marginTop: '12px' }}>Change: ${change.toFixed(2)}</div>
              )}
            </div>
          ) : (
            <>
              {error && <div style={{ marginBottom: 12 }}><InlineError message={error} /></div>}
              <div style={{ textAlign: 'center', marginBottom: '24px' }}>
                <div style={{ fontSize: '14px', color: '#64748B', marginBottom: '4px' }}>Subtotal (tax added by the server)</div>
                <div style={{ fontSize: '36px', fontWeight: 700, color: '#0A2342', fontFamily: '"JetBrains Mono", monospace' }}>${total.toFixed(2)}</div>
              </div>
              {method === 'Cash' && (
                <>
                  <div style={st.field}>
                    <label style={st.label}>Amount Tendered</label>
                    <input
                      style={{ ...st.input, fontSize: '20px', textAlign: 'center', fontFamily: '"JetBrains Mono", monospace' }}
                      type="number"
                      value={tendered}
                      onChange={(e) => setTendered(e.target.value)}
                      autoFocus
                    />
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
                  <div style={{ color: '#64748B', fontSize: '14px' }}>Take the card payment on your card terminal, then record it here. Helm does not process this card.</div>
                </div>
              )}
              {method === 'ACH' && (
                <div style={{ textAlign: 'center', padding: '24px', background: '#F8FAFC', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
                  <div style={{ color: '#64748B', fontSize: '14px' }}>Records an ACH sale. Helm does not initiate the bank transfer from this screen.</div>
                </div>
              )}
              {method === 'Charge to Slip' && (
                <div style={st.field}>
                  <label style={st.label}>Charge to Customer Account</label>
                  <CustomerPicker value={customer} onChange={setCustomer} inputStyle={st.input} />
                </div>
              )}
            </>
          )}
        </div>
        {done && (
          <div style={st.modalFooter}>
            <button style={st.saveBtn} onClick={onClose}>Done</button>
          </div>
        )}
        {!done && (
          <div style={st.modalFooter}>
            <button style={st.cancelBtn} onClick={onClose} disabled={saving}>Cancel</button>
            <button
              style={{ ...st.saveBtn, opacity: blocked || saving ? 0.5 : 1 }}
              onClick={handleComplete}
              disabled={blocked || saving}
            >
              {saving ? 'Saving sale…' : 'Complete Sale'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Recalled Transaction Banner ───────────────────────── */

function RecallBanner({ txnNumber, onClear }: { txnNumber: string; onClear: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 16px', background: '#E0F7FF', border: '1px solid #00D4FF', borderRadius: '6px', marginBottom: '12px', fontSize: '13px', color: '#0A2342' }}>
      <RotateCcw size={14} style={{ color: '#00D4FF' }} />
      <span>Recalled transaction <strong>{txnNumber}</strong> — edit items and re-tender to complete.</span>
      <button onClick={onClear} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#64748B' }}><X size={14} /></button>
    </div>
  );
}

/* ── Main Component ─────────────────────────────────────── */

export default function POS() {
  const [tab, setTab] = useState<'sale' | 'transactions'>('sale');
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [txnFrom, setTxnFrom] = useState(todayKey());
  const [txnTo, setTxnTo] = useState(todayKey());
  const [pageError, setPageError] = useState<string | null>(null);
  const client = useApiClient();
  const [showShiftModal, setShowShiftModal] = useState(false);
  const [paymentModal, setPaymentModal] = useState<{ method: string } | null>(null);
  const [editingQtyId, setEditingQtyId] = useState<string | null>(null);
  const [editingQtyValue, setEditingQtyValue] = useState('');
  const [recalledTxn, setRecalledTxn] = useState<string | null>(null);
  const [achEnabled, setAchEnabled] = useState(true);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('helm_payment_types') || '[]');
      const achType = stored.find((t: { id: string; availPOS?: boolean }) => t.id === 'ach');
      if (achType && achType.availPOS === false) setAchEnabled(false);
    } catch { /* ignore */ }
  }, []);

  const productsList = useList<Product, ProductDTO>('/pos/products?take=100', { map: toProduct });
  const txnList = useList<Transaction, TransactionDTO>(`/pos/transactions?take=100&dateFrom=${txnFrom}&dateTo=${txnTo}`, { map: toTransaction });
  const todayTxns = useList<Transaction, TransactionDTO>(`/pos/transactions?take=100&dateFrom=${todayKey()}&dateTo=${todayKey()}`, { map: toTransaction });
  const shifts = useList<ShiftDTO>('/pos/shifts');
  const posProducts = productsList.items;
  const transactions = txnList.items;
  // NOTE: /pos/shifts lists all shifts for the tenant; the API only allows one open shift per cashier.
  const openShift = shifts.items.find((sh) => sh.status === 'OPEN') ?? null;
  const shiftOpen = !!openShift;

  const handlePaymentComplete = async (method: string, customer: CustomerRef | null): Promise<{ total: number }> => {
    const fractional = cart.find((i) => !Number.isInteger(i.quantity));
    if (fractional) throw new Error(`"${fractional.product.name}" has a fractional quantity; the POS API accepts whole quantities only.`);
    const saved = await client.post<TransactionDTO>('/pos/transactions', {
      lineItems: cart.map((i) => ({ productId: i.product.id, quantity: i.quantity, unitPriceCents: Math.round(i.product.price * 100) })),
      shiftId: openShift?.id ?? null,
      paymentMethod: METHOD_ENUM[method] ?? 'CASH',
      customerId: customer?.id ?? null,
    });
    setCart([]);
    setRecalledTxn(null);
    txnList.refetch();
    todayTxns.refetch();
    return { total: saved.totalCents / 100 };
  };

  const closeShift = async () => {
    if (!openShift) return;
    const cash = window.prompt('Counted cash in drawer ($):');
    if (cash === null) return;
    const cents = Math.round(Number(cash) * 100);
    if (!(cents >= 0)) { setPageError('Enter the counted cash as a number.'); return; }
    setPageError(null);
    try {
      await client.post(`/pos/shifts/${openShift.id}/close`, { closingCashCents: cents });
      shifts.refetch();
    } catch (err) {
      setPageError(errorMessage(err));
    }
  };

  const recallTransaction = (txn: Transaction) => {
    if (txn.cartItems && txn.cartItems.length > 0) {
      setCart(txn.cartItems.map((ci) => ({ ...ci })));
    } else {
      const recalled: CartItem = {
        product: {
          id: `recalled-${txn.id}`,
          sku: txn.number,
          name: `Recalled: ${txn.number}`,
          category: 'Recalled',
          price: txn.total,
          taxRate: 0,
          inStock: 999,
          reorderPoint: 0,
        },
        quantity: 1,
      };
      setCart([recalled]);
    }
    setRecalledTxn(txn.number);
    setTab('sale');
  };


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
  const runningTotal = todayTxns.items.filter((t) => dateKey(t.date) === todayKey()).reduce((s, t) => s + t.total, 0);

  const tabItems: { key: typeof tab; label: string }[] = [
    { key: 'sale', label: 'New Sale' },
    { key: 'transactions', label: 'Transactions' },
  ];

  return (
    <div style={st.page}>
      <h1 style={st.title} className="helm-page-title">Point of Sale</h1>
      <hr style={st.divider} />

      {pageError && <div style={{ marginBottom: 16 }}><InlineError message={pageError} /></div>}
      {shifts.error && <div style={{ marginBottom: 16 }}><InlineError message={`Could not load shifts: ${shifts.error}`} /></div>}

      {/* Shift Banner */}
      {shiftOpen ? (
        <div style={st.shiftBanner}>
          <div style={st.shiftInfo}>
            <div><div style={st.shiftLabel}>Shift</div><div style={st.shiftValue}>Open</div></div>
            <div><div style={st.shiftLabel}>Opened At</div><div style={st.shiftValue}>{formatDateTime(openShift!.openedAt)}</div></div>
            <div><div style={st.shiftLabel}>Opening Float</div><div style={st.shiftValue}>${(openShift!.openingFloatCents / 100).toFixed(2)}</div></div>
            <div><div style={st.shiftLabel}>Sales Today</div><div style={{ ...st.shiftValue, color: '#00D4FF' }}>${runningTotal.toFixed(2)}</div></div>
          </div>
          <button style={{ ...st.addBtn, backgroundColor: '#DC2626' }} onClick={closeShift}>Close Shift</button>
        </div>
      ) : (
        <div style={{ ...st.shiftBanner, background: '#F8FAFC', border: '1px solid #E2E8F0', justifyContent: 'center' }}>
          <button style={st.addBtn} onClick={() => setShowShiftModal(true)}>
            <Clock size={16} /> Open Shift
          </button>
        </div>
      )}

      {/* Tabs */}
      <div style={st.tabs} className="helm-tabs">
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
            {recalledTxn && <RecallBanner txnNumber={recalledTxn} onClear={() => { setRecalledTxn(null); setCart([]); }} />}
            <div style={st.searchWrap}>
              <Search size={16} style={st.searchIcon} />
              <input style={st.searchInput} placeholder="Search or scan product..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            {productsList.loading && <LoadingState label="Loading products…" />}
            {productsList.error && <ErrorState title="Could not load products" message={productsList.error} onRetry={productsList.refetch} />}
            {!productsList.loading && !productsList.error && posProducts.length === 0 && (
              <div style={{ padding: 24, color: '#64748B', fontSize: 14 }}>No POS products set up yet.</div>
            )}
            <div style={st.prodGrid}>
              {posProducts.filter((p) => !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.category.toLowerCase().includes(search.toLowerCase())).map((p) => (
                  <div key={p.id} style={st.prodCard}
                    onClick={() => addToCart(p)}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 12px rgba(0,0,0,0.12)'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = 'none'; }}>
                    <Package size={24} style={{ color: '#2E4A6B', marginBottom: '8px' }} />
                    <div style={st.prodName}>{p.name}</div>
                    <div style={st.prodPrice}>${p.price.toFixed(2)}</div>
                    <div style={st.prodCat}>{p.category}</div>
                  </div>
              ))}
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
              <div style={st.cartRow}><span>Tax</span><span style={{ fontSize: 12, color: '#64748B' }}>calculated on sale</span></div>
              <div style={st.cartTotal}><span>Total (before tax)</span><span>${total.toFixed(2)}</span></div>
              <div style={st.payBtns}>
                <button style={{ ...st.payBtn, ...st.payBtnPrimary }} onClick={() => total > 0 && setPaymentModal({ method: 'Card' })}><CreditCard size={16} /> Card</button>
                <button style={st.payBtn} onClick={() => total > 0 && setPaymentModal({ method: 'Cash' })}><Banknote size={16} /> Cash</button>
                {achEnabled && (
                  <button style={st.payBtn} onClick={() => total > 0 && setPaymentModal({ method: 'ACH' })}><Building2 size={16} /> ACH</button>
                )}
                <button style={{ ...st.payBtn, gridColumn: achEnabled ? undefined : 'span 2' }} onClick={() => total > 0 && setPaymentModal({ method: 'Charge to Slip' })}><DollarSign size={16} /> Charge to Slip</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Transactions */}
      {tab === 'transactions' && (
        <>
          <div style={st.filterBar} className="helm-filter-bar">
            <div style={{ ...st.searchWrap, flex: 1 }}>
              <Search size={16} style={st.searchIcon} />
              <input style={st.searchInput} placeholder="Search transactions..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <input style={st.input} type="date" value={txnFrom} onChange={(e) => setTxnFrom(e.target.value)} aria-label="From date" />
            <span style={{ color: '#64748B' }}>to</span>
            <input style={st.input} type="date" value={txnTo} onChange={(e) => setTxnTo(e.target.value)} aria-label="To date" />
          </div>
          <p style={{ fontSize: '13px', color: '#64748B', marginBottom: '12px' }}>Click a transaction number to recall it to the sale screen.</p>
          {txnList.loading ? <LoadingState label="Loading transactions…" /> : txnList.error ? <ErrorState title="Could not load transactions" message={txnList.error} onRetry={txnList.refetch} /> : (
          <div style={st.tableWrap} className="helm-table-wrap">
            <table style={st.table}>
              <thead>
                <tr>
                  <th style={st.th}>Transaction</th>
                  <th style={st.th}>Date / Time</th>
                  <th style={st.th}>Items</th>
                  <th style={st.th}>Subtotal</th>
                  <th style={st.th}>Tax</th>
                  <th style={st.th}>Total</th>
                  <th style={st.th}>Payment</th>
                  <th style={st.th}>Cashier</th>
                  <th style={st.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((t, idx) => {
                  const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#D6E8F4';
                  return (
                    <tr key={t.id}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#EFF6FF'; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = rowBg; }}
                      style={{ background: rowBg, transition: 'background 0.1s' }}>
                      <td
                        style={{ ...st.td, fontWeight: 700, color: '#0066CC', cursor: 'pointer', textDecoration: 'underline' }}
                        onClick={() => recallTransaction(t)}
                        title="Click to recall this transaction"
                      >
                        {t.number}
                      </td>
                      <td style={{ ...st.td, fontSize: '13px' }}>{formatDateTime(t.date)}</td>
                      <td style={{ ...st.td, textAlign: 'center' }}>{t.items}</td>
                      <td style={{ ...st.td, ...st.mono }}>${t.subtotal.toFixed(2)}</td>
                      <td style={{ ...st.td, ...st.mono }}>${t.tax.toFixed(2)}</td>
                      <td style={{ ...st.td, ...st.mono, fontWeight: 600 }}>${t.total.toFixed(2)}</td>
                      <td style={st.td}>
                        <span style={{ ...st.badge, backgroundColor: '#E0F7FF', color: '#0A2342' }}>{t.method}</span>
                      </td>
                      <td style={st.td}>{t.cashier}</td>
                      <td style={st.td}>
                        <button
                          style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'none', border: '1px solid #00D4FF', color: '#0A2342', borderRadius: '4px', padding: '4px 10px', fontSize: '12px', cursor: 'pointer', fontWeight: 600 }}
                          onClick={() => recallTransaction(t)}
                        >
                          <RotateCcw size={12} /> Recall
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {transactions.length === 0 && (
                  <tr><td colSpan={9} style={{ ...st.td, textAlign: 'center', color: '#64748B', padding: 24 }}>No transactions in this date range.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          )}
        </>
      )}

      {showShiftModal && <OpenShiftModal onClose={() => setShowShiftModal(false)} onOpened={() => shifts.refetch()} />}
      {paymentModal && (
        <PaymentModal
          total={total}
          method={paymentModal.method}
          onClose={() => setPaymentModal(null)}
          onComplete={handlePaymentComplete}
        />
      )}
    </div>
  );
}
