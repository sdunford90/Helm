/** Status of a transient (short-term / guest) booking. */
export enum TransientStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  CHECKED_IN = 'CHECKED_IN',
  CHECKED_OUT = 'CHECKED_OUT',
  CANCELLED = 'CANCELLED',
  NO_SHOW = 'NO_SHOW',
}

/** A transient (short-term / guest) slip booking. */
export interface TransientBooking {
  id: string;
  tenantId: string;
  /** Guest customer ID. */
  customerId: string;
  /** Slip assigned for the stay. */
  slipId: string;
  /** Vessel using the slip. */
  boatId: string | null;
  /** Current booking status. */
  status: TransientStatus;
  /** Arrival date/time (ISO string). */
  arrivalDate: string;
  /** Departure date/time (ISO string). */
  departureDate: string;
  /** Number of nights. */
  nights: number;
  /** Vessel length in feet (for pricing if no boat record). */
  vesselLengthFt: number;
  /** Nightly rate in cents. */
  nightlyRateCents: number;
  /** Total charge in cents. */
  totalCents: number;
  /** Electric hookup fee in cents. */
  electricFeeCents: number;
  /** Water hookup fee in cents. */
  waterFeeCents: number;
  /** Whether the guest has paid. */
  paid: boolean;
  /** Invoice ID for this booking. */
  invoiceId: string | null;
  /** Source of the booking (e.g. "WEBSITE", "PHONE", "WALK_IN", "DOCKWA"). */
  source: string;
  /** Guest notes or special requests. */
  guestNotes: string | null;
  /** Internal staff notes. */
  staffNotes: string | null;
  /** Actual check-in timestamp. */
  checkedInAt: string | null;
  /** Actual check-out timestamp. */
  checkedOutAt: string | null;
  createdAt: string;
  updatedAt: string;
}
