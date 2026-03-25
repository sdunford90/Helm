import { useState } from 'react';
import {
  Search,
  Plus,
  X,
  Phone,
  Mail,
  Star,
  Calendar,
  Clock,
  ChevronRight,
  User,
  Wrench,
  FileText,
  AlertCircle,
} from 'lucide-react';
import { useApi } from '../hooks/useApi';

/* ── Types ─────────────────────────────────────────────── */

type ServiceType = 'Detailing' | 'Cleaning' | 'Provisioning' | 'Pump-Out' | 'Mechanic' | 'Fueling' | 'Winterization';
type RequestStatus = 'Submitted' | 'Quoted' | 'Approved' | 'Scheduled' | 'In Progress' | 'Completed' | 'Invoiced';
type Urgency = 'Normal' | 'Urgent';
type TabKey = 'requests' | 'vendors';

interface ServiceRequest {
  id: string;
  requestNumber: string;
  customer: string;
  serviceType: ServiceType;
  boat: string;
  preferredDate: string;
  vendor: string;
  quote: number | null;
  status: RequestStatus;
  urgency: Urgency;
  notes: string;
  createdAt: string;
  timeline: { date: string; status: string; note: string }[];
}

interface Vendor {
  id: string;
  name: string;
  specialty: string;
  phone: string;
  email: string;
  rating: number;
  active: boolean;
}

/* ── Mock Data ─────────────────────────────────────────── */

const SERVICE_TYPES: ServiceType[] = ['Detailing', 'Cleaning', 'Provisioning', 'Pump-Out', 'Mechanic', 'Fueling', 'Winterization'];
const ALL_STATUSES: RequestStatus[] = ['Submitted', 'Quoted', 'Approved', 'Scheduled', 'In Progress', 'Completed', 'Invoiced'];

