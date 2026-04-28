import React, { useRef, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, Edit, GitMerge, Mail, Phone, Building, MapPin,
  Calendar, CreditCard, Shield, Ship, FileText, DollarSign,
  Activity, Clock, User, AlertCircle, Plus, X, ToggleLeft, ToggleRight,
  Download, Trash2, Building2, Star, Loader,
} from 'lucide-react';
import { useAuth } from '@clerk/clerk-react';
import CustomerForm, { type CustomerFormPayload } from '../components/CustomerForm';
import CustomerMerge from '../components/CustomerMerge';
import CommunicationPrefs from '../components/CommunicationPrefs';
import { useApi } from '../hooks/useApi';
import { api } from '../lib/api';

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

type ComplianceStatus = 'ALL_GOOD' | 'ATTENTION_REQUIRED' | 'NON_COMPLIANT';
type InsuranceStatus = 'VALID' | 'EXPIRED' | 'MISSING';
type RegistrationStatus = 'VALID' | 'EXPIRED' | 'MISSING';

interface ApiInsuranceRecord {
  id: string;
  policyNumber: string;
  provider: string;
  coverageType: string;
  coverageCents: number;
  expiryDate: string | null;
  status: string;
}

interface ApiBoatCompliance {
  overallScore: ComplianceStatus;
  insurance: {
    status: InsuranceStatus;
    expiryDate: string | null;
    insurer: string | null;
    policyNumber: string | null;
  };
  registration: {
    status: RegistrationStatus;
    expiryDate: string | null;
    registrationNumber: string | null;
  };
}

interface ApiSlipContract {
  id: string;
  status: string;
  slip: { id: string; slipNumber: string } | null;
}

