/** Physical availability status of a slip. */
export enum SlipStatus {
  AVAILABLE = 'AVAILABLE',
  OCCUPIED = 'OCCUPIED',
  MAINTENANCE = 'MAINTENANCE',
  RESERVED = 'RESERVED',
  BLOCKED = 'BLOCKED',
}

/** How electricity is metered and billed for a slip. */
export enum ElectricityMode {
  FLAT = 'FLAT',
  METERED = 'METERED',
  INCLUDED = 'INCLUDED',
  NONE = 'NONE',
}

/** Status of a slip lease/contract. */
export enum ContractStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  EXPIRED = 'EXPIRED',
  TERMINATED = 'TERMINATED',
  PENDING_RENEWAL = 'PENDING_RENEWAL',
}

/** Billing frequency for a slip contract. */
export enum BillingCycle {
  MONTHLY = 'MONTHLY',
  QUARTERLY = 'QUARTERLY',
  SEMI_ANNUAL = 'SEMI_ANNUAL',
  ANNUAL = 'ANNUAL',
}

/** A physical slip (berth) in the marina. */
export interface Slip {
  /** Unique identifier. */
  id: string;
  /** Tenant this slip belongs to. */
  tenantId: string;
  /** Dock or pier identifier (e.g. "A", "B", "North Pier"). */
  dock: string;
  /** Slip number or label within the dock (e.g. "12", "A-14"). */
  slipNumber: string;
  /** Length of the slip in feet. */
  lengthFt: number;
  /** Width (beam) of the slip in feet. */
  widthFt: number;
  /** Maximum draft depth in feet. */
  maxDraftFt: number | null;
  /** Whether the slip has water hookup. */
  hasWater: boolean;
  /** Whether the slip has electrical hookup. */
  hasElectric: boolean;
  /** Amperage of the electrical service (e.g. 30, 50, 100). */
  amperage: number | null;
  /** How electricity is metered/billed. */
  electricityMode: ElectricityMode;
  /** Whether the slip is in a covered (roofed) area. */
  isCovered: boolean;
  /** Whether the slip is an end-cap (wider access). */
  isEndCap: boolean;
  /** GPS latitude coordinate. */
  latitude: number | null;
  /** GPS longitude coordinate. */
  longitude: number | null;
  /** Base monthly rate in cents. */
  baseRateCents: number;
  /** Current availability status. */
  status: SlipStatus;
  /** Free-form notes about the slip. */
  notes: string | null;
  /** ISO timestamp of creation. */
  createdAt: string;
  /** ISO timestamp of last update. */
  updatedAt: string;
}

/** A lease/contract binding a customer to a slip for a period. */
export interface SlipContract {
  /** Unique identifier. */
  id: string;
  /** Tenant context. */
  tenantId: string;
  /** The slip being leased. */
  slipId: string;
  /** The customer leasing the slip. */
  customerId: string;
  /** Contract start date (ISO date string). */
  startDate: string;
  /** Contract end date (ISO date string). */
  endDate: string;
  /** Monthly rate in cents for this contract. */
  monthlyRateCents: number;
  /** Billing frequency. */
  billingCycle: BillingCycle;
  /** Security deposit amount in cents. */
  depositCents: number;
  /** Current contract status. */
  status: ContractStatus;
  /** Whether the contract auto-renews at expiration. */
  autoRenew: boolean;
  /** Number of days notice required before termination. */
  terminationNoticeDays: number;
  /** Early termination fee in cents (charged if contract broken early). */
  earlyTerminationFeeCents: number;
  /** Percentage of remaining contract value charged on early termination. */
  earlyTerminationPenaltyPct: number | null;
  /** Free-form terms and conditions text. */
  terms: string | null;
  /** ID of the signed document/attachment, if any. */
  signedDocumentId: string | null;
  /** ISO timestamp of creation. */
  createdAt: string;
  /** ISO timestamp of last update. */
  updatedAt: string;
}

/** An electrical meter reading for a metered slip. */
export interface MeterReading {
  /** Unique identifier. */
  id: string;
  /** Tenant context. */
  tenantId: string;
  /** The slip whose meter was read. */
  slipId: string;
  /** Meter reading value in kWh. */
  readingKwh: number;
  /** ISO timestamp of when the reading was taken. */
  readAt: string;
  /** User ID of the staff member who took the reading. */
  readBy: string;
  /** Optional photo or attachment ID for verification. */
  photoId: string | null;
  /** ISO timestamp of record creation. */
  createdAt: string;
}

/** A batch operation for renewing multiple contracts at once. */
export interface RenewalBatch {
  /** Unique identifier. */
  id: string;
  /** Tenant context. */
  tenantId: string;
  /** User ID of the staff member who initiated the batch. */
  initiatedBy: string;
  /** List of contract IDs included in this renewal batch. */
  contractIds: string[];
  /** Percentage rate increase to apply (e.g. 3.5 = 3.5%). */
  rateIncreasePct: number;
  /** New billing cycle to apply, or null to keep existing. */
  newBillingCycle: BillingCycle | null;
  /** Number of contracts successfully renewed. */
  processedCount: number;
  /** Number of contracts that failed to renew. */
  failedCount: number;
  /** Whether the batch has completed processing. */
  completed: boolean;
  /** ISO timestamp of creation. */
  createdAt: string;
  /** ISO timestamp of completion, if applicable. */
  completedAt: string | null;
}
