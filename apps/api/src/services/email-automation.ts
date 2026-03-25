import { prisma } from "../lib/prisma.js";
import { queues } from "../lib/queue.js";
import { sendEmail } from "../lib/email.js";

// --------------------------------------------------------------------------
// Trigger types that fire automation rules
// --------------------------------------------------------------------------

export type AutomationTrigger =
  | "invoice_created"
  | "invoice_past_due"
  | "invoice_past_due_7"
  | "invoice_past_due_14"
  | "invoice_past_due_30"
  | "payment_received"
  | "payment_failed"
  | "ach_return"
  | "contract_expiring_60"
  | "contract_expiring_30"
  | "contract_expiring_7"
  | "contract_expired"
  | "insurance_expiring_60"
  | "insurance_expiring_30"
  | "insurance_expiring_7"
  | "insurance_expired"
  | "registration_expiring_30"
  | "rental_booking_confirmed"
  | "rental_pre_arrival"
  | "rental_post_return"
  | "rental_abandoned_cart"
  | "rental_nps_survey"
  | "welcome_new_customer"
  | "waitlist_position_available"
  | "dock_walk_violation";

// --------------------------------------------------------------------------
// Interfaces
// --------------------------------------------------------------------------

export interface AutomationRule {
  id: string;
  tenantId: string;
  name: string;
  trigger: AutomationTrigger;
  enabled: boolean;
  delayMinutes: number;
  templateId: string;
  channels: ("email" | "sms")[];
  conditions?: {
    customerStatus?: string[];
    slipType?: string[];
    minAmountCents?: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface EmailTemplate {
  id: string;
  tenantId: string;
  name: string;
  subject: string;
  htmlBody: string;
  category:
    | "billing"
    | "operations"
    | "rental"
    | "compliance"
    | "marketing"
    | "custom";
  isDefault: boolean;
  variables: string[];
  createdAt: Date;
  updatedAt: Date;
}

// --------------------------------------------------------------------------
// Trigger metadata — human-readable labels + groupings
// --------------------------------------------------------------------------

export interface TriggerMeta {
  trigger: AutomationTrigger;
  label: string;
  description: string;
  category: "billing" | "rentals" | "compliance" | "operations";
  availableVariables: string[];
}

export const TRIGGER_METADATA: TriggerMeta[] = [
  // ── Billing ────────────────────────────────────────────────
  {
    trigger: "invoice_created",
    label: "Invoice Created",
    description: "Fires when a new invoice is generated",
    category: "billing",
    availableVariables: [
      "customerName",
      "customerEmail",
      "invoiceNumber",
      "amount",
      "dueDate",
      "portalUrl",
      "marinaName",
      "slipNumber",
    ],
  },
  {
    trigger: "invoice_past_due",
    label: "Invoice Past Due",
    description: "Fires on the day an invoice becomes past due",
    category: "billing",
    availableVariables: [
      "customerName",
      "customerEmail",
      "invoiceNumber",
      "amount",
      "dueDate",
      "daysOverdue",
      "portalUrl",
      "marinaName",
    ],
  },
  {
    trigger: "invoice_past_due_7",
    label: "Invoice 7 Days Past Due",
    description: "Fires 7 days after an invoice due date",
    category: "billing",
    availableVariables: [
      "customerName",
      "customerEmail",
      "invoiceNumber",
      "amount",
      "dueDate",
      "daysOverdue",
      "portalUrl",
      "marinaName",
    ],
  },
  {
    trigger: "invoice_past_due_14",
    label: "Invoice 14 Days Past Due",
    description: "Fires 14 days after an invoice due date",
    category: "billing",
    availableVariables: [
      "customerName",
      "customerEmail",
      "invoiceNumber",
      "amount",
      "dueDate",
      "daysOverdue",
      "portalUrl",
      "marinaName",
    ],
  },
  {
    trigger: "invoice_past_due_30",
    label: "Invoice 30 Days Past Due",
    description: "Fires 30 days after an invoice due date",
    category: "billing",
    availableVariables: [
      "customerName",
      "customerEmail",
      "invoiceNumber",
      "amount",
      "dueDate",
      "daysOverdue",
      "portalUrl",
      "marinaName",
    ],
  },
  {
    trigger: "payment_received",
    label: "Payment Received",
    description: "Fires when a payment is successfully processed",
    category: "billing",
    availableVariables: [
      "customerName",
      "customerEmail",
      "amount",
      "paymentMethod",
      "invoiceNumber",
      "transactionId",
      "marinaName",
    ],
  },
  {
    trigger: "payment_failed",
    label: "Payment Failed",
    description: "Fires when a payment attempt fails",
    category: "billing",
    availableVariables: [
      "customerName",
      "customerEmail",
      "amount",
      "paymentMethod",
      "failureReason",
      "portalUrl",
      "marinaName",
    ],
  },
  {
    trigger: "ach_return",
    label: "ACH Return",
    description: "Fires when an ACH payment is returned by the bank",
    category: "billing",
    availableVariables: [
      "customerName",
      "customerEmail",
      "amount",
      "returnCode",
      "returnReason",
      "portalUrl",
      "marinaName",
    ],
  },

  // ── Compliance ─────────────────────────────────────────────
  {
    trigger: "contract_expiring_60",
    label: "Contract Expiring (60 Days)",
    description: "Fires 60 days before a contract expires",
    category: "compliance",
    availableVariables: [
      "customerName",
      "customerEmail",
      "contractNumber",
      "expirationDate",
      "slipNumber",
      "portalUrl",
      "marinaName",
    ],
  },
  {
    trigger: "contract_expiring_30",
    label: "Contract Expiring (30 Days)",
    description: "Fires 30 days before a contract expires",
    category: "compliance",
    availableVariables: [
      "customerName",
      "customerEmail",
      "contractNumber",
      "expirationDate",
      "slipNumber",
      "portalUrl",
      "marinaName",
    ],
  },
  {
    trigger: "contract_expiring_7",
    label: "Contract Expiring (7 Days)",
    description: "Fires 7 days before a contract expires",
    category: "compliance",
    availableVariables: [
      "customerName",
      "customerEmail",
      "contractNumber",
      "expirationDate",
      "slipNumber",
      "portalUrl",
      "marinaName",
    ],
  },
  {
    trigger: "contract_expired",
    label: "Contract Expired",
    description: "Fires when a contract has expired",
    category: "compliance",
    availableVariables: [
      "customerName",
      "customerEmail",
      "contractNumber",
      "expirationDate",
      "slipNumber",
      "portalUrl",
      "marinaName",
    ],
  },
  {
    trigger: "insurance_expiring_60",
    label: "Insurance Expiring (60 Days)",
    description: "Fires 60 days before insurance expires",
    category: "compliance",
    availableVariables: [
      "customerName",
      "customerEmail",
      "insuranceProvider",
      "policyNumber",
      "expirationDate",
      "portalUrl",
      "marinaName",
    ],
  },
  {
    trigger: "insurance_expiring_30",
    label: "Insurance Expiring (30 Days)",
    description: "Fires 30 days before insurance expires",
    category: "compliance",
    availableVariables: [
      "customerName",
      "customerEmail",
      "insuranceProvider",
      "policyNumber",
      "expirationDate",
      "portalUrl",
      "marinaName",
    ],
  },
  {
    trigger: "insurance_expiring_7",
    label: "Insurance Expiring (7 Days)",
    description: "Fires 7 days before insurance expires",
    category: "compliance",
    availableVariables: [
      "customerName",
      "customerEmail",
      "insuranceProvider",
      "policyNumber",
      "expirationDate",
      "portalUrl",
      "marinaName",
    ],
  },
  {
    trigger: "insurance_expired",
    label: "Insurance Expired",
    description: "Fires when insurance has expired",
    category: "compliance",
    availableVariables: [
      "customerName",
      "customerEmail",
      "insuranceProvider",
      "policyNumber",
      "expirationDate",
      "portalUrl",
      "marinaName",
    ],
  },
  {
    trigger: "registration_expiring_30",
    label: "Registration Expiring (30 Days)",
    description: "Fires 30 days before vessel registration expires",
    category: "compliance",
    availableVariables: [
      "customerName",
      "customerEmail",
      "vesselName",
      "registrationNumber",
      "expirationDate",
      "portalUrl",
      "marinaName",
    ],
  },

  // ── Rentals ────────────────────────────────────────────────
  {
    trigger: "rental_booking_confirmed",
    label: "Rental Booking Confirmed",
    description: "Fires when a rental reservation is confirmed",
    category: "rentals",
    availableVariables: [
      "customerName",
      "customerEmail",
      "reservationId",
      "boatName",
      "startDate",
      "endDate",
      "totalAmount",
      "checkInTime",
      "marinaName",
      "marinaAddress",
    ],
  },
  {
    trigger: "rental_pre_arrival",
    label: "Rental Pre-Arrival (48hrs)",
    description: "Fires 48 hours before a rental start time",
    category: "rentals",
    availableVariables: [
      "customerName",
      "customerEmail",
      "reservationId",
      "boatName",
      "startDate",
      "checkInTime",
      "marinaName",
      "marinaAddress",
      "weatherForecast",
    ],
  },
  {
    trigger: "rental_post_return",
    label: "Rental Post-Return",
    description: "Fires after a rental vessel is returned",
    category: "rentals",
    availableVariables: [
      "customerName",
      "customerEmail",
      "reservationId",
      "boatName",
      "totalAmount",
      "returnDate",
      "marinaName",
    ],
  },
  {
    trigger: "rental_abandoned_cart",
    label: "Rental Abandoned Cart",
    description: "Fires when a customer starts but does not complete checkout",
    category: "rentals",
    availableVariables: [
      "customerName",
      "customerEmail",
      "boatName",
      "startDate",
      "totalAmount",
      "checkoutUrl",
      "marinaName",
    ],
  },
  {
    trigger: "rental_nps_survey",
    label: "Rental NPS Survey (24hrs After)",
    description: "Fires 24 hours after rental return for a satisfaction survey",
    category: "rentals",
    availableVariables: [
      "customerName",
      "customerEmail",
      "reservationId",
      "boatName",
      "surveyUrl",
      "marinaName",
    ],
  },

  // ── Operations ─────────────────────────────────────────────
  {
    trigger: "welcome_new_customer",
    label: "Welcome New Customer",
    description: "Fires when a new customer account is created",
    category: "operations",
    availableVariables: [
      "customerName",
      "customerEmail",
      "portalUrl",
      "marinaName",
      "marinaPhone",
      "marinaAddress",
    ],
  },
  {
    trigger: "waitlist_position_available",
    label: "Waitlist Position Available",
    description: "Fires when a slip becomes available for a waitlisted customer",
    category: "operations",
    availableVariables: [
      "customerName",
      "customerEmail",
      "slipNumber",
      "slipType",
      "monthlyRate",
      "portalUrl",
      "marinaName",
    ],
  },
  {
    trigger: "dock_walk_violation",
    label: "Dock Walk Violation Noticed",
    description: "Fires when a violation is logged during a dock walk",
    category: "operations",
    availableVariables: [
      "customerName",
      "customerEmail",
      "violationType",
      "violationDescription",
      "slipNumber",
      "detectedDate",
      "resolutionDeadline",
      "marinaName",
    ],
  },
];

// --------------------------------------------------------------------------
// Get available variables for a trigger type
// --------------------------------------------------------------------------

export function getAvailableVariables(trigger: AutomationTrigger): string[] {
  const meta = TRIGGER_METADATA.find((t) => t.trigger === trigger);
  return meta?.availableVariables ?? [];
}

// --------------------------------------------------------------------------
// Merge template variables
// --------------------------------------------------------------------------

export function mergeTemplate(
  html: string,
  variables: Record<string, string>,
): string {
  return html.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    return variables[key] ?? "";
  });
}

