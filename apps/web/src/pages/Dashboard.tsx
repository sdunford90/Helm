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

  const apiLoading = occupancyLoading || revenueLoading || arLoading || complianceLoading;

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

  // --- Data (API with fallback to mock) ---
  const mockKpis = [
    {
      label: 'Occupancy Rate',
      value: '87%',
      sub: '78 / 90 slips occupied',
      trend: 'up' as const,
      trendText: '+3% vs last month',
      icon: <Anchor size={18} color={colors.cyan} />,
    },
    {
      label: 'Monthly Revenue',
      value: '$124,850',
      sub: 'March 2026 to date',
      trend: 'up' as const,
      trendText: '+12% vs last month',
      icon: <DollarSign size={18} color={colors.cyan} />,
    },
    {
      label: 'Outstanding A/R',
      value: '$18,420',
      sub: '$4,200 overdue (30+ days)',
      trend: 'down' as const,
      trendText: '$4,200 overdue',
      icon: <FileText size={18} color={colors.cyan} />,
    },
    {
      label: 'Active Reservations',
      value: '14',
      sub: '6 checked in today',
      trend: 'up' as const,
      trendText: '+4 this week',
      icon: <CalendarCheck size={18} color={colors.cyan} />,
    },
    {
      label: 'New Leads',
      value: '8',
      sub: 'This week \u00B7 3 qualified',
      trend: 'up' as const,
      trendText: '+2 vs last week',
      icon: <Users size={18} color={colors.cyan} />,
    },
    {
      label: 'Compliance Score',
      value: '94%',
      sub: '2 items expiring this week',
      trend: 'up' as const,
      trendText: 'On track',
      icon: <ShieldCheck size={18} color={colors.cyan} />,
    },
  ];

  // Merge API data into KPIs when available
  const kpis = mockKpis.map((kpi) => {
    if (kpi.label === 'Occupancy Rate' && occupancyData) {
      return { ...kpi, value: `${occupancyData.rate ?? kpi.value}`, sub: occupancyData.sub ?? kpi.sub, trendText: occupancyData.trendText ?? kpi.trendText };
    }
    if (kpi.label === 'Monthly Revenue' && revenueApiData) {
      return { ...kpi, value: revenueApiData.total ?? kpi.value, sub: revenueApiData.sub ?? kpi.sub, trendText: revenueApiData.trendText ?? kpi.trendText };
    }
    if (kpi.label === 'Outstanding A/R' && arData) {
      return { ...kpi, value: arData.total ?? kpi.value, sub: arData.sub ?? kpi.sub, trendText: arData.trendText ?? kpi.trendText };
    }
    if (kpi.label === 'Compliance Score' && complianceData) {
      return { ...kpi, value: complianceData.score ?? kpi.value, sub: complianceData.sub ?? kpi.sub, trendText: complianceData.trendText ?? kpi.trendText };
    }
    return kpi;
  });

  const revenueData = [
    { month: 'Oct', value: 98200 },
    { month: 'Nov', value: 105400 },
    { month: 'Dec', value: 87600 },
    { month: 'Jan', value: 92300 },
    { month: 'Feb', value: 111500 },
    { month: 'Mar', value: 124850 },
  ];

  const maxRevenue = Math.max(...revenueData.map((d) => d.value));

  const transactions = [
    { id: '1049', date: 'Mar 25', desc: 'Slip Rental - B12', customer: 'James Harlow', amount: '$2,450.00', status: 'Paid', type: 'invoice' },
    { id: 'pos-201', date: 'Mar 25', desc: 'POS Sale - Fuel', customer: 'Sarah Mitchell', amount: '$387.50', status: 'Completed', type: 'pos' },
    { id: '1048', date: 'Mar 24', desc: 'Invoice #1048', customer: 'Coastal Charters LLC', amount: '$6,800.00', status: 'Pending', type: 'invoice' },
    { id: '1047', date: 'Mar 24', desc: 'Slip Rental - A05', customer: 'Robert Chen', amount: '$1,950.00', status: 'Paid', type: 'invoice' },
    { id: '1045', date: 'Mar 23', desc: 'Maintenance Fee', customer: 'David Thompson', amount: '$425.00', status: 'Overdue', type: 'invoice' },
    { id: 'pos-200', date: 'Mar 23', desc: 'POS Sale - Ship Store', customer: 'Maria Garcia', amount: '$128.75', status: 'Completed', type: 'pos' },
    { id: '1046', date: 'Mar 22', desc: 'Invoice #1046', customer: 'Blue Water Excursions', amount: '$3,200.00', status: 'Paid', type: 'invoice' },
    { id: '1044', date: 'Mar 22', desc: 'Rental Booking - C08', customer: "Kevin O\u2019Malley", amount: '$1,875.00', status: 'Pending', type: 'invoice' },
  ];

  const tasks: {
    text: string; detail: string; icon: React.ReactNode; urgent: boolean;
    route?: string;
    drawer?: { title: string; items: { label: string; sub: string; urgent: boolean }[] };
  }[] = [
    {
      text: '3 contracts expiring this week',
      detail: 'James Harborview - Mar 30 · Elena Windward - Mar 28 · Tom Seaside - Mar 29',
      icon: <AlertTriangle size={16} color={colors.orange} />, urgent: true,
      drawer: {
        title: 'Expiring Contracts',
        items: [
          { label: 'Elena Windward', sub: 'Expires Mar 28 — Slip A-12', urgent: true },
          { label: 'Tom Seaside', sub: 'Expires Mar 29 — Slip B-03', urgent: true },
          { label: 'James Harborview', sub: 'Expires Mar 30 — Slip C-07', urgent: true },
        ],
      },
    },
    {
      text: '2 insurance documents expiring',
      detail: 'Elena Windward - Insurance expires Mar 28 · Sarah Mitchell - Insurance expires Mar 31',
      icon: <AlertTriangle size={16} color={colors.orange} />, urgent: true,
      drawer: {
        title: 'Expiring Insurance',
        items: [
          { label: 'Elena Windward', sub: 'Insurance expires Mar 28 — Action required', urgent: true },
          { label: 'Sarah Mitchell', sub: 'Insurance expires Mar 31 — Reminder sent', urgent: false },
        ],
      },
    },
    { text: '1 maintenance request pending', detail: 'Dock C, Slip 08 - Cleat replacement requested by David Thompson', icon: <Clock size={16} color={colors.cyan} />, urgent: false, route: '/concierge' },
    { text: 'ACH return to review', detail: 'Coastal Charters LLC - $6,800.00 returned Mar 24', icon: <CreditCard size={16} color={colors.red} />, urgent: true, route: '/billing' },
    { text: 'Dock walk overdue (Dock C)', detail: 'Last completed Mar 20 - 5 days overdue', icon: <Footprints size={16} color={colors.red} />, urgent: true, route: '/dock-walks' },
  ];

  const quickActions: { label: string; icon: React.ReactNode; route?: string; action?: () => void }[] = [
    { label: 'New Invoice', icon: <Plus size={18} />, action: () => setShowInvoiceModal(true) },
    { label: 'Add Customer', icon: <UserPlus size={18} />, route: '/customers' },
    { label: 'Start Dock Walk', icon: <Footprints size={18} />, route: '/dock-walks' },
    { label: 'Record Payment', icon: <CreditCard size={18} />, route: '/billing' },
    { label: 'Send Announcement', icon: <Megaphone size={18} />, route: '/announcements' },
    { label: 'Generate Report', icon: <BarChart3 size={18} />, route: '/reports' },
  ];

  const docks = [
    { name: 'Dock A', total: 24, occupied: 22, vacant: 1, maintenance: 1 },
    { name: 'Dock B', total: 20, occupied: 18, vacant: 2, maintenance: 0 },
    { name: 'Dock C', total: 26, occupied: 21, vacant: 3, maintenance: 2 },
    { name: 'Dock D', total: 20, occupied: 17, vacant: 2, maintenance: 1 },
  ];

  const activityFeed = [
    { time: '9:42 AM', text: 'Payment of $2,450.00 received from James Harlow', type: 'payment' },
    { time: '9:15 AM', text: 'Contract signed by Coastal Charters LLC (Slip B14)', type: 'contract' },
    { time: '8:58 AM', text: "Lead converted: Kevin O\u2019Malley \u2192 Active Customer", type: 'lead' },
    { time: '8:30 AM', text: 'Dock walk completed for Dock A by Mike Reynolds', type: 'dockwalk' },
    { time: 'Yesterday 4:45 PM', text: 'Maintenance request #312 submitted for Dock C, Slip 08', type: 'maintenance' },
    { time: 'Yesterday 3:20 PM', text: 'Invoice #1048 sent to Coastal Charters LLC', type: 'invoice' },
    { time: 'Yesterday 2:10 PM', text: 'Insurance document uploaded by Sarah Mitchell', type: 'document' },
    { time: 'Yesterday 11:30 AM', text: 'POS transaction: $387.50 fuel sale to Sarah Mitchell', type: 'payment' },
    { time: 'Yesterday 10:15 AM', text: 'New lead: Patricia Nguyen \u2014 interested in 40ft slip', type: 'lead' },
    { time: 'Yesterday 9:00 AM', text: 'Automated rent reminders sent (12 recipients)', type: 'system' },
  ];

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
                6-month total: <strong style={{ color: colors.navy }}>$619,850</strong>
              </span>
              <span style={{ color: colors.darkGray }}>
                Monthly avg: <strong style={{ color: colors.navy }}>$103,308</strong>
              </span>
              <span style={{ color: colors.green, fontWeight: 600 }}>
                <TrendingUp size={14} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
                +12% this month
              </span>
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
