import React, { useState } from 'react';
import { FileText, Search, Plus, X, Calendar, ToggleLeft, ToggleRight, Ship, ArrowRight, Edit2, Repeat, Send, CheckSquare, Square, PenTool } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import ESignatureFlow from '../components/ESignatureFlow';

/* ── Types ─────────────────────────────────────────────── */

type ContractStatus = 'Draft' | 'Active' | 'Expiring' | 'Expired' | 'Terminated' | 'Renewed';

type SignatureStatus = 'signed' | 'pending' | 'viewed' | 'declined' | null;

interface Contract {
  id: string;
  number: string;
  customer: string;
  customerEmail: string;
  slip: string;
  rate: number;
  billingCycle: string;
  start: string;
  end: string;
  status: ContractStatus;
  boat: string;
  boatName: string;
  securityDeposit: number;
  autoRenew: boolean;
  billingItemId?: string;
  glRevenueAccount?: string;
  glCogsAccount?: string;
  signatureStatus: SignatureStatus;
}

const GL_REVENUE_ACCOUNTS = [
  { code: '4100', label: '4100 - Slip Rental Revenue' },
  { code: '4110', label: '4110 - Seasonal Slip Revenue' },
  { code: '4200', label: '4200 - Live-Aboard Revenue' },
  { code: '4300', label: '4300 - Fuel Sales Revenue' },
  { code: '4400', label: '4400 - Marine Store Revenue' },
  { code: '4500', label: '4500 - Service Revenue' },
  { code: '4600', label: '4600 - Rental Revenue' },
  { code: '4700', label: '4700 - Event Revenue' },
  { code: '4800', label: '4800 - Electric / Metered Utilities' },
  { code: '4900', label: '4900 - Miscellaneous Revenue' },
];
const GL_COGS_ACCOUNTS = [
  { code: '5100', label: '5100 - Cost of Fuel Sold' },
  { code: '5200', label: '5200 - Cost of Marine Goods Sold' },
  { code: '5300', label: '5300 - Direct Labor' },
  { code: '5400', label: '5400 - Subcontracted Services' },
  { code: '5500', label: '5500 - Slip Maintenance Costs' },
  { code: '5600', label: '5600 - Rental Equipment Depreciation' },
  { code: '5700', label: '5700 - Utilities Costs' },
  { code: '5900', label: '5900 - Other Direct Costs' },
];
const BILLING_ITEMS = [
  { id: 'BI-001', label: 'Standard Slip Rental' },
  { id: 'BI-002', label: 'Seasonal Slip Package' },
  { id: 'BI-003', label: 'Annual Slip Agreement' },
  { id: 'BI-004', label: 'Live-Aboard Slip' },
  { id: 'BI-005', label: 'Side-Tie Berth' },
  { id: 'BI-006', label: 'Mooring Ball' },
  { id: 'BI-007', label: 'Dry Storage' },
  { id: 'BI-008', label: 'Covered Slip Premium' },
];

/* ── Styles ─────────────────────────────────────────────── */

const statusColors: Record<ContractStatus, { bg: string; color: string; border?: string }> = {
  Draft: { bg: '#F2F4F6', color: '#64748B' },
  Active: { bg: '#E8F5E9', color: '#1B5E20' },
  Expiring: { bg: '#FFF3CD', color: '#856404' },
  Expired: { bg: '#FDECEA', color: '#B71C1C' },
  Terminated: { bg: '#FFFFFF', color: '#B71C1C', border: '#B71C1C' },
  Renewed: { bg: '#0A2342', color: '#FFFFFF' },
};

const sigStatusColors: Record<string, { bg: string; color: string; label: string }> = {
  signed: { bg: '#E8F5E9', color: '#1B5E20', label: 'Signed' },
  pending: { bg: '#FFF3CD', color: '#856404', label: 'Pending' },
  viewed: { bg: '#E0F2FE', color: '#0369A1', label: 'Viewed' },
  declined: { bg: '#FDECEA', color: '#B71C1C', label: 'Declined' },
};