const MOCK_REQUESTS: ServiceRequest[] = [
  { id: '1', requestNumber: 'SR-3001', customer: 'James Harborview', serviceType: 'Detailing', boat: 'Sea Breeze (32 ft)', preferredDate: '2026-03-26', vendor: 'Marina Shine Co.', quote: 450, status: 'Scheduled', urgency: 'Normal', notes: 'Full hull and deck detail before season start.', createdAt: '2026-03-20',
    timeline: [{ date: '2026-03-20', status: 'Submitted', note: 'Request created' }, { date: '2026-03-21', status: 'Quoted', note: 'Quote: $450' }, { date: '2026-03-22', status: 'Approved', note: 'Customer approved quote' }, { date: '2026-03-23', status: 'Scheduled', note: 'Scheduled for Mar 26' }] },
  { id: '2', requestNumber: 'SR-3002', customer: 'Maria Fontaine', serviceType: 'Provisioning', boat: 'Windward Spirit (28 ft)', preferredDate: '2026-03-27', vendor: 'Harbor Provisions', quote: 320, status: 'Approved', urgency: 'Normal', notes: 'Weekend trip provisions for 6 guests. See attached list.', createdAt: '2026-03-21',
    timeline: [{ date: '2026-03-21', status: 'Submitted', note: 'Request created' }, { date: '2026-03-22', status: 'Quoted', note: 'Quote: $320' }, { date: '2026-03-23', status: 'Approved', note: 'Customer approved' }] },
  { id: '3', requestNumber: 'SR-3003', customer: 'Thomas Benavides', serviceType: 'Mechanic', boat: 'Reel Deal (36 ft)', preferredDate: '2026-03-25', vendor: 'Coastal Marine Repair', quote: 850, status: 'In Progress', urgency: 'Urgent', notes: 'Engine stalling at low RPM. Possible fuel injector issue.', createdAt: '2026-03-19',
    timeline: [{ date: '2026-03-19', status: 'Submitted', note: 'Request created - URGENT' }, { date: '2026-03-19', status: 'Quoted', note: 'Estimate: $850' }, { date: '2026-03-20', status: 'Approved', note: 'Customer approved' }, { date: '2026-03-20', status: 'Scheduled', note: 'Scheduled for Mar 25' }, { date: '2026-03-25', status: 'In Progress', note: 'Technician on-site' }] },
  { id: '4', requestNumber: 'SR-3004', customer: 'Jennifer Albright', serviceType: 'Cleaning', boat: 'Lady Luck (24 ft)', preferredDate: '2026-03-28', vendor: 'Unassigned', quote: null, status: 'Submitted', urgency: 'Normal', notes: 'Interior cabin deep cleaning before guest arrival.', createdAt: '2026-03-24',
    timeline: [{ date: '2026-03-24', status: 'Submitted', note: 'Request created' }] },
  { id: '5', requestNumber: 'SR-3005', customer: 'Daniel Marsh', serviceType: 'Pump-Out', boat: 'Poseidon\'s Trident (42 ft)', preferredDate: '2026-03-25', vendor: 'Bay Area Pump Services', quote: 75, status: 'Completed', urgency: 'Normal', notes: 'Routine pump-out service.', createdAt: '2026-03-22',
    timeline: [{ date: '2026-03-22', status: 'Submitted', note: 'Request created' }, { date: '2026-03-22', status: 'Quoted', note: 'Quote: $75' }, { date: '2026-03-23', status: 'Approved', note: 'Auto-approved under $100' }, { date: '2026-03-24', status: 'Scheduled', note: 'Scheduled for Mar 25' }, { date: '2026-03-25', status: 'In Progress', note: 'Service started' }, { date: '2026-03-25', status: 'Completed', note: 'Service completed' }] },
  { id: '6', requestNumber: 'SR-3006', customer: 'Susan Whitaker', serviceType: 'Fueling', boat: 'Calm Waters (30 ft)', preferredDate: '2026-03-24', vendor: 'Dockside Fuel', quote: 520, status: 'Invoiced', urgency: 'Normal', notes: 'Fill both tanks (diesel). Approx 120 gal.', createdAt: '2026-03-20',
    timeline: [{ date: '2026-03-20', status: 'Submitted', note: 'Request created' }, { date: '2026-03-20', status: 'Quoted', note: 'Est: $520' }, { date: '2026-03-21', status: 'Approved', note: 'Customer approved' }, { date: '2026-03-22', status: 'Scheduled', note: 'Scheduled for Mar 24' }, { date: '2026-03-24', status: 'In Progress', note: 'Fueling started' }, { date: '2026-03-24', status: 'Completed', note: 'Fueling completed - 118 gal' }, { date: '2026-03-25', status: 'Invoiced', note: 'Invoice #INV-7845 sent' }] },
  { id: '7', requestNumber: 'SR-3007', customer: 'Kevin Okafor', serviceType: 'Detailing', boat: 'African Queen (38 ft)', preferredDate: '2026-03-29', vendor: 'Marina Shine Co.', quote: 550, status: 'Quoted', urgency: 'Normal', notes: 'Full exterior detail plus teak restoration.', createdAt: '2026-03-23',
    timeline: [{ date: '2026-03-23', status: 'Submitted', note: 'Request created' }, { date: '2026-03-24', status: 'Quoted', note: 'Quote: $550' }] },
  { id: '8', requestNumber: 'SR-3008', customer: 'Patricia Langley', serviceType: 'Mechanic', boat: 'Blue Horizon (26 ft)', preferredDate: '2026-03-30', vendor: 'Coastal Marine Repair', quote: null, status: 'Submitted', urgency: 'Urgent', notes: 'Bilge pump not functioning. Needs immediate inspection.', createdAt: '2026-03-25',
    timeline: [{ date: '2026-03-25', status: 'Submitted', note: 'Request created - URGENT' }] },
  { id: '9', requestNumber: 'SR-3009', customer: 'Andrew Gilmore', serviceType: 'Winterization', boat: 'Wave Dancer (34 ft)', preferredDate: '2026-04-15', vendor: 'Coastal Marine Repair', quote: 1200, status: 'Approved', urgency: 'Normal', notes: 'Full winterization package: engine, plumbing, shrink wrap.', createdAt: '2026-03-18',
    timeline: [{ date: '2026-03-18', status: 'Submitted', note: 'Request created' }, { date: '2026-03-19', status: 'Quoted', note: 'Quote: $1,200' }, { date: '2026-03-20', status: 'Approved', note: 'Customer approved' }] },
  { id: '10', requestNumber: 'SR-3010', customer: 'Emily Stafford', serviceType: 'Cleaning', boat: 'Starboard Dream (22 ft)', preferredDate: '2026-03-26', vendor: 'Marina Shine Co.', quote: 180, status: 'Scheduled', urgency: 'Normal', notes: 'Basic interior clean.', createdAt: '2026-03-22',
    timeline: [{ date: '2026-03-22', status: 'Submitted', note: 'Request created' }, { date: '2026-03-23', status: 'Quoted', note: 'Quote: $180' }, { date: '2026-03-24', status: 'Approved', note: 'Customer approved' }, { date: '2026-03-24', status: 'Scheduled', note: 'Scheduled for Mar 26' }] },
  { id: '11', requestNumber: 'SR-3011', customer: 'Frank Delaney', serviceType: 'Provisioning', boat: 'Sea Breeze (32 ft)', preferredDate: '2026-03-28', vendor: 'Harbor Provisions', quote: 275, status: 'Quoted', urgency: 'Normal', notes: 'Fishing trip supplies for 4.', createdAt: '2026-03-24',
    timeline: [{ date: '2026-03-24', status: 'Submitted', note: 'Request created' }, { date: '2026-03-25', status: 'Quoted', note: 'Quote: $275' }] },
  { id: '12', requestNumber: 'SR-3012', customer: 'Daniel Marsh', serviceType: 'Fueling', boat: 'Poseidon\'s Trident (42 ft)', preferredDate: '2026-03-27', vendor: 'Dockside Fuel', quote: 680, status: 'Approved', urgency: 'Normal', notes: 'Fill main tank, diesel. Approx 160 gal.', createdAt: '2026-03-24',
    timeline: [{ date: '2026-03-24', status: 'Submitted', note: 'Request created' }, { date: '2026-03-24', status: 'Quoted', note: 'Est: $680' }, { date: '2026-03-25', status: 'Approved', note: 'Customer approved' }] },
];

