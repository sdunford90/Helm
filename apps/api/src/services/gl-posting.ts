import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { v4 as uuid } from "uuid";
import {
  isLocationQboConnected,
  resolveLocationSystemPostingAccount,
  resolveProductGlAccounts,
} from "./gl-account-resolver.js";
import { assertPeriodOpen } from "./period-guard.js";
import { restoreInventoryOnReturn } from "./costing-engine.js";

/**
 * Loud-failure guard for posting consumers: when a stored line item carries a
 * product provenance (`sourceType === "PRODUCT"`) but no `glAccountId`, the
 * per-(category, location) ProductCategoryGlMapping is missing for that
 * inventory line. Throws the operator-facing `MISSING_GL_MAPPING` error in
 * the canonical wording so UIs can deep-link to Settings → Categories instead
 * of silently posting the credit to a tenant-wide fallback account.
 *
 * Applied uniformly to BOTH QBO-connected and non-QBO contexts — the
 * post-collapse model has no tenant-wide fallback for inventory products.
 * Non-product (ad-hoc) lines fall through and the legacy resolver chain
 * still applies.
 */
async function assertProductLineGlMappedOrThrow(
  tenantId: string,
  invoiceId: string,
  locationId: string | null,
  li: {
    id: string;
    glAccountId?: string | null;
    sourceType?: string | null;
    sourceId?: string | null;
  },
  tx?: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
): Promise<void> {
  if (li.glAccountId) return;
  if (li.sourceType?.toUpperCase() !== "PRODUCT") return;
  const productId = li.sourceId ?? null;
  if (!productId) return;
  const db = tx ?? prisma;
  const product = await (db as typeof prisma).product.findFirst({
    where: { id: productId, tenantId },
    select: {
      productCategory: { select: { name: true } },
    },
  });
  const categoryName = product?.productCategory?.name ?? "(uncategorized)";
  const loc = locationId
    ? await (db as typeof prisma).location.findFirst({
        where: { id: locationId, tenantId },
        select: { name: true },
      })
    : null;
  const locationName = loc?.name ?? locationId ?? "(no location)";
  throw new Error(
    `MISSING_GL_MAPPING: Missing GL mapping for category "${categoryName}" ` +
    `at location "${locationName}". Configure the revenue GL account in ` +
    `Settings → Categories → Per-location mappings before issuing this ` +
    `invoice (invoice=${invoiceId} lineItem=${li.id}).`,
  );
}

