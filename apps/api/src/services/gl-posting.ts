import { prisma } from "../lib/prisma.js";
import { v4 as uuid } from "uuid";
import { isLocationQboConnected } from "./gl-account-resolver.js";

// ---------------------------------------------------------------------------
// GL Posting Service
//
// All financial transactions flow through this service to create double-entry
// GL journal entries.  Every posting function ensures debits === credits.
// Amounts are always in cents (integers).
// ---------------------------------------------------------------------------

interface GlLine {
  accountId: string;
  debitCents: number;
  creditCents: number;
  description?: string;
}

/**
 * Post a balanced set of GL entries within a transaction.
 * Returns the journalId that ties the entries together.
 */
async function postEntries(
  tenantId: string,
  lines: GlLine[],
  sourceType: string,
  sourceId: string,
  tx?: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
): Promise<string> {
  const totalDebits = lines.reduce((s, l) => s + l.debitCents, 0);
  const totalCredits = lines.reduce((s, l) => s + l.creditCents, 0);

  if (totalDebits !== totalCredits) {
    throw new Error(
      `GL entries do not balance: debits=${totalDebits} credits=${totalCredits}`,
    );
  }

  if (totalDebits === 0) {
    throw new Error("GL entries cannot all be zero");
  }

  const journalId = uuid();
  const db = tx ?? prisma;

  await (db as typeof prisma).glEntry.createMany({
    data: lines.map((l) => ({
      id: uuid(),
      tenantId,
      journalId,
      accountId: l.accountId,
      debitCents: l.debitCents,
      creditCents: l.creditCents,
      description: l.description ?? null,
      postedAt: new Date(),
      sourceType,
      sourceId,
    })),
  });

  return journalId;
}

// ---------------------------------------------------------------------------
// Account resolution helpers
// ---------------------------------------------------------------------------

async function getAccountByNumber(
  tenantId: string,
  accountNumber: string,
  tx?: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  locationId?: string | null,
): Promise<string> {
  const db = tx ?? prisma;
  // After per-location chart of accounts, the same account number can exist
  // at multiple locations. When the caller knows the originating location,
  // prefer that location's account first then fall back to tenant-wide
  // (locationId=null) accounts. When no locationId is provided we keep
  // the legacy behaviour — match any row with that number under the tenant
  // — so older callers and fixtures continue to work unchanged.
  if (locationId) {
    const locScoped = await (db as typeof prisma).glAccount.findFirst({
      where: { tenantId, locationId, accountNumber },
      select: { id: true },
    });
    if (locScoped) return locScoped.id;
    const tenantWide = await (db as typeof prisma).glAccount.findFirst({
      where: { tenantId, locationId: null, accountNumber },
      select: { id: true },
    });
    if (tenantWide) return tenantWide.id;
  }
  const account = await (db as typeof prisma).glAccount.findFirst({
    where: { tenantId, accountNumber },
    select: { id: true },
  });
  if (!account) {
    throw new Error(`GL account ${accountNumber} not found for tenant ${tenantId}`);
  }
  return account.id;
}

// Well-known account numbers (convention).
// Note: DEFERRED_REVENUE is the legacy fallback only — at runtime we prefer
// resolving whichever account the tenant has flagged isDeferredRevenue = true
// in their chart of accounts (see getDeferredRevenueAccountId below).
const ACCOUNTS = {
  ACCOUNTS_RECEIVABLE: "1200",
  CASH: "1000",
  BANK: "1010",
  DEFERRED_REVENUE_FALLBACK: "2100",
  SALES_TAX_PAYABLE: "2400",
  STATE_TAX_PAYABLE: "2401",
  COUNTY_TAX_PAYABLE: "2402",
  CITY_TAX_PAYABLE: "2403",
  SECURITY_DEPOSITS_HELD: "2300",
  SLIP_RENTAL_REVENUE: "4000",
  ELECTRICITY_REVENUE: "4100",
  GENERAL_REVENUE: "4500",
  ACH_RETURN_FEE_REVENUE: "4600",
  TERMINATION_INCOME: "4700",
} as const;

