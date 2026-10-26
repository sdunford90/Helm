/**
 * Minimal API DTO shapes (as returned by apps/api) plus small mapping
 * helpers. Pages map these into their own view models; nothing here
 * invents data.
 */

export interface CustomerRef {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  company?: string | null;
  phone?: string | null;
}

export function customerName(c: CustomerRef | null | undefined): string {
  if (!c) return '—';
  const n = `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim();
  return n || c.company || c.email || '—';
}

export interface SlipRef {
  id: string;
  slipNumber?: string | null;
  dockId?: string | null;
  lengthFt?: number | null;
}

export interface BoatRef {
  id: string;
  name?: string | null;
  lengthFt?: number | null;
  make?: string | null;
  model?: string | null;
}

export interface InvoiceDTO {
  id: string;
  invoiceNumber: string;
  customerId: string;
  issuedDate: string;
  dueDate: string;
  status: 'DRAFT' | 'ISSUED' | 'PAID' | 'PAST_DUE' | 'VOID' | 'COLLECTIONS';
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  balanceCents: number;
  customer?: CustomerRef | null;
}

export interface PaymentDTO {
  id: string;
  customerId: string;
  invoiceId?: string | null;
  amountCents: number;
  method: 'CARD' | 'ACH' | 'CASH' | 'CHARGE_TO_SLIP' | 'GIFT_CARD';
  postedDate: string;
  status: 'PENDING' | 'COMPLETED' | 'FAILED' | 'REFUNDED' | 'PARTIALLY_REFUNDED';
  createdAt?: string;
}

export interface ContractDTO {
  id: string;
  slipId: string;
  customerId: string;
  boatId?: string | null;
  startDate: string;
  endDate?: string | null;
  billingCycle: 'MONTHLY' | 'QUARTERLY' | 'SEMI_ANNUAL' | 'ANNUAL';
  rateCents: number;
  autoRenew: boolean;
  status: 'DRAFT' | 'ACTIVE' | 'EXPIRING' | 'EXPIRED' | 'TERMINATED' | 'RENEWED';
  securityDepositCents?: number | null;
  esignStatus?: string | null;
  slip?: SlipRef | null;
  customer?: CustomerRef | null;
  boat?: BoatRef | null;
  daysUntilExpiry?: number | null;
  createdAt?: string;
}

export interface AuditLogDTO {
  id: string;
  userId?: string | null;
  userName?: string | null;
  recordType: string;
  recordId: string;
  action: string;
  changedFieldsJson?: unknown;
  ipAddress?: string | null;
  createdAt: string;
  user?: { id: string; email?: string | null; role?: string | null } | null;
}
