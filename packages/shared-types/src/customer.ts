/** Status of a customer account. */
export enum CustomerStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  SUSPENDED = 'SUSPENDED',
  ARCHIVED = 'ARCHIVED',
}

/** Emergency contact information for a customer. */
export interface EmergencyContact {
  /** Contact person's full name. */
  name: string;
  /** Relationship to the customer (e.g. "Spouse", "Parent"). */
  relationship: string;
  /** Primary phone number. */
  phone: string;
  /** Optional email address. */
  email: string | null;
}

/** A marina customer (boat owner / slip renter). */
export interface Customer {
  /** Unique identifier. */
  id: string;
  /** Tenant this customer belongs to. */
  tenantId: string;
  /** First name. */
  firstName: string;
  /** Last name. */
  lastName: string;
  /** Primary email address. */
  email: string;
  /** Primary phone number. */
  phone: string | null;
  /** Secondary / alternate phone number. */
  secondaryPhone: string | null;
  /** Mailing address line 1. */
  addressLine1: string | null;
  /** Mailing address line 2. */
  addressLine2: string | null;
  /** City. */
  city: string | null;
  /** State or province. */
  state: string | null;
  /** ZIP or postal code. */
  zip: string | null;
  /** Country code (ISO 3166-1 alpha-2). */
  country: string | null;
  /** Emergency contact information (JSON). */
  emergencyContact: EmergencyContact | null;
  /** Whether the customer is tax exempt. */
  taxExempt: boolean;
  /** Tax exemption certificate number, if tax exempt. */
  taxExemptCertificate: string | null;
  /** Whether ACH payments are blocked for this customer. */
  achBlocked: boolean;
  /** Stripe customer ID for payment processing. */
  stripeCustomerId: string | null;
  /** QuickBooks Online customer ID for accounting sync. */
  qboCustomerId: string | null;
  /** How the customer was acquired (e.g. "website", "referral", "walk-in"). */
  leadSource: string | null;
  /** Current account status. */
  status: CustomerStatus;
  /** Optional notes or comments. */
  notes: string | null;
  /** ISO timestamp of account creation. */
  createdAt: string;
  /** ISO timestamp of last update. */
  updatedAt: string;
}

/** Request to merge two duplicate customer records. */
export interface CustomerMergeRequest {
  /** Unique identifier for the merge request. */
  id: string;
  /** Tenant context. */
  tenantId: string;
  /** The customer ID that will survive the merge (primary). */
  primaryCustomerId: string;
  /** The customer ID that will be absorbed and archived. */
  secondaryCustomerId: string;
  /** User ID of the staff member who initiated the merge. */
  requestedBy: string;
  /** Field-level resolution map specifying which source wins per field. */
  fieldResolutions: Record<string, 'primary' | 'secondary'>;
  /** Whether the merge has been executed. */
  executed: boolean;
  /** ISO timestamp of when the merge was executed, if applicable. */
  executedAt: string | null;
  /** ISO timestamp of request creation. */
  createdAt: string;
}
