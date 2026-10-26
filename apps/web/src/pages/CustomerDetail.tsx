import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Edit, GitMerge, Mail, Phone, Building, MapPin,
  Calendar, CreditCard, Shield, Ship, FileText, DollarSign,
  Activity, Clock, User, AlertCircle, Plus, X, ToggleLeft, ToggleRight,
} from 'lucide-react';
import CustomerForm, { customerFormToPayload, STATUS_FROM_ENUM } from '../components/CustomerForm';
import CommunicationPrefs from '../components/CommunicationPrefs';
import { useApiClient, useList, useResource } from '../hooks/useApi';
import { errorMessage } from '../lib/api';
import { formatCents, formatDate, formatPhone, humanizeEnum } from '../lib/format';
import type { InvoiceDTO } from '../lib/dto';
import SlipSelect from '../components/SlipSelect';
import { ComingSoonButton, EmptyState, ErrorState, LoadingState } from '../components/StateViews';
import { useToast } from '../components/Toast';

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
  openInvoices: number; // cents
  credits: number; // cents
  deposits: number; // cents
  totalBoats: number;
  activeContracts: number;
  lifetimeBilled: number; // cents
  complianceScore: string;
}

interface Boat {
  id: string;
  name: string;
  length: number;
  registration: string;
  make?: string;
  model?: string;
  year?: string;
  beam?: string;
  draft?: string;
  hin?: string;
  engineHp?: string;
  fuelType?: string;
  insurance: InsuranceRecord[];
}

interface Invoice {
  id: string;
  number: string;
  amount: number; // cents
  balance: number; // cents
  status: string;
  date: string;
  due: string;
}

interface InsuranceRecord {
  id: string;
  provider: string;
  policyNumber: string;
  expiry: string | null;
  reviewStatus: string;
  status: 'Current' | 'Expiring Soon' | 'Expired' | 'No Expiry';
}

const insuranceStatusColors: Record<string, { bg: string; color: string }> = {
  Current: { bg: '#E8F5E9', color: '#1B5E20' },
  'Expiring Soon': { bg: '#FFF3CD', color: '#856404' },
  Expired: { bg: '#FDECEA', color: '#B71C1C' },
  'No Expiry': { bg: '#F2F4F6', color: '#64748B' },
};

/* ── API mapping ───────────────────────────────────────── */

interface BoatDTO {
  id: string;
  name?: string | null;
  registrationNumber?: string | null;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  lengthFt: number;
  beamFt?: number | null;
  draftFt?: number | null;
  hin?: string | null;
  fuelType?: string | null;
  engineHp?: number | null;
  insuranceRecords?: { id: string; insurer?: string | null; policyNumber?: string | null; expiryDate?: string | null; status: string }[];
}

interface CustomerDetailDTO {
  id: string;
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  addressJson?: Record<string, unknown> | null;
  status: string;
  dob?: string | null;
  dlNumber?: string | null;
  dlState?: string | null;
  dlExpiry?: string | null;
  emergencyContactJson?: { name?: string; relationship?: string; phone?: string; email?: string } | null;
  taxExempt: boolean;
  achBlocked: boolean;
  createdAt: string;
  boats: BoatDTO[];
  slipContracts: { id: string; status: string }[];
  invoiceSummary: { status: string; _sum: { totalCents: number | null } }[];
  complianceScore: string;
  balanceSummary: { openInvoicesTotalCents: number; creditsCents: number; securityDepositsHeldCents: number };
}

function dateOnly(v?: string | null): string {
  return v ? v.slice(0, 10) : '';
}

function addressText(a?: Record<string, unknown> | null): string {
  if (!a) return '';
  if (typeof a.line === 'string') return a.line;
  return Object.values(a).filter((v) => typeof v === 'string' && v).join('\n');
}

function insuranceStatus(expiry?: string | null): InsuranceRecord['status'] {
  if (!expiry) return 'No Expiry';
  const days = (new Date(expiry).getTime() - Date.now()) / 86400000;
  return days < 0 ? 'Expired' : days <= 30 ? 'Expiring Soon' : 'Current';
}

