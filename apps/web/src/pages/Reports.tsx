import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import ReportViewer from '../components/ReportViewer';
import {
  DollarSign,
  Anchor,
  Users,
  ShoppingCart,
  BarChart3,
  FileText,
  Download,
  Calendar,
  Clock,
  Play,
  Pause,
  Plus,
  X,
  TrendingUp,
  ClipboardList,
  Wrench,
  PieChart,
  BookOpen,
  Target,
  Package,
  Filter,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ReportFormat = 'PDF' | 'CSV' | 'XLSX' | 'JSON';

interface ReportCard {
  id: string;
  title: string;
  description: string;
  icon: React.ElementType;
  lastGenerated: string | null;
  category: 'financial' | 'operations' | 'customer' | 'rentals_pos';
}

interface RecentReport {
  id: string;
  name: string;
  type: string;
  generatedBy: string;
  date: string;
  format: ReportFormat;
  size: string;
}

interface ScheduledReport {
  id: string;
  reportName: string;
  frequency: 'Daily' | 'Weekly' | 'Monthly';
  recipients: string[];
  nextRun: string;
  status: 'Active' | 'Paused';
}

// ---------------------------------------------------------------------------
// Mock Data
// ---------------------------------------------------------------------------

const reportCards: ReportCard[] = [
  // Financial
  { id: 'revenue', title: 'Revenue Summary', description: 'Total revenue breakdown by category, payment method, and time period.', icon: DollarSign, lastGenerated: '2026-03-24', category: 'financial' },
  { id: 'aging', title: 'Accounts Receivable Aging', description: 'Outstanding invoices grouped by 30/60/90/120+ day buckets.', icon: Clock, lastGenerated: '2026-03-23', category: 'financial' },
  { id: 'collections', title: 'Collections Report', description: 'Payment collection performance, ACH returns, and follow-up status.', icon: TrendingUp, lastGenerated: '2026-03-20', category: 'financial' },
  { id: 'deferred', title: 'Deferred Revenue', description: 'Prepaid slip fees and deposits recognized over contract terms.', icon: BookOpen, lastGenerated: null, category: 'financial' },
  { id: 'gl', title: 'GL Summary', description: 'General ledger balances and journal entry summary by account.', icon: PieChart, lastGenerated: '2026-03-22', category: 'financial' },
  // Operations
  { id: 'occupancy', title: 'Occupancy Report', description: 'Current and historical slip occupancy rates across all docks.', icon: Anchor, lastGenerated: '2026-03-24', category: 'operations' },
  { id: 'utilization', title: 'Slip Utilization', description: 'Usage patterns, turnover rates, and vacancy duration per slip.', icon: BarChart3, lastGenerated: '2026-03-21', category: 'operations' },
  { id: 'dockwalk', title: 'Dock Walk Summary', description: 'Inspection findings, compliance issues, and resolution tracking.', icon: ClipboardList, lastGenerated: '2026-03-23', category: 'operations' },
  { id: 'maintenance', title: 'Maintenance Log', description: 'Work orders, scheduled maintenance, and cost tracking.', icon: Wrench, lastGenerated: '2026-03-19', category: 'operations' },
  // Customer
  { id: 'customer_activity', title: 'Customer Activity', description: 'Customer engagement, transaction history, and account status.', icon: Users, lastGenerated: '2026-03-24', category: 'customer' },
  { id: 'leads', title: 'Lead Conversion', description: 'Lead sources, conversion rates, and sales pipeline analysis.', icon: Target, lastGenerated: '2026-03-18', category: 'customer' },
  { id: 'waitlist', title: 'Waitlist Analytics', description: 'Waitlist volume, average wait time, and conversion to tenants.', icon: ClipboardList, lastGenerated: null, category: 'customer' },
  // Rentals & POS
  { id: 'rent_roll', title: 'Rent Roll', description: 'Active slip leases, monthly charges, and occupancy details across all docks.', icon: FileText, lastGenerated: '2026-03-25', category: 'rentals_pos' },
  { id: 'rental_util', title: 'Rental Utilization', description: 'Boat rental bookings, utilization rates, and revenue per asset.', icon: ShoppingCart, lastGenerated: '2026-03-22', category: 'rentals_pos' },
  { id: 'pos_sales', title: 'POS Sales Summary', description: 'Point-of-sale transactions, top products, and daily totals.', icon: ShoppingCart, lastGenerated: '2026-03-24', category: 'rentals_pos' },
  { id: 'inventory', title: 'Inventory Valuation', description: 'Current stock levels, cost basis, and reorder recommendations.', icon: Package, lastGenerated: '2026-03-15', category: 'rentals_pos' },
];

const recentReports: RecentReport[] = [
  { id: '1', name: 'Revenue Summary - March 2026', type: 'Revenue', generatedBy: 'Sarah Johnson', date: '2026-03-24 14:32', format: 'PDF', size: '1.2 MB' },
  { id: '2', name: 'Occupancy Report - Q1 2026', type: 'Occupancy', generatedBy: 'Mike Chen', date: '2026-03-24 09:15', format: 'XLSX', size: '856 KB' },
  { id: '3', name: 'AR Aging - March 2026', type: 'Aging', generatedBy: 'Sarah Johnson', date: '2026-03-23 16:45', format: 'PDF', size: '943 KB' },
  { id: '4', name: 'POS Sales - Week 12', type: 'POS Sales', generatedBy: 'Tom Rivera', date: '2026-03-23 08:00', format: 'CSV', size: '324 KB' },
  { id: '5', name: 'Customer Activity - March', type: 'Customer Activity', generatedBy: 'Sarah Johnson', date: '2026-03-22 11:20', format: 'PDF', size: '2.1 MB' },
  { id: '6', name: 'Dock Walk Summary - 03/21', type: 'Dock Walk', generatedBy: 'James Park', date: '2026-03-21 17:30', format: 'PDF', size: '1.8 MB' },
  { id: '7', name: 'GL Summary - February 2026', type: 'GL Summary', generatedBy: 'Sarah Johnson', date: '2026-03-20 10:00', format: 'XLSX', size: '1.5 MB' },
  { id: '8', name: 'Collections Report - Feb', type: 'Collections', generatedBy: 'Mike Chen', date: '2026-03-19 14:10', format: 'PDF', size: '678 KB' },
];

const scheduledReports: ScheduledReport[] = [
  { id: '1', reportName: 'Revenue Summary', frequency: 'Monthly', recipients: ['sarah@marina.com', 'cfo@marina.com'], nextRun: '2026-04-01 06:00', status: 'Active' },
  { id: '2', reportName: 'Occupancy Report', frequency: 'Weekly', recipients: ['ops@marina.com'], nextRun: '2026-03-30 07:00', status: 'Active' },
  { id: '3', reportName: 'AR Aging Report', frequency: 'Weekly', recipients: ['sarah@marina.com', 'billing@marina.com'], nextRun: '2026-03-30 06:00', status: 'Active' },
  { id: '4', reportName: 'POS Sales Summary', frequency: 'Daily', recipients: ['manager@marina.com'], nextRun: '2026-03-26 06:00', status: 'Paused' },
];

const categoryLabels: Record<string, string> = {
  financial: 'Financial',
  operations: 'Operations',
  customer: 'Customer',
  rentals_pos: 'Rentals & POS',
};

const categoryIcons: Record<string, React.ElementType> = {
  financial: DollarSign,
  operations: Anchor,
  customer: Users,
  rentals_pos: ShoppingCart,
};

const formatOptions: ReportFormat[] = ['PDF', 'CSV', 'XLSX', 'JSON'];

const dockOptions = ['All Docks', 'Dock A', 'Dock B', 'Dock C', 'Dock D', 'Fuel Dock'];
const customerSegments = ['All Customers', 'Active Tenants', 'Liveaboards', 'Transients', 'Former Tenants'];

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
  page: { padding: '32px', maxWidth: '1400px', margin: '0 auto' },
  title: { fontSize: '36px', fontWeight: 700, color: '#0A2342', letterSpacing: '-0.02em', margin: 0 },
  divider: { height: '4px', background: 'linear-gradient(90deg, #00D4FF, transparent)', border: 'none', marginTop: '12px', marginBottom: '32px', borderRadius: '2px' },

  // Tabs
  tabBar: { display: 'flex', gap: '4px', marginBottom: '32px', borderBottom: '2px solid #E2E8F0', paddingBottom: '0' },
  tab: { padding: '10px 20px', fontSize: '14px', fontWeight: 600, color: '#64748B', background: 'none', border: 'none', borderBottom: '3px solid transparent', cursor: 'pointer', marginBottom: '-2px', transition: 'color 0.15s, border-color 0.15s' },
  tabActive: { padding: '10px 20px', fontSize: '14px', fontWeight: 600, color: '#0A2342', background: 'none', border: 'none', borderBottom: '3px solid #00D4FF', cursor: 'pointer', marginBottom: '-2px' },

  // Category section
  catHeader: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px', marginTop: '28px' },
  catIcon: { width: '32px', height: '32px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#0A2342', color: '#00D4FF' },
  catTitle: { fontSize: '18px', fontWeight: 700, color: '#0A2342', margin: 0 },

  // Card grid
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '20px', marginBottom: '8px' },
  card: { background: '#FFFFFF', borderRadius: '12px', border: '1px solid #E2E8F0', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', gap: '12px' },
  cardIconWrap: { width: '40px', height: '40px', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,212,255,0.1)', color: '#0A2342' },
  cardTitle: { fontSize: '15px', fontWeight: 700, color: '#0A2342', margin: 0 },
  cardDesc: { fontSize: '13px', color: '#64748B', lineHeight: 1.5, margin: 0, flex: 1 },
  cardMeta: { fontSize: '12px', color: '#94A3B8', margin: 0 },
  cardActions: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' },
  btnGenerate: { padding: '6px 14px', fontSize: '13px', fontWeight: 600, color: '#FFFFFF', backgroundColor: '#0A2342', border: 'none', borderRadius: '6px', cursor: 'pointer' },
  btnView: { padding: '6px 14px', fontSize: '13px', fontWeight: 600, color: '#0A2342', backgroundColor: 'rgba(0,212,255,0.12)', border: '1px solid rgba(0,212,255,0.4)', borderRadius: '6px', cursor: 'pointer' },
  selectFormat: {
    padding: '6px 10px',
    fontSize: '12px',
    color: '#0A2342',
    backgroundColor: '#F1F5F9',
    border: '1px solid #E2E8F0',
    borderRadius: '6px',
    cursor: 'pointer',
    appearance: 'none' as const,
    paddingRight: '24px',
    backgroundImage: "url(\"data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%230A2342' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")",
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 8px center',
  },

  // Table
  tableWrap: { background: '#FFFFFF', borderRadius: '12px', border: '1px solid #E2E8F0', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', marginBottom: '32px' },
  tableHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid #E2E8F0' },
  tableTitle: { fontSize: '16px', fontWeight: 700, color: '#0A2342', margin: 0 },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: '13px' },
  th: { textAlign: 'left' as const, padding: '12px 16px', color: '#64748B', fontWeight: 600, fontSize: '12px', textTransform: 'uppercase' as const, letterSpacing: '0.05em', borderBottom: '1px solid #E2E8F0', backgroundColor: '#F8FAFC' },
  td: { padding: '12px 16px', color: '#0A2342', borderBottom: '1px solid #F1F5F9' },
  downloadLink: { color: '#00D4FF', cursor: 'pointer', fontWeight: 600, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px' },

  // Status badges
  badgeActive: { display: 'inline-block', padding: '2px 10px', fontSize: '12px', fontWeight: 600, borderRadius: '9999px', backgroundColor: 'rgba(16,185,129,0.1)', color: '#059669' },
  badgePaused: { display: 'inline-block', padding: '2px 10px', fontSize: '12px', fontWeight: 600, borderRadius: '9999px', backgroundColor: 'rgba(245,158,11,0.1)', color: '#D97706' },
  formatBadge: { display: 'inline-block', padding: '2px 8px', fontSize: '11px', fontWeight: 700, borderRadius: '4px', backgroundColor: '#F1F5F9', color: '#475569' },

  // Buttons
  btnPrimary: { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 16px', fontSize: '13px', fontWeight: 600, color: '#FFFFFF', backgroundColor: '#0A2342', border: 'none', borderRadius: '6px', cursor: 'pointer' },
  btnSecondary: { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 16px', fontSize: '13px', fontWeight: 600, color: '#0A2342', backgroundColor: '#F1F5F9', border: '1px solid #E2E8F0', borderRadius: '6px', cursor: 'pointer' },

  // Modal overlay
  overlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(10,35,66,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: '#FFFFFF', borderRadius: '16px', width: '560px', maxHeight: '90vh', overflow: 'auto', padding: '28px', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' },
  modalTitle: { fontSize: '20px', fontWeight: 700, color: '#0A2342', margin: 0 },
  closeBtn: { background: 'none', border: 'none', cursor: 'pointer', color: '#64748B', padding: '4px' },
  formGroup: { marginBottom: '18px' },
  label: { display: 'block', fontSize: '13px', fontWeight: 600, color: '#0A2342', marginBottom: '6px' },
  input: { width: '100%', padding: '10px 12px', fontSize: '14px', border: '1px solid #E2E8F0', borderRadius: '8px', color: '#0A2342', outline: 'none', boxSizing: 'border-box' as const },
  select: { width: '100%', padding: '10px 12px', fontSize: '14px', border: '1px solid #E2E8F0', borderRadius: '8px', color: '#0A2342', outline: 'none', backgroundColor: '#FFFFFF', boxSizing: 'border-box' as const },
  dateRow: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' },
  btnGenerateModal: { width: '100%', padding: '12px', fontSize: '15px', fontWeight: 700, color: '#FFFFFF', backgroundColor: '#0A2342', border: 'none', borderRadius: '8px', cursor: 'pointer', marginTop: '8px' },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type Tab = 'library' | 'recent' | 'scheduled';

export default function Reports() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<Tab>('library');
  const [modalOpen, setModalOpen] = useState(false);
  const [modalReportId, setModalReportId] = useState<string | null>(null);
  const { execute: generateReport, loading: generating } = useApi<any>('post', '/api/reports/generate');
  const [modalFormat, setModalFormat] = useState<ReportFormat>('PDF');
  const [modalDateFrom, setModalDateFrom] = useState('2026-03-01');
  const [modalDateTo, setModalDateTo] = useState('2026-03-25');
  const [modalDock, setModalDock] = useState('All Docks');
  const [modalSegment, setModalSegment] = useState('All Customers');
  const [cardFormats, setCardFormats] = useState<Record<string, ReportFormat>>({});
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [scheduleStatuses, setScheduleStatuses] = useState<Record<string, 'Active' | 'Paused'>>({});
  const getScheduleStatus = (sr: ScheduledReport) => scheduleStatuses[sr.id] ?? sr.status;
  const toggleSchedule = (id: string) => setScheduleStatuses((prev) => ({ ...prev, [id]: prev[id] === 'Active' || (!prev[id] && scheduledReports.find((s) => s.id === id)?.status === 'Active') ? 'Paused' : 'Active' }));

  const [viewingReport, setViewingReport] = useState<string | null>(null);

  const openViewer = (reportId: string) => {
    if (reportId === 'rent_roll') { navigate('/rent-roll'); return; }
    setViewingReport(reportId);
  };

  const openModal = (reportId: string) => {
    if (reportId === 'rent_roll') { navigate('/rent-roll'); return; }
    setModalReportId(reportId);
    setModalFormat(cardFormats[reportId] || 'PDF');
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setModalReportId(null);
  };

  const getCardFormat = (id: string): ReportFormat => cardFormats[id] || 'PDF';
  const setCardFormat = (id: string, fmt: ReportFormat) =>
    setCardFormats((prev) => ({ ...prev, [id]: fmt }));

  const selectedReport = reportCards.find((r) => r.id === modalReportId);
  const showDockFilter =
    modalReportId &&
    ['occupancy', 'utilization', 'dockwalk', 'maintenance'].includes(modalReportId);
  const showCustomerFilter =
    modalReportId &&
    ['customer_activity', 'leads', 'waitlist'].includes(modalReportId);

  const categories = ['financial', 'operations', 'customer', 'rentals_pos'] as const;

  const tabs: { key: Tab; label: string }[] = [
    { key: 'library', label: 'Report Library' },
    { key: 'recent', label: 'Recent Reports' },
    { key: 'scheduled', label: 'Scheduled Reports' },
  ];

  return (
    <div style={styles.page}>
      {/* Header */}
      <h1 style={styles.title}>Reports</h1>
      <hr style={styles.divider} />

      {/* Tabs */}
      <div style={styles.tabBar}>
        {tabs.map((t) => (
          <button
            key={t.key}
            style={activeTab === t.key ? styles.tabActive : styles.tab}
            onClick={() => setActiveTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* -------- Report Library -------- */}
      {activeTab === 'library' && (
        <div>
          {categories.map((cat) => {
            const Icon = categoryIcons[cat];
            const cards = reportCards.filter((r) => r.category === cat);
            return (
              <div key={cat}>
                <div style={styles.catHeader}>
                  <div style={styles.catIcon}>
                    <Icon size={16} />
                  </div>
                  <h2 style={styles.catTitle}>{categoryLabels[cat]}</h2>
                </div>
                <div style={styles.grid}>
                  {cards.map((card) => {
                    const CIcon = card.icon;
                    return (
                      <div key={card.id} style={styles.card}>
                        <div style={styles.cardIconWrap}>
                          <CIcon size={20} />
                        </div>
                        <h3 style={styles.cardTitle}>{card.title}</h3>
                        <p style={styles.cardDesc}>{card.description}</p>
                        <p style={styles.cardMeta}>
                          {card.lastGenerated
                            ? `Last generated: ${card.lastGenerated}`
                            : 'Never generated'}
                        </p>
                        <div style={styles.cardActions}>
                          <button
                            style={styles.btnView}
                            onClick={() => openViewer(card.id)}
                          >
                            View
                          </button>
                          <button
                            style={styles.btnGenerate}
                            onClick={() => openModal(card.id)}
                          >
                            Export
                          </button>
                          <select
                            style={styles.selectFormat}
                            value={getCardFormat(card.id)}
                            onChange={(e) =>
                              setCardFormat(card.id, e.target.value as ReportFormat)
                            }
                          >
                            <option value="PDF">PDF</option>
                            <option value="CSV">CSV</option>
                            <option value="XLSX">XLSX</option>
                          </select>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* -------- Recent Reports -------- */}
      {activeTab === 'recent' && (
        <div style={styles.tableWrap}>
          <div style={styles.tableHeader}>
            <h3 style={styles.tableTitle}>Recently Generated Reports</h3>
          </div>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Name</th>
                <th style={styles.th}>Type</th>
                <th style={styles.th}>Generated By</th>
                <th style={styles.th}>Date</th>
                <th style={styles.th}>Format</th>
                <th style={styles.th}>Size</th>
                <th style={styles.th}>Download</th>
              </tr>
            </thead>
            <tbody>
              {recentReports.map((r) => (
                <tr key={r.id}>
                  <td style={styles.td}>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '8px',
                      }}
                    >
                      <FileText size={14} color="#64748B" />
                      {r.name}
                    </span>
                  </td>
                  <td style={styles.td}>{r.type}</td>
                  <td style={styles.td}>{r.generatedBy}</td>
                  <td style={styles.td}>{r.date}</td>
                  <td style={styles.td}>
                    <span style={styles.formatBadge}>{r.format}</span>
                  </td>
                  <td style={styles.td}>{r.size}</td>
                  <td style={styles.td}>
                    <a
                      style={styles.downloadLink}
                      href="#"
                      onClick={(e) => { e.preventDefault(); setDownloadingId(r.id); setTimeout(() => setDownloadingId(null), 2000); }}
                    >
                      <Download size={14} /> {downloadingId === r.id ? 'Downloaded!' : 'Download'}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* -------- Scheduled Reports -------- */}
      {activeTab === 'scheduled' && (
        <div>
          <div style={styles.tableWrap}>
            <div style={styles.tableHeader}>
              <h3 style={styles.tableTitle}>Scheduled Reports</h3>
              <button style={styles.btnPrimary} onClick={() => alert('Add schedule form would open here')}>
                <Plus size={14} /> Add Schedule
              </button>
            </div>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Report Name</th>
                  <th style={styles.th}>Frequency</th>
                  <th style={styles.th}>Recipients</th>
                  <th style={styles.th}>Next Run</th>
                  <th style={styles.th}>Status</th>
                  <th style={styles.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {scheduledReports.map((sr) => (
                  <tr key={sr.id}>
                    <td style={styles.td}>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '8px',
                        }}
                      >
                        <Calendar size={14} color="#64748B" />
                        {sr.reportName}
                      </span>
                    </td>
                    <td style={styles.td}>{sr.frequency}</td>
                    <td style={styles.td}>
                      <span style={{ fontSize: '12px', color: '#64748B' }}>
                        {sr.recipients.join(', ')}
                      </span>
                    </td>
                    <td style={styles.td}>{sr.nextRun}</td>
                    <td style={styles.td}>
                      <span
                        style={
                          getScheduleStatus(sr) === 'Active'
                            ? styles.badgeActive
                            : styles.badgePaused
                        }
                      >
                        {getScheduleStatus(sr)}
                      </span>
                    </td>
                    <td style={styles.td}>
                      <button
                        style={{
                          ...styles.btnSecondary,
                          padding: '4px 10px',
                          fontSize: '12px',
                        }}
                        title={getScheduleStatus(sr) === 'Active' ? 'Pause' : 'Resume'}
                        onClick={() => toggleSchedule(sr.id)}
                      >
                        {getScheduleStatus(sr) === 'Active' ? (
                          <Pause size={12} />
                        ) : (
                          <Play size={12} />
                        )}
                        {getScheduleStatus(sr) === 'Active' ? 'Pause' : 'Resume'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* -------- Generate Report Modal -------- */}
      {modalOpen && (
        <div style={styles.overlay} onClick={closeModal}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <h2 style={styles.modalTitle}>
                {selectedReport
                  ? `Generate: ${selectedReport.title}`
                  : 'Generate Report'}
              </h2>
              <button style={styles.closeBtn} onClick={closeModal}>
                <X size={20} />
              </button>
            </div>

            {/* Report type */}
            <div style={styles.formGroup}>
              <label style={styles.label}>Report Type</label>
              <select
                style={styles.select}
                value={modalReportId || ''}
                onChange={(e) => setModalReportId(e.target.value)}
              >
                {reportCards.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title}
                  </option>
                ))}
              </select>
            </div>

            {/* Date range */}
            <div style={styles.formGroup}>
              <label style={styles.label}>Date Range</label>
              <div style={styles.dateRow}>
                <input
                  type="date"
                  style={styles.input}
                  value={modalDateFrom}
                  onChange={(e) => setModalDateFrom(e.target.value)}
                />
                <input
                  type="date"
                  style={styles.input}
                  value={modalDateTo}
                  onChange={(e) => setModalDateTo(e.target.value)}
                />
              </div>
            </div>

            {/* Format */}
            <div style={styles.formGroup}>
              <label style={styles.label}>Output Format</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                {formatOptions.map((fmt) => (
                  <button
                    key={fmt}
                    onClick={() => setModalFormat(fmt)}
                    style={{
                      flex: 1,
                      padding: '10px',
                      fontSize: '13px',
                      fontWeight: 600,
                      borderRadius: '8px',
                      border:
                        modalFormat === fmt
                          ? '2px solid #00D4FF'
                          : '1px solid #E2E8F0',
                      backgroundColor:
                        modalFormat === fmt
                          ? 'rgba(0,212,255,0.08)'
                          : '#FFFFFF',
                      color: modalFormat === fmt ? '#0A2342' : '#64748B',
                      cursor: 'pointer',
                    }}
                  >
                    {fmt}
                  </button>
                ))}
              </div>
            </div>

            {/* Conditional filters */}
            {showDockFilter && (
              <div style={styles.formGroup}>
                <label style={styles.label}>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    <Filter size={13} /> Dock Selection
                  </span>
                </label>
                <select
                  style={styles.select}
                  value={modalDock}
                  onChange={(e) => setModalDock(e.target.value)}
                >
                  {dockOptions.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {showCustomerFilter && (
              <div style={styles.formGroup}>
                <label style={styles.label}>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    <Filter size={13} /> Customer Segment
                  </span>
                </label>
                <select
                  style={styles.select}
                  value={modalSegment}
                  onChange={(e) => setModalSegment(e.target.value)}
                >
                  {customerSegments.map((seg) => (
                    <option key={seg} value={seg}>
                      {seg}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <button
              style={styles.btnGenerateModal}
              disabled={generating}
              onClick={async () => {
                await generateReport({
                  reportId: modalReportId,
                  format: modalFormat,
                  dateFrom: modalDateFrom,
                  dateTo: modalDateTo,
                  dock: modalDock,
                  segment: modalSegment,
                });
                closeModal();
              }}
            >
              {generating ? 'Generating...' : 'Generate Report'}
            </button>
          </div>
        </div>
      )}

      {/* -------- In-App Report Viewer -------- */}
      {viewingReport && (
        <ReportViewer reportId={viewingReport} onClose={() => setViewingReport(null)} />
      )}
    </div>
  );
}
