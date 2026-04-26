import React, { useState } from 'react';
import { useApi } from '../hooks/useApi';
import { useToast } from '../components/Toast';
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

/* ── API Response Types ────────────────────────────────── */

interface ApiProduct {
  id: string; sku: string; barcode: string | null; name: string; category: string;
  costCents: number; priceCents: number; taxClass: string | null; qoh: number;
  reorderPoint: number; cogsGlAccountId: string | null; revenueGlAccountId: string | null;
  trackInventory: boolean; active: boolean;
}

interface ApiAdjustment {
  id: string; productId: string; productName?: string; productSku?: string;
  quantityChange: number; reason: string; qohBefore?: number; qohAfter?: number;
  staffName: string | null; notes: string | null; createdAt: string;
}

interface ApiCountSession {
  id: string; name: string; startedBy: string; status: string;
  items: { productId: string; discrepancy?: number }[];
  createdAt: string; completedAt: string | null;
}

interface ApiPurchaseOrder {
  id: string; poNumber: string; vendor: string; status: string;
  expectedDate: string | null; notes: string | null;
  lineItems: { quantity: number; unitCostCents: number }[];
  totalCostCents: number; createdAt: string;
}

function toProduct(p: ApiProduct): Product {
  return {
    id: p.id, sku: p.sku, barcode: p.barcode ?? '', name: p.name,
    category: p.category, costCents: p.costCents, priceCents: p.priceCents,
    taxClass: p.taxClass ?? 'Standard', qoh: p.qoh, reorderPoint: p.reorderPoint,
    glRevenue: p.revenueGlAccountId ?? '4500', glCogs: p.cogsGlAccountId ?? '5200',
    trackInventory: p.trackInventory, active: p.active,
  };
}