function toBoat(b: BoatDTO): Boat {
  return {
    id: b.id,
    name: b.name ?? 'Unnamed vessel',
    length: b.lengthFt,
    registration: b.registrationNumber ?? '',
    make: b.make ?? '',
    model: b.model ?? '',
    year: b.year ? String(b.year) : '',
    beam: b.beamFt ? String(b.beamFt) : '',
    draft: b.draftFt ? String(b.draftFt) : '',
    hin: b.hin ?? '',
    engineHp: b.engineHp ? String(b.engineHp) : '',
    fuelType: b.fuelType ?? '',
    insurance: (b.insuranceRecords ?? []).map((r) => ({
      id: r.id,
      provider: r.insurer ?? '—',
      policyNumber: r.policyNumber ?? '—',
      expiry: r.expiryDate ?? null,
      reviewStatus: humanizeEnum(r.status),
      status: insuranceStatus(r.expiryDate),
    })),
  };
}

function toCustomerDetail(c: CustomerDetailDTO): CustomerDetail & { boatsList: Boat[] } {
  const ec = c.emergencyContactJson ?? {};
  return {
    id: c.id,
    firstName: c.firstName,
    lastName: c.lastName,
    email: c.email ?? '',
    phone: c.phone ?? '',
    company: c.company ?? '',
    address: addressText(c.addressJson),
    status: (STATUS_FROM_ENUM[c.status] ?? 'Active') as CustomerDetail['status'],
    dob: dateOnly(c.dob),
    dlNumber: c.dlNumber ?? '',
    dlState: c.dlState ?? '',
    dlExpiry: dateOnly(c.dlExpiry),
    emergencyName: ec.name ?? '',
    emergencyRelationship: ec.relationship ?? '',
    emergencyPhone: ec.phone ?? '',
    emergencyEmail: ec.email ?? '',
    taxExempt: c.taxExempt,
    achBlocked: c.achBlocked,
    created: c.createdAt,
    openInvoices: c.balanceSummary?.openInvoicesTotalCents ?? 0,
    credits: c.balanceSummary?.creditsCents ?? 0,
    deposits: c.balanceSummary?.securityDepositsHeldCents ?? 0,
    totalBoats: c.boats?.length ?? 0,
    activeContracts: (c.slipContracts ?? []).filter((k) => k.status === 'ACTIVE' || k.status === 'EXPIRING').length,
    lifetimeBilled: (c.invoiceSummary ?? []).filter((g) => g.status !== 'VOID' && g.status !== 'DRAFT').reduce((sum, g) => sum + (g._sum.totalCents ?? 0), 0),
    complianceScore: c.complianceScore,
    boatsList: (c.boats ?? []).map(toBoat),
  };
}

function toInvoiceRow(i: InvoiceDTO): Invoice {
  return { id: i.id, number: i.invoiceNumber, amount: i.totalCents, balance: i.balanceCents, status: humanizeEnum(i.status), date: i.issuedDate, due: i.dueDate };
}

interface TimelineEntry {
  type: string;
  id: string;
  timestamp: string;
  data: Record<string, unknown>;
}

function timelineText(e: TimelineEntry): string {
  const d = e.data ?? {};
  switch (e.type) {
    case 'INVOICE': return `Invoice ${d.invoiceNumber ?? ''} ${humanizeEnum(String(d.status ?? '')).toLowerCase()} · ${formatCents(Number(d.totalCents ?? 0))}`;
    case 'PAYMENT': return `Payment ${formatCents(Number(d.amountCents ?? 0))} via ${humanizeEnum(String(d.method ?? ''))} (${humanizeEnum(String(d.status ?? '')).toLowerCase()})`;
    case 'DOCK_WALK': return `Dock walk${d.slipNumber ? ` at slip ${d.slipNumber}` : ''}: ${humanizeEnum(String(d.status ?? ''))}${d.violationType ? ` (${d.violationType})` : ''}`;
    case 'ANNOUNCEMENT': return `Announcement “${d.subject ?? ''}” ${humanizeEnum(String(d.deliveryStatus ?? '')).toLowerCase()}`;
    case 'NOTE': return `${humanizeEnum(String(d.action ?? 'Updated'))}${d.userName ? ` by ${d.userName}` : ''}`;
    default: return humanizeEnum(e.type);
  }
}

