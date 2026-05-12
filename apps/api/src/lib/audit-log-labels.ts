import { prisma } from "./prisma.js";

/**
 * Enriches audit-log entries with a human-readable label and an optional
 * in-app href so the Audit Log UI can render record references as links to
 * the underlying entity (customer, invoice, etc.).
 *
 * Lookups are batched per `recordType` and tenant-scoped. If a referenced
 * record was deleted or never existed, the entry is omitted from the result
 * map and the frontend falls back to the short ID.
 */

export interface RecordRef {
  label?: string;
  href?: string;
}

export type RecordRefMap = Map<string, RecordRef>;

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function buildRecordRefs(
  tenantId: string,
  entries: { recordType: string; recordId: string }[],
): Promise<Record<string, RecordRefMap>> {
  const idsByType: Record<string, Set<string>> = {};
  for (const e of entries) {
    if (!idsByType[e.recordType]) idsByType[e.recordType] = new Set();
    idsByType[e.recordType].add(e.recordId);
  }

  const out: Record<string, RecordRefMap> = {};

  // Customer → /customers/:id
  if (idsByType.Customer) {
    const rows = await prisma.customer.findMany({
      where: { id: { in: [...idsByType.Customer] }, tenantId },
      select: { id: true, firstName: true, lastName: true, company: true },
    });
    out.Customer = new Map(
      rows.map((r) => {
        const full = `${r.firstName} ${r.lastName}`.trim();
        const label = r.company ? `${full} (${r.company})` : full || "Customer";
        return [r.id, { label, href: `/customers/${r.id}` }];
      }),
    );
  }

  // Invoice → /billing/invoices/:id
  if (idsByType.Invoice) {
    const rows = await prisma.invoice.findMany({
      where: { id: { in: [...idsByType.Invoice] }, tenantId },
      select: { id: true, invoiceNumber: true },
    });
    out.Invoice = new Map(
      rows.map((r) => [
        r.id,
        { label: `Invoice ${r.invoiceNumber}`, href: `/billing/invoices/${r.id}` },
      ]),
    );
  }

  // Payment → invoice detail when known, else customer detail
  if (idsByType.Payment) {
    const rows = await prisma.payment.findMany({
      where: { id: { in: [...idsByType.Payment] }, tenantId },
      select: { id: true, amountCents: true, invoiceId: true, customerId: true },
    });
    out.Payment = new Map(
      rows.map((r) => [
        r.id,
        {
          label: `Payment ${dollars(r.amountCents)}`,
          href: r.invoiceId
            ? `/billing/invoices/${r.invoiceId}`
            : `/customers/${r.customerId}`,
        },
      ]),
    );
  }

  // Boat → /customers/:customerId
  if (idsByType.Boat) {
    const rows = await prisma.boat.findMany({
      where: { id: { in: [...idsByType.Boat] }, tenantId },
      select: { id: true, name: true, customerId: true },
    });
    out.Boat = new Map(
      rows.map((r) => [
        r.id,
        { label: r.name ?? "Boat", href: `/customers/${r.customerId}` },
      ]),
    );
  }

  // Contract (SlipContract) → /customers/:customerId
  if (idsByType.Contract) {
    const rows = await prisma.slipContract.findMany({
      where: { id: { in: [...idsByType.Contract] }, tenantId },
      select: {
        id: true,
        customerId: true,
        slip: { select: { slipNumber: true } },
      },
    });
    out.Contract = new Map(
      rows.map((r) => [
        r.id,
        {
          label: r.slip ? `Contract · Slip ${r.slip.slipNumber}` : "Contract",
          href: `/customers/${r.customerId}`,
        },
      ]),
    );
  }

  // InsuranceRecord → /customers/:customerId
  if (idsByType.InsuranceRecord) {
    const rows = await prisma.insuranceRecord.findMany({
      where: { id: { in: [...idsByType.InsuranceRecord] }, tenantId },
      select: {
        id: true,
        insurer: true,
        policyNumber: true,
        customerId: true,
      },
    });
    out.InsuranceRecord = new Map(
      rows.map((r) => {
        const parts: string[] = [];
        if (r.insurer) parts.push(r.insurer);
        if (r.policyNumber) parts.push(`#${r.policyNumber}`);
        return [
          r.id,
          {
            label: parts.length ? parts.join(" ") : "Insurance",
            href: `/customers/${r.customerId}`,
          },
        ];
      }),
    );
  }

  // Lead → label only (no detail page)
  if (idsByType.Lead) {
    const rows = await prisma.lead.findMany({
      where: { id: { in: [...idsByType.Lead] }, tenantId },
      select: { id: true, firstName: true, lastName: true },
    });
    out.Lead = new Map(
      rows.map((r) => [
        r.id,
        { label: `${r.firstName} ${r.lastName}`.trim() || "Lead" },
      ]),
    );
  }

  // Slip → label only (no detail page)
  if (idsByType.Slip) {
    const rows = await prisma.slip.findMany({
      where: { id: { in: [...idsByType.Slip] }, tenantId },
      select: { id: true, slipNumber: true },
    });
    out.Slip = new Map(
      rows.map((r) => [r.id, { label: `Slip ${r.slipNumber}` }]),
    );
  }

  // Announcement → label only
  if (idsByType.Announcement) {
    const rows = await prisma.announcement.findMany({
      where: { id: { in: [...idsByType.Announcement] }, tenantId },
      select: { id: true, subject: true },
    });
    out.Announcement = new Map(
      rows.map((r) => [r.id, { label: r.subject }]),
    );
  }

  // PosTransaction → label only
  if (idsByType.PosTransaction) {
    const rows = await prisma.posTransaction.findMany({
      where: { id: { in: [...idsByType.PosTransaction] }, tenantId },
      select: { id: true, totalCents: true, createdAt: true },
    });
    out.PosTransaction = new Map(
      rows.map((r) => [
        r.id,
        { label: `Sale ${dollars(r.totalCents)} · ${isoDay(r.createdAt)}` },
      ]),
    );
  }

  // Reservation → label only
  if (idsByType.Reservation) {
    const rows = await prisma.reservation.findMany({
      where: { id: { in: [...idsByType.Reservation] }, tenantId },
      select: { id: true, startDt: true },
    });
    out.Reservation = new Map(
      rows.map((r) => [
        r.id,
        { label: `Reservation ${isoDay(r.startDt)}` },
      ]),
    );
  }

  // DockWalk → label only
  if (idsByType.DockWalk) {
    const rows = await prisma.dockWalk.findMany({
      where: { id: { in: [...idsByType.DockWalk] }, tenantId },
      select: { id: true, startedAt: true },
    });
    out.DockWalk = new Map(
      rows.map((r) => [
        r.id,
        { label: `Dock walk ${isoDay(r.startedAt)}` },
      ]),
    );
  }

  // DockWalkItem → label only (tenant-scoped via parent dock walk)
  if (idsByType.DockWalkItem) {
    const rows = await prisma.dockWalkItem.findMany({
      where: {
        id: { in: [...idsByType.DockWalkItem] },
        dockWalk: { tenantId },
      },
      select: {
        id: true,
        slip: { select: { slipNumber: true } },
      },
    });
    out.DockWalkItem = new Map(
      rows.map((r) => [
        r.id,
        { label: r.slip ? `Slip ${r.slip.slipNumber}` : "Inspection item" },
      ]),
    );
  }

  // ── Accounting entries ─────────────────────────────────────────────────
  // None of these have a dedicated detail page; per the task spec they link
  // to the closest sensible settings/accounting page so operators can jump
  // to the right context, with a friendly label resolved from the entity.

  // GlEntry → /accounting (label: account name + signed amount)
  if (idsByType.GlEntry) {
    const rows = await prisma.glEntry.findMany({
      where: { id: { in: [...idsByType.GlEntry] }, tenantId },
      select: {
        id: true,
        debitCents: true,
        creditCents: true,
        account: { select: { accountNumber: true, name: true } },
      },
    });
    out.GlEntry = new Map(
      rows.map((r) => {
        const acct = r.account
          ? `${r.account.accountNumber} · ${r.account.name}`
          : "GL entry";
        const amount =
          r.debitCents > 0
            ? `Dr ${dollars(r.debitCents)}`
            : `Cr ${dollars(r.creditCents)}`;
        return [r.id, { label: `${acct} · ${amount}`, href: `/accounting` }];
      }),
    );
  }

  // PostingAccount audit entries store entityId = locationId, so resolve
  // the location name and link to the per-location accounting hub.
  if (idsByType.PostingAccount) {
    const rows = await prisma.location.findMany({
      where: { id: { in: [...idsByType.PostingAccount] }, tenantId },
      select: { id: true, name: true },
    });
    out.PostingAccount = new Map(
      rows.map((r) => [
        r.id,
        {
          label: `Posting accounts · ${r.name}`,
          href: `/settings/accounting`,
        },
      ]),
    );
  }

  // QboConnection audit entries store entityId = locationId.
  if (idsByType.QboConnection) {
    const rows = await prisma.location.findMany({
      where: { id: { in: [...idsByType.QboConnection] }, tenantId },
      select: { id: true, name: true },
    });
    out.QboConnection = new Map(
      rows.map((r) => [
        r.id,
        {
          label: `QuickBooks · ${r.name}`,
          href: `/settings/quickbooks`,
        },
      ]),
    );
  }

  // AccountingPeriod → /accounting (label: period date range)
  if (idsByType.AccountingPeriod) {
    const rows = await prisma.accountingPeriod.findMany({
      where: { id: { in: [...idsByType.AccountingPeriod] }, tenantId },
      select: { id: true, periodStart: true, periodEnd: true },
    });
    out.AccountingPeriod = new Map(
      rows.map((r) => [
        r.id,
        {
          label: `Period ${isoDay(r.periodStart)} – ${isoDay(r.periodEnd)}`,
          href: `/accounting`,
        },
      ]),
    );
  }

  // TaxRate → /settings/tax-rates
  if (idsByType.TaxRate) {
    const rows = await prisma.taxRate.findMany({
      where: { id: { in: [...idsByType.TaxRate] }, tenantId },
      select: {
        id: true,
        category: true,
        ratePctBps: true,
        jurisdiction: { select: { name: true } },
      },
    });
    out.TaxRate = new Map(
      rows.map((r) => [
        r.id,
        {
          label: `${r.jurisdiction?.name ?? "Tax"} · ${r.category} ${(r.ratePctBps / 100).toFixed(2)}%`,
          href: `/settings/tax-rates`,
        },
      ]),
    );
  }

  // ProductCategoryGlMapping → /settings/products
  if (idsByType.ProductCategoryGlMapping) {
    const rows = await prisma.productCategoryGlMapping.findMany({
      where: {
        id: { in: [...idsByType.ProductCategoryGlMapping] },
        tenantId,
      },
      select: {
        id: true,
        productCategory: { select: { name: true } },
        location: { select: { name: true } },
      },
    });
    out.ProductCategoryGlMapping = new Map(
      rows.map((r) => [
        r.id,
        {
          label: `${r.productCategory?.name ?? "Category"} → ${r.location?.name ?? ""}`.trim(),
          href: `/settings/products`,
        },
      ]),
    );
  }

  // DockageRateGlMapping → /settings/billing
  if (idsByType.DockageRateGlMapping) {
    const rows = await prisma.dockageRateGlMapping.findMany({
      where: { id: { in: [...idsByType.DockageRateGlMapping] }, tenantId },
      select: {
        id: true,
        location: { select: { name: true } },
      },
    });
    out.DockageRateGlMapping = new Map(
      rows.map((r) => [
        r.id,
        {
          label: `Dockage rate GL · ${r.location?.name ?? ""}`.trim(),
          href: `/settings/billing`,
        },
      ]),
    );
  }

  // ServiceFeeGlMapping → /settings/billing
  if (idsByType.ServiceFeeGlMapping) {
    const rows = await prisma.serviceFeeGlMapping.findMany({
      where: { id: { in: [...idsByType.ServiceFeeGlMapping] }, tenantId },
      select: {
        id: true,
        location: { select: { name: true } },
      },
    });
    out.ServiceFeeGlMapping = new Map(
      rows.map((r) => [
        r.id,
        {
          label: `Service fee GL · ${r.location?.name ?? ""}`.trim(),
          href: `/settings/billing`,
        },
      ]),
    );
  }

  // RentalProductGlMapping → /settings/accounting
  if (idsByType.RentalProductGlMapping) {
    const rows = await prisma.rentalProductGlMapping.findMany({
      where: { id: { in: [...idsByType.RentalProductGlMapping] }, tenantId },
      select: {
        id: true,
        rentalProduct: { select: { name: true } },
        location: { select: { name: true } },
      },
    });
    out.RentalProductGlMapping = new Map(
      rows.map((r) => [
        r.id,
        {
          label: `${r.rentalProduct?.name ?? "Rental"} → ${r.location?.name ?? ""}`.trim(),
          href: `/settings/accounting`,
        },
      ]),
    );
  }

  // CostingMethod has no dedicated row — entityId is opaque. Provide a
  // friendly label and link to the accounting hub so operators land in the
  // right place.
  if (idsByType.CostingMethod) {
    out.CostingMethod = new Map(
      [...idsByType.CostingMethod].map((id) => [
        id,
        { label: "Costing method", href: `/settings/accounting` },
      ]),
    );
  }

  return out;
}

export function attachRecordRefs<T extends { recordType: string; recordId: string }>(
  entries: T[],
  refs: Record<string, RecordRefMap>,
): (T & { recordLabel?: string; recordHref?: string })[] {
  return entries.map((e) => {
    const ref = refs[e.recordType]?.get(e.recordId);
    if (!ref) return e;
    return { ...e, recordLabel: ref.label, recordHref: ref.href };
  });
}