// Look up the location-pinned posting accounts (AR / undeposited funds /
// deferred revenue). Returns nulls when the location has nothing pinned;
// callers fall back to account-number lookup. Kept in this module so the
// posting helpers don't pull the public resolver type into every caller.
async function getLocationPinnedPostingAccounts(
  locationId: string,
  tx?: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
): Promise<{
  arGlAccountId: string | null;
  undepositedFundsGlAccountId: string | null;
  deferredRevenueGlAccountId: string | null;
}> {
  const db = tx ?? prisma;
  const loc = await (db as typeof prisma).location.findUnique({
    where: { id: locationId },
    select: {
      arGlAccountId: true,
      undepositedFundsGlAccountId: true,
      deferredRevenueGlAccountId: true,
    },
  });
  return {
    arGlAccountId: loc?.arGlAccountId ?? null,
    undepositedFundsGlAccountId: loc?.undepositedFundsGlAccountId ?? null,
    deferredRevenueGlAccountId: loc?.deferredRevenueGlAccountId ?? null,
  };
}

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
  locationId?: string | null,
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

  const entryDate = new Date();
  await assertPeriodOpen(tenantId, locationId, entryDate, tx as Parameters<typeof assertPeriodOpen>[3]);

  const journalId = uuid();
  const db = tx ?? prisma;

  await (db as typeof prisma).glEntry.createMany({
    data: lines.map((l) => ({
      id: uuid(),
      tenantId,
      journalId,
      locationId: locationId ?? null,
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
//
// Only the four accounts that still flow through `getAccountByNumber` /
// `resolveLocationScopedAccountByNumber` live here; the four "system"
// posting accounts that used to fall back by number — default revenue
// (4500), sales tax payable (2400), early-termination income (4700), and
// ACH return fee (4600) — have moved into per-location pinned slots
// (Location.{defaultRevenue,salesTax,earlyTermination,achReturnFee}-
// GlAccountId) resolved by `resolveLocationSystemPostingAccount` in
// gl-account-resolver.ts.
//
// Note: DEFERRED_REVENUE_FALLBACK is the legacy fallback only — at runtime
// we prefer resolving whichever account the tenant has flagged
// isDeferredRevenue = true in their chart of accounts (see
// `getDeferredRevenueAccountId` below).
const ACCOUNTS = {
  ACCOUNTS_RECEIVABLE: "1200",
  CASH: "1000",
  BANK: "1010",
  DEFERRED_REVENUE_FALLBACK: "2100",
  SECURITY_DEPOSITS_HELD: "2300",
} as const;

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
  // 1. Honour the explicit per-location pin first — it's the contract
  //    operators set in QuickBooks Setup and never falls back across realms.
  if (locationId) {
    const pinned = await getLocationPinnedPostingAccounts(locationId, tx);
    if (pinned.deferredRevenueGlAccountId) return pinned.deferredRevenueGlAccountId;
  }
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
      /** Source signals used to detect product-backed lines so we can
       *  fail loudly when an inventory line is missing its per-(category,
       *  location) GL mapping instead of silently posting to a tenant-wide
       *  fallback. Either may be set independently. */
      sourceType?: string | null;
      sourceId?: string | null;
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
  // Posting-account resolution chain for A/R:
  //   1. Location-pinned arGlAccountId (set in QuickBooks Setup)
  //   2. Location-scoped chart row matching account number 1200
  //   3. Tenant-wide chart row matching account number 1200
  // For QBO-connected locations we refuse step 3, because falling back to a
  // tenant-wide "1200" could cross-post to the wrong realm or to a default-
  // seeded account that doesn't exist in QBO at all.
  let arAccountId: string;
  const pinned = locationId
    ? await getLocationPinnedPostingAccounts(locationId, tx)
    : { arGlAccountId: null, undepositedFundsGlAccountId: null, deferredRevenueGlAccountId: null };
  if (pinned.arGlAccountId) {
    arAccountId = pinned.arGlAccountId;
  } else if (qboConnected && locationId) {
    const db = tx ?? prisma;
    const locAr = await (db as typeof prisma).glAccount.findFirst({
      where: { tenantId, locationId, accountNumber: ACCOUNTS.ACCOUNTS_RECEIVABLE },
      select: { id: true },
    });
    if (!locAr) {
      throw new Error(
        `UNCONFIGURED_GL_MAPPING: location ${locationId} is QBO-connected but has no A/R account pinned and no account number ${ACCOUNTS.ACCOUNTS_RECEIVABLE} in its chart of accounts. Pin an A/R account for this location in QuickBooks Setup before posting.`,
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
        } else {
          // Inventory product lines must have their per-(category, location)
          // mapping resolved upstream — fail loudly with the operator-facing
          // wording instead of silently posting to a tenant-wide fallback.
          // Applies uniformly to QBO and non-QBO contexts.
          await assertProductLineGlMappedOrThrow(
            tenantId,
            invoice.id,
            locationId,
            li,
            tx,
          );
          if (qboConnected) {
            // QBO-connected, non-product line (ad-hoc revenue) — still must
            // be mapped explicitly because tenant-wide accounts cross realms.
            throw new Error(
              `UNCONFIGURED_GL_MAPPING: Invoice ${invoice.id} line ${li.id} ` +
              `has no revenue GL account and the originating location is ` +
              `connected to QuickBooks. Configure a per-location revenue ` +
              `mapping for this product before issuing the invoice.`,
            );
          }
          // Non-QBO, non-product (ad-hoc) line: defer to the location's
          // pinned default revenue slot, else the legacy chart-of-accounts
          // lookup by account number 4500.
          revenueAccountId = await resolveLocationSystemPostingAccount(
            tenantId,
            locationId,
            "defaultRevenue",
            `invoice=${invoice.id} lineItem=${li.id}`,
            tx,
          );
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
        // No rate-level GL account: defer to the location's pinned sales-tax
        // payable slot. QBO-connected locations REQUIRE the pin — silently
        // posting to the legacy 2400/2401 row would route the liability to
        // a different realm's chart.
        taxAccountId = await resolveLocationSystemPostingAccount(
          tenantId,
          locationId,
          "salesTax",
          `invoice=${invoice.id} sales tax`,
          tx,
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
        } else {
          // Same loud-failure rule as the per-jurisdiction path: inventory
          // product lines must be mapped per (category, location).
          await assertProductLineGlMappedOrThrow(
            tenantId,
            invoice.id,
            locationId,
            li,
            tx,
          );
          if (qboConnected) {
            throw new Error(
              `UNCONFIGURED_GL_MAPPING: Invoice ${invoice.id} line ${li.id} ` +
              `has no revenue GL account and the originating location is ` +
              `connected to QuickBooks. Configure a per-location revenue ` +
              `mapping for this product before issuing the invoice.`,
            );
          }
          revenueAccountId = await resolveLocationSystemPostingAccount(
            tenantId,
            locationId,
            "defaultRevenue",
            `invoice=${invoice.id} lineItem=${li.id} (legacy path)`,
            tx,
          );
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

  return postEntries(tenantId, lines, "INVOICE", invoice.id, tx, locationId);
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
     *  Posting-account resolution chain: (1) the location's pinned cash +
     *  A/R accounts (set in QuickBooks Setup), then (2) the location-scoped
     *  chart row matching the well-known account number, then (3) the
     *  tenant-wide chart row.  Without this the helpers fall back to
     *  whichever row Prisma returned first — frequently the wrong
     *  location's account in a per-location chart layout — and for
     *  QBO-connected locations could cross-post to the wrong realm. */
    locationId?: string | null;
  },
  tx?: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
): Promise<string> {
  const { tenantId } = payment;
  const locationId = payment.locationId ?? null;

  // Cash/card/ACH all go to bank; physical cash could use a separate account
  const cashAccountNumber =
    payment.method === "CASH" ? ACCOUNTS.CASH : ACCOUNTS.BANK;

  const pinned = locationId
    ? await getLocationPinnedPostingAccounts(locationId, tx)
    : { arGlAccountId: null, undepositedFundsGlAccountId: null, deferredRevenueGlAccountId: null };
  const cashAccountId =
    pinned.undepositedFundsGlAccountId
    ?? (await resolveLocationScopedAccountByNumber(
      tenantId,
      cashAccountNumber,
      locationId,
      `payment=${payment.id}`,
      tx,
    ));
  const arAccountId =
    pinned.arGlAccountId
    ?? (await resolveLocationScopedAccountByNumber(
      tenantId,
      ACCOUNTS.ACCOUNTS_RECEIVABLE,
      locationId,
      `payment=${payment.id}`,
      tx,
    ));

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
    locationId,
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
     *  Resolution chain: pinned cash + A/R → location-scoped chart row →
     *  tenant-wide chart row.  Reverses the same per-location accounts
     *  the original payment touched. */
    locationId?: string | null;
  },
  refundAmountCents: number,
  tx?: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
): Promise<string> {
  const { tenantId } = payment;
  const locationId = payment.locationId ?? null;

  const cashAccountNumber =
    payment.method === "CASH" ? ACCOUNTS.CASH : ACCOUNTS.BANK;

  const pinned = locationId
    ? await getLocationPinnedPostingAccounts(locationId, tx)
    : { arGlAccountId: null, undepositedFundsGlAccountId: null, deferredRevenueGlAccountId: null };
  const cashAccountId =
    pinned.undepositedFundsGlAccountId
    ?? (await resolveLocationScopedAccountByNumber(
      tenantId,
      cashAccountNumber,
      locationId,
      `refund payment=${payment.id}`,
      tx,
    ));
  const arAccountId =
    pinned.arGlAccountId
    ?? (await resolveLocationScopedAccountByNumber(
      tenantId,
      ACCOUNTS.ACCOUNTS_RECEIVABLE,
      locationId,
      `refund payment=${payment.id}`,
      tx,
    ));

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
    locationId,
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
    /** Originating location of the original payment.  Resolution chain:
     *  pinned cash + A/R → location-scoped chart row → tenant-wide chart
     *  row.  The reversal must hit exactly the same per-location rows
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

  const pinned = locationId
    ? await getLocationPinnedPostingAccounts(locationId, tx)
    : { arGlAccountId: null, undepositedFundsGlAccountId: null, deferredRevenueGlAccountId: null };
  const cashAccountId =
    pinned.undepositedFundsGlAccountId
    ?? (await resolveLocationScopedAccountByNumber(
      tenantId,
      cashAccountNumber,
      locationId,
      `refund reversal payment=${payment.id}`,
      tx,
    ));
  const arAccountId =
    pinned.arGlAccountId
    ?? (await resolveLocationScopedAccountByNumber(
      tenantId,
      ACCOUNTS.ACCOUNTS_RECEIVABLE,
      locationId,
      `refund reversal payment=${payment.id}`,
      tx,
    ));

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
    locationId,
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

  // Derive locationId from the original entries (all entries in a journal share
  // the same location). Used for period-lock check and to tag the reversal rows.
  const voidLocationId = originalEntries[0]?.locationId ?? null;

  return postEntries(tenantId, lines, "VOID", invoice.id, tx, voidLocationId);
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
    locationId,
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
     *  `payment.invoice.locationId`).  Resolution chain: pinned cash + A/R
     *  → location-scoped chart row → tenant-wide chart row.  The reversal
     *  must touch the same per-location bank and A/R rows the original
     *  payment posted into. */
    locationId?: string | null;
  },
  tx?: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
): Promise<string> {
  const { tenantId } = achReturn;
  const locationId = achReturn.locationId ?? null;

  const pinned = locationId
    ? await getLocationPinnedPostingAccounts(locationId, tx)
    : { arGlAccountId: null, undepositedFundsGlAccountId: null, deferredRevenueGlAccountId: null };
  const bankAccountId =
    pinned.undepositedFundsGlAccountId
    ?? (await resolveLocationScopedAccountByNumber(
      tenantId,
      ACCOUNTS.BANK,
      locationId,
      `ach return=${achReturn.id}`,
      tx,
    ));
  const arAccountId =
    pinned.arGlAccountId
    ?? (await resolveLocationScopedAccountByNumber(
      tenantId,
      ACCOUNTS.ACCOUNTS_RECEIVABLE,
      locationId,
      `ach return=${achReturn.id}`,
      tx,
    ));

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
    locationId?: string | null;
  },
  tx?: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
): Promise<string> {
  const { tenantId } = entry;
  const locationId = entry.locationId ?? null;

  const deferredAccountId = await getDeferredRevenueAccountId(tenantId, tx, locationId);
  if (!deferredAccountId) throw new Error(`No deferred-revenue GL account found for tenant ${tenantId}`);
  const revenueAccountId =
    entry.revenueAccountId ??
    (await resolveLocationSystemPostingAccount(
      tenantId,
      locationId,
      "defaultRevenue",
      `deferred recognition ${entry.id}`,
      tx,
    ));

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
    locationId?: string | null;
  },
  penaltyCents: number,
  remainingDeferredCents: number,
  tx?: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
): Promise<string[]> {
  const { tenantId } = contract;
  const locationId = contract.locationId ?? null;
  const journalIds: string[] = [];

  // 1. Recognize penalty — debit A/R, credit Termination Income
  if (penaltyCents > 0) {
    const pinned = locationId
      ? await getLocationPinnedPostingAccounts(locationId, tx)
      : { arGlAccountId: null, undepositedFundsGlAccountId: null, deferredRevenueGlAccountId: null };
    const arAccountId =
      pinned.arGlAccountId
      ?? (await getAccountByNumber(tenantId, ACCOUNTS.ACCOUNTS_RECEIVABLE, tx, locationId));
    const termIncomeAccountId = await resolveLocationSystemPostingAccount(
      tenantId,
      locationId,
      "earlyTermination",
      `early termination penalty contract=${contract.id}`,
      tx,
    );

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
    const deferredAccountId = await getDeferredRevenueAccountId(tenantId, tx, locationId);
    if (!deferredAccountId) throw new Error(`No deferred-revenue GL account found for tenant ${tenantId}`);
    const revenueAccountId = await resolveLocationSystemPostingAccount(
      tenantId,
      locationId,
      "defaultRevenue",
      `early termination deferred washout contract=${contract.id}`,
      tx,
    );

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

// ---------------------------------------------------------------------------
// Inventory return — reverse COGS and restore QOH
// ---------------------------------------------------------------------------
//
// Called when inventory items are returned by a customer (e.g. a refund on a
// POS sale that included physical goods). Restores QOH at the current WAC
// and posts the inverse of the original COGS entry:
//   DR  Inventory Asset   (restore asset)
//   CR  COGS              (reduce cost recognised)
//
// Returns always restore at current WAC regardless of the original costing
// method (FIFO or WAC). This is standard accounting practice and avoids
// reopening historical lots.

export async function postInventoryReturn(params: {
  tenantId: string;
  locationId: string;
  lineItems: Array<{ productId: string; qty: number }>;
  sourceId: string; // e.g., refund ID
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    for (const item of params.lineItems) {
      const { unitCostCents, totalCostCents } = await restoreInventoryOnReturn({
        tenantId: params.tenantId,
        productId: item.productId,
        locationId: params.locationId,
        qtyReturned: item.qty,
        tx: tx as unknown as Prisma.TransactionClient,
      });

      if (totalCostCents === 0) continue;

      // Resolve GL accounts for this product's category
      const glAccounts = await resolveProductGlAccounts(
        params.tenantId,
        item.productId,
        params.locationId,
      );
      if (!glAccounts.inventoryAssetGlAccountId || !glAccounts.cogsGlAccountId) continue;

      // Reverse the COGS entry: DR Inventory Asset, CR COGS
      await postEntries(
        params.tenantId,
        [
          {
            accountId: glAccounts.inventoryAssetGlAccountId,
            debitCents: totalCostCents,
            creditCents: 0,
            description: `Inventory return ${params.sourceId} — restore asset`,
          },
          {
            accountId: glAccounts.cogsGlAccountId,
            debitCents: 0,
            creditCents: totalCostCents,
            description: `Inventory return ${params.sourceId} — COGS reversal`,
          },
        ],
        "INVENTORY_RETURN",
        params.sourceId,
        tx,
      );
    }
  });
}
