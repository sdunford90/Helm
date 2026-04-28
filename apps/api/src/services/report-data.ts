import { prisma } from "../lib/prisma.js";
import type Stripe from "stripe";
import { stripe as stripeClient, requireStripe } from "../lib/stripe.js";
import { getStripeAccountForCustomer } from "../lib/stripe-account.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReportResult {
  filename: string;
  content: string;
  contentType: "text/csv" | "application/json";
  summaryHtml: string;
  rows: Record<string, unknown>[];
}

// ---------------------------------------------------------------------------
// CSV helpers
// ---------------------------------------------------------------------------

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const keys = Object.keys(rows[0]);
  const header = keys.join(",");
  const lines = rows.map((r) =>
    keys.map((k) => {
      const v = r[k] ?? "";
      const s = String(v);
      return s.includes(",") || s.includes('"') || s.includes("\n")
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    }).join(","),
  );
  return [header, ...lines].join("\n");
}

function cents(n: number): string {
  return `$${(n / 100).toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Report ID → endpoint mapping (mirrors REPORT_ID_MAP in routes/reports.ts)
// ---------------------------------------------------------------------------

const REPORT_ID_MAP: Record<string, string> = {
  revenue: "revenue",
  aging: "ar-aging",
  collections: "collections",
  deferred: "deferred-revenue",
  gl: "gl-summary",
  occupancy: "occupancy",
  utilization: "rental-utilization",
  dockwalk: "dock-walk-summary",
  customer_activity: "customer-activity",
  leads: "lead-conversion",
  waitlist: "waitlist",
  rent_roll: "occupancy",
  rental_util: "rental-utilization",
  pos_sales: "pos-sales",
  inventory: "inventory",
  maintenance: "dock-walk-summary",
  autopay_card_expirations: "autopay-card-expirations",
};

// ---------------------------------------------------------------------------
// Report generators
// ---------------------------------------------------------------------------

async function revenueReport(tenantId: string): Promise<ReportResult> {
  const now = new Date();
  const startDate = new Date(now.getFullYear(), now.getMonth(), 1);
  const payments = await prisma.payment.aggregate({
    where: { tenantId, postedDate: { gte: startDate, lte: now }, status: "COMPLETED" },
    _sum: { amountCents: true },
    _count: { id: true },
  });
  const invoices = await prisma.invoice.aggregate({
    where: { tenantId, issuedDate: { gte: startDate, lte: now } },
    _sum: { totalCents: true },
    _count: { id: true },
  });
  const byMethod = await prisma.payment.groupBy({
    by: ["method"],
    where: { tenantId, postedDate: { gte: startDate, lte: now }, status: "COMPLETED" },
    _sum: { amountCents: true },
    _count: { id: true },
  });

  const rows = byMethod.map((m) => ({
    "Payment Method": m.method,
    "Total Revenue": cents(m._sum.amountCents ?? 0),
    "Transaction Count": m._count.id,
  }));

  const totalRevenue = cents(payments._sum.amountCents ?? 0);
  const totalInvoiced = cents(invoices._sum.totalCents ?? 0);

  const summaryHtml = `
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <tr><td style="padding:8px;font-weight:600;color:#0A2342;">Total Revenue (MTD)</td><td style="padding:8px;color:#059669;font-weight:700;">${totalRevenue}</td></tr>
      <tr style="background:#F8FAFC;"><td style="padding:8px;font-weight:600;color:#0A2342;">Total Invoiced</td><td style="padding:8px;color:#0A2342;">${totalInvoiced}</td></tr>
      <tr><td style="padding:8px;font-weight:600;color:#0A2342;">Payment Count</td><td style="padding:8px;color:#0A2342;">${payments._count.id}</td></tr>
    </table>`;

  return {
    filename: "revenue-summary.csv",
    content: toCsv(rows),
    contentType: "text/csv",
    summaryHtml,
    rows,
  };
}

async function arAgingReport(tenantId: string): Promise<ReportResult> {
  const now = new Date();
  const openInvoices = await prisma.invoice.findMany({
    where: { tenantId, status: { in: ["ISSUED", "PAST_DUE"] }, balanceCents: { gt: 0 } },
    include: { customer: { select: { firstName: true, lastName: true } } },
    orderBy: { dueDate: "asc" },
  });

  const rows = openInvoices.map((inv) => {
    const daysOverdue = Math.max(0, Math.floor((now.getTime() - new Date(inv.dueDate).getTime()) / 86400000));
    const bucket = daysOverdue === 0 ? "Current" : daysOverdue <= 30 ? "1–30 days" : daysOverdue <= 60 ? "31–60 days" : daysOverdue <= 90 ? "61–90 days" : "90+ days";
    return {
      "Invoice #": inv.invoiceNumber,
      "Customer": `${inv.customer.firstName ?? ""} ${inv.customer.lastName ?? ""}`.trim(),
      "Due Date": new Date(inv.dueDate).toLocaleDateString("en-US"),
      "Balance": cents(inv.balanceCents),
      "Days Overdue": daysOverdue,
      "Bucket": bucket,
    };
  });

  const total = openInvoices.reduce((s, i) => s + i.balanceCents, 0);
  const summaryHtml = `
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <tr><td style="padding:8px;font-weight:600;color:#0A2342;">Open Invoices</td><td style="padding:8px;">${openInvoices.length}</td></tr>
      <tr style="background:#F8FAFC;"><td style="padding:8px;font-weight:600;color:#0A2342;">Total Outstanding</td><td style="padding:8px;color:#DC2626;font-weight:700;">${cents(total)}</td></tr>
    </table>`;

  return { filename: "ar-aging.csv", content: toCsv(rows), contentType: "text/csv", summaryHtml, rows };
}

async function occupancyReport(tenantId: string): Promise<ReportResult> {
  const total = await prisma.slip.count({ where: { tenantId } });
  const occupied = await prisma.slip.count({ where: { tenantId, status: "OCCUPIED" } });
  const vacant = await prisma.slip.count({ where: { tenantId, status: "VACANT" } });
  const maintenance = await prisma.slip.count({ where: { tenantId, status: "MAINTENANCE" } });

  const rows = [
    { Metric: "Total Slips", Value: total },
    { Metric: "Occupied", Value: occupied },
    { Metric: "Vacant", Value: vacant },
    { Metric: "Maintenance", Value: maintenance },
    { Metric: "Occupancy Rate", Value: total > 0 ? `${(occupied / total * 100).toFixed(1)}%` : "0.0%" },
  ];

  const summaryHtml = `
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <tr><td style="padding:8px;font-weight:600;color:#0A2342;">Total Slips</td><td style="padding:8px;">${total}</td></tr>
      <tr style="background:#F8FAFC;"><td style="padding:8px;font-weight:600;color:#0A2342;">Occupancy Rate</td><td style="padding:8px;color:#059669;font-weight:700;">${total > 0 ? (occupied / total * 100).toFixed(1) : "0.0"}%</td></tr>
      <tr><td style="padding:8px;font-weight:600;color:#0A2342;">Vacant Slips</td><td style="padding:8px;">${vacant}</td></tr>
    </table>`;

  return { filename: "occupancy.csv", content: toCsv(rows), contentType: "text/csv", summaryHtml, rows };
}

async function inventoryReport(tenantId: string): Promise<ReportResult> {
  const products = await prisma.product.findMany({
    where: { tenantId, trackInventory: true },
    include: { inventory: true },
  });

  const rows = products.map((p) => {
    const inv = p.inventory[0];
    return {
      "SKU": p.sku ?? "",
      "Product": p.name,
      "Qty On Hand": inv?.qtyOnHand ?? 0,
      "Reorder Qty": p.reorderQty ?? 0,
      "Cost": cents(p.costCents ?? 0),
      "Price": cents(p.priceCents),
      "Total Value": cents((inv?.qtyOnHand ?? 0) * (p.costCents ?? 0)),
      "Needs Reorder": (inv?.qtyOnHand ?? 0) <= (p.reorderQty ?? 0) ? "Yes" : "No",
    };
  });

  const totalValue = products.reduce((s, p) => {
    const inv = p.inventory[0];
    return s + (inv?.qtyOnHand ?? 0) * (p.costCents ?? 0);
  }, 0);

  const summaryHtml = `
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <tr><td style="padding:8px;font-weight:600;color:#0A2342;">Total Products</td><td style="padding:8px;">${products.length}</td></tr>
      <tr style="background:#F8FAFC;"><td style="padding:8px;font-weight:600;color:#0A2342;">Total Inventory Value</td><td style="padding:8px;color:#0A2342;font-weight:700;">${cents(totalValue)}</td></tr>
      <tr><td style="padding:8px;font-weight:600;color:#0A2342;">Reorder Alerts</td><td style="padding:8px;color:#DC2626;">${rows.filter((r) => r["Needs Reorder"] === "Yes").length}</td></tr>
    </table>`;

  return { filename: "inventory.csv", content: toCsv(rows), contentType: "text/csv", summaryHtml, rows };
}

async function posSalesReport(tenantId: string): Promise<ReportResult> {
  const now = new Date();
  const startDate = new Date(now.getFullYear(), now.getMonth(), 1);
  const tx = await prisma.posTransaction.aggregate({
    where: { tenantId, createdAt: { gte: startDate, lte: now }, status: "COMPLETED" },
    _sum: { subtotalCents: true, taxCents: true, totalCents: true },
    _count: { id: true },
  });

  const rows = [
    { Metric: "Transactions (MTD)", Value: tx._count.id },
    { Metric: "Subtotal", Value: cents(tx._sum.subtotalCents ?? 0) },
    { Metric: "Tax Collected", Value: cents(tx._sum.taxCents ?? 0) },
    { Metric: "Total Revenue", Value: cents(tx._sum.totalCents ?? 0) },
  ];

  const summaryHtml = `
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <tr><td style="padding:8px;font-weight:600;color:#0A2342;">Transactions (MTD)</td><td style="padding:8px;">${tx._count.id}</td></tr>
      <tr style="background:#F8FAFC;"><td style="padding:8px;font-weight:600;color:#0A2342;">Total Revenue</td><td style="padding:8px;color:#059669;font-weight:700;">${cents(tx._sum.totalCents ?? 0)}</td></tr>
    </table>`;

  return { filename: "pos-sales.csv", content: toCsv(rows), contentType: "text/csv", summaryHtml, rows };
}

async function customerActivityReport(tenantId: string): Promise<ReportResult> {
  const now = new Date();
  const startDate = new Date(now.getFullYear(), now.getMonth(), 1);
  const total = await prisma.customer.count({ where: { tenantId } });
  const active = await prisma.customer.count({ where: { tenantId, status: "ACTIVE" } });
  const newCustomers = await prisma.customer.count({ where: { tenantId, createdAt: { gte: startDate, lte: now } } });
  const byStatus = await prisma.customer.groupBy({ by: ["status"], where: { tenantId }, _count: { id: true } });

  const rows: { Status: string; Count: number }[] = byStatus.map((s) => ({ Status: s.status as string, Count: s._count.id }));
  rows.push({ Status: "New This Month", Count: newCustomers });

  const summaryHtml = `
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <tr><td style="padding:8px;font-weight:600;color:#0A2342;">Total Customers</td><td style="padding:8px;">${total}</td></tr>
      <tr style="background:#F8FAFC;"><td style="padding:8px;font-weight:600;color:#0A2342;">Active</td><td style="padding:8px;">${active}</td></tr>
      <tr><td style="padding:8px;font-weight:600;color:#0A2342;">New This Month</td><td style="padding:8px;">${newCustomers}</td></tr>
    </table>`;

  return { filename: "customer-activity.csv", content: toCsv(rows), contentType: "text/csv", summaryHtml, rows };
}

async function waitlistReport(tenantId: string): Promise<ReportResult> {
  const total = await prisma.waitlistEntry.count({ where: { tenantId } });
  const bySlipType = await prisma.waitlistEntry.groupBy({ by: ["slipType"], where: { tenantId }, _count: { id: true } });
  const rows = bySlipType.map((s) => ({ "Slip Type": s.slipType ?? "Any", Count: s._count.id }));

  const summaryHtml = `
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <tr><td style="padding:8px;font-weight:600;color:#0A2342;">Total on Waitlist</td><td style="padding:8px;">${total}</td></tr>
    </table>`;

  return { filename: "waitlist.csv", content: toCsv(rows), contentType: "text/csv", summaryHtml, rows };
}

// ---------------------------------------------------------------------------
// Remaining report generators
// ---------------------------------------------------------------------------

async function collectionsReport(tenantId: string): Promise<ReportResult> {
  const accounts = await prisma.collectionsAccount.findMany({
    where: { tenantId },
    include: { customer: { select: { firstName: true, lastName: true } } },
  });
  const rows = accounts.map((a) => ({
    "Customer": `${a.customer.firstName ?? ""} ${a.customer.lastName ?? ""}`.trim(),
    "Status": a.status,
    "Balance at Handoff": cents(a.balanceAtHandoffCents),
    "Recovered": cents(a.recoveredCents),
  }));
  const totalHandoff = accounts.reduce((s, a) => s + a.balanceAtHandoffCents, 0);
  const totalRecovered = accounts.reduce((s, a) => s + a.recoveredCents, 0);
  const summaryHtml = `
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <tr><td style="padding:8px;font-weight:600;color:#0A2342;">Accounts in Collections</td><td style="padding:8px;">${accounts.length}</td></tr>
      <tr style="background:#F8FAFC;"><td style="padding:8px;font-weight:600;color:#0A2342;">Total at Handoff</td><td style="padding:8px;">${cents(totalHandoff)}</td></tr>
      <tr><td style="padding:8px;font-weight:600;color:#0A2342;">Recovered</td><td style="padding:8px;color:#059669;">${cents(totalRecovered)}</td></tr>
    </table>`;
  return { filename: "collections.csv", content: toCsv(rows), contentType: "text/csv", summaryHtml, rows };
}

async function deferredRevenueReport(tenantId: string): Promise<ReportResult> {
  const schedules = await prisma.deferredSchedule.findMany({ where: { tenantId }, orderBy: { startDate: "asc" } });
  const rows = schedules.map((s) => ({
    "Line Item ID": s.invoiceLineItemId,
    "Total": cents(s.totalCents),
    "Recognized": cents(s.recognizedCents),
    "Remaining": cents(s.totalCents - s.recognizedCents),
    "Start Date": new Date(s.startDate).toLocaleDateString("en-US"),
    "End Date": s.endDate ? new Date(s.endDate).toLocaleDateString("en-US") : "",
  }));
  const totalDeferred = schedules.reduce((s, d) => s + d.totalCents, 0);
  const totalRecognized = schedules.reduce((s, d) => s + d.recognizedCents, 0);
  const summaryHtml = `
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <tr><td style="padding:8px;font-weight:600;color:#0A2342;">Total Deferred</td><td style="padding:8px;">${cents(totalDeferred)}</td></tr>
      <tr style="background:#F8FAFC;"><td style="padding:8px;font-weight:600;color:#0A2342;">Recognized</td><td style="padding:8px;">${cents(totalRecognized)}</td></tr>
      <tr><td style="padding:8px;font-weight:600;color:#0A2342;">Remaining</td><td style="padding:8px;">${cents(totalDeferred - totalRecognized)}</td></tr>
    </table>`;
  return { filename: "deferred-revenue.csv", content: toCsv(rows), contentType: "text/csv", summaryHtml, rows };
}

async function glSummaryReport(tenantId: string): Promise<ReportResult> {
  const now = new Date();
  const startDate = new Date(now.getFullYear(), now.getMonth(), 1);
  const accounts = await prisma.glAccount.findMany({ where: { tenantId }, orderBy: { accountNumber: "asc" } });
  const entries = await prisma.glEntry.groupBy({
    by: ["accountId"],
    where: { tenantId, postedAt: { gte: startDate, lte: now } },
    _sum: { debitCents: true, creditCents: true },
  });
  const rows = accounts.map((acct) => {
    const entry = entries.find((e) => e.accountId === acct.id);
    const debits = entry?._sum.debitCents ?? 0;
    const credits = entry?._sum.creditCents ?? 0;
    return {
      "Account #": acct.accountNumber,
      "Name": acct.name,
      "Type": acct.type,
      "Debits (MTD)": cents(debits),
      "Credits (MTD)": cents(credits),
      "Net": cents(debits - credits),
    };
  });
  const summaryHtml = `
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <tr><td style="padding:8px;font-weight:600;color:#0A2342;">GL Accounts</td><td style="padding:8px;">${accounts.length}</td></tr>
    </table>`;
  return { filename: "gl-summary.csv", content: toCsv(rows), contentType: "text/csv", summaryHtml, rows };
}

async function rentalUtilizationReport(tenantId: string): Promise<ReportResult> {
  const now = new Date();
  const startDate = new Date(now.getFullYear(), now.getMonth(), 1);
  const products = await prisma.rentalProduct.findMany({ where: { tenantId } });
  const reservations = await prisma.reservation.groupBy({
    by: ["rentalProductId"],
    where: { tenantId, startDt: { gte: startDate, lte: now }, status: { not: "CANCELLED" } },
    _count: { id: true },
    _sum: { totalCents: true },
  });
  const rows = products.map((p) => {
    const res = reservations.find((r) => r.rentalProductId === p.id);
    return {
      "Product": p.name,
      "Bookings (MTD)": res?._count.id ?? 0,
      "Revenue (MTD)": cents(res?._sum.totalCents ?? 0),
    };
  });
  const totalBookings = rows.reduce((s, r) => s + (r["Bookings (MTD)"] as number), 0);
  const summaryHtml = `
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <tr><td style="padding:8px;font-weight:600;color:#0A2342;">Rental Products</td><td style="padding:8px;">${products.length}</td></tr>
      <tr style="background:#F8FAFC;"><td style="padding:8px;font-weight:600;color:#0A2342;">Bookings (MTD)</td><td style="padding:8px;">${totalBookings}</td></tr>
    </table>`;
  return { filename: "rental-utilization.csv", content: toCsv(rows), contentType: "text/csv", summaryHtml, rows };
}

async function dockWalkReport(tenantId: string): Promise<ReportResult> {
  const now = new Date();
  const startDate = new Date(now.getFullYear(), now.getMonth(), 1);
  const walks = await prisma.dockWalk.count({ where: { tenantId, startedAt: { gte: startDate, lte: now } } });
  const completed = await prisma.dockWalk.count({ where: { tenantId, status: "COMPLETED", startedAt: { gte: startDate, lte: now } } });
  const violations = await prisma.dockWalkItem.groupBy({
    by: ["violationType"],
    where: { dockWalk: { tenantId, startedAt: { gte: startDate, lte: now } }, violationType: { not: null } },
    _count: { id: true },
  });
  const rows = [
    { Metric: "Total Walks (MTD)", Value: walks },
    { Metric: "Completed", Value: completed },
    { Metric: "Completion Rate", Value: walks > 0 ? `${(completed / walks * 100).toFixed(1)}%` : "0.0%" },
    { Metric: "Total Violations", Value: violations.reduce((s, v) => s + v._count.id, 0) },
    ...violations.map((v) => ({ Metric: `Violation: ${v.violationType}`, Value: v._count.id })),
  ];
  const summaryHtml = `
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <tr><td style="padding:8px;font-weight:600;color:#0A2342;">Walks (MTD)</td><td style="padding:8px;">${walks}</td></tr>
      <tr style="background:#F8FAFC;"><td style="padding:8px;font-weight:600;color:#0A2342;">Completion Rate</td><td style="padding:8px;">${walks > 0 ? (completed / walks * 100).toFixed(1) : "0.0"}%</td></tr>
    </table>`;
  return { filename: "dock-walk-summary.csv", content: toCsv(rows), contentType: "text/csv", summaryHtml, rows };
}

async function leadConversionReport(tenantId: string): Promise<ReportResult> {
  const now = new Date();
  const startDate = new Date(now.getFullYear(), now.getMonth(), 1);
  const total = await prisma.lead.count({ where: { tenantId, createdAt: { gte: startDate, lte: now } } });
  const won = await prisma.lead.count({ where: { tenantId, stage: "WON", convertedAt: { gte: startDate, lte: now } } });
  const byStage = await prisma.lead.groupBy({ by: ["stage"], where: { tenantId }, _count: { id: true } });
  const rows = byStage.map((s) => ({ Stage: s.stage, Count: s._count.id }));
  const summaryHtml = `
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <tr><td style="padding:8px;font-weight:600;color:#0A2342;">Leads This Month</td><td style="padding:8px;">${total}</td></tr>
      <tr style="background:#F8FAFC;"><td style="padding:8px;font-weight:600;color:#0A2342;">Won</td><td style="padding:8px;color:#059669;">${won}</td></tr>
      <tr><td style="padding:8px;font-weight:600;color:#0A2342;">Conversion Rate</td><td style="padding:8px;">${total > 0 ? (won / total * 100).toFixed(1) : "0.0"}%</td></tr>
    </table>`;
  return { filename: "lead-conversion.csv", content: toCsv(rows), contentType: "text/csv", summaryHtml, rows };
}

// ---------------------------------------------------------------------------
// Autopay card-expirations report
// ---------------------------------------------------------------------------

export type AutopayBucket =
  | "Expired"
  | "0-30 days"
  | "31-60 days"
  | "61-90 days"
  | ">90 days"
  | "No card on file"
  | "Stripe error";

export interface AutopayExpirationRow {
  customerId: string;
  customerName: string;
  email: string | null;
  phone: string | null;
  location: string | null;
  cardBrand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  daysUntilExpiry: number | null;
  bucket: AutopayBucket;
  status: string;
}

export interface AutopayExpirationData {
  summary: {
    expired: number;
    days30: number;
    days60: number;
    days90: number;
    over90: number;
    noCard: number;
    /**
     * Customers whose Stripe record could not be reached (no Connect account
     * configured, retrieve failed, or deleted in Stripe). Per the task spec
     * these are surfaced as rows with the `Stripe error` bucket so operators
     * can investigate, even though we couldn't confirm their autopay flag.
     */
    stripeError: number;
    total: number;
  };
  rows: AutopayExpirationRow[];
  stripeConfigured: boolean;
  summaryHtml: string;
}

function bucketForCardExpiry(
  expMonth: number,
  expYear: number,
  now: Date,
): { bucket: AutopayBucket; daysUntilExpiry: number } {
  // Cards remain valid through the last day of their expiration month.
  // new Date(year, month, 0) → last day of (month-1) using 0-indexed months,
  // so passing the 1-indexed expMonth gives the last day of expMonth.
  const expiryEnd = new Date(expYear, expMonth, 0, 23, 59, 59, 999);
  const daysUntilExpiry = Math.ceil(
    (expiryEnd.getTime() - now.getTime()) / 86400000,
  );
  let bucket: AutopayBucket;
  if (daysUntilExpiry < 0) bucket = "Expired";
  else if (daysUntilExpiry <= 30) bucket = "0-30 days";
  else if (daysUntilExpiry <= 60) bucket = "31-60 days";
  else if (daysUntilExpiry <= 90) bucket = "61-90 days";
  else bucket = ">90 days";
  return { bucket, daysUntilExpiry };
}

async function processWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function run(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, run),
  );
  return results;
}

const AUTOPAY_BUCKET_ORDER: Record<AutopayBucket, number> = {
  Expired: 0,
  "No card on file": 1,
  "Stripe error": 2,
  "0-30 days": 3,
  "31-60 days": 4,
  "61-90 days": 5,
  ">90 days": 6,
};

/**
 * Build the autopay card-expirations report dataset.
 *
 * Walks every customer in the tenant that has a `stripeCustomerId`, resolves
 * the correct Stripe Connect account using the same routing helper used by
 * autopay charges, and inspects the customer's default payment method. Only
 * customers whose Stripe metadata has `autopay === "true"` are returned in
 * an "expiring" bucket; confirmed non-autopay customers are skipped silently.
 *
 * Stripe failures (no Connect account, deleted customer, retrieve exception)
 * are NOT thrown — the corresponding row is still included with a
 * `Stripe error` bucket so operators can investigate, since we cannot rule
 * out that those customers are on autopay.
 */
export async function buildAutopayCardExpirations(
  tenantId: string,
  opts: { allowedLocationIds?: string[] | null } = {},
): Promise<AutopayExpirationData> {
  const allowed = opts.allowedLocationIds ?? null;

  const customerWhere: Record<string, unknown> = {
    tenantId,
    stripeCustomerId: { not: null },
  };
  if (allowed !== null) {
    customerWhere.invoices = { some: { locationId: { in: allowed } } };
  }

  // Customer query — `customerWhere` may restrict to customers who have at
  // least one invoice in the user's allowed locations (visibility filter).
  // We do NOT use this filter to derive the Stripe Connect account; that
  // routing always goes through getStripeAccountForCustomer so the live
  // report and the autopay charging path agree on which Stripe account to
  // hit, regardless of the viewer's location restrictions.
  const customers = await prisma.customer.findMany({
    where: customerWhere,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      stripeCustomerId: true,
    },
  });

  const emptySummary = {
    expired: 0,
    days30: 0,
    days60: 0,
    days90: 0,
    over90: 0,
    noCard: 0,
    stripeError: 0,
    total: 0,
  };

  if (!stripeClient) {
    return {
      summary: emptySummary,
      rows: [],
      stripeConfigured: false,
      summaryHtml: `<div style="padding:8px;color:#64748B;font-size:13px;">Stripe is not configured for this tenant.</div>`,
    };
  }

  const stripe = requireStripe();
  const now = new Date();

  const results = await processWithConcurrency<
    (typeof customers)[number],
    AutopayExpirationRow | null
  >(customers, 5, async (c) => {
    const customerName =
      `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || "(no name)";

    // Always route via the canonical helper so we hit the same Connect
    // account that autopay charges target.
    const accountInfo = await getStripeAccountForCustomer(c.id, tenantId);
    const stripeAccountId = accountInfo.stripeAccountId;
    const locationName = accountInfo.locationName;

    const base = {
      customerId: c.id,
      customerName,
      email: c.email ?? null,
      phone: c.phone ?? null,
      location: locationName,
      cardBrand: null as string | null,
      last4: null as string | null,
      expMonth: null as number | null,
      expYear: null as number | null,
      daysUntilExpiry: null as number | null,
    };

    if (!stripeAccountId) {
      return {
        ...base,
        bucket: "Stripe error" as const,
        status: "No Stripe Connect account configured for this customer",
      };
    }

    let stripeCustomer: Stripe.Customer;
    try {
      const retrieved = await stripe.customers.retrieve(
        c.stripeCustomerId!,
        { expand: ["invoice_settings.default_payment_method", "default_source"] },
        { stripeAccount: stripeAccountId },
      );
      if ((retrieved as Stripe.DeletedCustomer).deleted) {
        return {
          ...base,
          bucket: "Stripe error" as const,
          status: "Customer is deleted in Stripe",
        };
      }
      stripeCustomer = retrieved as Stripe.Customer;
    } catch (err) {
      console.warn(
        `[autopay-report] Stripe retrieve failed for customer ${c.id}: ${(err as Error).message}`,
      );
      return {
        ...base,
        bucket: "Stripe error" as const,
        status: `Stripe retrieve failed: ${(err as Error).message}`,
      };
    }

    if (stripeCustomer.metadata?.autopay !== "true") {
      // Confirmed non-autopay customer — skip silently.
      return null;
    }

    // Resolve the default card details. Prefer the modern `default_payment_method`
    // (PaymentMethod with .card), fall back to the legacy expanded `default_source`
    // when it's a Card object — same fallback chain used by routes/portal.ts.
    let cardBrand: string | null = null;
    let cardLast4: string | null = null;
    let cardExpMonth: number | null = null;
    let cardExpYear: number | null = null;

    const defaultPm = stripeCustomer.invoice_settings?.default_payment_method;
    if (typeof defaultPm === "object" && defaultPm !== null && (defaultPm as Stripe.PaymentMethod).card) {
      const card = (defaultPm as Stripe.PaymentMethod).card!;
      cardBrand = card.brand ?? null;
      cardLast4 = card.last4 ?? null;
      cardExpMonth = card.exp_month ?? null;
      cardExpYear = card.exp_year ?? null;
    } else {
      const ds = stripeCustomer.default_source;
      if (typeof ds === "object" && ds !== null && (ds as { object?: string }).object === "card") {
        const card = ds as Stripe.Card;
        cardBrand = card.brand ?? null;
        cardLast4 = card.last4 ?? null;
        cardExpMonth = card.exp_month ?? null;
        cardExpYear = card.exp_year ?? null;
      }
    }

    if (cardExpMonth === null || cardExpYear === null) {
      return {
        ...base,
        cardBrand,
        last4: cardLast4,
        bucket: "No card on file" as const,
        status: cardBrand ? "Card has no expiration date" : "No default card on file",
      };
    }

    const { bucket, daysUntilExpiry } = bucketForCardExpiry(
      cardExpMonth,
      cardExpYear,
      now,
    );
    return {
      ...base,
      cardBrand,
      last4: cardLast4,
      expMonth: cardExpMonth,
      expYear: cardExpYear,
      daysUntilExpiry,
      bucket,
      status: bucket,
    };
  });

  const rows = results.filter(
    (r): r is AutopayExpirationRow => r !== null,
  );

  rows.sort((a, b) => {
    const o =
      AUTOPAY_BUCKET_ORDER[a.bucket] - AUTOPAY_BUCKET_ORDER[b.bucket];
    if (o !== 0) return o;
    return (a.daysUntilExpiry ?? 99999) - (b.daysUntilExpiry ?? 99999);
  });

  const summary = {
    expired: rows.filter((r) => r.bucket === "Expired").length,
    days30: rows.filter((r) => r.bucket === "0-30 days").length,
    days60: rows.filter((r) => r.bucket === "31-60 days").length,
    days90: rows.filter((r) => r.bucket === "61-90 days").length,
    over90: rows.filter((r) => r.bucket === ">90 days").length,
    noCard: rows.filter((r) => r.bucket === "No card on file").length,
    stripeError: rows.filter((r) => r.bucket === "Stripe error").length,
    total: rows.length,
  };

  const summaryHtml = `
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <tr><td style="padding:8px;font-weight:600;color:#0A2342;">Expired</td><td style="padding:8px;color:#DC2626;font-weight:700;">${summary.expired}</td></tr>
      <tr style="background:#F8FAFC;"><td style="padding:8px;font-weight:600;color:#0A2342;">Expiring in 0–30 days</td><td style="padding:8px;color:#D97706;font-weight:700;">${summary.days30}</td></tr>
      <tr><td style="padding:8px;font-weight:600;color:#0A2342;">Expiring in 31–60 days</td><td style="padding:8px;color:#D97706;">${summary.days60}</td></tr>
      <tr style="background:#F8FAFC;"><td style="padding:8px;font-weight:600;color:#0A2342;">Expiring in 61–90 days</td><td style="padding:8px;color:#D97706;">${summary.days90}</td></tr>
      <tr><td style="padding:8px;font-weight:600;color:#0A2342;">No card on file</td><td style="padding:8px;color:#DC2626;">${summary.noCard}</td></tr>
      ${summary.stripeError > 0 ? `<tr style="background:#F8FAFC;"><td style="padding:8px;font-weight:600;color:#0A2342;">Stripe error</td><td style="padding:8px;color:#DC2626;">${summary.stripeError}</td></tr>` : ""}
      <tr><td style="padding:8px;font-weight:600;color:#0A2342;">Total autopay customers</td><td style="padding:8px;">${summary.total}</td></tr>
    </table>`;

  return { summary, rows, stripeConfigured: true, summaryHtml };
}

