import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Edit, GitMerge, Mail, Phone, Building, MapPin,
  Calendar, CreditCard, Shield, Ship, FileText, DollarSign,
  Activity, Clock, User, AlertCircle, Plus, X, ToggleLeft, ToggleRight,
} from 'lucide-react';
import CustomerForm from '../components/CustomerForm';
import CustomerMerge from '../components/CustomerMerge';
import { useApi } from '../hooks/useApi';

/* ── Mock Data ─────────────────────────────────────────── */

interface CustomerDetail {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  company: string;
  address: string;
  status: 'Active' | 'Inactive' | 'Waitlist' | 'Collections Hold' | 'Seasonal';
  dob: string;
  dlNumber: string;
  dlState: string;
  dlExpiry: string;
  emergencyName: string;
  emergencyRelationship: string;
  emergencyPhone: string;
  emergencyEmail: string;
  taxExempt: boolean;
  achBlocked: boolean;
  created: string;
  openInvoices: number;
  credits: number;
  deposits: number;
  totalBoats: number;
  activeContracts: number;
  lifetimeValue: number;
}

const CUSTOMER: CustomerDetail = {
  id: '1',
  firstName: 'James',
  lastName: 'Harborview',
  email: 'james@harbor.com',
  phone: '(555) 123-4567',
  company: 'Harbor Industries LLC',
  address: '123 Marina Drive\nCoastal City, FL 33101',
  status: 'Active',
  dob: '1978-06-15',
  dlNumber: 'H123-456-78-901',
  dlState: 'FL',
  dlExpiry: '2027-06-15',
  emergencyName: 'Linda Harborview',
  emergencyRelationship: 'Spouse',
  emergencyPhone: '(555) 111-2222',
  emergencyEmail: 'linda@harbor.com',
  taxExempt: false,
  achBlocked: false,
  created: '2024-03-15',
  openInvoices: 1250.0,
  credits: 200.0,
  deposits: 3000.0,
  totalBoats: 2,
  activeContracts: 1,
  lifetimeValue: 28500.0,
};

const BOATS = [
  { id: '1', name: 'Sea Spirit', type: 'Sailboat', length: 38, registration: 'FL-1234-AB', compliance: 92 },
  { id: '2', name: 'Wave Runner III', type: 'Powerboat', length: 28, registration: 'FL-5678-CD', compliance: 78 },
];

const INVOICES = [
  { id: 'INV-001', description: 'Monthly Slip Rental - March', amount: 850.0, status: 'Paid', date: '2025-03-01' },
  { id: 'INV-002', description: 'Electric Meter - February', amount: 142.5, status: 'Paid', date: '2025-02-15' },
  { id: 'INV-003', description: 'Monthly Slip Rental - April', amount: 850.0, status: 'Open', date: '2025-04-01' },
  { id: 'INV-004', description: 'Pump-Out Service', amount: 45.0, status: 'Open', date: '2025-03-20' },
  { id: 'INV-005', description: 'Late Fee', amount: 25.0, status: 'Overdue', date: '2025-01-15' },
];

interface Boat {
  id: string;
  name: string;
  type: string;
  length: number;
  registration: string;
  compliance: number;
}

interface Invoice {
  id: string;
  description: string;
  amount: number;
  status: string;
  date: string;
}

interface InsuranceRecord {
  id: string;
  boatId: string;
  boatName: string;
  provider: string;
  policyNumber: string;
  type: string;
  coverage: number;
  expiry: string;
  status: 'Current' | 'Expiring Soon' | 'Expired';
}

const INSURANCE: InsuranceRecord[] = [
  { id: 'INS-001', boatId: '1', boatName: 'Sea Spirit', provider: 'Marine Shield Insurance', policyNumber: 'MSI-2025-48291', type: 'Hull & Liability', coverage: 250000, expiry: '2026-06-15', status: 'Current' },
  { id: 'INS-002', boatId: '1', boatName: 'Sea Spirit', provider: 'Marine Shield Insurance', policyNumber: 'MSI-2025-48292', type: 'Environmental Liability', coverage: 100000, expiry: '2026-06-15', status: 'Current' },
  { id: 'INS-003', boatId: '2', boatName: 'Wave Runner III', provider: 'Coastal Underwriters', policyNumber: 'CU-2025-77410', type: 'Hull & Liability', coverage: 120000, expiry: '2026-04-20', status: 'Expiring Soon' },
  { id: 'INS-004', boatId: '2', boatName: 'Wave Runner III', provider: 'Coastal Underwriters', policyNumber: 'CU-2025-77411', type: 'Pollution Liability', coverage: 50000, expiry: '2025-12-01', status: 'Expired' },
];

