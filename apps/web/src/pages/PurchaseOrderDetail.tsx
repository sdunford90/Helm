import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { ArrowLeft, CheckCircle, Clock, Circle, ExternalLink } from 'lucide-react';
import { formatCents, formatDate } from '../lib/format';
import { PurchaseOrder, PoLineItem, STATUS_LABELS, statusBadge, mono } from './PurchaseOrders';

/* ─── Styles ─── */
const stl: Record<string, React.CSSProperties> = {
  page:        { padding: '32px', maxWidth: '1100px' },
  headerRow:   { display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px', flexWrap: 'wrap' },
  backBtn:     { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '7px 14px', fontSize: '13px', fontWeight: 600, color: '#0A2342', backgroundColor: '#F1F5F9', border: '1px solid #E2E8F0', borderRadius: '6px', cursor: 'pointer' },
  poTitle:     { fontSize: '26px', fontWeight: 700, color: '#0A2342', margin: 0, ...mono },
  actionBtns:  { display: 'flex', gap: '10px', marginLeft: 'auto', flexWrap: 'wrap' },
  primaryBtn:  { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 18px', fontSize: '13px', fontWeight: 600, color: '#FFFFFF', backgroundColor: '#0A2342', border: 'none', borderRadius: '6px', cursor: 'pointer' },
  dangerBtn:   { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 18px', fontSize: '13px', fontWeight: 600, color: '#FFFFFF', backgroundColor: '#EF4444', border: 'none', borderRadius: '6px', cursor: 'pointer' },
  secondaryBtn:{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 18px', fontSize: '13px', fontWeight: 600, color: '#0A2342', backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '6px', cursor: 'pointer' },
  divider:     { height: '4px', background: 'linear-gradient(90deg, #00D4FF, transparent)', border: 'none', marginBottom: '28px', borderRadius: '2px' },
  infoGrid:    { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0', marginBottom: '28px', border: '1px solid #E2E8F0', borderRadius: '8px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' },
  infoCell:    { padding: '16px 20px', borderBottom: '1px solid #E2E8F0', backgroundColor: '#FFFFFF' },
  infoCellAlt: { padding: '16px 20px', borderBottom: '1px solid #E2E8F0', backgroundColor: '#F8FAFC' },
  infoLabel:   { fontSize: '11px', fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' },
  infoValue:   { fontSize: '14px', color: '#0A2342', fontWeight: 500 },
  card:        { backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '8px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', marginBottom: '24px' },
  cardHead:    { padding: '14px 20px', backgroundColor: '#0A2342', color: '#FFFFFF', fontSize: '13px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' },
  table:       { width: '100%', borderCollapse: 'collapse', fontSize: '14px' },
  th:          { textAlign: 'left', padding: '11px 16px', backgroundColor: '#F1F5F9', color: '#374151', fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid #E2E8F0' },
  thRight:     { textAlign: 'right', padding: '11px 16px', backgroundColor: '#F1F5F9', color: '#374151', fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid #E2E8F0' },
  td:          { padding: '12px 16px', borderBottom: '1px solid #E2E8F0', color: '#0A2342', fontSize: '14px' },
  tdRight:     { padding: '12px 16px', borderBottom: '1px solid #E2E8F0', color: '#0A2342', textAlign: 'right', ...mono, fontSize: '13px' },
  totalsBar:   { display: 'flex', justifyContent: 'flex-end', gap: '32px', padding: '16px 20px', backgroundColor: '#F8FAFC', borderTop: '1px solid #E2E8F0' },
  totalItem:   { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' },
  totalLabel:  { fontSize: '11px', fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' },
  totalValue:  { fontSize: '16px', fontWeight: 700, color: '#0A2342', ...mono },
  /* Receiving form */
  receiveCard: { backgroundColor: '#FFFFFF', border: '2px solid #0A2342', borderRadius: '8px', overflow: 'hidden', marginBottom: '24px', boxShadow: '0 2px 8px rgba(10,35,66,0.08)' },
  receiveHead: { padding: '14px 20px', backgroundColor: '#0A2342', color: '#FFFFFF', fontSize: '13px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '8px' },
  receiveBody: { padding: '20px' },
  receiveGrid: { display: 'grid', gridTemplateColumns: '1fr 110px 110px 140px', gap: '0', marginBottom: '16px', border: '1px solid #E2E8F0', borderRadius: '6px', overflow: 'hidden' },
  receiveColHead: { padding: '8px 12px', backgroundColor: '#F1F5F9', fontSize: '11px', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid #E2E8F0' },
  receiveRow: { display: 'contents' },
  receiveCell: { padding: '10px 12px', borderBottom: '1px solid #E2E8F0', fontSize: '13px', color: '#0A2342', display: 'flex', alignItems: 'center' },
  receiveInput:{ width: '100%', padding: '6px 8px', border: '1px solid #D1D5DB', borderRadius: '4px', fontSize: '13px', color: '#0A2342', boxSizing: 'border-box' },
  markBtn:     { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '10px 24px', fontSize: '14px', fontWeight: 600, color: '#FFFFFF', backgroundColor: '#10B981', border: 'none', borderRadius: '6px', cursor: 'pointer' },
  successMsg:  { padding: '10px 16px', backgroundColor: '#D1FAE5', color: '#065F46', borderRadius: '6px', fontSize: '14px', fontWeight: 500, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' },
  errorMsg:    { padding: '10px 16px', backgroundColor: '#FEE2E2', color: '#991B1B', borderRadius: '6px', fontSize: '14px', marginBottom: '16px' },
  /* Inline edit */
  editCard:    { backgroundColor: '#FFF9C4', border: '1px solid #F59E0B', borderRadius: '8px', padding: '20px', marginBottom: '24px' },
  editLabel:   { display: 'block', fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '4px' },
  editInput:   { width: '100%', padding: '8px 12px', border: '1px solid #D1D5DB', borderRadius: '6px', fontSize: '14px', color: '#0A2342', boxSizing: 'border-box', marginBottom: '12px' },
};

/* ─── Line Status Badge ─── */
function lineStatus(li: PoLineItem) {
  if (li.receivedQty >= li.quantity) {
    return <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#10B981', fontSize: '13px', fontWeight: 600 }}><CheckCircle size={14} /> Received</span>;
  }
  if (li.receivedQty > 0) {
    return <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#F59E0B', fontSize: '13px', fontWeight: 600 }}><Clock size={14} /> Partial ({li.receivedQty}/{li.quantity})</span>;
  }
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#94A3B8', fontSize: '13px' }}><Circle size={14} /> Pending</span>;
}

/* ─── Receiving Form ─── */
interface ReceiveQty {
  lineId: string;
  qty: number;
  unitCostAtReceipt: number | null;
}

interface ReceivingFormProps {
  po: PurchaseOrder;
  onReceived: () => void;
}

function ReceivingForm({ po, onReceived }: ReceivingFormProps) {
  const [receiveQtys, setReceiveQtys] = useState<ReceiveQty[]>(
    po.lineItems.map((li) => ({ lineId: li.id, qty: Math.max(0, li.quantity - li.receivedQty), unitCostAtReceipt: null }))
  );
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const receiveApi = useApi<PurchaseOrder>('put', `/api/inventory/purchase-orders/${po.id}/receive`);

  const updateQty = (lineId: string, qty: number) => {
    setReceiveQtys((prev) => prev.map((r) => r.lineId === lineId ? { ...r, qty } : r));
  };
  const updateCost = (lineId: string, val: string) => {
    const parsed = parseFloat(val);
    setReceiveQtys((prev) => prev.map((r) => r.lineId === lineId ? { ...r, unitCostAtReceipt: isNaN(parsed) ? null : Math.round(parsed * 100) } : r));
  };

  const handleMarkReceived = async () => {
    setSubmitting(true);
    setError(null);
    const result = await receiveApi.execute({
      lineItems: receiveQtys
        .filter((r) => r.qty > 0)
        .map((r) => ({
          lineItemId: r.lineId,
          receivedQty: r.qty,
          unitCostAtReceipt: r.unitCostAtReceipt,
        })),
    });
    setSubmitting(false);
    if (result) {
      setSuccess(true);
      setTimeout(() => { setSuccess(false); onReceived(); }, 1500);
    } else {
      setError(receiveApi.error ?? 'Failed to record receipt.');
    }
  };

  const receivableLines = po.lineItems.filter((li) => li.receivedQty < li.quantity);
  if (receivableLines.length === 0) return null;

  return (
    <div style={stl.receiveCard}>
      <div style={stl.receiveHead}>
        <CheckCircle size={16} /> Record Receipt
      </div>
      <div style={stl.receiveBody}>
        {success && (
          <div style={stl.successMsg}><CheckCircle size={16} /> Receipt recorded successfully!</div>
        )}
        {error && <div style={stl.errorMsg}>{error}</div>}

        <div style={stl.receiveGrid}>
          <div style={stl.receiveColHead}>Product</div>
          <div style={{ ...stl.receiveColHead, textAlign: 'right' }}>Ordered</div>
          <div style={{ ...stl.receiveColHead, textAlign: 'center' }}>Qty to Receive</div>
          <div style={{ ...stl.receiveColHead, textAlign: 'right' }}>Cost at Receipt ($)</div>
          {receivableLines.map((li) => {
            const rq = receiveQtys.find((r) => r.lineId === li.id);
            const maxReceivable = li.quantity - li.receivedQty;
            return (
              <div key={li.id} style={stl.receiveRow}>
                <div style={stl.receiveCell}>{li.productName}</div>
                <div style={{ ...stl.receiveCell, justifyContent: 'flex-end', ...mono, fontSize: '13px' }}>{li.quantity}</div>
                <div style={{ ...stl.receiveCell, justifyContent: 'center' }}>
                  <input
                    type="number"
                    min={0}
                    max={maxReceivable}
                    style={stl.receiveInput}
                    value={rq?.qty ?? 0}
                    onChange={(e) => updateQty(li.id, Math.min(maxReceivable, Math.max(0, parseInt(e.target.value) || 0)))}
                  />
                </div>
                <div style={{ ...stl.receiveCell, justifyContent: 'flex-end' }}>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    placeholder={`${(li.unitCostCents / 100).toFixed(2)}`}
                    style={{ ...stl.receiveInput, maxWidth: '120px' }}
                    onChange={(e) => updateCost(li.id, e.target.value)}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            style={{ ...stl.markBtn, opacity: submitting ? 0.7 : 1 }}
            onClick={handleMarkReceived}
            disabled={submitting}
          >
            <CheckCircle size={16} />
            {submitting ? 'Saving...' : 'Mark as Received'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Inline Edit Form ─── */
interface EditFormProps {
  po: PurchaseOrder;
  onSaved: () => void;
  onCancel: () => void;
}

function EditForm({ po, onSaved, onCancel }: EditFormProps) {
  const [vendorName, setVendorName] = useState(po.vendorName ?? '');
  const [expectedDate, setExpectedDate] = useState(po.expectedDate?.slice(0, 10) ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateApi = useApi<PurchaseOrder>('put', `/api/inventory/purchase-orders/${po.id}`);

  const handleSave = async () => {
    if (!vendorName.trim()) { setError('Vendor name is required.'); return; }
    setSubmitting(true);
    setError(null);
    const result = await updateApi.execute({ vendorName: vendorName.trim(), expectedDate: expectedDate || null });
    setSubmitting(false);
    if (result) {
      onSaved();
    } else {
      setError(updateApi.error ?? 'Failed to save changes.');
    }
  };

  return (
    <div style={stl.editCard}>
      <div style={{ fontSize: '13px', fontWeight: 700, color: '#92400E', marginBottom: '16px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Edit Purchase Order
      </div>
      {error && <div style={stl.errorMsg}>{error}</div>}
      <label style={stl.editLabel}>Vendor Name *</label>
      <input style={stl.editInput} value={vendorName} onChange={(e) => setVendorName(e.target.value)} />
      <label style={stl.editLabel}>Expected Delivery Date</label>
      <input type="date" style={stl.editInput} value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
      <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
        <button style={stl.secondaryBtn} onClick={onCancel} disabled={submitting}>Cancel</button>
        <button style={{ ...stl.primaryBtn, opacity: submitting ? 0.7 : 1 }} onClick={handleSave} disabled={submitting}>
          {submitting ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
}

/* ─── Main Detail Page ─── */
export default function PurchaseOrderDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [showEdit, setShowEdit] = useState(false);
  const [confirming, setConfirming] = useState<'cancel' | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: po, loading, execute: refetch } = useApi<PurchaseOrder>(
    'get',
    `/api/inventory/purchase-orders/${id ?? ''}`,
    { immediate: true }
  );

  const submitApi = useApi<PurchaseOrder>('post', `/api/inventory/purchase-orders/${id}/submit`);
  const cancelApi = useApi<PurchaseOrder>('post', `/api/inventory/purchase-orders/${id}/cancel`);

  const showMsg = (msg: string) => {
    setActionMsg(msg);
    setTimeout(() => setActionMsg(null), 3000);
  };

  const handleSubmit = async () => {
    const result = await submitApi.execute({});
    if (result) { showMsg('Purchase order submitted.'); refetch(); }
    else setActionError(submitApi.error ?? 'Failed to submit.');
  };

  const handleCancel = async () => {
    if (confirming !== 'cancel') { setConfirming('cancel'); return; }
    setConfirming(null);
    const result = await cancelApi.execute({});
    if (result) { showMsg('Purchase order cancelled.'); refetch(); }
    else setActionError(cancelApi.error ?? 'Failed to cancel.');
  };

  if (loading) {
    return <div style={{ padding: '48px', textAlign: 'center', color: '#64748B' }}>Loading purchase order...</div>;
  }

  if (!po) {
    return (
      <div style={{ padding: '48px', textAlign: 'center' }}>
        <div style={{ color: '#EF4444', marginBottom: '16px', fontSize: '16px' }}>Purchase order not found.</div>
        <button style={stl.backBtn} onClick={() => navigate('/purchase-orders')}>
          <ArrowLeft size={14} /> Back to Purchase Orders
        </button>
      </div>
    );
  }

  const isDraft = po.status === 'draft';
  const isActive = po.status === 'draft' || po.status === 'submitted' || po.status === 'partial';
  const isCancellable = po.status === 'draft' || po.status === 'submitted';

  const orderedTotal = po.totalCents;
  const receivedValue = po.lineItems.reduce((sum, li) => {
    const costPerUnit = li.unitCostAtReceipt ?? li.unitCostCents;
    return sum + (li.receivedQty * costPerUnit);
  }, 0);

  return (
    <div style={stl.page}>
      {/* Header */}
      <div style={stl.headerRow}>
        <button style={stl.backBtn} onClick={() => navigate('/purchase-orders')}>
          <ArrowLeft size={14} /> Back
        </button>
        <h1 style={stl.poTitle}>
          {po.poNumber ?? `PO-${po.id.slice(0, 8).toUpperCase()}`}
        </h1>
        <span style={statusBadge(po.status)}>{STATUS_LABELS[po.status] ?? po.status}</span>
        <div style={stl.actionBtns}>
          {isDraft && (
            <button style={stl.secondaryBtn} onClick={() => setShowEdit(!showEdit)}>
              {showEdit ? 'Cancel Edit' : 'Edit'}
            </button>
          )}
          {isDraft && (
            <button style={stl.primaryBtn} onClick={handleSubmit}>
              Submit PO
            </button>
          )}
          {isCancellable && (
            <button style={stl.dangerBtn} onClick={handleCancel}>
              {confirming === 'cancel' ? 'Confirm Cancel?' : 'Cancel PO'}
            </button>
          )}
        </div>
      </div>
      <hr style={stl.divider} />

      {actionMsg && (
        <div style={{ ...stl.successMsg, marginBottom: '20px', padding: '10px 16px', backgroundColor: '#D1FAE5', color: '#065F46', borderRadius: '6px', fontSize: '14px', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '8px' }}>
          <CheckCircle size={16} /> {actionMsg}
        </div>
      )}
      {actionError && (
        <div style={{ ...stl.errorMsg, marginBottom: '20px' }}>{actionError}</div>
      )}

      {/* Inline Edit */}
      {showEdit && isDraft && (
        <EditForm
          po={po}
          onSaved={() => { setShowEdit(false); refetch(); }}
          onCancel={() => setShowEdit(false)}
        />
      )}

      {/* Info Grid */}
      <div style={stl.infoGrid}>
        <div style={stl.infoCell}>
          <div style={stl.infoLabel}>Vendor</div>
          <div style={stl.infoValue}>{po.vendorName ?? '—'}</div>
        </div>
        <div style={stl.infoCellAlt}>
          <div style={stl.infoLabel}>Expected Date</div>
          <div style={stl.infoValue}>{po.expectedDate ? formatDate(po.expectedDate) : '—'}</div>
        </div>
        <div style={stl.infoCell}>
          <div style={stl.infoLabel}>Status</div>
          <div style={stl.infoValue}><span style={statusBadge(po.status)}>{STATUS_LABELS[po.status] ?? po.status}</span></div>
        </div>
        <div style={stl.infoCellAlt}>
          <div style={stl.infoLabel}>Created</div>
          <div style={stl.infoValue}>{formatDate(po.createdAt)}</div>
        </div>
        {po.receivedAt && (
          <>
            <div style={stl.infoCell}>
              <div style={stl.infoLabel}>Received At</div>
              <div style={stl.infoValue}>{formatDate(po.receivedAt)}</div>
            </div>
            <div style={stl.infoCellAlt} />
          </>
        )}
        <div style={{ ...stl.infoCell, borderBottom: 'none' }}>
          <div style={stl.infoLabel}>QuickBooks Bill</div>
          <div style={stl.infoValue}>
            {po.qboBillId ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#10B981' }}>
                <ExternalLink size={13} />
                <span style={{ ...mono, fontSize: '13px' }}>{po.qboBillId}</span>
                {po.qboBillSyncedAt && <span style={{ fontSize: '12px', color: '#64748B' }}>synced {formatDate(po.qboBillSyncedAt)}</span>}
              </span>
            ) : po.qboBillSyncError ? (
              <span style={{ color: '#EF4444', fontSize: '13px' }}>Sync error: {po.qboBillSyncError}</span>
            ) : (
              <span style={{ color: '#94A3B8', fontSize: '13px' }}>Not synced</span>
            )}
          </div>
        </div>
        <div style={{ ...stl.infoCellAlt, borderBottom: 'none' }}>
          <div style={stl.infoLabel}>Location ID</div>
          <div style={{ ...stl.infoValue, ...mono, fontSize: '13px' }}>{po.locationId ?? '—'}</div>
        </div>
      </div>

      {/* Receiving Form */}
      {isActive && (
        <ReceivingForm po={po} onReceived={() => refetch()} />
      )}

      {/* Line Items Table */}
      <div style={stl.card}>
        <div style={stl.cardHead}>Line Items</div>
        <table style={stl.table}>
          <thead>
            <tr>
              <th style={stl.th}>Product</th>
              <th style={stl.thRight}>Ordered Qty</th>
              <th style={stl.thRight}>Unit Cost</th>
              <th style={stl.thRight}>Line Total</th>
              <th style={stl.thRight}>Received Qty</th>
              <th style={{ ...stl.th, textAlign: 'center' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {po.lineItems.map((li, idx) => (
              <tr key={li.id} style={{ backgroundColor: idx % 2 === 1 ? '#F8FAFC' : '#FFFFFF' }}>
                <td style={stl.td}>{li.productName}</td>
                <td style={stl.tdRight}>{li.quantity}</td>
                <td style={stl.tdRight}>{formatCents(li.unitCostCents)}</td>
                <td style={{ ...stl.tdRight, fontWeight: 600 }}>{formatCents(li.quantity * li.unitCostCents)}</td>
                <td style={stl.tdRight}>{li.receivedQty}</td>
                <td style={{ ...stl.td, textAlign: 'center' }}>{lineStatus(li)}</td>
              </tr>
            ))}
            {po.lineItems.length === 0 && (
              <tr>
                <td colSpan={6} style={{ ...stl.td, textAlign: 'center', color: '#94A3B8', padding: '32px' }}>
                  No line items on this purchase order.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {/* Totals Footer */}
        <div style={stl.totalsBar}>
          <div style={stl.totalItem}>
            <span style={stl.totalLabel}>Ordered Total</span>
            <span style={stl.totalValue}>{formatCents(orderedTotal)}</span>
          </div>
          <div style={stl.totalItem}>
            <span style={stl.totalLabel}>Received Value</span>
            <span style={{ ...stl.totalValue, color: '#10B981' }}>{formatCents(receivedValue)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
