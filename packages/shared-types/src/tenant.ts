/** Status of a tenant account in the Helm platform. */
export enum TenantStatus {
  ACTIVE = 'ACTIVE',
  GRACE_PERIOD = 'GRACE_PERIOD',
  LOCKED = 'LOCKED',
}

/** SaaS pricing tier defining fees and limits for a tenant. */
export interface SaasTier {
  /** Unique identifier. */
  id: string;
  /** Human-readable tier name (e.g. "Starter", "Pro", "Enterprise"). */
  name: string;
  /** Fixed monthly platform fee in cents. */
  monthlyFeeCents: number;
  /** Additional monthly fee per marina location in cents. */
  perLocationFeeCents: number;
  /** ACH payment processing fee rate (decimal, e.g. 0.005 = 0.5%). */
  achFeeRate: number;
  /** Card payment processing fee rate (decimal, e.g. 0.029 = 2.9%). */
  cardFeeRate: number;
  /** Cloud storage limit in gigabytes for document uploads. */
  storageLimitGb: number;
}

/** Branding configuration for a tenant's marina. */
export interface TenantBranding {
  /** URL or path to the marina logo image. */
  logo: string;
  /** Primary brand color as a hex string (e.g. "#0066CC"). */
  primaryColor: string;
  /** Display name of the marina. */
  marinaName: string;
  /** Physical address of the marina. */
  address: string;
  /** Contact phone number. */
  phone: string;
  /** Contact email address. */
  email: string;
  /** Website URL. */
  website: string;
}

/** Core tenant record representing a marina organization on the platform. */
export interface Tenant {
  /** Unique identifier. */
  id: string;
  /** Legal or display name of the marina business. */
  name: string;
  /** Subdomain for tenant access (e.g. "harbor-bay" => harbor-bay.helmapp.com). */
  subdomain: string;
  /** Optional custom domain (e.g. "portal.harborbaymarina.com"). */
  customDomain: string | null;
  /** JSON blob for branding configuration. */
  brandingJson: {
    logo: string;
    primaryColor: string;
    marinaName: string;
  };
  /** JSON blob for invoice template customization. */
  invoiceTemplateJson: Record<string, unknown>;
  /** Stripe Connect account ID for payment processing. */
  stripeAccountId: string | null;
  /** QuickBooks Online realm ID for accounting sync. */
  qboRealmId: string | null;
  /** IANA timezone string (e.g. "America/New_York"). */
  timezone: string;
  /** Fiscal year end as MM-DD string (e.g. "12-31"). */
  fiscalYearEnd: string;
  /** Foreign key to the SaaS pricing tier. */
  saasTierId: string;
  /** Current tenant account status. */
  status: TenantStatus;
  /** ISO timestamp when the grace period began, if applicable. */
  gracePeriodStartedAt: string | null;
  /** ISO timestamp when the account was locked, if applicable. */
  lockedAt: string | null;
}