const insuranceStatusColors: Record<string, { bg: string; color: string }> = {
  Current: { bg: '#E8F5E9', color: '#1B5E20' },
  'Expiring Soon': { bg: '#FFF3CD', color: '#856404' },
  Expired: { bg: '#FDECEA', color: '#B71C1C' },
};

const ACTIVITY = [
  { date: '2025-03-20', action: 'Pump-out service completed', type: 'service' },
  { date: '2025-03-15', action: 'Invoice INV-003 generated', type: 'billing' },
  { date: '2025-03-01', action: 'Payment received - $850.00', type: 'payment' },
  { date: '2025-02-20', action: 'Meter reading submitted: 1,240 kWh', type: 'meter' },
  { date: '2025-02-15', action: 'Invoice INV-002 generated', type: 'billing' },
  { date: '2025-02-01', action: 'Contract auto-renewed for 12 months', type: 'contract' },
  { date: '2025-01-15', action: 'Insurance document uploaded', type: 'document' },
  { date: '2024-12-20', action: 'Dock walk inspection - passed', type: 'inspection' },
];

/* ── Styles ────────────────────────────────────────────── */

const statusBadgeColors: Record<string, { bg: string; color: string }> = {
  Active: { bg: '#E8F5E9', color: '#1B5E20' },
  Inactive: { bg: '#F2F4F6', color: '#64748B' },
  Waitlist: { bg: '#0A2342', color: '#FFFFFF' },
  'Collections Hold': { bg: '#FDECEA', color: '#B71C1C' },
  Seasonal: { bg: '#FFF3CD', color: '#856404' },
};

const invoiceStatusColors: Record<string, { bg: string; color: string }> = {
  Paid: { bg: '#E8F5E9', color: '#1B5E20' },
  Open: { bg: '#FFF3CD', color: '#856404' },
  Overdue: { bg: '#FDECEA', color: '#B71C1C' },
};

const complianceBadge = (score: number): { bg: string; color: string } => {
  if (score >= 90) return { bg: '#E8F5E9', color: '#1B5E20' };
  if (score >= 70) return { bg: '#FFF3CD', color: '#856404' };
  return { bg: '#FDECEA', color: '#B71C1C' };
};

const activityIcons: Record<string, React.ElementType> = {
  service: Activity,
  billing: FileText,
  payment: DollarSign,
  meter: Activity,
  contract: FileText,
  document: FileText,
  inspection: Shield,
};

