import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ComingSoonButton, NotAvailable } from '../components/StateViews';

/**
 * Reports that have a live screen today. Everything else needs the in-app
 * viewer / export pipeline, which does not exist yet (there is no
 * POST /reports/generate; the old viewer rendered hardcoded sample tables).
 */
const LIVE_REPORT_ROUTES: Record<string, string> = {
  aging: '/billing/ar-aging',
  gl: '/billing/chart-of-accounts',
  rent_roll: '/rent-roll',
  occupancy: '/',
  revenue: '/',
};
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
// Report catalog
// ---------------------------------------------------------------------------

const reportCards: ReportCard[] = [
  // Financial
  { id: 'revenue', title: 'Revenue Summary', description: 'Total revenue breakdown by category, payment method, and time period.', icon: DollarSign, lastGenerated: null, category: 'financial' },
  { id: 'aging', title: 'Accounts Receivable Aging', description: 'Outstanding invoices grouped by 30/60/90/120+ day buckets.', icon: Clock, lastGenerated: null, category: 'financial' },
  { id: 'collections', title: 'Collections Report', description: 'Payment collection performance, ACH returns, and follow-up status.', icon: TrendingUp, lastGenerated: null, category: 'financial' },
  { id: 'deferred', title: 'Deferred Revenue', description: 'Prepaid slip fees and deposits recognized over contract terms.', icon: BookOpen, lastGenerated: null, category: 'financial' },
  { id: 'gl', title: 'GL Summary', description: 'General ledger balances and journal entry summary by account.', icon: PieChart, lastGenerated: null, category: 'financial' },
  // Operations
  { id: 'occupancy', title: 'Occupancy Report', description: 'Current and historical slip occupancy rates across all docks.', icon: Anchor, lastGenerated: null, category: 'operations' },
  { id: 'utilization', title: 'Slip Utilization', description: 'Usage patterns, turnover rates, and vacancy duration per slip.', icon: BarChart3, lastGenerated: null, category: 'operations' },
  { id: 'dockwalk', title: 'Dock Walk Summary', description: 'Inspection findings, compliance issues, and resolution tracking.', icon: ClipboardList, lastGenerated: null, category: 'operations' },
  { id: 'maintenance', title: 'Maintenance Log', description: 'Work orders, scheduled maintenance, and cost tracking.', icon: Wrench, lastGenerated: null, category: 'operations' },
  // Customer
  { id: 'customer_activity', title: 'Customer Activity', description: 'Customer engagement, transaction history, and account status.', icon: Users, lastGenerated: null, category: 'customer' },
  { id: 'leads', title: 'Lead Conversion', description: 'Lead sources, conversion rates, and sales pipeline analysis.', icon: Target, lastGenerated: null, category: 'customer' },
  { id: 'waitlist', title: 'Waitlist Analytics', description: 'Waitlist volume, average wait time, and conversion to tenants.', icon: ClipboardList, lastGenerated: null, category: 'customer' },
  // Rentals & POS
  { id: 'rent_roll', title: 'Rent Roll', description: 'Active slip leases, monthly charges, and occupancy details across all docks.', icon: FileText, lastGenerated: null, category: 'rentals_pos' },
  { id: 'rental_util', title: 'Rental Utilization', description: 'Boat rental bookings, utilization rates, and revenue per asset.', icon: ShoppingCart, lastGenerated: null, category: 'rentals_pos' },
  { id: 'pos_sales', title: 'POS Sales Summary', description: 'Point-of-sale transactions, top products, and daily totals.', icon: ShoppingCart, lastGenerated: null, category: 'rentals_pos' },
  { id: 'inventory', title: 'Inventory Valuation', description: 'Current stock levels, cost basis, and reorder recommendations.', icon: Package, lastGenerated: null, category: 'rentals_pos' },
];


// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

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

  const categories = ['financial', 'operations', 'customer', 'rentals_pos'] as const;

  const tabs: { key: Tab; label: string }[] = [
    { key: 'library', label: 'Report Library' },
    { key: 'recent', label: 'Recent Reports' },
    { key: 'scheduled', label: 'Scheduled Reports' },
  ];

  return (
    <div style={styles.page}>
      {/* Header */}
      <h1 style={styles.title} className="helm-page-title">Reports</h1>
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
                          {LIVE_REPORT_ROUTES[card.id] ? 'Live data' : 'Not available yet'}
                        </p>
                        <div style={styles.cardActions}>
                          {LIVE_REPORT_ROUTES[card.id] ? (
                            <button
                              style={styles.btnView}
                              onClick={() => navigate(LIVE_REPORT_ROUTES[card.id])}
                            >
                              View
                            </button>
                          ) : (
                            <ComingSoonButton style={styles.btnView} reason="Coming soon: the in-app viewer for this report is not built yet.">
                              View
                            </ComingSoonButton>
                          )}
                          <ComingSoonButton style={styles.btnGenerate} reason="Coming soon: report export (PDF/CSV/XLSX) is not available from the server yet.">
                            Export
                          </ComingSoonButton>
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
        <NotAvailable title="Report history is not available yet" message="Generated reports are not stored by the server yet, so there is no history to show." />
      )}

      {/* -------- Scheduled Reports -------- */}
      {activeTab === 'scheduled' && (
        <NotAvailable title="Scheduled reports are not available yet" message="Report scheduling and email delivery are not implemented in the API yet." />
      )}
    </div>
  );
}
