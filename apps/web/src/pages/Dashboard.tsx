import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useList, useResource } from '../hooks/useApi';
import { formatCents, formatDate, formatDateTime, humanizeEnum, toDateKey } from '../lib/format';
import { customerName, type AuditLogDTO, type ContractDTO, type InvoiceDTO } from '../lib/dto';
import { EmptyState, ErrorState, LoadingState } from '../components/StateViews';
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

type TimePeriod = 'Today' | 'This Week' | 'This Month' | 'This Quarter';

interface OccupancyReport {
  summary: { total: number; occupied: number; vacant: number; maintenance: number; reserved: number; occupancyRate: string };
  byDock: { dock: string | null; total: number; occupied: number; rate: string }[];
}
interface RevenueReport {
  revenue: { totalCents: number; paymentCount: number };
  invoiced: { totalCents: number; invoiceCount: number };
}
interface ArAgingReport {
  buckets: { current: number; days30: number; days60: number; days90: number; days120plus: number };
  totalOutstanding: number;
  invoiceCount: number;
  details: { invoiceId: string; daysOverdue: number }[];
}
interface ComplianceReport {
  insurance: { total: number; compliant: number; expiringSoon: number; expired: number };
  registration: { total: number; expired: number; current: number };
}
interface LeadStats {
  totalLeads: number;
  countByStage: Record<string, number>;
  conversionRate: number;
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function startOfPeriod(period: TimePeriod): Date {
  const now = new Date();
  if (period === 'Today') return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === 'This Week') return new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
  if (period === 'This Quarter') return new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function lastSixMonths(): Date[] {
  const now = new Date();
  return Array.from({ length: 6 }, (_, i) => new Date(now.getFullYear(), now.getMonth() - 5 + i, 1));
}

function monthRevenuePath(monthStart: Date): string {
  const end = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
  return `/reports/revenue?startDate=${toDateKey(monthStart)}&endDate=${toDateKey(end)}T23:59:59`;
}

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function activityType(recordType: string): string {
  const t = recordType.toLowerCase();
  if (t.includes('payment')) return 'payment';
  if (t.includes('contract')) return 'contract';
  if (t.includes('lead')) return 'lead';
  if (t.includes('dock')) return 'dockwalk';
  if (t.includes('invoice')) return 'invoice';
  return 'system';
}

const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const [timePeriod, setTimePeriod] = useState<TimePeriod>('This Month');
  const [hoveredBar, setHoveredBar] = useState<number | null>(null);
  const [taskDrawer, setTaskDrawer] = useState<{ title: string; items: { label: string; sub: string; urgent: boolean }[] } | null>(null);

  // --- API Calls (real data only; failures show as unavailable) ---
  const periodStart = startOfPeriod(timePeriod);
  const occupancy = useResource<OccupancyReport>('/reports/occupancy');
  const revenue = useResource<RevenueReport>(`/reports/revenue?startDate=${toDateKey(periodStart)}`);
  const ar = useResource<ArAgingReport>('/reports/ar-aging');
  const compliance = useResource<ComplianceReport>('/reports/compliance');
  const leadStats = useResource<LeadStats>('/leads/stats');
  const months = lastSixMonths();
  const rev0 = useResource<RevenueReport>(monthRevenuePath(months[0]));
  const rev1 = useResource<RevenueReport>(monthRevenuePath(months[1]));
  const rev2 = useResource<RevenueReport>(monthRevenuePath(months[2]));
  const rev3 = useResource<RevenueReport>(monthRevenuePath(months[3]));
  const rev4 = useResource<RevenueReport>(monthRevenuePath(months[4]));
  const rev5 = useResource<RevenueReport>(monthRevenuePath(months[5]));
  const monthly = [rev0, rev1, rev2, rev3, rev4, rev5];
  const recentInvoices = useList<InvoiceDTO>('/invoices?take=8&sortBy=issuedDate&sortOrder=desc');
  const expiring = useList<ContractDTO>('/contracts/expiring?days=7');
  const activity = useList<AuditLogDTO>('/audit-log?limit=10');

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

  // --- Derived data (from the API only) ---
  const unavailable = (r: { loading: boolean; error: string | null }) =>
    r.loading ? 'Loading…' : r.error ? 'Unavailable' : null;

  const arOverdueCents = ar.data
    ? ar.data.buckets.days30 + ar.data.buckets.days60 + ar.data.buckets.days90 + ar.data.buckets.days120plus
    : 0;
  const insurance = compliance.data?.insurance;
  const compliancePct =
    insurance && insurance.total > 0 ? Math.round((insurance.compliant / insurance.total) * 100) : null;

