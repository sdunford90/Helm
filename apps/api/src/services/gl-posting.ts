import { prisma } from "../lib/prisma.js";
import { v4 as uuid } from "uuid";
import {
  getSystemAccount,
  getPaymentAccount,
  type PaymentMethodKey,
} from "./account-mapping.js";

// ---------------------------------------------------------------------------
// GL Posting Service
//
// All financial transactions flow through here to create double-entry GL
// journal entries. Every posting function ensures debits === credits.
// Amounts are always in cents (integers).
//
// Account resolution uses the AccountMapping service — no hardcoded account
// numbers. Each location configures its own mappings via Accounting Hub.
// ---------------------------------------------------------------------------

interface GlLine {
  accountId: string;
  debitCents: number;
  creditCents: number;
  description?: string;
}

// ---------------------------------------------------------------------------
// Fiscal period guard — blocks posting to closed/locked periods
// ---------------------------------------------------------------------------

async function assertPeriodOpen(tenantId: string, postDate: Date): Promise<void> {
  const period = await prisma.fiscalPeriod.findFirst({
    where: {
      tenantId,
      startDate: { lte: postDate },
      endDate: { gte: postDate },
    },
    select: { status: true, name: true },
  });

  if (!period) return; // No period defined — allow posting

  if (period.status === "LOCKED") {
    throw new Error(
      `Cannot post to ${period.name}: period is locked. Contact your accounting manager.`,
    );
  }

  if (period.status === "CLOSED") {
    throw new Error(
      `Cannot post to ${period.name}: period is closed. Reopen the period before posting.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Core — post balanced GL entries
// ---------------------------------------------------------------------------

async function postEntries(
  tenantId: string,
  locationId: string | null,
  lines: GlLine[],
  sourceType: string,
  sourceId: string,
  postDate?: Date,
  tx?: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
): Promise<string> {
  const totalDebits = lines.reduce((s, l) => s + l.debitCents, 0);
  const totalCredits = lines.reduce((s, l) => s + l.creditCents, 0);

  if (totalDebits !== totalCredits) {
    throw new Error(`GL entries do not balance: debits=${totalDebits} credits=${totalCredits}`);
  }

  if (totalDebits === 0) throw new Error("GL entries cannot all be zero");

  const postedAt = postDate ?? new Date();

  if (locationId) {
    await assertPeriodOpen(tenantId, postedAt);
  }

  const journalId = uuid();
  const db = tx ?? prisma;

  await (db as typeof prisma).glEntry.createMany({
    data: lines.map((l) => ({
      id: uuid(),
      tenantId,
      locationId,
      journalId,
      accountId: l.accountId,
      debitCents: l.debitCents,
      creditCents: l.creditCents,
      description: l.description ?? null,
      postedAt,
      sourceType,
      sourceId,
    })),
  });

  return journalId;
}

// ---------------------------------------------------------------------------
// Invoice posting
// ---------------------------------------------------------------------------

export async function postInvoice(
  invoice: {
    id: string;
    tenantId: string;
    locationId: string;
    totalCents: number;
    lineItems: {
      id: string;
      extendedCents: number;
      taxCents: number;
      glAccountId?: string | null;
      isDeferred: boolean;
    }[];
  },
  tx?: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
): Promise<string> {
  const { tenantId, locationId } = invoice;

  const arAccountId = await getSystemAccount(locationId, "ACCOUNTS_RECEIVABLE");
  const deferredAccountId = await getSystemAccount(locationId, "DEFERRED_REVENUE").catch(() => null);

  const lines: GlLine[] = [];

  lines.push({
    accountId: arAccountId,
    debitCents: invoice.totalCents,
    creditCents: 0,
    description: `Invoice ${invoice.id} — A/R`,
  });

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
      if (!li.glAccountId) {
        throw new Error(
          `Invoice line item ${li.id} has no GL account. Ensure account mappings are configured.`,
        );
      }
      lines.push({
        accountId: li.glAccountId,
        debitCents: 0,
        creditCents: lineTotal,
        description: `Invoice ${invoice.id} — revenue`,
      });
    }
  }

  return postEntries(tenantId, locationId, lines, "INVOICE", invoice.id, undefined, tx);
}

// ---------------------------------------------------------------------------
// Payment posting
// ---------------------------------------------------------------------------

export async function postPayment(
  payment: {
    id: string;
    tenantId: string;
    locationId: string;
    amountCents: number;
    method: string;
    postedDate?: Date;
  },
  tx?: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
): Promise<string> {
  const { tenantId, locationId } = payment;

  const methodKey = mapPaymentMethod(payment.method);
  const cashAccountId = await getPaymentAccount(locationId, methodKey);
  const arAccountId = await getSystemAccount(locationId, "ACCOUNTS_RECEIVABLE");

  return postEntries(
    tenantId,
    locationId,
    [
      { accountId: cashAccountId, debitCents: payment.amountCents, creditCents: 0, description: `Payment ${payment.id} — cash/bank` },
      { accountId: arAccountId, debitCents: 0, creditCents: payment.amountCents, description: `Payment ${payment.id} — A/R reduction` },
    ],
    "PAYMENT",
    payment.id,
    payment.postedDate,
    tx,
  );
}

// ---------------------------------------------------------------------------
// Refund posting
// ---------------------------------------------------------------------------

export async function postRefund(
  payment: {
    id: string;
    tenantId: string;
    locationId: string;
    method: string;
    refundAmountCents: number;
  },
  tx?: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
): Promise<string> {
  const { tenantId, locationId } = payment;

  const methodKey = mapPaymentMethod(payment.method);
  const cashAccountId = await getPaymentAccount(locationId, methodKey);
  const arAccountId = await getSystemAccount(locationId, "ACCOUNTS_RECEIVABLE");

  return postEntries(
    tenantId,
    locationId,
    [
      { accountId: arAccountId, debitCents: payment.refundAmountCents, creditCents: 0, description: `Refund ${payment.id} — A/R reinstatement` },
      { accountId: cashAccountId, debitCents: 0, creditCents: payment.refundAmountCents, description: `Refund ${payment.id} — cash/bank` },
    ],
    "REFUND",
    payment.id,
    undefined,
    tx,
  );
}

// ---------------------------------------------------------------------------
// Invoice void
// ---------------------------------------------------------------------------

export async function postVoid(
  invoice: {
    id: string;
    tenantId: string;
    locationId: string;
    totalCents: number;
    lineItems: { extendedCents: number; taxCents: number; glAccountId?: string | null; isDeferred: boolean }[];
  },
  tx?: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
): Promise<string> {
  const { tenantId, locationId } = invoice;

  const arAccountId = await getSystemAccount(locationId, "ACCOUNTS_RECEIVABLE");
  const deferredAccountId = await getSystemAccount(locationId, "DEFERRED_REVENUE").catch(() => null);

  const lines: GlLine[] = [
    { accountId: arAccountId, debitCents: 0, creditCents: invoice.totalCents, description: `Void ${invoice.id} — A/R reversal` },
  ];

  for (const li of invoice.lineItems) {
    const lineTotal = li.extendedCents + li.taxCents;
    if (lineTotal === 0) continue;

    const accountId = li.isDeferred && deferredAccountId ? deferredAccountId : li.glAccountId;
    if (!accountId) continue;

    lines.push({ accountId, debitCents: lineTotal, creditCents: 0, description: `Void ${invoice.id} — revenue reversal` });
  }

  return postEntries(tenantId, locationId, lines, "VOID", invoice.id, undefined, tx);
}

// ---------------------------------------------------------------------------
// Security deposit
// ---------------------------------------------------------------------------

export async function postSecurityDeposit(
  deposit: { id: string; tenantId: string; locationId: string; amountCents: number; method: string },
  tx?: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
): Promise<string> {
  const { tenantId, locationId } = deposit;
  const methodKey = mapPaymentMethod(deposit.method);
  const cashAccountId = await getPaymentAccount(locationId, methodKey);
  const depositAccountId = await getSystemAccount(locationId, "SECURITY_DEPOSITS_HELD");

  return postEntries(
    tenantId,
    locationId,
    [
      { accountId: cashAccountId, debitCents: deposit.amountCents, creditCents: 0, description: `Security deposit ${deposit.id} — cash received` },
      { accountId: depositAccountId, debitCents: 0, creditCents: deposit.amountCents, description: `Security deposit ${deposit.id} — liability` },
    ],
    "SECURITY_DEPOSIT",
    deposit.id,
    undefined,
    tx,
  );
}

export async function releaseSecurityDeposit(
  deposit: { id: string; tenantId: string; locationId: string; amountCents: number; appliedToInvoiceId?: string | null },
  tx?: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
): Promise<string> {
  const { tenantId, locationId } = deposit;
  const depositAccountId = await getSystemAccount(locationId, "SECURITY_DEPOSITS_HELD");
  const cashAccountId = await getSystemAccount(locationId, "CASH");
  const arAccountId = await getSystemAccount(locationId, "ACCOUNTS_RECEIVABLE");

  return postEntries(
    tenantId,
    locationId,
    [
      { accountId: depositAccountId, debitCents: deposit.amountCents, creditCents: 0, description: `Deposit release ${deposit.id} — liability cleared` },
      {
        accountId: deposit.appliedToInvoiceId ? arAccountId : cashAccountId,
        debitCents: 0,
        creditCents: deposit.amountCents,
        description: deposit.appliedToInvoiceId ? `Deposit release ${deposit.id} — applied to invoice` : `Deposit release ${deposit.id} — refunded`,
      },
    ],
    "DEPOSIT_RELEASE",
    deposit.id,
    undefined,
    tx,
  );
}

// ---------------------------------------------------------------------------
// ACH Return
// ---------------------------------------------------------------------------

export async function postAchReturn(
  achReturn: { id: string; tenantId: string; locationId: string; paymentAmountCents: number; returnFeeCents?: number | null },
  tx?: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
): Promise<string> {
  const { tenantId, locationId } = achReturn;
  const achAccountId = await getPaymentAccount(locationId, "ACH");
  const arAccountId = await getSystemAccount(locationId, "ACCOUNTS_RECEIVABLE");
  const lateFeeAccountId = await getSystemAccount(locationId, "ACH_RETURN_FEE").catch(() => null);

  const lines: GlLine[] = [
    { accountId: arAccountId, debitCents: achReturn.paymentAmountCents, creditCents: 0, description: `ACH return ${achReturn.id} — A/R reinstated` },
    { accountId: achAccountId, debitCents: 0, creditCents: achReturn.paymentAmountCents, description: `ACH return ${achReturn.id} — bank reversal` },
  ];

  if (achReturn.returnFeeCents && achReturn.returnFeeCents > 0 && lateFeeAccountId) {
    lines.push(
      { accountId: arAccountId, debitCents: achReturn.returnFeeCents, creditCents: 0, description: `ACH return fee ${achReturn.id}` },
      { accountId: lateFeeAccountId, debitCents: 0, creditCents: achReturn.returnFeeCents, description: `ACH return fee revenue ${achReturn.id}` },
    );
  }

  return postEntries(tenantId, locationId, lines, "ACH_RETURN", achReturn.id, undefined, tx);
}

// ---------------------------------------------------------------------------
// Deferred revenue recognition
// ---------------------------------------------------------------------------

export async function postDeferredRecognition(
  entry: { id: string; tenantId: string; locationId: string; amountCents: number; revenueAccountId: string; recognitionDate: Date },
  tx?: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
): Promise<string> {
  const { tenantId, locationId } = entry;
  const deferredAccountId = await getSystemAccount(locationId, "DEFERRED_REVENUE");

  return postEntries(
    tenantId,
    locationId,
    [
      { accountId: deferredAccountId, debitCents: entry.amountCents, creditCents: 0, description: `Deferred recognition ${entry.id}` },
      { accountId: entry.revenueAccountId, debitCents: 0, creditCents: entry.amountCents, description: `Deferred recognition ${entry.id} — revenue` },
    ],
    "DEFERRED_RECOGNITION",
    entry.id,
    entry.recognitionDate,
    tx,
  );
}

// ---------------------------------------------------------------------------
// Early termination
// ---------------------------------------------------------------------------

export async function postEarlyTermination(
  data: {
    contractId: string;
    tenantId: string;
    locationId: string;
    penaltyCents: number;
    penaltyAccountId: string;
    remainingDeferredCents: number;
    revenueAccountId: string;
  },
  tx?: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
): Promise<string[]> {
  const { tenantId, locationId } = data;
  const arAccountId = await getSystemAccount(locationId, "ACCOUNTS_RECEIVABLE");
  const deferredAccountId = await getSystemAccount(locationId, "DEFERRED_REVENUE");

  const journals: string[] = [];

  if (data.penaltyCents > 0) {
    journals.push(await postEntries(
      tenantId,
      locationId,
      [
        { accountId: arAccountId, debitCents: data.penaltyCents, creditCents: 0, description: `Early termination penalty ${data.contractId}` },
        { accountId: data.penaltyAccountId, debitCents: 0, creditCents: data.penaltyCents, description: `Early termination income ${data.contractId}` },
      ],
      "EARLY_TERMINATION",
      data.contractId,
      undefined,
      tx,
    ));
  }

  if (data.remainingDeferredCents > 0) {
    journals.push(await postEntries(
      tenantId,
      locationId,
      [
        { accountId: deferredAccountId, debitCents: data.remainingDeferredCents, creditCents: 0, description: `Termination deferred washout ${data.contractId}` },
        { accountId: data.revenueAccountId, debitCents: 0, creditCents: data.remainingDeferredCents, description: `Termination deferred washout ${data.contractId} — revenue` },
      ],
      "EARLY_TERMINATION",
      data.contractId,
      undefined,
      tx,
    ));
  }

  return journals;
}

// ---------------------------------------------------------------------------
// Inventory receiving (DR Inventory Asset / CR Accounts Payable)
// ---------------------------------------------------------------------------

export async function postInventoryReceipt(
  data: {
    receiptId: string;
    tenantId: string;
    locationId: string;
    totalCostCents: number;
    postedDate?: Date;
  },
  tx?: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
): Promise<string> {
  const { tenantId, locationId } = data;
  const inventoryAccountId = await getSystemAccount(locationId, "INVENTORY_ASSET");
  const apAccountId = await getSystemAccount(locationId, "ACCOUNTS_PAYABLE");

  return postEntries(
    tenantId,
    locationId,
    [
      { accountId: inventoryAccountId, debitCents: data.totalCostCents, creditCents: 0, description: `Inventory receipt ${data.receiptId}` },
      { accountId: apAccountId, debitCents: 0, creditCents: data.totalCostCents, description: `Inventory receipt ${data.receiptId} — A/P` },
    ],
    "INVENTORY_RECEIPT",
    data.receiptId,
    data.postedDate,
    tx,
  );
}

// ---------------------------------------------------------------------------
// COGS posting on sale (DR COGS / CR Inventory Asset) — same date as revenue
// ---------------------------------------------------------------------------

export async function postCogs(
  data: {
    saleId: string;
    tenantId: string;
    locationId: string;
    costCents: number;
    cogsAccountId: string;
    saleDate: Date;
  },
  tx?: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
): Promise<string> {
  const { tenantId, locationId } = data;
  const inventoryAccountId = await getSystemAccount(locationId, "INVENTORY_ASSET");

  return postEntries(
    tenantId,
    locationId,
    [
      { accountId: data.cogsAccountId, debitCents: data.costCents, creditCents: 0, description: `COGS ${data.saleId}` },
      { accountId: inventoryAccountId, debitCents: 0, creditCents: data.costCents, description: `COGS ${data.saleId} — inventory reduction` },
    ],
    "COGS",
    data.saleId,
    data.saleDate,
    tx,
  );
}

// ---------------------------------------------------------------------------
// Manual journal entry
// ---------------------------------------------------------------------------

export async function postManualJournalEntry(
  tenantId: string,
  locationId: string,
  entries: GlLine[],
  sourceDescription?: string,
): Promise<string> {
  return postEntries(tenantId, locationId, entries, "MANUAL_JOURNAL", sourceDescription ?? "manual");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapPaymentMethod(method: string): PaymentMethodKey {
  const map: Record<string, PaymentMethodKey> = {
    CARD: "CARD",
    ACH: "ACH",
    CASH: "CASH",
    CHECK: "CHECK",
    WIRE: "WIRE",
    CHARGE_TO_SLIP: "CHARGE_TO_SLIP",
    GIFT_CARD: "CARD",
  };
  return map[method] ?? "CARD";
}