async function autopayCardExpirationsReport(
  tenantId: string,
): Promise<ReportResult> {
  const data = await buildAutopayCardExpirations(tenantId);
  const rows = data.rows.map((r) => ({
    Customer: r.customerName,
    Email: r.email ?? "",
    Phone: r.phone ?? "",
    Location: r.location ?? "",
    "Card Brand": r.cardBrand ?? "",
    "Last 4": r.last4 ?? "",
    Expiration:
      r.expMonth && r.expYear
        ? `${String(r.expMonth).padStart(2, "0")}/${r.expYear}`
        : "",
    "Days Until Expiry": r.daysUntilExpiry ?? "",
    Bucket: r.bucket,
    Status: r.status,
  }));

  return {
    filename: "autopay-card-expirations.csv",
    content: toCsv(rows),
    contentType: "text/csv",
    summaryHtml: data.summaryHtml,
    rows,
  };
}

// ---------------------------------------------------------------------------
// Main export — only CSV and JSON are supported for scheduled delivery
// ---------------------------------------------------------------------------

const SCHEDULE_FORMATS = ["CSV", "JSON"] as const;
export type ScheduleFormat = (typeof SCHEDULE_FORMATS)[number];

export function isValidScheduleFormat(fmt: string): fmt is ScheduleFormat {
  return (SCHEDULE_FORMATS as readonly string[]).includes(fmt);
}

