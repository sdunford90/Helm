import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import {
  LayoutDashboard,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Anchor,
  CalendarCheck,
  Users,
  ShieldCheck,
  FileText,
  CloudSun,
  Wind,
  Waves,
  CheckCircle2,
  Circle,
  AlertTriangle,
  Clock,
  ChevronRight,
  Plus,
  UserPlus,
  Footprints,
  CreditCard,
  Megaphone,
  BarChart3,
  Activity,
  MapPin,
  X,
} from 'lucide-react';
import InvoiceForm from '../components/InvoiceForm';

type TimePeriod = 'Today' | 'This Week' | 'This Month' | 'This Quarter';

const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const [timePeriod, setTimePeriod] = useState<TimePeriod>('This Month');
  const [hoveredBar, setHoveredBar] = useState<number | null>(null);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [taskDrawer, setTaskDrawer] = useState<{ title: string; items: { label: string; sub: string; urgent: boolean }[] } | null>(null);

  // --- API Calls ---
  const { data: occupancyData, loading: occupancyLoading } = useApi<any>('get', '/api/reports/occupancy', { immediate: true });
  const { data: revenueApiData, loading: revenueLoading } = useApi<any>('get', '/api/reports/revenue', { immediate: true });
  const { data: arData, loading: arLoading } = useApi<any>('get', '/api/reports/ar-aging', { immediate: true });
  const { data: complianceData, loading: complianceLoading } = useApi<any>('get', '/api/reports/compliance', { immediate: true });
  const { data: trendData, loading: trendLoading } = useApi<any>('get', '/api/reports/revenue-trend', { immediate: true });
  const { data: invoicesData } = useApi<any>('get', '/api/invoices?take=5&sortBy=issuedDate&sortOrder=desc', { immediate: true });
  const { data: posData } = useApi<any>('get', '/api/pos/transactions?take=5', { immediate: true });
  const { data: auditData } = useApi<any>('get', '/api/audit-log?limit=10', { immediate: true });
  const { data: transientData } = useApi<any>('get', '/api/transient?status=CHECKED_IN&take=1', { immediate: true });
  const { data: leadsData } = useApi<any>('get', '/api/leads?limit=100&page=1', { immediate: true });
  const { data: dockWalksData } = useApi<any>('get', '/api/dock-walks?status=IN_PROGRESS&take=25', { immediate: true });

  const apiLoading = occupancyLoading || revenueLoading || arLoading || complianceLoading || trendLoading;

  const periods: TimePeriod[] = ['Today', 'This Week', 'This Month', 'This Quarter'];

  // --- Colors ---
  const colors = {
    navy: '#0A2342',
    cyan: '#00D4FF',
    green: '#22C55E',
    red: '#EF4444',
    orange: '#F59E0B',
    white: '#FFFFFF',
    lightGray: '#F8FAFC',
    gray: '#94A3B8',
    darkGray: '#475569',
    border: '#E2E8F0',
  };

  // --- Styles ---
  const pageStyle: React.CSSProperties = {
    padding: '32px 40px',
    backgroundColor: colors.lightGray,
    minHeight: '100vh',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  };

  const headerStyle: React.CSSProperties = {
    marginBottom: '32px',
  };

  const titleStyle: React.CSSProperties = {
    fontSize: '32px',
    fontWeight: 700,
    color: colors.navy,
    margin: 0,
  };

  const gradientDividerStyle: React.CSSProperties = {
    height: '3px',
    background: `linear-gradient(90deg, ${colors.navy} 0%, ${colors.cyan} 50%, transparent 100%)`,
    border: 'none',
    margin: '12px 0 8px 0',
    borderRadius: '2px',
  };

  const subtitleStyle: React.CSSProperties = {
    fontSize: '15px',
    color: colors.darkGray,
    margin: '0 0 16px 0',
  };

  const periodSelectorStyle: React.CSSProperties = {
    display: 'flex',
    gap: '8px',
  };

  const periodBtnStyle = (active: boolean): React.CSSProperties => ({
    padding: '6px 16px',
    borderRadius: '6px',
    border: active ? `2px solid ${colors.cyan}` : `1px solid ${colors.border}`,
    backgroundColor: active ? 'rgba(0, 212, 255, 0.08)' : colors.white,
    color: active ? colors.navy : colors.darkGray,
    fontWeight: active ? 600 : 400,
    fontSize: '13px',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  });

  const cardStyle: React.CSSProperties = {
    backgroundColor: colors.white,
    borderRadius: '12px',
    padding: '24px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
    border: `1px solid ${colors.border}`,
  };

  const kpiGridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '20px',
    marginBottom: '28px',
  };

  const kpiCardStyle: React.CSSProperties = {
    ...cardStyle,
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  };

  const kpiLabelStyle: React.CSSProperties = {
    fontSize: '13px',
    fontWeight: 500,
    color: colors.darkGray,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  };

  const kpiValueStyle: React.CSSProperties = {
    fontSize: '28px',
    fontWeight: 700,
    color: colors.navy,
    lineHeight: 1.1,
  };

  const kpiSubStyle: React.CSSProperties = {
    fontSize: '13px',
    color: colors.gray,
  };

  const trendUpStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '3px',
    fontSize: '13px',
    fontWeight: 600,
    color: colors.green,
  };

  const trendDownStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '3px',
    fontSize: '13px',
    fontWeight: 600,
    color: colors.red,
  };

  const twoColStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: '3fr 2fr',
    gap: '24px',
    marginBottom: '28px',
  };

  const cardTitleStyle: React.CSSProperties = {
    fontSize: '16px',
    fontWeight: 700,
    color: colors.navy,
    margin: '0 0 16px 0',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  };

  const tableHeaderStyle: React.CSSProperties = {
    fontSize: '11px',
    fontWeight: 600,
    color: colors.gray,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    padding: '8px 12px',
    borderBottom: `2px solid ${colors.border}`,
    textAlign: 'left' as const,
  };

  const tableCellStyle: React.CSSProperties = {
    fontSize: '13px',
    color: colors.darkGray,
    padding: '10px 12px',
    borderBottom: `1px solid ${colors.border}`,
  };

  const statusBadge = (status: string): React.CSSProperties => {
    const colorMap: Record<string, string> = {
      Paid: colors.green,
      Pending: colors.orange,
      Overdue: colors.red,
      Completed: colors.cyan,
    };
    const bg = colorMap[status] || colors.gray;
    return {
      display: 'inline-block',
      padding: '2px 10px',
      borderRadius: '12px',
      fontSize: '12px',
      fontWeight: 600,
      color: colors.white,
      backgroundColor: bg,
    };
  };

  // --- Helpers ---
  const fmtDollars = (cents: number) =>
    '$' + Math.round(cents / 100).toLocaleString('en-US');

  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  // --- KPI values derived from API ---
  const occupancyRate = occupancyData?.summary
    ? `${Math.round(parseFloat(occupancyData.summary.occupancyRate))}%`
    : '—';
  const occupancySub = occupancyData?.summary
    ? `${occupancyData.summary.occupied} / ${occupancyData.summary.total} slips occupied`
    : 'Loading…';

  const monthlyRevenue = revenueApiData?.revenue
    ? fmtDollars(revenueApiData.revenue.totalCents)
    : '—';
  const revenueSub = (() => {
    const now = new Date();
    return now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) + ' to date';
  })();

  const arTotal = arData ? fmtDollars(arData.totalOutstanding ?? 0) : '—';
  const arOverdueCents = arData?.buckets
    ? (arData.buckets.days30 ?? 0) + (arData.buckets.days60 ?? 0) + (arData.buckets.days90 ?? 0) + (arData.buckets.days120plus ?? 0)
    : 0;
  const arSub = arData ? `${fmtDollars(arOverdueCents)} overdue (30+ days)` : 'Loading…';
  const arTrendText = arData ? `${fmtDollars(arOverdueCents)} overdue` : '';

  const reservationCount = transientData?.total ?? '—';
  const checkedInCount = typeof transientData?.total === 'number' ? transientData.total : 0;

  const now30DaysAgo = new Date();
  now30DaysAgo.setDate(now30DaysAgo.getDate() - 30);
  const recentLeads = leadsData?.data?.filter((l: any) => new Date(l.createdAt) >= now30DaysAgo) ?? [];
  const qualifiedLeads = recentLeads.filter((l: any) => l.stage === 'Qualified' || l.stage === 'QUALIFIED').length;

  const insCompliant = complianceData?.insurance?.compliant ?? 0;
  const insTotal = complianceData?.insurance?.total ?? 0;
  const insExpiringSoon = complianceData?.insurance?.expiringSoon ?? 0;
  const insExpired = complianceData?.insurance?.expired ?? 0;
  const complianceScore = insTotal > 0
    ? `${Math.round((insCompliant / insTotal) * 100)}%`
    : insTotal === 0 ? 'N/A' : '—';
  const complianceSub = insTotal > 0
    ? `${insExpiringSoon} expiring · ${insExpired} expired`
    : 'No insurance records yet';

  const kpis = [
    {
      label: 'Occupancy Rate',
      value: occupancyRate,
      sub: occupancySub,
      trend: 'up' as const,
      trendText: occupancyRate,
      icon: <Anchor size={18} color={colors.cyan} />,
    },
    {
      label: 'Monthly Revenue',
      value: monthlyRevenue,
      sub: revenueSub,
      trend: 'up' as const,
      trendText: 'Current month',
      icon: <DollarSign size={18} color={colors.cyan} />,
    },
    {
      label: 'Outstanding A/R',
      value: arTotal,
      sub: arSub,
      trend: 'down' as const,
      trendText: arTrendText,
      icon: <FileText size={18} color={colors.cyan} />,
    },
    {
      label: 'Active Reservations',
      value: String(reservationCount),
      sub: checkedInCount > 0 ? `${checkedInCount} checked in today` : 'Transient dock',
      trend: 'up' as const,
      trendText: 'Checked in',
      icon: <CalendarCheck size={18} color={colors.cyan} />,
    },
    {
      label: 'New Leads',
      value: String(recentLeads.length),
      sub: `Last 30 days · ${qualifiedLeads} qualified`,
      trend: 'up' as const,
      trendText: 'Last 30 days',
      icon: <Users size={18} color={colors.cyan} />,
    },
    {
      label: 'Compliance Score',
      value: complianceScore,
      sub: complianceSub,
      trend: (insExpired > 0 || insExpiringSoon > 0) ? 'down' as const : 'up' as const,
      trendText: insExpired > 0 ? `${insExpired} expired` : insExpiringSoon > 0 ? `${insExpiringSoon} expiring soon` : 'On track',
      icon: <ShieldCheck size={18} color={colors.cyan} />,
    },
  ];

  const revenueData: { month: string; value: number }[] = trendData?.months
    ? trendData.months.map((m: any) => ({ month: m.month, value: m.totalCents / 100 }))
    : [];

  const maxRevenue = revenueData.length > 0 ? Math.max(...revenueData.map((d) => d.value), 1) : 1;
  const trendTotal = revenueData.reduce((s, d) => s + d.value, 0);
  const trendAvg = revenueData.length > 0 ? trendTotal / revenueData.length : 0;

  const INV_STATUS_MAP: Record<string, string> = {
    PAID: 'Paid', ISSUED: 'Pending', PAST_DUE: 'Overdue', VOID: 'Void', DRAFT: 'Draft', COLLECTIONS: 'Collections',
  };
  const invoiceRows = (invoicesData?.data ?? []).map((inv: any) => ({
    id: inv.id,
    date: fmtDate(inv.issuedDate || inv.createdAt),
    desc: inv.invoiceNumber ? `Invoice ${inv.invoiceNumber}` : 'Invoice',
    customer: inv.customer ? `${inv.customer.firstName} ${inv.customer.lastName}`.trim() : '—',
    amount: fmtDollars(inv.totalCents ?? 0),
    status: INV_STATUS_MAP[inv.status] ?? inv.status,
    type: 'invoice',
    sortKey: inv.issuedDate || inv.createdAt,
  }));
  const posRows = (posData?.data ?? []).map((tx: any) => ({
    id: tx.id,
    date: fmtDate(tx.createdAt),
    desc: tx.lineItems?.[0]?.product?.name ? `POS – ${tx.lineItems[0].product.name}` : 'POS Sale',
    customer: 'Walk-in',
    amount: fmtDollars(tx.totalCents ?? 0),
    status: 'Completed',
    type: 'pos',
    sortKey: tx.createdAt,
  }));
  const transactions = [...invoiceRows, ...posRows]
    .sort((a, b) => new Date(b.sortKey).getTime() - new Date(a.sortKey).getTime())
    .slice(0, 8);

  const tasks: {
    text: string; detail: string; icon: React.ReactNode; urgent: boolean;
    route?: string;
    drawer?: { title: string; items: { label: string; sub: string; urgent: boolean }[] };
  }[] = [];

  if (arData) {
    const overdueInvoices = (arData.details ?? []).filter((d: any) => d.daysOverdue > 0);
    if (overdueInvoices.length > 0) {
      tasks.push({
        text: `${overdueInvoices.length} overdue invoice${overdueInvoices.length > 1 ? 's' : ''}`,
        detail: overdueInvoices.slice(0, 3).map((d: any) =>
          `${d.customer ? `${d.customer.firstName} ${d.customer.lastName}` : 'Unknown'} — ${fmtDollars(d.balanceCents)} (${d.daysOverdue}d)`
        ).join(' · '),
        icon: <CreditCard size={16} color={colors.red} />,
        urgent: overdueInvoices.some((d: any) => d.daysOverdue >= 30),
        route: '/billing',
      });
    }
  }

  if (complianceData) {
    const total = (insExpiringSoon + insExpired);
    if (total > 0) {
      tasks.push({
        text: `${total} insurance ${total === 1 ? 'document' : 'documents'} need attention`,
        detail: `${insExpired} expired · ${insExpiringSoon} expiring within 30 days`,
        icon: <AlertTriangle size={16} color={colors.orange} />,
        urgent: insExpired > 0,
        route: '/customers',
      });
    }
  }

  if (dockWalksData) {
    const inProgressWalks = (dockWalksData.dockWalks ?? dockWalksData.data ?? []) as any[];
    if (inProgressWalks.length > 0) {
      const overdueWalks = inProgressWalks.filter((w: any) => {
        const startedMs = new Date(w.startedAt).getTime();
        return Date.now() - startedMs > 4 * 60 * 60 * 1000;
      });
      const count = inProgressWalks.length;
      tasks.push({
        text: `${count} dock walk${count > 1 ? 's' : ''} in progress${overdueWalks.length > 0 ? ` (${overdueWalks.length} overdue)` : ''}`,
        detail: inProgressWalks.slice(0, 3).map((w: any) => {
          const hoursAgo = Math.round((Date.now() - new Date(w.startedAt).getTime()) / 3600000);
          return `Dock ${w.dockId ?? '?'} — started ${hoursAgo}h ago`;
        }).join(' · '),
        icon: <Footprints size={16} color={overdueWalks.length > 0 ? colors.red : colors.cyan} />,
        urgent: overdueWalks.length > 0,
        route: '/dock-walks',
      });
    }
  }

  if (tasks.length === 0) {
    tasks.push({
      text: 'All items up to date',
      detail: 'No overdue invoices, compliance issues, or pending dock walks',
      icon: <CheckCircle2 size={16} color={colors.green} />,
      urgent: false,
      route: '/reports',
    });
  }

  const quickActions: { label: string; icon: React.ReactNode; route?: string; action?: () => void }[] = [
    { label: 'New Invoice', icon: <Plus size={18} />, action: () => setShowInvoiceModal(true) },
    { label: 'Add Customer', icon: <UserPlus size={18} />, route: '/customers' },
    { label: 'Start Dock Walk', icon: <Footprints size={18} />, route: '/dock-walks' },
    { label: 'Record Payment', icon: <CreditCard size={18} />, route: '/billing' },
    { label: 'Send Announcement', icon: <Megaphone size={18} />, route: '/announcements' },
    { label: 'Generate Report', icon: <BarChart3 size={18} />, route: '/reports' },
  ];

  const docks: { name: string; total: number; occupied: number; vacant: number; maintenance: number }[] =
    occupancyData?.byDock
      ? occupancyData.byDock
          .filter((d: any) => d.dock != null)
          .sort((a: any, b: any) => String(a.dock).localeCompare(String(b.dock)))
          .map((d: any) => ({
            name: `Dock ${d.dock}`,
            total: d.total,
            occupied: d.occupied,
            maintenance: d.maintenance ?? 0,
            vacant: d.vacant ?? Math.max(0, d.total - d.occupied - (d.maintenance ?? 0)),
          }))
      : [];

  const fmtActivityTime = (iso: string) => {
    const d = new Date(iso);
    const now2 = new Date();
    const diffMs = now2.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffDays === 0) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    if (diffDays === 1) return `Yesterday ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
    return `${diffDays}d ago`;
  };

  const ACTION_TYPE_MAP: Record<string, string> = {
    PAYMENT_CREATED: 'payment', PAYMENT_RECEIVED: 'payment',
    INVOICE_CREATED: 'invoice', INVOICE_ISSUED: 'invoice', INVOICE_VOID: 'invoice',
    CONTRACT_CREATED: 'contract', CONTRACT_SIGNED: 'contract', ESIGN_SENT: 'contract',
    CUSTOMER_CREATED: 'lead', LEAD_CONVERTED: 'lead',
    DOCK_WALK_COMPLETED: 'dockwalk', DOCK_WALK_STARTED: 'dockwalk',
    INSURANCE_UPLOADED: 'document', INSURANCE_APPROVED: 'document',
    POS_TRANSACTION_CREATED: 'payment',
  };

  const auditEntries: { time: string; text: string; type: string }[] = (auditData?.data ?? []).map((entry: any) => {
    const action = entry.action ?? '';
    const recordType = entry.recordType ?? '';
    const user = entry.userName || entry.user?.email || 'System';
    const type = ACTION_TYPE_MAP[action] ?? (recordType.toLowerCase().includes('payment') ? 'payment' : recordType.toLowerCase().includes('invoice') ? 'invoice' : 'system');
    const changed = entry.changedFieldsJson ?? {};
    let text = `${user}: ${action.replace(/_/g, ' ').toLowerCase()} (${recordType})`;
    if (action === 'ESIGN_SENT' && changed.signerName) text = `Contract sent for signature to ${changed.signerName}`;
    else if (action === 'CONTRACT_SIGNED') text = `Contract signed`;
    else if (action === 'INVOICE_CREATED' || action === 'INVOICE_ISSUED') text = `Invoice created by ${user}`;
    else if (action === 'PAYMENT_CREATED' || action === 'PAYMENT_RECEIVED') text = `Payment recorded by ${user}`;
    else if (action === 'CUSTOMER_CREATED') text = `New customer added by ${user}`;
    else if (action === 'DOCK_WALK_COMPLETED') text = `Dock walk completed by ${user}`;
    else if (action === 'INSURANCE_UPLOADED' || action === 'INSURANCE_APPROVED') text = `Insurance document updated`;
    return { time: fmtActivityTime(entry.createdAt), text, type };
  });

  const activityFeed = auditEntries.slice(0, 10);

  const activityDot = (type: string): string => {
    const map: Record<string, string> = {
      payment: colors.green,
      contract: colors.navy,
      lead: colors.cyan,
      dockwalk: colors.orange,
      maintenance: colors.red,
      invoice: colors.darkGray,
      document: colors.gray,
      system: colors.darkGray,
    };
    return map[type] || colors.gray;
  };

  return (
    <>
    <div style={pageStyle}>
      {apiLoading && (
        <div style={{ padding: '8px 16px', marginBottom: '16px', backgroundColor: 'rgba(0,212,255,0.08)', borderRadius: '8px', fontSize: '13px', color: colors.darkGray }}>
          Loading live data...
        </div>
      )}
      {/* Header */}
      <div style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <LayoutDashboard size={28} color={colors.navy} />
            <h1 style={titleStyle} className="helm-page-title">Dashboard</h1>
          </div>
          <div style={periodSelectorStyle}>
            {periods.map((p) => (
              <button
                key={p}
                style={periodBtnStyle(timePeriod === p)}
                onClick={() => setTimePeriod(p)}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
        <hr style={gradientDividerStyle} />
        <p style={subtitleStyle}>Good morning &mdash; Tuesday, March 25, 2026 &nbsp;|&nbsp; Showing data for: <strong>{timePeriod}</strong></p>
      </div>

      {/* KPI Cards */}
      <div style={kpiGridStyle} className="helm-stats-grid">
        {kpis.map((kpi, i) => (
          <div key={i} style={kpiCardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={kpiLabelStyle}>{kpi.label}</span>
              {kpi.icon}
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px' }}>
              <span style={kpiValueStyle}>{kpi.value}</span>
              {kpi.label !== 'Outstanding A/R' ? (
                <span style={kpi.trend === 'up' ? trendUpStyle : trendDownStyle}>
                  {kpi.trend === 'up' ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                  {kpi.trendText}
                </span>
              ) : (
                <span style={trendDownStyle}>
                  <TrendingDown size={14} />
                  {kpi.trendText}
                </span>
              )}
            </div>
            <span style={kpiSubStyle}>{kpi.sub}</span>
          </div>
        ))}
      </div>

      {/* Two-column layout */}
      <div style={twoColStyle} className="helm-form-grid">
        {/* Left Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* Revenue Chart */}
          <div style={cardStyle}>
            <h3 style={cardTitleStyle}>
              <BarChart3 size={18} color={colors.cyan} />
              Revenue &mdash; Last 6 Months
            </h3>
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-end',
                gap: '16px',
                height: '180px',
                padding: '0 8px',
              }}
            >
              {revenueData.length === 0 && (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: colors.gray, fontSize: '13px' }}>
                  {trendLoading ? 'Loading revenue data…' : 'No payment data for the last 6 months'}
                </div>
              )}
              {revenueData.map((d, i) => {
                const pct = (d.value / maxRevenue) * 100;
                const isCurrentMonth = i === revenueData.length - 1;
                const isHovered = hoveredBar === i;
                return (
                  <div
                    key={d.month}
                    style={{
                      flex: 1,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      height: '100%',
                      justifyContent: 'flex-end',
                      position: 'relative',
                    }}
                    onMouseEnter={() => setHoveredBar(i)}
                    onMouseLeave={() => setHoveredBar(null)}
                  >
                    {isHovered && (
                      <div
                        style={{
                          position: 'absolute',
                          top: '-8px',
                          backgroundColor: colors.navy,
                          color: colors.white,
                          padding: '4px 10px',
                          borderRadius: '6px',
                          fontSize: '12px',
                          fontWeight: 600,
                          whiteSpace: 'nowrap',
                          zIndex: 10,
                          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                        }}
                      >
                        ${d.value.toLocaleString()}
                      </div>
                    )}
                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: 600,
                        color: isCurrentMonth ? colors.cyan : colors.darkGray,
                        marginBottom: '4px',
                      }}
                    >
                      ${(d.value / 1000).toFixed(1)}k
                    </span>
                    <div
                      style={{
                        width: '100%',
                        maxWidth: '60px',
                        height: `${pct}%`,
                        backgroundColor: isCurrentMonth ? colors.cyan : colors.navy,
                        borderRadius: '6px 6px 0 0',
                        opacity: isHovered ? 1 : (isCurrentMonth ? 1 : 0.7),
                        transition: 'height 0.3s ease, opacity 0.15s ease, transform 0.15s ease',
                        minHeight: '8px',
                        transform: isHovered ? 'scaleX(1.08)' : 'scaleX(1)',
                        cursor: 'pointer',
                      }}
                    />
                    <span
                      style={{
                        fontSize: '12px',
                        color: colors.darkGray,
                        marginTop: '8px',
                        fontWeight: 500,
                      }}
                    >
                      {d.month}
                    </span>
                  </div>
                );
              })}
            </div>
            <div
              style={{
                marginTop: '16px',
                padding: '12px 16px',
                backgroundColor: colors.lightGray,
                borderRadius: '8px',
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '13px',
              }}
            >
              <span style={{ color: colors.darkGray }}>
                6-month total: <strong style={{ color: colors.navy }}>${Math.round(trendTotal).toLocaleString('en-US')}</strong>
              </span>
              <span style={{ color: colors.darkGray }}>
                Monthly avg: <strong style={{ color: colors.navy }}>${Math.round(trendAvg).toLocaleString('en-US')}</strong>
              </span>
              {revenueData.length >= 2 && revenueData[revenueData.length - 2].value > 0 && (
                <span style={{ color: colors.green, fontWeight: 600 }}>
                  <TrendingUp size={14} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
                  {(((revenueData[revenueData.length - 1].value - revenueData[revenueData.length - 2].value) / revenueData[revenueData.length - 2].value) * 100).toFixed(1)}% vs prev month
                </span>
              )}
            </div>
          </div>

          {/* Recent Transactions */}
          <div style={cardStyle}>
            <h3 style={cardTitleStyle}>
              <DollarSign size={18} color={colors.cyan} />
              Recent Transactions
            </h3>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={tableHeaderStyle}>Date</th>
                  <th style={tableHeaderStyle}>Description</th>
                  <th style={tableHeaderStyle}>Customer</th>
                  <th style={{ ...tableHeaderStyle, textAlign: 'right' }}>Amount</th>
                  <th style={{ ...tableHeaderStyle, textAlign: 'center' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {transactions.length === 0 && (
                  <tr><td colSpan={5} style={{ padding: '24px', textAlign: 'center', color: colors.gray, fontSize: '13px' }}>
                    No recent transactions
                  </td></tr>
                )}
                {transactions.map((t, i) => (
                  <tr
                    key={i}
                    style={{
                      backgroundColor: i % 2 === 0 ? colors.white : colors.lightGray,
                      cursor: 'pointer',
                      transition: 'background-color 0.15s ease',
                    }}
                    onClick={() => navigate(t.type === 'pos' ? '/pos' : `/billing/invoices/${t.id}`)}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'rgba(0, 212, 255, 0.06)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = i % 2 === 0 ? colors.white : colors.lightGray;
                    }}
                  >
                    <td style={tableCellStyle}>{t.date}</td>
                    <td style={{ ...tableCellStyle, fontWeight: 500, color: colors.navy }}>
                      {t.desc}
                    </td>
                    <td style={tableCellStyle}>{t.customer}</td>
                    <td
                      style={{
                        ...tableCellStyle,
                        textAlign: 'right',
                        fontWeight: 600,
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {t.amount}
                    </td>
                    <td style={{ ...tableCellStyle, textAlign: 'center' }}>
                      <span style={statusBadge(t.status)}>{t.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* Upcoming Tasks */}
          <div style={cardStyle}>
            <h3 style={cardTitleStyle}>
              <CheckCircle2 size={18} color={colors.cyan} />
              Upcoming Tasks
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {tasks.map((task, i) => (
                <div
                  key={i}
                  onClick={() => task.drawer ? setTaskDrawer(task.drawer) : navigate(task.route!)}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '10px',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    backgroundColor: task.urgent
                      ? 'rgba(245, 158, 11, 0.06)'
                      : colors.lightGray,
                    border: task.urgent
                      ? '1px solid rgba(245, 158, 11, 0.2)'
                      : `1px solid ${colors.border}`,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = task.urgent
                      ? 'rgba(245, 158, 11, 0.12)'
                      : 'rgba(0, 212, 255, 0.06)';
                    e.currentTarget.style.borderColor = task.urgent
                      ? 'rgba(245, 158, 11, 0.4)'
                      : colors.cyan;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = task.urgent
                      ? 'rgba(245, 158, 11, 0.06)'
                      : colors.lightGray;
                    e.currentTarget.style.borderColor = task.urgent
                      ? 'rgba(245, 158, 11, 0.2)'
                      : colors.border;
                  }}
                >
                  <div style={{ paddingTop: '2px' }}>{task.icon}</div>
                  <div style={{ flex: 1 }}>
                    <span
                      style={{
                        fontSize: '14px',
                        color: colors.navy,
                        fontWeight: 500,
                      }}
                    >
                      {task.text}
                    </span>
                    <div style={{ fontSize: '12px', color: colors.gray, marginTop: '3px', lineHeight: 1.4 }}>
                      {task.detail}
                    </div>
                  </div>
                  <ChevronRight size={16} color={colors.gray} style={{ marginTop: '2px' }} />
                </div>
              ))}
            </div>
          </div>

          {/* Weather Widget */}
          <div style={cardStyle}>
            <h3 style={cardTitleStyle}>
              <CloudSun size={18} color={colors.cyan} />
              Marina Weather
            </h3>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '20px',
                marginBottom: '16px',
              }}
            >
              <div>
                <CloudSun size={48} color={colors.orange} />
              </div>
              <div>
                <div
                  style={{
                    fontSize: '32px',
                    fontWeight: 700,
                    color: colors.navy,
                    lineHeight: 1,
                  }}
                >
                  72&deg;F
                </div>
                <div style={{ fontSize: '14px', color: colors.darkGray, marginTop: '4px' }}>
                  Partly Cloudy
                </div>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '10px 12px',
                  backgroundColor: colors.lightGray,
                  borderRadius: '8px',
                }}
              >
                <Wind size={16} color={colors.cyan} />
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: colors.navy }}>
                    8 mph SW
                  </div>
                  <div style={{ fontSize: '11px', color: colors.gray }}>Wind</div>
                </div>
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '10px 12px',
                  backgroundColor: colors.lightGray,
                  borderRadius: '8px',
                }}
              >
                <Waves size={16} color={colors.cyan} />
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: colors.navy }}>Calm</div>
                  <div style={{ fontSize: '11px', color: colors.gray }}>Sea State</div>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Actions */}
          <div style={cardStyle}>
            <h3 style={cardTitleStyle}>
              <Activity size={18} color={colors.cyan} />
              Quick Actions
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              {quickActions.map((action, i) => (
                <button
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    border: `1px solid ${colors.border}`,
                    backgroundColor: colors.white,
                    color: colors.navy,
                    fontSize: '13px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.borderColor = colors.cyan;
                    (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                      'rgba(0, 212, 255, 0.04)';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.borderColor = colors.border;
                    (e.currentTarget as HTMLButtonElement).style.backgroundColor = colors.white;
                  }}
                  onClick={() => action.action ? action.action() : navigate(action.route!)}
                >
                  <span style={{ color: colors.cyan }}>{action.icon}</span>
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom section */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
        {/* Occupancy by Dock */}
        <div style={cardStyle}>
          <h3 style={cardTitleStyle}>
            <MapPin size={18} color={colors.cyan} />
            Occupancy by Dock
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {docks.length === 0 && (
              <div style={{ padding: '24px', textAlign: 'center', color: colors.gray, fontSize: '13px' }}>
                {occupancyLoading ? 'Loading occupancy…' : 'No dock data available'}
              </div>
            )}
            {docks.map((dock) => (
              <div key={dock.name}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginBottom: '6px',
                  }}
                >
                  <span style={{ fontSize: '14px', fontWeight: 600, color: colors.navy }}>
                    {dock.name}
                  </span>
                  <span style={{ fontSize: '12px', color: colors.gray }}>
                    {dock.occupied}/{dock.total} occupied
                  </span>
                </div>
                <div
                  style={{
                    display: 'flex',
                    height: '24px',
                    borderRadius: '6px',
                    overflow: 'hidden',
                    backgroundColor: colors.lightGray,
                  }}
                >
                  <div
                    style={{
                      width: `${(dock.occupied / dock.total) * 100}%`,
                      backgroundColor: colors.navy,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <span style={{ fontSize: '10px', color: colors.white, fontWeight: 600 }}>
                      {dock.occupied}
                    </span>
                  </div>
                  {dock.maintenance > 0 && (
                    <div
                      style={{
                        width: `${(dock.maintenance / dock.total) * 100}%`,
                        backgroundColor: colors.orange,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <span style={{ fontSize: '10px', color: colors.white, fontWeight: 600 }}>
                        {dock.maintenance}
                      </span>
                    </div>
                  )}
                  <div
                    style={{
                      flex: 1,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <span style={{ fontSize: '10px', color: colors.gray, fontWeight: 600 }}>
                      {dock.vacant}
                    </span>
                  </div>
                </div>
              </div>
            ))}
            <div style={{ display: 'flex', gap: '20px', marginTop: '4px' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '12px',
                  color: colors.darkGray,
                }}
              >
                <div
                  style={{
                    width: '12px',
                    height: '12px',
                    borderRadius: '3px',
                    backgroundColor: colors.navy,
                  }}
                />
                Occupied
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '12px',
                  color: colors.darkGray,
                }}
              >
                <div
                  style={{
                    width: '12px',
                    height: '12px',
                    borderRadius: '3px',
                    backgroundColor: colors.orange,
                  }}
                />
                Maintenance
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '12px',
                  color: colors.darkGray,
                }}
              >
                <div
                  style={{
                    width: '12px',
                    height: '12px',
                    borderRadius: '3px',
                    backgroundColor: colors.lightGray,
                    border: `1px solid ${colors.border}`,
                  }}
                />
                Vacant
              </div>
            </div>
          </div>
        </div>

        {/* Recent Activity Feed */}
        <div style={cardStyle}>
          <h3 style={cardTitleStyle}>
            <Activity size={18} color={colors.cyan} />
            Recent Activity
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {activityFeed.length === 0 && (
              <div style={{ padding: '24px', textAlign: 'center', color: colors.gray, fontSize: '13px' }}>
                No recent activity recorded yet
              </div>
            )}
            {activityFeed.map((item, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  gap: '12px',
                  padding: '10px 0',
                  borderBottom:
                    i < activityFeed.length - 1 ? `1px solid ${colors.border}` : 'none',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    paddingTop: '2px',
                  }}
                >
                  <Circle
                    size={10}
                    fill={activityDot(item.type)}
                    color={activityDot(item.type)}
                  />
                  {i < activityFeed.length - 1 && (
                    <div
                      style={{
                        width: '1px',
                        flex: 1,
                        backgroundColor: colors.border,
                        marginTop: '4px',
                      }}
                    />
                  )}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '13px', color: colors.navy, lineHeight: 1.4 }}>
                    {item.text}
                  </div>
                  <div style={{ fontSize: '11px', color: colors.gray, marginTop: '2px' }}>
                    {item.time}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>

    {/* Invoice Modal */}
    {showInvoiceModal && (
      <InvoiceForm
        onClose={() => setShowInvoiceModal(false)}
        onSaveDraft={() => setShowInvoiceModal(false)}
        onFinalize={() => setShowInvoiceModal(false)}
      />
    )}

    {/* Task Drawer */}
    {taskDrawer && (
      <>
        <div
          style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(10,35,66,0.4)', zIndex: 900 }}
          onClick={() => setTaskDrawer(null)}
        />
        <div className="helm-detail-panel" style={{
          position: 'fixed', top: 0, right: 0, width: '400px', height: '100vh',
          backgroundColor: colors.white, boxShadow: '-4px 0 20px rgba(0,0,0,0.12)',
          zIndex: 1000, overflowY: 'auto', display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '24px', borderBottom: `1px solid ${colors.border}` }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: colors.navy }}>{taskDrawer.title}</h2>
              <div style={{ fontSize: '13px', color: colors.gray, marginTop: '4px' }}>{taskDrawer.items.length} items require attention</div>
            </div>
            <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: colors.darkGray, padding: '4px' }} onClick={() => setTaskDrawer(null)}>
              <X size={20} />
            </button>
          </div>
          <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px', flex: 1 }}>
            {taskDrawer.items.map((item, i) => (
              <div key={i} style={{
                padding: '16px', borderRadius: '8px',
                backgroundColor: item.urgent ? 'rgba(245,158,11,0.06)' : colors.lightGray,
                border: item.urgent ? '1px solid rgba(245,158,11,0.3)' : `1px solid ${colors.border}`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <AlertTriangle size={14} color={item.urgent ? colors.orange : colors.gray} />
                  <span style={{ fontSize: '14px', fontWeight: 600, color: colors.navy }}>{item.label}</span>
                </div>
                <div style={{ fontSize: '13px', color: colors.darkGray, marginLeft: '22px' }}>{item.sub}</div>
              </div>
            ))}
          </div>
          <div style={{ padding: '16px', borderTop: `1px solid ${colors.border}` }}>
            <button
              style={{ width: '100%', padding: '10px', fontSize: '14px', fontWeight: 600, color: colors.white, backgroundColor: colors.navy, border: 'none', borderRadius: '6px', cursor: 'pointer' }}
              onClick={() => { setTaskDrawer(null); navigate(taskDrawer.title.includes('Contract') ? '/contracts' : '/customers'); }}
            >
              View All in {taskDrawer.title.includes('Contract') ? 'Contracts' : 'Customers'}
            </button>
          </div>
        </div>
      </>
    )}
    </>
  );
};

export default Dashboard;
