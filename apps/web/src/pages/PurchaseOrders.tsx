import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { api } from '../lib/api';
import {
  Plus, Search, ChevronRight, ChevronDown, Package, Truck,
  CheckCircle2, Clock, AlertTriangle, X, Save, RefreshCw,
  FileText, MapPin, Building2,
} from 'lucide-react';

/* ─────────────────────────────────────────────────────────────────
   Types
───────────────────────────────────────────────────────────────── */

type POStatus = 'DRAFT' | 'SUBMITTED' | 'PARTIAL' | 'RECEIVED' | 'CANCELLED';

interface POItem {
  id: string;
  productId: string;
  quantityOrdered: number;
  quantityReceived: number;
  unitCostCents: number;
  extendedCents: number;
  product: { id: string; name: string; sku: string; costCents?: number; costingMethod?: string };
}

interface PurchaseOrder {
  id: string;
  status: POStatus;
  vendorName?: string;
  expectedDate?: string;
  notes?: string;
  totalCents: number;
  createdAt: string;
  location: { id: string; name: string };
  items: POItem[];
  receipts?: Receipt[];
}

interface Receipt {
  id: string;
  receivedAt: string;
  notes?: string;
  glJournalId?: string;
  items: { id: string; productId: string; quantityReceived: number; unitCostCents: number; product: { name: string } }[];
}

interface Product {
  id: string;
  name: string;
  sku: string;
  costCents?: number;
}

/* ─────────────────────────────────────────────────────────────────
   Constants
───────────────────────────────────────────────────────────────── */

const LOCATIONS = [
  { id: 'loc-main', name: 'Main Dock' },
  { id: 'loc-fuel', name: 'Fuel Dock' },
  { id: 'loc-rental', name: 'Rental Center' },
];

const STATUS_CONFIG: Record<POStatus, { label: string; bg: string; color: string; icon: React.ReactNode }> = {
  DRAFT:     { label: 'Draft',     bg: '#F1F5F9', color: '#475569', icon: <FileText size={12} /> },
  SUBMITTED: { label: 'Submitted', bg: '#FFF7ED', color: '#EA580C', icon: <Clock size={12} /> },
  PARTIAL:   { label: 'Partial',   bg: '#FFF9C2', color: '#92400E', icon: <Truck size={12} /> },
  RECEIVED:  { label: 'Received',  bg: '#F0FDF4', color: '#16A34A', icon: <CheckCircle2 size={12} /> },
  CANCELLED: { label: 'Cancelled', bg: '#FFF1F0', color: '#DC2626', icon: <X size={12} /> },
};

/* ─────────────────────────────────────────────────────────────────
   Mock data
───────────────────────────────────────────────────────────────── */

const MOCK_PRODUCTS: Product[] = [
  { id: 'prod-1', name: 'Regular Gas (gal)', sku: 'FUEL-REG', costCents: 365 },
  { id: 'prod-2', name: 'Diesel (gal)', sku: 'FUEL-DSL', costCents: 410 },
  { id: 'prod-3', name: 'Premium Gas (gal)', sku: 'FUEL-PRM', costCents: 408 },
  { id: 'prod-4', name: 'Bottled Water', sku: 'SNK-WTR', costCents: 89 },
  { id: 'prod-5', name: 'Bag of Ice (10lb)', sku: 'ICE-10LB', costCents: 199 },
  { id: 'prod-6', name: 'Sunscreen SPF 50', sku: 'SUN-SPF', costCents: 699 },
  { id: 'prod-7', name: 'Dock Line 3/8" 15\'', sku: 'MRN-LINE', costCents: 999 },
  { id: 'prod-8', name: 'Marina Cap', sku: 'APR-HAT', costCents: 800 },
];