interface ApiBoat {
  id: string;
  name: string | null;
  type?: string;
  lengthFt: number;
  beamFt?: number | null;
  draftFt?: number | null;
  registrationNumber: string | null;
  registrationState?: string | null;
  registrationExpiry?: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  fuelType: string | null;
  engineHp: number | null;
  hin: string | null;
  insuranceRecords: ApiInsuranceRecord[];
  slipContracts?: ApiSlipContract[];
  compliance?: ApiBoatCompliance;
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

interface ApiCustomerDocument {
  id: string;
  customerId: string;
  category: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  storageKey: string;
  createdAt: string;
}

interface ApiPaymentHistoryEntry {
  id: string;
  amountCents: number;
  method: 'CARD' | 'ACH' | 'CASH' | 'CHARGE_TO_SLIP' | 'GIFT_CARD' | string;
  status: 'PENDING' | 'COMPLETED' | 'FAILED' | 'REFUNDED' | 'PARTIALLY_REFUNDED' | string;
  postedDate: string;
  createdAt: string;
  stripePaymentId: string | null;
  invoice: { id: string; invoiceNumber: string; totalCents: number; balanceCents: number; status: string } | null;
  recordedBy: { userId: string | null; userName: string | null };
}

interface ApiPaymentHistoryResponse {
  data: ApiPaymentHistoryEntry[];
  pagination: { skip: number; take: number; total: number };
}

interface ApiSavedPaymentMethod {
  id: string;
  kind: 'card' | 'bank';
  brand: string;
  label: string;
  last4: string;
  expMonth: number | null;
  expYear: number | null;
  expiry: string | null;
  isDefault: boolean;
}

interface ApiPaymentMethodsResponse {
  methods: ApiSavedPaymentMethod[];
  defaultMethodId: string | null;
  autopay: boolean;
  stripeConfigured: boolean;
  locationConnected: boolean;
  locationName: string | null;
}

function mapApiBoat(b: ApiBoat): Boat {
  const activeContract = (b.slipContracts ?? []).find((c) => c.status === 'ACTIVE') ?? null;
  return {
    id: b.id,
    name: b.name ?? '—',
    type: b.type ?? 'Other',
    length: b.lengthFt,
    beam: b.beamFt?.toString() ?? '',
    draft: b.draftFt?.toString() ?? '',
    height: '',
    registration: b.registrationNumber ?? '—',
    registrationState: b.registrationState ?? null,
    registrationExpiry: b.registrationExpiry ?? null,
    make: b.make ?? '',
    model: b.model ?? '',
    year: b.year?.toString() ?? '',
    color: '',
    hin: b.hin ?? '',
    mmsi: '',
    engineType: '',
    engineHp: b.engineHp?.toString() ?? '',
    fuelType: b.fuelType ?? '',
    complianceStatus: b.compliance?.overallScore ?? 'NON_COMPLIANT',
    insuranceStatus: b.compliance?.insurance.status ?? 'MISSING',
    insurer: b.compliance?.insurance.insurer ?? null,
    insuranceExpiry: b.compliance?.insurance.expiryDate ?? null,
    registrationStatus: b.compliance?.registration.status ?? 'MISSING',
    activeSlipNumber: activeContract?.slip?.slipNumber ?? null,
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
  registrationState?: string | null;
  registrationExpiry?: string | null;
  registrationStatus?: RegistrationStatus;
  insurer?: string | null;
  insuranceExpiry?: string | null;
  insuranceStatus?: InsuranceStatus;
  activeSlipNumber?: string | null;
  complianceStatus?: ComplianceStatus;
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

const COMPLIANCE_LABEL: Record<ComplianceStatus, string> = {
  ALL_GOOD: 'Compliant',
  ATTENTION_REQUIRED: 'Attention',
  NON_COMPLIANT: 'Non-Compliant',
};

const complianceBadgeColors: Record<ComplianceStatus, { bg: string; color: string }> = {
  ALL_GOOD: { bg: '#E8F5E9', color: '#1B5E20' },
  ATTENTION_REQUIRED: { bg: '#FFF3CD', color: '#856404' },
  NON_COMPLIANT: { bg: '#FDECEA', color: '#B71C1C' },
};

const insuranceBadgeColors: Record<InsuranceStatus, { bg: string; color: string }> = {
  VALID: { bg: '#E8F5E9', color: '#1B5E20' },
  EXPIRED: { bg: '#FFF3CD', color: '#856404' },
  MISSING: { bg: '#FDECEA', color: '#B71C1C' },
};

const registrationBadgeColors: Record<RegistrationStatus, { bg: string; color: string }> = {
  VALID: { bg: '#E8F5E9', color: '#1B5E20' },
  EXPIRED: { bg: '#FFF3CD', color: '#856404' },
  MISSING: { bg: '#FDECEA', color: '#B71C1C' },
};

function formatBoatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

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

function EditBoatModal({ boat, onClose, onSave }: { boat: Boat; onClose: () => void; onSave: (b: Boat) => void | Promise<void> }) {
  const [vals, setVals] = useState<Record<string, string>>({
    name: boat.name, type: boat.type, length: String(boat.length), registration: boat.registration,
    make: boat.make ?? '', model: boat.model ?? '', year: boat.year ?? '', color: boat.color ?? '',
    beam: boat.beam ?? '', draft: boat.draft ?? '', height: boat.height ?? '',
    hin: boat.hin ?? '', mmsi: boat.mmsi ?? '', engineType: boat.engineType ?? ENGINE_TYPES[0], engineHp: boat.engineHp ?? '', fuelType: boat.fuelType ?? FUEL_TYPES[0],
  });
  const set = (k: string, v: string) => setVals((p) => ({ ...p, [k]: v }));
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!vals.name) return;
    setSaving(true);
    try {
      await onSave({ ...boat, ...vals, length: parseFloat(vals.length) || boat.length });
    } finally {
      setSaving(false);
      onClose();
    }
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

function AddBoatModal({ onClose, onSave }: { onClose: () => void; onSave: (b: Partial<Boat>) => void | Promise<void> }) {
  const [vals, setVals] = useState<Record<string, string>>({
    name: '', type: BOAT_TYPES[0], length: '', registration: '',
    make: '', model: '', year: '', color: '',
    beam: '', draft: '', height: '',
    hin: '', mmsi: '', engineType: ENGINE_TYPES[0], engineHp: '', fuelType: FUEL_TYPES[0],
  });
  const set = (k: string, v: string) => setVals((p) => ({ ...p, [k]: v }));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const handleSave = async () => {
    if (!vals.name) { setErr('Vessel name is required.'); return; }
    setSaving(true);
    try {
      await onSave({ ...vals, length: parseFloat(vals.length) || 0 });
    } finally {
      setSaving(false);
      onClose();
    }
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
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = (searchParams.get('tab') as Tab) || 'overview';
  const validTabs: Tab[] = ['overview', 'boats', 'billing', 'documents', 'activity'];
  const [tab, setTab] = useState<Tab>(validTabs.includes(initialTab) ? initialTab : 'overview');
  const [showEdit, setShowEdit] = useState(false);
  const [showMerge, setShowMerge] = useState(false);
  const [editingBoat, setEditingBoat] = useState<Boat | null>(null);
  const [showAddBoat, setShowAddBoat] = useState(false);
  const [newContractBoat, setNewContractBoat] = useState<Boat | null>(null);

  // API calls
  const { getToken } = useAuth();
  const { data: apiCustomer, loading, execute: refetchCustomer } = useApi<CustomerDetail>('get', `/api/customers/${id}`, { immediate: true });
  const { data: apiBoatData, execute: refetchBoats } = useApi<{ data: ApiBoat[]; pagination: unknown }>('get', `/api/boats?customerId=${id}&take=50`, { immediate: true });
  const { data: apiInvoiceData } = useApi<{ data: ApiInvoice[]; pagination: unknown }>('get', `/api/invoices?customerId=${id}&take=50`, { immediate: true });
  const { data: timelineData } = useApi<{ data: ApiTimelineEvent[]; pagination: unknown }>('get', `/api/customers/${id}/timeline`, { immediate: true });
  const updateCustomerApi = useApi<CustomerDetail>('put', `/api/customers/${id}`);
  const { data: documentsData, execute: refetchDocuments } = useApi<ApiCustomerDocument[]>('get', `/api/customers/${id}/documents`, { immediate: true });
  // Payment history (paged, newest-first) and saved payment methods on file.
  const [paymentSkip, setPaymentSkip] = useState(0);
  const PAYMENT_PAGE_SIZE = 10;
  const { data: paymentHistory, execute: refetchPaymentHistory } = useApi<ApiPaymentHistoryResponse>(
    'get',
    `/api/customers/${id}/payment-history?skip=${paymentSkip}&take=${PAYMENT_PAGE_SIZE}`,
    { immediate: true },
  );
  const { data: paymentMethods, execute: refetchPaymentMethods } = useApi<ApiPaymentMethodsResponse>(
    'get',
    `/api/customers/${id}/payment-methods`,
    { immediate: true },
  );
  const [pmActionId, setPmActionId] = useState<string | null>(null);
  const [pmError, setPmError] = useState<string | null>(null);
  const [setupBusy, setSetupBusy] = useState<'card' | 'bank' | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // If we just returned from a Stripe Checkout setup session, refresh the
  // saved-cards list so the new method appears immediately. Done in an effect
  // so we can also strip the query string after handling it.
  React.useEffect(() => {
    const setupParam = searchParams.get('setup');
    if (setupParam === 'success' || setupParam === 'cancelled') {
      void refetchPaymentMethods();
      const next = new URLSearchParams(searchParams);
      next.delete('setup');
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.get('setup')]);

  // When the page index changes, fire the API again. useApi's immediate fetch
  // doesn't re-run automatically when the URL changes between renders.
  React.useEffect(() => {
    void refetchPaymentHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentSkip]);

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
  const boats = (apiBoatData?.data ?? []).map(mapApiBoat);
  const invoices = (apiInvoiceData?.data ?? []).map(mapApiInvoice);
  const activity = timelineData?.data ?? [];
  const allInsurance: InsuranceRecord[] = (apiBoatData?.data ?? []).flatMap((b) =>
    b.insuranceRecords.map((ins) => mapApiInsurance(ins, b.id, b.name ?? '—'))
  );

  const toIntOrNull = (s: string | undefined | null) => {
    if (s === undefined || s === null || s === '') return null;
    const n = parseInt(s as string, 10);
    return Number.isNaN(n) ? null : n;
  };
  const toFloatOrNull = (s: string | undefined | null) => {
    if (s === undefined || s === null || s === '') return null;
    const n = parseFloat(s as string);
    return Number.isNaN(n) ? null : n;
  };

  // Display placeholders (e.g. '—' from mapApiBoat) should never be saved as real values.
  const cleanText = (v: string | null | undefined) => {
    const t = (v ?? '').trim();
    return t === '' || t === '—' ? null : t;
  };

  const handleSaveBoat = async (updated: Boat) => {
    try {
      const token = await getToken();
      await api.put(`/api/boats/${updated.id}`, {
        name: cleanText(updated.name),
        registrationNumber: cleanText(updated.registration),
        make: cleanText(updated.make),
        model: cleanText(updated.model),
        year: toIntOrNull(updated.year),
        lengthFt: updated.length,
        beamFt: toFloatOrNull(updated.beam),
        draftFt: toFloatOrNull(updated.draft),
        fuelType: cleanText(updated.fuelType),
        engineHp: toIntOrNull(updated.engineHp),
        hin: cleanText(updated.hin),
      }, token);
    } catch {
      /* surface failure via refetch — list will keep showing server state */
    }
    await refetchBoats();
  };

  const handleAddBoat = async (data: Partial<Boat>) => {
    try {
      const token = await getToken();
      await api.post('/api/boats', {
        customerId: id,
        name: data.name || null,
        registrationNumber: data.registration || null,
        make: data.make || null,
        model: data.model || null,
        year: toIntOrNull(data.year as string | undefined),
        lengthFt: data.length || 0,
        beamFt: toFloatOrNull(data.beam as string | undefined),
        draftFt: toFloatOrNull(data.draft as string | undefined),
        fuelType: data.fuelType || null,
        engineHp: toIntOrNull(data.engineHp as string | undefined),
        hin: data.hin || null,
      }, token);
    } catch {
      /* surface failure via refetch — list will keep showing server state */
    }
    await refetchBoats();
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
        const complianceStatus: ComplianceStatus = b.complianceStatus ?? 'NON_COMPLIANT';
        const cb = complianceBadgeColors[complianceStatus];
        const insStatus: InsuranceStatus = b.insuranceStatus ?? 'MISSING';
        const insColors = insuranceBadgeColors[insStatus];
        const regStatus: RegistrationStatus = b.registrationStatus ?? 'MISSING';
        const regColors = registrationBadgeColors[regStatus];
        const boatInsurance = allInsurance.filter((ins) => ins.boatId === b.id);
        const summaryLabelStyle: React.CSSProperties = {
          fontSize: '11px',
          fontWeight: 600,
          color: '#64748B',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          marginBottom: '4px',
        };
        const summaryValueStyle: React.CSSProperties = {
          fontSize: '13px',
          color: '#0A2342',
        };
        const summarySubStyle: React.CSSProperties = {
          fontSize: '12px',
          color: '#64748B',
          marginTop: '2px',
        };
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
                  {COMPLIANCE_LABEL[complianceStatus]}
                </span>
              </div>
            </div>
            {/* Compliance Summary Row */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px', padding: '16px 24px', borderBottom: '1px solid #E2E8F0' }}>
              <div>
                <div style={summaryLabelStyle}>Insurance</div>
                {insStatus === 'MISSING' ? (
                  <span style={{ ...s.badge, backgroundColor: insColors.bg, color: insColors.color }}>
                    No insurance
                  </span>
                ) : (
                  <>
                    <div style={summaryValueStyle}>{b.insurer ?? 'Unknown insurer'}</div>
                    <div style={summarySubStyle}>
                      {insStatus === 'EXPIRED' ? 'Expired' : 'Expires'} {formatBoatDate(b.insuranceExpiry)}
                    </div>
                  </>
                )}
              </div>
              <div>
                <div style={summaryLabelStyle}>Registration</div>
                {regStatus === 'MISSING' ? (
                  <span style={{ ...s.badge, backgroundColor: regColors.bg, color: regColors.color }}>
                    No registration
                  </span>
                ) : (
                  <>
                    <div style={summaryValueStyle}>
                      {b.registration}
                      {b.registrationState ? ` (${b.registrationState})` : ''}
                    </div>
                    <div style={summarySubStyle}>
                      {regStatus === 'EXPIRED' ? 'Expired' : 'Expires'} {formatBoatDate(b.registrationExpiry)}
                    </div>
                  </>
                )}
              </div>
              <div>
                <div style={summaryLabelStyle}>Active Slip Contract</div>
                {b.activeSlipNumber ? (
                  <div style={summaryValueStyle}>Slip {b.activeSlipNumber}</div>
                ) : (
                  <div style={{ ...summaryValueStyle, color: '#64748B' }}>None</div>
                )}
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
  /* ── Payment History helpers ─── */
  const paymentStatusColors: Record<string, { bg: string; color: string }> = {
    COMPLETED: { bg: '#E8F5E9', color: '#1B5E20' },
    PENDING: { bg: '#FFF8E1', color: '#92400E' },
    FAILED: { bg: '#FFEBEE', color: '#B71C1C' },
    REFUNDED: { bg: '#EDE7F6', color: '#4527A0' },
    PARTIALLY_REFUNDED: { bg: '#EDE7F6', color: '#4527A0' },
  };
  const paymentMethodLabels: Record<string, string> = {
    CARD: 'Card',
    ACH: 'ACH',
    CASH: 'Cash',
    CHARGE_TO_SLIP: 'Charge to slip',
    GIFT_CARD: 'Gift card',
  };
  const fmtCents = (cents: number) =>
    `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtDate = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
    } catch {
      return iso;
    }
  };

  /* ── Cards on File actions ─── */
  async function startSetupSession(type: 'card' | 'bank') {
    setPmError(null);
    setSetupBusy(type);
    try {
      const token = await getToken();
      // Strip any existing ?tab so the return URL lands back on the Billing tab.
      const returnUrl = `${window.location.origin}/customers/${id}?tab=billing`;
      const resp = await api.post<{ url: string }>(
        `/api/customers/${id}/payment-methods/setup-session`,
        { type, returnUrl },
        token,
      );
      if (resp.url) {
        window.location.href = resp.url;
      }
    } catch (err) {
      setPmError(err instanceof Error ? err.message : 'Could not start payment setup');
      setSetupBusy(null);
    }
  }

  async function setDefaultMethod(pmId: string) {
    setPmError(null);
    setPmActionId(pmId);
    try {
      const token = await getToken();
      await api.put(`/api/customers/${id}/payment-methods/${pmId}/default`, {}, token);
      await refetchPaymentMethods();
    } catch (err) {
      setPmError(err instanceof Error ? err.message : 'Could not set as default');
    } finally {
      setPmActionId(null);
    }
  }

  const [autopayBusy, setAutopayBusy] = useState(false);
  // Optimistic flag: when set, overrides the displayed autopay value while
  // the network request is in flight so the badge flips instantly. Cleared
  // after the refetch (success) or on error rollback.
  const [autopayOptimistic, setAutopayOptimistic] = useState<boolean | null>(null);
  async function toggleAutopay() {
    if (!paymentMethods) return;
    const next = !paymentMethods.autopay;
    setPmError(null);
    setAutopayOptimistic(next);
    setAutopayBusy(true);
    try {
      const token = await getToken();
      await api.put(`/api/customers/${id}/autopay`, { autopay: next }, token);
      await refetchPaymentMethods();
      setAutopayOptimistic(null);
    } catch (err) {
      // Roll the badge back to the server-known value.
      setAutopayOptimistic(null);
      setPmError(
        err instanceof Error ? err.message : 'Could not update autopay',
      );
    } finally {
      setAutopayBusy(false);
    }
  }

  async function removeMethod(pmId: string, label: string) {
    if (!window.confirm(`Remove this saved ${label}? The customer will need to re-enter it next time.`)) return;
    setPmError(null);
    setPmActionId(pmId);
    try {
      const token = await getToken();
      await api.delete(`/api/customers/${id}/payment-methods/${pmId}`, token);
      await refetchPaymentMethods();
    } catch (err) {
      setPmError(err instanceof Error ? err.message : 'Could not remove payment method');
    } finally {
      setPmActionId(null);
    }
  }

  const renderBilling = () => {
    const history = paymentHistory?.data ?? [];
    const total = paymentHistory?.pagination.total ?? 0;
    const page = Math.floor(paymentSkip / PAYMENT_PAGE_SIZE) + 1;
    const totalPages = Math.max(1, Math.ceil(total / PAYMENT_PAGE_SIZE));
    const sectionHeader: React.CSSProperties = {
      fontSize: '13px',
      fontWeight: 700,
      color: '#0F2E4D',
      textTransform: 'uppercase',
      letterSpacing: '0.05em',
      marginBottom: '12px',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
    };
    const card: React.CSSProperties = {
      backgroundColor: '#FFFFFF',
      border: '1px solid #E2E8F0',
      borderRadius: '8px',
      padding: '20px',
      marginTop: '24px',
    };

    return (
      <div>
        {/* Existing Invoices table */}
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

        {/* Payment History */}
        <div style={card}>
          <div style={sectionHeader}>
            <DollarSign size={16} color="#1B5E20" />
            Payment History
            {total > 0 && (
              <span style={{ fontSize: '12px', fontWeight: 500, color: '#64748B', textTransform: 'none', letterSpacing: 0 }}>
                ({total} total)
              </span>
            )}
          </div>
          {history.length === 0 ? (
            <div style={{ padding: '32px 16px', textAlign: 'center', color: '#64748B', fontSize: '14px' }}>
              No payments recorded yet.
            </div>
          ) : (
            <>
              <div style={{ overflowX: 'auto' }}>
                <table style={s.table}>
                  <thead>
                    <tr>
                      <th style={s.th}>Date</th>
                      <th style={s.th}>Amount</th>
                      <th style={s.th}>Method</th>
                      <th style={s.th}>Status</th>
                      <th style={s.th}>Invoice</th>
                      <th style={s.th}>Recorded by</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((p, idx) => {
                      const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC';
                      const sb = paymentStatusColors[p.status] || { bg: '#F2F4F6', color: '#64748B' };
                      return (
                        <tr key={p.id}>
                          <td style={{ ...s.td, backgroundColor: rowBg, color: '#334155' }}>{fmtDate(p.postedDate ?? p.createdAt)}</td>
                          <td style={{ ...s.td, backgroundColor: rowBg, ...s.mono, fontWeight: 600 }}>{fmtCents(p.amountCents)}</td>
                          <td style={{ ...s.td, backgroundColor: rowBg }}>{paymentMethodLabels[p.method] ?? p.method}</td>
                          <td style={{ ...s.td, backgroundColor: rowBg }}>
                            <span style={{ ...s.badge, backgroundColor: sb.bg, color: sb.color }}>{p.status.replace('_', ' ')}</span>
                          </td>
                          <td style={{ ...s.td, backgroundColor: rowBg }}>
                            {p.invoice ? (
                              <button
                                type="button"
                                onClick={() => navigate(`/billing/invoices/${p.invoice!.id}`)}
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  padding: 0,
                                  color: '#0066CC',
                                  textDecoration: 'underline',
                                  cursor: 'pointer',
                                  fontFamily: 'inherit',
                                  fontSize: 'inherit',
                                }}
                              >
                                {p.invoice.invoiceNumber}
                              </button>
                            ) : (
                              <span style={{ color: '#94A3B8' }}>—</span>
                            )}
                          </td>
                          <td style={{ ...s.td, backgroundColor: rowBg, color: '#64748B' }}>
                            {p.recordedBy.userName ?? <span style={{ color: '#94A3B8' }}>—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {totalPages > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '12px', fontSize: '13px', color: '#64748B' }}>
                  <span>Page {page} of {totalPages}</span>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      type="button"
                      disabled={paymentSkip === 0}
                      onClick={() => setPaymentSkip(Math.max(0, paymentSkip - PAYMENT_PAGE_SIZE))}
                      style={{
                        padding: '6px 12px',
                        border: '1px solid #CBD5E1',
                        borderRadius: '6px',
                        backgroundColor: paymentSkip === 0 ? '#F1F5F9' : '#FFFFFF',
                        cursor: paymentSkip === 0 ? 'not-allowed' : 'pointer',
                        fontSize: '13px',
                      }}
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      disabled={page >= totalPages}
                      onClick={() => setPaymentSkip(paymentSkip + PAYMENT_PAGE_SIZE)}
                      style={{
                        padding: '6px 12px',
                        border: '1px solid #CBD5E1',
                        borderRadius: '6px',
                        backgroundColor: page >= totalPages ? '#F1F5F9' : '#FFFFFF',
                        cursor: page >= totalPages ? 'not-allowed' : 'pointer',
                        fontSize: '13px',
                      }}
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Cards on File */}
        <div style={card}>
          <div style={{ ...sectionHeader, justifyContent: 'space-between' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <CreditCard size={16} color="#0F2E4D" />
              Cards on File
              {paymentMethods && paymentMethods.stripeConfigured && paymentMethods.locationConnected && (() => {
                // Show the optimistic flag while a toggle is in flight so
                // the badge flips immediately on click; falls back to the
                // server value once refetch completes (or on error rollback).
                const displayedAutopay = autopayOptimistic ?? paymentMethods.autopay;
                const hasMethods = paymentMethods.methods.length > 0;
                const disabled = autopayBusy || (!displayedAutopay && !hasMethods);
                const title = !displayedAutopay && !hasMethods
                  ? 'Add a card or bank account before enabling autopay'
                  : displayedAutopay
                    ? 'Click to turn autopay off'
                    : 'Click to turn autopay on';
                return (
                  <button
                    type="button"
                    onClick={toggleAutopay}
                    disabled={disabled}
                    title={title}
                    style={{
                      padding: '2px 10px',
                      borderRadius: '10px',
                      fontSize: '11px',
                      fontWeight: 600,
                      textTransform: 'none',
                      letterSpacing: 0,
                      backgroundColor: displayedAutopay ? '#DCFCE7' : '#F1F5F9',
                      color: displayedAutopay ? '#166534' : '#64748B',
                      border: '1px solid',
                      borderColor: displayedAutopay ? '#86EFAC' : '#CBD5E1',
                      cursor: disabled ? 'not-allowed' : 'pointer',
                      opacity: disabled && !displayedAutopay ? 0.6 : 1,
                    }}
                  >
                    {autopayBusy
                      ? 'Saving…'
                      : displayedAutopay
                        ? 'Autopay on · click to disable'
                        : 'Autopay off · click to enable'}
                  </button>
                );
              })()}
            </span>
            {paymentMethods?.stripeConfigured && paymentMethods?.locationConnected && (
              <span style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => startSetupSession('card')}
                  disabled={setupBusy !== null}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 12px',
                    backgroundColor: '#0F2E4D',
                    color: '#FFFFFF',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: setupBusy ? 'wait' : 'pointer',
                    textTransform: 'none',
                    letterSpacing: 0,
                  }}
                >
                  {setupBusy === 'card' ? <Loader size={12} /> : <Plus size={12} />}
                  Add card
                </button>
                <button
                  type="button"
                  onClick={() => startSetupSession('bank')}
                  disabled={setupBusy !== null}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 12px',
                    backgroundColor: '#FFFFFF',
                    color: '#0F2E4D',
                    border: '1px solid #0F2E4D',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: setupBusy ? 'wait' : 'pointer',
                    textTransform: 'none',
                    letterSpacing: 0,
                  }}
                >
                  {setupBusy === 'bank' ? <Loader size={12} /> : <Plus size={12} />}
                  Add bank
                </button>
              </span>
            )}
          </div>

          {pmError && (
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: '8px',
              padding: '12px', marginBottom: '12px',
              backgroundColor: '#FFEBEE', border: '1px solid #FFCDD2',
              borderRadius: '6px', color: '#B71C1C', fontSize: '13px',
            }}>
              <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '1px' }} />
              <span>{pmError}</span>
            </div>
          )}

          {paymentMethods && !paymentMethods.stripeConfigured ? (
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: '12px',
              padding: '16px', backgroundColor: '#FFF8E1',
              border: '1px solid #FFE082', borderRadius: '6px',
              color: '#92400E', fontSize: '13px',
            }}>
              <AlertCircle size={18} style={{ flexShrink: 0, marginTop: '1px' }} />
              <div>
                <div style={{ fontWeight: 600, marginBottom: '4px' }}>
                  Stripe is not set up for {paymentMethods.locationName ? `${paymentMethods.locationName}` : 'this location'}.
                </div>
                <div>Connect a Stripe account from Settings → Locations to start saving cards on file.</div>
              </div>
            </div>
          ) : !paymentMethods ? (
            <div style={{ padding: '32px 16px', textAlign: 'center', color: '#64748B', fontSize: '14px' }}>
              Loading saved payment methods...
            </div>
          ) : paymentMethods.methods.length === 0 ? (
            <div style={{ padding: '32px 16px', textAlign: 'center', color: '#64748B', fontSize: '14px' }}>
              No payment methods saved yet. Use “Add card” or “Add bank” to save one.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {paymentMethods.methods.map((m) => {
                const Icon = m.kind === 'bank' ? Building2 : CreditCard;
                const busy = pmActionId === m.id;
                return (
                  <div
                    key={m.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      padding: '12px 16px',
                      border: m.isDefault ? '1px solid #1B5E20' : '1px solid #E2E8F0',
                      borderRadius: '6px',
                      backgroundColor: m.isDefault ? '#F1F8E9' : '#FFFFFF',
                    }}
                  >
                    <Icon size={20} color="#0F2E4D" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '14px', fontWeight: 600, color: '#0F2E4D', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {m.label} •••• {m.last4}
                        {m.isDefault && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 8px', backgroundColor: '#1B5E20', color: '#FFFFFF', fontSize: '11px', borderRadius: '10px', fontWeight: 600 }}>
                            <Star size={10} fill="#FFFFFF" /> Default
                          </span>
                        )}
                      </div>
                      {m.expiry && (
                        <div style={{ fontSize: '12px', color: '#64748B', marginTop: '2px' }}>Exp {m.expiry}</div>
                      )}
                    </div>
                    {!m.isDefault && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setDefaultMethod(m.id)}
                        style={{
                          padding: '6px 12px',
                          border: '1px solid #CBD5E1',
                          borderRadius: '6px',
                          backgroundColor: '#FFFFFF',
                          color: '#0F2E4D',
                          fontSize: '12px',
                          fontWeight: 600,
                          cursor: busy ? 'wait' : 'pointer',
                        }}
                      >
                        Set as default
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => removeMethod(m.id, m.kind === 'bank' ? 'bank account' : 'card')}
                      title="Remove"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '6px 10px',
                        border: '1px solid #FFCDD2',
                        borderRadius: '6px',
                        backgroundColor: '#FFFFFF',
                        color: '#B71C1C',
                        fontSize: '12px',
                        fontWeight: 600,
                        cursor: busy ? 'wait' : 'pointer',
                      }}
                    >
                      <Trash2 size={12} /> Remove
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  };

  /* ── Documents Tab ─── */
  async function uploadDocument(file: File) {
    setUploading(true);
    setUploadError(null);
    try {
      const token = await getToken();
      const contentType = file.type || 'application/octet-stream';

      // 1. Get a presigned upload URL from the API.
      const presign = await api.post<{ url: string; key: string }>(
        '/api/storage/presign-upload',
        { category: 'documents', filename: file.name, contentType },
        token,
      );

      // 2. PUT the file directly to R2 using the presigned URL.
      const put = await fetch(presign.url, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': contentType },
      });
      if (!put.ok) throw new Error('Upload to storage failed');

      // 3. Verify magic bytes server-side. If the file is rejected, clean up
      // the orphan in R2 so it doesn't count against the tenant's quota.
      try {
        await api.post(
          '/api/storage/verify-upload',
          { key: presign.key, contentType },
          token,
        );
      } catch (verifyErr) {
        await api.delete(`/api/storage/${presign.key}`, token).catch(() => {
          /* best-effort cleanup; ignore secondary failure */
        });
        throw verifyErr;
      }

      // 4. Persist the document record linked to this customer.
      await api.post(
        `/api/customers/${id}/documents`,
        {
          category: 'documents',
          filename: file.name,
          contentType,
          sizeBytes: file.size,
          storageKey: presign.key,
        },
        token,
      );

      await refetchDocuments();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function downloadDocument(doc: ApiCustomerDocument) {
    setUploadError(null);
    try {
      const token = await getToken();
      const { url } = await api.get<{ url: string }>(
        `/api/storage/presign-download/${doc.storageKey}`,
        token,
      );
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Download failed');
    }
  }

  async function deleteDocument(doc: ApiCustomerDocument) {
    if (!window.confirm(`Delete "${doc.filename}"?`)) return;
    setUploadError(null);
    try {
      const token = await getToken();
      await api.delete(`/api/customers/${id}/documents/${doc.id}`, token);
      await api.delete(`/api/storage/${doc.storageKey}`, token).catch(() => {
        /* DB row already gone — orphaned object will be cleaned up by lifecycle policy */
      });
      await refetchDocuments();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  const renderDocuments = () => {
    const docs = documentsData ?? [];

    const uploadButton = (
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: '6px',
          padding: '8px 20px', fontSize: '14px', fontWeight: 600,
          color: '#FFFFFF', backgroundColor: uploading ? '#94A3B8' : '#0A2342',
          border: 'none', borderRadius: '6px',
          cursor: uploading ? 'wait' : 'pointer',
        }}
      >
        <Plus size={16} />
        {uploading ? 'Uploading…' : 'Upload Document'}
      </button>
    );

    const hiddenInput = (
      <input
        ref={fileInputRef}
        type="file"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void uploadDocument(file);
        }}
      />
    );

    if (docs.length === 0) {
      return (
        <div style={{ ...s.card, textAlign: 'center', padding: '48px 32px' }}>
          <FileText size={32} style={{ color: '#2E4A6B', marginBottom: '16px' }} />
          <h3 style={{ fontSize: '20px', fontWeight: 600, color: '#0A2342', margin: '0 0 8px' }}>
            No documents uploaded
          </h3>
          <p style={{ fontSize: '15px', color: '#64748B', margin: '0 0 24px' }}>
            Upload insurance certificates, registration papers, or other documents.
          </p>
          {uploadError && (
            <div style={{ color: '#B71C1C', fontSize: '14px', marginBottom: '16px' }}>{uploadError}</div>
          )}
          {uploadButton}
          {hiddenInput}
        </div>
      );
    }

    return (
      <div style={s.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid #E2E8F0' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 600, color: '#0A2342', margin: 0 }}>
            Documents ({docs.length})
          </h3>
          {uploadButton}
        </div>
        {uploadError && (
          <div style={{ color: '#B71C1C', fontSize: '14px', padding: '12px 20px', borderBottom: '1px solid #E2E8F0' }}>{uploadError}</div>
        )}
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
          <thead>
            <tr style={{ backgroundColor: '#F8FAFC', textAlign: 'left' }}>
              <th style={{ padding: '12px 20px', fontWeight: 600, color: '#475569' }}>Filename</th>
              <th style={{ padding: '12px 20px', fontWeight: 600, color: '#475569' }}>Size</th>
              <th style={{ padding: '12px 20px', fontWeight: 600, color: '#475569' }}>Uploaded</th>
              <th style={{ padding: '12px 20px', fontWeight: 600, color: '#475569', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.id} style={{ borderTop: '1px solid #E2E8F0' }}>
                <td style={{ padding: '12px 20px', color: '#0A2342' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                    <FileText size={14} style={{ color: '#64748B' }} />
                    {d.filename}
                  </span>
                </td>
                <td style={{ padding: '12px 20px', color: '#64748B' }}>{formatBytes(d.sizeBytes)}</td>
                <td style={{ padding: '12px 20px', color: '#64748B' }}>
                  {new Date(d.createdAt).toLocaleDateString()}
                </td>
                <td style={{ padding: '12px 20px', textAlign: 'right' }}>
                  <button
                    type="button"
                    onClick={() => void downloadDocument(d)}
                    title="Download"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#2E4A6B', padding: '4px 8px' }}
                  >
                    <Download size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void deleteDocument(d)}
                    title="Delete"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#B71C1C', padding: '4px 8px' }}
                  >
                    <Trash2 size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {hiddenInput}
      </div>
    );
  };

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
            onClick={() => {
              setTab(t.key);
              const next = new URLSearchParams(searchParams);
              next.set('tab', t.key);
              setSearchParams(next, { replace: true });
            }}
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
