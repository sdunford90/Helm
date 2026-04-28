import { prisma } from "../lib/prisma.js";
import { v4 as uuid } from "uuid";

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
): Promise<string> {
  const db = tx ?? prisma;
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

/** Resolve the deferred-revenue liability account for a tenant.
 *  Prefers the first account flagged isDeferredRevenue = true in their chart
 *  (ordered by accountNumber so 2100 comes before 2110).  Falls back to the
 *  hardcoded "2100" account number if none is flagged.  Returns null if
 *  neither exists (caller falls through to revenue account). */
async function getDeferredRevenueAccountId(
  tenantId: string,
  tx?: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
): Promise<string | null> {
  const db = tx ?? prisma;
  const flagged = await (db as typeof prisma).glAccount.findFirst({
    where: { tenantId, isDeferredRevenue: true },
    orderBy: { accountNumber: "asc" },
    select: { id: true },
  });
  if (flagged) return flagged.id;

  // Fallback: the default chart seeds 2100 as "Deferred Revenue - Slips"
  const byNumber = await (db as typeof prisma).glAccount.findFirst({
    where: { tenantId, accountNumber: ACCOUNTS.DEFERRED_REVENUE_FALLBACK },
    select: { id: true },
  });
  return byNumber?.id ?? null;
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
  const arAccountId = await getAccountByNumber(tenantId, ACCOUNTS.ACCOUNTS_RECEIVABLE, tx);
  const deferredAccountId = await getDeferredRevenueAccountId(tenantId, tx);

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
          warnGlFallback(tenantId, ACCOUNTS.GENERAL_REVENUE, `invoice=${invoice.id} lineItem=${li.id}`);
          revenueAccountId = await getAccountByNumber(tenantId, ACCOUNTS.GENERAL_REVENUE, tx);
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
        taxAccountId = await getAccountByNumber(tenantId, ACCOUNTS.SALES_TAX_PAYABLE, tx).catch(async () =>
          getAccountByNumber(tenantId, ACCOUNTS.STATE_TAX_PAYABLE, tx),
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
          warnGlFallback(tenantId, ACCOUNTS.GENERAL_REVENUE, `invoice=${invoice.id} lineItem=${li.id} (legacy path)`);
          revenueAccountId = await getAccountByNumber(tenantId, ACCOUNTS.GENERAL_REVENUE, tx);
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
  },
  tx?: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
): Promise<string> {
  const { tenantId } = payment;

  // Cash/card/ACH all go to bank; physical cash could use a separate account
  const cashAccountNumber =
    payment.method === "CASH" ? ACCOUNTS.CASH : ACCOUNTS.BANK;

  const cashAccountId = await getAccountByNumber(tenantId, cashAccountNumber, tx);
  const arAccountId = await getAccountByNumber(tenantId, ACCOUNTS.ACCOUNTS_RECEIVABLE, tx);

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
  },
  refundAmountCents: number,
  tx?: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
): Promise<string> {
  const { tenantId } = payment;

  const cashAccountNumber =
    payment.method === "CASH" ? ACCOUNTS.CASH : ACCOUNTS.BANK;

  const cashAccountId = await getAccountByNumber(tenantId, cashAccountNumber, tx);
  const arAccountId = await getAccountByNumber(tenantId, ACCOUNTS.ACCOUNTS_RECEIVABLE, tx);

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
  },
  refundAmountCents: number,
  tx?: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
): Promise<string> {
  const { tenantId } = payment;

  const cashAccountNumber =
    payment.method === "CASH" ? ACCOUNTS.CASH : ACCOUNTS.BANK;

  const cashAccountId = await getAccountByNumber(tenantId, cashAccountNumber, tx);
  const arAccountId = await getAccountByNumber(tenantId, ACCOUNTS.ACCOUNTS_RECEIVABLE, tx);

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
  },
  tx?: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
): Promise<string> {
  const { tenantId } = deposit;

  const cashAccountId = await getAccountByNumber(tenantId, ACCOUNTS.BANK, tx);
  const liabilityAccountId = await getAccountByNumber(
    tenantId,
    ACCOUNTS.SECURITY_DEPOSITS_HELD,
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
  },
  tx?: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
): Promise<string> {
  const { tenantId } = deposit;

  const liabilityAccountId = await getAccountByNumber(
    tenantId,
    ACCOUNTS.SECURITY_DEPOSITS_HELD,
    tx,
  );

  if (deposit.appliedToInvoiceId) {
    // Apply to invoice: debit liability, credit A/R
    const arAccountId = await getAccountByNumber(tenantId, ACCOUNTS.ACCOUNTS_RECEIVABLE, tx);
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
    const cashAccountId = await getAccountByNumber(tenantId, ACCOUNTS.BANK, tx);
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
  },
  tx?: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
): Promise<string> {
  const { tenantId } = achReturn;

  const bankAccountId = await getAccountByNumber(tenantId, ACCOUNTS.BANK, tx);
  const arAccountId = await getAccountByNumber(tenantId, ACCOUNTS.ACCOUNTS_RECEIVABLE, tx);

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
