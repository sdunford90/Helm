/** Type of ramp ticket. */
export enum RampTicketType {
  SINGLE_LAUNCH = 'SINGLE_LAUNCH',
  DAILY_PASS = 'DAILY_PASS',
  ANNUAL_PASS = 'ANNUAL_PASS',
  SEASONAL_PASS = 'SEASONAL_PASS',
}

/** A boat ramp usage ticket. */
export interface RampTicket {
  id: string;
  tenantId: string;
  /** Customer who purchased the ticket (null for walk-up). */
  customerId: string | null;
  /** Ticket type. */
  type: RampTicketType;
  /** Ticket / pass number. */
  ticketNumber: string;
  /** Vehicle license plate number. */
  licensePlate: string | null;
  /** Trailer license plate number. */
  trailerPlate: string | null;
  /** Vessel description (for walk-ups without a boat record). */
  vesselDescription: string | null;
  /** Associated boat record, if applicable. */
  boatId: string | null;
  /** Fee charged in cents. */
  feeCents: number;
  /** Whether the fee has been paid. */
  paid: boolean;
  /** Payment method used. */
  paymentMethod: 'CASH' | 'CARD' | 'CHARGE_TO_ACCOUNT' | null;
  /** Valid from date/time (ISO string). */
  validFrom: string;
  /** Valid until date/time (ISO string). */
  validUntil: string;
  /** Timestamp when the vessel was launched. */
  launchedAt: string | null;
  /** Timestamp when the vessel was retrieved. */
  retrievedAt: string | null;
  /** Notes. */
  notes: string | null;
  createdAt: string;
}
