/** Status of an invoice. */
export enum InvoiceStatus {
  DRAFT = 'DRAFT',
  SENT = 'SENT',
  VIEWED = 'VIEWED',
  PARTIAL = 'PARTIAL',
  PAID = 'PAID',
  OVERDUE = 'OVERDUE',
  VOID = 'VOID',
  WRITTEN_OFF = 'WRITTEN_OFF',
}

/** Method used for a payment. */
export enum PaymentMethod {
  ACH = 'ACH',
  CARD = 'CARD',
  CASH = 'CASH',
  CHECK = 'CHECK',
  WIRE = 'WIRE',
  CREDIT = 'CREDIT',
  OTHER = 'OTHER',
}

/** Status of a payment transaction. */
export enum PaymentStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
  REFUNDED = 'REFUNDED',
  PARTIALLY_REFUNDED = 'PARTIALLY_REFUNDED',
  DISPUTED = 'DISPUTED',
}

/** A single line item on an invoice. */
export interface InvoiceLineItem {
  /** Unique identifier. */
  id: string;
  /** Parent invoice ID. */
  invoiceId: string;
  /** Description of the charge. */
  description: string;
  /** Quantity (e.g. number of months, kWh, items). */
  quantity: number;
  /** Unit price in cents. */
  unitPriceCents: number;
  /** Total amount in cents (quantity * unitPriceCents). */
  totalCents: number;
  /** GL account ID for revenue classification. */
  glAccountId: string | null;
  /** Tax rate applied to this line item (decimal, e.g. 0.07 = 7%). */
  taxRate: number;
  /** Tax amount in cents. */
  taxAmountCents: number;
  /** Sort order for display. */
  sortOrder: number;
}

/** An invoice issued to a customer. */
export interface Invoice {
  /** Unique identifier. */
  id: string;
  /** Tenant context. */
  tenantId: string;
  /** Customer being billed. */
  customerId: string;
  /** Human-readable invoice number (e.g. "INV-2026-0042"). */
  invoiceNumber: string;
  /** Current invoice status. */
  status: InvoiceStatus;
  /** Date the invoice was issued (ISO date string). */
  issueDate: string;
  /** Date the invoice is due (ISO date string). */
  dueDate: string;
  /** Line items on this invoice. */
  lineItems: InvoiceLineItem[];
  /** Subtotal before tax in cents. */
  subtotalCents: number;
  /** Total tax in cents. */
  taxTotalCents: number;
  /** Grand total in cents (subtotal + tax). */
  totalCents: number;
  /** Amount paid so far in cents. */
  paidCents: number;
  /** Remaining balance in cents (total - paid). */
  balanceDueCents: number;
  /** Optional memo or notes on the invoice. */
  memo: string | null;
  /** Related contract ID, if this invoice is contract-based. */
  contractId: string | null;
  /** QuickBooks Online invoice ID for accounting sync. */
  qboInvoiceId: string | null;
  /** Stripe invoice ID, if created via Stripe. */
  stripeInvoiceId: string | null;
  /** ISO timestamp of creation. */
  createdAt: string;
  /** ISO timestamp of last update. */
  updatedAt: string;
}

/** A payment received against one or more invoices. */
export interface Payment {
  /** Unique identifier. */
  id: string;
  /** Tenant context. */
  tenantId: string;
  /** Customer who made the payment. */
  customerId: string;
  /** Invoice this payment applies to, if applicable. */
  invoiceId: string | null;
  /** Amount in cents. */
  amountCents: number;
  /** Payment method used. */
  method: PaymentMethod;
  /** Current payment status. */
  status: PaymentStatus;
  /** Stripe payment intent ID, if processed via Stripe. */
  stripePaymentIntentId: string | null;
  /** Reference number (check number, wire ref, etc.). */
  referenceNumber: string | null;
  /** QuickBooks Online payment ID for accounting sync. */
  qboPaymentId: string | null;
  /** Optional memo. */
  memo: string | null;
  /** ISO timestamp of when the payment was received. */
  receivedAt: string;
  /** ISO timestamp of creation. */
  createdAt: string;
}

/** An ACH return event (e.g. insufficient funds, closed account). */
export interface AchReturn {
  /** Unique identifier. */
  id: string;
  /** Tenant context. */
  tenantId: string;
  /** The original payment that was returned. */
  paymentId: string;
  /** NACHA R-code (e.g. "R01" = Insufficient Funds). */
  rCode: string;
  /** Human-readable reason for the return. */
  reason: string;
  /** Amount returned in cents. */
  amountCents: number;
  /** Whether a fee was assessed to the customer. */
  feeAssessed: boolean;
  /** Return fee amount in cents. */
  feeCents: number;
  /** ISO timestamp of when the return was received. */
  returnedAt: string;
  /** ISO timestamp of creation. */
  createdAt: string;
}