const MOCK_VENDORS: Vendor[] = [
  { id: '1', name: 'Marina Shine Co.', specialty: 'Detailing & Cleaning', phone: '(555) 300-1001', email: 'info@marinashine.com', rating: 4.8, active: true },
  { id: '2', name: 'Coastal Marine Repair', specialty: 'Mechanic & Winterization', phone: '(555) 300-1002', email: 'service@coastalmarine.com', rating: 4.7, active: true },
  { id: '3', name: 'Harbor Provisions', specialty: 'Provisioning & Catering', phone: '(555) 300-1003', email: 'orders@harborprovisions.com', rating: 4.9, active: true },
  { id: '4', name: 'Bay Area Pump Services', specialty: 'Pump-Out', phone: '(555) 300-1004', email: 'dispatch@baypump.com', rating: 4.5, active: true },
  { id: '5', name: 'Dockside Fuel', specialty: 'Fueling', phone: '(555) 300-1005', email: 'fuel@docksidefuel.com', rating: 4.6, active: true },
  { id: '6', name: 'Seaside Canvas & Upholstery', specialty: 'Upholstery & Canvas', phone: '(555) 300-1006', email: 'quotes@seasidecanvas.com', rating: 4.4, active: false },
];

/* ── Status Colors ─────────────────────────────────────── */

const STATUS_COLORS: Record<RequestStatus, { bg: string; text: string }> = {
  Submitted: { bg: '#D6E8F4', text: '#0A2342' },
  Quoted: { bg: '#E0F7FA', text: '#006064' },
  Approved: { bg: '#E8F5E9', text: '#1B5E20' },
  Scheduled: { bg: '#F3E5F5', text: '#4A148C' },
  'In Progress': { bg: '#FFF3CD', text: '#856404' },
  Completed: { bg: '#0A2342', text: '#FFFFFF' },
  Invoiced: { bg: '#F5F5F5', text: '#616161' },
};

