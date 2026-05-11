import { Link, useLocation } from 'react-router-dom';

export interface SubNavItem {
  path: string;
  label: string;
}

interface Props {
  items: SubNavItem[];
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    display: 'flex',
    gap: 0,
    borderBottom: '1px solid #E2E8F0',
    marginBottom: '24px',
    flexWrap: 'wrap',
  },
  link: {
    padding: '10px 18px',
    fontSize: '14px',
    fontWeight: 600,
    color: '#64748B',
    textDecoration: 'none',
    borderBottom: '2px solid transparent',
    marginBottom: '-1px',
    transition: 'color 0.15s, border-color 0.15s',
    whiteSpace: 'nowrap',
  },
  linkActive: {
    color: '#0A2342',
    borderBottomColor: 'var(--brand-secondary, #00D4FF)',
  },
};

export default function SubNav({ items }: Props) {
  const { pathname } = useLocation();

  // Pick the most specific (longest) match so e.g. /billing/ar-aging
  // highlights "A/R Aging" instead of the parent "Invoices" (/billing).
  let bestLen = -1;
  let activePath = '';
  for (const item of items) {
    if (pathname === item.path || pathname.startsWith(item.path + '/')) {
      if (item.path.length > bestLen) {
        bestLen = item.path.length;
        activePath = item.path;
      }
    }
  }

  return (
    <nav style={styles.bar}>
      {items.map((item) => {
        const active = item.path === activePath;
        return (
          <Link
            key={item.path}
            to={item.path}
            style={{ ...styles.link, ...(active ? styles.linkActive : {}) }}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export const BILLING_SUBNAV: SubNavItem[] = [
  { path: '/billing', label: 'Invoices' },
  { path: '/billing/ar-aging', label: 'A/R Aging' },
  { path: '/billing/disputes', label: 'Disputes' },
  { path: '/billing/chart-of-accounts', label: 'Chart of Accounts' },
  { path: '/billing/deferred-revenue', label: 'Deferred Revenue' },
  { path: '/billing/rent-roll', label: 'Rent Roll' },
];

export const ACCOUNTING_SUBNAV: SubNavItem[] = [
  { path: '/accounting', label: 'Overview' },
  { path: '/accounting/setup', label: 'Setup' },
  { path: '/accounting/periods', label: 'Periods' },
  { path: '/accounting/sync-health', label: 'Sync Health' },
  { path: '/accounting/reconciliation', label: 'Reconciliation' },
  { path: '/accounting/change-log', label: 'Change Log' },
];

export const INSIGHTS_SUBNAV: SubNavItem[] = [
  { path: '/insights', label: 'Overview' },
  { path: '/insights/operations', label: 'Operations' },
  { path: '/insights/financial', label: 'Financial' },
  { path: '/insights/customers', label: 'Customers & CRM' },
  { path: '/insights/communications', label: 'Communications' },
  { path: '/insights/compliance', label: 'Compliance & Audit' },
  { path: '/insights/scheduled', label: 'Scheduled & Saved' },
  { path: '/insights/custom-builder', label: 'Custom Builder' },
];
