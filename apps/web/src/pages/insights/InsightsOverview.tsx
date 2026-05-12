import React from 'react';
import { Link } from 'react-router-dom';
import {
  TrendingUp, Anchor, Users, MessageSquare,
  ShieldCheck, Calendar, Wrench,
} from 'lucide-react';
import InsightsShell from './InsightsShell';
import { useApi } from '../../hooks/useApi';

const styles: Record<string, React.CSSProperties> = {
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
};

const SECTIONS = [
  { path: '/insights/operations', label: 'Operations', icon: Anchor, desc: 'Occupancy, dock walks, slip utilization, fuel, POS, inventory.' },
  { path: '/insights/financial', label: 'Financial', icon: TrendingUp, desc: 'Revenue, A/R aging, deferred revenue, sales tax, GL summary.' },
  { path: '/insights/customers', label: 'Customers & CRM', icon: Users, desc: 'Customer LTV, lead conversion, waitlist depth, NPS, compliance.' },
  { path: '/insights/communications', label: 'Communications', icon: MessageSquare, desc: 'Email and SMS delivery, engagement, automation health.' },
  { path: '/insights/compliance', label: 'Compliance & Audit', icon: ShieldCheck, desc: 'Audit log, period closes, QBO sync health, webhook deliveries.' },
  { path: '/insights/scheduled', label: 'Scheduled & Saved', icon: Calendar, desc: 'Manage scheduled deliveries and saved report definitions.' },
  { path: '/insights/custom-builder', label: 'Custom Builder', icon: Wrench, desc: 'Build ad-hoc reports against any data in your marina.' },
];

const fmtDollars = (cents: number) => '$' + Math.round(cents / 100).toLocaleString('en-US');

export default function InsightsOverview() {
  const { data: occupancyData } = useApi<any>('get', '/api/reports/occupancy', { immediate: true });
  const { data: revenueData } = useApi<any>('get', '/api/reports/revenue', { immediate: true });
  const { data: arData } = useApi<any>('get', '/api/reports/ar-aging', { immediate: true });
  const { data: contractsData } = useApi<any>('get', '/api/contracts?status=ACTIVE&pageSize=1', { immediate: true });

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
    <InsightsShell
      title="Insights"
      subtitle="High-level performance across your marina. Drill into any subsection for full reports."
    >
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
    </InsightsShell>
  );
}