const st: Record<string, React.CSSProperties> = {
  page: { padding: '32px' },
  title: {
    fontSize: '36px',
    fontWeight: 700,
    color: '#0A2342',
    letterSpacing: '-0.02em',
    margin: 0,
  },
  divider: {
    height: '4px',
    background: 'linear-gradient(90deg, #00D4FF, transparent)',
    border: 'none',
    marginTop: '12px',
    marginBottom: '32px',
    borderRadius: '2px',
  },
  filterBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    marginBottom: '24px',
    flexWrap: 'wrap' as const,
  },
  select: {
    padding: '8px 12px',
    fontSize: '14px',
    border: '1px solid #CCC',
    borderRadius: '4px',
    color: '#0A2342',
    background: '#FFFFFF',
    cursor: 'pointer',
    minWidth: '140px',
  },
  searchWrap: {
    position: 'relative' as const,
    flex: 1,
    minWidth: '200px',
  },
  searchIcon: {
    position: 'absolute' as const,
    left: '10px',
    top: '50%',
    transform: 'translateY(-50%)',
    color: '#64748B',
    pointerEvents: 'none' as const,
  },
  searchInput: {
    width: '100%',
    padding: '8px 12px 8px 36px',
    fontSize: '14px',
    border: '1px solid #CCC',
    borderRadius: '4px',
    color: '#0A2342',
    boxSizing: 'border-box' as const,
  },
  addButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 20px',
    fontSize: '14px',
    fontWeight: 600,
    color: '#FFFFFF',
    backgroundColor: '#0A2342',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
  },
  tableWrap: {
    background: '#FFFFFF',
    borderRadius: '8px',
    border: '1px solid #E2E8F0',
    boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
    overflow: 'hidden',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: '14px',
  },
  th: {
    textAlign: 'left' as const,
    padding: '12px 16px',
    fontSize: '12px',
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    color: '#FFFFFF',
    backgroundColor: '#0A2342',
    borderBottom: '2px solid #00D4FF',
  },
  td: {
    padding: '12px 16px',
    color: '#0A2342',
    borderBottom: '1px solid #E2E8F0',
  },
  badge: {
    display: 'inline-block',
    padding: '2px 10px',
    fontSize: '12px',
    fontWeight: 600,
    borderRadius: '9999px',
  },
  mono: {
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: '14px',
  },
  emptyState: {
    maxWidth: '480px',
    margin: '0 auto',
    textAlign: 'center' as const,
    padding: '48px 32px',
    background: '#FFFFFF',
    borderRadius: '12px',
    border: '1px solid #E2E8F0',
    boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
  },
  /* Modal */
  overlay: {
    position: 'fixed' as const,
    inset: 0,
    backgroundColor: 'rgba(10, 35, 66, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    background: '#FFFFFF',
    borderRadius: '8px',
    width: '640px',
    maxHeight: '90vh',
    overflow: 'auto',
    boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '24px 32px 16px',
    borderBottom: '1px solid #E2E8F0',
  },
  modalTitle: {
    fontSize: '22px',
    fontWeight: 700,
    color: '#0A2342',
    margin: 0,
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: '#2E4A6B',
    padding: '4px',
  },
  modalBody: {
    padding: '24px 32px',
  },
  twoCol: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '16px',
  },
  field: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '4px',
    marginBottom: '16px',
  },
  label: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#0A2342',
  },
  input: {
    padding: '8px 12px',
    fontSize: '14px',
    border: '1px solid #CCC',
    borderRadius: '4px',
    color: '#0A2342',
    outline: 'none',
    boxSizing: 'border-box' as const,
    width: '100%',
  },
  formSelect: {
    padding: '8px 12px',
    fontSize: '14px',
    border: '1px solid #CCC',
    borderRadius: '4px',
    color: '#0A2342',
    background: '#FFFFFF',
    cursor: 'pointer',
    boxSizing: 'border-box' as const,
    width: '100%',
  },
  toggleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    cursor: 'pointer',
    userSelect: 'none' as const,
  },
  modalFooter: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '12px',
    padding: '16px 32px 24px',
    borderTop: '1px solid #E2E8F0',
  },
  cancelBtn: {
    padding: '8px 24px',
    fontSize: '14px',
    fontWeight: 600,
    color: '#2E4A6B',
    background: '#FFFFFF',
    border: '1px solid #CCC',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  saveBtn: {
    padding: '8px 24px',
    fontSize: '14px',
    fontWeight: 600,
    color: '#FFFFFF',
    backgroundColor: '#0A2342',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
  },
};

// Boats are fetched per-customer via the API inside the modal
const CUSTOMER_BOATS: Record<string, { id: string; name: string }[]> = {};

/* ── Contract Form Modal ─────────────────────────────────── */