const s: Record<string, React.CSSProperties> = {
  page: { padding: '32px' },
  backRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '24px',
    cursor: 'pointer',
    color: '#2E4A6B',
    fontSize: '14px',
    fontWeight: 600,
    border: 'none',
    background: 'none',
    padding: 0,
  },
  headerRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '8px',
  },
  name: {
    fontSize: '36px',
    fontWeight: 700,
    color: '#0A2342',
    letterSpacing: '-0.02em',
    margin: 0,
  },
  btnGroup: {
    display: 'flex',
    gap: '8px',
  },
  secondaryBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 20px',
    fontSize: '14px',
    fontWeight: 600,
    color: '#2E4A6B',
    background: '#FFFFFF',
    border: '1px solid #CCC',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  divider: {
    height: '4px',
    background: 'linear-gradient(90deg, #00D4FF, transparent)',
    border: 'none',
    marginTop: '12px',
    marginBottom: '32px',
    borderRadius: '2px',
  },
  tabs: {
    display: 'flex',
    gap: '0',
    borderBottom: '2px solid #E2E8F0',
    marginBottom: '32px',
  },
  tab: {
    padding: '12px 24px',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
    border: 'none',
    background: 'none',
    color: '#64748B',
    borderBottom: '2px solid transparent',
    marginBottom: '-2px',
    transition: 'color 0.15s, border-color 0.15s',
  },
  tabActive: {
    color: '#0A2342',
    borderBottomColor: '#00D4FF',
  },
  grid2: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '24px',
  },
  grid3: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr 1fr',
    gap: '16px',
    marginBottom: '24px',
  },
  card: {
    background: '#FFFFFF',
    border: '1px solid #E2E8F0',
    borderRadius: '8px',
    padding: '24px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
  },
  cardTitle: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#2E4A6B',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    marginBottom: '16px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  infoRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '8px 0',
    fontSize: '14px',
    color: '#0A2342',
    borderBottom: '1px solid #F2F4F6',
  },
  infoLabel: {
    fontSize: '12px',
    fontWeight: 600,
    color: '#64748B',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    minWidth: '90px',
  },
  statCard: {
    background: '#FFFFFF',
    border: '1px solid #E2E8F0',
    borderRadius: '8px',
    padding: '20px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
    textAlign: 'center' as const,
  },
  statValue: {
    fontSize: '24px',
    fontWeight: 700,
    color: '#0A2342',
    fontFamily: '"JetBrains Mono", monospace',
  },
  statLabel: {
    fontSize: '12px',
    fontWeight: 600,
    color: '#2E4A6B',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    marginTop: '4px',
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
  timeline: {
    position: 'relative' as const,
    paddingLeft: '32px',
  },
  timelineLine: {
    position: 'absolute' as const,
    left: '11px',
    top: '8px',
    bottom: '8px',
    width: '2px',
    backgroundColor: '#E2E8F0',
  },
  timelineItem: {
    position: 'relative' as const,
    paddingBottom: '24px',
  },
  timelineDot: {
    position: 'absolute' as const,
    left: '-27px',
    top: '4px',
    width: '14px',
    height: '14px',
    borderRadius: '50%',
    backgroundColor: '#D6E8F4',
    border: '2px solid #00D4FF',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  timelineDate: {
    fontSize: '12px',
    fontWeight: 600,
    color: '#64748B',
    marginBottom: '4px',
  },
  timelineAction: {
    fontSize: '14px',
    color: '#0A2342',
  },
};

/* ── Boat Modals ────────────────────────────────────────── */

const modalOverlay: React.CSSProperties = { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 };
const modalBox: React.CSSProperties = { backgroundColor: '#FFFFFF', borderRadius: '12px', width: '560px', maxHeight: '90vh', overflow: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.16)' };
const mHead: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 28px 16px', borderBottom: '1px solid #E2E8F0' };
const mTitle: React.CSSProperties = { fontSize: '20px', fontWeight: 700, color: '#0A2342', margin: 0 };
const mBody: React.CSSProperties = { padding: '24px 28px' };
const mFoot: React.CSSProperties = { display: 'flex', justifyContent: 'flex-end', gap: '12px', padding: '16px 28px 20px', borderTop: '1px solid #E2E8F0' };
const mField: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '16px' };
const mLabel: React.CSSProperties = { fontSize: '13px', fontWeight: 600, color: '#0A2342' };
const mInput: React.CSSProperties = { padding: '8px 12px', fontSize: '14px', border: '1px solid #CCC', borderRadius: '4px', color: '#0A2342', outline: 'none', boxSizing: 'border-box', width: '100%' };
const mSelect: React.CSSProperties = { ...mInput, background: '#FFFFFF', cursor: 'pointer' };
const mCancelBtn: React.CSSProperties = { padding: '8px 22px', fontSize: '14px', fontWeight: 600, color: '#2E4A6B', background: '#FFFFFF', border: '1px solid #CCC', borderRadius: '6px', cursor: 'pointer' };
const mSaveBtn: React.CSSProperties = { padding: '8px 22px', fontSize: '14px', fontWeight: 600, color: '#FFFFFF', backgroundColor: '#0A2342', border: 'none', borderRadius: '6px', cursor: 'pointer' };
const mTwoCol: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' };

function EditBoatModal({ boat, onClose, onSave }: { boat: Boat; onClose: () => void; onSave: (b: Boat) => void }) {
  const [name, setName] = useState(boat.name);
  const [type, setType] = useState(boat.type);
  const [length, setLength] = useState(String(boat.length));
  const [registration, setRegistration] = useState(boat.registration);
  const [saving, setSaving] = useState(false);

  const handleSave = () => {
    if (!name) return;
    setSaving(true);
    onSave({ ...boat, name, type, length: parseFloat(length) || boat.length, registration });
    setSaving(false);
    onClose();
  };

  return (
    <div style={modalOverlay} onClick={onClose}>
      <div style={modalBox} onClick={(e) => e.stopPropagation()}>
        <div style={mHead}>
          <h2 style={mTitle}>Edit Boat</h2>
          <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#2E4A6B' }} onClick={onClose}><X size={20} /></button>
        </div>
        <div style={mBody}>
          <div style={mTwoCol}>
            <div style={{ ...mField, gridColumn: '1 / -1' }}>
              <label style={mLabel}>Vessel Name *</label>
              <input style={mInput} value={name} onChange={(e) => setName(e.target.value)} placeholder="Vessel name" />
            </div>
            <div style={mField}>
              <label style={mLabel}>Type</label>
              <select style={mSelect} value={type} onChange={(e) => setType(e.target.value)}>
                <option value="Sailboat">Sailboat</option>
                <option value="Powerboat">Powerboat</option>
                <option value="Trawler">Trawler</option>
                <option value="Yacht">Yacht</option>
                <option value="Runabout">Runabout</option>
                <option value="Cabin Cruiser">Cabin Cruiser</option>
                <option value="Catamaran">Catamaran</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div style={mField}>
              <label style={mLabel}>Length (ft)</label>
              <input style={mInput} type="number" value={length} onChange={(e) => setLength(e.target.value)} placeholder="e.g. 38" />
            </div>
            <div style={{ ...mField, gridColumn: '1 / -1' }}>
              <label style={mLabel}>Registration #</label>
              <input style={mInput} value={registration} onChange={(e) => setRegistration(e.target.value)} placeholder="e.g. FL-1234-AB" />
            </div>
          </div>
        </div>
        <div style={mFoot}>
          <button style={mCancelBtn} onClick={onClose}>Cancel</button>
          <button style={{ ...mSaveBtn, opacity: saving ? 0.7 : 1 }} onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</button>
        </div>
      </div>
    </div>
  );
}