/* ── Helpers ───────────────────────────────────────────── */

function fmt$(n: number | null): string {
  if (n === null) return '--';
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* ── Styles ────────────────────────────────────────────── */

const s: Record<string, React.CSSProperties> = {
  page: { padding: '32px' },
  title: { fontSize: '36px', fontWeight: 700, color: '#0A2342', letterSpacing: '-0.02em', margin: 0 },
  divider: { height: '4px', background: 'linear-gradient(90deg, #00D4FF, transparent)', border: 'none', marginTop: '12px', marginBottom: '32px', borderRadius: '2px' },
  statsRow: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '24px' },
  statCard: { backgroundColor: '#FFFFFF', border: '1px solid #CCC', borderRadius: '8px', padding: '16px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' },
  statLabel: { fontSize: '12px', fontWeight: 600, color: '#64748B', textTransform: 'uppercase' as const, letterSpacing: '0.03em', marginBottom: '4px' },
  statValue: { fontSize: '24px', fontWeight: 700, color: '#0A2342', fontFamily: '"JetBrains Mono", monospace' },
  tabs: { display: 'flex', gap: '0px', marginBottom: '24px', borderBottom: '2px solid #E2E8F0' },
  tab: { padding: '10px 24px', fontSize: '14px', fontWeight: 600, color: '#64748B', cursor: 'pointer', border: 'none', backgroundColor: 'transparent', borderBottom: '2px solid transparent', marginBottom: '-2px' },
  tabActive: { padding: '10px 24px', fontSize: '14px', fontWeight: 600, color: '#0A2342', cursor: 'pointer', border: 'none', backgroundColor: 'transparent', borderBottom: '2px solid #00D4FF', marginBottom: '-2px' },
  filterBar: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px', flexWrap: 'wrap' as const },
  select: { padding: '8px 32px 8px 12px', fontSize: '14px', color: '#0A2342', border: '1px solid #CCC', borderRadius: '6px', backgroundColor: '#FFF', appearance: 'none' as const, backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%232E4A6B\' stroke-width=\'2\'%3E%3Cpath d=\'M6 9l6 6 6-6\'/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center', cursor: 'pointer', minWidth: '140px' },
  searchWrap: { position: 'relative' as const, display: 'flex', alignItems: 'center' },
  searchIcon: { position: 'absolute' as const, left: '10px', color: '#2E4A6B', pointerEvents: 'none' as const },
  searchInput: { padding: '8px 12px 8px 34px', fontSize: '14px', color: '#0A2342', border: '1px solid #CCC', borderRadius: '6px', backgroundColor: '#FFF', width: '220px', outline: 'none' },
  spacer: { flex: 1 },
  primaryBtn: { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 20px', fontSize: '14px', fontWeight: 600, color: '#FFFFFF', backgroundColor: '#0A2342', border: 'none', borderRadius: '6px', cursor: 'pointer' },
  table: { width: '100%', borderCollapse: 'collapse' as const, borderRadius: '8px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' },
  th: { backgroundColor: '#0A2342', color: '#FFFFFF', padding: '12px 16px', fontSize: '13px', fontWeight: 600, textAlign: 'left' as const, whiteSpace: 'nowrap' as const },
  td: { padding: '12px 16px', fontSize: '14px', color: '#0A2342', borderBottom: '1px solid #E2E8F0', whiteSpace: 'nowrap' as const },
  rowEven: { backgroundColor: '#D6E8F4' },
  rowOdd: { backgroundColor: '#FFFFFF' },
  badge: { display: 'inline-block', padding: '3px 12px', borderRadius: '9999px', fontSize: '12px', fontWeight: 600, lineHeight: '18px' },
  urgentBadge: { display: 'inline-block', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600, backgroundColor: '#FDECEA', color: '#B71C1C', marginLeft: '6px' },
  actionBtn: { padding: '5px 10px', fontSize: '12px', fontWeight: 600, border: '1px solid #CCC', borderRadius: '4px', backgroundColor: '#FFFFFF', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#2E4A6B', marginRight: '4px' },
  /* Vendor cards */
  cardGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px' },
  vendorCard: { backgroundColor: '#FFFFFF', border: '1px solid #CCC', borderRadius: '8px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' },
  vendorName: { fontSize: '16px', fontWeight: 700, color: '#0A2342', marginBottom: '4px' },
  vendorSpecialty: { fontSize: '13px', color: '#64748B', marginBottom: '12px' },
  vendorDetail: { fontSize: '13px', color: '#0A2342', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' },
  vendorStatus: { display: 'inline-block', padding: '2px 10px', borderRadius: '9999px', fontSize: '11px', fontWeight: 600 },
  starRow: { display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '12px' },
  /* Modal */
  overlay: { position: 'fixed' as const, top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(10, 35, 66, 0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  modal: { backgroundColor: '#FFFFFF', borderRadius: '12px', width: '560px', maxWidth: '95vw', maxHeight: '85vh', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column' as const },
  modalWide: { backgroundColor: '#FFFFFF', borderRadius: '12px', width: '640px', maxWidth: '95vw', maxHeight: '85vh', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column' as const },
  modalHeader: { padding: '24px', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { fontSize: '20px', fontWeight: 700, color: '#0A2342', margin: 0 },
  closeBtn: { padding: '4px', border: 'none', backgroundColor: 'transparent', cursor: 'pointer', color: '#2E4A6B', display: 'flex', alignItems: 'center' },
  modalBody: { flex: 1, overflowY: 'auto' as const, padding: '24px' },
  fieldGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' },
  field: { display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  fieldFull: { display: 'flex', flexDirection: 'column' as const, gap: '4px', gridColumn: '1 / -1' },
  fieldLabel: { fontSize: '12px', fontWeight: 600, color: '#64748B', textTransform: 'uppercase' as const, letterSpacing: '0.03em' },
  fieldValue: { fontSize: '14px', color: '#0A2342', fontWeight: 500 },
  input: { padding: '8px 12px', fontSize: '14px', color: '#0A2342', border: '1px solid #CCC', borderRadius: '6px', outline: 'none' },
  textarea: { padding: '8px 12px', fontSize: '14px', color: '#0A2342', border: '1px solid #CCC', borderRadius: '6px', outline: 'none', minHeight: '80px', resize: 'vertical' as const, fontFamily: 'inherit' },
  modalFooter: { padding: '20px 24px', borderTop: '1px solid #E2E8F0', display: 'flex', justifyContent: 'flex-end', gap: '12px', backgroundColor: '#F7F9FB' },
  cancelBtn: { padding: '8px 20px', fontSize: '14px', fontWeight: 600, color: '#2E4A6B', backgroundColor: '#FFFFFF', border: '1px solid #CCC', borderRadius: '6px', cursor: 'pointer' },
  /* Timeline */
  timeline: { marginTop: '20px' },
  timelineItem: { display: 'flex', gap: '12px', position: 'relative' as const, paddingBottom: '16px', paddingLeft: '24px', borderLeft: '2px solid #E2E8F0', marginLeft: '6px' },
  timelineDot: { position: 'absolute' as const, left: '-6px', top: '2px', width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#00D4FF', border: '2px solid #FFFFFF' },
  timelineDate: { fontSize: '12px', color: '#64748B', fontFamily: '"JetBrains Mono", monospace', minWidth: '90px' },
  timelineStatus: { fontSize: '12px', fontWeight: 600, color: '#0A2342' },
  timelineNote: { fontSize: '13px', color: '#64748B' },
};

/* ── Component ─────────────────────────────────────────── */

export default function Concierge() {
  const [tab, setTab] = useState<TabKey>('requests');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [showModal, setShowModal] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<ServiceRequest | null>(null);

  /* Derived stats */
  const openRequests = MOCK_REQUESTS.filter((r) => !['Completed', 'Invoiced'].includes(r.status)).length;
  const pendingQuotes = MOCK_REQUESTS.filter((r) => r.status === 'Submitted').length;
  const completedMonth = MOCK_REQUESTS.filter((r) => r.status === 'Completed' || r.status === 'Invoiced').length;
  const revenue = MOCK_REQUESTS.filter((r) => r.status === 'Invoiced' || r.status === 'Completed').reduce((sum, r) => sum + (r.quote || 0), 0);

  const filtered = MOCK_REQUESTS.filter((r) => {
    if (statusFilter !== 'All' && r.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const hay = `${r.requestNumber} ${r.customer} ${r.serviceType} ${r.boat} ${r.vendor}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  return (
    <div style={s.page}>
      <h1 style={s.title}>Concierge Services</h1>
      <hr style={s.divider} />

      {/* Stats */}
      <div style={s.statsRow}>
        <div style={s.statCard}>
          <div style={s.statLabel}>Open Requests</div>
          <div style={s.statValue}>{openRequests}</div>
        </div>
        <div style={s.statCard}>
          <div style={s.statLabel}>Pending Quotes</div>
          <div style={s.statValue}>{pendingQuotes}</div>
        </div>
        <div style={s.statCard}>
          <div style={s.statLabel}>Completed This Month</div>
          <div style={s.statValue}>{completedMonth}</div>
        </div>
        <div style={s.statCard}>
          <div style={s.statLabel}>Revenue</div>
          <div style={s.statValue}>{fmt$(revenue)}</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={s.tabs}>
        <button style={tab === 'requests' ? s.tabActive : s.tab} onClick={() => setTab('requests')}>All Requests</button>
        <button style={tab === 'vendors' ? s.tabActive : s.tab} onClick={() => setTab('vendors')}>Vendor Directory</button>
      </div>

      {/* ── All Requests Tab ── */}
      {tab === 'requests' && (
        <>
          <div style={s.filterBar}>
            <div style={s.searchWrap}>
              <Search size={16} style={s.searchIcon} />
              <input style={s.searchInput} placeholder="Search requests..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <select style={s.select} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="All">All Statuses</option>
              {ALL_STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}
            </select>
            <div style={s.spacer} />
            <button style={s.primaryBtn} onClick={() => setShowModal(true)}>
              <Plus size={16} /> New Request
            </button>
          </div>
          <div style={{ borderRadius: '8px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>Request #</th>
                  <th style={s.th}>Customer</th>
                  <th style={s.th}>Service Type</th>
                  <th style={s.th}>Boat</th>
                  <th style={s.th}>Preferred Date</th>
                  <th style={s.th}>Vendor</th>
                  <th style={s.th}>Quote</th>
                  <th style={s.th}>Status</th>
                  <th style={s.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, idx) => (
                  <tr
                    key={r.id}
                    style={{ ...(idx % 2 === 0 ? s.rowOdd : s.rowEven), cursor: 'pointer' }}
                    onClick={() => setSelectedRequest(r)}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLTableRowElement).style.backgroundColor = '#EBF2FA'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLTableRowElement).style.backgroundColor = idx % 2 === 0 ? '#FFFFFF' : '#D6E8F4'; }}
                  >
                    <td style={{ ...s.td, fontFamily: '"JetBrains Mono", monospace', fontWeight: 600 }}>{r.requestNumber}</td>
                    <td style={{ ...s.td, fontWeight: 600 }}>{r.customer}</td>
                    <td style={s.td}>
                      <Wrench size={12} style={{ verticalAlign: 'middle', marginRight: '4px', color: '#2E4A6B' }} />
                      {r.serviceType}
                      {r.urgency === 'Urgent' && <span style={s.urgentBadge}>URGENT</span>}
                    </td>
                    <td style={s.td}>{r.boat}</td>
                    <td style={s.td}>
                      <Calendar size={12} style={{ verticalAlign: 'middle', marginRight: '4px', color: '#2E4A6B' }} />
                      {r.preferredDate}
                    </td>
                    <td style={s.td}>{r.vendor}</td>
                    <td style={{ ...s.td, fontFamily: '"JetBrains Mono", monospace' }}>{fmt$(r.quote)}</td>
                    <td style={s.td}>
                      <span style={{ ...s.badge, backgroundColor: STATUS_COLORS[r.status].bg, color: STATUS_COLORS[r.status].text }}>
                        {r.status}
                      </span>
                    </td>
                    <td style={s.td}>
                      <button
                        style={s.actionBtn}
                        onClick={(ev) => { ev.stopPropagation(); setSelectedRequest(r); }}
                      >
                        <ChevronRight size={12} /> View
                      </button>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td style={{ ...s.td, textAlign: 'center', padding: '32px', color: '#64748B' }} colSpan={9}>No requests match the current filters.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── Vendor Directory Tab ── */}
      {tab === 'vendors' && (
        <div style={s.cardGrid}>
          {MOCK_VENDORS.map((v) => (
            <div key={v.id} style={s.vendorCard}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4px' }}>
                <div style={s.vendorName}>{v.name}</div>
                <span style={{
                  ...s.vendorStatus,
                  backgroundColor: v.active ? '#E8F5E9' : '#F5F5F5',
                  color: v.active ? '#1B5E20' : '#616161',
                }}>
                  {v.active ? 'Active' : 'Inactive'}
                </span>
              </div>
              <div style={s.vendorSpecialty}>{v.specialty}</div>
              <div style={s.starRow}>
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star
                    key={i}
                    size={14}
                    fill={i < Math.floor(v.rating) ? '#F59E0B' : 'none'}
                    color={i < Math.floor(v.rating) ? '#F59E0B' : '#CCC'}
                  />
                ))}
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#0A2342', marginLeft: '4px' }}>{v.rating}</span>
              </div>
              <div style={s.vendorDetail}>
                <Phone size={13} color="#2E4A6B" /> {v.phone}
              </div>
              <div style={s.vendorDetail}>
                <Mail size={13} color="#2E4A6B" /> {v.email}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Request Detail Panel (Modal) ── */}
      {selectedRequest && (
        <div style={s.overlay} onClick={() => setSelectedRequest(null)}>
          <div style={s.modalWide} onClick={(e) => e.stopPropagation()}>
            <div style={s.modalHeader}>
              <div>
                <h2 style={s.modalTitle}>{selectedRequest.requestNumber}</h2>
                <div style={{ marginTop: '6px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ ...s.badge, backgroundColor: STATUS_COLORS[selectedRequest.status].bg, color: STATUS_COLORS[selectedRequest.status].text }}>
                    {selectedRequest.status}
                  </span>
                  {selectedRequest.urgency === 'Urgent' && <span style={s.urgentBadge}>URGENT</span>}
                </div>
              </div>
              <button style={s.closeBtn} onClick={() => setSelectedRequest(null)}><X size={20} /></button>
            </div>
            <div style={s.modalBody}>
              <div style={s.fieldGrid}>
                <div style={s.field}>
                  <span style={s.fieldLabel}>Customer</span>
                  <span style={s.fieldValue}>
                    <User size={12} style={{ verticalAlign: 'middle', marginRight: '4px', color: '#2E4A6B' }} />
                    {selectedRequest.customer}
                  </span>
                </div>
                <div style={s.field}>
                  <span style={s.fieldLabel}>Service Type</span>
                  <span style={s.fieldValue}>
                    <Wrench size={12} style={{ verticalAlign: 'middle', marginRight: '4px', color: '#2E4A6B' }} />
                    {selectedRequest.serviceType}
                  </span>
                </div>
                <div style={s.field}>
                  <span style={s.fieldLabel}>Boat</span>
                  <span style={s.fieldValue}>{selectedRequest.boat}</span>
                </div>
                <div style={s.field}>
                  <span style={s.fieldLabel}>Preferred Date</span>
                  <span style={s.fieldValue}>
                    <Calendar size={12} style={{ verticalAlign: 'middle', marginRight: '4px', color: '#2E4A6B' }} />
                    {selectedRequest.preferredDate}
                  </span>
                </div>
                <div style={s.field}>
                  <span style={s.fieldLabel}>Vendor</span>
                  <span style={s.fieldValue}>{selectedRequest.vendor}</span>
                </div>
                <div style={s.field}>
                  <span style={s.fieldLabel}>Quote</span>
                  <span style={{ ...s.fieldValue, fontFamily: '"JetBrains Mono", monospace' }}>{fmt$(selectedRequest.quote)}</span>
                </div>
              </div>
              <div style={{ marginTop: '20px', padding: '16px', backgroundColor: '#F7F9FB', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: '#64748B', textTransform: 'uppercase' as const, letterSpacing: '0.03em', marginBottom: '8px' }}>Notes</div>
                <div style={{ fontSize: '14px', color: '#0A2342', lineHeight: 1.6 }}>{selectedRequest.notes}</div>
              </div>

              {/* Timeline */}
              <div style={s.timeline}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: '#64748B', textTransform: 'uppercase' as const, letterSpacing: '0.03em', marginBottom: '16px' }}>Workflow Timeline</div>
                {selectedRequest.timeline.map((item, idx) => (
                  <div key={idx} style={s.timelineItem}>
                    <div style={s.timelineDot} />
                    <div>
                      <div style={s.timelineDate}>{item.date}</div>
                      <div style={s.timelineStatus}>{item.status}</div>
                      <div style={s.timelineNote}>{item.note}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div style={s.modalFooter}>
              <button style={s.cancelBtn} onClick={() => setSelectedRequest(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ── New Request Modal ── */}
      {showModal && (
        <div style={s.overlay} onClick={() => setShowModal(false)}>
          <div style={s.modal} onClick={(e) => e.stopPropagation()}>
            <div style={s.modalHeader}>
              <h2 style={s.modalTitle}>New Service Request</h2>
              <button style={s.closeBtn} onClick={() => setShowModal(false)}><X size={20} /></button>
            </div>
            <div style={s.modalBody}>
              <div style={s.fieldGrid}>
                <div style={s.field}>
                  <span style={s.fieldLabel}>Customer</span>
                  <select style={{ ...s.input, ...s.select }}>
                    <option value="">Select customer...</option>
                    {Array.from(new Set(MOCK_REQUESTS.map((r) => r.customer))).map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div style={s.field}>
                  <span style={s.fieldLabel}>Service Type</span>
                  <select style={{ ...s.input, ...s.select }}>
                    <option value="">Select service...</option>
                    {SERVICE_TYPES.map((st) => <option key={st} value={st}>{st}</option>)}
                  </select>
                </div>
                <div style={s.field}>
                  <span style={s.fieldLabel}>Boat</span>
                  <input style={s.input} placeholder="Boat name (length)" />
                </div>
                <div style={s.field}>
                  <span style={s.fieldLabel}>Preferred Date</span>
                  <input style={s.input} type="date" />
                </div>
                <div style={s.field}>
                  <span style={s.fieldLabel}>Urgency</span>
                  <select style={{ ...s.input, ...s.select }}>
                    <option value="Normal">Normal</option>
                    <option value="Urgent">Urgent</option>
                  </select>
                </div>
                <div style={s.field}>
                  {/* spacer for alignment */}
                </div>
                <div style={s.fieldFull}>
                  <span style={s.fieldLabel}>Notes</span>
                  <textarea style={s.textarea} placeholder="Describe the service needed..." />
                </div>
              </div>
            </div>
            <div style={s.modalFooter}>
              <button style={s.cancelBtn} onClick={() => setShowModal(false)}>Cancel</button>
              <button style={s.primaryBtn} onClick={() => setShowModal(false)}>
                <FileText size={16} /> Submit Request
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
