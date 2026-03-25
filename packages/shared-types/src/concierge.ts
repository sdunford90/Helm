/** Status of a concierge service request. */
export enum ConciergeStatus {
  SUBMITTED = 'SUBMITTED',
  ASSIGNED = 'ASSIGNED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

/** A concierge service request from a customer. */
export interface ConciergeRequest {
  id: string;
  tenantId: string;
  /** Customer who made the request. */
  customerId: string;
  /** Type of service requested (e.g. "Provisioning", "Cleaning", "Maintenance", "Transportation"). */
  serviceType: string;
  /** Detailed description of the request. */
  description: string;
  /** Current request status. */
  status: ConciergeStatus;
  /** Priority level. */
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  /** Preferred date/time for the service (ISO string). */
  preferredDate: string | null;
  /** Scheduled date/time for the service (ISO string). */
  scheduledDate: string | null;
  /** Vendor assigned to fulfill the request. */
  vendorId: string | null;
  /** Staff member managing the request. */
  assignedTo: string | null;
  /** Estimated cost in cents. */
  estimatedCostCents: number | null;
  /** Actual cost in cents. */
  actualCostCents: number | null;
  /** Invoice ID for billing the customer. */
  invoiceId: string | null;
  /** Customer notes or special instructions. */
  customerNotes: string | null;
  /** Internal staff notes. */
  staffNotes: string | null;
  /** Timestamp when the request was completed. */
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A third-party vendor who provides concierge services. */
export interface ConciergeVendor {
  id: string;
  tenantId: string;
  /** Vendor / company name. */
  name: string;
  /** Contact email. */
  email: string;
  /** Contact phone. */
  phone: string;
  /** Services offered (e.g. ["Cleaning", "Provisioning"]). */
  services: string[];
  /** Whether the vendor is currently active and accepting work. */
  active: boolean;
  /** Average rating (1-5 scale). */
  rating: number | null;
  /** Total number of completed requests. */
  completedRequests: number;
  /** Notes about the vendor. */
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}
