import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { Search, Filter, Plus, ClipboardList, X } from 'lucide-react';
import { formatCents, formatDate } from '../lib/format';
import { useModules } from '../context/ModulesContext';

/* ─── Types ─── */
export interface PoLineItem {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  unitCostCents: number;
  receivedQty: number;
  receivedAt: string | null;
  unitCostAtReceipt: number | null;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string | null;
  vendorName: string | null;
  vendorId: string | null;
  status: string;
  locationId: string | null;
  totalCents: number;
  expectedDate: string | null;
  receivedAt: string | null;
  createdAt: string;
  lineItems: PoLineItem[];
  qboBillId: string | null;
  qboBillSyncedAt: string | null;
  qboBillSyncError: string | null;
}

interface ApiProduct {
  id: string;
  name: string;
  priceCents: number;
}

interface DraftLineItem {
  productId: string;
  productName: string;
  quantity: number;
  unitCostDollars: number;
}

const PO_STATUSES = ['All', 'draft', 'submitted', 'partial', 'received', 'cancelled'] as const;

export const STATUS_LABELS: Record<string, string> = {
  All: 'All Statuses',
  draft: 'Draft',
  submitted: 'Submitted',
  partial: 'Partial',
  received: 'Received',
  cancelled: 'Cancelled',
};

/* ─── Helpers ─── */
export function statusBadge(status: string): React.CSSProperties {
  const base: React.CSSProperties = {
    display: 'inline-block',
    padding: '2px 10px',
    borderRadius: '9999px',
    fontSize: '12px',
    fontWeight: 600,
    letterSpacing: '0.02em',
    whiteSpace: 'nowrap',
    textTransform: 'capitalize',
  };
  switch (status) {
    case 'draft':     return { ...base, backgroundColor: '#F1F5F9', color: '#6B7280' };
    case 'submitted': return { ...base, backgroundColor: '#EFF6FF', color: '#3B82F6' };
    case 'partial':   return { ...base, backgroundColor: '#FFFBEB', color: '#F59E0B' };
    case 'received':  return { ...base, backgroundColor: '#ECFDF5', color: '#10B981' };
    case 'cancelled': return { ...base, backgroundColor: '#FEF2F2', color: '#EF4444' };
    default:          return { ...base, backgroundColor: '#F1F5F9', color: '#6B7280' };
  }
}

/* ─── Styles ─── */
export const mono: React.CSSProperties = { fontFamily: 'Inter, system-ui, sans-serif', fontVariantNumeric: 'tabular-nums' };