function timelineIcon(type: string): string {
  return type === 'PAYMENT' ? 'payment' : type === 'INVOICE' ? 'billing' : type === 'DOCK_WALK' ? 'inspection' : type === 'ANNOUNCEMENT' ? 'document' : 'contract';
}

/** Build the boats API payload from the form (only fields the API stores). */
function boatPayload(v: Record<string, string>) {
  const num = (x: string) => (x.trim() && Number.isFinite(Number(x)) ? Number(x) : null);
  const int = (x: string) => (x.trim() && Number.isInteger(Number(x)) ? Number(x) : null);
  return {
    name: v.name.trim() || null,
    registrationNumber: v.registration.trim() || null,
    make: v.make.trim() || null,
    model: v.model.trim() || null,
    year: int(v.year),
    lengthFt: num(v.length) ?? 0,
    beamFt: num(v.beam),
    draftFt: num(v.draft),
    hin: v.hin.trim() || null,
    fuelType: v.fuelType && v.fuelType !== 'N/A' ? v.fuelType : null,
    engineHp: int(v.engineHp),
  };
}

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

const complianceBadge = (score: string): { bg: string; color: string } => {
  if (score === 'ALL_GOOD') return { bg: '#E8F5E9', color: '#1B5E20' };
  if (score === 'ATTENTION_REQUIRED') return { bg: '#FFF3CD', color: '#856404' };
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
          <label style={mLabel}>Length (ft) *</label>
          <input style={mInput} type="number" step="0.1" value={v.length} onChange={(e) => set('length', e.target.value)} placeholder="e.g. 38" />
        </div>
        <div style={mField}>
          <label style={mLabel}>Registration #</label>
          <input style={mInput} value={v.registration} onChange={(e) => set('registration', e.target.value)} placeholder="e.g. FL-1234-AB" />
        </div>
        <div style={mField}><label style={mLabel}>Year</label><input style={mInput} type="number" value={v.year} onChange={(e) => set('year', e.target.value)} placeholder="e.g. 2022" /></div>
        <div style={mField}><label style={mLabel}>Make</label><input style={mInput} value={v.make} onChange={(e) => set('make', e.target.value)} placeholder="e.g. Hunter" /></div>
        <div style={mField}><label style={mLabel}>Model</label><input style={mInput} value={v.model} onChange={(e) => set('model', e.target.value)} placeholder="e.g. 380" /></div>
      </div>
      <p style={secTitle}>Dimensions</p>
      <div style={mTwoCol}>
        <div style={mField}><label style={mLabel}>Beam (ft)</label><input style={mInput} type="number" step="0.1" value={v.beam} onChange={(e) => set('beam', e.target.value)} placeholder="e.g. 12.5" /></div>
        <div style={mField}><label style={mLabel}>Draft (ft)</label><input style={mInput} type="number" step="0.1" value={v.draft} onChange={(e) => set('draft', e.target.value)} placeholder="e.g. 5.5" /></div>
      </div>
      <p style={secTitle}>Identification</p>
      <div style={mTwoCol}>
        <div style={mField}><label style={mLabel}>HIN</label><input style={mInput} value={v.hin} onChange={(e) => set('hin', e.target.value)} placeholder="Hull ID Number" /></div>
      </div>
      <p style={secTitle}>Engine & Fuel</p>
      <div style={mTwoCol}>
        <div style={mField}><label style={mLabel}>Engine HP</label><input style={mInput} type="number" value={v.engineHp} onChange={(e) => set('engineHp', e.target.value)} placeholder="e.g. 260" /></div>
        <div style={mField}><label style={mLabel}>Fuel Type</label>
          <select style={mSelect} value={v.fuelType} onChange={(e) => set('fuelType', e.target.value)}>
            {FUEL_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
      </div>
      <p style={{ fontSize: 12, color: '#64748B', marginTop: 8 }}>Vessel type, color, air draft, MMSI and engine type are not stored by the server yet, so they are not shown here.</p>
    </>
  );
}