  const kpis: { label: string; value: string; sub: string; error?: string | null; icon: React.ReactNode }[] = [
    {
      label: 'Occupancy Rate',
      value: occupancy.data ? `${occupancy.data.summary.occupancyRate}%` : '—',
      sub: unavailable(occupancy) ?? `${occupancy.data!.summary.occupied} / ${occupancy.data!.summary.total} slips occupied`,
      error: occupancy.error,
      icon: <Anchor size={18} color={colors.cyan} />,
    },
    {
      label: 'Revenue Collected',
      value: revenue.data ? formatCents(revenue.data.revenue.totalCents) : '—',
      sub: unavailable(revenue) ?? `${revenue.data!.revenue.paymentCount} payments · ${timePeriod}`,
      error: revenue.error,
      icon: <DollarSign size={18} color={colors.cyan} />,
    },
    {
      label: 'Outstanding A/R',
      value: ar.data ? formatCents(ar.data.totalOutstanding) : '—',
      sub: unavailable(ar) ?? `${formatCents(arOverdueCents)} overdue · ${ar.data!.invoiceCount} open invoices`,
      error: ar.error,
      icon: <FileText size={18} color={colors.cyan} />,
    },
    {
      label: 'Leads',
      value: leadStats.data ? String(leadStats.data.totalLeads) : '—',
      sub:
        unavailable(leadStats) ??
        `${leadStats.data!.countByStage.QUALIFIED ?? 0} qualified · ${leadStats.data!.conversionRate}% conversion`,
      error: leadStats.error,
      icon: <Users size={18} color={colors.cyan} />,
    },
    {
      label: 'Insurance Compliance',
      value: compliancePct === null ? '—' : `${compliancePct}%`,
      sub:
        unavailable(compliance) ??
        (insurance && insurance.total > 0
          ? `${insurance.expiringSoon} expiring in 30 days · ${insurance.expired} expired`
          : 'No insurance records on file'),
      error: compliance.error,
      icon: <ShieldCheck size={18} color={colors.cyan} />,
    },
  ];

  const revenueData = months.map((m, i) => ({
    month: MONTH_LABELS[m.getMonth()],
    value: (monthly[i].data?.revenue.totalCents ?? 0) / 100,
  }));
  const revenueLoading = monthly.some((r) => r.loading);
  const revenueError = monthly.find((r) => r.error)?.error ?? null;
  const maxRevenue = Math.max(1, ...revenueData.map((d) => d.value));
  const sixMonthTotal = revenueData.reduce((sum, d) => sum + d.value, 0);

  const tasks: {
    text: string; detail: string; icon: React.ReactNode; urgent: boolean;
    route?: string;
    drawer?: { title: string; items: { label: string; sub: string; urgent: boolean }[] };
  }[] = [];
  if (expiring.items.length > 0) {
    tasks.push({
      text: `${expiring.pagination?.total ?? expiring.items.length} contract${expiring.items.length === 1 ? '' : 's'} expiring in the next 7 days`,
      detail: expiring.items.slice(0, 3).map((c) => `${customerName(c.customer)} - ${formatDate(c.endDate)}`).join(' · '),
      icon: <AlertTriangle size={16} color={colors.orange} />, urgent: true,
      drawer: {
        title: 'Expiring Contracts',
        items: expiring.items.map((c) => ({
          label: customerName(c.customer),
          sub: `Expires ${formatDate(c.endDate)}${c.slip?.slipNumber ? ` — Slip ${c.slip.slipNumber}` : ''}`,
          urgent: (c.daysUntilExpiry ?? 99) <= 3,
        })),
      },
    });
  }
  if (insurance && insurance.expiringSoon + insurance.expired > 0) {
    tasks.push({
      text: `${insurance.expiringSoon + insurance.expired} insurance document${insurance.expiringSoon + insurance.expired === 1 ? '' : 's'} expired or expiring`,
      detail: `${insurance.expired} expired · ${insurance.expiringSoon} expiring within 30 days`,
      icon: <AlertTriangle size={16} color={colors.orange} />, urgent: insurance.expired > 0,
      route: '/customers',
    });
  }
  if (ar.data && arOverdueCents > 0) {
    tasks.push({
      text: `${formatCents(arOverdueCents)} in overdue receivables`,
      detail: `${ar.data.details.filter((d) => d.daysOverdue > 0).length} invoices past due`,
      icon: <CreditCard size={16} color={colors.red} />, urgent: true,
      route: '/billing/ar-aging',
    });
  }
  const tasksLoading = expiring.loading || compliance.loading || ar.loading;
  const tasksError = expiring.error && compliance.error && ar.error ? expiring.error : null;

  const quickActions: { label: string; icon: React.ReactNode; route?: string; action?: () => void }[] = [
    { label: 'New Invoice', icon: <Plus size={18} />, route: '/billing?new=1' },
    { label: 'Add Customer', icon: <UserPlus size={18} />, route: '/customers' },
    { label: 'Start Dock Walk', icon: <Footprints size={18} />, route: '/dock-walks' },
    { label: 'Record Payment', icon: <CreditCard size={18} />, route: '/billing' },
    { label: 'Send Announcement', icon: <Megaphone size={18} />, route: '/announcements' },
    { label: 'Generate Report', icon: <BarChart3 size={18} />, route: '/reports' },
  ];