// --------------------------------------------------------------------------
// Process a trigger event
// --------------------------------------------------------------------------

export async function processAutomationTrigger(
  trigger: AutomationTrigger,
  tenantId: string,
  context: Record<string, any>,
): Promise<void> {
  // 1. Look up all enabled rules for this trigger + tenant
  const rules = await prisma.automationRule.findMany({
    where: {
      tenantId,
      trigger,
      enabled: true,
    },
  });

  if (rules.length === 0) return;

  for (const rule of rules) {
    try {
      await processRule(rule, tenantId, trigger, context);
    } catch (err) {
      console.error(
        `[email-automation] Error processing rule ${rule.id} for trigger ${trigger}:`,
        err,
      );
    }
  }
}

// --------------------------------------------------------------------------
// Process a single rule
// --------------------------------------------------------------------------

async function processRule(
  rule: any,
  tenantId: string,
  trigger: AutomationTrigger,
  context: Record<string, any>,
): Promise<void> {
  // 2. Check conditions
  const conditions = rule.conditions as AutomationRule["conditions"];

  if (conditions) {
    if (
      conditions.customerStatus?.length &&
      context.customerStatus &&
      !conditions.customerStatus.includes(context.customerStatus)
    ) {
      return;
    }

    if (
      conditions.slipType?.length &&
      context.slipType &&
      !conditions.slipType.includes(context.slipType)
    ) {
      return;
    }

    if (
      conditions.minAmountCents != null &&
      context.amountCents != null &&
      context.amountCents < conditions.minAmountCents
    ) {
      return;
    }
  }

  // 3. Resolve the template
  const template = await prisma.emailTemplate.findFirst({
    where: { id: rule.templateId, tenantId },
  });

  if (!template) {
    console.warn(
      `[email-automation] Template ${rule.templateId} not found for rule ${rule.id}`,
    );
    return;
  }

  // Build merge variables from context
  const variables: Record<string, string> = {};
  const availableVars = getAvailableVariables(trigger);
  for (const varName of availableVars) {
    if (context[varName] != null) {
      variables[varName] = String(context[varName]);
    }
  }

  const mergedSubject = mergeTemplate(template.subject, variables);
  const mergedHtml = mergeTemplate(template.htmlBody, variables);

  // Resolve customer email
  const customerEmail =
    context.customerEmail || (await resolveCustomerEmail(context.customerId, tenantId));

  if (!customerEmail) {
    console.warn(
      `[email-automation] No email address for customer in rule ${rule.id}`,
    );
    return;
  }

  const channels = (rule.channels as string[]) ?? ["email"];
  const delayMs = (rule.delayMinutes ?? 0) * 60 * 1000;

  // 4. Queue email and/or SMS
  for (const channel of channels) {
    if (channel === "email") {
      await queues.email.add(
        "automation-email",
        {
          tenantId,
          ruleId: rule.id,
          templateId: template.id,
          trigger,
          to: customerEmail,
          subject: mergedSubject,
          html: mergedHtml,
          customerId: context.customerId,
        },
        delayMs > 0 ? { delay: delayMs } : undefined,
      );
    }

    if (channel === "sms" && context.customerPhone) {
      await queues.sms.add(
        "automation-sms",
        {
          tenantId,
          ruleId: rule.id,
          templateId: template.id,
          trigger,
          to: context.customerPhone,
          body: mergedSubject, // Use subject as SMS text
          customerId: context.customerId,
        },
        delayMs > 0 ? { delay: delayMs } : undefined,
      );
    }
  }

  // Log the send
  await prisma.emailAutomationLog.create({
    data: {
      tenantId,
      ruleId: rule.id,
      templateId: template.id,
      trigger,
      recipientEmail: customerEmail,
      recipientPhone: context.customerPhone ?? null,
      customerId: context.customerId ?? null,
      channels: channels as string[],
      subject: mergedSubject,
      status: "QUEUED",
      scheduledAt:
        delayMs > 0 ? new Date(Date.now() + delayMs) : new Date(),
    },
  });
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

async function resolveCustomerEmail(
  customerId: string | undefined,
  tenantId: string,
): Promise<string | null> {
  if (!customerId) return null;

  const customer = await prisma.customer.findFirst({
    where: { id: customerId, tenantId },
    select: { email: true },
  });

  return customer?.email ?? null;
}

/**
 * Send an automation email immediately (called by the BullMQ worker).
 */
export async function sendAutomationEmail(jobData: {
  tenantId: string;
  ruleId: string;
  templateId: string;
  trigger: string;
  to: string;
  subject: string;
  html: string;
  customerId?: string;
}): Promise<void> {
  const messageId = await sendEmail({
    to: jobData.to,
    subject: jobData.subject,
    html: jobData.html,
    tags: [
      { name: "trigger", value: jobData.trigger },
      { name: "ruleId", value: jobData.ruleId },
    ],
  });

  // Update log entry
  await prisma.emailAutomationLog.updateMany({
    where: {
      ruleId: jobData.ruleId,
      recipientEmail: jobData.to,
      status: "QUEUED",
      tenantId: jobData.tenantId,
    },
    data: {
      status: messageId ? "DELIVERED" : "FAILED",
      sentAt: messageId ? new Date() : undefined,
      resendMessageId: messageId,
    },
  });
}

/**
 * Generate sample data for a given trigger (used for template preview).
 */
export function getSampleDataForTrigger(
  trigger: AutomationTrigger,
): Record<string, string> {
  const base: Record<string, string> = {
    customerName: "John Smith",
    customerEmail: "john.smith@example.com",
    marinaName: "Bayshore Marina",
    marinaPhone: "(555) 123-4567",
    marinaAddress: "100 Harbor Drive, Bayshore, FL 33541",
    portalUrl: "https://portal.bayshore-marina.com",
  };

  const triggerData: Partial<Record<AutomationTrigger, Record<string, string>>> = {
    invoice_created: {
      invoiceNumber: "INV-2026-1048",
      amount: "$2,450.00",
      dueDate: "April 15, 2026",
      slipNumber: "A-14",
    },
    invoice_past_due: {
      invoiceNumber: "INV-2026-0982",
      amount: "$1,800.00",
      dueDate: "March 1, 2026",
      daysOverdue: "24",
    },
    invoice_past_due_7: {
      invoiceNumber: "INV-2026-0982",
      amount: "$1,800.00",
      dueDate: "March 18, 2026",
      daysOverdue: "7",
    },
    invoice_past_due_14: {
      invoiceNumber: "INV-2026-0982",
      amount: "$1,800.00",
      dueDate: "March 11, 2026",
      daysOverdue: "14",
    },
    invoice_past_due_30: {
      invoiceNumber: "INV-2026-0982",
      amount: "$1,800.00",
      dueDate: "February 23, 2026",
      daysOverdue: "30",
    },
    payment_received: {
      amount: "$2,450.00",
      paymentMethod: "Visa ending in 4242",
      invoiceNumber: "INV-2026-1048",
      transactionId: "txn_3kF9xW2pQ",
    },
    payment_failed: {
      amount: "$2,450.00",
      paymentMethod: "Visa ending in 4242",
      failureReason: "Card declined — insufficient funds",
    },
    ach_return: {
      amount: "$2,450.00",
      returnCode: "R01",
      returnReason: "Insufficient Funds",
    },
    contract_expiring_60: {
      contractNumber: "CON-2024-087",
      expirationDate: "May 25, 2026",
      slipNumber: "B-14",
    },
    contract_expiring_30: {
      contractNumber: "CON-2024-087",
      expirationDate: "April 25, 2026",
      slipNumber: "B-14",
    },
    contract_expiring_7: {
      contractNumber: "CON-2024-087",
      expirationDate: "April 1, 2026",
      slipNumber: "B-14",
    },
    contract_expired: {
      contractNumber: "CON-2024-087",
      expirationDate: "March 25, 2026",
      slipNumber: "B-14",
    },
    insurance_expiring_60: {
      insuranceProvider: "BoatUS Marine Insurance",
      policyNumber: "POL-889923",
      expirationDate: "May 25, 2026",
    },
    insurance_expiring_30: {
      insuranceProvider: "BoatUS Marine Insurance",
      policyNumber: "POL-889923",
      expirationDate: "April 25, 2026",
    },
    insurance_expiring_7: {
      insuranceProvider: "BoatUS Marine Insurance",
      policyNumber: "POL-889923",
      expirationDate: "April 1, 2026",
    },
    insurance_expired: {
      insuranceProvider: "BoatUS Marine Insurance",
      policyNumber: "POL-889923",
      expirationDate: "March 25, 2026",
    },
    registration_expiring_30: {
      vesselName: "Sea Spirit",
      registrationNumber: "FL-4821-KM",
      expirationDate: "April 25, 2026",
    },
    rental_booking_confirmed: {
      reservationId: "RES-2026-0412",
      boatName: "Sunset Sailor 28",
      startDate: "April 5, 2026",
      endDate: "April 5, 2026",
      totalAmount: "$375.00",
      checkInTime: "9:00 AM",
    },
    rental_pre_arrival: {
      reservationId: "RES-2026-0412",
      boatName: "Sunset Sailor 28",
      startDate: "April 5, 2026",
      checkInTime: "9:00 AM",
      weatherForecast: "Sunny, 78°F, light winds",
    },
    rental_post_return: {
      reservationId: "RES-2026-0412",
      boatName: "Sunset Sailor 28",
      totalAmount: "$375.00",
      returnDate: "April 5, 2026",
    },
    rental_abandoned_cart: {
      boatName: "Sunset Sailor 28",
      startDate: "April 5, 2026",
      totalAmount: "$375.00",
      checkoutUrl: "https://rentals.bayshore-marina.com/checkout/abc123",
    },
    rental_nps_survey: {
      reservationId: "RES-2026-0412",
      boatName: "Sunset Sailor 28",
      surveyUrl: "https://bayshore-marina.com/survey/abc123",
    },
    welcome_new_customer: {},
    waitlist_position_available: {
      slipNumber: "A-22",
      slipType: "40ft Standard",
      monthlyRate: "$850.00",
    },
    dock_walk_violation: {
      violationType: "Electrical Hazard",
      violationDescription:
        "Frayed shore power cord at pedestal — fire risk",
      slipNumber: "B-01",
      detectedDate: "March 25, 2026",
      resolutionDeadline: "April 1, 2026",
    },
  };

  return { ...base, ...(triggerData[trigger] ?? {}) };
}
