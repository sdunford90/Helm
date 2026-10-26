import React, { useState } from 'react';
import { FileText, Search, Plus, X, Calendar, ToggleLeft, ToggleRight, Ship, ArrowRight, Edit2, Repeat, Send, CheckSquare, Square, PenTool } from 'lucide-react';
import { useApiClient, useList } from '../hooks/useApi';
import { errorMessage } from '../lib/api';
import { customerName, type ContractDTO, type CustomerRef } from '../lib/dto';
import { formatCents, formatDate, todayKey, toDateKey } from '../lib/format';
import CustomerPicker from '../components/CustomerPicker';
import SlipSelect from '../components/SlipSelect';
import { ComingSoonButton, ErrorState, LoadingState, Pager } from '../components/StateViews';
import { useToast } from '../components/Toast';

/** E-sign is disabled until a real provider exists: the API fakes the request id and sends nothing. */
const ESIGN_DISABLED_REASON = 'Coming soon: e-signature is not connected to a signing provider yet, so nothing would be sent.';

/* ── Types ─────────────────────────────────────────────── */

type ContractStatus = 'Draft' | 'Active' | 'Expiring' | 'Expired' | 'Terminated' | 'Renewed';

type SignatureStatus = 'signed' | 'sent' | 'pending' | 'viewed' | 'declined' | null;

interface Contract {
  id: string;
  number: string;
  customer: string;
  customerId: string;
  slip: string;
  rate: number;
  billingCycle: string;
  start: string;
  end: string;
  status: ContractStatus;
  boatName: string;
  securityDeposit: number;
  autoRenew: boolean;
  signatureStatus: SignatureStatus;
}

const STATUS_LABEL: Record<ContractDTO['status'], ContractStatus> = {
  DRAFT: 'Draft', ACTIVE: 'Active', EXPIRING: 'Expiring', EXPIRED: 'Expired', TERMINATED: 'Terminated', RENEWED: 'Renewed',
};
const CYCLE_LABEL: Record<ContractDTO['billingCycle'], string> = {
  MONTHLY: 'Monthly', QUARTERLY: 'Quarterly', SEMI_ANNUAL: 'Semi-Annual', ANNUAL: 'Annual',
};
const CYCLE_ENUM: Record<string, ContractDTO['billingCycle']> = {
  Monthly: 'MONTHLY', Quarterly: 'QUARTERLY', 'Semi-Annual': 'SEMI_ANNUAL', Annual: 'ANNUAL',
};
const STATUS_ENUM: Record<string, ContractDTO['status']> = {
  Draft: 'DRAFT', Active: 'ACTIVE', Expiring: 'EXPIRING', Expired: 'EXPIRED', Terminated: 'TERMINATED', Renewed: 'RENEWED',
};

function toContract(c: ContractDTO): Contract {
  const sig = (c.esignStatus ?? null) as SignatureStatus;
  return {
    id: c.id,
    // The API has no human contract number yet; show a short form of the id.
    number: c.id.slice(0, 8).toUpperCase(),
    customer: customerName(c.customer),
    customerId: c.customerId,
    slip: c.slip?.slipNumber ?? '—',
    rate: c.rateCents,
    billingCycle: CYCLE_LABEL[c.billingCycle] ?? c.billingCycle,
    start: c.startDate,
    end: c.endDate ?? '',
    status: STATUS_LABEL[c.status] ?? 'Draft',
    boatName: c.boat?.name ?? '—',
    securityDeposit: c.securityDepositCents ?? 0,
    autoRenew: c.autoRenew,
    signatureStatus: sig,
  };
}

const PAGE_SIZE = 25;

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
  sent: { bg: '#FFF3CD', color: '#856404', label: 'Sent' },
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

/* ── Contract Form Modal ─────────────────────────────────── */

function ContractFormModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const client = useApiClient();
  const [autoRenew, setAutoRenew] = useState(false);
  const [customer, setCustomer] = useState<CustomerRef | null>(null);
  const [slip, setSlip] = useState('');
  const [boat, setBoat] = useState('');
  const [billingCycle, setBillingCycle] = useState<ContractDTO['billingCycle']>('MONTHLY');
  const [startDate, setStartDate] = useState(todayKey());
  const [endDate, setEndDate] = useState('');
  const [rate, setRate] = useState('');
  const [deposit, setDeposit] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const boats = useList<{ id: string; name: string | null; lengthFt: number }>(customer ? `/boats?customerId=${customer.id}&take=100` : null);
  const selectedBoat = boats.items.find((b) => b.id === boat);

  const handleSave = async () => {
    if (!customer || !slip || !boat || !startDate || !endDate || !rate) {
      setError('Please fill in all required fields.');
      return;
    }
    if (endDate <= startDate) { setError('End date must be after the start date.'); return; }
    const rateCents = Math.round(Number(rate) * 100);
    if (!(rateCents > 0)) { setError('Rate must be greater than $0.00.'); return; }
    setError('');
    setSaving(true);
    try {
      await client.post('/contracts', {
        customerId: customer.id,
        slipId: slip,
        boatId: boat,
        billingCycle,
        startDate,
        endDate,
        rateCents,
        securityDepositCents: deposit ? Math.round(Number(deposit) * 100) : null,
        autoRenew,
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={st.overlay} onClick={() => { if (!saving) onClose(); }}>
      <div style={st.modal} className="helm-modal" role="dialog" aria-modal="true" aria-label="New contract" onClick={(e) => e.stopPropagation()}>
        <div style={st.modalHeader}>
          <h2 style={st.modalTitle}>New Contract</h2>
          <button style={st.closeBtn} onClick={onClose} disabled={saving} aria-label="Close"><X size={20} /></button>
        </div>
        <div style={st.modalBody}>
          {error && <div role="alert" style={{ color: '#DC2626', fontSize: 13, marginBottom: 12, padding: '8px 12px', background: '#FEF2F2', borderRadius: 6 }}>{error}</div>}
          <div style={st.twoCol} className="helm-form-grid">
            <div style={st.field}>
              <label style={st.label}>Customer *</label>
              <CustomerPicker value={customer} onChange={(c) => { setCustomer(c); setBoat(''); }} inputStyle={st.input} />
            </div>
            <div style={st.field}>
              <label style={st.label}>Boat *</label>
              <select style={st.formSelect} value={boat} onChange={(e) => setBoat(e.target.value)} disabled={!customer || boats.loading}>
                <option value="">{boats.loading ? 'Loading boats…' : 'Select boat...'}</option>
                {boats.items.map((b) => (
                  <option key={b.id} value={b.id}>{b.name ?? 'Unnamed'} ({b.lengthFt}')</option>
                ))}
              </select>
              {boats.error && <span style={{ fontSize: '12px', color: '#B71C1C' }}>{boats.error}</span>}
              {customer && !boats.loading && !boats.error && boats.items.length === 0 && <span style={{ fontSize: '12px', color: '#64748B' }}>No boats on file for this customer</span>}
            </div>
            <div style={st.field}>
              <label style={st.label}>Slip * (vacant)</label>
              <SlipSelect style={st.formSelect} value={slip} onChange={(id) => setSlip(id)} minLengthFt={selectedBoat?.lengthFt ?? null} />
            </div>
            <div style={st.field}>
              <label style={st.label}>Billing Cycle *</label>
              <select style={st.formSelect} value={billingCycle} onChange={(e) => setBillingCycle(e.target.value as ContractDTO['billingCycle'])}>
                <option value="MONTHLY">Monthly</option>
                <option value="QUARTERLY">Quarterly</option>
                <option value="SEMI_ANNUAL">Semi-Annual</option>
                <option value="ANNUAL">Annual</option>
              </select>
            </div>
            <div style={st.field}>
              <label style={st.label}>Start Date *</label>
              <input style={st.input} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div style={st.field}>
              <label style={st.label}>End Date *</label>
              <input style={st.input} type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
            <div style={st.field}>
              <label style={st.label}>Rate ($/period) *</label>
              <input style={{ ...st.input, fontFamily: '"JetBrains Mono", monospace' }} type="number" placeholder="0.00" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} />
            </div>
            <div style={st.field}>
              <label style={st.label}>Security Deposit</label>
              <input style={{ ...st.input, fontFamily: '"JetBrains Mono", monospace' }} type="number" placeholder="0.00" step="0.01" value={deposit} onChange={(e) => setDeposit(e.target.value)} />
            </div>
          </div>
          <div style={{ marginTop: '8px' }}>
            <button
              type="button"
              role="switch"
              aria-checked={autoRenew}
              style={{ ...st.toggleRow, background: 'none', border: 'none', padding: 0 }}
              onClick={() => setAutoRenew(!autoRenew)}
            >
              {autoRenew ? (
                <ToggleRight size={24} style={{ color: '#00D4FF' }} />
              ) : (
                <ToggleLeft size={24} style={{ color: '#CCC' }} />
              )}
              <span style={{ fontSize: '14px', fontWeight: 600, color: '#0A2342' }}>Auto-Renew</span>
            </button>
          </div>
          <p style={{ fontSize: 12, color: '#64748B', marginTop: 12 }}>The contract is created as a draft. Dockage rate cards are not available yet, so enter the rate directly.</p>
        </div>
        <div style={st.modalFooter}>
          <button style={st.cancelBtn} onClick={onClose} disabled={saving}>Cancel</button>
          <button style={{ ...st.saveBtn, opacity: saving ? 0.7 : 1 }} onClick={handleSave} disabled={saving}>
            {saving ? 'Creating...' : 'Create Contract'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Contract Detail / Transfer Modal ───────────────────── */

function ContractDetailModal({
  contract,
  onClose,
  onSaved,
}: {
  contract: Contract;
  onClose: () => void;
  onSaved: () => void;
}) {
  const client = useApiClient();
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [saveError, setSaveError] = useState('');

  /* ── Edit state ── */
  const [rate, setRate] = useState((contract.rate / 100).toFixed(2));
  const [billingCycle, setBillingCycle] = useState(contract.billingCycle);
  const [endDate, setEndDate] = useState(contract.end ? contract.end.slice(0, 10) : '');
  const [autoRenew, setAutoRenew] = useState(contract.autoRenew);
  const [deposit, setDeposit] = useState((contract.securityDeposit / 100).toFixed(2));
  const [saving, setSaving] = useState(false);

  const fmt = (cents: number) => formatCents(cents);

  const handleSave = async () => {
    const rateCents = Math.round(Number(rate) * 100);
    if (!(rateCents > 0)) { setSaveError('Rate must be greater than $0.00.'); return; }
    const depositCents = deposit.trim() ? Math.round(Number(deposit) * 100) : null;
    if (depositCents !== null && !(depositCents >= 0)) { setSaveError('Deposit must be $0.00 or more.'); return; }
    setSaving(true);
    setSaveError('');
    try {
      await client.put(`/contracts/${contract.id}`, {
        rateCents,
        billingCycle: CYCLE_ENUM[billingCycle] ?? 'MONTHLY',
        endDate: endDate || null,
        autoRenew,
        securityDepositCents: depositCents,
      });
      onSaved();
      onClose();
    } catch (err) {
      setSaveError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const infoRow: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #F1F5F9', fontSize: '14px' };
  const infoLabel: React.CSSProperties = { color: '#64748B', fontWeight: 600 };
  const infoValue: React.CSSProperties = { color: '#0A2342', fontWeight: 500, textAlign: 'right' as const };
  const sc = statusColors[contract.status];

  return (
    <div style={st.overlay} onClick={() => { if (!saving) onClose(); }}>
      <div style={{ ...st.modal, width: '680px' }} className="helm-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{ ...st.modalHeader, backgroundColor: '#0A2342' }}>
          <div>
            <h2 style={{ ...st.modalTitle, color: '#FFFFFF', fontSize: '18px' }}>Contract {contract.number}</h2>
            <div style={{ fontSize: '13px', color: '#94A3B8', marginTop: '2px' }}>{contract.customer} &middot; {contract.boatName}</div>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {mode === 'view' && (
              <>
                <button style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '6px 12px', fontSize: '12px', fontWeight: 600, borderRadius: '6px', border: '1px solid rgba(255,255,255,0.25)', backgroundColor: 'rgba(255,255,255,0.1)', color: '#FFFFFF', cursor: 'pointer' }} onClick={() => setMode('edit')}>
                  <Edit2 size={13} /> Edit
                </button>
                <ComingSoonButton reason="Coming soon: the API has no slip-transfer endpoint yet." style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '6px 12px', fontSize: '12px', fontWeight: 600, borderRadius: '6px', border: '1px solid rgba(0,212,255,0.5)', backgroundColor: 'rgba(0,212,255,0.15)', color: '#00D4FF' }}>
                  <Repeat size={13} /> Transfer Slip
                </ComingSoonButton>
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
            <div style={infoRow}><span style={infoLabel}>Start Date</span><span style={infoValue}>{formatDate(contract.start)}</span></div>
            <div style={infoRow}><span style={infoLabel}>End Date</span><span style={infoValue}>{formatDate(contract.end)}</span></div>
            <div style={{ ...infoRow, borderBottom: 'none' }}><span style={infoLabel}>Security Deposit</span><span style={{ ...infoValue, fontFamily: '"JetBrains Mono", monospace' }}>{fmt(contract.securityDeposit)}</span></div>
          </div>
        )}

        {/* ── Edit Mode ── */}
        {mode === 'edit' && (
          <>
            <div style={st.modalBody}>
              {saveError && <div role="alert" style={{ color: '#DC2626', fontSize: 13, marginBottom: 12, padding: '8px 12px', background: '#FEF2F2', borderRadius: 6 }}>{saveError}</div>}
              <div style={st.twoCol} className="helm-form-grid">
                <div style={st.field}>
                  <label style={st.label}>Billing Cycle</label>
                  <select style={st.formSelect} value={billingCycle} onChange={(e) => setBillingCycle(e.target.value)}>
                    <option value="Monthly">Monthly</option>
                    <option value="Quarterly">Quarterly</option>
                    <option value="Semi-Annual">Semi-Annual</option>
                    <option value="Annual">Annual</option>
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
                  <button type="button" role="switch" aria-checked={autoRenew} style={{ ...st.toggleRow, marginTop: '24px', background: 'none', border: 'none', padding: 0 }} onClick={() => setAutoRenew(!autoRenew)}>
                    {autoRenew ? <ToggleRight size={24} style={{ color: '#00D4FF' }} /> : <ToggleLeft size={24} style={{ color: '#CCC' }} />}
                    <span style={{ fontSize: '14px', fontWeight: 600, color: '#0A2342' }}>Auto-Renew</span>
                  </button>
                </div>
              </div>
              <p style={{ fontSize: 12, color: '#64748B', marginTop: 16 }}>
                Status changes (activate, renew, terminate) are not edited here: they need the renewal and termination workflows, which are not wired up yet.
              </p>
            </div>
            <div style={st.modalFooter}>
              <button style={st.cancelBtn} onClick={() => setMode('view')}>Cancel</button>
              <button style={{ ...st.saveBtn, opacity: saving ? 0.7 : 1 }} onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</button>
            </div>
          </>
        )}

      </div>
    </div>
  );
}

/* ── Main Component ──────────────────────────────────────── */

export default function Contracts() {
  const client = useApiClient();
  const [statusFilter, setStatusFilter] = useState('All');
  const [cycleFilter, setCycleFilter] = useState('All');
  const [expiringFilter, setExpiringFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [viewingContract, setViewingContract] = useState<Contract | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [skip, setSkip] = useState(0);
  const toast = useToast();

  // Status, cycle and expiry filters run on the server.
  const params = new URLSearchParams({ skip: String(skip), take: String(PAGE_SIZE) });
  if (statusFilter !== 'All') params.set('status', STATUS_ENUM[statusFilter]);
  if (cycleFilter !== 'All') params.set('billingCycle', CYCLE_ENUM[cycleFilter]);
  if (expiringFilter !== 'All') {
    const to = new Date();
    to.setDate(to.getDate() + parseInt(expiringFilter, 10));
    params.set('expiryFrom', todayKey());
    params.set('expiryTo', `${toDateKey(to)}T23:59:59`);
  }
  const list = useList<Contract, ContractDTO>(`/contracts?${params.toString()}`, { map: toContract });
  const contracts = list.items;

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = (filteredContracts: Contract[]) => {
    if (filteredContracts.every((c) => selectedIds.has(c.id))) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredContracts.map((c) => c.id)));
    }
  };

  // Search filters the loaded page only (the API has no contract text search).
  const filtered = contracts.filter((c) => {
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

  const fmt = (cents: number) => formatCents(cents);

  return (
    <div style={st.page}>
      <h1 style={st.title} className="helm-page-title">Contracts</h1>
      <hr style={st.divider} />


      {/* Filter Bar */}
      <div style={st.filterBar} className="helm-filter-bar">
        <select style={st.select} value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setSkip(0); }}>
          <option value="All">All Statuses</option>
          <option value="Draft">Draft</option>
          <option value="Active">Active</option>
          <option value="Expiring">Expiring</option>
          <option value="Expired">Expired</option>
          <option value="Terminated">Terminated</option>
          <option value="Renewed">Renewed</option>
        </select>

        <select style={st.select} value={cycleFilter} onChange={(e) => { setCycleFilter(e.target.value); setSkip(0); }}>
          <option value="All">All Cycles</option>
          <option value="Monthly">Monthly</option>
          <option value="Quarterly">Quarterly</option>
          <option value="Semi-Annual">Semi-Annual</option>
          <option value="Annual">Annual</option>
        </select>

        <select style={st.select} value={expiringFilter} onChange={(e) => { setExpiringFilter(e.target.value); setSkip(0); }}>
          <option value="All">Expiring Within</option>
          <option value="30">30 days</option>
          <option value="60">60 days</option>
          <option value="90">90 days</option>
        </select>

        <div style={st.searchWrap}>
          <Search size={16} style={st.searchIcon} />
          <input
            style={st.searchInput}
            placeholder="Filter this page by customer or slip..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {selectedIds.size > 0 && (
          <ComingSoonButton reason={ESIGN_DISABLED_REASON} style={{ ...st.addButton, backgroundColor: '#0369A1' }}>
            <Send size={15} /> {`Send Batch for Signature (${selectedIds.size})`}
          </ComingSoonButton>
        )}

        <button style={st.addButton} onClick={() => setShowForm(true)}>
          <Plus size={16} /> New Contract
        </button>
      </div>

      {/* Data Table */}
      {list.loading ? (
        <LoadingState label="Loading contracts…" />
      ) : list.error ? (
        <ErrorState title="Could not load contracts" message={list.error} onRetry={list.refetch} />
      ) : filtered.length > 0 ? (
        <>
        <div style={st.tableWrap} className="helm-table-wrap">
          <table style={st.table}>
            <thead>
              <tr>
                <th style={{ ...st.th, width: '40px', textAlign: 'center' }}>
                  <button
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    onClick={() => toggleSelectAll(filtered)}
                    aria-label="Select all visible contracts"
                  >
                    {filtered.length > 0 && filtered.every((c) => selectedIds.has(c.id)) ? <CheckSquare size={16} /> : <Square size={16} />}
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
                        aria-label={isSelected ? 'Deselect contract' : 'Select contract'}
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
                    <td style={{ ...st.td, backgroundColor: isSelected ? '#EFF6FF' : rowBg, color: '#64748B' }}>{formatDate(c.start)}</td>
                    <td style={{ ...st.td, backgroundColor: isSelected ? '#EFF6FF' : rowBg, color: '#64748B' }}>{formatDate(c.end)}</td>
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
                          style={{ background: 'none', border: 'none', color: '#0077A3', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}
                          onClick={() => setViewingContract(c)}
                        >
                          View
                        </button>
                        {c.signatureStatus !== 'signed' && c.status !== 'Terminated' && (
                          <ComingSoonButton
                            reason={ESIGN_DISABLED_REASON}
                            style={{ background: 'none', border: 'none', color: '#0A2342', fontWeight: 600, fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '3px' }}
                          >
                            <PenTool size={13} /> Sign
                          </ComingSoonButton>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pager skip={skip} take={PAGE_SIZE} total={list.pagination?.total ?? contracts.length} onChange={setSkip} />
        </>
      ) : (
        <div style={st.emptyState}>
          <FileText size={32} style={{ marginBottom: '16px', color: '#2E4A6B' }} />
          <h3 style={{ fontSize: '20px', fontWeight: 600, color: '#0A2342', margin: '0 0 8px 0' }}>
            No contracts found
          </h3>
          <p style={{ fontSize: '15px', color: '#64748B', lineHeight: 1.6, margin: '0 0 24px 0' }}>
            {search || statusFilter !== 'All' || cycleFilter !== 'All' || expiringFilter !== 'All'
              ? 'Try adjusting your filters or search terms.'
              : 'Create a slip contract to start billing a customer.'}
          </p>
          <button style={st.addButton} onClick={() => setShowForm(true)}>
            <Plus size={16} /> New Contract
          </button>
        </div>
      )}

      {showForm && (
        <ContractFormModal
          onClose={() => setShowForm(false)}
          onCreated={() => { toast.success('Draft contract created'); list.refetch(); }}
        />
      )}
      {viewingContract && (
        <ContractDetailModal
          contract={viewingContract}
          onClose={() => setViewingContract(null)}
          onSaved={() => { toast.success('Contract updated'); list.refetch(); }}
        />
      )}
    </div>
  );
}
