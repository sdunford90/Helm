/** A product available for sale in the point-of-sale system. */
export interface Product {
  id: string;
  tenantId: string;
  /** Product name. */
  name: string;
  /** Product description. */
  description: string | null;
  /** SKU (stock keeping unit). */
  sku: string;
  /** Category (e.g. "Fuel", "Supplies", "Snacks"). */
  category: string;
  /** Unit price in cents. */
  priceCents: number;
  /** Cost per unit in cents (for margin tracking). */
  costCents: number;
  /** Tax rate as a decimal (e.g. 0.07 = 7%). */
  taxRate: number;
  /** Whether this product is currently active / for sale. */
  active: boolean;
  /** URL or path to product image. */
  imageUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Current inventory levels for a product. */
export interface Inventory {
  id: string;
  tenantId: string;
  /** The product this inventory tracks. */
  productId: string;
  /** Current quantity on hand. */
  quantityOnHand: number;
  /** Minimum quantity before reorder alert. */
  reorderPoint: number;
  /** Quantity to order when reordering. */
  reorderQuantity: number;
  /** Location / storage area. */
  location: string | null;
  /** Date of last inventory count (ISO date string). */
  lastCountDate: string | null;
  updatedAt: string;
}

/** A purchase order for restocking inventory. */
export interface PurchaseOrder {
  id: string;
  tenantId: string;
  /** Vendor / supplier name. */
  vendorName: string;
  /** PO number. */
  poNumber: string;
  /** Current status. */
  status: 'DRAFT' | 'SUBMITTED' | 'PARTIAL' | 'RECEIVED' | 'CANCELLED';
  /** Order date (ISO date string). */
  orderDate: string;
  /** Expected delivery date (ISO date string). */
  expectedDate: string | null;
  /** Date the order was received (ISO date string). */
  receivedDate: string | null;
  /** Total order amount in cents. */
  totalCents: number;
  /** Notes about the order. */
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A line item within a POS transaction. */
export interface PosLineItem {
  id: string;
  transactionId: string;
  /** The product sold. */
  productId: string;
  /** Product name (denormalized at time of sale). */
  productName: string;
  /** Quantity sold. */
  quantity: number;
  /** Unit price at time of sale, in cents. */
  unitPriceCents: number;
  /** Discount applied to this line item, in cents. */
  discountCents: number;
  /** Tax amount for this line item, in cents. */
  taxCents: number;
  /** Total for this line item in cents. */
  totalCents: number;
}

/** A point-of-sale transaction. */
export interface PosTransaction {
  id: string;
  tenantId: string;
  /** Customer charged (null for anonymous / walk-in sales). */
  customerId: string | null;
  /** Staff member / cashier who processed the transaction. */
  cashierId: string;
  /** The shift this transaction occurred during. */
  shiftId: string;
  /** Line items in the transaction. */
  lineItems: PosLineItem[];
  /** Subtotal before tax in cents. */
  subtotalCents: number;
  /** Total tax in cents. */
  taxCents: number;
  /** Total discount in cents. */
  discountCents: number;
  /** Grand total in cents. */
  totalCents: number;
  /** Payment method used. */
  paymentMethod: 'CASH' | 'CARD' | 'ACH' | 'CHARGE_TO_ACCOUNT';
  /** Whether the customer was charged to their account. */
  chargedToAccount: boolean;
  /** Invoice ID if charged to account. */
  invoiceId: string | null;
  /** Stripe payment reference, if card payment. */
  stripePaymentId: string | null;
  /** Transaction timestamp. */
  transactedAt: string;
  createdAt: string;
}

/** A cashier shift for the POS system. */
export interface Shift {
  id: string;
  tenantId: string;
  /** Staff member working the shift. */
  cashierId: string;
  /** Shift start timestamp. */
  startedAt: string;
  /** Shift end timestamp. */
  endedAt: string | null;
  /** Opening cash in the drawer, in cents. */
  openingCashCents: number;
  /** Closing cash in the drawer, in cents. */
  closingCashCents: number | null;
  /** Expected cash based on transactions, in cents. */
  expectedCashCents: number | null;
  /** Cash over/short variance, in cents (positive = over). */
  varianceCents: number | null;
  /** Status of the shift. */
  status: 'OPEN' | 'CLOSED' | 'RECONCILED';
  /** Notes about the shift. */
  notes: string | null;
}
