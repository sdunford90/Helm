import {
  DollarSign,
  Ship,
  Fuel,
  UserPlus,
  AlertTriangle,
  ShieldAlert,
} from 'lucide-react';

const cards = [
  {
    title: 'A/R Balance & Overdue',
    icon: DollarSign,
    metric: '$0.00',
    subtitle: '$0.00 overdue (30+ days)',
    accent: false,
  },
  {
    title: 'Boat Rental Bookings',
    icon: Ship,
    metric: '0',
    subtitle: '0 bookings this week',
    accent: true,
  },
  {
    title: 'Fuel Sold Today',
    icon: Fuel,
    metric: '0 gal',
    subtitle: '$0.00 revenue',
    accent: false,
  },
  {
    title: 'New Leads From Website',
    icon: UserPlus,
    metric: '0',
    subtitle: '0 leads this week',
    accent: false,
  },
  {
    title: 'ACH Returns Requiring Action',
    icon: AlertTriangle,
    metric: '0',
    subtitle: 'No unresolved returns',
    accent: false,
  },
  {
    title: 'Compliance Expirations This Week',
    icon: ShieldAlert,
    metric: '0',
    subtitle: 'All compliant',
    accent: false,
  },
];

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
};

export default function Dashboard() {
  return (
    <div>
      <div style={styles.header}>
        <h1 style={styles.title}>Dashboard</h1>
        <div style={styles.divider} />
        <p style={styles.subtitle}>
          Monday morning overview — key metrics at a glance.
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