export async function generateReportData(
  reportId: string,
  tenantId: string,
  format: ScheduleFormat,
): Promise<ReportResult | null> {
  const mapped = REPORT_ID_MAP[reportId] ?? reportId;

  let result: ReportResult;
  try {
    switch (mapped) {
      case "revenue":           result = await revenueReport(tenantId); break;
      case "ar-aging":          result = await arAgingReport(tenantId); break;
      case "occupancy":         result = await occupancyReport(tenantId); break;
      case "inventory":         result = await inventoryReport(tenantId); break;
      case "pos-sales":         result = await posSalesReport(tenantId); break;
      case "customer-activity": result = await customerActivityReport(tenantId); break;
      case "waitlist":          result = await waitlistReport(tenantId); break;
      case "collections":       result = await collectionsReport(tenantId); break;
      case "deferred-revenue":  result = await deferredRevenueReport(tenantId); break;
      case "gl-summary":        result = await glSummaryReport(tenantId); break;
      case "rental-utilization":result = await rentalUtilizationReport(tenantId); break;
      case "dock-walk-summary": result = await dockWalkReport(tenantId); break;
      case "lead-conversion":   result = await leadConversionReport(tenantId); break;
      case "autopay-card-expirations": result = await autopayCardExpirationsReport(tenantId); break;
      default:
        console.warn(`[report-data] No generator for mapped report "${mapped}" (requestId: "${reportId}")`);
        return null;
    }
  } catch (err) {
    console.error(`[report-data] Failed to generate ${reportId} for tenant ${tenantId}:`, (err as Error).message);
    return null;
  }

  // For JSON format, serialize the structured row objects directly.
  // This avoids any CSV re-parsing and correctly handles commas in values
  // (e.g. "$1,234.56", quoted names, etc.).
  if (format === "JSON") {
    return {
      ...result,
      filename: result.filename.replace(".csv", ".json"),
      content: JSON.stringify(result.rows, null, 2),
      contentType: "application/json",
    };
  }

  return result;
}