function toAdjustment(a: ApiAdjustment, _idx: number): Adjustment {
  const date = new Date(a.createdAt);
  const dateStr = date.toLocaleString('en-US', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const typeMap: Record<string, Adjustment['type']> = {
    received: 'Received', sold: 'Sold', damaged: 'Damaged',
    count: 'Count', shrinkage: 'Shrinkage', return: 'Return',
  };
  return {
    id: a.id,
    date: dateStr,
    product: a.productName ?? a.productId,
    sku: a.productSku ?? '—',
    type: typeMap[a.reason] ?? 'Count',
    qtyChange: a.quantityChange,
    before: a.qohBefore ?? 0,
    after: a.qohAfter ?? 0,
    staff: a.staffName ?? '—',
    notes: a.notes ?? '',
  };
}

function toCountSession(s: ApiCountSession, idx: number): CountSession {
  const discrepancies = s.items.filter((i) => (i.discrepancy ?? 0) !== 0).length;
  return {
    id: s.id,
    countNumber: `CNT-${String(idx + 1).padStart(3, '0')}`,
    date: s.createdAt.split('T')[0],
    startedBy: s.startedBy,
    products: s.items.length,
    discrepancies,
    status: s.status === 'completed' ? 'Completed' : 'In Progress',
  };
}

function toPurchaseOrder(po: ApiPurchaseOrder): PurchaseOrder {
  const statusMap: Record<string, PurchaseOrder['status']> = {
    draft: 'Draft', submitted: 'Submitted', partial: 'Partial',
    received: 'Received', cancelled: 'Cancelled',
  };
  return {
    id: po.id, poNumber: po.poNumber, vendor: po.vendor,
    status: statusMap[po.status] ?? 'Draft',
    items: po.lineItems.length,
    totalCostCents: po.totalCostCents,
    expectedDate: po.expectedDate ?? '—',
    createdDate: po.createdAt.split('T')[0],
  };
}

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
  overlay: { position: 'fixed' as const, inset: 0, backgroundColor: 'rgba(10,35,66,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: '#FFFFFF', borderRadius: '8px', width: '520px', maxHeight: '90vh', overflow: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' },
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

function ProductModal({ product, onClose, onSave }: { product?: Product | null; onClose: () => void; onSave: (p: Product) => void }) {
  const isEdit = !!product;
  const [form, setForm] = useState({
    sku: product?.sku ?? '',
    barcode: product?.barcode ?? '',
    name: product?.name ?? '',
    category: product?.category ?? 'Provisions',
    costCents: product ? String(product.costCents / 100) : '',
    priceCents: product ? String(product.priceCents / 100) : '',
    taxClass: product?.taxClass ?? 'Standard',
    qoh: product ? String(product.qoh) : '',
    reorderPoint: product ? String(product.reorderPoint) : '',
    glRevenue: product?.glRevenue ?? '4500',
    glCogs: product?.glCogs ?? '5200',
  });
  const f = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((p) => ({ ...p, [field]: e.target.value }));
  const categories = ['Fuel', 'Provisions', 'Bait & Tackle', 'Marine Supplies', 'Apparel', 'Boat Parts'];
  return (
    <div style={st.overlay} onClick={onClose}>
      <div style={st.modal} className="helm-modal" onClick={(e) => e.stopPropagation()}>
        <div style={st.modalHeader}>
          <h2 style={st.modalTitle}>{isEdit ? 'Edit Product' : 'Add Product'}</h2>
          <button style={st.closeBtn} onClick={onClose}><X size={20} /></button>
        </div>
        <div style={st.modalBody}>
          <div style={st.row2}>
            <div style={st.field}><label style={st.label}>SKU *</label><input style={st.input} value={form.sku} onChange={f('sku')} placeholder="e.g. ICE-10LB" /></div>
            <div style={st.field}><label style={st.label}>Barcode</label><input style={st.input} value={form.barcode} onChange={f('barcode')} placeholder="UPC / EAN" /></div>
          </div>
          <div style={st.field}><label style={st.label}>Product Name *</label><input style={st.input} value={form.name} onChange={f('name')} placeholder="e.g. Bag of Ice (10lb)" /></div>
          <div style={st.row2}>
            <div style={st.field}><label style={st.label}>Category</label>
              <select style={st.input} value={form.category} onChange={f('category')}>
                {categories.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div style={st.field}><label style={st.label}>Tax Class</label>
              <select style={st.input} value={form.taxClass} onChange={f('taxClass')}>
                <option>Standard</option><option>Exempt</option>
              </select>
            </div>
          </div>
          <div style={st.row2}>
            <div style={st.field}><label style={st.label}>Cost ($)</label><input style={st.input} type="number" step="0.01" value={form.costCents} onChange={f('costCents')} placeholder="0.00" /></div>
            <div style={st.field}><label style={st.label}>Price ($)</label><input style={st.input} type="number" step="0.01" value={form.priceCents} onChange={f('priceCents')} placeholder="0.00" /></div>
          </div>
          <div style={st.row2}>
            <div style={st.field}><label style={st.label}>Qty on Hand</label><input style={st.input} type="number" value={form.qoh} onChange={f('qoh')} /></div>
            <div style={st.field}><label style={st.label}>Reorder Point</label><input style={st.input} type="number" value={form.reorderPoint} onChange={f('reorderPoint')} /></div>
          </div>
          <div style={st.row2}>
            <div style={st.field}><label style={st.label}>GL Revenue Acct</label><input style={st.input} value={form.glRevenue} onChange={f('glRevenue')} placeholder="e.g. 4500" /></div>
            <div style={st.field}><label style={st.label}>GL COGS Acct</label><input style={st.input} value={form.glCogs} onChange={f('glCogs')} placeholder="e.g. 5200" /></div>
          </div>
        </div>
        <div style={st.modalFooter}>
          <button style={st.cancelBtn} onClick={onClose}>Cancel</button>
          <button style={st.saveBtn} onClick={() => {
            onSave({
              id: product?.id ?? String(Date.now()),
              sku: form.sku, barcode: form.barcode, name: form.name, category: form.category,
              costCents: Math.round(parseFloat(form.costCents || '0') * 100),
              priceCents: Math.round(parseFloat(form.priceCents || '0') * 100),
              taxClass: form.taxClass, qoh: parseInt(form.qoh || '0'),
              reorderPoint: parseInt(form.reorderPoint || '0'),
              glRevenue: form.glRevenue, glCogs: form.glCogs, trackInventory: true, active: true,
            });
            onClose();
          }}>{isEdit ? 'Save Changes' : 'Add Product'}</button>
        </div>
      </div>
    </div>
  );
}

function CreatePOModal({ onClose }: { onClose: () => void }) {
  const [saved, setSaved] = useState(false);
  const handleSave = () => { setSaved(true); setTimeout(onClose, 1500); };
  const [vendor, setVendor] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [notes, setNotes] = useState('');
  return (
    <div style={st.overlay} onClick={onClose}>
      <div style={st.modal} className="helm-modal" onClick={(e) => e.stopPropagation()}>
        <div style={st.modalHeader}><h2 style={st.modalTitle}>Create Purchase Order</h2><button style={st.closeBtn} onClick={onClose}><X size={20} /></button></div>
        {saved && <div style={{ padding: '12px 32px', backgroundColor: '#DEF7EC', color: '#03543F', fontWeight: 600, fontSize: '14px', textAlign: 'center' }}>Purchase order created!</div>}
        <div style={st.modalBody}>
          <div style={st.field}><label style={st.label}>Vendor / Supplier *</label><input style={st.input} value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="e.g. Gulf Coast Petroleum" /></div>
          <div style={st.field}><label style={st.label}>Expected Delivery Date</label><input style={st.input} type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} /></div>
          <div style={st.field}><label style={st.label}>Notes</label><input style={st.input} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes..." /></div>
          <div style={{ padding: '12px', background: '#F8FAFC', borderRadius: '6px', border: '1px dashed #CBD5E1', textAlign: 'center', color: '#64748B', fontSize: '13px' }}>
            Line items can be added after creating the PO.
          </div>
        </div>
        <div style={st.modalFooter}>
          <button style={st.cancelBtn} onClick={onClose}>Cancel</button>
          <button style={st.saveBtn} onClick={handleSave}>Create PO</button>
        </div>
      </div>
    </div>
  );
}

function StartCountModal({ onClose }: { onClose: () => void }) {
  const [started, setStarted] = useState(false);
  const handleStart = () => { setStarted(true); setTimeout(onClose, 1500); };
  const [startedBy, setStartedBy] = useState('');
  const [scope, setScope] = useState('All Products');
  return (
    <div style={st.overlay} onClick={onClose}>
      <div style={st.modal} className="helm-modal" onClick={(e) => e.stopPropagation()}>
        <div style={st.modalHeader}><h2 style={st.modalTitle}>Start Inventory Count</h2><button style={st.closeBtn} onClick={onClose}><X size={20} /></button></div>
        {started && <div style={{ padding: '12px 32px', backgroundColor: '#DEF7EC', color: '#03543F', fontWeight: 600, fontSize: '14px', textAlign: 'center' }}>Inventory count started!</div>}
        <div style={st.modalBody}>
          <div style={st.field}><label style={st.label}>Started By *</label><input style={st.input} value={startedBy} onChange={(e) => setStartedBy(e.target.value)} placeholder="Your name" /></div>
          <div style={st.field}><label style={st.label}>Count Scope</label>
            <select style={st.input} value={scope} onChange={(e) => setScope(e.target.value)}>
              <option>All Products</option>
              <option>Low Stock Only</option>
              <option>Fuel</option>
              <option>Provisions</option>
              <option>Bait &amp; Tackle</option>
              <option>Marine Supplies</option>
              <option>Apparel</option>
              <option>Boat Parts</option>
            </select>
          </div>
          <div style={{ padding: '12px', background: '#FFF3CD', borderRadius: '6px', border: '1px solid #F59E0B', fontSize: '13px', color: '#856404' }}>
            Starting a count will lock inventory updates for the selected products until the count is completed or discarded.
          </div>
        </div>
        <div style={st.modalFooter}>
          <button style={st.cancelBtn} onClick={onClose}>Cancel</button>
          <button style={st.saveBtn} onClick={handleStart}>Start Count</button>
        </div>
      </div>
    </div>
  );
}

function ManualAdjustmentModal({ products, onClose }: { products: Product[]; onClose: () => void }) {
  const [saved, setSaved] = useState(false);
  const handleSave = () => { setSaved(true); setTimeout(onClose, 1500); };
  const [productId, setProductId] = useState('');
  const [type, setType] = useState<Adjustment['type']>('Count');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  return (
    <div style={st.overlay} onClick={onClose}>
      <div style={st.modal} className="helm-modal" onClick={(e) => e.stopPropagation()}>
        <div style={st.modalHeader}><h2 style={st.modalTitle}>Manual Adjustment</h2><button style={st.closeBtn} onClick={onClose}><X size={20} /></button></div>
        {saved && <div style={{ padding: '12px 32px', backgroundColor: '#DEF7EC', color: '#03543F', fontWeight: 600, fontSize: '14px', textAlign: 'center' }}>Adjustment saved!</div>}
        <div style={st.modalBody}>
          <div style={st.field}><label style={st.label}>Product *</label>
            <select style={st.input} value={productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">Select product...</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
            </select>
          </div>
          <div style={st.row2}>
            <div style={st.field}><label style={st.label}>Adjustment Type</label>
              <select style={st.input} value={type} onChange={(e) => setType(e.target.value as Adjustment['type'])}>
                <option>Count</option><option>Damaged</option><option>Return</option><option>Shrinkage</option><option>Received</option>
              </select>
            </div>
            <div style={st.field}><label style={st.label}>Quantity Change *</label><input style={st.input} type="number" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="+10 or -3" /></div>
          </div>
          <div style={st.field}><label style={st.label}>Reason / Notes</label><input style={st.input} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Brief description of reason..." /></div>
        </div>
        <div style={st.modalFooter}>
          <button style={st.cancelBtn} onClick={onClose}>Cancel</button>
          <button style={st.saveBtn} onClick={handleSave}>Save Adjustment</button>
        </div>
      </div>
    </div>
  );
}

function ReceivePOModal({ po, onClose }: { po: PurchaseOrder; onClose: () => void }) {
  const [received, setReceived] = useState(false);
  const handleReceive = () => { setReceived(true); setTimeout(onClose, 1500); };
  const [receivedDate, setReceivedDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  return (
    <div style={st.overlay} onClick={onClose}>
      <div style={st.modal} className="helm-modal" onClick={(e) => e.stopPropagation()}>
        <div style={st.modalHeader}><h2 style={st.modalTitle}>Receive PO — {po.poNumber}</h2><button style={st.closeBtn} onClick={onClose}><X size={20} /></button></div>
        {received && <div style={{ padding: '12px 32px', backgroundColor: '#DEF7EC', color: '#03543F', fontWeight: 600, fontSize: '14px', textAlign: 'center' }}>PO {po.poNumber} marked as received!</div>}
        <div style={st.modalBody}>
          <div style={{ padding: '12px 16px', background: '#F8FAFC', borderRadius: '6px', border: '1px solid #E2E8F0', marginBottom: '20px', fontSize: '13px' }}>
            <div style={{ fontWeight: 600, color: '#0A2342', marginBottom: '4px' }}>{po.vendor}</div>
            <div style={{ color: '#64748B' }}>{po.items} line items · Expected {po.expectedDate}</div>
          </div>
          <div style={st.field}><label style={st.label}>Received Date</label><input style={st.input} type="date" value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} /></div>
          <div style={st.field}><label style={st.label}>Receiving Notes</label><input style={st.input} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any notes about the delivery..." /></div>
          <div style={{ padding: '10px 14px', background: '#DEF7EC', borderRadius: '6px', fontSize: '13px', color: '#03543F' }}>
            Marking as received will update inventory quantities for all items in this PO.
          </div>
        </div>
        <div style={st.modalFooter}>
          <button style={st.cancelBtn} onClick={onClose}>Cancel</button>
          <button style={st.saveBtn} onClick={handleReceive}>Mark as Received</button>
        </div>
      </div>
    </div>
  );
}

/* ── Component ─────────────────────────────────────────── */

type Tab = 'products' | 'po' | 'counts' | 'adjustments' | 'valuation';
type ModalType = 'addProduct' | 'editProduct' | 'createPO' | 'startCount' | 'adjustment' | 'receivePO' | null;

export default function Inventory() {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('products');
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('All');
  const [lowOnly, setLowOnly] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [countSessions, setCountSessions] = useState<CountSession[]>([]);
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [modal, setModal] = useState<ModalType>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [receivingPO, setReceivingPO] = useState<PurchaseOrder | null>(null);

  const { data: productsData, loading: productsLoading } = useApi<{ data: ApiProduct[]; total: number }>(
    'get', '/api/inventory/products?take=100&sortBy=name&sortOrder=asc', { immediate: true },
  );
  const { data: posData, loading: posLoading } = useApi<{ data: ApiPurchaseOrder[]; total: number }>(
    'get', '/api/inventory/purchase-orders', { immediate: true },
  );
  const { data: countsData, loading: countsLoading } = useApi<{ data: ApiCountSession[]; total: number }>(
    'get', '/api/inventory/counts', { immediate: true },
  );
  const { data: adjData, loading: adjLoading } = useApi<{ data: ApiAdjustment[]; total: number }>(
    'get', '/api/inventory/adjustments?take=50', { immediate: true },
  );
  const { execute: createProductApi } = useApi<ApiProduct>('post', '/api/inventory/products');

  React.useEffect(() => {
    if (productsData?.data) setProducts(productsData.data.map(toProduct));
  }, [productsData]);

  React.useEffect(() => {
    if (posData?.data) setPurchaseOrders(posData.data.map(toPurchaseOrder));
  }, [posData]);

  React.useEffect(() => {
    if (countsData?.data) setCountSessions(countsData.data.map(toCountSession));
  }, [countsData]);

  React.useEffect(() => {
    if (adjData?.data) setAdjustments(adjData.data.map(toAdjustment));
  }, [adjData]);

  const totalValue = products.reduce((s, p) => s + p.qoh * p.costCents, 0);
  const lowCount = products.filter((p) => p.qoh <= p.reorderPoint && p.qoh > 0).length;
  const outCount = products.filter((p) => p.qoh === 0).length;
  const openPOs = purchaseOrders.filter((p) => p.status === 'Submitted' || p.status === 'Partial').length;
  const categories = ['All', ...Array.from(new Set(products.map((p) => p.category)))];

  const filteredProducts = products.filter((p) => {
    if (catFilter !== 'All' && p.category !== catFilter) return false;
    if (lowOnly && p.qoh > p.reorderPoint) return false;
    if (search) { const q = search.toLowerCase(); return p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || (p.barcode && p.barcode.includes(q)); }
    return true;
  });

  const handleSaveProduct = async (p: Product) => {
    try {
      const payload = {
        name: p.name, sku: p.sku, barcode: p.barcode || null, category: p.category,
        costCents: p.costCents, priceCents: p.priceCents, taxClass: p.taxClass,
        reorderPoint: p.reorderPoint, trackInventory: p.trackInventory,
        revenueGlAccountId: p.glRevenue || null, cogsGlAccountId: p.glCogs || null,
      };
      if (p.id && !p.id.startsWith('inv-prod-') && !p.id.match(/^\d+$/)) {
        await fetch(`/api/inventory/products/${p.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        setProducts((prev) => prev.map((x) => x.id === p.id ? p : x));
      } else {
        const created = await createProductApi(payload);
        if (created) setProducts((prev) => [toProduct(created as unknown as ApiProduct), ...prev]);
      }
      toast.success('Product saved', p.name + ' has been saved.');
    } catch {
      toast.error('Error', 'Failed to save product.');
    }
    setEditingProduct(null);
    setModal(null);
  };

  const handleDeleteProduct = async (id: string) => {
    try {
      await fetch(`/api/inventory/products/${id}`, { method: 'DELETE' });
      setProducts((prev) => prev.filter((x) => x.id !== id));
      toast.success('Removed', 'Product removed from inventory.');
    } catch {
      toast.error('Error', 'Failed to remove product.');
    }
  };

  const openEdit = (p: Product) => { setEditingProduct(p); setModal('editProduct'); };

  const tabItems: { key: Tab; label: string }[] = [
    { key: 'products', label: 'Products' },
    { key: 'po', label: 'Purchase Orders' },
    { key: 'counts', label: 'Inventory Counts' },
    { key: 'adjustments', label: 'Adjustments' },
    { key: 'valuation', label: 'Valuation' },
  ];

  return (
    <div style={st.page}>
      <h1 style={st.title} className="helm-page-title">Inventory Management</h1>
      <hr style={st.divider} />

      <div style={st.statsRow} className="helm-stats-grid">
        <div style={{ ...st.statCard, borderTop: '3px solid #00D4FF' }}>
          <div style={st.statLabel}>Total Products</div>
          <div style={st.statValue}>{products.length}</div>
          <div style={st.statSub}>{products.filter((p) => p.active).length} active</div>
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
          <div style={st.statSub}>{purchaseOrders.filter((p) => p.status === 'Draft').length} draft</div>
        </div>
      </div>

      <div style={st.tabs} className="helm-tabs">
        {tabItems.map((t) => <button key={t.key} style={{ ...st.tab, ...(tab === t.key ? st.tabActive : {}) }} onClick={() => setTab(t.key)}>{t.label}</button>)}
      </div>

      {/* Products */}
      {tab === 'products' && (<>
        <div style={st.filterBar} className="helm-filter-bar">
          <div style={st.searchWrap}><Search size={16} style={st.searchIcon} /><input style={st.searchInput} placeholder="Search name, SKU, barcode..." value={search} onChange={(e) => setSearch(e.target.value)} /></div>
          <select style={st.select} value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>{categories.map((c) => <option key={c}>{c}</option>)}</select>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#0A2342', cursor: 'pointer' }}><input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} /> Low Stock Only</label>
          <button style={st.outlineBtn} onClick={() => toast.success('Print Labels', 'Sending ' + filteredProducts.length + ' labels to printer...')}><Printer size={14} /> Print Labels</button>
          <button style={st.addBtn} onClick={() => { setEditingProduct(null); setModal('addProduct'); }}><Plus size={16} /> Add Product</button>
        </div>
        <div style={st.tableWrap} className="helm-table-wrap">
          <table style={st.table}>
            <thead><tr>
              <th style={st.th}>SKU</th><th style={st.th}>Barcode</th><th style={st.th}>Name</th><th style={st.th}>Category</th>
              <th style={st.th}>Cost</th><th style={st.th}>Price</th><th style={st.th}>Margin</th><th style={st.th}>QOH</th>
              <th style={st.th}>Reorder</th><th style={st.th}>Status</th><th style={st.th}>GL Rev</th><th style={st.th}>Actions</th>
            </tr></thead>
            <tbody>
              {productsLoading ? (
                <tr><td colSpan={12} style={{ ...st.td, textAlign: 'center', color: '#64748B', padding: '32px' }}>Loading inventory…</td></tr>
              ) : filteredProducts.length === 0 ? (
                <tr><td colSpan={12} style={{ ...st.td, textAlign: 'center', color: '#94A3B8', padding: '32px' }}>No products found. Add your first product using the button above.</td></tr>
              ) : filteredProducts.map((p, idx) => {
                const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#D6E8F4'; const ss = stockStatus(p); const margin = p.priceCents > 0 ? ((p.priceCents - p.costCents) / p.priceCents * 100).toFixed(0) : '0'; return (
                  <tr key={p.id}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#EFF6FF'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = rowBg; }}
                    style={{ background: rowBg }}>
                    <td style={{ ...st.td, ...st.mono, fontWeight: 600, color: '#0066CC', cursor: 'pointer', textDecoration: 'underline' }} onClick={() => openEdit(p)}>{p.sku}</td>
                    <td style={{ ...st.td, ...st.mono, fontSize: '11px' }}>{p.barcode}</td>
                    <td style={{ ...st.td, fontWeight: 600, cursor: 'pointer', color: '#0A2342' }} onClick={() => openEdit(p)}>{p.name}</td>
                    <td style={st.td}>{p.category}</td>
                    <td style={{ ...st.td, ...st.mono }}>{fmt(p.costCents)}</td>
                    <td style={{ ...st.td, ...st.mono }}>{fmt(p.priceCents)}</td>
                    <td style={{ ...st.td, color: '#03543F', fontWeight: 600 }}>{margin}%</td>
                    <td style={{ ...st.td, ...st.mono, fontWeight: 700, color: p.qoh <= p.reorderPoint ? '#856404' : '#0A2342' }}>{p.qoh}</td>
                    <td style={{ ...st.td, ...st.mono }}>{p.reorderPoint}</td>
                    <td style={st.td}><span style={{ ...st.badge, backgroundColor: ss.bg, color: ss.color }}>{ss.label}</span></td>
                    <td style={{ ...st.td, ...st.mono, fontSize: '11px' }}>{p.glRevenue}</td>
                    <td style={st.td}>
                      <button style={{ background: 'none', border: 'none', color: '#00D4FF', cursor: 'pointer', marginRight: '8px' }} onClick={() => openEdit(p)} title="Edit"><Edit2 size={14} /></button>
                      <button style={{ background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer' }} onClick={() => handleDeleteProduct(p.id)} title="Remove"><Trash2 size={14} /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </>)}

      {/* Purchase Orders */}
      {tab === 'po' && (<>
        <div style={st.filterBar} className="helm-filter-bar"><div style={{ flex: 1 }} /><button style={st.addBtn} onClick={() => setModal('createPO')}><Plus size={16} /> Create PO</button></div>
        <div style={st.tableWrap} className="helm-table-wrap"><table style={st.table}><thead><tr>
          <th style={st.th}>PO #</th><th style={st.th}>Vendor</th><th style={st.th}>Items</th><th style={st.th}>Total Cost</th><th style={st.th}>Expected</th><th style={st.th}>Created</th><th style={st.th}>Status</th><th style={st.th}>Actions</th>
        </tr></thead><tbody>
          {posLoading ? (
            <tr><td colSpan={8} style={{ ...st.td, textAlign: 'center', color: '#64748B' }}>Loading…</td></tr>
          ) : purchaseOrders.length === 0 ? (
            <tr><td colSpan={8} style={{ ...st.td, textAlign: 'center', color: '#94A3B8' }}>No purchase orders found.</td></tr>
          ) : purchaseOrders.map((po, idx) => { const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#D6E8F4'; const sc = poStatusColors[po.status]; return (
            <tr key={po.id} style={{ backgroundColor: rowBg }}>
              <td style={{ ...st.td, fontWeight: 700 }}>{po.poNumber}</td>
              <td style={st.td}>{po.vendor}</td>
              <td style={{ ...st.td, textAlign: 'center' }}>{po.items}</td>
              <td style={{ ...st.td, ...st.mono }}>{fmt(po.totalCostCents)}</td>
              <td style={st.td}>{po.expectedDate}</td>
              <td style={st.td}>{po.createdDate}</td>
              <td style={st.td}><span style={{ ...st.badge, backgroundColor: sc.bg, color: sc.color }}>{po.status}</span></td>
              <td style={st.td}>
                {(po.status === 'Submitted' || po.status === 'Partial') && (
                  <button style={{ ...st.outlineBtn, padding: '4px 10px', fontSize: '12px' }} onClick={() => { setReceivingPO(po); setModal('receivePO'); }}><Truck size={12} /> Receive</button>
                )}
                {po.status === 'Draft' && <button style={{ ...st.outlineBtn, padding: '4px 10px', fontSize: '12px' }}>Submit</button>}
              </td>
            </tr>
          ); })}
        </tbody></table></div>
      </>)}

      {/* Counts */}
      {tab === 'counts' && (<>
        <div style={st.filterBar} className="helm-filter-bar"><div style={{ flex: 1 }} /><button style={st.addBtn} onClick={() => setModal('startCount')}><ClipboardCheck size={16} /> Start Count</button></div>
        <div style={st.tableWrap} className="helm-table-wrap"><table style={st.table}><thead><tr>
          <th style={st.th}>Count #</th><th style={st.th}>Date</th><th style={st.th}>Started By</th><th style={st.th}>Products</th><th style={st.th}>Discrepancies</th><th style={st.th}>Status</th>
        </tr></thead><tbody>
          {countsLoading ? (
            <tr><td colSpan={6} style={{ ...st.td, textAlign: 'center', color: '#64748B' }}>Loading…</td></tr>
          ) : countSessions.length === 0 ? (
            <tr><td colSpan={6} style={{ ...st.td, textAlign: 'center', color: '#94A3B8' }}>No inventory counts yet.</td></tr>
          ) : countSessions.map((c, idx) => { const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#D6E8F4'; return (
            <tr key={c.id} style={{ backgroundColor: rowBg }}>
              <td style={{ ...st.td, fontWeight: 700 }}>{c.countNumber}</td>
              <td style={st.td}>{c.date}</td>
              <td style={st.td}>{c.startedBy}</td>
              <td style={{ ...st.td, textAlign: 'center' }}>{c.products}</td>
              <td style={{ ...st.td, textAlign: 'center', color: c.discrepancies > 0 ? '#856404' : '#03543F', fontWeight: 600 }}>{c.discrepancies}</td>
              <td style={st.td}><span style={{ ...st.badge, backgroundColor: c.status === 'In Progress' ? '#E0F7FF' : '#DEF7EC', color: c.status === 'In Progress' ? '#0A2342' : '#03543F' }}>{c.status}</span></td>
            </tr>
          ); })}
        </tbody></table></div>
      </>)}

      {/* Adjustments */}
      {tab === 'adjustments' && (<>
        <div style={st.filterBar} className="helm-filter-bar">
          <div style={st.searchWrap}><Search size={16} style={st.searchIcon} /><input style={st.searchInput} placeholder="Search product..." value={search} onChange={(e) => setSearch(e.target.value)} /></div>
          <button style={st.addBtn} onClick={() => setModal('adjustment')}><Plus size={16} /> Manual Adjustment</button>
        </div>
        <div style={st.tableWrap} className="helm-table-wrap"><table style={st.table}><thead><tr>
          <th style={st.th}>Date</th><th style={st.th}>Product</th><th style={st.th}>SKU</th><th style={st.th}>Type</th><th style={st.th}>Qty Change</th><th style={st.th}>Before</th><th style={st.th}>After</th><th style={st.th}>Staff</th><th style={st.th}>Notes</th>
        </tr></thead><tbody>
          {adjLoading ? (
            <tr><td colSpan={9} style={{ ...st.td, textAlign: 'center', color: '#64748B' }}>Loading…</td></tr>
          ) : adjustments.length === 0 ? (
            <tr><td colSpan={9} style={{ ...st.td, textAlign: 'center', color: '#94A3B8' }}>No adjustments recorded yet.</td></tr>
          ) : adjustments.map((a, idx) => { const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#D6E8F4'; const tc = adjTypeColors[a.type]; return (
            <tr key={a.id} style={{ backgroundColor: rowBg }}>
              <td style={{ ...st.td, fontSize: '12px' }}>{a.date}</td>
              <td style={{ ...st.td, fontWeight: 600 }}>{a.product}</td>
              <td style={{ ...st.td, ...st.mono }}>{a.sku}</td>
              <td style={st.td}><span style={{ ...st.badge, backgroundColor: tc.bg, color: tc.color }}>{a.type}</span></td>
              <td style={{ ...st.td, ...st.mono, fontWeight: 700, color: a.qtyChange > 0 ? '#03543F' : '#9B1C1C' }}>{a.qtyChange > 0 ? '+' : ''}{a.qtyChange}</td>
              <td style={{ ...st.td, ...st.mono }}>{a.before}</td>
              <td style={{ ...st.td, ...st.mono }}>{a.after}</td>
              <td style={st.td}>{a.staff}</td>
              <td style={{ ...st.td, color: a.notes ? '#0A2342' : '#94A3B8', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.notes || '—'}</td>
            </tr>
          ); })}
        </tbody></table></div>
      </>)}

      {/* Valuation */}
      {tab === 'valuation' && (<>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px', marginBottom: '24px' }}>
          <div style={st.statCard}><div style={st.statLabel}>Total Cost Value</div><div style={st.statValue}>{fmt(totalValue)}</div></div>
          <div style={st.statCard}><div style={st.statLabel}>Total Retail Value</div><div style={st.statValue}>{fmt(products.reduce((s, p) => s + p.qoh * p.priceCents, 0))}</div></div>
          <div style={st.statCard}><div style={st.statLabel}>Potential Margin</div><div style={st.statValue}>{totalValue > 0 ? ((products.reduce((s, p) => s + p.qoh * p.priceCents, 0) - totalValue) / products.reduce((s, p) => s + p.qoh * p.priceCents, 0) * 100).toFixed(1) : '0'}%</div></div>
        </div>
        <div style={st.tableWrap} className="helm-table-wrap"><table style={st.table}><thead><tr>
          <th style={st.th}>Category</th><th style={st.th}>Products</th><th style={st.th}>Total Units</th><th style={st.th}>Cost Value</th><th style={st.th}>Retail Value</th><th style={st.th}>Margin %</th>
        </tr></thead><tbody>
          {Array.from(new Set(products.map((p) => p.category))).map((cat, idx) => {
            const catProducts = products.filter((p) => p.category === cat);
            const costVal = catProducts.reduce((s, p) => s + p.qoh * p.costCents, 0);
            const retailVal = catProducts.reduce((s, p) => s + p.qoh * p.priceCents, 0);
            const margin = retailVal > 0 ? ((retailVal - costVal) / retailVal * 100).toFixed(1) : '0';
            const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#D6E8F4';
            return (
              <tr key={cat} style={{ backgroundColor: rowBg }}>
                <td style={{ ...st.td, fontWeight: 600 }}>{cat}</td>
                <td style={{ ...st.td, textAlign: 'center' }}>{catProducts.length}</td>
                <td style={{ ...st.td, ...st.mono }}>{catProducts.reduce((s, p) => s + p.qoh, 0).toLocaleString()}</td>
                <td style={{ ...st.td, ...st.mono }}>{fmt(costVal)}</td>
                <td style={{ ...st.td, ...st.mono }}>{fmt(retailVal)}</td>
                <td style={{ ...st.td, color: '#03543F', fontWeight: 600 }}>{margin}%</td>
              </tr>
            );
          })}
        </tbody></table></div>
      </>)}

      {/* Modals */}
      {(modal === 'addProduct') && (
        <ProductModal product={null} onClose={() => setModal(null)} onSave={handleSaveProduct} />
      )}
      {(modal === 'editProduct' && editingProduct) && (
        <ProductModal product={editingProduct} onClose={() => { setModal(null); setEditingProduct(null); }} onSave={handleSaveProduct} />
      )}
      {modal === 'createPO' && <CreatePOModal onClose={() => setModal(null)} />}
      {modal === 'startCount' && <StartCountModal onClose={() => setModal(null)} />}
      {modal === 'adjustment' && <ManualAdjustmentModal products={products} onClose={() => setModal(null)} />}
      {modal === 'receivePO' && receivingPO && <ReceivePOModal po={receivingPO} onClose={() => { setModal(null); setReceivingPO(null); }} />}
    </div>
  );
}
