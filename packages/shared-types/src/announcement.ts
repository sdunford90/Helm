/** A marina-wide or targeted announcement / notification. */
export interface Announcement {
  id: string;
  tenantId: string;
  /** Title of the announcement. */
  title: string;
  /** Body content (supports markdown). */
  body: string;
  /** Priority level. */
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  /** Delivery channels to use. */
  channels: ('EMAIL' | 'SMS' | 'PUSH' | 'IN_APP')[];
  /** Target audience filter (null = all customers). */
  audienceFilter: Record<string, unknown> | null;
  /** Scheduled send time (null = send immediately). */
  scheduledAt: string | null;
  /** Timestamp when the announcement was actually sent. */
  sentAt: string | null;
  /** ID of the staff member who created the announcement. */
  createdBy: string;
  /** Current status. */
  status: 'DRAFT' | 'SCHEDULED' | 'SENDING' | 'SENT' | 'CANCELLED';
  /** Total number of recipients. */
  recipientCount: number;
  /** Number of recipients who opened/viewed. */
  openedCount: number;
  createdAt: string;
  updatedAt: string;
}

/** A delivery record tracking an announcement sent to a specific customer. */
export interface AnnouncementDelivery {
  id: string;
  announcementId: string;
  /** The customer who received the announcement. */
  customerId: string;
  /** The channel used for this delivery. */
  channel: 'EMAIL' | 'SMS' | 'PUSH' | 'IN_APP';
  /** Current delivery status. */
  status: 'PENDING' | 'SENT' | 'DELIVERED' | 'OPENED' | 'FAILED' | 'BOUNCED';
  /** Timestamp when the delivery was sent. */
  sentAt: string | null;
  /** Timestamp when the delivery was confirmed delivered. */
  deliveredAt: string | null;
  /** Timestamp when the recipient opened/viewed. */
  openedAt: string | null;
  /** Error message if delivery failed. */
  errorMessage: string | null;
  createdAt: string;
}