function AddBoatModal({ onClose, onSave }: { onClose: () => void; onSave: (b: Partial<Boat>) => void }) {
  const [name, setName] = useState('');
  const [type, setType] = useState('Sailboat');
  const [length, setLength] = useState('');
  const [registration, setRegistration] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const handleSave = () => {
    if (!name) { setErr('Vessel name is required.'); return; }
    setSaving(true);
    onSave({ name, type, length: parseFloat(length) || 0, registration });
    setSaving(false);
    onClose();
  };

  return (
    <div style={modalOverlay} onClick={onClose}>
      <div style={modalBox} onClick={(e) => e.stopPropagation()}>
        <div style={mHead}>
          <h2 style={mTitle}>Add Boat</h2>
          <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#2E4A6B' }} onClick={onClose}><X size={20} /></button>
        </div>
        <div style={mBody}>
          {err && <div style={{ color: '#DC2626', fontSize: 13, marginBottom: 12, padding: '8px 12px', background: '#FEF2F2', borderRadius: 6 }}>{err}</div>}
          <div style={mTwoCol}>
            <div style={{ ...mField, gridColumn: '1 / -1' }}>
              <label style={mLabel}>Vessel Name *</label>
              <input style={mInput} value={name} onChange={(e) => setName(e.target.value)} placeholder="Vessel name" />
            </div>
            <div style={mField}>
              <label style={mLabel}>Type</label>
              <select style={mSelect} value={type} onChange={(e) => setType(e.target.value)}>
                <option value="Sailboat">Sailboat</option>
                <option value="Powerboat">Powerboat</option>
                <option value="Trawler">Trawler</option>
                <option value="Yacht">Yacht</option>
                <option value="Runabout">Runabout</option>
                <option value="Cabin Cruiser">Cabin Cruiser</option>
                <option value="Catamaran">Catamaran</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div style={mField}>
              <label style={mLabel}>Length (ft)</label>
              <input style={mInput} type="number" value={length} onChange={(e) => setLength(e.target.value)} placeholder="e.g. 38" />
            </div>
            <div style={{ ...mField, gridColumn: '1 / -1' }}>
              <label style={mLabel}>Registration #</label>
              <input style={mInput} value={registration} onChange={(e) => setRegistration(e.target.value)} placeholder="e.g. FL-1234-AB" />
            </div>
          </div>
        </div>
        <div style={mFoot}>
          <button style={mCancelBtn} onClick={onClose}>Cancel</button>
          <button style={{ ...mSaveBtn, opacity: saving ? 0.7 : 1 }} onClick={handleSave} disabled={saving}>{saving ? 'Adding…' : 'Add Boat'}</button>
        </div>
      </div>
    </div>
  );
}

