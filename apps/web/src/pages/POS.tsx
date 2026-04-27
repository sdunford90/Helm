import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ShoppingCart, Search, Plus, Minus, X, CreditCard,
  Banknote, Building2, DollarSign, Clock, Package,
  AlertTriangle, Trash2, RotateCcw, Printer, Wifi, WifiOff,
  CheckCircle2, Loader,
} from 'lucide-react';
import { useAuth } from '@clerk/clerk-react';
import { useApi } from '../hooks/useApi';
import { api } from '../lib/api';
import { loadStripeTerminal } from '@stripe/terminal-js';
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { getStripe } from '../lib/stripe.js';

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

/* ── API Response Types ─────────────────────────────────── */

interface ApiProduct {
  id: string;
  sku: string | null;
  name: string;
  departmentId: string | null;
  priceCents: number;
  taxClass: string | null;
  reorderQty: number | null;
  inventory: { qtyOnHand: number }[];
}

interface ApiTransaction {
  id: string;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  createdAt: string;
  lineItems: { quantity: number; productId: string; unitPriceCents: number; product?: { name: string } }[];
}

interface ApiShift {
  id: string;
  status: 'OPEN' | 'CLOSED';
  cashierId: string;
  openedAt: string;
  closedAt: string | null;
  openingFloatCents: number;
  closingCashCents: number | null;
  salesTotal: number;
  expectedCashCents: number;
  varianceCents: number | null;
}

/* ── API mapping helpers ─────────────────────────────────── */

const TAX_CLASS_RATE: Record<string, number> = { standard: 7, reduced: 3, zero: 0, none: 0 };

function mapApiProduct(p: ApiProduct): Product {
  return {
    id: p.id,
    sku: p.sku ?? '',
    name: p.name,
    category: p.departmentId ?? 'General',
    price: p.priceCents / 100,
    taxRate: p.taxClass ? (TAX_CLASS_RATE[p.taxClass] ?? 0) : 0,
    inStock: p.inventory?.[0]?.qtyOnHand ?? 0,
    reorderPoint: p.reorderQty ?? 0,
  };
}

