import {
  Building2,
  Palette,
  CreditCard,
  Link,
  BookOpen,
  ShieldCheck,
} from 'lucide-react';

const settingCards: { icon: typeof Building2; title: string; description: string }[] = [
  {
    icon: Building2,
    title: 'Marina Profile',
    description: 'Update your marina name, address, contact info, and operating hours.',
  },
  {
    icon: Palette,
    title: 'Branding',
    description: 'Customize your logo, brand colors, and customer-facing appearance.',
  },
  {
    icon: CreditCard,
    title: 'Billing Configuration',
    description: 'Set default payment terms, tax rates, and invoice templates.',
  },
  {
    icon: Link,
    title: 'Stripe Connect',
    description: 'Connect your Stripe account to accept payments and process payouts.',
  },
  {
    icon: BookOpen,
    title: 'QuickBooks Online',
    description: 'Sync invoices, payments, and customer data with QuickBooks.',
  },
  {
    icon: ShieldCheck,
    title: 'Team & Roles',
    description: 'Manage staff accounts, permissions, and role-based access controls.',
  },
];

const styles: Record<string, React.CSSProperties> = {
  page: { padding: '32px' },
  title: {
    fontSize: '36px',
    fontWeight: 700,
    color: '#0A2342',
    letterSpacing: '-0.02em',
    margin: 0,
  },
  divider: {
    height: '4px',
    background: 'linear-gradient(90deg, #00D4FF, transparent)',
    border: 'none',
    marginTop: '12px',
    marginBottom: '40px',
    borderRadius: '2px',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
    gap: '24px',
  },
  card: {
    background: '#FFFFFF',
    border: '1px solid #E2E8F0',
    borderRadius: '8px',
    padding: '24px',
  },
  cardIcon: {
    color: '#2E4A6B',
    marginBottom: '12px',
  },
  cardTitle: {
    fontSize: '17px',
    fontWeight: 600,
    color: '#0A2342',
    margin: '0 0 6px 0',
  },
  cardDescription: {
    fontSize: '14px',
    color: '#64748B',
    lineHeight: 1.5,
    margin: 0,
  },
};

export default function Settings() {
  return (
    <div style={styles.page}>
      <h1 style={styles.title}>Settings</h1>
      <hr style={styles.divider} />
      <div style={styles.grid}>
        {settingCards.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.title} style={styles.card}>
              <div style={styles.cardIcon}>
                <Icon size={32} />
              </div>
              <h3 style={styles.cardTitle}>{card.title}</h3>
              <p style={styles.cardDescription}>{card.description}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