function NewContractFromBoatModal({ boat, onClose }: { boat: Boat; onClose: () => void }) {
  const [slip, setSlip] = useState('');
  const [billingCycle, setBillingCycle] = useState('Monthly');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [rate, setRate] = useState('');
  const [deposit, setDeposit] = useState('');
  const [autoRenew, setAutoRenew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const createContract = useApi('post', '/api/contracts');

  const handleSave = async () => {
    if (!slip || !startDate || !endDate || !rate) { setErr('Please fill in all required fields.'); return; }
    setErr('');
    setSaving(true);
    await createContract.execute({ body: { slipNumber: slip, boatId: boat.id, billingCycle, startDate, endDate, rateCents: Math.round(parseFloat(rate) * 100), depositCents: deposit ? Math.round(parseFloat(deposit) * 100) : 0, autoRenew } }).catch(() => {});
    setSaving(false);
    onClose();
  };

  return (
    <div style={modalOverlay} onClick={onClose}>
      <div style={modalBox} onClick={(e) => e.stopPropagation()}>
        <div style={{ ...mHead, backgroundColor: '#0A2342' }}>
          <div>
            <h2 style={{ ...mTitle, color: '#FFFFFF' }}>New Contract</h2>
            <div style={{ fontSize: '13px', color: '#94A3B8', marginTop: '2px' }}>Vessel: {boat.name} ({boat.type} &middot; {boat.length}')</div>
          </div>
          <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#FFFFFF' }} onClick={onClose}><X size={20} /></button>
        </div>
        <div style={mBody}>
          {err && <div style={{ color: '#DC2626', fontSize: 13, marginBottom: 12, padding: '8px 12px', background: '#FEF2F2', borderRadius: 6 }}>{err}</div>}
          <div style={mTwoCol}>
            <div style={mField}>
              <label style={mLabel}>Slip *</label>
              <select style={mSelect} value={slip} onChange={(e) => setSlip(e.target.value)}>
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
            <div style={mField}>
              <label style={mLabel}>Billing Cycle</label>
              <select style={mSelect} value={billingCycle} onChange={(e) => setBillingCycle(e.target.value)}>
                <option value="Monthly">Monthly</option>
                <option value="Quarterly">Quarterly</option>
                <option value="Semi-Annual">Semi-Annual</option>
                <option value="Annual">Annual</option>
                <option value="Seasonal">Seasonal</option>
              </select>
            </div>
            <div style={mField}>
              <label style={mLabel}>Start Date *</label>
              <input style={mInput} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div style={mField}>
              <label style={mLabel}>End Date *</label>
              <input style={mInput} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
            <div style={mField}>
              <label style={mLabel}>Rate ($/period) *</label>
              <input style={{ ...mInput, fontFamily: '"JetBrains Mono", monospace' }} type="number" step="0.01" placeholder="0.00" value={rate} onChange={(e) => setRate(e.target.value)} />
            </div>
            <div style={mField}>
              <label style={mLabel}>Security Deposit</label>
              <input style={{ ...mInput, fontFamily: '"JetBrains Mono", monospace' }} type="number" step="0.01" placeholder="0.00" value={deposit} onChange={(e) => setDeposit(e.target.value)} />
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', userSelect: 'none', marginTop: '4px' }} onClick={() => setAutoRenew(!autoRenew)}>
            {autoRenew ? <ToggleRight size={24} style={{ color: '#00D4FF' }} /> : <ToggleLeft size={24} style={{ color: '#CCC' }} />}
            <span style={{ fontSize: '14px', fontWeight: 600, color: '#0A2342' }}>Auto-Renew</span>
          </div>
        </div>
        <div style={mFoot}>
          <button style={mCancelBtn} onClick={onClose}>Cancel</button>
          <button style={{ ...mSaveBtn, opacity: saving ? 0.7 : 1 }} onClick={handleSave} disabled={saving}>{saving ? 'Creating…' : 'Create Contract'}</button>
        </div>
      </div>
    </div>
  );
}

/* ── Component ─────────────────────────────────────────── */

type Tab = 'overview' | 'boats' | 'billing' | 'documents' | 'activity';

export default function CustomerDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('overview');
  const [showEdit, setShowEdit] = useState(false);
  const [showMerge, setShowMerge] = useState(false);
  const [editingBoat, setEditingBoat] = useState<Boat | null>(null);
  const [showAddBoat, setShowAddBoat] = useState(false);
  const [newContractBoat, setNewContractBoat] = useState<Boat | null>(null);
  const [localBoats, setLocalBoats] = useState<Boat[]>([]);

  // API calls
  const { data: apiCustomer, loading, error, execute: refetchCustomer } = useApi<CustomerDetail>('get', `/api/customers/${id}`, { immediate: true });
  const { data: apiBoats, loading: loadingBoats } = useApi<Boat[]>('get', `/api/boats?customerId=${id}`, { immediate: true });
  const { data: apiInvoices, loading: loadingInvoices } = useApi<Invoice[]>('get', `/api/invoices?customerId=${id}`, { immediate: true });
  const updateCustomerApi = useApi<CustomerDetail>('put', `/api/customers/${id}`);
  const updateBoatApi = useApi('put', '/api/boats/update');
  const addBoatApi = useApi('post', '/api/boats');

  const c = apiCustomer || CUSTOMER; // Fallback to mock data
  const rawBoats = apiBoats || BOATS;
  const boats = localBoats.length > 0 ? localBoats : rawBoats;
  const invoices = apiInvoices || INVOICES;

  const handleSaveBoat = (updated: Boat) => {
    setLocalBoats(boats.map((b) => b.id === updated.id ? updated : b));
    updateBoatApi.execute({ body: updated }).catch(() => {});
  };

  const handleAddBoat = (data: Partial<Boat>) => {
    const newBoat: Boat = { id: String(Date.now()), name: data.name || '', type: data.type || 'Other', length: data.length || 0, registration: data.registration || '', compliance: 100 };
    setLocalBoats([...boats, newBoat]);
    addBoatApi.execute({ body: { ...data, customerId: id } }).catch(() => {});
  };
  const badgeStyle = statusBadgeColors[c.status];

  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'boats', label: 'Boats' },
    { key: 'billing', label: 'Billing' },
    { key: 'documents', label: 'Documents' },
    { key: 'activity', label: 'Activity' },
  ];

  const fmt = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2 });

  /* ── Overview Tab ─── */
  const renderOverview = () => (
    <>
      {/* Quick Stats */}
      <div style={s.grid3}>
        <div style={s.statCard}>
          <div style={s.statValue}>{c.totalBoats}</div>
          <div style={s.statLabel}>Total Boats</div>
        </div>
        <div style={s.statCard}>
          <div style={s.statValue}>{c.activeContracts}</div>
          <div style={s.statLabel}>Active Contracts</div>
        </div>
        <div style={s.statCard}>
          <div style={s.statValue}>{fmt(c.lifetimeValue)}</div>
          <div style={s.statLabel}>Lifetime Value</div>
        </div>
        <div style={{ ...s.statCard, borderTop: '3px solid #00D4FF' }}>
          <div style={{ ...s.statValue, color: c.openInvoices > 0 ? '#B71C1C' : '#1B5E20' }}>
            {fmt(c.openInvoices)}
          </div>
          <div style={s.statLabel}>Open Balance</div>
        </div>
      </div>

      <div style={s.grid2}>
        {/* Contact Card */}
        <div style={s.card}>
          <div style={s.cardTitle}><User size={16} /> Contact Information</div>
          <div style={s.infoRow}><Mail size={14} color="#64748B" /><span>{c.email}</span></div>
          <div style={s.infoRow}><Phone size={14} color="#64748B" /><span>{c.phone}</span></div>
          <div style={s.infoRow}><Building size={14} color="#64748B" /><span>{c.company || '—'}</span></div>
          <div style={{ ...s.infoRow, borderBottom: 'none' }}><MapPin size={14} color="#64748B" /><span style={{ whiteSpace: 'pre-line' }}>{c.address || '—'}</span></div>
        </div>

        {/* Identity Card */}
        <div style={s.card}>
          <div style={s.cardTitle}><Shield size={16} /> Identity</div>
          <div style={s.infoRow}>
            <span style={s.infoLabel}>DOB</span>
            <span>{c.dob || '—'}</span>
          </div>
          <div style={s.infoRow}>
            <span style={s.infoLabel}>DL #</span>
            <span>{c.dlNumber || '—'}</span>
          </div>
          <div style={s.infoRow}>
            <span style={s.infoLabel}>DL State</span>
            <span>{c.dlState || '—'}</span>
          </div>
          <div style={s.infoRow}>
            <span style={s.infoLabel}>DL Expiry</span>
            <span>{c.dlExpiry || '—'}</span>
          </div>
          <div style={{ ...s.infoRow, borderBottom: 'none', flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}>
            <span style={{ ...s.infoLabel, minWidth: 'auto' }}>Emergency Contact</span>
            <span>{c.emergencyName} ({c.emergencyRelationship})</span>
            <span style={{ fontSize: '13px', color: '#64748B' }}>{c.emergencyPhone} | {c.emergencyEmail}</span>
          </div>
        </div>

        {/* Balance Summary */}
        <div style={{ ...s.card, gridColumn: '1 / -1' }}>
          <div style={s.cardTitle}><DollarSign size={16} /> Balance Summary</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '24px' }}>
            <div>
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Open Invoices</div>
              <div style={{ ...s.mono, fontSize: '20px', fontWeight: 700, color: '#B71C1C', marginTop: '4px' }}>{fmt(c.openInvoices)}</div>
            </div>
            <div>
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Credits</div>
              <div style={{ ...s.mono, fontSize: '20px', fontWeight: 700, color: '#1B5E20', marginTop: '4px' }}>{fmt(c.credits)}</div>
            </div>
            <div>
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Security Deposits</div>
              <div style={{ ...s.mono, fontSize: '20px', fontWeight: 700, color: '#0A2342', marginTop: '4px' }}>{fmt(c.deposits)}</div>
            </div>
          </div>
        </div>
      </div>
    </>
  );

  /* ── Boats Tab ─── */
  const renderBoats = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Add Boat button */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 18px', fontSize: '14px', fontWeight: 600, color: '#FFFFFF', backgroundColor: '#0A2342', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
          onClick={() => setShowAddBoat(true)}
        >
          <Plus size={15} /> Add Boat
        </button>
      </div>
      {boats.map((b) => {
        const cb = complianceBadge(b.compliance);
        const boatInsurance = INSURANCE.filter((ins) => ins.boatId === b.id);
        return (
          <div key={b.id} style={{ ...s.card, padding: 0, overflow: 'hidden' }}>
            {/* Boat Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px', borderBottom: '1px solid #E2E8F0', backgroundColor: '#F8FAFC' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <Ship size={20} color="#0A2342" />
                <div>
                  <div style={{ fontSize: '18px', fontWeight: 700, color: '#0A2342' }}>{b.name}</div>
                  <div style={{ fontSize: '13px', color: '#64748B' }}>{b.type} &middot; {b.length}' &middot; {b.registration}</div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <button
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '6px 14px', fontSize: '13px', fontWeight: 600, color: '#2E4A6B', background: '#FFFFFF', border: '1px solid #CCC', borderRadius: '6px', cursor: 'pointer' }}
                  onClick={() => setEditingBoat(b)}
                >
                  <Edit size={13} /> Edit
                </button>
                <button
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '6px 14px', fontSize: '13px', fontWeight: 600, color: '#FFFFFF', background: '#0A2342', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
                  onClick={() => setNewContractBoat(b)}
                >
                  <Plus size={13} /> New Contract
                </button>
                <span style={{ ...s.badge, backgroundColor: cb.bg, color: cb.color }}>
                  Compliance: {b.compliance}%
                </span>
              </div>
            </div>
            {/* Insurance Section */}
            <div style={{ padding: '20px 24px' }}>
              <div style={{ ...s.cardTitle, marginBottom: '12px' }}><Shield size={14} /> Insurance Policies</div>
              {boatInsurance.length > 0 ? (
                <table style={s.table}>
                  <thead>
                    <tr>
                      <th style={{ ...s.th, fontSize: '11px', padding: '8px 12px' }}>Policy #</th>
                      <th style={{ ...s.th, fontSize: '11px', padding: '8px 12px' }}>Provider</th>
                      <th style={{ ...s.th, fontSize: '11px', padding: '8px 12px' }}>Type</th>
                      <th style={{ ...s.th, fontSize: '11px', padding: '8px 12px' }}>Coverage</th>
                      <th style={{ ...s.th, fontSize: '11px', padding: '8px 12px' }}>Expiry</th>
                      <th style={{ ...s.th, fontSize: '11px', padding: '8px 12px' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {boatInsurance.map((ins, idx) => {
                      const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC';
                      const isc = insuranceStatusColors[ins.status];
                      return (
                        <tr key={ins.id}>
                          <td style={{ ...s.td, backgroundColor: rowBg, ...s.mono, fontSize: '13px' }}>{ins.policyNumber}</td>
                          <td style={{ ...s.td, backgroundColor: rowBg }}>{ins.provider}</td>
                          <td style={{ ...s.td, backgroundColor: rowBg }}>{ins.type}</td>
                          <td style={{ ...s.td, backgroundColor: rowBg, ...s.mono }}>{fmt(ins.coverage)}</td>
                          <td style={{ ...s.td, backgroundColor: rowBg, color: '#64748B' }}>{ins.expiry}</td>
                          <td style={{ ...s.td, backgroundColor: rowBg }}>
                            <span style={{ ...s.badge, backgroundColor: isc.bg, color: isc.color }}>{ins.status}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <div style={{ padding: '16px 0', color: '#94A3B8', fontSize: '14px' }}>
                  <AlertCircle size={14} style={{ marginRight: '6px', verticalAlign: 'middle' }} />
                  No insurance on file for this vessel.
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );

  /* ── Billing Tab ─── */
  const renderBilling = () => (
    <div style={s.tableWrap}>
      <table style={s.table}>
        <thead>
          <tr>
            <th style={s.th}>Invoice</th>
            <th style={s.th}>Description</th>
            <th style={s.th}>Amount</th>
            <th style={s.th}>Status</th>
            <th style={s.th}>Date</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv, idx) => {
            const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#D6E8F4';
            const ib = invoiceStatusColors[inv.status] || { bg: '#F2F4F6', color: '#64748B' };
            return (
              <tr
                key={inv.id}
                style={{ cursor: 'pointer' }}
                onClick={() => navigate(`/billing/invoices/${inv.id}`)}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = '#E0F0FF'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = rowBg; }}
              >
                <td style={{ ...s.td, backgroundColor: rowBg, fontWeight: 600, ...s.mono, color: '#00D4FF' }}>{inv.id}</td>
                <td style={{ ...s.td, backgroundColor: rowBg }}>{inv.description}</td>
                <td style={{ ...s.td, backgroundColor: rowBg, ...s.mono }}>{fmt(inv.amount)}</td>
                <td style={{ ...s.td, backgroundColor: rowBg }}>
                  <span style={{ ...s.badge, backgroundColor: ib.bg, color: ib.color }}>{inv.status}</span>
                </td>
                <td style={{ ...s.td, backgroundColor: rowBg, color: '#64748B' }}>{inv.date}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  /* ── Documents Tab ─── */
  const renderDocuments = () => (
    <div style={{ ...s.card, textAlign: 'center', padding: '48px 32px' }}>
      <FileText size={32} style={{ color: '#2E4A6B', marginBottom: '16px' }} />
      <h3 style={{ fontSize: '20px', fontWeight: 600, color: '#0A2342', margin: '0 0 8px' }}>
        No documents uploaded
      </h3>
      <p style={{ fontSize: '15px', color: '#64748B', margin: '0 0 24px' }}>
        Upload insurance certificates, registration papers, or other documents.
      </p>
      <button style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 20px', fontSize: '14px', fontWeight: 600, color: '#FFFFFF', backgroundColor: '#0A2342', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>
        Upload Document
      </button>
    </div>
  );

  /* ── Activity Tab ─── */
  const renderActivity = () => (
    <div style={s.timeline}>
      <div style={s.timelineLine} />
      {ACTIVITY.map((a, i) => {
        const Icon = activityIcons[a.type] || Activity;
        return (
          <div key={i} style={s.timelineItem}>
            <div style={s.timelineDot} />
            <div style={s.timelineDate}>{a.date}</div>
            <div style={s.timelineAction}>{a.action}</div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div style={s.page}>
      <button style={s.backRow} onClick={() => navigate('/customers')}>
        <ArrowLeft size={16} /> Back to Customers
      </button>

      {loading && <div style={{ textAlign: 'center', padding: '40px', color: '#64748B' }}>Loading...</div>}

      <div style={s.headerRow}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <h1 style={s.name}>{c.firstName} {c.lastName}</h1>
          <span style={{ ...s.badge, backgroundColor: badgeStyle.bg, color: badgeStyle.color, fontSize: '13px', padding: '4px 14px' }}>
            {c.status}
          </span>
        </div>
        <div style={s.btnGroup}>
          <button style={s.secondaryBtn} onClick={() => setShowEdit(true)}>
            <Edit size={14} /> Edit
          </button>
          <button style={s.secondaryBtn} onClick={() => setShowMerge(true)}>
            <GitMerge size={14} /> Merge
          </button>
        </div>
      </div>
      <hr style={s.divider} />

      {/* Tab Navigation */}
      <div style={s.tabs}>
        {tabs.map((t) => (
          <button
            key={t.key}
            style={{ ...s.tab, ...(tab === t.key ? s.tabActive : {}) }}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && renderOverview()}
      {tab === 'boats' && renderBoats()}
      {tab === 'billing' && renderBilling()}
      {tab === 'documents' && renderDocuments()}
      {tab === 'activity' && renderActivity()}

      {showEdit && (
        <CustomerForm
          initial={{
            firstName: c.firstName,
            lastName: c.lastName,
            company: c.company,
            email: c.email,
            phone: c.phone,
            address: c.address,
            dob: c.dob,
            dlNumber: c.dlNumber,
            dlState: c.dlState,
            dlExpiry: c.dlExpiry,
            emergencyName: c.emergencyName,
            emergencyRelationship: c.emergencyRelationship,
            emergencyPhone: c.emergencyPhone,
            emergencyEmail: c.emergencyEmail,
            taxExempt: c.taxExempt,
            status: c.status,
          }}
          onClose={() => setShowEdit(false)}
          onSave={async (data) => {
            await updateCustomerApi.execute(data);
            refetchCustomer();
            setShowEdit(false);
          }}
        />
      )}

      {showMerge && (
        <CustomerMerge
          source={{
            id: c.id,
            name: `${c.firstName} ${c.lastName}`,
            email: c.email,
            phone: c.phone,
            company: c.company,
            address: c.address,
            status: c.status,
            boats: c.totalBoats,
            invoices: 5,
            payments: 12,
          }}
          onClose={() => setShowMerge(false)}
          onMerge={(targetId, selections) => {
            console.log('Merge into:', targetId, selections);
            setShowMerge(false);
          }}
        />
      )}

      {editingBoat && (
        <EditBoatModal
          boat={editingBoat}
          onClose={() => setEditingBoat(null)}
          onSave={handleSaveBoat}
        />
      )}

      {showAddBoat && (
        <AddBoatModal
          onClose={() => setShowAddBoat(false)}
          onSave={handleAddBoat}
        />
      )}

      {newContractBoat && (
        <NewContractFromBoatModal
          boat={newContractBoat}
          onClose={() => setNewContractBoat(null)}
        />
      )}
    </div>
  );
}