/**
 * Emits a warning when a GL account must be resolved from a hardcoded fallback
 * account number rather than from a product's configured GL account mapping.
 * This helps operators identify unconfigured revenue accounts.
 */
function warnGlFallback(tenantId: string, accountNumber: string, context: string): void {
  console.warn(
    `[gl-posting] UNCONFIGURED_GL_MAPPING tenantId=${tenantId} account=${accountNumber} context="${context}" — ` +
    `Revenue is posting to the hardcoded fallback account. Configure a GL account mapping in Settings > Products & Revenue to silence this warning.`,
  );
}

/**
 * Resolve a well-known account by number for a posting that has an
 * originating location.  Mirrors the per-location strictness applied by
 * `postInvoice` to A/R: if the location is QBO-connected we MUST find the
 * account in that location's own chart of accounts — falling back to a
 * tenant-wide row could silently route the entry to a row bound to a
 * different QBO realm (or to no realm at all).  When the location is not
 * QBO-connected we delegate to `getAccountByNumber`, which prefers the
 * location-scoped row first then falls back to legacy tenant-wide entries
 * so older fixtures and single-chart tenants keep working unchanged.
 */
async function resolveLocationScopedAccountByNumber(
  tenantId: string,
  accountNumber: string,
  locationId: string | null | undefined,
  context: string,
  tx?: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
): Promise<string> {
  const qboConnected = locationId
    ? await isLocationQboConnected(locationId)
    : false;
  if (qboConnected && locationId) {
    const db = tx ?? prisma;
    const locScoped = await (db as typeof prisma).glAccount.findFirst({
      where: { tenantId, locationId, accountNumber },
      select: { id: true },
    });
    if (!locScoped) {
      throw new Error(
        `UNCONFIGURED_GL_MAPPING: location ${locationId} is QBO-connected but has no ${accountNumber} account in its chart of accounts (${context}). Import or configure ${accountNumber} for this location before posting.`,
      );
    }
    return locScoped.id;
  }
  return getAccountByNumber(tenantId, accountNumber, tx, locationId ?? null);
}

/** Resolve the deferred-revenue liability account for a tenant.
 *  Prefers the first account flagged isDeferredRevenue = true in their chart
 *  (ordered by accountNumber so 2100 comes before 2110).  Falls back to the
 *  hardcoded "2100" account number if none is flagged.  Returns null if
 *  neither exists (caller falls through to revenue account). */