function ContractFormModal({ onClose, onSave }: { onClose: () => void; onSave?: (data: Record<string, unknown>) => void }) {
  const [autoRenew, setAutoRenew] = useState(false);
  const [customer, setCustomer] = useState('');
  const [slip, setSlip] = useState('');
  const [boat, setBoat] = useState('');
  const [product, setProduct] = useState('');
  const [billingCycle, setBillingCycle] = useState('Monthly');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [rate, setRate] = useState('');
  const [deposit, setDeposit] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const { data: productsData } = useApi<{ data: { id: string; name: string; priceCents: number }[]; total: number }>(
    'get', '/api/inventory/products?take=100&sortBy=name&sortOrder=asc', { immediate: true },
  );
  const catalogProducts = (productsData?.data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    rate: p.priceCents / 100,
    label: `${p.name} - $${(p.priceCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}/mo`,
  }));

  const availableBoats = customer ? (CUSTOMER_BOATS[customer] || []) : [];

  const handleProductChange = (productId: string) => {
    setProduct(productId);
    const prod = catalogProducts.find((p) => p.id === productId);
    if (prod) {
      setRate(String(prod.rate));
    }
  };

  const handleCustomerChange = (val: string) => {
    setCustomer(val);
    setBoat('');
  };

  const handleSave = async () => {
    if (!customer || !slip || !boat || !startDate || !endDate || !rate) {
      setError('Please fill in all required fields.');
      return;
    }
    setError('');
    setSaving(true);
    await onSave?.({
      customerId: customer,
      slipNumber: slip,
      boatId: boat,
      productId: product || undefined,
      billingCycle,
      startDate,
      endDate,
      rateCents: Math.round(parseFloat(rate) * 100),
      depositCents: deposit ? Math.round(parseFloat(deposit) * 100) : 0,
      autoRenew,
    });
    setSaving(false);
    onClose();
  };

  return (
    <div style={st.overlay} onClick={onClose}>
      <div style={st.modal} className="helm-modal" onClick={(e) => e.stopPropagation()}>
        <div style={st.modalHeader}>
          <h2 style={st.modalTitle}>New Contract</h2>
          <button style={st.closeBtn} onClick={onClose}><X size={20} /></button>
        </div>
        <div style={st.modalBody}>
          {error && <div style={{ color: '#DC2626', fontSize: 13, marginBottom: 12, padding: '8px 12px', background: '#FEF2F2', borderRadius: 6 }}>{error}</div>}
          <div style={st.twoCol} className="helm-form-grid">
            <div style={st.field}>
              <label style={st.label}>Customer *</label>
              <select style={st.formSelect} value={customer} onChange={(e) => handleCustomerChange(e.target.value)}>
                <option value="">Select customer...</option>
                <option value="james-harborview">James Harborview</option>
                <option value="maria-seabreeze">Maria Seabreeze</option>
                <option value="robert-dockside">Robert Dockside</option>
                <option value="susan-baywatch">Susan Baywatch</option>
                <option value="david-tidewater">David Tidewater</option>
                <option value="elena-windward">Elena Windward</option>
              </select>
            </div>
            <div style={st.field}>
              <label style={st.label}>Slip *</label>
              <select style={st.formSelect} value={slip} onChange={(e) => setSlip(e.target.value)}>
                <option value="">Select slip...</option>
                <option value="A-01">A-01</option>
                <option value="A-02">A-02</option>
                <option value="A-03">A-03 (Vacant)</option>
                <option value="A-04">A-04 (Reserved)</option>
                <option value="B-01">B-01</option>
                <option value="B-02">B-02 (Maintenance)</option>
                <option value="B-03">B-03 (Vacant)</option>
                <option value="C-01">C-01</option>
                <option value="C-02">C-02 (Vacant)</option>
                <option value="C-03">C-03 (Vacant)</option>
              </select>
            </div>
            <div style={st.field}>
              <label style={st.label}>Boat *</label>
              <select style={st.formSelect} value={boat} onChange={(e) => setBoat(e.target.value)} disabled={!customer}>
                <option value="">Select boat...</option>
                {availableBoats.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
              {customer && availableBoats.length === 0 && <span style={{ fontSize: '12px', color: '#64748B' }}>No boats on file for this customer</span>}
            </div>
            <div style={st.field}>
              <label style={st.label}>Product (Dockage Rate)</label>
              <select style={st.formSelect} value={product} onChange={(e) => handleProductChange(e.target.value)}>
                <option value="">Select product...</option>
                {catalogProducts.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </div>
            <div style={st.field}>
              <label style={st.label}>Billing Cycle *</label>
              <select style={st.formSelect} value={billingCycle} onChange={(e) => setBillingCycle(e.target.value)}>
                <option value="Monthly">Monthly</option>
                <option value="Quarterly">Quarterly</option>
                <option value="Semi-Annual">Semi-Annual</option>
                <option value="Annual">Annual</option>
                <option value="Seasonal">Seasonal</option>
              </select>
            </div>
            <div style={st.field}>
              <label style={st.label}>Start Date *</label>
              <input style={st.input} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div style={st.field}>
              <label style={st.label}>End Date *</label>
              <input style={st.input} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
            <div style={st.field}>
              <label style={st.label}>Rate ($/period) *{product ? ' (from product)' : ''}</label>
              <input style={{ ...st.input, fontFamily: '"JetBrains Mono", monospace' }} type="number" placeholder="0.00" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} />
            </div>
            <div style={st.field}>
              <label style={st.label}>Security Deposit</label>
              <input style={{ ...st.input, fontFamily: '"JetBrains Mono", monospace' }} type="number" placeholder="0.00" step="0.01" value={deposit} onChange={(e) => setDeposit(e.target.value)} />
            </div>
          </div>
          <div style={{ marginTop: '8px' }}>
            <div
              style={st.toggleRow}
              onClick={() => setAutoRenew(!autoRenew)}
            >
              {autoRenew ? (
                <ToggleRight size={24} style={{ color: '#00D4FF' }} />
              ) : (
                <ToggleLeft size={24} style={{ color: '#CCC' }} />
              )}
              <span style={{ fontSize: '14px', fontWeight: 600, color: '#0A2342' }}>Auto-Renew</span>
            </div>
          </div>
        </div>
        <div style={st.modalFooter}>
          <button style={st.cancelBtn} onClick={onClose}>Cancel</button>
          <button style={{ ...st.saveBtn, opacity: saving ? 0.7 : 1 }} onClick={handleSave} disabled={saving}>
            {saving ? 'Creating...' : 'Create Contract'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Contract Detail / Transfer Modal ───────────────────── */

const AVAILABLE_SLIPS = [
  'A-03 (Vacant)', 'B-02 (Vacant)', 'B-03 (Vacant)', 'C-02 (Vacant)', 'C-03 (Vacant)',
  'D-01 (Vacant)', 'D-02 (Vacant)', 'D-04 (Vacant)',
];

function ContractDetailModal({
  contract,
  onClose,
  onTransfer,
  onUpdate,
}: {
  contract: Contract;
  onClose: () => void;
  onTransfer: (contractId: string, newSlip: string, effectiveDate: string, notes: string) => void;
  onUpdate: (id: string, changes: Partial<Contract>) => void;
}) {
  const [mode, setMode] = useState<'view' | 'edit' | 'transfer'>('view');

  /* ── Edit state ── */
  const [rate, setRate] = useState(String(contract.rate));
  const [billingCycle, setBillingCycle] = useState(contract.billingCycle);
  const [endDate, setEndDate] = useState(contract.end);
  const [autoRenew, setAutoRenew] = useState(contract.autoRenew);
  const [deposit, setDeposit] = useState(String(contract.securityDeposit));
  const [status, setStatus] = useState<ContractStatus>(contract.status);
  const [billingItemId, setBillingItemId] = useState(contract.billingItemId ?? '');
  const [glRevenueAccount, setGlRevenueAccount] = useState(contract.glRevenueAccount ?? '4100');
  const [glCogsAccount, setGlCogsAccount] = useState(contract.glCogsAccount ?? '5500');
  const [saving, setSaving] = useState(false);

  /* ── Transfer state ── */
  const [newSlip, setNewSlip] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [transferNotes, setTransferNotes] = useState('');
  const [transferring, setTransferring] = useState(false);

  const fmt = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2 });

  const handleSave = () => {
    setSaving(true);
    onUpdate(contract.id, {
      rate: parseFloat(rate) || contract.rate,
      billingCycle,
      end: endDate,
      autoRenew,
      securityDeposit: parseFloat(deposit) || contract.securityDeposit,
      status,
      billingItemId: billingItemId || undefined,
      glRevenueAccount,
      glCogsAccount,
    });
    setSaving(false);
    setMode('view');
  };

  const handleTransfer = () => {
    if (!newSlip || !effectiveDate) return;
    setTransferring(true);
    onTransfer(contract.id, newSlip.split(' ')[0], effectiveDate, transferNotes);
    setTransferring(false);
    onClose();
  };

  const infoRow: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #F1F5F9', fontSize: '14px' };
  const infoLabel: React.CSSProperties = { color: '#64748B', fontWeight: 600 };
  const infoValue: React.CSSProperties = { color: '#0A2342', fontWeight: 500, textAlign: 'right' as const };
  const sc = statusColors[contract.status];

  return (
    <div style={st.overlay} onClick={onClose}>
      <div style={{ ...st.modal, width: '680px' }} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{ ...st.modalHeader, backgroundColor: '#0A2342' }}>
          <div>
            <h2 style={{ ...st.modalTitle, color: '#FFFFFF', fontSize: '18px' }}>{contract.number}</h2>
            <div style={{ fontSize: '13px', color: '#94A3B8', marginTop: '2px' }}>{contract.customer} &middot; {contract.boatName}</div>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {mode === 'view' && (
              <>
                <button style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '6px 12px', fontSize: '12px', fontWeight: 600, borderRadius: '6px', border: '1px solid rgba(255,255,255,0.25)', backgroundColor: 'rgba(255,255,255,0.1)', color: '#FFFFFF', cursor: 'pointer' }} onClick={() => setMode('edit')}>
                  <Edit2 size={13} /> Edit
                </button>
                <button style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '6px 12px', fontSize: '12px', fontWeight: 600, borderRadius: '6px', border: '1px solid rgba(0,212,255,0.5)', backgroundColor: 'rgba(0,212,255,0.15)', color: '#00D4FF', cursor: 'pointer' }} onClick={() => setMode('transfer')}>
                  <Repeat size={13} /> Transfer Slip
                </button>
              </>
            )}
            <button style={{ ...st.closeBtn, color: '#FFFFFF' }} onClick={onClose}><X size={20} /></button>
          </div>
        </div>

        {/* ── View Mode ── */}
        {mode === 'view' && (
          <div style={{ padding: '24px 32px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <span style={{ ...st.badge, backgroundColor: sc.bg, color: sc.color, border: sc.border ? `1px solid ${sc.border}` : 'none', fontSize: '13px', padding: '4px 14px' }}>{contract.status}</span>
              <span style={{ fontSize: '13px', color: '#64748B' }}>Auto-Renew: <strong style={{ color: '#0A2342' }}>{contract.autoRenew ? 'Yes' : 'No'}</strong></span>
            </div>
            <div style={infoRow}><span style={infoLabel}>Slip</span><span style={{ ...infoValue, fontWeight: 700, fontSize: '15px' }}>{contract.slip}</span></div>
            <div style={infoRow}><span style={infoLabel}>Customer</span><span style={infoValue}>{contract.customer}</span></div>
            <div style={infoRow}><span style={infoLabel}>Boat</span><span style={infoValue}>{contract.boatName}</span></div>
            <div style={infoRow}><span style={infoLabel}>Billing Cycle</span><span style={infoValue}>{contract.billingCycle}</span></div>
            <div style={infoRow}><span style={infoLabel}>Rate</span><span style={{ ...infoValue, fontFamily: '"JetBrains Mono", monospace', fontSize: '16px', fontWeight: 700, color: '#0A2342' }}>{fmt(contract.rate)}/{contract.billingCycle === 'Monthly' ? 'mo' : contract.billingCycle === 'Annual' ? 'yr' : 'period'}</span></div>
            <div style={infoRow}><span style={infoLabel}>Start Date</span><span style={infoValue}>{contract.start}</span></div>
            <div style={infoRow}><span style={infoLabel}>End Date</span><span style={infoValue}>{contract.end}</span></div>
            <div style={{ ...infoRow, borderBottom: 'none' }}><span style={infoLabel}>Security Deposit</span><span style={{ ...infoValue, fontFamily: '"JetBrains Mono", monospace' }}>{fmt(contract.securityDeposit)}</span></div>
          </div>
        )}

        {/* ── Edit Mode ── */}
        {mode === 'edit' && (
          <>
            <div style={st.modalBody}>
              <div style={st.twoCol} className="helm-form-grid">
                <div style={st.field}>
                  <label style={st.label}>Status</label>
                  <select style={st.formSelect} value={status} onChange={(e) => setStatus(e.target.value as ContractStatus)}>
                    <option value="Draft">Draft</option>
                    <option value="Active">Active</option>
                    <option value="Expiring">Expiring</option>
                    <option value="Expired">Expired</option>
                    <option value="Terminated">Terminated</option>
                    <option value="Renewed">Renewed</option>
                  </select>
                </div>
                <div style={st.field}>
                  <label style={st.label}>Billing Cycle</label>
                  <select style={st.formSelect} value={billingCycle} onChange={(e) => setBillingCycle(e.target.value)}>
                    <option value="Monthly">Monthly</option>
                    <option value="Quarterly">Quarterly</option>
                    <option value="Semi-Annual">Semi-Annual</option>
                    <option value="Annual">Annual</option>
                    <option value="Seasonal">Seasonal</option>
                  </select>
                </div>
                <div style={st.field}>
                  <label style={st.label}>Rate ($/period)</label>
                  <input style={{ ...st.input, fontFamily: '"JetBrains Mono", monospace' }} type="number" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} />
                </div>
                <div style={st.field}>
                  <label style={st.label}>Security Deposit</label>
                  <input style={{ ...st.input, fontFamily: '"JetBrains Mono", monospace' }} type="number" step="0.01" value={deposit} onChange={(e) => setDeposit(e.target.value)} />
                </div>
                <div style={st.field}>
                  <label style={st.label}>End Date</label>
                  <input style={st.input} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                </div>
                <div style={{ ...st.field, justifyContent: 'flex-end' }}>
                  <div style={{ ...st.toggleRow, marginTop: '24px' }} onClick={() => setAutoRenew(!autoRenew)}>
                    {autoRenew ? <ToggleRight size={24} style={{ color: '#00D4FF' }} /> : <ToggleLeft size={24} style={{ color: '#CCC' }} />}
                    <span style={{ fontSize: '14px', fontWeight: 600, color: '#0A2342' }}>Auto-Renew</span>
                  </div>
                </div>
              </div>
              <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '2px solid #E2E8F0' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#0A2342', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: '14px' }}>GL / Billing Mapping</div>
                <div style={st.twoCol} className="helm-form-grid">
                  <div style={{ ...st.field, gridColumn: '1 / -1' }}>
                    <label style={st.label}>Billing Item</label>
                    <select style={st.formSelect} value={billingItemId} onChange={(e) => setBillingItemId(e.target.value)}>
                      <option value="">— None / Manual —</option>
                      {BILLING_ITEMS.map((bi) => <option key={bi.id} value={bi.id}>{bi.id} — {bi.label}</option>)}
                    </select>
                  </div>
                  <div style={st.field}>
                    <label style={st.label}>GL Revenue Account</label>
                    <select style={st.formSelect} value={glRevenueAccount} onChange={(e) => setGlRevenueAccount(e.target.value)}>
                      {GL_REVENUE_ACCOUNTS.map((a) => <option key={a.code} value={a.code}>{a.label}</option>)}
                    </select>
                  </div>
                  <div style={st.field}>
                    <label style={st.label}>GL COGS Account</label>
                    <select style={st.formSelect} value={glCogsAccount} onChange={(e) => setGlCogsAccount(e.target.value)}>
                      {GL_COGS_ACCOUNTS.map((a) => <option key={a.code} value={a.code}>{a.label}</option>)}
                    </select>
                  </div>
                </div>
              </div>
            </div>
            <div style={st.modalFooter}>
              <button style={st.cancelBtn} onClick={() => setMode('view')}>Cancel</button>
              <button style={{ ...st.saveBtn, opacity: saving ? 0.7 : 1 }} onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</button>
            </div>
          </>
        )}

        {/* ── Transfer Mode ── */}
        {mode === 'transfer' && (
          <>
            <div style={st.modalBody}>
              <div style={{ padding: '12px 16px', borderRadius: '8px', backgroundColor: '#F0F9FF', border: '1px solid #BAE6FD', marginBottom: '20px', fontSize: '13px', color: '#0369A1' }}>
                Transferring contract <strong>{contract.number}</strong> from slip <strong>{contract.slip}</strong> to a new slip. The current contract will be ended on the effective date and a new contract will be created on the destination slip.
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px', padding: '16px', backgroundColor: '#F8FAFC', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
                <div style={{ textAlign: 'center' as const, flex: 1 }}>
                  <div style={{ fontSize: '11px', color: '#64748B', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: '4px' }}>From Slip</div>
                  <div style={{ fontSize: '22px', fontWeight: 700, color: '#0A2342' }}>{contract.slip}</div>
                </div>
                <ArrowRight size={24} color="#00D4FF" />
                <div style={{ textAlign: 'center' as const, flex: 1 }}>
                  <div style={{ fontSize: '11px', color: '#64748B', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: '4px' }}>To Slip</div>
                  <div style={{ fontSize: '22px', fontWeight: 700, color: newSlip ? '#0A2342' : '#CBD5E1' }}>{newSlip ? newSlip.split(' ')[0] : '—'}</div>
                </div>
              </div>
              <div style={st.field}>
                <label style={st.label}>New Slip *</label>
                <select style={st.formSelect} value={newSlip} onChange={(e) => setNewSlip(e.target.value)}>
                  <option value="">Select available slip...</option>
                  {AVAILABLE_SLIPS.map((sl) => (
                    <option key={sl} value={sl}>{sl}</option>
                  ))}
                </select>
              </div>
              <div style={st.field}>
                <label style={st.label}>Effective Date *</label>
                <input style={st.input} type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
              </div>
              <div style={st.field}>
                <label style={st.label}>Reason / Notes</label>
                <textarea style={{ ...st.input, minHeight: '72px', resize: 'vertical' as const }} placeholder="Reason for transfer (e.g. upgraded to larger slip, maintenance on current slip...)" value={transferNotes} onChange={(e) => setTransferNotes(e.target.value)} />
              </div>
            </div>
            <div style={st.modalFooter}>
              <button style={st.cancelBtn} onClick={() => setMode('view')}>Back</button>
              <button
                style={{ ...st.saveBtn, opacity: (!newSlip || !effectiveDate || transferring) ? 0.5 : 1, display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                onClick={handleTransfer}
                disabled={!newSlip || !effectiveDate || transferring}
              >
                <Repeat size={15} />
                {transferring ? 'Transferring…' : 'Transfer Contract'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ── Main Component ──────────────────────────────────────── */

export default function Contracts() {
  const [statusFilter, setStatusFilter] = useState('All');
  const [cycleFilter, setCycleFilter] = useState('All');
  const [expiringFilter, setExpiringFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [viewingContract, setViewingContract] = useState<Contract | null>(null);
  const [localContracts, setLocalContracts] = useState<Contract[]>([]);
  const [esignContract, setEsignContract] = useState<Contract | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchSending, setBatchSending] = useState(false);

  const { data: apiContracts, loading, error } = useApi<Contract[]>('get', '/api/contracts', { immediate: true });
  const createContract = useApi<Contract>('post', '/api/contracts');
  const updateContractApi = useApi<Contract>('put', '/api/contracts/update');
  const transferContractApi = useApi<Contract>('post', '/api/contracts/transfer');

  const contracts = localContracts.length > 0 ? localContracts : (apiContracts || []);

  const handleUpdate = (id: string, changes: Partial<Contract>) => {
    const updated = contracts.map((c) => c.id === id ? { ...c, ...changes } : c);
    setLocalContracts(updated);
    if (viewingContract?.id === id) setViewingContract({ ...viewingContract, ...changes });
    updateContractApi.execute({ body: { id, ...changes } }).catch(() => {});
  };

  const handleTransfer = (contractId: string, newSlip: string, effectiveDate: string, notes: string) => {
    const orig = contracts.find((c) => c.id === contractId);
    if (!orig) return;
    const updated = contracts.map((c) =>
      c.id === contractId ? { ...c, slip: newSlip, status: 'Active' as ContractStatus } : c
    );
    setLocalContracts(updated);
    transferContractApi.execute({ body: { contractId, newSlip, effectiveDate, notes } }).catch(() => {});
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = (filteredContracts: Contract[]) => {
    if (selectedIds.size === filteredContracts.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredContracts.map((c) => c.id)));
    }
  };

  const handleBatchSend = async () => {
    if (selectedIds.size === 0) return;
    setBatchSending(true);
    try {
      const res = await fetch('/api/contracts/bulk-send-for-signature', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contractIds: Array.from(selectedIds) }),
      });
      if (res.ok) {
        const updated = contracts.map((c) =>
          selectedIds.has(c.id) ? { ...c, signatureStatus: 'pending' as SignatureStatus } : c
        );
        setLocalContracts(updated);
        setSelectedIds(new Set());
      }
    } catch {
      // silently fail
    } finally {
      setBatchSending(false);
    }
  };

  const handleEsignSent = () => {
    if (esignContract) {
      const updated = contracts.map((c) =>
        c.id === esignContract.id ? { ...c, signatureStatus: 'pending' as SignatureStatus } : c
      );
      setLocalContracts(updated);
    }
  };

  const now = new Date();
  const filtered = contracts.filter((c) => {
    if (statusFilter !== 'All' && c.status !== statusFilter) return false;
    if (cycleFilter !== 'All' && c.billingCycle !== cycleFilter) return false;
    if (expiringFilter !== 'All') {
      const days = parseInt(expiringFilter);
      const end = new Date(c.end);
      const diff = (end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      if (diff < 0 || diff > days) return false;
    }
    if (search) {
      const q = search.toLowerCase();
      const match =
        c.number.toLowerCase().includes(q) ||
        c.customer.toLowerCase().includes(q) ||
        c.slip.toLowerCase().includes(q);
      if (!match) return false;
    }
    return true;
  });

  const fmt = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2 });

  return (
    <div style={st.page}>
      <h1 style={st.title} className="helm-page-title">Contracts</h1>
      <hr style={st.divider} />

      {loading && <div style={{ textAlign: 'center', padding: '24px', color: '#64748B' }}>Loading contracts...</div>}

      {/* Filter Bar */}
      <div style={st.filterBar} className="helm-filter-bar">
        <select style={st.select} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="All">All Statuses</option>
          <option value="Draft">Draft</option>
          <option value="Active">Active</option>
          <option value="Expiring">Expiring</option>
          <option value="Expired">Expired</option>
          <option value="Terminated">Terminated</option>
          <option value="Renewed">Renewed</option>
        </select>

        <select style={st.select} value={cycleFilter} onChange={(e) => setCycleFilter(e.target.value)}>
          <option value="All">All Cycles</option>
          <option value="Monthly">Monthly</option>
          <option value="Quarterly">Quarterly</option>
          <option value="Semi-Annual">Semi-Annual</option>
          <option value="Annual">Annual</option>
          <option value="Seasonal">Seasonal</option>
        </select>

        <select style={st.select} value={expiringFilter} onChange={(e) => setExpiringFilter(e.target.value)}>
          <option value="All">Expiring Within</option>
          <option value="30">30 days</option>
          <option value="60">60 days</option>
          <option value="90">90 days</option>
        </select>

        <div style={st.searchWrap}>
          <Search size={16} style={st.searchIcon} />
          <input
            style={st.searchInput}
            placeholder="Search contract #, customer, or slip..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {selectedIds.size > 0 && (
          <button
            style={{ ...st.addButton, backgroundColor: '#0369A1', opacity: batchSending ? 0.6 : 1 }}
            onClick={handleBatchSend}
            disabled={batchSending}
          >
            <Send size={15} /> {batchSending ? 'Sending...' : `Send Batch for Signature (${selectedIds.size})`}
          </button>
        )}

        <button style={st.addButton} onClick={() => setShowForm(true)}>
          <Plus size={16} /> New Contract
        </button>
      </div>

      {/* Data Table */}
      {filtered.length > 0 ? (
        <div style={st.tableWrap} className="helm-table-wrap">
          <table style={st.table}>
            <thead>
              <tr>
                <th style={{ ...st.th, width: '40px', textAlign: 'center' }}>
                  <button
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    onClick={() => toggleSelectAll(filtered)}
                  >
                    {selectedIds.size === filtered.length && filtered.length > 0 ? <CheckSquare size={16} /> : <Square size={16} />}
                  </button>
                </th>
                <th style={st.th}>Contract #</th>
                <th style={st.th}>Customer</th>
                <th style={st.th}>Boat</th>
                <th style={st.th}>Slip</th>
                <th style={st.th}>Rate</th>
                <th style={st.th}>Billing</th>
                <th style={st.th}>Start</th>
                <th style={st.th}>End</th>
                <th style={st.th}>Status</th>
                <th style={st.th}>Signature</th>
                <th style={st.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c, idx) => {
                const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#D6E8F4';
                const sc = statusColors[c.status];
                const sigSt = c.signatureStatus ? sigStatusColors[c.signatureStatus] : null;
                const isSelected = selectedIds.has(c.id);
                return (
                  <tr key={c.id} style={{ backgroundColor: isSelected ? '#EFF6FF' : undefined }}>
                    <td style={{ ...st.td, backgroundColor: isSelected ? '#EFF6FF' : rowBg, textAlign: 'center' }}>
                      <button
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#0A2342', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        onClick={() => toggleSelect(c.id)}
                      >
                        {isSelected ? <CheckSquare size={16} color="#0A2342" /> : <Square size={16} color="#94A3B8" />}
                      </button>
                    </td>
                    <td style={{ ...st.td, backgroundColor: isSelected ? '#EFF6FF' : rowBg, fontWeight: 600, ...st.mono }}>{c.number}</td>
                    <td style={{ ...st.td, backgroundColor: isSelected ? '#EFF6FF' : rowBg }}>{c.customer}</td>
                    <td style={{ ...st.td, backgroundColor: isSelected ? '#EFF6FF' : rowBg }}><span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Ship size={14} color="#2E4A6B" />{c.boatName}</span></td>
                    <td style={{ ...st.td, backgroundColor: isSelected ? '#EFF6FF' : rowBg, fontWeight: 600 }}>{c.slip}</td>
                    <td style={{ ...st.td, backgroundColor: isSelected ? '#EFF6FF' : rowBg, ...st.mono }}>{fmt(c.rate)}</td>
                    <td style={{ ...st.td, backgroundColor: isSelected ? '#EFF6FF' : rowBg }}>{c.billingCycle}</td>
                    <td style={{ ...st.td, backgroundColor: isSelected ? '#EFF6FF' : rowBg, color: '#64748B' }}>{c.start}</td>
                    <td style={{ ...st.td, backgroundColor: isSelected ? '#EFF6FF' : rowBg, color: '#64748B' }}>{c.end}</td>
                    <td style={{ ...st.td, backgroundColor: isSelected ? '#EFF6FF' : rowBg }}>
                      <span
                        style={{
                          ...st.badge,
                          backgroundColor: sc.bg,
                          color: sc.color,
                          border: sc.border ? `1px solid ${sc.border}` : 'none',
                        }}
                      >
                        {c.status}
                      </span>
                    </td>
                    <td style={{ ...st.td, backgroundColor: isSelected ? '#EFF6FF' : rowBg }}>
                      {sigSt ? (
                        <span style={{ ...st.badge, backgroundColor: sigSt.bg, color: sigSt.color }}>
                          {sigSt.label}
                        </span>
                      ) : (
                        <span style={{ fontSize: '12px', color: '#94A3B8' }}>Unsigned</span>
                      )}
                    </td>
                    <td style={{ ...st.td, backgroundColor: isSelected ? '#EFF6FF' : rowBg }}>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <button
                          style={{ background: 'none', border: 'none', color: '#00D4FF', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}
                          onClick={() => setViewingContract(c)}
                        >
                          View
                        </button>
                        {c.signatureStatus !== 'signed' && c.status !== 'Terminated' && (
                          <button
                            style={{ background: 'none', border: 'none', color: '#0A2342', cursor: 'pointer', fontWeight: 600, fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '3px' }}
                            onClick={() => setEsignContract(c)}
                            title="Send for Signature"
                          >
                            <PenTool size={13} /> Sign
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={st.emptyState}>
          <FileText size={32} style={{ marginBottom: '16px', color: '#2E4A6B' }} />
          <h3 style={{ fontSize: '20px', fontWeight: 600, color: '#0A2342', margin: '0 0 8px 0' }}>
            No contracts found
          </h3>
          <p style={{ fontSize: '15px', color: '#64748B', lineHeight: 1.6, margin: '0 0 24px 0' }}>
            {search || statusFilter !== 'All'
              ? 'Try adjusting your filters or search terms.'
              : 'Create a slip contract to start billing a customer.'}
          </p>
          <button style={st.addButton} onClick={() => setShowForm(true)}>
            <Plus size={16} /> New Contract
          </button>
        </div>
      )}

      {showForm && <ContractFormModal onClose={() => setShowForm(false)} onSave={(data) => createContract.execute(data)} />}
      {viewingContract && (
        <ContractDetailModal
          contract={viewingContract}
          onClose={() => setViewingContract(null)}
          onUpdate={handleUpdate}
          onTransfer={handleTransfer}
        />
      )}
      {esignContract && (
        <ESignatureFlow
          contractId={esignContract.id}
          contractNumber={esignContract.number}
          customerName={esignContract.customer}
          customerEmail={esignContract.customerEmail}
          onClose={() => setEsignContract(null)}
          onSent={handleEsignSent}
        />
      )}
    </div>
  );
}