  const docks = (occupancy.data?.byDock ?? []).map((d) => ({
    name: d.dock ? `Dock ${d.dock}` : 'Unassigned',
    total: d.total,
    occupied: d.occupied,
    // The API reports occupied per dock only; maintenance is not broken out.
    maintenance: 0,
    vacant: Math.max(0, d.total - d.occupied),
  }));

  const activityFeed = activity.items.map((e) => ({
    time: formatDateTime(e.createdAt),
    text: `${humanizeEnum(e.action)} ${e.recordType.toLowerCase()}${e.userName || e.user?.email ? ` by ${e.userName ?? e.user?.email}` : ''}`,
    type: activityType(e.recordType),
  }));

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
        <p style={subtitleStyle}>{greeting()} &mdash; {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} &nbsp;|&nbsp; Revenue shown for: <strong>{timePeriod}</strong></p>
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
            </div>
            <span style={kpiSubStyle} title={kpi.error ?? undefined}>{kpi.sub}</span>
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
              Revenue Collected &mdash; Last 6 Months
            </h3>
            {revenueLoading ? <LoadingState compact label="Loading revenue…" /> : revenueError ? <ErrorState compact message={revenueError} /> : (<>
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
                        {formatCents(Math.round(d.value * 100))}
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
                6-month total: <strong style={{ color: colors.navy }}>{formatCents(Math.round(sixMonthTotal * 100))}</strong>
              </span>
              <span style={{ color: colors.darkGray }}>
                Monthly avg: <strong style={{ color: colors.navy }}>{formatCents(Math.round((sixMonthTotal / 6) * 100))}</strong>
              </span>
            </div>
            </>)}
          </div>

          {/* Recent Transactions */}
          <div style={cardStyle}>
            <h3 style={cardTitleStyle}>
              <DollarSign size={18} color={colors.cyan} />
              Recent Invoices
            </h3>
            {recentInvoices.loading ? <LoadingState compact /> : recentInvoices.error ? <ErrorState compact message={recentInvoices.error} onRetry={recentInvoices.refetch} /> : recentInvoices.items.length === 0 ? <EmptyState compact title="No invoices yet" /> : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={tableHeaderStyle}>Date</th>
                  <th style={tableHeaderStyle}>Invoice</th>
                  <th style={tableHeaderStyle}>Customer</th>
                  <th style={{ ...tableHeaderStyle, textAlign: 'right' }}>Amount</th>
                  <th style={{ ...tableHeaderStyle, textAlign: 'center' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {recentInvoices.items.map((t, i) => (
                  <tr
                    key={t.id}
                    style={{
                      backgroundColor: i % 2 === 0 ? colors.white : colors.lightGray,
                      cursor: 'pointer',
                      transition: 'background-color 0.15s ease',
                    }}
                    onClick={() => navigate(`/billing/invoices/${t.id}`)}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'rgba(0, 212, 255, 0.06)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = i % 2 === 0 ? colors.white : colors.lightGray;
                    }}
                  >
                    <td style={tableCellStyle}>{formatDate(t.issuedDate)}</td>
                    <td style={{ ...tableCellStyle, fontWeight: 500, color: colors.navy }}>
                      {t.invoiceNumber}
                    </td>
                    <td style={tableCellStyle}>{customerName(t.customer)}</td>
                    <td
                      style={{
                        ...tableCellStyle,
                        textAlign: 'right',
                        fontWeight: 600,
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {formatCents(t.totalCents)}
                    </td>
                    <td style={{ ...tableCellStyle, textAlign: 'center' }}>
                      <span style={statusBadge(humanizeEnum(t.status))}>{humanizeEnum(t.status)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            )}
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
            {tasksLoading ? <LoadingState compact /> : tasksError ? <ErrorState compact message={tasksError} /> : tasks.length === 0 ? <EmptyState compact title="Nothing needs attention" message="No expiring contracts, insurance issues or overdue receivables." /> : (
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
            )}
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
          {occupancy.loading ? <LoadingState compact /> : occupancy.error ? <ErrorState compact message={occupancy.error} onRetry={occupancy.refetch} /> : docks.length === 0 ? <EmptyState compact title="No slips set up yet" /> : (
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
                      width: `${dock.total > 0 ? (dock.occupied / dock.total) * 100 : 0}%`,
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
          )}
        </div>

        {/* Recent Activity Feed */}
        <div style={cardStyle}>
          <h3 style={cardTitleStyle}>
            <Activity size={18} color={colors.cyan} />
            Recent Activity
          </h3>
          {activity.loading ? <LoadingState compact /> : activity.error ? <ErrorState compact message={activity.error} onRetry={activity.refetch} /> : activityFeed.length === 0 ? <EmptyState compact title="No recent activity" /> : (
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
          )}
        </div>
      </div>
    </div>

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