const MOCK_POS: PurchaseOrder[] = [
  {
    id: 'po-1', status: 'PARTIAL', vendorName: 'Gulf Coast Petroleum', totalCents: 2195000,
    expectedDate: '2026-04-28', createdAt: '2026-04-22T10:00:00Z',
    location: { id: 'loc-fuel', name: 'Fuel Dock' },
    items: [
      { id: 'poi-1', productId: 'prod-1', quantityOrdered: 3000, quantityReceived: 1500, unitCostCents: 365, extendedCents: 1095000, product: { id: 'prod-1', name: 'Regular Gas (gal)', sku: 'FUEL-REG', costingMethod: 'FIFO' } },
      { id: 'poi-2', productId: 'prod-2', quantityOrdered: 2500, quantityReceived: 2500, unitCostCents: 410, extendedCents: 1025000, product: { id: 'prod-2', name: 'Diesel (gal)', sku: 'FUEL-DSL', costingMethod: 'FIFO' } },
      { id: 'poi-3', productId: 'prod-3', quantityOrdered: 200, quantityReceived: 0, unitCostCents: 408, extendedCents: 81600, product: { id: 'prod-3', name: 'Premium Gas (gal)', sku: 'FUEL-PRM', costingMethod: 'FIFO' } },
    ],
    receipts: [],
  },
  {
    id: 'po-2', status: 'DRAFT', vendorName: 'Marine Supply Distributors', totalCents: 89500,
    expectedDate: '2026-05-05', createdAt: '2026-04-30T14:00:00Z',
    location: { id: 'loc-main', name: 'Main Dock' },
    items: [
      { id: 'poi-4', productId: 'prod-4', quantityOrdered: 144, quantityReceived: 0, unitCostCents: 89, extendedCents: 12816, product: { id: 'prod-4', name: 'Bottled Water', sku: 'SNK-WTR', costingMethod: 'WAC' } },
      { id: 'poi-5', productId: 'prod-6', quantityOrdered: 48, quantityReceived: 0, unitCostCents: 699, extendedCents: 33552, product: { id: 'prod-6', name: 'Sunscreen SPF 50', sku: 'SUN-SPF', costingMethod: 'WAC' } },
      { id: 'poi-6', productId: 'prod-7', quantityOrdered: 24, quantityReceived: 0, unitCostCents: 999, extendedCents: 23976, product: { id: 'prod-7', name: 'Dock Line', sku: 'MRN-LINE', costingMethod: 'WAC' } },
    ],
    receipts: [],
  },
  {
    id: 'po-3', status: 'RECEIVED', vendorName: 'Coastal Provisions Co.', totalCents: 45000,
    expectedDate: '2026-04-15', createdAt: '2026-04-10T09:00:00Z',
    location: { id: 'loc-main', name: 'Main Dock' },
    items: [
      { id: 'poi-7', productId: 'prod-4', quantityOrdered: 96, quantityReceived: 96, unitCostCents: 89, extendedCents: 8544, product: { id: 'prod-4', name: 'Bottled Water', sku: 'SNK-WTR', costingMethod: 'WAC' } },
      { id: 'poi-8', productId: 'prod-5', quantityOrdered: 60, quantityReceived: 60, unitCostCents: 199, extendedCents: 11940, product: { id: 'prod-5', name: 'Bag of Ice', sku: 'ICE-10LB', costingMethod: 'WAC' } },
    ],
    receipts: [],
  },
];

/* ─────────────────────────────────────────────────────────────────
   Helpers
───────────────────────────────────────────────────────────────── */

