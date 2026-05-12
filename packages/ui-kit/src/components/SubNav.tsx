import React from 'react';
import { Link, useLocation } from 'react-router-dom';

export interface SubNavItem {
  path: string;
  label: string;
}

export interface SubNavProps {
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

export const SubNav: React.FC<SubNavProps> = ({ items }) => {
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
};

SubNav.displayName = 'SubNav';

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

export const SETTINGS_SUBNAV: SubNavItem[] = [
  { path: '/settings/profile', label: 'Marina Profile' },
  { path: '/settings/locations', label: 'Locations' },
  { path: '/settings/branding', label: 'Branding' },
  { path: '/settings/team', label: 'Team' },
  { path: '/settings/roles', label: 'Roles' },
  { path: '/settings/billing', label: 'Subscription' },
  { path: '/settings/payment-terms', label: 'Payment Terms' },
  { path: '/settings/tax', label: 'Tax Jurisdictions' },
  { path: '/settings/tax-rates', label: 'Tax Rates' },
  { path: '/settings/categories', label: 'Categories' },
  { path: '/settings/products', label: 'Catalog' },
  { path: '/settings/pos-discounts', label: 'POS Discounts' },
  { path: '/settings/quickbooks', label: 'QuickBooks' },
  { path: '/settings/terminal', label: 'Terminal' },
  { path: '/settings/modules', label: 'Modules' },
  { path: '/settings/email', label: 'Email' },
  { path: '/settings/advanced', label: 'Advanced' },
  { path: '/settings/audit', label: 'Audit Log' },
];

// Settings IA — five sections, each with its own leaves. Two-level nav
// (sections at the top, leaves underneath) is rendered by SettingsLayout
// in the web app. Every leaf has a real URL at /settings/<section>/<leaf>;
// bare /settings redirects to /settings/marina/profile.
export interface SettingsLeaf {
  path: string;
  label: string;
}
export interface SettingsSection {
  key: string;
  label: string;
  /** Default route for the section — usually the first leaf. */
  path: string;
  leaves: SettingsLeaf[];
}
export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    key: 'marina',
    label: 'Marina',
    path: '/settings/marina/profile',
    leaves: [
      { path: '/settings/marina/profile', label: 'Profile' },
      { path: '/settings/marina/branding', label: 'Branding' },
      { path: '/settings/marina/domain', label: 'Custom Domain' },
    ],
  },
  {
    key: 'team',
    label: 'Team',
    path: '/settings/team/members',
    leaves: [
      { path: '/settings/team/members', label: 'Members' },
      { path: '/settings/team/roles', label: 'Roles' },
      { path: '/settings/team/api-keys', label: 'API Keys' },
      { path: '/settings/team/audit', label: 'Audit Log' },
    ],
  },
  {
    key: 'payments',
    label: 'Pricing & Payments',
    path: '/settings/payments/terms',
    leaves: [
      { path: '/settings/payments/terms', label: 'Payment Terms' },
      { path: '/settings/payments/stripe', label: 'Stripe Connect' },
      { path: '/settings/payments/tax', label: 'Tax' },
      { path: '/settings/payments/card-readers', label: 'Card Readers' },
      { path: '/settings/payments/discounts', label: 'Discounts' },
      { path: '/settings/payments/subscription', label: 'Subscription' },
    ],
  },
  {
    key: 'catalog',
    label: 'Catalog',
    path: '/settings/catalog/products',
    leaves: [
      { path: '/settings/catalog/products', label: 'Products & Rates' },
      { path: '/settings/catalog/categories', label: 'Categories' },
      { path: '/settings/catalog/modules', label: 'Modules' },
    ],
  },
  {
    key: 'integrations',
    label: 'Integrations',
    path: '/settings/integrations/quickbooks',
    leaves: [
      { path: '/settings/integrations/quickbooks', label: 'QuickBooks' },
      { path: '/settings/integrations/email', label: 'Email Sender' },
      { path: '/settings/integrations/api', label: 'Webhooks & API' },
    ],
  },
];
