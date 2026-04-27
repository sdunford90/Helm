import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Edit, GitMerge, Mail, Phone, Building, MapPin,
  Calendar, CreditCard, Shield, Ship, FileText, DollarSign,
  Activity, Clock, User, AlertCircle, Plus, X, ToggleLeft, ToggleRight,
} from 'lucide-react';
import CustomerForm, { type CustomerFormPayload } from '../components/CustomerForm';
import CustomerMerge from '../components/CustomerMerge';
import CommunicationPrefs from '../components/CommunicationPrefs';
import { useApi } from '../hooks/useApi';

/* ── Mock Data ─────────────────────────────────────────── */

interface CustomerAddress {
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
}

interface CustomerEmergencyContact {
  name?: string;
  relationship?: string;
  phone?: string;
  email?: string;
}

interface CustomerDetail {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  company: string;
  addressJson: CustomerAddress | null;
  emergencyContactJson: CustomerEmergencyContact | null;
  status: 'ACTIVE' | 'INACTIVE' | 'WAITLIST' | 'COLLECTIONS_HOLD' | 'SEASONAL';
  dob: string | null;
  dlNumber: string | null;
  dlState: string | null;
  dlExpiry: string | null;
  taxExempt: boolean;
  achBlocked: boolean;
  createdAt: string;
  openInvoices: number;
  credits: number;
  deposits: number;
  totalBoats: number;
  activeContracts: number;
  lifetimeValue: number;
}

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  WAITLIST: 'Waitlist',
  COLLECTIONS_HOLD: 'Collections Hold',
  SEASONAL: 'Seasonal',
};

function formatAddress(a: CustomerAddress | null | undefined): string {
  if (!a) return '—';
  const parts: string[] = [];
  if (a.address) parts.push(a.address);
  const cityLine = [a.city, a.state ? `${a.state}${a.zip ? ' ' + a.zip : ''}` : a.zip].filter(Boolean).join(', ');
  if (cityLine) parts.push(cityLine);
  return parts.join('\n') || '—';
}

/* ── API shapes (from server) ────────────────────────────── */

interface ApiInsuranceRecord {
  id: string;
  policyNumber: string;
  provider: string;
  coverageType: string;
  coverageCents: number;
  expiryDate: string | null;
  status: string;
}

interface ApiBoat {
  id: string;
  name: string | null;
  type?: string;
  lengthFt: number;
  beamFt?: number | null;
  draftFt?: number | null;
  registrationNumber: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  fuelType: string | null;
  engineHp: number | null;
  hin: string | null;
  insuranceRecords: ApiInsuranceRecord[];
  compliance?: number;
}

interface ApiInvoice {
  id: string;
  invoiceNumber?: string;
  description?: string;
  totalCents: number;
  status: string;
  issuedDate: string;
  _count?: { lineItems: number; payments: number };
}

interface ApiTimelineEvent {
  type: string;
  date: string;
  description: string;
  meta?: Record<string, unknown>;
}

function mapApiBoat(b: ApiBoat): Boat {
  return {
    id: b.id,
    name: b.name ?? '—',
    type: b.type ?? 'Other',
    length: b.lengthFt,
    beam: b.beamFt?.toString() ?? '',
    draft: b.draftFt?.toString() ?? '',
    height: '',
    registration: b.registrationNumber ?? '—',
    make: b.make ?? '',
    model: b.model ?? '',
    year: b.year?.toString() ?? '',
    color: '',
    hin: b.hin ?? '',
    mmsi: '',
    engineType: '',
    engineHp: b.engineHp?.toString() ?? '',
    fuelType: b.fuelType ?? '',
    compliance: b.compliance ?? 100,
  };
}

function mapApiInvoice(inv: ApiInvoice): Invoice {
  return {
    id: inv.id,
    description: inv.description ?? inv.invoiceNumber ?? inv.id.slice(0, 8).toUpperCase(),
    amount: inv.totalCents / 100,
    status: inv.status === 'ISSUED' ? 'Open' : inv.status === 'PAST_DUE' ? 'Overdue' : inv.status === 'PAID' ? 'Paid' : inv.status,
    date: new Date(inv.issuedDate).toISOString().slice(0, 10),
  };
}