function cents(n: number) {
  return `$${(n / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
}

function StatusBadge({ status }: { status: POStatus }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '3px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: 600, background: cfg.bg, color: cfg.color }}>
      {cfg.icon} {cfg.label}
    </span>
  );
}

/* ─────────────────────────────────────────────────────────────────
   Receive Modal
───────────────────────────────────────────────────────────────── */

function ReceiveModal({
  po,
  onClose,
  onReceived,
}: {
  po: PurchaseOrder;
  onClose: () => void;
  onReceived: (poId: string) => void;
}) {
  const { getToken } = useAuth();
  const [qtys, setQtys] = useState<Record<string, number>>(
    Object.fromEntries(
      po.items
        .filter((i) => i.quantityReceived < i.quantityOrdered)
        .map((i) => [i.id, i.quantityOrdered - i.quantityReceived])
    )
  );
  const [costs, setCosts] = useState<Record<string, number>>(
    Object.fromEntries(po.items.map((i) => [i.id, i.unitCostCents]))
  );
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pendingItems = po.items.filter((i) => i.quantityReceived < i.quantityOrdered);

  async function handleSubmit() {
    const items = pendingItems
      .filter((i) => (qtys[i.id] ?? 0) > 0)
      .map((i) => ({
        purchaseOrderItemId: i.id,
        quantityReceived: qtys[i.id] ?? 0,
        unitCostCents: costs[i.id] ?? i.unitCostCents,
      }));

    if (items.length === 0) { setError('Enter at least one quantity to receive.'); return; }

    setSaving(true);
    setError(null);
    try {
      const token = await getToken();
      await api.post(`/purchase-orders/${po.id}/receive`, { items, notes: notes || undefined }, token);
      onReceived(po.id);
      onClose();
    } catch (err: any) {
      setError(err?.message ?? 'Failed to record receipt');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: '#FFFFFF', borderRadius: '12px', padding: '28px', width: '640px', maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#0A2342' }}>Receive Inventory</h3>
            <div style={{ fontSize: '13px', color: '#64748B', marginTop: '2px' }}>{po.vendorName} — {po.location.name}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B' }}><X size={20} /></button>
        </div>

        {error && (
          <div style={{ padding: '10px 14px', background: '#FFF1F0', border: '1px solid #FECACA', borderRadius: '6px', marginBottom: '16px', fontSize: '13px', color: '#DC2626' }}>
            {error}
          </div>
        )}

        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '16px' }}>
          <thead>
            <tr style={{ background: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
              {['Item', 'Method', 'Ordered', 'Prev. Recd', 'Receive Qty', 'Unit Cost'].map((h) => (
                <th key={h} style={{ padding: '8px 10px', fontSize: '11px', fontWeight: 600, color: '#64748B', textAlign: 'left', textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pendingItems.map((item) => (
              <tr key={item.id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                <td style={{ padding: '10px', fontSize: '13px', fontWeight: 500, color: '#0A2342' }}>
                  {item.product.name}
                  <div style={{ fontSize: '11px', color: '#94A3B8', fontFamily: 'monospace' }}>{item.product.sku}</div>
                </td>
                <td style={{ padding: '10px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 600, padding: '2px 6px', borderRadius: '4px', background: item.product.costingMethod === 'FIFO' ? '#FFF9C2' : '#F0F9FF', color: item.product.costingMethod === 'FIFO' ? '#92400E' : '#0369A1' }}>
                    {item.product.costingMethod ?? 'WAC'}
                  </span>
                </td>
                <td style={{ padding: '10px', fontSize: '13px', color: '#64748B' }}>{item.quantityOrdered.toLocaleString()}</td>
                <td style={{ padding: '10px', fontSize: '13px', color: '#64748B' }}>{item.quantityReceived.toLocaleString()}</td>
                <td style={{ padding: '10px' }}>
                  <input
                    type="number"
                    min={0}
                    max={item.quantityOrdered - item.quantityReceived}
                    value={qtys[item.id] ?? 0}
                    onChange={(e) => setQtys((p) => ({ ...p, [item.id]: Math.min(+e.target.value, item.quantityOrdered - item.quantityReceived) }))}
                    style={{ width: '80px', padding: '6px 8px', fontSize: '13px', border: '1px solid #E2E8F0', borderRadius: '5px', outline: 'none' }}
                  />
                </td>
                <td style={{ padding: '10px' }}>
                  <input
                    type="number"
                    step={0.01}
                    value={((costs[item.id] ?? item.unitCostCents) / 100).toFixed(2)}
                    onChange={(e) => setCosts((p) => ({ ...p, [item.id]: Math.round(+e.target.value * 100) }))}
                    style={{ width: '90px', padding: '6px 8px', fontSize: '13px', border: '1px solid #E2E8F0', borderRadius: '5px', outline: 'none' }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ marginBottom: '20px' }}>
          <label style={{ fontSize: '12px', fontWeight: 600, color: '#64748B', display: 'block', marginBottom: '4px' }}>Notes (optional)</label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. Delivery ref #12345"
            style={{ width: '100%', padding: '8px 10px', fontSize: '13px', border: '1px solid #E2E8F0', borderRadius: '6px', outline: 'none', boxSizing: 'border-box' }}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button onClick={onClose} style={{ padding: '9px 20px', fontSize: '14px', fontWeight: 500, background: '#F1F5F9', border: '1px solid #E2E8F0', borderRadius: '6px', cursor: 'pointer', color: '#0A2342' }}>
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '9px 20px', fontSize: '14px', fontWeight: 600, background: '#0A2342', border: 'none', borderRadius: '6px', cursor: 'pointer', color: '#FFFFFF' }}
          >
            <Truck size={15} />
            {saving ? 'Recording…' : 'Record Receipt + Post GL'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   Create PO Modal
───────────────────────────────────────────────────────────────── */

function CreatePOModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { getToken } = useAuth();
  const [locationId, setLocationId] = useState(LOCATIONS[0].id);
  const [vendorName, setVendorName] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState([{ productId: '', quantityOrdered: 1, unitCostCents: 0 }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addLine() {
    setLines((p) => [...p, { productId: '', quantityOrdered: 1, unitCostCents: 0 }]);
  }

  function removeLine(i: number) {
    setLines((p) => p.filter((_, idx) => idx !== i));
  }

  async function handleCreate() {
    if (!lines.every((l) => l.productId && l.quantityOrdered > 0 && l.unitCostCents > 0)) {
      setError('All line items require a product, quantity, and unit cost.'); return;
    }
    setSaving(true);
    setError(null);
    try {
      const token = await getToken();
      await api.post('/purchase-orders', { locationId, vendorName: vendorName || undefined, expectedDate: expectedDate || undefined, notes: notes || undefined, items: lines }, token);
      onCreated();
      onClose();
    } catch (err: any) {
      setError(err?.message ?? 'Failed to create purchase order');
    } finally {
      setSaving(false);
    }
  }

  const total = lines.reduce((s, l) => s + l.quantityOrdered * l.unitCostCents, 0);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: '#FFFFFF', borderRadius: '12px', padding: '28px', width: '700px', maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#0A2342' }}>Create Purchase Order</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B' }}><X size={20} /></button>
        </div>

        {error && (
          <div style={{ padding: '10px 14px', background: '#FFF1F0', border: '1px solid #FECACA', borderRadius: '6px', marginBottom: '16px', fontSize: '13px', color: '#DC2626' }}>{error}</div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
          <div>
            <label style={{ fontSize: '12px', fontWeight: 600, color: '#64748B', display: 'block', marginBottom: '4px' }}>Location</label>
            <select value={locationId} onChange={(e) => setLocationId(e.target.value)} style={{ width: '100%', padding: '8px 10px', fontSize: '13px', border: '1px solid #E2E8F0', borderRadius: '6px', background: '#FFFFFF', outline: 'none', boxSizing: 'border-box' as const }}>
              {LOCATIONS.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: '12px', fontWeight: 600, color: '#64748B', display: 'block', marginBottom: '4px' }}>Vendor Name</label>
            <input value={vendorName} onChange={(e) => setVendorName(e.target.value)} placeholder="e.g. Gulf Coast Petroleum" style={{ width: '100%', padding: '8px 10px', fontSize: '13px', border: '1px solid #E2E8F0', borderRadius: '6px', outline: 'none', boxSizing: 'border-box' as const }} />
          </div>
          <div>
            <label style={{ fontSize: '12px', fontWeight: 600, color: '#64748B', display: 'block', marginBottom: '4px' }}>Expected Delivery</label>
            <input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} style={{ width: '100%', padding: '8px 10px', fontSize: '13px', border: '1px solid #E2E8F0', borderRadius: '6px', outline: 'none', boxSizing: 'border-box' as const }} />
          </div>
          <div>
            <label style={{ fontSize: '12px', fontWeight: 600, color: '#64748B', display: 'block', marginBottom: '4px' }}>Notes</label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes" style={{ width: '100%', padding: '8px 10px', fontSize: '13px', border: '1px solid #E2E8F0', borderRadius: '6px', outline: 'none', boxSizing: 'border-box' as const }} />
          </div>
        </div>

        <div style={{ marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: '13px', fontWeight: 600, color: '#0A2342' }}>Line Items</div>
          <button onClick={addLine} style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '5px 12px', fontSize: '12px', fontWeight: 600, background: '#F1F5F9', border: '1px solid #E2E8F0', borderRadius: '5px', cursor: 'pointer', color: '#0A2342' }}>
            <Plus size={13} /> Add Line
          </button>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '16px' }}>
          <thead>
            <tr style={{ background: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
              {['Product', 'Qty', 'Unit Cost', 'Extended', ''].map((h) => (
                <th key={h} style={{ padding: '7px 10px', fontSize: '11px', fontWeight: 600, color: '#64748B', textAlign: 'left', textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map((line, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #F1F5F9' }}>
                <td style={{ padding: '6px 8px' }}>
                  <select
                    value={line.productId}
                    onChange={(e) => {
                      const prod = MOCK_PRODUCTS.find((p) => p.id === e.target.value);
                      setLines((p) => p.map((l, idx) => idx === i ? { ...l, productId: e.target.value, unitCostCents: prod?.costCents ?? l.unitCostCents } : l));
                    }}
                    style={{ width: '200px', padding: '6px 8px', fontSize: '13px', border: '1px solid #E2E8F0', borderRadius: '5px', outline: 'none' }}
                  >
                    <option value="">Select product…</option>
                    {MOCK_PRODUCTS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </td>
                <td style={{ padding: '6px 8px' }}>
                  <input type="number" min={1} value={line.quantityOrdered} onChange={(e) => setLines((p) => p.map((l, idx) => idx === i ? { ...l, quantityOrdered: +e.target.value } : l))} style={{ width: '70px', padding: '6px 8px', fontSize: '13px', border: '1px solid #E2E8F0', borderRadius: '5px', outline: 'none' }} />
                </td>
                <td style={{ padding: '6px 8px' }}>
                  <input type="number" step={0.01} value={(line.unitCostCents / 100).toFixed(2)} onChange={(e) => setLines((p) => p.map((l, idx) => idx === i ? { ...l, unitCostCents: Math.round(+e.target.value * 100) } : l))} style={{ width: '90px', padding: '6px 8px', fontSize: '13px', border: '1px solid #E2E8F0', borderRadius: '5px', outline: 'none' }} />
                </td>
                <td style={{ padding: '6px 8px', fontSize: '13px', color: '#0A2342', fontFamily: 'monospace' }}>
                  {cents(line.quantityOrdered * line.unitCostCents)}
                </td>
                <td style={{ padding: '6px 8px' }}>
                  {lines.length > 1 && <button onClick={() => removeLine(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#DC2626' }}><X size={14} /></button>}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: '2px solid #E2E8F0' }}>
              <td colSpan={3} style={{ padding: '8px 10px', fontSize: '13px', fontWeight: 600, color: '#64748B', textAlign: 'right' }}>Total:</td>
              <td style={{ padding: '8px 10px', fontSize: '14px', fontWeight: 700, color: '#0A2342', fontFamily: 'monospace' }}>{cents(total)}</td>
              <td />
            </tr>
          </tfoot>
        </table>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button onClick={onClose} style={{ padding: '9px 20px', fontSize: '14px', fontWeight: 500, background: '#F1F5F9', border: '1px solid #E2E8F0', borderRadius: '6px', cursor: 'pointer', color: '#0A2342' }}>Cancel</button>
          <button onClick={handleCreate} disabled={saving} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '9px 20px', fontSize: '14px', fontWeight: 600, background: '#0A2342', border: 'none', borderRadius: '6px', cursor: 'pointer', color: '#FFFFFF' }}>
            <Save size={15} /> {saving ? 'Creating…' : 'Create Draft PO'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   Main Page
───────────────────────────────────────────────────────────────── */

export default function PurchaseOrders() {
  const { getToken } = useAuth();
  const [orders, setOrders] = useState<PurchaseOrder[]>(MOCK_POS);
  const [loading, setLoading] = useState(false);
  const [locationFilter, setLocationFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<POStatus | ''>('');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [receivingPO, setReceivingPO] = useState<PurchaseOrder | null>(null);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getToken();
      const params = new URLSearchParams();
      if (locationFilter) params.set('locationId', locationFilter);
      if (statusFilter) params.set('status', statusFilter);
      const data = await api.get<PurchaseOrder[]>(`/purchase-orders?${params}`, token);
      setOrders(data ?? MOCK_POS);
    } catch {
      // keep mock data on error
    } finally {
      setLoading(false);
    }
  }, [getToken, locationFilter, statusFilter]);

  useEffect(() => { loadOrders(); }, [loadOrders]);

  async function handleSubmitPO(id: string) {
    try {
      const token = await getToken();
      await api.post(`/purchase-orders/${id}/submit`, {}, token);
      setOrders((prev) => prev.map((o) => o.id === id ? { ...o, status: 'SUBMITTED' as POStatus } : o));
    } catch {}
  }

  const filtered = orders.filter((o) => {
    if (search && !(o.vendorName ?? '').toLowerCase().includes(search.toLowerCase()) && !o.id.includes(search)) return false;
    return true;
  });

  const stats = {
    draft: orders.filter((o) => o.status === 'DRAFT').length,
    submitted: orders.filter((o) => o.status === 'SUBMITTED').length,
    partial: orders.filter((o) => o.status === 'PARTIAL').length,
    totalValue: orders.filter((o) => !['RECEIVED', 'CANCELLED'].includes(o.status)).reduce((s, o) => s + o.totalCents, 0),
  };

  return (
    <div style={{ fontFamily: 'inherit', maxWidth: '1200px' }}>
      {/* Modals */}
      {showCreate && <CreatePOModal onClose={() => setShowCreate(false)} onCreated={loadOrders} />}
      {receivingPO && (
        <ReceiveModal
          po={receivingPO}
          onClose={() => setReceivingPO(null)}
          onReceived={(id) => {
            setOrders((prev) => prev.map((o) => o.id === id ? { ...o, status: 'PARTIAL' as POStatus } : o));
          }}
        />
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#0A2342', margin: 0 }}>Purchase Orders</h1>
          <p style={{ fontSize: '14px', color: '#64748B', marginTop: '4px' }}>Receive inventory, capture FIFO/WAC costs, and auto-post GL journal entries.</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          style={{ display: 'flex', alignItems: 'center', gap: '7px', padding: '10px 20px', fontSize: '14px', fontWeight: 600, background: '#0A2342', border: 'none', borderRadius: '7px', cursor: 'pointer', color: '#FFFFFF' }}
        >
          <Plus size={16} /> New Purchase Order
        </button>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '24px' }}>
        {[
          { label: 'Draft', value: stats.draft, bg: '#F8FAFC', color: '#475569' },
          { label: 'Submitted', value: stats.submitted, bg: '#FFF7ED', color: '#EA580C' },
          { label: 'Partially Received', value: stats.partial, bg: '#FFF9C2', color: '#92400E' },
          { label: 'Open Order Value', value: cents(stats.totalValue), bg: '#F0F9FF', color: '#0369A1' },
        ].map((s) => (
          <div key={s.label} style={{ background: s.bg, border: '1px solid #E2E8F0', borderRadius: '10px', padding: '16px 20px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '6px' }}>{s.label}</div>
            <div style={{ fontSize: '22px', fontWeight: 700, color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 200px' }}>
          <Search size={15} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search vendor or PO ID…"
            style={{ width: '100%', paddingLeft: '32px', padding: '8px 10px 8px 32px', fontSize: '13px', border: '1px solid #E2E8F0', borderRadius: '6px', outline: 'none', boxSizing: 'border-box' }}
          />
        </div>
        <select value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)} style={{ padding: '8px 10px', fontSize: '13px', border: '1px solid #E2E8F0', borderRadius: '6px', background: '#FFFFFF', outline: 'none', cursor: 'pointer' }}>
          <option value="">All Locations</option>
          {LOCATIONS.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as POStatus | '')} style={{ padding: '8px 10px', fontSize: '13px', border: '1px solid #E2E8F0', borderRadius: '6px', background: '#FFFFFF', outline: 'none', cursor: 'pointer' }}>
          <option value="">All Statuses</option>
          {(Object.keys(STATUS_CONFIG) as POStatus[]).map((s) => <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>)}
        </select>
        <button onClick={loadOrders} disabled={loading} style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '8px 14px', fontSize: '13px', fontWeight: 500, background: '#F1F5F9', border: '1px solid #E2E8F0', borderRadius: '6px', cursor: 'pointer', color: '#0A2342' }}>
          <RefreshCw size={13} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} /> Refresh
        </button>
      </div>

      {/* PO List */}
      <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '10px', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#0A2342', borderBottom: '2px solid #00D4FF' }}>
              {['', 'Vendor', 'Location', 'Status', 'Items', 'Total', 'Expected', 'Created', 'Actions'].map((h) => (
                <th key={h} style={{ padding: '10px 14px', fontSize: '12px', fontWeight: 600, color: '#FFFFFF', textAlign: 'left', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((po, idx) => {
              const isExpanded = expandedId === po.id;
              const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC';
              return (
                <React.Fragment key={po.id}>
                  <tr style={{ borderBottom: '1px solid #F1F5F9', background: rowBg }}>
                    <td style={{ padding: '12px 14px', width: '32px' }}>
                      <button onClick={() => setExpandedId(isExpanded ? null : po.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B', display: 'flex', alignItems: 'center' }}>
                        {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      </button>
                    </td>
                    <td style={{ padding: '12px 14px', fontSize: '14px', fontWeight: 600, color: '#0A2342' }}>
                      {po.vendorName ?? '—'}
                      <div style={{ fontSize: '11px', color: '#94A3B8', fontFamily: 'monospace', marginTop: '1px' }}>{po.id.toUpperCase()}</div>
                    </td>
                    <td style={{ padding: '12px 14px', fontSize: '13px', color: '#64748B' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <MapPin size={12} /> {po.location.name}
                      </span>
                    </td>
                    <td style={{ padding: '12px 14px' }}><StatusBadge status={po.status} /></td>
                    <td style={{ padding: '12px 14px', fontSize: '13px', color: '#64748B' }}>{po.items.length}</td>
                    <td style={{ padding: '12px 14px', fontSize: '13px', fontFamily: 'monospace', color: '#0A2342', fontWeight: 600 }}>{cents(po.totalCents)}</td>
                    <td style={{ padding: '12px 14px', fontSize: '12px', color: '#64748B' }}>{po.expectedDate ? new Date(po.expectedDate).toLocaleDateString() : '—'}</td>
                    <td style={{ padding: '12px 14px', fontSize: '12px', color: '#64748B' }}>{new Date(po.createdAt).toLocaleDateString()}</td>
                    <td style={{ padding: '12px 14px' }}>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        {po.status === 'DRAFT' && (
                          <button onClick={() => handleSubmitPO(po.id)} style={{ padding: '5px 10px', fontSize: '12px', fontWeight: 500, background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: '5px', cursor: 'pointer', color: '#EA580C' }}>
                            Submit
                          </button>
                        )}
                        {(po.status === 'SUBMITTED' || po.status === 'PARTIAL') && (
                          <button onClick={() => setReceivingPO(po)} style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '5px 10px', fontSize: '12px', fontWeight: 600, background: '#0A2342', border: 'none', borderRadius: '5px', cursor: 'pointer', color: '#FFFFFF' }}>
                            <Truck size={12} /> Receive
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr style={{ background: '#F8FAFC' }}>
                      <td colSpan={9} style={{ padding: '0' }}>
                        <div style={{ padding: '16px 24px', borderTop: '1px solid #E2E8F0' }}>
                          <div style={{ fontSize: '12px', fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '10px' }}>Line Items</div>
                          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                              <tr style={{ borderBottom: '1px solid #E2E8F0' }}>
                                {['Product', 'SKU', 'Cost Method', 'Ordered', 'Received', 'Remaining', 'Unit Cost', 'Extended'].map((h) => (
                                  <th key={h} style={{ padding: '6px 10px', fontSize: '11px', fontWeight: 600, color: '#94A3B8', textAlign: 'left', textTransform: 'uppercase' }}>{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {po.items.map((item) => {
                                const remaining = item.quantityOrdered - item.quantityReceived;
                                return (
                                  <tr key={item.id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                                    <td style={{ padding: '8px 10px', fontSize: '13px', fontWeight: 500, color: '#0A2342' }}>{item.product.name}</td>
                                    <td style={{ padding: '8px 10px', fontSize: '12px', color: '#94A3B8', fontFamily: 'monospace' }}>{item.product.sku}</td>
                                    <td style={{ padding: '8px 10px' }}>
                                      <span style={{ fontSize: '11px', fontWeight: 600, padding: '2px 6px', borderRadius: '4px', background: item.product.costingMethod === 'FIFO' ? '#FFF9C2' : '#F0F9FF', color: item.product.costingMethod === 'FIFO' ? '#92400E' : '#0369A1' }}>
                                        {item.product.costingMethod ?? 'WAC'}
                                      </span>
                                    </td>
                                    <td style={{ padding: '8px 10px', fontSize: '13px', color: '#64748B' }}>{item.quantityOrdered.toLocaleString()}</td>
                                    <td style={{ padding: '8px 10px', fontSize: '13px', color: item.quantityReceived > 0 ? '#16A34A' : '#64748B' }}>{item.quantityReceived.toLocaleString()}</td>
                                    <td style={{ padding: '8px 10px', fontSize: '13px', color: remaining > 0 ? '#EA580C' : '#16A34A', fontWeight: 600 }}>{remaining.toLocaleString()}</td>
                                    <td style={{ padding: '8px 10px', fontSize: '13px', color: '#0A2342', fontFamily: 'monospace' }}>{cents(item.unitCostCents)}</td>
                                    <td style={{ padding: '8px 10px', fontSize: '13px', color: '#0A2342', fontFamily: 'monospace', fontWeight: 600 }}>{cents(item.extendedCents)}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                          {po.notes && (
                            <div style={{ marginTop: '12px', fontSize: '13px', color: '#64748B' }}>
                              <strong>Notes:</strong> {po.notes}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div style={{ padding: '48px', textAlign: 'center', color: '#94A3B8', fontSize: '14px' }}>
            <Package size={32} style={{ marginBottom: '12px', opacity: 0.4, display: 'block', margin: '0 auto 12px' }} />
            No purchase orders found.
          </div>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