const PAYMENT_METHOD_API: Record<string, string> = {
  Card: 'CARD', Cash: 'CASH', ACH: 'ACH', 'Charge to Slip': 'CHARGE_TO_ACCOUNT',
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

function OpenShiftModal({ onClose, onOpen, loading }: { onClose: () => void; onOpen: (name: string, float: number) => void; loading?: boolean }) {
  const [name, setName] = useState('');
  const [float, setFloat] = useState('100.00');
  return (
    <div style={st.overlay} onClick={onClose}>
      <div style={st.modal} className="helm-modal" onClick={(e) => e.stopPropagation()}>
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
          <button style={{ ...st.saveBtn, opacity: loading ? 0.7 : 1 }} disabled={loading} onClick={() => { onOpen(name || 'Staff', parseFloat(float) || 100); }}>{loading ? 'Opening...' : 'Open Shift'}</button>
        </div>
      </div>
    </div>
  );
}

/* ── Close Shift Modal ─────────────────────────────────── */

function CloseShiftModal({ onClose, onConfirm, floatAmt, runningTotal, loading }: {
  onClose: () => void;
  onConfirm: (closingCash: number, notes: string) => void;
  floatAmt: number;
  runningTotal: number;
  loading?: boolean;
}) {
  const [closingCash, setClosingCash] = useState((floatAmt + runningTotal).toFixed(2));
  const [notes, setNotes] = useState('');
  const expected = floatAmt + runningTotal;
  const variance = (parseFloat(closingCash) || 0) - expected;
  return (
    <div style={st.overlay} onClick={onClose}>
      <div style={st.modal} className="helm-modal" onClick={(e) => e.stopPropagation()}>
        <div style={st.modalHeader}>
          <h2 style={st.modalTitle}>Close Shift</h2>
          <button style={st.closeBtn} onClick={onClose}><X size={20} /></button>
        </div>
        <div style={st.modalBody}>
          <div style={{ background: '#F8FAFC', borderRadius: '8px', border: '1px solid #E2E8F0', padding: '16px', marginBottom: '20px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div><div style={{ fontSize: '11px', color: '#64748B', marginBottom: '2px' }}>Opening Float</div><div style={{ fontSize: '16px', fontWeight: 700, color: '#0A2342', fontFamily: 'monospace' }}>${floatAmt.toFixed(2)}</div></div>
              <div><div style={{ fontSize: '11px', color: '#64748B', marginBottom: '2px' }}>Cash Sales</div><div style={{ fontSize: '16px', fontWeight: 700, color: '#0A2342', fontFamily: 'monospace' }}>${runningTotal.toFixed(2)}</div></div>
              <div><div style={{ fontSize: '11px', color: '#64748B', marginBottom: '2px' }}>Expected in Drawer</div><div style={{ fontSize: '16px', fontWeight: 700, color: '#0A2342', fontFamily: 'monospace' }}>${expected.toFixed(2)}</div></div>
              <div><div style={{ fontSize: '11px', color: '#64748B', marginBottom: '2px' }}>Variance</div><div style={{ fontSize: '16px', fontWeight: 700, color: variance >= 0 ? '#059669' : '#DC2626', fontFamily: 'monospace' }}>{variance >= 0 ? '+' : ''}${variance.toFixed(2)}</div></div>
            </div>
          </div>
          <div style={st.field}>
            <label style={st.label}>Actual Closing Cash Count ($) *</label>
            <input style={{ ...st.input, fontSize: '20px', textAlign: 'center', fontFamily: 'monospace' }} type="number" step="0.01" value={closingCash} onChange={(e) => setClosingCash(e.target.value)} autoFocus />
          </div>
          <div style={st.field}>
            <label style={st.label}>Notes (optional)</label>
            <input style={st.input} placeholder="e.g. $5 short, recount confirmed" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <div style={st.modalFooter}>
          <button style={st.cancelBtn} onClick={onClose}>Cancel</button>
          <button style={{ ...st.saveBtn, backgroundColor: '#DC2626', opacity: loading ? 0.7 : 1 }} disabled={loading} onClick={() => onConfirm(parseFloat(closingCash) || 0, notes)}>{loading ? 'Closing...' : 'Close Shift'}</button>
        </div>
      </div>
    </div>
  );
}

/* ── Card-Not-Present inner form (must be inside Elements) ── */

function CnpForm({
  total, amountCents, onBack, onComplete, apiCall,
}: {
  total: number; amountCents: number; onBack: () => void; onComplete: (method: string) => void;
  apiCall: (method: string, path: string, body?: unknown) => Promise<any>;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [cnpLoading, setCnpLoading] = useState(false);
  const [cnpError, setCnpError] = useState('');

  const handleCharge = async () => {
    if (!stripe || !elements) return;
    setCnpLoading(true);
    setCnpError('');
    try {
      const cardEl = elements.getElement(CardElement);
      if (!cardEl) throw new Error('Card element not found');
      const { paymentMethod, error: pmErr } = await stripe.createPaymentMethod({ type: 'card', card: cardEl });
      if (pmErr) throw new Error(pmErr.message ?? 'Card error');
      await apiCall('POST', '/api/pos/payments/cnp', { amountCents, paymentMethodId: paymentMethod!.id });
      onComplete('Card Not Present');
    } catch (err: any) {
      setCnpError((err as Error).message ?? 'Payment failed');
      setCnpLoading(false);
    }
  };

  return (
    <>
      <div style={{ textAlign: 'center', marginBottom: '20px' }}>
        <div style={{ fontSize: '12px', color: '#64748B', marginBottom: '2px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total Due</div>
        <div style={{ fontSize: '38px', fontWeight: 700, color: '#0A2342', fontFamily: '"JetBrains Mono", monospace' }}>${total.toFixed(2)}</div>
        <div style={{ fontSize: '11px', color: '#94A3B8', marginTop: '4px' }}>Card Not Present — keyed entry</div>
      </div>

      <div style={{ padding: '14px 16px', border: '1px solid #CBD5E1', borderRadius: '8px', background: '#FFFFFF', marginBottom: '16px' }}>
        <CardElement options={{
          hidePostalCode: true,
          disableLink: true,
          style: {
            base: { fontSize: '15px', color: '#0A2342', fontFamily: '"JetBrains Mono", monospace', '::placeholder': { color: '#94A3B8' } },
            invalid: { color: '#DC2626' },
          },
        } as any} />
      </div>

      {cnpError && (
        <div style={{ padding: '10px 14px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '6px', color: '#DC2626', fontSize: '13px', marginBottom: '14px' }}>
          {cnpError}
        </div>
      )}
      <button
        style={{ width: '100%', padding: '13px', background: cnpLoading ? '#94A3B8' : '#0A2342', color: '#FFFFFF', border: 'none', borderRadius: '8px', cursor: cnpLoading ? 'not-allowed' : 'pointer', fontSize: '15px', fontWeight: 700 }}
        onClick={() => void handleCharge()}
        disabled={cnpLoading || !stripe}
      >
        {cnpLoading ? 'Processing…' : `Charge $${total.toFixed(2)}`}
      </button>
      <button style={{ width: '100%', marginTop: '10px', padding: '10px', background: 'none', border: '1px solid #E2E8F0', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', color: '#64748B' }} onClick={onBack}>
        ← Back to readers
      </button>
    </>
  );
}

/* ── Card Payment Modal (Terminal + Card-Not-Present) ──── */

interface StripeReader { id: string; label: string; status: string; device_type: string }
type CardStatus = 'loading' | 'readers' | 'connecting' | 'collecting' | 'processing' | 'terminal_done' | 'terminal_error' | 'cnp' | 'cnp_done';

function CardPaymentModal({
  total, amountCents, cartItems, onClose, onComplete, getToken,
}: {
  total: number; amountCents: number; cartItems: CartItem[]; onClose: () => void; onComplete: (method: string) => void; getToken: () => Promise<string | null>;
}) {
  const [status, setStatus] = useState<CardStatus>('loading');
  const [readers, setReaders] = useState<StripeReader[]>([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [selectedReader, setSelectedReader] = useState<StripeReader | null>(null);
  const terminalRef = useRef<any>(null);
  // Stores the raw SDK reader objects (needed by connectReader — the reshaped StripeReader objects are only for display)
  const rawReadersRef = useRef<Map<string, any>>(new Map());

  const apiCall = useCallback(async (httpMethod: string, path: string, body?: unknown) => {
    const token = await getToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(path, { method: httpMethod, headers, body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error((err as any).error ?? 'Request failed'); }
    return res.json() as Promise<any>;
  }, [getToken]);

  const discoverReaders = useCallback(async () => {
    setStatus('loading');
    setErrorMsg('');
    rawReadersRef.current.clear();
    try {
      const { secret } = await apiCall('POST', '/api/pos/terminal/connection-token');
      const StripeTerminal = await loadStripeTerminal();
      if (!StripeTerminal) throw new Error('Stripe Terminal SDK failed to load');
      const terminal = StripeTerminal.create({
        onFetchConnectionToken: async () => secret as string,
        onUnexpectedReaderDisconnect: () => { setStatus('terminal_error'); setErrorMsg('Reader disconnected unexpectedly.'); },
      });
      terminalRef.current = terminal;
      // Discover via SDK (internet-connected readers on the account)
      const result = await (terminal as any).discoverReaders({ simulated: false });
      const sdkReaders: any[] = result.discoveredReaders ?? [];
      sdkReaders.forEach((r: any) => rawReadersRef.current.set(r.id, r));

      // Also pull the backend list (registered readers), merge so neither is missed
      const { data: backendList } = await apiCall('GET', '/api/pos/terminal/readers').catch(() => ({ data: [] }));
      const backendReaders: any[] = backendList ?? [];
      // Backend readers that weren't found by SDK discovery won't have a raw ref; skip them for connect
      backendReaders.forEach((r: any) => { if (!rawReadersRef.current.has(r.id)) rawReadersRef.current.set(r.id, null); });

      const seen = new Set<string>();
      const merged: StripeReader[] = [...sdkReaders, ...backendReaders]
        .filter((r: any) => { if (seen.has(r.id)) return false; seen.add(r.id); return true; })
        .map((r: any) => ({
          id: r.id, label: r.label || r.serial_number || 'Reader', status: r.status ?? 'online', device_type: r.device_type ?? '',
        }));

      setReaders(merged);
      setStatus('readers');
    } catch {
      setStatus('readers');
      setReaders([]);
    }
  }, [apiCall]);

  const connectAndCollect = useCallback(async (reader: StripeReader) => {
    if (!terminalRef.current) return;
    setSelectedReader(reader);
    setStatus('connecting');
    try {
      // Use the original SDK reader object, not the reshaped display object
      const rawReader = rawReadersRef.current.get(reader.id);
      if (!rawReader) { setErrorMsg('Reader not found — try refreshing.'); setStatus('terminal_error'); return; }
      const { error: ce } = await (terminalRef.current as any).connectReader(rawReader);
      if (ce) { setErrorMsg((ce as any).message ?? 'Connect failed'); setStatus('terminal_error'); return; }
      setStatus('collecting');
      const { clientSecret } = await apiCall('POST', '/api/pos/terminal/payment-intents', { amountCents, tipEnabled: false });
      const { paymentIntent, error: colErr } = await (terminalRef.current as any).collectPaymentMethod(clientSecret as string);
      if (colErr) { setErrorMsg((colErr as any).message ?? 'Card collection cancelled'); setStatus('terminal_error'); return; }
      setStatus('processing');
      const { paymentIntent: processed, error: procErr } = await (terminalRef.current as any).processPayment(paymentIntent);
      if (procErr) { setErrorMsg((procErr as any).message ?? 'Payment processing failed'); setStatus('terminal_error'); return; }
      const piId: string = (processed as any).id;
      await apiCall('POST', `/api/pos/terminal/payment-intents/${piId}/capture`);
      setStatus('terminal_done');
      setTimeout(() => { onComplete('Card (Terminal)'); onClose(); }, 1800);
    } catch (err: any) {
      setErrorMsg((err as Error).message ?? 'Terminal payment failed');
      setStatus('terminal_error');
    }
  }, [amountCents, apiCall, onComplete]);

  const handlePrintReceipt = useCallback(() => {
    printReceipt({ cartItems, total, paymentMethod: 'Card Not Present' });
  }, [cartItems, total]);

  useEffect(() => { void discoverReaders(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const canClose = ['readers', 'terminal_error', 'cnp', 'cnp_done'].includes(status);

  const tSt = {
    overlay: { position: 'fixed' as const, inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center' },
    modal: { background: '#FFFFFF', borderRadius: '12px', width: '480px', maxHeight: '86vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' },
    header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 24px', borderBottom: '1px solid #E2E8F0', background: '#0A2342', borderRadius: '12px 12px 0 0', color: '#FFFFFF' },
    body: { padding: '24px' },
    readerCard: { display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 16px', border: '1px solid #E2E8F0', borderRadius: '8px', cursor: 'pointer', marginBottom: '8px', transition: 'border-color 0.15s' } as React.CSSProperties,
    divider: { display: 'flex', alignItems: 'center', gap: '12px', margin: '20px 0' },
    dividerLine: { flex: 1, borderTop: '1px solid #E2E8F0' } as React.CSSProperties,
    dividerText: { fontSize: '12px', color: '#94A3B8', fontWeight: 500, whiteSpace: 'nowrap' as const },
    statusBox: { textAlign: 'center' as const, padding: '24px 0' },
    outlineBtn: { width: '100%', padding: '10px', background: 'none', border: '1px solid #E2E8F0', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', color: '#64748B' } as React.CSSProperties,
  };

  const CnpSection = () => (
    <>
      <div style={tSt.divider}>
        <div style={tSt.dividerLine} />
        <span style={tSt.dividerText}>or card not present</span>
        <div style={tSt.dividerLine} />
      </div>
      <button style={{ ...tSt.outlineBtn, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }} onClick={() => setStatus('cnp')}>
        <CreditCard size={15} /> Card Not Present (Keyed)
      </button>
    </>
  );

  return (
    <div style={tSt.overlay} onClick={canClose ? onClose : undefined}>
      <div style={tSt.modal} onClick={(e) => e.stopPropagation()}>
        <div style={tSt.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, fontSize: '16px' }}>
            <CreditCard size={18} /> Card Payment — ${total.toFixed(2)}
          </div>
          <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#FFFFFF' }} onClick={onClose}><X size={20} /></button>
        </div>
        <div style={tSt.body}>

          {/* ── Discovering ── */}
          {status === 'loading' && (
            <div style={tSt.statusBox}>
              <Loader size={36} style={{ color: '#0A2342', marginBottom: '12px' }} />
              <div style={{ fontSize: '15px', fontWeight: 600, color: '#0A2342' }}>Looking for card readers…</div>
              <div style={{ fontSize: '13px', color: '#94A3B8', marginTop: '6px' }}>Connecting to Stripe Terminal</div>
            </div>
          )}

          {/* ── Reader list ── */}
          {status === 'readers' && (
            <>
              {readers.length > 0 ? (
                <>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#0A2342', marginBottom: '10px' }}>Available readers</div>
                  {readers.map((r) => (
                    <div key={r.id} style={tSt.readerCard} onClick={() => void connectAndCollect(r)}>
                      <Wifi size={20} style={{ color: '#22C55E', flexShrink: 0 }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: '14px', color: '#0A2342' }}>{r.label}</div>
                        <div style={{ fontSize: '12px', color: '#64748B' }}>{r.device_type}</div>
                      </div>
                      <div style={{ fontSize: '12px', color: '#00D4FF', fontWeight: 600 }}>Use →</div>
                    </div>
                  ))}
                  <button style={tSt.outlineBtn} onClick={() => void discoverReaders()}>Refresh readers</button>
                </>
              ) : (
                <div style={{ textAlign: 'center', padding: '16px 0 8px' }}>
                  <WifiOff size={28} style={{ color: '#94A3B8', marginBottom: '8px' }} />
                  <div style={{ fontWeight: 600, fontSize: '14px', color: '#0A2342', marginBottom: '4px' }}>No readers found</div>
                  <div style={{ fontSize: '13px', color: '#64748B' }}>Register a reader in your Stripe Dashboard, or use card-not-present below.</div>
                </div>
              )}
              <CnpSection />
            </>
          )}

          {/* ── Connecting ── */}
          {status === 'connecting' && (
            <div style={tSt.statusBox}>
              <Loader size={36} style={{ color: '#0A2342', marginBottom: '12px' }} />
              <div style={{ fontSize: '15px', fontWeight: 600, color: '#0A2342' }}>Connecting to {selectedReader?.label}…</div>
            </div>
          )}

          {/* ── Waiting for card ── */}
          {status === 'collecting' && (
            <div style={tSt.statusBox}>
              <CreditCard size={48} style={{ color: '#0A2342', marginBottom: '16px' }} />
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#0A2342' }}>Tap, insert, or swipe</div>
              <div style={{ fontSize: '36px', fontWeight: 700, color: '#00D4FF', margin: '10px 0', fontFamily: 'monospace' }}>${total.toFixed(2)}</div>
              <div style={{ fontSize: '13px', color: '#64748B' }}>Waiting on {selectedReader?.label}</div>
            </div>
          )}

          {/* ── Processing ── */}
          {status === 'processing' && (
            <div style={tSt.statusBox}>
              <Loader size={36} style={{ color: '#0A2342', marginBottom: '12px' }} />
              <div style={{ fontSize: '15px', fontWeight: 600, color: '#0A2342' }}>Processing…</div>
            </div>
          )}

          {/* ── Terminal success ── */}
          {status === 'terminal_done' && (
            <div style={tSt.statusBox}>
              <CheckCircle2 size={48} style={{ color: '#22C55E', marginBottom: '16px' }} />
              <div style={{ fontSize: '20px', fontWeight: 700, color: '#03543F' }}>Payment Approved</div>
              <div style={{ fontSize: '14px', color: '#64748B', marginTop: '8px' }}>${total.toFixed(2)} via card reader</div>
            </div>
          )}

          {/* ── Terminal error ── */}
          {status === 'terminal_error' && (
            <div style={tSt.statusBox}>
              <AlertTriangle size={36} style={{ color: '#DC2626', marginBottom: '12px' }} />
              <div style={{ fontSize: '15px', fontWeight: 600, color: '#DC2626', marginBottom: '6px' }}>Reader Error</div>
              <div style={{ fontSize: '13px', color: '#64748B', marginBottom: '20px' }}>{errorMsg}</div>
              <button style={{ padding: '10px 24px', background: '#0A2342', color: '#FFFFFF', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, marginBottom: '12px' }} onClick={() => void discoverReaders()}>Try Again</button>
              <CnpSection />
            </div>
          )}

          {/* ── Card Not Present entry ── */}
          {status === 'cnp' && (
            <Elements stripe={getStripe()}>
              <CnpForm
                total={total}
                amountCents={amountCents}
                onBack={() => setStatus('readers')}
                onComplete={(method) => { setStatus('cnp_done'); onComplete(method); }}
                apiCall={apiCall}
              />
            </Elements>
          )}

          {/* ── CNP success ── */}
          {status === 'cnp_done' && (
            <div style={tSt.statusBox}>
              <CheckCircle2 size={48} style={{ color: '#22C55E', marginBottom: '16px' }} />
              <div style={{ fontSize: '20px', fontWeight: 700, color: '#03543F' }}>Payment Complete</div>
              <div style={{ fontSize: '14px', color: '#64748B', marginTop: '8px' }}>${total.toFixed(2)} — card not present</div>
              <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', marginTop: '20px' }}>
                <button style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '9px 18px', fontSize: '13px', fontWeight: 600, borderRadius: '6px', border: '1px solid #0A2342', background: '#FFFFFF', color: '#0A2342', cursor: 'pointer' }} onClick={handlePrintReceipt}>
                  <Printer size={15} /> Print Receipt
                </button>
                <button style={{ padding: '9px 18px', fontSize: '13px', fontWeight: 600, borderRadius: '6px', background: '#0A2342', color: '#FFFFFF', border: 'none', cursor: 'pointer' }} onClick={onClose}>Done</button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

/* ── Payment Modal ─────────────────────────────────────── */

function PaymentModal({
  total, method, onClose, onComplete, cartItems,
}: {
  total: number;
  method: string;
  onClose: () => void;
  onComplete: (method: string, tendered: number) => void;
  cartItems: CartItem[];
}) {
  const [tendered, setTendered] = useState(method === 'Cash' ? '' : total.toFixed(2));
  const [slip, setSlip] = useState('');
  const [done, setDone] = useState(false);
  const change = method === 'Cash' ? Math.max(0, (parseFloat(tendered) || 0) - total) : 0;

  const handleComplete = () => {
    if (method === 'Cash' && parseFloat(tendered) < total) return;
    setDone(true);
    onComplete(method, parseFloat(tendered) || total);
  };

  const handlePrintReceipt = () => {
    printReceipt({ cartItems, total, paymentMethod: method, change });
  };

  return (
    <div style={st.overlay} onClick={done ? undefined : onClose}>
      <div style={st.modal} className="helm-modal" onClick={(e) => e.stopPropagation()}>
        <div style={st.modalHeader}>
          <h2 style={st.modalTitle}>Payment — {method}</h2>
          <button style={st.closeBtn} onClick={onClose}><X size={20} /></button>
        </div>
        <div style={st.modalBody}>
          {done ? (
            <div style={{ textAlign: 'center', padding: '32px 0' }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>✓</div>
              <div style={{ fontSize: '20px', fontWeight: 700, color: '#03543F' }}>Payment Complete</div>
              <div style={{ fontSize: '14px', color: '#64748B', marginTop: '8px' }}>${total.toFixed(2)} charged via {method}</div>
              {method === 'Cash' && change > 0 && (
                <div style={{ fontSize: '16px', fontWeight: 600, color: '#0A2342', marginTop: '12px' }}>Change: ${change.toFixed(2)}</div>
              )}
              <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', marginTop: '20px' }}>
                <button
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '9px 18px', fontSize: '13px', fontWeight: 600, borderRadius: '6px', border: '1px solid #0A2342', backgroundColor: '#FFFFFF', color: '#0A2342', cursor: 'pointer' }}
                  onClick={handlePrintReceipt}
                ><Printer size={15} /> Print Receipt</button>
                <button style={{ ...st.saveBtn, fontSize: '13px', padding: '9px 18px' }} onClick={onClose}>Done</button>
              </div>
            </div>
          ) : (
            <>
              <div style={{ textAlign: 'center', marginBottom: '24px' }}>
                <div style={{ fontSize: '14px', color: '#64748B', marginBottom: '4px' }}>Total Due</div>
                <div style={{ fontSize: '36px', fontWeight: 700, color: '#0A2342', fontFamily: '"JetBrains Mono", monospace' }}>${total.toFixed(2)}</div>
              </div>
              {method === 'Cash' && (
                <>
                  {/* Quick-tender denomination buttons */}
                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ fontSize: '11px', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>Quick Amounts</div>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' as const }}>
                      {[
                        { label: 'Exact', value: total },
                        ...[1, 5, 10, 20, 50, 100].filter((d) => d > total).slice(0, 5).map((d) => ({ label: `$${d}`, value: d })),
                      ].map((btn) => (
                        <button
                          key={btn.label}
                          style={{
                            flex: '1 1 auto', minWidth: '60px', padding: '10px 8px',
                            background: parseFloat(tendered) === btn.value ? '#0A2342' : '#F8FAFC',
                            color: parseFloat(tendered) === btn.value ? '#FFFFFF' : '#0A2342',
                            border: `1px solid ${parseFloat(tendered) === btn.value ? '#0A2342' : '#E2E8F0'}`,
                            borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 600,
                          }}
                          onClick={() => setTendered(btn.value.toFixed(2))}
                        >{btn.label}</button>
                      ))}
                    </div>
                  </div>
                  <div style={st.field}>
                    <label style={st.label}>Amount Tendered</label>
                    <input
                      style={{ ...st.input, fontSize: '20px', textAlign: 'center', fontFamily: '"JetBrains Mono", monospace' }}
                      type="number"
                      step="0.01"
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
                  <div style={{ color: '#64748B', fontSize: '14px' }}>Tap, insert, or swipe card to proceed</div>
                </div>
              )}
              {method === 'ACH' && (
                <div style={{ textAlign: 'center', padding: '24px', background: '#F8FAFC', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
                  <div style={{ color: '#64748B', fontSize: '14px' }}>ACH payment will be initiated on confirmation</div>
                </div>
              )}
              {method === 'Charge to Slip' && (
                <div style={st.field}>
                  <label style={st.label}>Slip Number</label>
                  <input style={st.input} placeholder="e.g. A-01" value={slip} onChange={(e) => setSlip(e.target.value)} autoFocus />
                </div>
              )}
            </>
          )}
        </div>
        {!done && (
          <div style={st.modalFooter}>
            <button style={st.cancelBtn} onClick={onClose}>Cancel</button>
            <button
              style={{ ...st.saveBtn, opacity: (method === 'Cash' && parseFloat(tendered) < total) ? 0.5 : 1 }}
              onClick={handleComplete}
              disabled={method === 'Cash' && parseFloat(tendered) < total}
            >
              Complete Payment
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Readers Settings ─────────────────────────────────── */

interface RegisteredReader { id: string; label: string; status: string; device_type: string }

function ReadersSettings({ getToken }: { getToken: () => Promise<string | null> }) {
  const [readers, setReaders] = useState<RegisteredReader[]>([]);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [regCode, setRegCode] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState('');

  const authFetch = useCallback(async (method: string, path: string, body?: unknown) => {
    const token = await getToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as any).error ?? 'Request failed'); }
    return res.json() as Promise<any>;
  }, [getToken]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await authFetch('GET', '/api/pos/terminal/readers').catch(() => ({ data: [] }));
      setReaders((data ?? []) as RegisteredReader[]);
    } finally { setLoading(false); }
  }, [authFetch]);

  useEffect(() => { void load(); }, [load]);

  const handleRegister = async () => {
    if (!regCode.trim() || !label.trim()) { setError('Both label and registration code are required.'); return; }
    setError('');
    setRegistering(true);
    try {
      await authFetch('POST', '/api/pos/terminal/readers/register', { registrationCode: regCode.trim(), label: label.trim() });
      setRegCode(''); setLabel(''); setShowForm(false);
      await load();
    } catch (err: any) {
      setError((err as Error).message ?? 'Registration failed. Check the code and try again.');
    } finally { setRegistering(false); }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Remove this reader from your Stripe account?')) return;
    setDeleting(id);
    try {
      await authFetch('DELETE', `/api/pos/terminal/readers/${id}`);
      await load();
    } catch { /* ignore */ } finally { setDeleting(null); }
  };

  const ss: Record<string, React.CSSProperties> = {
    wrap: { maxWidth: '640px', marginTop: '8px' },
    card: { background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '10px', padding: '24px', marginBottom: '20px' },
    cardTitle: { fontSize: '15px', fontWeight: 700, color: '#0A2342', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' },
    row: { display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 0', borderBottom: '1px solid #F1F5F9' },
    readerLabel: { fontWeight: 600, fontSize: '14px', color: '#0A2342' },
    readerMeta: { fontSize: '12px', color: '#64748B', marginTop: '2px' },
    badge: { fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '99px', background: '#DEF7EC', color: '#03543F' },
    delBtn: { marginLeft: 'auto', background: 'none', border: '1px solid #FCA5A5', borderRadius: '6px', color: '#DC2626', padding: '4px 10px', fontSize: '12px', cursor: 'pointer', fontWeight: 600 },
    field: { display: 'flex', flexDirection: 'column' as const, gap: '4px', marginBottom: '12px' },
    label: { fontSize: '12px', fontWeight: 600, color: '#64748B' },
    input: { padding: '9px 12px', fontSize: '14px', border: '1px solid #E2E8F0', borderRadius: '8px', outline: 'none', width: '100%', boxSizing: 'border-box' as const },
    hint: { fontSize: '12px', color: '#94A3B8', marginTop: '2px' },
    addBtn: { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '9px 18px', background: '#0A2342', color: '#FFFFFF', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 600 },
    cancelBtn: { padding: '9px 18px', background: 'none', border: '1px solid #E2E8F0', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', color: '#64748B', marginLeft: '8px' },
  };

  return (
    <div style={ss.wrap}>
      <div style={ss.card}>
        <div style={ss.cardTitle}>
          <Wifi size={16} /> Card Readers
          <button style={{ ...ss.addBtn, marginLeft: 'auto', padding: '6px 14px', fontSize: '12px' }} onClick={() => { setShowForm((v) => !v); setError(''); }}>
            {showForm ? 'Cancel' : '+ Register Reader'}
          </button>
        </div>

        {showForm && (
          <div style={{ background: '#F8FAFC', borderRadius: '8px', padding: '16px', marginBottom: '16px', border: '1px solid #E2E8F0' }}>
            <div style={ss.field}>
              <label style={ss.label}>Reader Label</label>
              <input style={ss.input} placeholder="e.g. Front Desk" value={label} onChange={(e) => setLabel(e.target.value)} />
            </div>
            <div style={ss.field}>
              <label style={ss.label}>Registration Code</label>
              <input style={ss.input} placeholder="e.g. quick-fox-1" value={regCode} onChange={(e) => setRegCode(e.target.value)} />
              <div style={ss.hint}>Shown on the reader's screen when you tap "Generate pairing code"</div>
            </div>
            {error && <div style={{ fontSize: '13px', color: '#DC2626', marginBottom: '12px' }}>{error}</div>}
            <div>
              <button style={{ ...ss.addBtn, opacity: registering ? 0.7 : 1 }} onClick={() => void handleRegister()} disabled={registering}>
                {registering ? 'Registering…' : 'Register'}
              </button>
              <button style={ss.cancelBtn} onClick={() => { setShowForm(false); setError(''); }}>Cancel</button>
            </div>
          </div>
        )}

        {loading && <div style={{ fontSize: '14px', color: '#94A3B8', padding: '8px 0' }}>Loading readers…</div>}
        {!loading && readers.length === 0 && (
          <div style={{ fontSize: '14px', color: '#64748B', padding: '12px 0', textAlign: 'center' }}>
            <WifiOff size={24} style={{ display: 'block', margin: '0 auto 8px', opacity: 0.4 }} />
            No readers registered. Click "Register Reader" to pair a physical device.
          </div>
        )}
        {!loading && readers.map((r, i) => (
          <div key={r.id} style={{ ...ss.row, borderBottom: i === readers.length - 1 ? 'none' : '1px solid #F1F5F9' }}>
            <Wifi size={18} style={{ color: r.status === 'online' ? '#22C55E' : '#94A3B8', flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={ss.readerLabel}>{r.label || r.id}</div>
              <div style={ss.readerMeta}>{r.device_type} · {r.id}</div>
            </div>
            <span style={{ ...ss.badge, background: r.status === 'online' ? '#DEF7EC' : '#F1F5F9', color: r.status === 'online' ? '#03543F' : '#64748B' }}>{r.status}</span>
            <button style={{ ...ss.delBtn, opacity: deleting === r.id ? 0.5 : 1 }} disabled={deleting === r.id} onClick={() => void handleDelete(r.id)}>
              {deleting === r.id ? '…' : 'Remove'}
            </button>
          </div>
        ))}
      </div>

      <div style={{ ...ss.card, background: '#FFFBEB', border: '1px solid #FDE68A' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: '#92400E', marginBottom: '6px' }}>How to pair a physical reader</div>
        <ol style={{ margin: 0, paddingLeft: '18px', fontSize: '13px', color: '#78350F', lineHeight: 1.8 }}>
          <li>Power on your Stripe Terminal reader (S700, WisePOS E, etc.)</li>
          <li>On the reader, tap <strong>Settings → Generate pairing code</strong></li>
          <li>Enter that code in the form above along with a label for this reader</li>
          <li>Once registered, the reader will appear in the Card payment modal</li>
        </ol>
      </div>
    </div>
  );
}

/* ── Receipt Settings + shared print helper ────────────── */

const RECEIPT_SETTINGS_KEY = 'helm_pos_receipt_settings';

interface ReceiptConfig {
  businessName: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  returnPolicy: string;
}

function getReceiptConfig(): ReceiptConfig {
  try {
    return JSON.parse(localStorage.getItem(RECEIPT_SETTINGS_KEY) || '{}');
  } catch { return {} as ReceiptConfig; }
}

function printReceipt({
  cartItems, total, paymentMethod, change = 0,
}: { cartItems: CartItem[]; total: number; paymentMethod: string; change?: number }) {
  const win = window.open('', '_blank', 'width=400,height=640');
  if (!win) return;
  const cfg = getReceiptConfig();
  const now = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  const rows = cartItems.map((ci) =>
    `<tr><td>${ci.product.name}</td><td style="text-align:right">x${ci.quantity}</td><td style="text-align:right">$${(ci.product.price * ci.quantity).toFixed(2)}</td></tr>`
  ).join('');
  const businessName = cfg.businessName || 'Point of Sale';
  const headerLines = [
    cfg.address ? `<div>${cfg.address.replace(/\n/g, '<br/>')}</div>` : '',
    cfg.phone ? `<div>Tel: ${cfg.phone}</div>` : '',
    cfg.email ? `<div>${cfg.email}</div>` : '',
    cfg.website ? `<div>${cfg.website}</div>` : '',
  ].filter(Boolean).join('');
  const footer = cfg.returnPolicy
    ? `<div class="policy"><strong>Return Policy:</strong><br/>${cfg.returnPolicy}</div><hr/><div class="footer">Thank you for your business!</div>`
    : `<div class="footer">Thank you for your business!</div>`;
  win.document.write(`<!DOCTYPE html><html><head><title>Receipt</title>
  <style>
    body{font-family:monospace;padding:16px;max-width:320px;margin:0 auto}
    h2{text-align:center;font-size:17px;margin:0 0 4px}
    .info{text-align:center;font-size:11px;color:#555;margin-bottom:4px}
    hr{border:none;border-top:1px dashed #999;margin:8px 0}
    table{width:100%;border-collapse:collapse;font-size:13px}
    td{padding:2px 0}
    .total{text-align:right;font-weight:bold;font-size:15px;margin:6px 0 2px}
    .sub{text-align:right;font-size:12px;color:#555}
    .footer{text-align:center;font-size:11px;color:#666;margin-top:10px}
    .policy{font-size:11px;color:#444;margin-top:8px;line-height:1.5}
  </style>
  </head><body>
  <h2>${businessName}</h2>
  ${headerLines ? `<div class="info">${headerLines}</div>` : ''}
  <div class="info">${now}</div>
  <hr/>
  <table>
    <thead><tr><th style="text-align:left">Item</th><th style="text-align:right">Qty</th><th style="text-align:right">Amt</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <hr/>
  <div class="total">Total: $${total.toFixed(2)}</div>
  ${change > 0 ? `<div class="sub">Change: $${change.toFixed(2)}</div>` : ''}
  <div class="sub">Payment: ${paymentMethod}</div>
  <hr/>
  ${footer}
  </body></html>`);
  win.document.close();
  win.print();
}

function ReceiptSettings() {
  const [cfg, setCfg] = useState<ReceiptConfig>(() => ({
    businessName: '', address: '', phone: '', email: '', website: '', returnPolicy: '',
    ...getReceiptConfig(),
  }));
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    localStorage.setItem(RECEIPT_SETTINGS_KEY, JSON.stringify(cfg));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const rs: Record<string, React.CSSProperties> = {
    card: { background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '10px', padding: '24px', marginBottom: '20px' },
    cardTitle: { fontSize: '15px', fontWeight: 700, color: '#0A2342', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' },
    field: { display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '14px' } as React.CSSProperties,
    label: { fontSize: '12px', fontWeight: 600, color: '#64748B' },
    input: { padding: '9px 12px', fontSize: '14px', border: '1px solid #E2E8F0', borderRadius: '8px', outline: 'none', width: '100%', boxSizing: 'border-box' as const },
    hint: { fontSize: '11px', color: '#94A3B8' },
    saveBtn: { padding: '10px 24px', background: '#0A2342', color: '#FFFFFF', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: 600 },
  };

  return (
    <div style={{ maxWidth: '640px', marginTop: '8px' }}>
      <div style={rs.card}>
        <div style={rs.cardTitle}><Printer size={16} /> Receipt Header</div>
        <div style={rs.field}>
          <label style={rs.label}>Business Name</label>
          <input style={rs.input} placeholder="Bayshore Marina" value={cfg.businessName} onChange={(e) => setCfg((c) => ({ ...c, businessName: e.target.value }))} />
          <div style={rs.hint}>Appears as the receipt title</div>
        </div>
        <div style={rs.field}>
          <label style={rs.label}>Address</label>
          <textarea
            style={{ ...rs.input, resize: 'vertical', minHeight: '64px', fontFamily: 'inherit' }}
            placeholder={'123 Harbor Dr\nMarinetown, FL 33101'}
            value={cfg.address}
            onChange={(e) => setCfg((c) => ({ ...c, address: e.target.value }))}
          />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div style={rs.field}>
            <label style={rs.label}>Phone</label>
            <input style={rs.input} placeholder="(555) 123-4567" value={cfg.phone} onChange={(e) => setCfg((c) => ({ ...c, phone: e.target.value }))} />
          </div>
          <div style={rs.field}>
            <label style={rs.label}>Email</label>
            <input style={rs.input} placeholder="info@marina.com" value={cfg.email} onChange={(e) => setCfg((c) => ({ ...c, email: e.target.value }))} />
          </div>
        </div>
        <div style={rs.field}>
          <label style={rs.label}>Website</label>
          <input style={rs.input} placeholder="www.marina.com" value={cfg.website} onChange={(e) => setCfg((c) => ({ ...c, website: e.target.value }))} />
        </div>
      </div>

      <div style={rs.card}>
        <div style={rs.cardTitle}><Package size={16} /> Receipt Footer</div>
        <div style={rs.field}>
          <label style={rs.label}>Return Policy</label>
          <textarea
            style={{ ...rs.input, resize: 'vertical', minHeight: '80px', fontFamily: 'inherit' }}
            placeholder="All sales final. No refunds on fuel or perishable goods."
            value={cfg.returnPolicy}
            onChange={(e) => setCfg((c) => ({ ...c, returnPolicy: e.target.value }))}
          />
          <div style={rs.hint}>Printed at the bottom of every receipt. Leave blank to omit.</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button style={rs.saveBtn} onClick={handleSave}>Save Receipt Settings</button>
          {saved && <span style={{ fontSize: '13px', color: '#22C55E', fontWeight: 600 }}>✓ Saved</span>}
        </div>
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
  const navigate = useNavigate();
  const { getToken } = useAuth();
  const [tab, setTab] = useState<'sale' | 'transactions' | 'settings'>('sale');
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [shiftOpen, setShiftOpen] = useState(false);
  const [shiftId, setShiftId] = useState<string | null>(null);
  const [shiftCashier, setShiftCashier] = useState('');
  const [shiftFloat, setShiftFloat] = useState(0);
  const [shiftOpenedAt, setShiftOpenedAt] = useState<Date | null>(null);
  const [showShiftModal, setShowShiftModal] = useState(false);
  const [showCloseShiftModal, setShowCloseShiftModal] = useState(false);
  const [closingShift, setClosingShift] = useState(false);
  const [paymentModal, setPaymentModal] = useState<{ method: string; cartSnapshot: CartItem[] } | null>(null);
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

  const { data: apiProductsResp, loading: loadingProducts } = useApi<{ data: ApiProduct[]; pagination: unknown }>('get', '/api/pos/products', { immediate: true });
  const { data: apiTxnsResp, loading: loadingTxns, execute: refreshTransactions } = useApi<{ data: ApiTransaction[]; pagination: unknown }>('get', '/api/pos/transactions', { immediate: true });
  const { data: shiftsData, execute: fetchShifts } = useApi<{ data: ApiShift[] }>('get', '/api/pos/shifts', { immediate: true });
  const { execute: openShiftApi, loading: openingShift } = useApi<ApiShift>('post', '/api/pos/shifts/open');
  const createTransaction = useApi<unknown>('post', '/api/pos/transactions');

  useEffect(() => {
    if (shiftsData?.data) {
      const openShift = shiftsData.data.find((s) => s.status === 'OPEN');
      if (openShift) {
        setShiftOpen(true);
        setShiftId(openShift.id);
        setShiftFloat(openShift.openingFloatCents / 100);
        setShiftOpenedAt(new Date(openShift.openedAt));
      } else {
        setShiftOpen(false);
        setShiftId(null);
      }
    }
  }, [shiftsData]);

  const handleOpenShift = async (name: string, floatAmt: number) => {
    const result = await openShiftApi({ openingFloatCents: Math.round(floatAmt * 100) });
    if (result) {
      setShiftOpen(true);
      setShiftId(result.id);
      setShiftCashier(name);
      setShiftFloat(floatAmt);
      setShiftOpenedAt(new Date(result.openedAt));
      setShowShiftModal(false);
    }
  };

  const handleCloseShift = async (closingCash: number, notes: string) => {
    if (!shiftId) return;
    setClosingShift(true);
    try {
      const token = await getToken();
      await api.post(`/pos/shifts/${shiftId}/close`, { closingCashCents: Math.round(closingCash * 100), notes: notes || undefined }, token);
      setShiftOpen(false);
      setShiftId(null);
      setShiftCashier('');
      setShiftFloat(0);
      setShiftOpenedAt(null);
      setShowCloseShiftModal(false);
      await fetchShifts();
    } catch (err) {
      console.error('Failed to close shift:', err);
    } finally {
      setClosingShift(false);
    }
  };

  const posProducts = useMemo(() => {
    const raw = apiProductsResp?.data ?? [];
    return raw.map(mapApiProduct);
  }, [apiProductsResp]);

  const apiTransactionsMapped = useMemo<Transaction[]>(() => {
    const raw = apiTxnsResp?.data ?? [];
    return raw.map((t) => ({
      id: t.id,
      number: `TXN-${t.id.slice(0, 8).toUpperCase()}`,
      date: new Date(t.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }),
      items: t.lineItems?.reduce((s, li) => s + li.quantity, 0) ?? 0,
      subtotal: t.subtotalCents / 100,
      tax: t.taxCents / 100,
      total: t.totalCents / 100,
      method: 'N/A',
      cashier: 'Staff',
      cartItems: (t.lineItems ?? []).map((li) => ({
        product: {
          id: li.productId,
          sku: li.productId.slice(0, 8),
          name: li.product?.name ?? 'Item',
          category: 'General',
          price: li.unitPriceCents / 100,
          taxRate: 0,
          inStock: 999,
          reorderPoint: 0,
        },
        quantity: li.quantity,
      })),
    }));
  }, [apiTxnsResp]);

  const transactions = apiTransactionsMapped;

  const handlePaymentComplete = async (method: string) => {
    const lineItems = cart.map((i) => ({
      productId: i.product.id,
      quantity: Math.max(1, Math.round(i.quantity)),
      unitPriceCents: Math.round(i.product.price * 100),
    }));

    const result = await createTransaction.execute({
      lineItems,
      paymentMethod: PAYMENT_METHOD_API[method] ?? 'CARD',
    });

    if (result !== null) {
      await refreshTransactions();
      setCart([]);
      setRecalledTxn(null);
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
  const todayPrefix = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const runningTotal = transactions.filter((t) => t.date.startsWith(todayPrefix)).reduce((s, t) => s + t.total, 0) + total;

  const tabItems: { key: typeof tab; label: string }[] = [
    { key: 'sale', label: 'New Sale' },
    { key: 'transactions', label: 'Transactions' },
    { key: 'settings', label: 'Settings' },
  ];

  return (
    <div style={st.page}>
      <h1 style={st.title} className="helm-page-title">Point of Sale</h1>
      <hr style={st.divider} />

      {loading && <div style={{ textAlign: 'center', padding: '24px', color: '#64748B' }}>Loading POS data...</div>}

      {/* Shift Banner */}
      {shiftOpen ? (
        <div style={st.shiftBanner}>
          <div style={st.shiftInfo}>
            <div><div style={st.shiftLabel}>Cashier</div><div style={st.shiftValue}>{shiftCashier || 'Staff'}</div></div>
            <div><div style={st.shiftLabel}>Opened At</div><div style={st.shiftValue}>{shiftOpenedAt ? shiftOpenedAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '—'}</div></div>
            <div><div style={st.shiftLabel}>Opening Float</div><div style={st.shiftValue}>${shiftFloat.toFixed(2)}</div></div>
            <div><div style={st.shiftLabel}>Running Total</div><div style={{ ...st.shiftValue, color: '#00D4FF' }}>${runningTotal.toFixed(2)}</div></div>
          </div>
          <button style={{ ...st.addBtn, backgroundColor: '#DC2626' }} onClick={() => setShowCloseShiftModal(true)}>Close Shift</button>
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
            <div style={st.prodGrid}>
              {!loadingProducts && posProducts.length === 0 && (
                <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '40px 24px', color: '#64748B' }}>
                  <Package size={36} style={{ color: '#CBD5E1', marginBottom: '12px' }} />
                  <div style={{ fontWeight: 600 }}>No products found</div>
                  <div style={{ fontSize: '13px', marginTop: '4px', marginBottom: '16px' }}>Add products in inventory to make them available here.</div>
                  <button
                    onClick={() => navigate('/inventory')}
                    style={{ background: '#2E4A6B', color: '#fff', border: 'none', borderRadius: '6px', padding: '8px 18px', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}
                  >
                    Add Products in Inventory
                  </button>
                </div>
              )}
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
              <div style={st.cartRow}><span>Tax</span><span>${tax.toFixed(2)}</span></div>
              <div style={st.cartTotal}><span>Total</span><span>${total.toFixed(2)}</span></div>
              <div style={st.payBtns}>
                <button style={{ ...st.payBtn, ...st.payBtnPrimary }} onClick={() => total > 0 && setPaymentModal({ method: 'Card', cartSnapshot: cart })}><CreditCard size={16} /> Card</button>
                <button style={st.payBtn} onClick={() => total > 0 && setPaymentModal({ method: 'Cash', cartSnapshot: cart })}><Banknote size={16} /> Cash</button>
                {achEnabled && (
                  <button style={st.payBtn} onClick={() => total > 0 && setPaymentModal({ method: 'ACH', cartSnapshot: cart })}><Building2 size={16} /> ACH</button>
                )}
                <button style={{ ...st.payBtn, gridColumn: achEnabled ? undefined : 'span 2' }} onClick={() => total > 0 && setPaymentModal({ method: 'Charge to Slip', cartSnapshot: cart })}><DollarSign size={16} /> Charge to Slip</button>
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
            <input style={st.input} type="date" defaultValue="2026-03-23" />
            <span style={{ color: '#64748B' }}>to</span>
            <input style={st.input} type="date" defaultValue="2026-03-25" />
          </div>
          <p style={{ fontSize: '13px', color: '#64748B', marginBottom: '12px' }}>Click a transaction number to recall it to the sale screen.</p>
          <div style={st.tableWrap} className="helm-table-wrap">
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
                  <th style={st.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {!loadingTxns && transactions.length === 0 && (
                  <tr>
                    <td colSpan={9} style={{ textAlign: 'center', padding: '40px 24px', color: '#64748B' }}>
                      No transactions found.
                    </td>
                  </tr>
                )}
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
                      <td style={{ ...st.td, fontSize: '13px' }}>{t.date}</td>
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
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'settings' && (
        <>
          <ReadersSettings getToken={getToken} />
          <ReceiptSettings />
        </>
      )}

      {showShiftModal && (
        <OpenShiftModal
          onClose={() => setShowShiftModal(false)}
          onOpen={handleOpenShift}
          loading={openingShift}
        />
      )}
      {showCloseShiftModal && (
        <CloseShiftModal
          onClose={() => setShowCloseShiftModal(false)}
          onConfirm={handleCloseShift}
          floatAmt={shiftFloat}
          runningTotal={runningTotal - total}
          loading={closingShift}
        />
      )}
      {paymentModal && paymentModal.method === 'Card' && (
        <CardPaymentModal
          total={total}
          amountCents={Math.round(total * 100)}
          cartItems={paymentModal.cartSnapshot}
          onClose={() => setPaymentModal(null)}
          onComplete={(method) => { handlePaymentComplete(method); }}
          getToken={getToken}
        />
      )}
      {paymentModal && paymentModal.method !== 'Card' && (
        <PaymentModal
          total={total}
          method={paymentModal.method}
          onClose={() => setPaymentModal(null)}
          onComplete={(method) => handlePaymentComplete(method)}
          cartItems={paymentModal.cartSnapshot}
        />
      )}
    </div>
  );
}