const stl: Record<string, React.CSSProperties> = {
  page: { padding: '32px' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' },
  title: { fontSize: '36px', fontWeight: 700, color: '#0A2342', letterSpacing: '-0.02em', margin: 0 },
  divider: { height: '4px', background: 'linear-gradient(90deg, #00D4FF, transparent)', border: 'none', marginTop: '12px', marginBottom: '32px', borderRadius: '2px' },
  filterBar: { display: 'flex', gap: '16px', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap' },
  select: { padding: '8px 12px', borderRadius: '6px', border: '1px solid #CCCCCC', fontSize: '14px', color: '#0A2342', backgroundColor: '#FFFFFF', cursor: 'pointer', minWidth: '140px' },
  searchWrap: { position: 'relative', flex: 1, minWidth: '200px' },
  searchInput: { width: '100%', padding: '8px 12px 8px 36px', borderRadius: '6px', border: '1px solid #CCCCCC', fontSize: '14px', color: '#0A2342', boxSizing: 'border-box' },
  searchIcon: { position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94A3B8', pointerEvents: 'none' },
  createBtn: { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 20px', fontSize: '14px', fontWeight: 600, color: '#FFFFFF', backgroundColor: '#0A2342', border: 'none', borderRadius: '6px', cursor: 'pointer', marginLeft: 'auto', whiteSpace: 'nowrap' },
  tableWrap: { borderRadius: '8px', overflow: 'hidden', border: '1px solid #E2E8F0', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '14px' },
  th: { textAlign: 'left', padding: '12px 16px', backgroundColor: '#0A2342', color: '#FFFFFF', fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' },
  thRight: { textAlign: 'right', padding: '12px 16px', backgroundColor: '#0A2342', color: '#FFFFFF', fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' },
  td: { padding: '12px 16px', borderBottom: '1px solid #E2E8F0', color: '#0A2342' },
  tdRight: { padding: '12px 16px', borderBottom: '1px solid #E2E8F0', color: '#0A2342', textAlign: 'right', ...mono, fontSize: '13px' },
  viewBtn: { display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '4px 12px', fontSize: '12px', fontWeight: 600, color: '#0A2342', backgroundColor: '#F1F5F9', border: '1px solid #E2E8F0', borderRadius: '4px', cursor: 'pointer', whiteSpace: 'nowrap' },
  paginationRow: { display: 'flex', justifyContent: 'center', gap: '8px', marginTop: '16px', alignItems: 'center' },
  pageBtn: { padding: '6px 14px', fontSize: '13px', borderRadius: '6px', border: '1px solid #E2E8F0', background: '#FFFFFF', color: '#0A2342', cursor: 'pointer', fontWeight: 500 },
  pageBtnActive: { padding: '6px 14px', fontSize: '13px', borderRadius: '6px', border: '1px solid #0A2342', background: '#0A2342', color: '#FFFFFF', cursor: 'default', fontWeight: 600 },
  // Drawer
  overlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.35)', zIndex: 900 },
  drawer: { position: 'fixed', top: 0, right: 0, width: '520px', height: '100vh', background: '#FFFFFF', boxShadow: '-4px 0 24px rgba(0,0,0,0.15)', zIndex: 901, display: 'flex', flexDirection: 'column' },
  drawerHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid #E2E8F0', background: '#0A2342', color: '#FFFFFF' },
  drawerBody: { flex: 1, overflowY: 'auto', padding: '24px' },
  drawerFooter: { padding: '16px 24px', borderTop: '1px solid #E2E8F0', display: 'flex', gap: '12px', justifyContent: 'flex-end' },
  formGroup: { marginBottom: '18px' },
  label: { display: 'block', fontSize: '13px', fontWeight: 600, color: '#0A2342', marginBottom: '6px' },
  input: { width: '100%', padding: '9px 12px', borderRadius: '6px', border: '1px solid #E2E8F0', fontSize: '14px', color: '#0A2342', boxSizing: 'border-box' },
  textarea: { width: '100%', padding: '9px 12px', borderRadius: '6px', border: '1px solid #E2E8F0', fontSize: '14px', color: '#0A2342', boxSizing: 'border-box', minHeight: '80px', resize: 'vertical' },
  sectionTitle: { fontSize: '13px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '12px', marginTop: '24px' },
  lineItemRow: { display: 'grid', gridTemplateColumns: '1fr 80px 100px 28px', gap: '8px', alignItems: 'end', marginBottom: '10px' },
  addLineBtn: { display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '6px 14px', fontSize: '13px', fontWeight: 600, color: '#0A2342', backgroundColor: '#F1F5F9', border: '1px solid #E2E8F0', borderRadius: '6px', cursor: 'pointer', marginTop: '8px' },
  removeBtn: { background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: '6px', display: 'flex', alignItems: 'center' },
  totalRow: { display: 'flex', justifyContent: 'flex-end', gap: '12px', alignItems: 'center', padding: '12px 0', borderTop: '1px solid #E2E8F0', marginTop: '8px', fontSize: '15px', fontWeight: 700, color: '#0A2342' },
  cancelBtn: { padding: '8px 20px', fontSize: '14px', fontWeight: 600, color: '#0A2342', background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '6px', cursor: 'pointer' },
  submitBtn: { padding: '8px 20px', fontSize: '14px', fontWeight: 600, color: '#FFFFFF', background: '#0A2342', border: 'none', borderRadius: '6px', cursor: 'pointer' },
};

/* ─── Create Drawer ─── */
interface CreateDrawerProps {
  locationId: string | null;
  onClose: () => void;
  onCreated: (id: string) => void;
}

function CreateDrawer({ locationId, onClose, onCreated }: CreateDrawerProps) {
  const [vendorName, setVendorName] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lineItems, setLineItems] = useState<DraftLineItem[]>([
    { productId: '', productName: '', quantity: 1, unitCostDollars: 0 },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const productsQs = locationId ? `?locationId=${encodeURIComponent(locationId)}` : '';
  const { data: productsData } = useApi<{ data: ApiProduct[] }>('get', `/api/inventory/products${productsQs}`, { immediate: true });
  const products = productsData?.data ?? [];

  const createApi = useApi<{ id: string }>('post', '/api/inventory/purchase-orders');

  const runningTotal = lineItems.reduce((sum, li) => sum + li.quantity * li.unitCostDollars * 100, 0);

  const addLine = () => {
    setLineItems((prev) => [...prev, { productId: '', productName: '', quantity: 1, unitCostDollars: 0 }]);
  };

  const removeLine = (idx: number) => {
    setLineItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateLine = (idx: number, field: keyof DraftLineItem, value: string | number) => {
    setLineItems((prev) => prev.map((li, i) => {
      if (i !== idx) return li;
      if (field === 'productId') {
        const prod = products.find((p) => p.id === (value as string));
        return {
          ...li,
          productId: value as string,
          productName: prod?.name ?? '',
          unitCostDollars: prod ? prod.priceCents / 100 : li.unitCostDollars,
        };
      }
      return { ...li, [field]: value };
    }));
  };

  const handleSubmit = useCallback(async () => {
    if (!vendorName.trim()) { setError('Vendor name is required.'); return; }
    if (lineItems.length === 0) { setError('Add at least one line item.'); return; }

    setSubmitting(true);
    setError(null);

    const body = {
      vendorName: vendorName.trim(),
      locationId: locationId ?? undefined,
      expectedDate: expectedDate || undefined,
      notes: notes || undefined,
      lineItems: lineItems.map((li) => ({
        productId: li.productId || undefined,
        productName: li.productName || undefined,
        quantity: li.quantity,
        unitCostCents: Math.round(li.unitCostDollars * 100),
      })),
    };

    const result = await createApi.execute(body);
    setSubmitting(false);

    if (result?.id) {
      onCreated(result.id);
    } else {
      setError(createApi.error ?? 'Failed to create purchase order.');
    }
  }, [vendorName, locationId, expectedDate, notes, lineItems, createApi, onCreated]);

  return (
    <>
      <div style={stl.overlay} onClick={onClose} />
      <div style={stl.drawer}>
        <div style={stl.drawerHeader}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, fontSize: '16px' }}>
            <ClipboardList size={18} /> New Purchase Order
          </div>
          <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#FFFFFF' }} onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div style={stl.drawerBody}>
          {error && (
            <div style={{ padding: '10px 14px', backgroundColor: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '6px', color: '#B91C1C', fontSize: '13px', marginBottom: '16px' }}>
              {error}
            </div>
          )}

          <div style={stl.formGroup}>
            <label style={stl.label}>Vendor Name *</label>
            <input
              style={stl.input}
              placeholder="e.g. Marine Supply Co."
              value={vendorName}
              onChange={(e) => setVendorName(e.target.value)}
            />
          </div>

          <div style={stl.formGroup}>
            <label style={stl.label}>Expected Delivery Date</label>
            <input
              type="date"
              style={stl.input}
              value={expectedDate}
              onChange={(e) => setExpectedDate(e.target.value)}
            />
          </div>

          <div style={stl.formGroup}>
            <label style={stl.label}>Notes</label>
            <textarea
              style={stl.textarea}
              placeholder="Optional notes..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <div style={stl.sectionTitle}>Line Items</div>

          {lineItems.map((li, idx) => (
            <div key={idx} style={stl.lineItemRow}>
              <div>
                <label style={{ ...stl.label, fontSize: '11px', color: '#64748B' }}>Product</label>
                {products.length > 0 ? (
                  <select
                    style={{ ...stl.input, padding: '8px 10px' }}
                    value={li.productId}
                    onChange={(e) => updateLine(idx, 'productId', e.target.value)}
                  >
                    <option value="">— Select product —</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    style={{ ...stl.input, padding: '8px 10px' }}
                    placeholder="Product name"
                    value={li.productName}
                    onChange={(e) => updateLine(idx, 'productName', e.target.value)}
                  />
                )}
              </div>
              <div>
                <label style={{ ...stl.label, fontSize: '11px', color: '#64748B' }}>Qty</label>
                <input
                  type="number"
                  min={1}
                  style={{ ...stl.input, padding: '8px 10px' }}
                  value={li.quantity}
                  onChange={(e) => updateLine(idx, 'quantity', parseFloat(e.target.value) || 1)}
                />
              </div>
              <div>
                <label style={{ ...stl.label, fontSize: '11px', color: '#64748B' }}>Unit Cost ($)</label>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  style={{ ...stl.input, padding: '8px 10px' }}
                  value={li.unitCostDollars}
                  onChange={(e) => updateLine(idx, 'unitCostDollars', parseFloat(e.target.value) || 0)}
                />
              </div>
              <div>
                <button
                  style={{ ...stl.removeBtn, marginTop: '20px' }}
                  onClick={() => removeLine(idx)}
                  title="Remove line"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          ))}

          <button style={stl.addLineBtn} onClick={addLine}>
            <Plus size={14} /> Add Line Item
          </button>

          <div style={stl.totalRow}>
            <span style={{ fontSize: '13px', fontWeight: 500, color: '#64748B' }}>Running Total:</span>
            <span style={{ ...mono }}>{formatCents(Math.round(runningTotal))}</span>
          </div>
        </div>

        <div style={stl.drawerFooter}>
          <button style={stl.cancelBtn} onClick={onClose} disabled={submitting}>Cancel</button>
          <button style={{ ...stl.submitBtn, opacity: submitting ? 0.7 : 1 }} onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Creating...' : 'Create PO'}
          </button>
        </div>
      </div>
    </>
  );
}

/* ─── Main Page ─── */
export default function PurchaseOrders() {
  const navigate = useNavigate();
  const { currentLocationId } = useModules();
  const [statusFilter, setStatusFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const TAKE = 50;

  const apiStatus = statusFilter === 'All' ? '' : statusFilter;
  const qs = new URLSearchParams();
  if (currentLocationId) qs.set('locationId', currentLocationId);
  if (apiStatus) qs.set('status', apiStatus);
  qs.set('take', String(TAKE));
  qs.set('skip', String((page - 1) * TAKE));

  const { data, loading, execute: refetch } = useApi<{ data: PurchaseOrder[]; total: number }>(
    'get',
    `/api/inventory/purchase-orders?${qs.toString()}`,
    { immediate: true }
  );

  useEffect(() => {
    refetch();
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentLocationId, statusFilter]);

  useEffect(() => {
    refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const orders = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / TAKE);

  const filtered = search
    ? orders.filter((po) =>
        (po.vendorName ?? '').toLowerCase().includes(search.toLowerCase()) ||
        (po.poNumber ?? '').toLowerCase().includes(search.toLowerCase())
      )
    : orders;

  const handleCreated = (id: string) => {
    setShowCreate(false);
    setHighlightId(id);
    setStatusFilter('All');
    refetch();
    setTimeout(() => setHighlightId(null), 3000);
  };

  return (
    <div style={stl.page}>
      <div style={stl.header}>
        <h1 style={stl.title} className="helm-page-title">Purchase Orders</h1>
        <button style={stl.createBtn} onClick={() => setShowCreate(true)}>
          <Plus size={16} /> New PO
        </button>
      </div>
      <hr style={stl.divider} />

      {loading && (
        <div style={{ textAlign: 'center', padding: '24px', color: '#64748B' }}>Loading purchase orders...</div>
      )}

      {/* Filter Bar */}
      <div style={stl.filterBar} className="helm-filter-bar">
        <div style={{ position: 'relative' }}>
          <Filter size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94A3B8', pointerEvents: 'none' }} />
          <select
            style={{ ...stl.select, paddingLeft: '30px' }}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            {PO_STATUSES.map((s) => (
              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
            ))}
          </select>
        </div>
        <div style={stl.searchWrap}>
          <Search size={16} style={stl.searchIcon as React.CSSProperties} />
          <input
            style={stl.searchInput}
            placeholder="Search by vendor or PO number..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Table */}
      <div style={stl.tableWrap} className="helm-table-wrap">
        <table style={stl.table}>
          <thead>
            <tr>
              <th style={stl.th}>PO #</th>
              <th style={stl.th}>Vendor</th>
              <th style={stl.th}>Status</th>
              <th style={{ ...stl.thRight }}>Items</th>
              <th style={stl.thRight}>Total</th>
              <th style={stl.th}>Expected</th>
              <th style={stl.th}>Created</th>
              <th style={{ ...stl.th, textAlign: 'center', width: '80px' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((po, idx) => {
              const isHighlighted = po.id === highlightId;
              const baseColor = isHighlighted ? '#FFFBEB' : idx % 2 === 1 ? '#F8FAFC' : '#FFFFFF';
              return (
                <tr
                  key={po.id}
                  style={{ cursor: 'pointer', backgroundColor: baseColor, transition: 'background-color 0.15s', outline: isHighlighted ? '2px solid #F59E0B' : 'none' }}
                  onClick={() => navigate(`/purchase-orders/${po.id}`)}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = '#EFF6FF'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = baseColor; }}
                >
                  <td style={{ ...stl.td, ...mono, fontWeight: 600, fontSize: '13px', color: '#00D4FF' }}>
                    {po.poNumber ?? `PO-${po.id.slice(0, 6).toUpperCase()}`}
                  </td>
                  <td style={stl.td}>{po.vendorName ?? '—'}</td>
                  <td style={stl.td}><span style={statusBadge(po.status)}>{STATUS_LABELS[po.status] ?? po.status}</span></td>
                  <td style={stl.tdRight}>{po.lineItems?.length ?? 0}</td>
                  <td style={{ ...stl.tdRight, fontWeight: 600 }}>{formatCents(po.totalCents)}</td>
                  <td style={stl.td}>{po.expectedDate ? formatDate(po.expectedDate) : '—'}</td>
                  <td style={stl.td}>{formatDate(po.createdAt)}</td>
                  <td style={{ ...stl.td, textAlign: 'center' }}>
                    <button
                      style={stl.viewBtn}
                      onClick={(e) => { e.stopPropagation(); navigate(`/purchase-orders/${po.id}`); }}
                    >
                      View
                    </button>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && !loading && (
              <tr>
                <td colSpan={8} style={{ ...stl.td, textAlign: 'center', color: '#94A3B8', padding: '48px 16px' }}>
                  No purchase orders match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={stl.paginationRow}>
          <button
            style={{ ...stl.pageBtn, opacity: page === 1 ? 0.5 : 1 }}
            disabled={page === 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            &larr; Prev
          </button>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <button
              key={p}
              style={p === page ? stl.pageBtnActive : stl.pageBtn}
              onClick={() => setPage(p)}
            >
              {p}
            </button>
          ))}
          <button
            style={{ ...stl.pageBtn, opacity: page === totalPages ? 0.5 : 1 }}
            disabled={page === totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Next &rarr;
          </button>
        </div>
      )}

      {/* Create Drawer */}
      {showCreate && (
        <CreateDrawer
          locationId={currentLocationId}
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}