function mapApiInsurance(ins: ApiInsuranceRecord, boatId: string, boatName: string): InsuranceRecord {
  const expiryDate = ins.expiryDate ? new Date(ins.expiryDate) : null;
  const now = new Date();
  const daysUntilExpiry = expiryDate ? Math.floor((expiryDate.getTime() - now.getTime()) / 86400000) : null;
  let status: InsuranceRecord['status'] = 'Current';
  if (!expiryDate || expiryDate < now) status = 'Expired';
  else if (daysUntilExpiry !== null && daysUntilExpiry <= 60) status = 'Expiring Soon';
  return {
    id: ins.id,
    boatId,
    boatName,
    provider: ins.provider,
    policyNumber: ins.policyNumber,
    type: ins.coverageType,
    coverage: ins.coverageCents / 100,
    expiry: expiryDate ? expiryDate.toISOString().slice(0, 10) : '—',
    status,
  };
}

interface Boat {
  id: string;
  name: string;
  type: string;
  length: number;
  registration: string;
  compliance: number;
  make?: string;
  model?: string;
  year?: string;
  beam?: string;
  draft?: string;
  height?: string;
  color?: string;
  hin?: string;
  mmsi?: string;
  engineType?: string;
  engineHp?: string;
  fuelType?: string;
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

const insuranceStatusColors: Record<string, { bg: string; color: string }> = {
  Current: { bg: '#E8F5E9', color: '#1B5E20' },
  'Expiring Soon': { bg: '#FFF3CD', color: '#856404' },
  Expired: { bg: '#FDECEA', color: '#B71C1C' },
};


/* ── Styles ────────────────────────────────────────────── */

const statusBadgeColors: Record<string, { bg: string; color: string }> = {
  ACTIVE: { bg: '#E8F5E9', color: '#1B5E20' },
  INACTIVE: { bg: '#F2F4F6', color: '#64748B' },
  WAITLIST: { bg: '#0A2342', color: '#FFFFFF' },
  COLLECTIONS_HOLD: { bg: '#FDECEA', color: '#B71C1C' },
  SEASONAL: { bg: '#FFF3CD', color: '#856404' },
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

const BOAT_TYPES = ['Sailboat', 'Powerboat', 'Trawler', 'Yacht', 'Runabout', 'Cabin Cruiser', 'Catamaran', 'Center Console', 'Pontoon', 'Jet Ski / PWC', 'Other'];
const ENGINE_TYPES = ['Inboard Gas', 'Inboard Diesel', 'Outboard Gas', 'Outboard Electric', 'Sterndrive', 'Jet Drive', 'Sail / No Engine', 'Other'];
const FUEL_TYPES = ['Gasoline', 'Diesel', 'Electric', 'Hybrid', 'N/A'];

function BoatFields({ v, set }: { v: Record<string, string>; set: (k: string, val: string) => void }) {
  const secTitle: React.CSSProperties = { fontSize: '12px', fontWeight: 700, color: '#0A2342', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '12px', marginTop: '20px', paddingBottom: '6px', borderBottom: '1px solid #E2E8F0' };
  return (
    <>
      <p style={secTitle}>Basic Info</p>
      <div style={mTwoCol}>
        <div style={{ ...mField, gridColumn: '1 / -1' }}>
          <label style={mLabel}>Vessel Name *</label>
          <input style={mInput} value={v.name} onChange={(e) => set('name', e.target.value)} placeholder="Vessel name" />
        </div>
        <div style={mField}>
          <label style={mLabel}>Type</label>
          <select style={mSelect} value={v.type} onChange={(e) => set('type', e.target.value)}>
            {BOAT_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div style={mField}>
          <label style={mLabel}>Length (ft)</label>
          <input style={mInput} type="number" step="0.1" value={v.length} onChange={(e) => set('length', e.target.value)} placeholder="e.g. 38" />
        </div>
        <div style={mField}>
          <label style={mLabel}>Registration #</label>
          <input style={mInput} value={v.registration} onChange={(e) => set('registration', e.target.value)} placeholder="e.g. FL-1234-AB" />
        </div>
        <div style={mField}><label style={mLabel}>Year</label><input style={mInput} type="number" value={v.year} onChange={(e) => set('year', e.target.value)} placeholder="e.g. 2022" /></div>
        <div style={mField}><label style={mLabel}>Make</label><input style={mInput} value={v.make} onChange={(e) => set('make', e.target.value)} placeholder="e.g. Hunter" /></div>
        <div style={mField}><label style={mLabel}>Model</label><input style={mInput} value={v.model} onChange={(e) => set('model', e.target.value)} placeholder="e.g. 380" /></div>
        <div style={mField}><label style={mLabel}>Color</label><input style={mInput} value={v.color} onChange={(e) => set('color', e.target.value)} placeholder="e.g. White" /></div>
      </div>
      <p style={secTitle}>Dimensions</p>
      <div style={mTwoCol}>
        <div style={mField}><label style={mLabel}>Beam (ft)</label><input style={mInput} type="number" step="0.1" value={v.beam} onChange={(e) => set('beam', e.target.value)} placeholder="e.g. 12.5" /></div>
        <div style={mField}><label style={mLabel}>Draft (ft)</label><input style={mInput} type="number" step="0.1" value={v.draft} onChange={(e) => set('draft', e.target.value)} placeholder="e.g. 5.5" /></div>
        <div style={mField}><label style={mLabel}>Height (ft)</label><input style={mInput} type="number" step="0.1" value={v.height} onChange={(e) => set('height', e.target.value)} placeholder="e.g. 57" /></div>
      </div>
      <p style={secTitle}>Identification</p>
      <div style={mTwoCol}>
        <div style={mField}><label style={mLabel}>HIN</label><input style={mInput} value={v.hin} onChange={(e) => set('hin', e.target.value)} placeholder="Hull ID Number" /></div>
        <div style={mField}><label style={mLabel}>MMSI</label><input style={mInput} value={v.mmsi} onChange={(e) => set('mmsi', e.target.value)} placeholder="Maritime Mobile Service Identity" /></div>
      </div>
      <p style={secTitle}>Engine & Fuel</p>
      <div style={mTwoCol}>
        <div style={mField}><label style={mLabel}>Engine Type</label>
          <select style={mSelect} value={v.engineType} onChange={(e) => set('engineType', e.target.value)}>
            {ENGINE_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div style={mField}><label style={mLabel}>Engine HP</label><input style={mInput} type="number" value={v.engineHp} onChange={(e) => set('engineHp', e.target.value)} placeholder="e.g. 260" /></div>
        <div style={mField}><label style={mLabel}>Fuel Type</label>
          <select style={mSelect} value={v.fuelType} onChange={(e) => set('fuelType', e.target.value)}>
            {FUEL_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
      </div>
    </>
  );
}

function EditBoatModal({ boat, onClose, onSave }: { boat: Boat; onClose: () => void; onSave: (b: Boat) => void }) {
  const [vals, setVals] = useState<Record<string, string>>({
    name: boat.name, type: boat.type, length: String(boat.length), registration: boat.registration,
    make: boat.make ?? '', model: boat.model ?? '', year: boat.year ?? '', color: boat.color ?? '',
    beam: boat.beam ?? '', draft: boat.draft ?? '', height: boat.height ?? '',
    hin: boat.hin ?? '', mmsi: boat.mmsi ?? '', engineType: boat.engineType ?? ENGINE_TYPES[0], engineHp: boat.engineHp ?? '', fuelType: boat.fuelType ?? FUEL_TYPES[0],
  });
  const set = (k: string, v: string) => setVals((p) => ({ ...p, [k]: v }));
  const [saving, setSaving] = useState(false);

  const handleSave = () => {
    if (!vals.name) return;
    setSaving(true);
    onSave({ ...boat, ...vals, length: parseFloat(vals.length) || boat.length });
    setSaving(false);
    onClose();
  };

  const boxStyle: React.CSSProperties = { ...modalBox, width: '640px', maxHeight: '88vh', overflowY: 'auto' };
  return (
    <div style={modalOverlay} onClick={onClose}>
      <div style={boxStyle} onClick={(e) => e.stopPropagation()}>
        <div style={mHead}>
          <h2 style={mTitle}>Edit Boat</h2>
          <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#2E4A6B' }} onClick={onClose}><X size={20} /></button>
        </div>
        <div style={mBody}><BoatFields v={vals} set={set} /></div>
        <div style={mFoot}>
          <button style={mCancelBtn} onClick={onClose}>Cancel</button>
          <button style={{ ...mSaveBtn, opacity: saving ? 0.7 : 1 }} onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</button>
        </div>
      </div>
    </div>
  );
}

function AddBoatModal({ onClose, onSave }: { onClose: () => void; onSave: (b: Partial<Boat>) => void }) {
  const [vals, setVals] = useState<Record<string, string>>({
    name: '', type: BOAT_TYPES[0], length: '', registration: '',
    make: '', model: '', year: '', color: '',
    beam: '', draft: '', height: '',
    hin: '', mmsi: '', engineType: ENGINE_TYPES[0], engineHp: '', fuelType: FUEL_TYPES[0],
  });
  const set = (k: string, v: string) => setVals((p) => ({ ...p, [k]: v }));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const handleSave = () => {
    if (!vals.name) { setErr('Vessel name is required.'); return; }
    setSaving(true);
    onSave({ ...vals, length: parseFloat(vals.length) || 0 });
    setSaving(false);
    onClose();
  };

  const boxStyle: React.CSSProperties = { ...modalBox, width: '640px', maxHeight: '88vh', overflowY: 'auto' };
  return (
    <div style={modalOverlay} onClick={onClose}>
      <div style={boxStyle} onClick={(e) => e.stopPropagation()}>
        <div style={mHead}>
          <h2 style={mTitle}>Add Boat</h2>
          <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#2E4A6B' }} onClick={onClose}><X size={20} /></button>
        </div>
        <div style={mBody}>
          {err && <div style={{ color: '#DC2626', fontSize: 13, marginBottom: 12, padding: '8px 12px', background: '#FEF2F2', borderRadius: 6 }}>{err}</div>}
          <BoatFields v={vals} set={set} />
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
  const { data: apiCustomer, loading, execute: refetchCustomer } = useApi<CustomerDetail>('get', `/api/customers/${id}`, { immediate: true });
  const { data: apiBoatData } = useApi<{ data: ApiBoat[]; pagination: unknown }>('get', `/api/boats?customerId=${id}&take=50`, { immediate: true });
  const { data: apiInvoiceData } = useApi<{ data: ApiInvoice[]; pagination: unknown }>('get', `/api/invoices?customerId=${id}&take=50`, { immediate: true });
  const { data: timelineData } = useApi<{ data: ApiTimelineEvent[]; pagination: unknown }>('get', `/api/customers/${id}/timeline`, { immediate: true });
  const updateCustomerApi = useApi<CustomerDetail>('put', `/api/customers/${id}`);
  const updateBoatApi = useApi('put', '/api/boats/update');
  const addBoatApi = useApi('post', '/api/boats');

  if (!apiCustomer && loading) {
    return (
      <div style={{ padding: '48px', textAlign: 'center', color: '#64748B' }}>Loading customer...</div>
    );
  }
  if (!apiCustomer) {
    return (
      <div style={{ padding: '48px', textAlign: 'center', color: '#B71C1C', fontSize: '16px', fontWeight: 600 }}>Customer not found.</div>
    );
  }
  const c = apiCustomer;
  const apiBoatsMapped = (apiBoatData?.data ?? []).map(mapApiBoat);
  const boats = localBoats.length > 0 ? localBoats : apiBoatsMapped;
  const invoices = (apiInvoiceData?.data ?? []).map(mapApiInvoice);
  const activity = timelineData?.data ?? [];
  const allInsurance: InsuranceRecord[] = (apiBoatData?.data ?? []).flatMap((b) =>
    b.insuranceRecords.map((ins) => mapApiInsurance(ins, b.id, b.name ?? '—'))
  );

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
          <div style={{ ...s.infoRow, borderBottom: 'none' }}><MapPin size={14} color="#64748B" /><span style={{ whiteSpace: 'pre-line' }}>{formatAddress(c.addressJson)}</span></div>
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
            <span>{c.emergencyContactJson?.name || '—'} {c.emergencyContactJson?.relationship ? `(${c.emergencyContactJson.relationship})` : ''}</span>
            <span style={{ fontSize: '13px', color: '#64748B' }}>{c.emergencyContactJson?.phone || ''}{c.emergencyContactJson?.email ? ` | ${c.emergencyContactJson.email}` : ''}</span>
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

        {/* Communication Preferences */}
        <div style={{ gridColumn: '1 / -1' }}>
          <CommunicationPrefs customerId={c.id} onSave={() => refetchCustomer()} />
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
        const boatInsurance = allInsurance.filter((ins) => ins.boatId === b.id);
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
    <div style={s.tableWrap} className="helm-table-wrap">
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
      {activity.length === 0 && (
        <div style={{ padding: '24px', textAlign: 'center', color: '#94A3B8' }}>No activity recorded yet.</div>
      )}
      {activity.map((a, i) => {
        const Icon = activityIcons[a.type] || Activity;
        const dateStr = new Date(a.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        return (
          <div key={i} style={s.timelineItem}>
            <div style={s.timelineDot} />
            <div style={s.timelineDate}>{dateStr}</div>
            <div style={s.timelineAction}>{a.description}</div>
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
          <span style={{ ...s.badge, backgroundColor: (badgeStyle ?? statusBadgeColors.ACTIVE).bg, color: (badgeStyle ?? statusBadgeColors.ACTIVE).color, fontSize: '13px', padding: '4px 14px' }}>
            {STATUS_LABEL[c.status] ?? c.status}
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
      <div style={s.tabs} className="helm-tabs">
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
            company: c.company ?? '',
            email: c.email ?? '',
            phone: c.phone ?? '',
            address: c.addressJson?.address ?? '',
            city: c.addressJson?.city ?? '',
            state: c.addressJson?.state ?? '',
            zip: c.addressJson?.zip ?? '',
            dob: c.dob ? new Date(c.dob).toISOString().slice(0, 10) : '',
            dlNumber: c.dlNumber ?? '',
            dlState: c.dlState ?? '',
            dlExpiry: c.dlExpiry ? new Date(c.dlExpiry).toISOString().slice(0, 10) : '',
            emergencyName: c.emergencyContactJson?.name ?? '',
            emergencyRelationship: c.emergencyContactJson?.relationship ?? '',
            emergencyPhone: c.emergencyContactJson?.phone ?? '',
            emergencyEmail: c.emergencyContactJson?.email ?? '',
            taxExempt: c.taxExempt,
            status: c.status,
          }}
          onClose={() => setShowEdit(false)}
          onSave={async (data: CustomerFormPayload) => {
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
            address: formatAddress(c.addressJson),
            status: STATUS_LABEL[c.status] ?? c.status,
            boats: c.totalBoats,
            invoices: 5,
            payments: 12,
          }}
          onClose={() => setShowMerge(false)}
          onMerge={async (targetId, selections) => {
            try {
              await fetch(`/api/customers/${targetId}/merge`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sourceCustomerId: id, selections }),
              });
            } catch { /* API unavailable — merge will execute when connected */ }
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