/** A payment dispute / chargeback from the card network. */
export interface Chargeback {
  /** Unique identifier. */
  id: string;
  /** Tenant context. */
  tenantId: string;
  /** The original payment being disputed. */
  paymentId: string;
  /** Stripe dispute ID. */
  stripeDisputeId: string | null;
  /** Disputed amount in cents. */
  amountCents: number;
  /** Reason for the chargeback. */
  reason: string;
  /** Current status of the dispute (e.g. "open", "won", "lost"). */
  status: string;
  /** Evidence or documentation submitted to fight the chargeback. */
  evidenceJson: Record<string, unknown> | null;
  /** Deadline for submitting evidence (ISO timestamp). */
  evidenceDueBy: string | null;
  /** ISO timestamp of when the dispute was opened. */
  openedAt: string;
  /** ISO timestamp of when the dispute was resolved, if applicable. */
  resolvedAt: string | null;
  /** ISO timestamp of creation. */
  createdAt: string;
}

/** A customer account sent to collections. */
export interface CollectionsAccount {
  /** Unique identifier. */
  id: string;
  /** Tenant context. */
  tenantId: string;
  /** Customer in collections. */
  customerId: string;
  /** Total outstanding balance in cents. */
  balanceCents: number;
  /** Date the account was sent to collections (ISO date string). */
  sentDate: string;
  /** Name of the collections agency. */
  agencyName: string | null;
  /** Reference number from the collections agency. */
  agencyReference: string | null;
  /** Current status (e.g. "active", "settled", "recalled"). */
  status: string;
  /** Free-form notes. */
  notes: string | null;
  /** ISO timestamp of creation. */
  createdAt: string;
  /** ISO timestamp of last update. */
  updatedAt: string;
}

/** A single entry in a deferred revenue recognition schedule. */
export interface DeferredEntry {
  /** Unique identifier. */
  id: string;
  /** Parent deferred schedule ID. */
  scheduleId: string;
  /** The period this entry recognizes revenue for (ISO date string). */
  periodDate: string;
  /** Amount to recognize in this period in cents. */
  amountCents: number;
  /** Whether this entry has been recognized (posted to GL). */
  recognized: boolean;
  /** ISO timestamp of when it was recognized, if applicable. */
  recognizedAt: string | null;
}

/** A deferred revenue schedule for spreading income over time. */
export interface DeferredSchedule {
  /** Unique identifier. */
  id: string;
  /** Tenant context. */
  tenantId: string;
  /** Related invoice ID. */
  invoiceId: string;
  /** Total deferred amount in cents. */
  totalCents: number;
  /** Schedule start date (ISO date string). */
  startDate: string;
  /** Schedule end date (ISO date string). */
  endDate: string;
  /** Individual period entries. */
  entries: DeferredEntry[];
  /** ISO timestamp of creation. */
  createdAt: string;
}

/** A security deposit held for a customer / slip. */
export interface SecurityDeposit {
  /** Unique identifier. */
  id: string;
  /** Tenant context. */
  tenantId: string;
  /** Customer who paid the deposit. */
  customerId: string;
  /** Related contract ID, if applicable. */
  contractId: string | null;
  /** Deposit amount in cents. */
  amountCents: number;
  /** Whether the deposit has been refunded. */
  refunded: boolean;
  /** Amount refunded in cents. */
  refundedAmountCents: number;
  /** Amount forfeited (e.g. for damages) in cents. */
  forfeitedAmountCents: number;
  /** ISO timestamp of when the deposit was received. */
  receivedAt: string;
  /** ISO timestamp of when the deposit was refunded, if applicable. */
  refundedAt: string | null;
  /** Free-form notes. */
  notes: string | null;
  /** ISO timestamp of creation. */
  createdAt: string;
}

/** A credit (store credit, refund credit, goodwill) on a customer account. */
export interface Credit {
  /** Unique identifier. */
  id: string;
  /** Tenant context. */
  tenantId: string;
  /** Customer who holds the credit. */
  customerId: string;
  /** Credit amount in cents. */
  amountCents: number;
  /** Remaining unused balance in cents. */
  balanceCents: number;
  /** Reason the credit was issued. */
  reason: string;
  /** User ID of the staff member who issued the credit. */
  issuedBy: string;
  /** Invoice ID the credit was applied to, if applicable. */
  appliedToInvoiceId: string | null;
  /** ISO timestamp of when the credit expires, if applicable. */
  expiresAt: string | null;
  /** ISO timestamp of creation. */
  createdAt: string;
}
