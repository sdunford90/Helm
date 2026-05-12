import { Link, useLocation } from 'react-router-dom';
import {
  BarChart3, TrendingUp, Anchor, Users, MessageSquare,
  ShieldCheck, Calendar, Wrench, ArrowRight,
} from 'lucide-react';
import { SubNav, INSIGHTS_SUBNAV } from '@helm/ui-kit';
import Reports from './Reports';
import { useApi } from '../hooks/useApi';

const styles: Record<string, React.CSSProperties> = {
  page: { padding: '32px', maxWidth: '1400px', margin: '0 auto' },
  title: { fontSize: '36px', fontWeight: 700, color: '#0A2342', letterSpacing: '-0.02em', margin: 0 },
  divider: { height: '4px', background: 'linear-gradient(90deg, #00D4FF, transparent)', border: 'none', marginTop: '12px', marginBottom: '24px', borderRadius: '2px' },
  subtitle: { fontSize: '14px', color: '#64748B', margin: '0 0 24px' },
  kpiGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '32px' },
  kpiCard: { background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' },
  kpiLabel: { fontSize: '12px', fontWeight: 600, color: '#64748B', textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: '6px' },
  kpiValue: { fontSize: '26px', fontWeight: 700, color: '#0A2342', fontFamily: 'Inter, system-ui, sans-serif', fontVariantNumeric: 'tabular-nums' as const },
  kpiSub: { fontSize: '12px', color: '#94A3B8', marginTop: '4px' },
  sectionGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px' },
  sectionCard: { background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '20px', display: 'flex', flexDirection: 'column' as const, gap: '8px', textDecoration: 'none' },
  sectionIcon: { width: '36px', height: '36px', borderRadius: '8px', background: 'rgba(0,212,255,0.12)', color: '#0A2342', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { fontSize: '15px', fontWeight: 700, color: '#0A2342', margin: 0 },
  sectionDesc: { fontSize: '13px', color: '#64748B', lineHeight: 1.5, margin: 0 },
  comingSoon: { background: '#FFFFFF', border: '1px dashed #CBD5E1', borderRadius: '8px', padding: '40px 24px', textAlign: 'center' as const, color: '#64748B' },
  comingTitle: { fontSize: '18px', fontWeight: 700, color: '#0A2342', marginBottom: '8px' },
  comingBody: { fontSize: '14px', color: '#64748B', maxWidth: '520px', margin: '0 auto 16px' },
  linkBtn: { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 16px', background: '#0A2342', color: '#FFFFFF', borderRadius: '6px', textDecoration: 'none', fontSize: '13px', fontWeight: 600 },
};

const SECTIONS = [
  { path: '/insights/operations', label: 'Operations', icon: Anchor, desc: 'Occupancy, dock walks, slip utilization, maintenance.' },
  { path: '/insights/financial', label: 'Financial', icon: TrendingUp, desc: 'Revenue, A/R aging, deferred revenue, sales tax, GL summary.' },
  { path: '/insights/customers', label: 'Customers & CRM', icon: Users, desc: 'Customer activity, lead conversion, waitlist analytics.' },
  { path: '/insights/communications', label: 'Communications', icon: MessageSquare, desc: 'Email and SMS delivery, engagement, automation health.' },
  { path: '/insights/compliance', label: 'Compliance & Audit', icon: ShieldCheck, desc: 'Audit log, period closes, system access reviews.' },
  { path: '/insights/scheduled', label: 'Scheduled & Saved', icon: Calendar, desc: 'Manage scheduled deliveries and saved report definitions.' },
  { path: '/insights/custom-builder', label: 'Custom Builder', icon: Wrench, desc: 'Build ad-hoc reports against your marina data.' },
];

function ComingSoon({
  title,
  body,
  link,
}: {
  title: string;
  body: string;
  link?: { to: string; label: string };
}) {
  return (
    <div style={styles.comingSoon}>
      <div style={styles.comingTitle}>{title}</div>
      <p style={styles.comingBody}>{body}</p>
      {link && (
        <Link to={link.to} style={styles.linkBtn}>
          {link.label} <ArrowRight size={14} />
        </Link>
      )}
    </div>
  );
}

function Overview() {
  // Reuse the same KPI feeds that power the marina Dashboard so Insights
  // Overview shows live numbers without any new backend work.
  const { data: occupancyData } = useApi<any>('get', '/api/reports/occupancy', { immediate: true });
  const { data: revenueData } = useApi<any>('get', '/api/reports/revenue', { immediate: true });
  const { data: arData } = useApi<any>('get', '/api/reports/ar-aging', { immediate: true });
  const { data: contractsData } = useApi<any>('get', '/api/contracts?status=ACTIVE&pageSize=1', { immediate: true });

  const fmtDollars = (cents: number) => '$' + Math.round(cents / 100).toLocaleString('en-US');

  const occupancyValue = occupancyData?.summary
    ? `${Math.round(parseFloat(occupancyData.summary.occupancyRate))}%`
    : '—';
  const occupancySub = occupancyData?.summary
    ? `${occupancyData.summary.occupied} / ${occupancyData.summary.total} slips occupied`
    : 'Loading…';

  const revenueValue = revenueData?.revenue ? fmtDollars(revenueData.revenue.totalCents) : '—';
  const now = new Date();
  const revenueSub = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) + ' to date';

  const arValue = arData ? fmtDollars(arData.totalOutstanding ?? 0) : '—';
  const arSub = arData ? 'Across all customers' : 'Loading…';

  const contractsValue =
    typeof contractsData?.total === 'number'
      ? contractsData.total.toLocaleString('en-US')
      : Array.isArray(contractsData?.data)
        ? contractsData.data.length.toLocaleString('en-US')
        : '—';

  return (
    <div>
      <p style={styles.subtitle}>
        High-level performance across your marina. Drill into any subsection for full reports.
      </p>
      <div style={styles.kpiGrid}>
        <div style={styles.kpiCard}>
          <div style={styles.kpiLabel}>MTD Revenue</div>
          <div style={styles.kpiValue}>{revenueValue}</div>
          <div style={styles.kpiSub}>{revenueSub}</div>
        </div>
        <div style={styles.kpiCard}>
          <div style={styles.kpiLabel}>Occupancy</div>
          <div style={styles.kpiValue}>{occupancyValue}</div>
          <div style={styles.kpiSub}>{occupancySub}</div>
        </div>
        <div style={styles.kpiCard}>
          <div style={styles.kpiLabel}>Open A/R</div>
          <div style={styles.kpiValue}>{arValue}</div>
          <div style={styles.kpiSub}>{arSub}</div>
        </div>
        <div style={styles.kpiCard}>
          <div style={styles.kpiLabel}>Active Contracts</div>
          <div style={styles.kpiValue}>{contractsValue}</div>
          <div style={styles.kpiSub}>Slip + dry-storage</div>
        </div>
      </div>

      <div style={styles.sectionGrid}>
        {SECTIONS.map((s) => {
          const Icon = s.icon;
          return (
            <Link key={s.path} to={s.path} style={styles.sectionCard}>
              <div style={styles.sectionIcon}>
                <Icon size={18} />
              </div>
              <h3 style={styles.sectionTitle}>{s.label}</h3>
              <p style={styles.sectionDesc}>{s.desc}</p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export default function Insights() {
  const { pathname } = useLocation();

  let body: React.ReactNode;
  let heading = 'Insights';

  if (pathname === '/insights' || pathname === '/insights/') {
    body = <Overview />;
  } else if (pathname.startsWith('/insights/operations')) {
    heading = 'Operations Insights';
    body = <ComingSoon title="Operations dashboards coming soon" body="Occupancy trends, slip utilization, dock walk findings, and maintenance throughput will live here." />;
  } else if (pathname.startsWith('/insights/financial')) {
    heading = 'Financial Insights';
    body = (
      <ComingSoon
        title="Financial dashboards coming soon"
        body="Revenue, A/R aging, deferred revenue, and GL summaries will be available here. The detailed Sales Tax report is already available."
        link={{ to: '/reports/sales-tax', label: 'Open Sales Tax Report' }}
      />
    );
  } else if (pathname.startsWith('/insights/customers')) {
    heading = 'Customers & CRM Insights';
    body = <ComingSoon title="Customer insights coming soon" body="Customer activity, lead conversion, and waitlist analytics will live here." />;
  } else if (pathname.startsWith('/insights/communications')) {
    heading = 'Communications Insights';
    body = <ComingSoon title="Communications insights coming soon" body="Email and SMS delivery, engagement metrics, and automation health will live here." />;
  } else if (pathname.startsWith('/insights/compliance')) {
    heading = 'Compliance & Audit';
    body = (
      <ComingSoon
        title="Compliance dashboards coming soon"
        body="Period close status, configuration changes, and access reviews will live here. The full audit log is available under Settings."
      />
    );
  } else if (pathname.startsWith('/insights/scheduled')) {
    heading = 'Scheduled & Saved Reports';
    return (
      <div style={styles.page}>
        <h1 style={styles.title} className="helm-page-title">{heading}</h1>
        <hr style={styles.divider} />
        <SubNav items={INSIGHTS_SUBNAV} />
        <Reports />
      </div>
    );
  } else if (pathname.startsWith('/insights/custom-builder')) {
    heading = 'Custom Report Builder';
    body = <ComingSoon title="Custom report builder coming soon" body="Build, preview, and save ad-hoc reports against your marina data." />;
  } else {
    body = <Overview />;
  }

  return (
    <div style={styles.page}>
      <h1 style={styles.title} className="helm-page-title">{heading}</h1>
      <hr style={styles.divider} />
      <SubNav items={INSIGHTS_SUBNAV} />
      {body}
    </div>
  );
}