function EditBoatModal({ boat, onClose, onSaved }: { boat: Boat; onClose: () => void; onSaved: () => void }) {
  const client = useApiClient();
  const [vals, setVals] = useState<Record<string, string>>({
    name: boat.name, length: String(boat.length), registration: boat.registration,
    make: boat.make ?? '', model: boat.model ?? '', year: boat.year ?? '',
    beam: boat.beam ?? '', draft: boat.draft ?? '',
    hin: boat.hin ?? '', engineHp: boat.engineHp ?? '', fuelType: boat.fuelType || FUEL_TYPES[0],
  });
  const set = (k: string, v: string) => setVals((p) => ({ ...p, [k]: v }));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const handleSave = async () => {
    if (!vals.name.trim()) { setErr('Vessel name is required.'); return; }
    if (!(Number(vals.length) > 0)) { setErr('Length must be greater than 0.'); return; }
    setSaving(true);
    setErr('');
    try {
      await client.put(`/boats/${boat.id}`, boatPayload(vals));
      onSaved();
      onClose();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const boxStyle: React.CSSProperties = { ...modalBox, width: '640px', maxHeight: '88vh', overflowY: 'auto' };
  return (
    <div style={modalOverlay} onClick={() => { if (!saving) onClose(); }}>
      <div style={boxStyle} className="helm-modal" onClick={(e) => e.stopPropagation()}>
        <div style={mHead}>
          <h2 style={mTitle}>Edit Boat</h2>
          <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#2E4A6B' }} onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        <div style={mBody}>
          {err && <div role="alert" style={{ color: '#DC2626', fontSize: 13, marginBottom: 12, padding: '8px 12px', background: '#FEF2F2', borderRadius: 6 }}>{err}</div>}
          <BoatFields v={vals} set={set} />
        </div>
        <div style={mFoot}>
          <button style={mCancelBtn} onClick={onClose} disabled={saving}>Cancel</button>
          <button style={{ ...mSaveBtn, opacity: saving ? 0.7 : 1 }} onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</button>
        </div>
      </div>
    </div>
  );
}

function AddBoatModal({ customerId, onClose, onSaved }: { customerId: string; onClose: () => void; onSaved: () => void }) {
  const client = useApiClient();
  const [vals, setVals] = useState<Record<string, string>>({
    name: '', length: '', registration: '',
    make: '', model: '', year: '',
    beam: '', draft: '',
    hin: '', engineHp: '', fuelType: FUEL_TYPES[0],
  });
  const set = (k: string, v: string) => setVals((p) => ({ ...p, [k]: v }));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const handleSave = async () => {
    if (!vals.name.trim()) { setErr('Vessel name is required.'); return; }
    if (!(Number(vals.length) > 0)) { setErr('Length must be greater than 0.'); return; }
    setSaving(true);
    setErr('');
    try {
      await client.post('/boats', { ...boatPayload(vals), customerId });
      onSaved();
      onClose();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const boxStyle: React.CSSProperties = { ...modalBox, width: '640px', maxHeight: '88vh', overflowY: 'auto' };
  return (
    <div style={modalOverlay} onClick={() => { if (!saving) onClose(); }}>
      <div style={boxStyle} className="helm-modal" onClick={(e) => e.stopPropagation()}>
        <div style={mHead}>
          <h2 style={mTitle}>Add Boat</h2>
          <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#2E4A6B' }} onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        <div style={mBody}>
          {err && <div role="alert" style={{ color: '#DC2626', fontSize: 13, marginBottom: 12, padding: '8px 12px', background: '#FEF2F2', borderRadius: 6 }}>{err}</div>}
          <BoatFields v={vals} set={set} />
        </div>
        <div style={mFoot}>
          <button style={mCancelBtn} onClick={onClose} disabled={saving}>Cancel</button>
          <button style={{ ...mSaveBtn, opacity: saving ? 0.7 : 1 }} onClick={handleSave} disabled={saving}>{saving ? 'Adding…' : 'Add Boat'}</button>
        </div>
      </div>
    </div>
  );
}

function NewContractFromBoatModal({ boat, customerId, onClose, onCreated }: { boat: Boat; customerId: string; onClose: () => void; onCreated: () => void }) {
  const client = useApiClient();
  const [slip, setSlip] = useState('');
  const [billingCycle, setBillingCycle] = useState('MONTHLY');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [rate, setRate] = useState('');
  const [deposit, setDeposit] = useState('');
  const [autoRenew, setAutoRenew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const handleSave = async () => {
    if (!slip || !startDate || !endDate || !rate) { setErr('Please fill in all required fields.'); return; }
    if (endDate <= startDate) { setErr('End date must be after the start date.'); return; }
    const rateCents = Math.round(Number(rate) * 100);
    if (!(rateCents > 0)) { setErr('Rate must be greater than $0.00.'); return; }
    setErr('');
    setSaving(true);
    try {
      await client.post('/contracts', {
        slipId: slip,
        customerId,
        boatId: boat.id,
        billingCycle,
        startDate,
        endDate,
        rateCents,
        securityDepositCents: deposit ? Math.round(Number(deposit) * 100) : null,
        autoRenew,
      });
      onCreated();
      onClose();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={modalOverlay} onClick={() => { if (!saving) onClose(); }}>
      <div style={modalBox} className="helm-modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ ...mHead, backgroundColor: '#0A2342' }}>
          <div>
            <h2 style={{ ...mTitle, color: '#FFFFFF' }}>New Contract</h2>
            <div style={{ fontSize: '13px', color: '#94A3B8', marginTop: '2px' }}>Vessel: {boat.name} ({boat.length}')</div>
          </div>
          <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#FFFFFF' }} onClick={onClose}><X size={20} /></button>
        </div>
        <div style={mBody}>
          {err && <div style={{ color: '#DC2626', fontSize: 13, marginBottom: 12, padding: '8px 12px', background: '#FEF2F2', borderRadius: 6 }}>{err}</div>}
          <div style={mTwoCol}>
            <div style={mField}>
              <label style={mLabel}>Slip *</label>
              <SlipSelect style={mSelect} value={slip} onChange={(id) => setSlip(id)} minLengthFt={boat.length} />
            </div>
            <div style={mField}>
              <label style={mLabel}>Billing Cycle</label>
              <select style={mSelect} value={billingCycle} onChange={(e) => setBillingCycle(e.target.value)}>
                <option value="MONTHLY">Monthly</option>
                <option value="QUARTERLY">Quarterly</option>
                <option value="SEMI_ANNUAL">Semi-Annual</option>
                <option value="ANNUAL">Annual</option>
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
          <button style={mCancelBtn} onClick={onClose} disabled={saving}>Cancel</button>
          <button style={{ ...mSaveBtn, opacity: saving ? 0.7 : 1 }} onClick={handleSave} disabled={saving}>{saving ? 'Creating…' : 'Create Contract'}</button>
        </div>
      </div>
    </div>
  );
}

/* ── Component ─────────────────────────────────────────── */

type Tab = 'overview' | 'boats' | 'billing' | 'documents' | 'activity';

export default function CustomerDetailPage() {
  const client = useApiClient();
  const { id } = useParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('overview');
  const [showEdit, setShowEdit] = useState(false);
  const [editingBoat, setEditingBoat] = useState<Boat | null>(null);
  const [showAddBoat, setShowAddBoat] = useState(false);
  const [newContractBoat, setNewContractBoat] = useState<Boat | null>(null);
  const toast = useToast();

  const detail = useResource<CustomerDetail & { boatsList: Boat[] }, CustomerDetailDTO>(id ? `/customers/${id}` : null, { map: toCustomerDetail });
  const invoiceList = useList<Invoice, InvoiceDTO>(id ? `/invoices?customerId=${id}&take=100&sortBy=issuedDate&sortOrder=desc` : null, { map: toInvoiceRow });
  const timeline = useList<TimelineEntry>(id && tab === 'activity' ? `/customers/${id}/timeline?take=50` : null);
  const refetchCustomer = detail.refetch;

  if (detail.loading) {
    return <div style={s.page}><LoadingState label="Loading customer…" /></div>;
  }
  if (!detail.data) {
    return (
      <div style={s.page}>
        <button style={s.backRow} onClick={() => navigate('/customers')}>
          <ArrowLeft size={16} /> Back to Customers
        </button>
        {detail.notFound
          ? <ErrorState title="Customer not found" message={`There is no customer with id ${id}.`} />
          : <ErrorState title="Could not load this customer" message={detail.error} onRetry={detail.refetch} />}
      </div>
    );
  }

  const c = detail.data;
  const boats = c.boatsList;
  const invoices = invoiceList.items;
  const badgeStyle = statusBadgeColors[c.status];

  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'boats', label: 'Boats' },
    { key: 'billing', label: 'Billing' },
    { key: 'documents', label: 'Documents' },
    { key: 'activity', label: 'Activity' },
  ];

  const fmt = (cents: number) => formatCents(cents);

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
          <div style={s.statValue}>{fmt(c.lifetimeBilled)}</div>
          <div style={s.statLabel}>Lifetime Billed</div>
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
          <div style={s.infoRow}><Mail size={14} color="#64748B" /><span>{c.email || '—'}</span></div>
          <div style={s.infoRow}><Phone size={14} color="#64748B" /><span>{c.phone ? formatPhone(c.phone) : '—'}</span></div>
          <div style={s.infoRow}><Building size={14} color="#64748B" /><span>{c.company || '—'}</span></div>
          <div style={{ ...s.infoRow, borderBottom: 'none' }}><MapPin size={14} color="#64748B" /><span style={{ whiteSpace: 'pre-line' }}>{c.address || '—'}</span></div>
        </div>

        {/* Identity Card */}
        <div style={s.card}>
          <div style={s.cardTitle}><Shield size={16} /> Identity</div>
          <div style={s.infoRow}>
            <span style={s.infoLabel}>DOB</span>
            <span>{c.dob ? formatDate(c.dob) : '—'}</span>
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
            <span>{c.dlExpiry ? formatDate(c.dlExpiry) : '—'}</span>
          </div>
          <div style={{ ...s.infoRow, borderBottom: 'none', flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}>
            <span style={{ ...s.infoLabel, minWidth: 'auto' }}>Emergency Contact</span>
            {c.emergencyName || c.emergencyPhone || c.emergencyEmail ? (
              <>
                <span>{c.emergencyName || '—'}{c.emergencyRelationship ? ` (${c.emergencyRelationship})` : ''}</span>
                <span style={{ fontSize: '13px', color: '#64748B' }}>{[c.emergencyPhone, c.emergencyEmail].filter(Boolean).join(' | ') || '—'}</span>
              </>
            ) : (
              <span>—</span>
            )}
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
      {boats.length === 0 && <EmptyState title="No boats on file" message="Add this customer's vessel to create contracts and track insurance." />}
      {boats.map((b) => {
        const boatInsurance = b.insurance;
        return (
          <div key={b.id} style={{ ...s.card, padding: 0, overflow: 'hidden' }}>
            {/* Boat Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px', borderBottom: '1px solid #E2E8F0', backgroundColor: '#F8FAFC' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <Ship size={20} color="#0A2342" />
                <div>
                  <div style={{ fontSize: '18px', fontWeight: 700, color: '#0A2342' }}>{b.name}</div>
                  <div style={{ fontSize: '13px', color: '#64748B' }}>{b.length}'{b.registration ? <> &middot; {b.registration}</> : null}{b.make || b.model ? <> &middot; {[b.year, b.make, b.model].filter(Boolean).join(' ')}</> : null}</div>
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
                      <th style={{ ...s.th, fontSize: '11px', padding: '8px 12px' }}>Review</th>
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
                          <td style={{ ...s.td, backgroundColor: rowBg }}>{ins.reviewStatus}</td>
                          <td style={{ ...s.td, backgroundColor: rowBg, color: '#64748B' }}>{formatDate(ins.expiry)}</td>
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
  const renderBilling = () => invoiceList.loading ? <LoadingState /> : invoiceList.error ? <ErrorState message={invoiceList.error} onRetry={invoiceList.refetch} /> : invoices.length === 0 ? <EmptyState title="No invoices for this customer" /> : (
    <div style={s.tableWrap} className="helm-table-wrap">
      <table style={s.table}>
        <thead>
          <tr>
            <th style={s.th}>Invoice</th>
            <th style={s.th}>Total</th>
            <th style={s.th}>Balance</th>
            <th style={s.th}>Status</th>
            <th style={s.th}>Issued</th>
            <th style={s.th}>Due</th>
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
                <td style={{ ...s.td, backgroundColor: rowBg, fontWeight: 600, ...s.mono, color: '#0077A3' }}>{inv.number}</td>
                <td style={{ ...s.td, backgroundColor: rowBg, ...s.mono }}>{fmt(inv.amount)}</td>
                <td style={{ ...s.td, backgroundColor: rowBg, ...s.mono }}>{fmt(inv.balance)}</td>
                <td style={{ ...s.td, backgroundColor: rowBg }}>
                  <span style={{ ...s.badge, backgroundColor: ib.bg, color: ib.color }}>{inv.status}</span>
                </td>
                <td style={{ ...s.td, backgroundColor: rowBg, color: '#64748B' }}>{formatDate(inv.date)}</td>
                <td style={{ ...s.td, backgroundColor: rowBg, color: '#64748B' }}>{formatDate(inv.due)}</td>
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
        Documents are not available yet
      </h3>
      <p style={{ fontSize: '15px', color: '#64748B', margin: '0 0 24px' }}>
        Document storage for customers is not connected yet. Insurance records on file are listed on the Boats tab.
      </p>
      <ComingSoonButton reason="Coming soon: document upload is not connected yet." style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 20px', fontSize: '14px', fontWeight: 600, color: '#FFFFFF', backgroundColor: '#0A2342', border: 'none', borderRadius: '6px' }}>
        Upload Document
      </ComingSoonButton>
    </div>
  );

  /* ── Activity Tab ─── */
  const renderActivity = () => timeline.loading ? <LoadingState /> : timeline.error ? <ErrorState message={timeline.error} onRetry={timeline.refetch} /> : timeline.items.length === 0 ? <EmptyState title="No activity yet" /> : (
    <div style={s.timeline}>
      <div style={s.timelineLine} />
      {timeline.items.map((a) => {
        const Icon = activityIcons[timelineIcon(a.type)] || Activity;
        return (
          <div key={`${a.type}-${a.id}`} style={s.timelineItem}>
            <div style={s.timelineDot} />
            <div style={s.timelineDate}><Icon size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />{formatDate(a.timestamp)}</div>
            <div style={s.timelineAction}>{timelineText(a)}</div>
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

      <div style={s.headerRow}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <h1 style={s.name}>{c.firstName} {c.lastName}</h1>
          <span style={{ ...s.badge, backgroundColor: badgeStyle.bg, color: badgeStyle.color, fontSize: '13px', padding: '4px 14px' }}>
            {c.status}
          </span>
          <span style={{ ...s.badge, ...complianceBadge(c.complianceScore), backgroundColor: complianceBadge(c.complianceScore).bg, fontSize: '12px' }} title="Insurance and registration compliance across this customer's boats">
            {humanizeEnum(c.complianceScore)}
          </span>
        </div>
        <div style={s.btnGroup}>
          <button style={s.secondaryBtn} onClick={() => setShowEdit(true)}>
            <Edit size={14} /> Edit
          </button>
          <ComingSoonButton style={s.secondaryBtn} reason="Coming soon: merge needs a real duplicate-customer search before it can be enabled.">
            <GitMerge size={14} /> Merge
          </ComingSoonButton>
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
            await client.put(`/customers/${c.id}`, customerFormToPayload(data));
            toast.success('Customer updated');
            refetchCustomer();
            setShowEdit(false);
          }}
        />
      )}

      {editingBoat && (
        <EditBoatModal
          boat={editingBoat}
          onClose={() => setEditingBoat(null)}
          onSaved={() => { toast.success('Boat updated'); refetchCustomer(); }}
        />
      )}

      {showAddBoat && (
        <AddBoatModal
          customerId={c.id}
          onClose={() => setShowAddBoat(false)}
          onSaved={() => { toast.success('Boat added'); refetchCustomer(); }}
        />
      )}

      {newContractBoat && (
        <NewContractFromBoatModal
          boat={newContractBoat}
          customerId={c.id}
          onClose={() => setNewContractBoat(null)}
          onCreated={() => { toast.success('Draft contract created'); refetchCustomer(); }}
        />
      )}
    </div>
  );
}
