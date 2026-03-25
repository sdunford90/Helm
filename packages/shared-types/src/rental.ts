/** Status of a reservation. */
export enum ReservationStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  CHECKED_IN = 'CHECKED_IN',
  CHECKED_OUT = 'CHECKED_OUT',
  CANCELLED = 'CANCELLED',
  NO_SHOW = 'NO_SHOW',
}

/** Type of pricing rule logic. */
export enum PricingRuleType {
  FLAT = 'FLAT',
  PER_FOOT = 'PER_FOOT',
  TIERED = 'TIERED',
  SEASONAL = 'SEASONAL',
  DEMAND = 'DEMAND',
}

/** Status of an algorithmic pricing suggestion. */
export enum SuggestionStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
}

/** A rentable product or service (e.g. kayak, paddleboard, jet ski, storage unit). */
export interface RentalProduct {
  /** Unique identifier. */
  id: string;
  /** Tenant context. */
  tenantId: string;
  /** Product name. */
  name: string;
  /** Description. */
  description: string | null;
  /** Category (e.g. "watercraft", "storage", "equipment"). */
  category: string;
  /** Hourly rate in cents. */
  hourlyRateCents: number | null;
  /** Daily rate in cents. */
  dailyRateCents: number | null;
  /** Weekly rate in cents. */
  weeklyRateCents: number | null;
  /** Total inventory count. */
  totalQuantity: number;
  /** Currently available quantity. */
  availableQuantity: number;
  /** Whether this product is currently offered. */
  isActive: boolean;
  /** ISO timestamp of creation. */
  createdAt: string;
  /** ISO timestamp of last update. */
  updatedAt: string;
}

/** A pricing rule that determines how a slip or product is priced. */
export interface PricingRule {
  /** Unique identifier. */
  id: string;
  /** Tenant context. */
  tenantId: string;
  /** Human-readable rule name. */
  name: string;
  /** Type of pricing logic. */
  type: PricingRuleType;
  /** Base rate in cents (interpretation depends on type). */
  baseRateCents: number;
  /** Per-foot rate in cents, for PER_FOOT type. */
  perFootCents: number | null;
  /** Tier breakpoints and rates (JSON), for TIERED type. */
  tiersJson: Record<string, unknown>[] | null;
  /** Season start (MM-DD), for SEASONAL type. */
  seasonStart: string | null;
  /** Season end (MM-DD), for SEASONAL type. */
  seasonEnd: string | null;
  /** Multiplier applied during the season (e.g. 1.25 = 25% premium). */
  seasonMultiplier: number | null;
  /** Priority order when multiple rules match (lower = higher priority). */
  priority: number;
  /** Whether this rule is currently active. */
  isActive: boolean;
  /** ISO timestamp of creation. */
  createdAt: string;
  /** ISO timestamp of last update. */
  updatedAt: string;
}

/** A calendar date override for pricing (e.g. holiday surcharge). */
export interface PricingCalendarOverride {
  /** Unique identifier. */
  id: string;
  /** Tenant context. */
  tenantId: string;
  /** Start date of the override period (ISO date string). */
  startDate: string;
  /** End date of the override period (ISO date string). */
  endDate: string;
  /** Price multiplier to apply (e.g. 1.5 = 50% surcharge). */
  multiplier: number;
  /** Human-readable label (e.g. "Fourth of July Weekend"). */
  label: string;
  /** ISO timestamp of creation. */
  createdAt: string;
}

/** A demand-based surge pricing tier. */
export interface DemandSurgeTier {
  /** Unique identifier. */
  id: string;
  /** Tenant context. */
  tenantId: string;
  /** Occupancy threshold percentage to trigger this tier (e.g. 80 = 80%). */
  occupancyThresholdPct: number;
  /** Price multiplier when this tier is active. */
  multiplier: number;
  /** Whether this tier is currently enabled. */
  isActive: boolean;
  /** ISO timestamp of creation. */
  createdAt: string;
}

/** An AI/algorithm-generated pricing suggestion for review. */
export interface AlgorithmicSuggestion {
  /** Unique identifier. */
  id: string;
  /** Tenant context. */
  tenantId: string;
  /** The pricing rule this suggestion applies to. */
  pricingRuleId: string | null;
  /** The slip this suggestion applies to, if slip-specific. */
  slipId: string | null;
  /** Current rate in cents. */
  currentRateCents: number;
  /** Suggested new rate in cents. */
  suggestedRateCents: number;
  /** Reasoning / explanation for the suggestion. */
  reasoning: string;
  /** Confidence score (0.0 - 1.0). */
  confidence: number;
  /** Current suggestion status. */
  status: SuggestionStatus;
  /** User ID of the staff member who reviewed, if applicable. */
  reviewedBy: string | null;
  /** ISO timestamp of when it was reviewed, if applicable. */
  reviewedAt: string | null;
  /** ISO timestamp of creation. */
  createdAt: string;
  /** ISO timestamp when the suggestion expires. */
  expiresAt: string;
}

/** A reservation for a slip or rental product. */
export interface Reservation {
  /** Unique identifier. */
  id: string;
  /** Tenant context. */
  tenantId: string;
  /** Customer making the reservation. */
  customerId: string;
  /** Slip reserved, if this is a slip reservation. */
  slipId: string | null;
  /** Rental product reserved, if this is a product reservation. */
  rentalProductId: string | null;
  /** Reservation start date/time (ISO timestamp). */
  startDate: string;
  /** Reservation end date/time (ISO timestamp). */
  endDate: string;
  /** Current reservation status. */
  status: ReservationStatus;
  /** Total price in cents. */
  totalCents: number;
  /** Deposit amount in cents. */
  depositCents: number;
  /** Whether the deposit has been paid. */
  depositPaid: boolean;
  /** Cancellation policy ID applied to this reservation. */
  cancellationPolicyId: string | null;
  /** Special requests or notes from the customer. */
  notes: string | null;
  /** ISO timestamp of creation. */
  createdAt: string;
  /** ISO timestamp of last update. */
  updatedAt: string;
}

/** A rule within a cancellation policy defining refund percentages by timing. */
export interface CancellationRule {
  /** Minimum hours before start to qualify for this refund level. */
  hoursBeforeStart: number;
  /** Refund percentage (0-100). */
  refundPct: number;
}

/** A cancellation policy defining refund rules for reservations. */
export interface CancellationPolicy {
  /** Unique identifier. */
  id: string;
  /** Tenant context. */
  tenantId: string;
  /** Policy name (e.g. "Standard", "Strict", "Flexible"). */
  name: string;
  /** Description of the policy. */
  description: string | null;
  /** Ordered list of cancellation rules (most generous first). */
  rules: CancellationRule[];
  /** Whether this is the default policy for new reservations. */
  isDefault: boolean;
  /** ISO timestamp of creation. */
  createdAt: string;
  /** ISO timestamp of last update. */
  updatedAt: string;
}
