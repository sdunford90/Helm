import { useState, useEffect } from 'react';
import {
  DollarSign,
  Ship,
  Fuel,
  UserPlus,
  AlertTriangle,
  ShieldAlert,
} from 'lucide-react';
import { api } from '../lib/api';
import { formatCents } from '../lib/format';

interface DashboardData {
  arBalance: number;
  arOverdue: number;
  rentalBookings: number;
  rentalBookingsWeek: number;
  fuelGallons: number;
  fuelRevenue: number;
  newLeads: number;
  newLeadsWeek: number;
  achReturns: number;
  complianceExpirations: number;
}

const styles = {
  header: {
    marginBottom: '32px',
  } as React.CSSProperties,
  title: {
    fontSize: '36px',
    fontWeight: 700,
    color: '#0A2342',
    lineHeight: 1.2,
    letterSpacing: '-0.02em',
  } as React.CSSProperties,
  divider: {
    width: '100%',
    height: '2px',
    background: 'linear-gradient(to right, #00D4FF, transparent)',
    marginTop: '12px',
  } as React.CSSProperties,
  subtitle: {
    fontSize: '15px',
    color: '#2E4A6B',
    marginTop: '8px',
  } as React.CSSProperties,
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '24px',
  } as React.CSSProperties,
  card: {
    backgroundColor: '#FFFFFF',
    border: '1px solid #CCCCCC',
    borderRadius: '8px',
    padding: '24px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  } as React.CSSProperties,
  cardAccent: {
    borderTop: '3px solid #00D4FF',
  } as React.CSSProperties,
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '16px',
  } as React.CSSProperties,
  cardTitle: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#2E4A6B',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
  } as React.CSSProperties,
  cardIcon: {
    color: '#2E4A6B',
  } as React.CSSProperties,
  cardMetric: {
    fontSize: '28px',
    fontWeight: 700,
    color: '#0A2342',
    fontFamily: '"JetBrains Mono", monospace',
    lineHeight: 1.2,
  } as React.CSSProperties,
  cardSubtitle: {
    fontSize: '13px',
    color: '#2E4A6B',
    marginTop: '4px',
  } as React.CSSProperties,
  loading: {
    display: 'flex',
    justifyContent: 'center',
    padding: '64px',
    color: '#64748B',
    fontSize: '15px',
  } as React.CSSProperties,
};

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [arAging, revenue, leads, rentals] = await Promise.allSettled([
          api.get<{ buckets: { current: number; days1to30: number; days31to60: number; days61to90: number; days90plus: number } }>('/reports/ar-aging'),
          api.get<{ totals: { invoiceTotalCents: number; posTotalCents: number; rentalTotalCents: number } }>('/reports/revenue'),
          api.get<{ leads: unknown[]; stats?: { total: number } }>('/leads?stage=NEW'),
          api.get<{ reservations: unknown[] }>('/rentals/reservations?status=CONFIRMED'),
        ]);

        const arData = arAging.status === 'fulfilled' ? arAging.value.buckets : null;
        const arBalance = arData ? arData.current + arData.days1to30 + arData.days31to60 + arData.days61to90 + arData.days90plus : 0;
        const arOverdue = arData ? arData.days31to60 + arData.days61to90 + arData.days90plus : 0;
        const leadsData = leads.status === 'fulfilled' ? leads.value : null;
        const rentalsData = rentals.status === 'fulfilled' ? rentals.value : null;

        setData({
          arBalance,
          arOverdue,
          rentalBookings: rentalsData?.reservations?.length ?? 0,
          rentalBookingsWeek: rentalsData?.reservations?.length ?? 0,
          fuelGallons: 0,
          fuelRevenue: 0,
          newLeads: leadsData?.leads?.length ?? 0,
          newLeadsWeek: leadsData?.leads?.length ?? 0,
          achReturns: 0,
          complianceExpirations: 0,
        });
      } catch {
        // Fall back to zeros
        setData({
          arBalance: 0, arOverdue: 0, rentalBookings: 0, rentalBookingsWeek: 0,
          fuelGallons: 0, fuelRevenue: 0, newLeads: 0, newLeadsWeek: 0,
          achReturns: 0, complianceExpirations: 0,
        });
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return <div style={styles.loading}>Loading dashboard...</div>;
  }

  const d = data!;

  const cards = [
    {
      title: 'A/R Balance & Overdue',
      icon: DollarSign,
      metric: formatCents(d.arBalance),
      subtitle: `${formatCents(d.arOverdue)} overdue (30+ days)`,
      accent: false,
    },
    {
      title: 'Boat Rental Bookings',
      icon: Ship,
      metric: String(d.rentalBookings),
      subtitle: `${d.rentalBookingsWeek} bookings this week`,
      accent: true,
    },
    {
      title: 'Fuel Sold Today',
      icon: Fuel,
      metric: `${d.fuelGallons} gal`,
      subtitle: `${formatCents(d.fuelRevenue)} revenue`,
      accent: false,
    },
    {
      title: 'New Leads From Website',
      icon: UserPlus,
      metric: String(d.newLeads),
      subtitle: `${d.newLeadsWeek} leads this week`,
      accent: false,
    },
    {
      title: 'ACH Returns Requiring Action',
      icon: AlertTriangle,
      metric: String(d.achReturns),
      subtitle: d.achReturns === 0 ? 'No unresolved returns' : `${d.achReturns} unresolved`,
      accent: false,
    },
    {
      title: 'Compliance Expirations This Week',
      icon: ShieldAlert,
      metric: String(d.complianceExpirations),
      subtitle: d.complianceExpirations === 0 ? 'All compliant' : `${d.complianceExpirations} expiring`,
      accent: false,
    },
  ];

  return (
    <div>
      <div style={styles.header}>
        <h1 style={styles.title}>Dashboard</h1>
        <div style={styles.divider} />
        <p style={styles.subtitle}>
          Key metrics at a glance.
        </p>
      </div>

      <div style={styles.grid}>
        {cards.map((card) => (
          <div
            key={card.title}
            style={{
              ...styles.card,
              ...(card.accent ? styles.cardAccent : {}),
            }}
          >
            <div style={styles.cardHeader}>
              <span style={styles.cardTitle}>{card.title}</span>
              <card.icon size={20} style={styles.cardIcon} />
            </div>
            <div style={styles.cardMetric}>{card.metric}</div>
            <div style={styles.cardSubtitle}>{card.subtitle}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
