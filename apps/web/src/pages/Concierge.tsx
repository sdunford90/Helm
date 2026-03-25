import React, { useState } from 'react';
import {
  Search, Plus, X, Eye, Phone, Mail, Star,
  Clock, CheckCircle2, AlertCircle,
} from 'lucide-react';

/* ── Types ─────────────────────────────────────────────── */

type ConciergeStatus = 'Submitted' | 'Quoted' | 'Approved' | 'Scheduled' | 'In Progress' | 'Completed' | 'Invoiced';

interface ConciergeRequest {
  id: string;
  number: string;
  customer: string;
  serviceType: string;
  boat: string;
  preferredDate: string;
  vendor: string;
  quoteCents: number;
  status: ConciergeStatus;
  urgency: 'Normal' | 'Urgent';
  notes: string;
  submittedAt: string;
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

const REQUESTS: ConciergeRequest[] = [
  { id: '1', number: 'CR-0142', customer: 'James Harborview', serviceType: 'Detailing', boat: 'Sea Spirit', preferredDate: '2026-03-26', vendor: 'Shine Marine Detailing', quoteCents: 35000, status: 'Scheduled', urgency: 'Normal', notes: 'Full hull and deck detail', submittedAt: '2026-03-23' },
  { id: '2', number: 'CR-0143', customer: 'David Tidewater', serviceType: 'Mechanic', boat: 'Tidewater Express', preferredDate: '2026-03-25', vendor: 'Bay Engine Works', quoteCents: 45000, status: 'In Progress', urgency: 'Urgent', notes: 'Engine overheating issue — needs immediate attention', submittedAt: '2026-03-24' },
  { id: '3', number: 'CR-0144', customer: 'Elena Windward', serviceType: 'Provisioning', boat: 'Windward', preferredDate: '2026-03-27', vendor: '—', quoteCents: 0, status: 'Submitted', urgency: 'Normal', notes: 'Stocking for weekend trip — groceries and beverages', submittedAt: '2026-03-25' },
  { id: '4', number: 'CR-0145', customer: 'Maria Seabreeze', serviceType: 'Cleaning', boat: 'Coastal Dream', preferredDate: '2026-03-28', vendor: 'Marina Clean Crew', quoteCents: 15000, status: 'Quoted', urgency: 'Normal', notes: 'Interior deep clean', submittedAt: '2026-03-25' },
  { id: '5', number: 'CR-0146', customer: 'Robert Dockside', serviceType: 'Pump-Out', boat: 'Harbor Light', preferredDate: '2026-03-25', vendor: '—', quoteCents: 5000, status: 'Approved', urgency: 'Normal', notes: '', submittedAt: '2026-03-24' },
  { id: '6', number: 'CR-0141', customer: 'James Harborview', serviceType: 'Winterization', boat: 'Sea Spirit', preferredDate: '2026-03-20', vendor: 'Bay Engine Works', quoteCents: 85000, status: 'Completed', urgency: 'Normal', notes: 'Full winterization package', submittedAt: '2026-03-15' },
  { id: '7', number: 'CR-0140', customer: 'Maria Seabreeze', serviceType: 'Fueling', boat: 'Coastal Dream', preferredDate: '2026-03-18', vendor: '—', quoteCents: 22000, status: 'Invoiced', urgency: 'Normal', notes: '50 gal diesel', submittedAt: '2026-03-17' },
  { id: '8', number: 'CR-0139', customer: 'David Tidewater', serviceType: 'Detailing', boat: 'Tidewater Express', preferredDate: '2026-03-15', vendor: 'Shine Marine Detailing', quoteCents: 55000, status: 'Invoiced', urgency: 'Normal', notes: 'Premium package with wax', submittedAt: '2026-03-12' },
  { id: '9', number: 'CR-0138', customer: 'Elena Windward', serviceType: 'Mechanic', boat: 'Windward', preferredDate: '2026-03-10', vendor: 'Bay Engine Works', quoteCents: 32000, status: 'Completed', urgency: 'Normal', notes: 'Oil change and filter replacement', submittedAt: '2026-03-08' },
  { id: '10', number: 'CR-0137', customer: 'Robert Dockside', serviceType: 'Cleaning', boat: 'Harbor Light', preferredDate: '2026-03-05', vendor: 'Marina Clean Crew', quoteCents: 12000, status: 'Invoiced', urgency: 'Normal', notes: 'Exterior wash', submittedAt: '2026-03-03' },
];

const VENDORS: Vendor[] = [
  { id: '1', name: 'Shine Marine Detailing', specialty: 'Detailing & Waxing', phone: '(555) 234-5678', email: 'info@shinemarine.com', rating: 4.9, active: true },
  { id: '2', name: 'Bay Engine Works', specialty: 'Mechanic & Winterization', phone: '(555) 345-6789', email: 'service@bayengine.com', rating: 4.7, active: true },
  { id: '3', name: 'Marina Clean Crew', specialty: 'Cleaning & Interior', phone: '(555) 456-7890', email: 'book@marinaclean.com', rating: 4.8, active: true },
  { id: '4', name: 'Coastal Provisions Co.', specialty: 'Provisioning & Catering', phone: '(555) 567-8901', email: 'orders@coastalprov.com', rating: 4.6, active: true },
  { id: '5', name: 'Harbor Fuel Services', specialty: 'Fueling & Pump-Out', phone: '(555) 678-9012', email: 'dispatch@harborfuel.com', rating: 4.5, active: true },
  { id: '6', name: 'Seaside Canvas & Covers', specialty: 'Canvas, Upholstery & Covers', phone: '(555) 789-0123', email: 'quotes@seasidecanvas.com', rating: 4.4, active: false },
];

/* ── Styles ─────────────────────────────────────────────── */

const statusColors: Record<ConciergeStatus, { bg: string; color: string }> = {
  Submitted: { bg: '#DBEAFE', color: '#1E40AF' },
  Quoted: { bg: '#E0F7FF', color: '#0A2342' },
  Approved: { bg: '#DEF7EC', color: '#03543F' },
  Scheduled: { bg: '#F3E8FF', color: '#6B21A8' },
  'In Progress': { bg: '#FFF3CD', color: '#856404' },
  Completed: { bg: '#D6E8F4', color: '#0A2342' },
  Invoiced: { bg: '#F3F4F6', color: '#64748B' },
};

const st: Record<string, React.CSSProperties> = {
  page: { padding: '32px' },
  title: { fontSize: '36px', fontWeight: 700, color: '#0A2342', letterSpacing: '-0.02em', margin: 0 },
  divider: { height: '4px', background: 'linear-gradient(90deg, #00D4FF, transparent)', border: 'none', marginTop: '12px', marginBottom: '32px', borderRadius: '2px' },
  statsRow: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px', marginBottom: '32px' },
  statCard: { background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' },
  statLabel: { fontSize: '12px', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.05em', color: '#64748B', marginBottom: '4px' },
  statValue: { fontSize: '24px', fontWeight: 700, color: '#0A2342', fontFamily: '"JetBrains Mono", monospace' },
  statSub: { fontSize: '13px', color: '#2E4A6B', marginTop: '2px' },
  tabs: { display: 'flex', gap: '0', borderBottom: '2px solid #E2E8F0', marginBottom: '24px' },
  tab: { padding: '10px 24px', fontSize: '14px', fontWeight: 600, border: 'none', background: 'none', cursor: 'pointer', color: '#64748B', borderBottom: '2px solid transparent', marginBottom: '-2px' },
  tabActive: { color: '#0A2342', borderBottom: '2px solid #00D4FF' },
  filterBar: { display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px', flexWrap: 'wrap' as const },
  searchWrap: { position: 'relative' as const, flex: 1, minWidth: '200px' },
  searchIcon: { position: 'absolute' as const, left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#64748B', pointerEvents: 'none' as const },
  searchInput: { width: '100%', padding: '8px 12px 8px 36px', fontSize: '14px', border: '1px solid #CCC', borderRadius: '4px', color: '#0A2342', boxSizing: 'border-box' as const },
  select: { padding: '8px 12px', fontSize: '14px', border: '1px solid #CCC', borderRadius: '4px', color: '#0A2342', background: '#FFFFFF', cursor: 'pointer' },
  addBtn: { display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 20px', fontSize: '14px', fontWeight: 600, color: '#FFFFFF', backgroundColor: '#0A2342', border: 'none', borderRadius: '6px', cursor: 'pointer', whiteSpace: 'nowrap' as const },
  tableWrap: { background: '#FFFFFF', borderRadius: '8px', border: '1px solid #E2E8F0', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', overflow: 'hidden' },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: '14px' },
  th: { textAlign: 'left' as const, padding: '12px 16px', fontSize: '12px', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.05em', color: '#FFFFFF', backgroundColor: '#0A2342', borderBottom: '2px solid #00D4FF' },
  td: { padding: '12px 16px', color: '#0A2342', borderBottom: '1px solid #E2E8F0' },
  badge: { display: 'inline-block', padding: '2px 10px', fontSize: '12px', fontWeight: 600, borderRadius: '9999px' },
  mono: { fontFamily: '"JetBrains Mono", monospace', fontSize: '14px' },
  vendorGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '20px' },
  vendorCard: { background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' },
  overlay: { position: 'fixed' as const, inset: 0, backgroundColor: 'rgba(10, 35, 66, 0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: '#FFFFFF', borderRadius: '8px', width: '520px', maxHeight: '90vh', overflow: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.12)' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '24px 32px 16px', borderBottom: '1px solid #E2E8F0' },
  modalTitle: { fontSize: '22px', fontWeight: 700, color: '#0A2342', margin: 0 },
  closeBtn: { background: 'none', border: 'none', cursor: 'pointer', color: '#2E4A6B', padding: '4px' },
  modalBody: { padding: '24px 32px' },
  field: { display: 'flex', flexDirection: 'column' as const, gap: '4px', marginBottom: '16px' },
  label: { fontSize: '13px', fontWeight: 600, color: '#0A2342' },
  input: { padding: '8px 12px', fontSize: '14px', border: '1px solid #CCC', borderRadius: '4px', color: '#0A2342', outline: 'none', boxSizing: 'border-box' as const, width: '100%' },
  twoCol: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' },
  modalFooter: { display: 'flex', justifyContent: 'flex-end', gap: '12px', padding: '16px 32px 24px', borderTop: '1px solid #E2E8F0' },
  cancelBtn: { padding: '8px 24px', fontSize: '14px', fontWeight: 600, color: '#2E4A6B', background: '#FFFFFF', border: '1px solid #CCC', borderRadius: '6px', cursor: 'pointer' },
  saveBtn: { padding: '8px 24px', fontSize: '14px', fontWeight: 600, color: '#FFFFFF', backgroundColor: '#0A2342', border: 'none', borderRadius: '6px', cursor: 'pointer' },
  detailPanel: { position: 'fixed' as const, top: 0, right: 0, width: '420px', height: '100vh', background: '#FFFFFF', boxShadow: '-4px 0 12px rgba(0,0,0,0.1)', zIndex: 1000, overflow: 'auto' },
  detailHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '24px', borderBottom: '1px solid #E2E8F0' },
  detailSection: { padding: '20px 24px', borderBottom: '1px solid #E2E8F0' },
  detailLabel: { fontSize: '12px', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.05em', color: '#64748B', marginBottom: '4px' },
  detailValue: { fontSize: '15px', color: '#0A2342', marginBottom: '12px' },
};

/* ── New Request Modal ─────────────────────────────────── */

function NewRequestModal({ onClose }: { onClose: () => void }) {
  return (
    <div style={st.overlay} onClick={onClose}>
      <div style={st.modal} onClick={(e) => e.stopPropagation()}>
        <div style={st.modalHeader}>
          <h2 style={st.modalTitle}>New Concierge Request</h2>
          <button style={st.closeBtn} onClick={onClose}><X size={20} /></button>
        </div>
        <div style={st.modalBody}>
          <div style={st.twoCol}>
            <div style={st.field}>
              <label style={st.label}>Customer *</label>
              <select style={st.input}><option>James Harborview</option><option>David Tidewater</option><option>Elena Windward</option><option>Maria Seabreeze</option><option>Robert Dockside</option></select>
            </div>
            <div style={st.field}>
              <label style={st.label}>Service Type *</label>
              <select style={st.input}><option>Detailing</option><option>Cleaning</option><option>Provisioning</option><option>Pump-Out</option><option>Mechanic</option><option>Fueling</option><option>Winterization</option></select>
            </div>
            <div style={st.field}>
              <label style={st.label}>Boat</label>
              <select style={st.input}><option>Sea Spirit</option><option>Tidewater Express</option><option>Windward</option><option>Coastal Dream</option><option>Harbor Light</option></select>
            </div>
            <div style={st.field}>
              <label style={st.label}>Preferred Date</label>
              <input style={st.input} type="date" defaultValue="2026-03-28" />
            </div>
          </div>
          <div style={st.field}>
            <label style={st.label}>Urgency</label>
            <select style={st.input}><option>Normal</option><option>Urgent</option></select>
          </div>
          <div style={st.field}>
            <label style={st.label}>Notes</label>
            <textarea style={{ ...st.input, minHeight: '80px', resize: 'vertical' as const }} placeholder="Describe the service needed..." />
          </div>
        </div>
        <div style={st.modalFooter}>
          <button style={st.cancelBtn} onClick={onClose}>Cancel</button>
          <button style={st.saveBtn} onClick={onClose}>Submit Request</button>
        </div>
      </div>
    </div>
  );
}

/* ── Main Component ─────────────────────────────────────── */

export default function Concierge() {
  const [tab, setTab] = useState<'requests' | 'vendors'>('requests');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [showNewRequest, setShowNewRequest] = useState(false);
  const [selectedReq, setSelectedReq] = useState<ConciergeRequest | null>(null);

  const openRequests = REQUESTS.filter((r) => !['Completed', 'Invoiced'].includes(r.status)).length;
  const pendingQuotes = REQUESTS.filter((r) => r.status === 'Quoted').length;
  const completedThisMonth = REQUESTS.filter((r) => r.status === 'Completed' || r.status === 'Invoiced').length;
  const revenue = REQUESTS.filter((r) => r.status === 'Invoiced').reduce((s, r) => s + r.quoteCents, 0);

  return (
    <div style={st.page}>
      <h1 style={st.title}>Concierge Services</h1>
      <hr style={st.divider} />

      <div style={st.statsRow}>
        <div style={{ ...st.statCard, borderTop: '3px solid #00D4FF' }}>
          <div style={st.statLabel}>Open Requests</div>
          <div style={st.statValue}>{openRequests}</div>
          <div style={st.statSub}>{REQUESTS.filter((r) => r.urgency === 'Urgent' && !['Completed', 'Invoiced'].includes(r.status)).length} urgent</div>
        </div>
        <div style={st.statCard}>
          <div style={st.statLabel}>Pending Quotes</div>
          <div style={st.statValue}>{pendingQuotes}</div>
          <div style={st.statSub}>Awaiting customer approval</div>
        </div>
        <div style={st.statCard}>
          <div style={st.statLabel}>Completed This Month</div>
          <div style={st.statValue}>{completedThisMonth}</div>
          <div style={st.statSub}>Services delivered</div>
        </div>
        <div style={st.statCard}>
          <div style={st.statLabel}>Revenue</div>
          <div style={st.statValue}>${(revenue / 100).toLocaleString()}</div>
          <div style={st.statSub}>Invoiced this month</div>
        </div>
      </div>

      <div style={st.tabs}>
        <button style={{ ...st.tab, ...(tab === 'requests' ? st.tabActive : {}) }} onClick={() => setTab('requests')}>All Requests</button>
        <button style={{ ...st.tab, ...(tab === 'vendors' ? st.tabActive : {}) }} onClick={() => setTab('vendors')}>Vendor Directory</button>
      </div>

      {tab === 'requests' && (
        <>
          <div style={st.filterBar}>
            <div style={st.searchWrap}>
              <Search size={16} style={st.searchIcon} />
              <input style={st.searchInput} placeholder="Search requests..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <select style={st.select} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="All">All Statuses</option>
              {Object.keys(statusColors).map((s) => <option key={s}>{s}</option>)}
            </select>
            <button style={st.addBtn} onClick={() => setShowNewRequest(true)}><Plus size={16} /> New Request</button>
          </div>
          <div style={st.tableWrap}>
            <table style={st.table}>
              <thead>
                <tr>
                  <th style={st.th}>Request #</th>
                  <th style={st.th}>Customer</th>
                  <th style={st.th}>Service</th>
                  <th style={st.th}>Boat</th>
                  <th style={st.th}>Date</th>
                  <th style={st.th}>Vendor</th>
                  <th style={st.th}>Quote</th>
                  <th style={st.th}>Status</th>
                  <th style={st.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {REQUESTS.filter((r) => {
                  if (statusFilter !== 'All' && r.status !== statusFilter) return false;
                  if (!search) return true;
                  const q = search.toLowerCase();
                  return r.number.toLowerCase().includes(q) || r.customer.toLowerCase().includes(q) || r.serviceType.toLowerCase().includes(q);
                }).map((r, idx) => {
                  const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#D6E8F4';
                  const sc = statusColors[r.status];
                  return (
                    <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedReq(r)}>
                      <td style={{ ...st.td, backgroundColor: rowBg, fontWeight: 600 }}>
                        {r.number}
                        {r.urgency === 'Urgent' && <AlertCircle size={14} style={{ color: '#DC2626', marginLeft: '6px', verticalAlign: 'middle' }} />}
                      </td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>{r.customer}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>{r.serviceType}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>{r.boat}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>{r.preferredDate}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg, color: r.vendor === '—' ? '#94A3B8' : '#0A2342' }}>{r.vendor}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg, ...st.mono }}>{r.quoteCents > 0 ? `$${(r.quoteCents / 100).toFixed(2)}` : '—'}</td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>
                        <span style={{ ...st.badge, backgroundColor: sc.bg, color: sc.color }}>{r.status}</span>
                      </td>
                      <td style={{ ...st.td, backgroundColor: rowBg }}>
                        <button style={{ background: 'none', border: 'none', color: '#00D4FF', cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); setSelectedReq(r); }}><Eye size={16} /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'vendors' && (
        <div style={st.vendorGrid}>
          {VENDORS.map((v) => (
            <div key={v.id} style={{ ...st.vendorCard, opacity: v.active ? 1 : 0.6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                <div>
                  <div style={{ fontSize: '16px', fontWeight: 700, color: '#0A2342' }}>{v.name}</div>
                  <div style={{ fontSize: '13px', color: '#64748B', marginTop: '2px' }}>{v.specialty}</div>
                </div>
                <span style={{ ...st.badge, backgroundColor: v.active ? '#DEF7EC' : '#F3F4F6', color: v.active ? '#03543F' : '#64748B' }}>{v.active ? 'Active' : 'Inactive'}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '8px' }}>
                <Star size={14} style={{ color: '#F59E0B', fill: '#F59E0B' }} />
                <span style={{ fontSize: '14px', fontWeight: 600, color: '#0A2342' }}>{v.rating}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#2E4A6B' }}><Phone size={14} /> {v.phone}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#2E4A6B' }}><Mail size={14} /> {v.email}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showNewRequest && <NewRequestModal onClose={() => setShowNewRequest(false)} />}

      {selectedReq && (
        <div style={st.detailPanel}>
          <div style={st.detailHeader}>
            <h2 style={{ fontSize: '20px', fontWeight: 700, color: '#0A2342', margin: 0 }}>{selectedReq.number}</h2>
            <button style={st.closeBtn} onClick={() => setSelectedReq(null)}><X size={20} /></button>
          </div>
          <div style={st.detailSection}>
            <div style={{ display: 'flex', gap: '8px' }}>
              <span style={{ ...st.badge, backgroundColor: statusColors[selectedReq.status].bg, color: statusColors[selectedReq.status].color }}>{selectedReq.status}</span>
              {selectedReq.urgency === 'Urgent' && <span style={{ ...st.badge, backgroundColor: '#FDE8E8', color: '#9B1C1C' }}>Urgent</span>}
            </div>
          </div>
          <div style={st.detailSection}>
            <div style={st.detailLabel}>Customer</div>
            <div style={st.detailValue}>{selectedReq.customer}</div>
            <div style={st.detailLabel}>Service Type</div>
            <div style={st.detailValue}>{selectedReq.serviceType}</div>
            <div style={st.detailLabel}>Boat</div>
            <div style={st.detailValue}>{selectedReq.boat}</div>
            <div style={st.detailLabel}>Preferred Date</div>
            <div style={st.detailValue}>{selectedReq.preferredDate}</div>
            <div style={st.detailLabel}>Vendor</div>
            <div style={st.detailValue}>{selectedReq.vendor}</div>
            <div style={st.detailLabel}>Quote</div>
            <div style={{ ...st.detailValue, ...st.mono, fontSize: '18px', fontWeight: 700 }}>{selectedReq.quoteCents > 0 ? `$${(selectedReq.quoteCents / 100).toFixed(2)}` : 'Pending'}</div>
          </div>
          <div style={st.detailSection}>
            <div style={st.detailLabel}>Notes</div>
            <div style={{ ...st.detailValue, lineHeight: 1.6 }}>{selectedReq.notes || '—'}</div>
            <div style={st.detailLabel}>Submitted</div>
            <div style={st.detailValue}>{selectedReq.submittedAt}</div>
          </div>
          <div style={{ padding: '20px 24px', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            {selectedReq.status === 'Submitted' && <button style={st.saveBtn}>Assign Vendor</button>}
            {selectedReq.status === 'Quoted' && <button style={st.saveBtn}>Approve Quote</button>}
            {selectedReq.status === 'Approved' && <button style={st.saveBtn}>Mark Scheduled</button>}
            {selectedReq.status === 'Scheduled' && <button style={st.saveBtn}>Start Service</button>}
            {selectedReq.status === 'In Progress' && <button style={st.saveBtn}>Mark Complete</button>}
            {selectedReq.status === 'Completed' && <button style={st.saveBtn}>Generate Invoice</button>}
          </div>
        </div>
      )}
    </div>
  );
}
