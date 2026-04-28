/** Stage of a lead in the sales pipeline. */
export enum LeadStage {
  NEW = 'NEW',
  CONTACTED = 'CONTACTED',
  QUALIFIED = 'QUALIFIED',
  PROPOSAL_SENT = 'PROPOSAL_SENT',
  NEGOTIATION = 'NEGOTIATION',
  WON = 'WON',
  LOST = 'LOST',
}

/** Where a lead came from. Mirrors the Prisma `LeadSource` enum. */
export enum LeadSource {
  WEBSITE = 'WEBSITE',
  REFERRAL = 'REFERRAL',
  WALK_IN = 'WALK_IN',
  PHONE = 'PHONE',
  SOCIAL_MEDIA = 'SOCIAL_MEDIA',
  EMAIL = 'EMAIL',
  OTHER = 'OTHER',
}

/** Human-readable labels for `LeadSource` enum values. */
export const LEAD_SOURCE_LABELS: Record<LeadSource, string> = {
  [LeadSource.WEBSITE]: 'Website',
  [LeadSource.REFERRAL]: 'Referral',
  [LeadSource.WALK_IN]: 'Walk-in',
  [LeadSource.PHONE]: 'Phone call',
  [LeadSource.SOCIAL_MEDIA]: 'Social media',
  [LeadSource.EMAIL]: 'Email',
  [LeadSource.OTHER]: 'Other',
};

/** A prospective customer / sales lead. */
export interface Lead {
  id: string;
  tenantId: string;
  /** First name. */
  firstName: string;
  /** Last name. */
  lastName: string;
  /** Email address. */
  email: string;
  /** Phone number. */
  phone: string | null;
  /** Current stage in the pipeline. */
  stage: LeadStage;
  /** How the lead was acquired (e.g. "WEBSITE", "REFERRAL", "WALK_IN"). */
  source: string;
  /** The referral partner who sent this lead, if applicable. */
  referralPartnerId: string | null;
  /** ID of the lead form submission that created this lead. */
  leadFormId: string | null;
  /** Desired slip length in feet. */
  desiredLengthFt: number | null;
  /** Desired slip width / beam in feet. */
  desiredWidthFt: number | null;
  /** Notes and comments about the lead. */
  notes: string | null;
  /** Staff member assigned to this lead. */
  assignedTo: string | null;
  /** Estimated monthly value in cents. */
  estimatedValueCents: number | null;
  /** Timestamp when the lead was converted to a customer. */
  convertedAt: string | null;
  /** Customer ID after conversion. */
  convertedCustomerId: string | null;
  /** Reason the lead was lost, if applicable. */
  lostReason: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A configurable lead capture form. */
export interface LeadForm {
  id: string;
  tenantId: string;
  /** Form name / title. */
  name: string;
  /** Description shown to visitors. */
  description: string | null;
  /** JSON schema defining the form fields. */
  fieldsJson: Record<string, unknown>;
  /** Whether the form is currently accepting submissions. */
  active: boolean;
  /** URL slug for the public form page. */
  slug: string;
  /** Redirect URL after form submission. */
  redirectUrl: string | null;
  /** Email addresses to notify on submission. */
  notifyEmails: string[];
  /** Number of submissions received. */
  submissionCount: number;
  createdAt: string;
  updatedAt: string;
}

/** An entry on the marina waitlist. */
export interface WaitlistEntry {
  id: string;
  tenantId: string;
  /** Customer on the waitlist (null if from a lead). */
  customerId: string | null;
  /** Lead on the waitlist (null if existing customer). */
  leadId: string | null;
  /** Contact name (denormalized for display). */
  contactName: string;
  /** Contact email. */
  contactEmail: string;
  /** Contact phone. */
  contactPhone: string | null;
  /** Desired slip length in feet. */
  desiredLengthFt: number;
  /** Desired slip width / beam in feet. */
  desiredWidthFt: number | null;
  /** Position on the waitlist. */
  position: number;
  /** Current status. */
  status: 'WAITING' | 'OFFERED' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED' | 'CANCELLED';
  /** Date added to the waitlist (ISO date string). */
  addedDate: string;
  /** Timestamp when an offer was made. */
  offeredAt: string | null;
  /** Timestamp when the offer expires. */
  offerExpiresAt: string | null;
  /** Notes about the waitlist entry. */
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A referral partner who sends leads to the marina. */
export interface ReferralPartner {
  id: string;
  tenantId: string;
  /** Partner name or company. */
  name: string;
  /** Contact email. */
  email: string;
  /** Contact phone. */
  phone: string | null;
  /** Commission rate as a decimal (e.g. 0.10 = 10%). */
  commissionRate: number;
  /** Unique referral code used for tracking. */
  referralCode: string;
  /** Total number of leads generated. */
  totalLeads: number;
  /** Total number of leads converted to customers. */
  convertedLeads: number;
  /** Total commission earned in cents. */
  totalCommissionCents: number;
  /** Whether the partner is currently active. */
  active: boolean;
  createdAt: string;
  updatedAt: string;
}