async function getDeferredRevenueAccountId(
  tenantId: string,
  tx?: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  locationId?: string | null,
): Promise<string | null> {
  const db = tx ?? prisma;
  // Prefer a location-scoped account flagged as deferred when available;
  // otherwise fall through to a tenant-wide flagged account, so per-location
  // QBO charts can pin their own deferred-revenue liability without
  // disturbing tenants still using the legacy single chart.
  const flagged = await (db as typeof prisma).glAccount.findFirst({
    where: locationId
      ? { tenantId, locationId, isDeferredRevenue: true }
      : { tenantId, isDeferredRevenue: true },
    orderBy: { accountNumber: "asc" },
    select: { id: true },
  });
  if (flagged) return flagged.id;
  if (locationId) {
    const tenantWideFlagged = await (db as typeof prisma).glAccount.findFirst({
      where: { tenantId, locationId: null, isDeferredRevenue: true },
      orderBy: { accountNumber: "asc" },
      select: { id: true },
    });
    if (tenantWideFlagged) return tenantWideFlagged.id;
  }

  // Fallback: the default chart seeds 2100 as "Deferred Revenue - Slips"
  try {
    return await getAccountByNumber(
      tenantId,
      ACCOUNTS.DEFERRED_REVENUE_FALLBACK,
      tx,
      locationId,
    );
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Invoice posting
// ---------------------------------------------------------------------------

interface TaxBreakdownInput {
  jurisdictionId: string;
  jurisdictionCode: string;
  kind: string;
  taxCents: number;
  glAccountId: string | null;
}

export async function postInvoice(
  invoice: {
    id: string;
    tenantId: string;
    totalCents: number;
    /** Originating location for the invoice. Used to scope account-number
     *  lookups (A/R, sales tax, fallback revenue) to that location's chart
     *  of accounts and to enforce strict per-location mappings when the
     *  location is QBO-connected. */
    locationId?: string | null;
    lineItems: {
      id: string;
      extendedCents: number;
      taxCents: number;
      glAccountId?: string | null;
      isDeferred: boolean;
    }[];
    /** Per-jurisdiction tax breakdowns from the tax engine. When provided,
     *  revenue and tax are posted to separate accounts.  When absent (old
     *  invoices / no location configured), the existing lumped behaviour is
     *  preserved for backwards compat. */
    taxBreakdowns?: TaxBreakdownInput[];
  },
  tx?: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
): Promise<string> {
  const { tenantId } = invoice;
  const locationId = invoice.locationId ?? null;
  // QBO-connected locations must use their own chart of accounts. Revenue
  // mappings have to be set explicitly per location; we refuse to silently
  // post to a hardcoded fallback account that could belong to another QBO
  // realm (or to no QBO realm at all).
  const qboConnected = locationId
    ? await isLocationQboConnected(locationId)
    : false;
  // For QBO-connected locations the A/R account must come from that
  // location's own chart of accounts. Falling back to a tenant-wide "1200"
  // could cross-post to the wrong realm or to a default-seeded account that
  // doesn't exist in QBO at all — refuse that and make the operator pin a
  // location-scoped A/R account.
  let arAccountId: string;
  if (qboConnected && locationId) {
    const db = tx ?? prisma;
    const locAr = await (db as typeof prisma).glAccount.findFirst({
      where: { tenantId, locationId, accountNumber: ACCOUNTS.ACCOUNTS_RECEIVABLE },
      select: { id: true },
    });
    if (!locAr) {
      throw new Error(
        `UNCONFIGURED_GL_MAPPING: location ${locationId} is QBO-connected but has no A/R account (${ACCOUNTS.ACCOUNTS_RECEIVABLE}) in its chart of accounts. Import or configure A/R for this location before posting.`,
      );
    }
    arAccountId = locAr.id;
  } else {
    arAccountId = await getAccountByNumber(tenantId, ACCOUNTS.ACCOUNTS_RECEIVABLE, tx, locationId);
  }
  const deferredAccountId = await getDeferredRevenueAccountId(tenantId, tx, locationId);

  const lines: GlLine[] = [];

  // Debit: Accounts Receivable for total (including tax)
  lines.push({
    accountId: arAccountId,
    debitCents: invoice.totalCents,
    creditCents: 0,
    description: `Invoice ${invoice.id} — A/R`,
  });

  const hasJurisdictionBreakdowns =
    invoice.taxBreakdowns && invoice.taxBreakdowns.length > 0;

  if (hasJurisdictionBreakdowns) {
    // ── New path: separate revenue from tax liabilities ──────────────────
    // Credit revenue accounts for extendedCents only (tax is posted separately)
    for (const li of invoice.lineItems) {
      if (li.extendedCents === 0) continue;

      if (li.isDeferred && deferredAccountId) {
        lines.push({
          accountId: deferredAccountId,
          debitCents: 0,
          creditCents: li.extendedCents,
          description: `Invoice ${invoice.id} — deferred revenue`,
        });
      } else {
        let revenueAccountId: string;
        if (li.glAccountId) {
          revenueAccountId = li.glAccountId;
        } else if (qboConnected) {
          // Per-location QBO charts must not fall back to a hardcoded
          // tenant-wide account number — that account belongs to a
          // different chart of accounts. Surface the misconfiguration
          // so operators map it explicitly in Settings > Products & Revenue.
          throw new Error(
            `UNCONFIGURED_GL_MAPPING: Invoice ${invoice.id} line ${li.id} ` +
            `has no revenue GL account and the originating location is ` +
            `connected to QuickBooks. Configure a per-location revenue ` +
            `mapping for this product before issuing the invoice.`,
          );
        } else {
          warnGlFallback(tenantId, ACCOUNTS.GENERAL_REVENUE, `invoice=${invoice.id} lineItem=${li.id}`);
          revenueAccountId = await getAccountByNumber(tenantId, ACCOUNTS.GENERAL_REVENUE, tx, locationId);
        }
        lines.push({
          accountId: revenueAccountId,
          debitCents: 0,
          creditCents: li.extendedCents,
          description: `Invoice ${invoice.id} — revenue`,
        });
      }
    }

    // Credit per-jurisdiction Sales Tax Payable accounts
    // Group by glAccountId so we don't issue one createMany entry per line item
    const taxByAccount = new Map<string | null, number>();
    for (const bd of invoice.taxBreakdowns!) {
      const key = bd.glAccountId ?? null;
      taxByAccount.set(key, (taxByAccount.get(key) ?? 0) + bd.taxCents);
    }

    for (const [glAccountId, taxCents] of taxByAccount) {
      if (taxCents === 0) continue;

      let taxAccountId: string;
      if (glAccountId) {
        // TaxRate has a specific GL account configured
        taxAccountId = glAccountId;
      } else {
        // Fall back to 2400 Sales Tax Payable
        taxAccountId = await getAccountByNumber(tenantId, ACCOUNTS.SALES_TAX_PAYABLE, tx, locationId).catch(async () =>
          getAccountByNumber(tenantId, ACCOUNTS.STATE_TAX_PAYABLE, tx, locationId),
        );
      }

      lines.push({
        accountId: taxAccountId,
        debitCents: 0,
        creditCents: taxCents,
        description: `Invoice ${invoice.id} — sales tax`,
      });
    }
  } else {
    // ── Legacy path: lump revenue + tax together ─────────────────────────
    for (const li of invoice.lineItems) {
      const lineTotal = li.extendedCents + li.taxCents;
      if (lineTotal === 0) continue;

      if (li.isDeferred && deferredAccountId) {
        lines.push({
          accountId: deferredAccountId,
          debitCents: 0,
          creditCents: lineTotal,
          description: `Invoice ${invoice.id} — deferred revenue`,
        });
      } else {
        let revenueAccountId: string;
        if (li.glAccountId) {
          revenueAccountId = li.glAccountId;
        } else if (qboConnected) {
          throw new Error(
            `UNCONFIGURED_GL_MAPPING: Invoice ${invoice.id} line ${li.id} ` +
            `has no revenue GL account and the originating location is ` +
            `connected to QuickBooks. Configure a per-location revenue ` +
            `mapping for this product before issuing the invoice.`,
          );
        } else {
          warnGlFallback(tenantId, ACCOUNTS.GENERAL_REVENUE, `invoice=${invoice.id} lineItem=${li.id} (legacy path)`);
          revenueAccountId = await getAccountByNumber(tenantId, ACCOUNTS.GENERAL_REVENUE, tx, locationId);
        }
        lines.push({
          accountId: revenueAccountId,
          debitCents: 0,
          creditCents: lineTotal,
          description: `Invoice ${invoice.id} — revenue`,
        });
      }
    }
  }

  return postEntries(tenantId, lines, "INVOICE", invoice.id, tx);
}

// ---------------------------------------------------------------------------
// Payment posting
// ---------------------------------------------------------------------------

export async function postPayment(
  payment: {
    id: string;
    tenantId: string;
    amountCents: number;
    method: string;
    /** Originating location (typically `payment.invoice.locationId`).
     *  Used to scope the A/R and bank/cash account lookups to that
     *  location's chart of accounts.  Without this the helpers fall
     *  back to whichever row Prisma returned first — frequently the
     *  wrong location's account in a per-location chart layout. */
    locationId?: string | null;
  },
  tx?: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
): Promise<string> {
  const { tenantId } = payment;
  const locationId = payment.locationId ?? null;

  // Cash/card/ACH all go to bank; physical cash could use a separate account
  const cashAccountNumber =
    payment.method === "CASH" ? ACCOUNTS.CASH : ACCOUNTS.BANK;

  const cashAccountId = await resolveLocationScopedAccountByNumber(
    tenantId,
    cashAccountNumber,
    locationId,
    `payment=${payment.id}`,
    tx,
  );
  const arAccountId = await resolveLocationScopedAccountByNumber(
    tenantId,
    ACCOUNTS.ACCOUNTS_RECEIVABLE,
    locationId,
    `payment=${payment.id}`,
    tx,
  );

  return postEntries(
    tenantId,
    [
      {
        accountId: cashAccountId,
        debitCents: payment.amountCents,
        creditCents: 0,
        description: `Payment ${payment.id} — cash/bank`,
      },
      {
        accountId: arAccountId,
        debitCents: 0,
        creditCents: payment.amountCents,
        description: `Payment ${payment.id} — A/R reduction`,
      },
    ],
    "PAYMENT",
    payment.id,
    tx,
  );
}

// ---------------------------------------------------------------------------
// Refund posting (reverse of payment)
// ---------------------------------------------------------------------------

export async function postRefund(
  payment: {
    id: string;
    tenantId: string;
    amountCents: number;
    method: string;
    /** Originating location (typically `payment.invoice.locationId`).
     *  Scopes A/R and bank/cash lookups so the refund reverses the
     *  same per-location accounts the original payment touched. */
    locationId?: string | null;
  },
  refundAmountCents: number,
  tx?: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
): Promise<string> {
  const { tenantId } = payment;
  const locationId = payment.locationId ?? null;

  const cashAccountNumber =
    payment.method === "CASH" ? ACCOUNTS.CASH : ACCOUNTS.BANK;

  const cashAccountId = await resolveLocationScopedAccountByNumber(
    tenantId,
    cashAccountNumber,
    locationId,
    `refund payment=${payment.id}`,
    tx,
  );
  const arAccountId = await resolveLocationScopedAccountByNumber(
    tenantId,
    ACCOUNTS.ACCOUNTS_RECEIVABLE,
    locationId,
    `refund payment=${payment.id}`,
    tx,
  );

  return postEntries(
    tenantId,
    [
      {
        accountId: arAccountId,
        debitCents: refundAmountCents,
        creditCents: 0,
        description: `Refund on payment ${payment.id} — A/R reinstatement`,
      },
      {
        accountId: cashAccountId,
        debitCents: 0,
        creditCents: refundAmountCents,
        description: `Refund on payment ${payment.id} — cash/bank`,
      },
    ],
    "REFUND",
    payment.id,
    tx,
  );
}

// ---------------------------------------------------------------------------
// Refund reversal — undo a previously-posted REFUND when the external
// processor refund (e.g. Stripe) ultimately failed. Posts the inverse of
// postRefund so the net effect on AR / cash / bank is zero.
// ---------------------------------------------------------------------------

export async function reversePostRefund(
  payment: {
    id: string;
    tenantId: string;
    method: string;
    /** Originating location of the original payment.  The reversal must
     *  hit exactly the same per-location A/R and bank rows that
     *  `postRefund` touched, otherwise the inverse leaves the chart
     *  unbalanced across locations. */
    locationId?: string | null;
  },
  refundAmountCents: number,
  tx?: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
): Promise<string> {
  const { tenantId } = payment;
  const locationId = payment.locationId ?? null;

  const cashAccountNumber =
    payment.method === "CASH" ? ACCOUNTS.CASH : ACCOUNTS.BANK;

  const cashAccountId = await resolveLocationScopedAccountByNumber(
    tenantId,
    cashAccountNumber,
    locationId,
    `refund reversal payment=${payment.id}`,
    tx,
  );
  const arAccountId = await resolveLocationScopedAccountByNumber(
    tenantId,
    ACCOUNTS.ACCOUNTS_RECEIVABLE,
    locationId,
    `refund reversal payment=${payment.id}`,
    tx,
  );

  return postEntries(
    tenantId,
    [
      {
        accountId: cashAccountId,
        debitCents: refundAmountCents,
        creditCents: 0,
        description: `Refund reversal on payment ${payment.id} — cash/bank`,
      },
      {
        accountId: arAccountId,
        debitCents: 0,
        creditCents: refundAmountCents,
        description: `Refund reversal on payment ${payment.id} — A/R restored`,
      },
    ],
    "REFUND_REVERSAL",
    payment.id,
    tx,
  );
}

// ---------------------------------------------------------------------------
// Void invoice (reverse all invoice GL entries)
// ---------------------------------------------------------------------------

export async function postVoid(
  invoice: {
    id: string;
    tenantId: string;
  },
  tx?: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
): Promise<string> {
  const db = tx ?? prisma;
  const { tenantId } = invoice;

  // Find original GL entries for this invoice
  const originalEntries = await (db as typeof prisma).glEntry.findMany({
    where: { tenantId, sourceType: "INVOICE", sourceId: invoice.id },
  });

  if (originalEntries.length === 0) {
    throw new Error(`No GL entries found for invoice ${invoice.id}`);
  }

  // Create reversing entries (swap debit/credit)
  const lines: GlLine[] = originalEntries.map((e) => ({
    accountId: e.accountId,
    debitCents: e.creditCents,
    creditCents: e.debitCents,
    description: `VOID reversal — ${e.description ?? ""}`,
  }));

  return postEntries(tenantId, lines, "VOID", invoice.id, tx);
}

// ---------------------------------------------------------------------------
// Security deposit posting
// ---------------------------------------------------------------------------

export async function postSecurityDeposit(
  deposit: {
    id: string;
    tenantId: string;
    amountCents: number;
    /** Originating location for the deposit (typically derived from
     *  the contract's slip).  Scopes the bank and security-deposits
     *  liability lookups to the location's chart of accounts. */
    locationId?: string | null;
  },
  tx?: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
): Promise<string> {
  const { tenantId } = deposit;
  const locationId = deposit.locationId ?? null;

  const cashAccountId = await resolveLocationScopedAccountByNumber(
    tenantId,
    ACCOUNTS.BANK,
    locationId,
    `security deposit=${deposit.id}`,
    tx,
  );
  const liabilityAccountId = await resolveLocationScopedAccountByNumber(
    tenantId,
    ACCOUNTS.SECURITY_DEPOSITS_HELD,
    locationId,
    `security deposit=${deposit.id}`,
    tx,
  );

  return postEntries(
    tenantId,
    [
      {
        accountId: cashAccountId,
        debitCents: deposit.amountCents,
        creditCents: 0,
        description: `Security deposit ${deposit.id} received`,
      },
      {
        accountId: liabilityAccountId,
        debitCents: 0,
        creditCents: deposit.amountCents,
        description: `Security deposit ${deposit.id} liability`,
      },
    ],
    "SECURITY_DEPOSIT",
    deposit.id,
    tx,
  );
}

// ---------------------------------------------------------------------------
// Release security deposit
// ---------------------------------------------------------------------------

export async function releaseSecurityDeposit(
  deposit: {
    id: string;
    tenantId: string;
    amountCents: number;
    appliedToInvoiceId?: string | null;
    /** Originating location.  Scopes the security-deposits liability,
     *  A/R (when applying to an invoice), and bank (when refunding to
     *  customer) lookups to the location's chart of accounts so the
     *  release reverses the same per-location rows the original
     *  `postSecurityDeposit` touched. */
    locationId?: string | null;
  },
  tx?: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
): Promise<string> {
  const { tenantId } = deposit;
  const locationId = deposit.locationId ?? null;

  const liabilityAccountId = await resolveLocationScopedAccountByNumber(
    tenantId,
    ACCOUNTS.SECURITY_DEPOSITS_HELD,
    locationId,
    `security deposit release=${deposit.id}`,
    tx,
  );

  if (deposit.appliedToInvoiceId) {
    // Apply to invoice: debit liability, credit A/R
    const arAccountId = await resolveLocationScopedAccountByNumber(
      tenantId,
      ACCOUNTS.ACCOUNTS_RECEIVABLE,
      locationId,
      `security deposit release=${deposit.id}`,
      tx,
    );
    return postEntries(
      tenantId,
      [
        {
          accountId: liabilityAccountId,
          debitCents: deposit.amountCents,
          creditCents: 0,
          description: `Security deposit ${deposit.id} applied to invoice`,
        },
        {
          accountId: arAccountId,
          debitCents: 0,
          creditCents: deposit.amountCents,
          description: `Security deposit ${deposit.id} applied — A/R reduction`,
        },
      ],
      "DEPOSIT_RELEASE",
      deposit.id,
      tx,
    );
  } else {
    // Refund to customer: debit liability, credit cash
    const cashAccountId = await resolveLocationScopedAccountByNumber(
      tenantId,
      ACCOUNTS.BANK,
      locationId,
      `security deposit release=${deposit.id}`,
      tx,
    );
    return postEntries(
      tenantId,
      [
        {
          accountId: liabilityAccountId,
          debitCents: deposit.amountCents,
          creditCents: 0,
          description: `Security deposit ${deposit.id} released`,
        },
        {
          accountId: cashAccountId,
          debitCents: 0,
          creditCents: deposit.amountCents,
          description: `Security deposit ${deposit.id} refunded`,
        },
      ],
      "DEPOSIT_RELEASE",
      deposit.id,
      tx,
    );
  }
}

// ---------------------------------------------------------------------------
// ACH Return posting (reverse payment)
// ---------------------------------------------------------------------------

export async function postAchReturn(
  achReturn: {
    id: string;
    tenantId: string;
    paymentId: string;
    amountCents: number;
    /** Originating location of the underlying payment (typically
     *  `payment.invoice.locationId`).  The reversal must touch the
     *  same per-location bank and A/R rows the original payment
     *  posted into. */
    locationId?: string | null;
  },
  tx?: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
): Promise<string> {
  const { tenantId } = achReturn;
  const locationId = achReturn.locationId ?? null;

  const bankAccountId = await resolveLocationScopedAccountByNumber(
    tenantId,
    ACCOUNTS.BANK,
    locationId,
    `ach return=${achReturn.id}`,
    tx,
  );
  const arAccountId = await resolveLocationScopedAccountByNumber(
    tenantId,
    ACCOUNTS.ACCOUNTS_RECEIVABLE,
    locationId,
    `ach return=${achReturn.id}`,
    tx,
  );

  return postEntries(
    tenantId,
    [
      {
        accountId: arAccountId,
        debitCents: achReturn.amountCents,
        creditCents: 0,
        description: `ACH return ${achReturn.id} — A/R reinstated`,
      },
      {
        accountId: bankAccountId,
        debitCents: 0,
        creditCents: achReturn.amountCents,
        description: `ACH return ${achReturn.id} — bank reversal`,
      },
    ],
    "ACH_RETURN",
    achReturn.id,
    tx,
  );
}

// ---------------------------------------------------------------------------
// Deferred revenue recognition
// ---------------------------------------------------------------------------

export async function postDeferredRecognition(
  entry: {
    id: string;
    tenantId: string;
    amountCents: number;
    revenueAccountId?: string;
  },
  tx?: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
): Promise<string> {
  const { tenantId } = entry;

  const deferredAccountId = await getDeferredRevenueAccountId(tenantId, tx);
  if (!deferredAccountId) throw new Error(`No deferred-revenue GL account found for tenant ${tenantId}`);
  const revenueAccountId =
    entry.revenueAccountId ??
    (await getAccountByNumber(tenantId, ACCOUNTS.GENERAL_REVENUE, tx));

  return postEntries(
    tenantId,
    [
      {
        accountId: deferredAccountId,
        debitCents: entry.amountCents,
        creditCents: 0,
        description: `Deferred recognition ${entry.id}`,
      },
      {
        accountId: revenueAccountId,
        debitCents: 0,
        creditCents: entry.amountCents,
        description: `Revenue recognition ${entry.id}`,
      },
    ],
    "DEFERRED_RECOGNITION",
    entry.id,
    tx,
  );
}

// ---------------------------------------------------------------------------
// Early termination posting
// ---------------------------------------------------------------------------

export async function postEarlyTermination(
  contract: {
    id: string;
    tenantId: string;
  },
  penaltyCents: number,
  remainingDeferredCents: number,
  tx?: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
): Promise<string[]> {
  const { tenantId } = contract;
  const journalIds: string[] = [];

  // 1. Recognize penalty — debit A/R, credit Termination Income
  if (penaltyCents > 0) {
    const arAccountId = await getAccountByNumber(tenantId, ACCOUNTS.ACCOUNTS_RECEIVABLE, tx);
    const termIncomeAccountId = await getAccountByNumber(tenantId, ACCOUNTS.TERMINATION_INCOME, tx);

    const jid = await postEntries(
      tenantId,
      [
        {
          accountId: arAccountId,
          debitCents: penaltyCents,
          creditCents: 0,
          description: `Early termination penalty — contract ${contract.id}`,
        },
        {
          accountId: termIncomeAccountId,
          debitCents: 0,
          creditCents: penaltyCents,
          description: `Early termination income — contract ${contract.id}`,
        },
      ],
      "EARLY_TERMINATION",
      contract.id,
      tx,
    );
    journalIds.push(jid);
  }

  // 2. Wash out remaining deferred revenue to revenue
  if (remainingDeferredCents > 0) {
    const deferredAccountId = await getDeferredRevenueAccountId(tenantId, tx);
    if (!deferredAccountId) throw new Error(`No deferred-revenue GL account found for tenant ${tenantId}`);
    const revenueAccountId = await getAccountByNumber(tenantId, ACCOUNTS.GENERAL_REVENUE, tx);

    const jid = await postEntries(
      tenantId,
      [
        {
          accountId: deferredAccountId,
          debitCents: remainingDeferredCents,
          creditCents: 0,
          description: `Deferred washout — contract ${contract.id}`,
        },
        {
          accountId: revenueAccountId,
          debitCents: 0,
          creditCents: remainingDeferredCents,
          description: `Revenue acceleration — contract ${contract.id}`,
        },
      ],
      "DEFERRED_WASHOUT",
      contract.id,
      tx,
    );
    journalIds.push(jid);
  }

  return journalIds;
}

// ---------------------------------------------------------------------------
// Manual journal entry
// ---------------------------------------------------------------------------

export async function postManualJournalEntry(
  tenantId: string,
  entries: {
    accountId: string;
    debitCents: number;
    creditCents: number;
    description?: string;
  }[],
  sourceDescription?: string,
): Promise<string> {
  const sourceId = uuid();
  return postEntries(tenantId, entries, "MANUAL_JOURNAL", sourceId);
}
