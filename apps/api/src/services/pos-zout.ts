// Task #320: POS Z-out computation + GL posting service.
//
// Pure-function-over-DB-reads computation that produces the full end-of-day
// snapshot a manager confirms at Z-out (and a cashier previews via X-report).
// The same payload feeds:
//   - GET /api/pos/shifts/:id/x-report  — read-only mid-shift preview
//   - POST /api/pos/shifts/:id/z-out    — manager commit, locks the snapshot
//
// Deliberately not memoized: every call re-reads the DB so a preview run a
// second after a fresh transaction shows the new totals. The commit path
// runs the computation INSIDE the same `prisma.$transaction` that creates
// the ZReport so the snapshot can't drift between compute and write.

import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { stripe } from "../lib/stripe.js";
import { postEntries } from "./gl-posting.js";
import {
  resolveLocationSystemPostingAccount,
  resolveProductGlAccounts,
} from "./gl-account-resolver.js";

// Exported so route handlers can pass typed transaction clients without
// reaching back through `Parameters<Parameters<typeof ...>>` themselves.
// Mirrors the pattern in gl-posting.ts.
export type ZoutTx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

// Hard-coded GL account numbers used by the Z-out journal. Keep in sync
// with `gl-posting.ts::ACCOUNTS`. We import getAccountByNumber via the
// helper below rather than re-export it from gl-posting (which keeps it
// private to that module by design).
const ACC_CASH = "1000";
const ACC_STRIPE_CLEARING = "1010";
// ACH settlements clear through their own ledger account so finance can
// reconcile bank ACH deposits independently of card payouts.
const ACC_ACH_CLEARING = "1015";
// Declared non-cash tenders (checks, "other") sit in undeposited funds
// until the manager records the bank deposit that clears them. Lumping
// them into Stripe Clearing or Cash would corrupt those reconciliations.
const ACC_UNDEPOSITED = "1020";
const ACC_AR = "1200";
const ACC_TIPS_PAYABLE = "2210"; // Customer Deposits (also used for tips held)
const ACC_CASH_OVER_SHORT = "5900";

async function getAcct(
  tenantId: string,
  number: string,
  locationId: string | null,
  context: string,
  tx?: ZoutTx,
): Promise<string> {
  const db = tx ?? prisma;
  // Prefer location-scoped row, then tenant-wide.
  if (locationId) {
    const ls = await (db as typeof prisma).glAccount.findFirst({
      where: { tenantId, locationId, accountNumber: number },
      select: { id: true },
    });
    if (ls) return ls.id;
  }
  const tw = await (db as typeof prisma).glAccount.findFirst({
    where: { tenantId, locationId: null, accountNumber: number },
    select: { id: true },
  });
  if (tw) return tw.id;
  // Auto-create the tenant-wide row for system accounts. Mirrors the
  // auto-heal behaviour in gl-posting.ts so a tenant whose chart predates
  // the 5900 migration still posts cleanly on first Z-out.
  const SYS: Record<string, { name: string; type: "ASSET" | "LIABILITY" | "EXPENSE" }> = {
    "1000": { name: "Cash / Operating Bank", type: "ASSET" },
    "1010": { name: "Stripe Clearing", type: "ASSET" },
    "1200": { name: "Accounts Receivable", type: "ASSET" },
    "2210": { name: "Customer Deposits", type: "LIABILITY" },
    "5900": { name: "Cash Over/Short", type: "EXPENSE" },
  };
  const def = SYS[number];
  if (def) {
    const created = await prisma.glAccount.create({
      data: { tenantId, accountNumber: number, name: def.name, type: def.type },
      select: { id: true },
    });
    return created.id;
  }
  throw Object.assign(
    new Error(
      `UNCONFIGURED_GL_ACCOUNT: account ${number} missing for tenant ${tenantId} (${context}). ` +
        `Add it to Settings → Chart of Accounts before running Z-out.`,
    ),
    { statusCode: 400, code: "UNCONFIGURED_GL_ACCOUNT" },
  );
}

// ---------------------------------------------------------------------------
// Snapshot shape
// ---------------------------------------------------------------------------

export interface ZOutSnapshot {
  shiftId: string;
  locationId: string | null;
  cashierId: string;
  cashierName?: string | null;
  openedAt: string;
  closedAt: string | null;
  // Headline totals (cents)
  grossSalesCents: number; // sum of positive line subtotals (pre-discount)
  discountsCents: number; // sum of line discounts on positive sales
  refundsCents: number; // absolute value of refund subtotals
  netSalesCents: number; // gross - discounts - refunds (pre-tax, pre-tip)
  taxCents: number; // sum of tax (sales) - tax (refunds)
  tipsCents: number; // sum of tip (sales) - tip (refunds)
  totalCents: number; // net + tax + tips
  // Tender breakdown (cents). All values are net of refunds for that tender
  // (i.e. sales minus refunds, can go negative if more refunded than sold).
  tenders: {
    cash: { salesCents: number; refundsCents: number; netCents: number };
    cardTerminal: { salesCents: number; refundsCents: number; netCents: number; count: number };
    cardCnp: { salesCents: number; refundsCents: number; netCents: number; count: number };
    ach: { salesCents: number; refundsCents: number; netCents: number };
    check: { declaredCents: number };
    chargeToAr: { salesCents: number; refundsCents: number; netCents: number; count: number };
    other: { declaredCents: number };
  };
  // Card-tender Stripe matching. `expectedCardCents` is what the POS
  // recorded; `capturedSumCents` / `capturedCount` are what Stripe says
  // actually settled. The four row-id buckets bucket each card sale into
  // exactly one of: matched-and-captured, uncaptured (PI exists but
  // status != succeeded), unverified (PI exists but the Stripe lookup
  // failed — typically network/permissions), or missing (no PI on the
  // POS row at all). `verifiedAgainstStripe` is false when the Stripe
  // SDK isn't configured (no STRIPE_SECRET_KEY) — managers see the
  // capture columns as zero and the UI flags the lack of verification.
  stripeMatching: {
    expectedCardCents: number;
    matchedCount: number;
    capturedSumCents: number;
    capturedCount: number;
    unmatchedRowIds: string[]; // card sales missing a PI id
    uncapturedRowIds: string[]; // card sales whose PI hasn't succeeded
    unverifiedRowIds: string[]; // card sales whose PI couldn't be retrieved
    verifiedAgainstStripe: boolean;
  };
  // Cash drawer math (cents).
  cashDrawer: {
    openingFloatCents: number;
    cashSalesCents: number;
    cashRefundsCents: number;
    paidOutsCents: number;
    expectedCents: number; // open + sales - refunds - paidOuts
    countedCents: number;
    varianceCents: number; // counted - expected
  };
  // Sales by category (top revenue first).
  salesByCategory: Array<{
    categoryId: string | null;
    categoryName: string;
    grossCents: number;
    discountsCents: number;
    netCents: number;
  }>;
  // Top 10 products by net revenue.
  topProducts: Array<{
    productId: string | null;
    productName: string;
    quantity: number;
    grossCents: number;
    netCents: number;
  }>;
  // Discounts applied this shift, grouped by source label.
  discountsApplied: Array<{
    label: string;
    count: number;
    totalCents: number;
  }>;
  // Refunds + voids (we have no separate void concept today, so this is
  // the list of refund rows attached to the shift).
  refundsList: Array<{
    transactionId: string;
    refundedAt: string;
    totalCents: number; // negative
    reason: string | null;
  }>;
  // Per-shift counts for the headline strip.
  counts: {
    transactions: number;
    refunds: number;
    discountedLines: number;
  };
}

// ---------------------------------------------------------------------------
// Computation
// ---------------------------------------------------------------------------

/**
 * Compute the full Z-out snapshot for a shift. Reads PosTransaction +
 * PosLineItem rows attached to the shift (sales AND refund rows), along
 * with the categories of touched products for the by-category breakdown.
 *
 * Pure over the DB — safe to call from both the X-report preview and the
 * Z-out commit path. Optionally accepts a transaction client so the
 * commit path sees the same data as it writes the ZReport row.
 */
export async function computeZOut(
  shiftId: string,
  countedCashCents: number | null,
  tx?: ZoutTx,
): Promise<ZOutSnapshot> {
  const db = tx ?? prisma;

  const shift = await (db as typeof prisma).shift.findUnique({
    where: { id: shiftId },
    include: {
      transactions: {
        include: {
          lineItems: {
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                  productCategoryId: true,
                  productCategory: { select: { id: true, name: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!shift) {
    throw Object.assign(new Error(`Shift ${shiftId} not found`), {
      statusCode: 404,
      code: "NOT_FOUND",
    });
  }

  // Resolve cashier display name (best-effort).
  const cashier = await (db as typeof prisma).user.findUnique({
    where: { id: shift.cashierId },
    select: { firstName: true, lastName: true, email: true },
  });
  const cashierName = cashier
    ? [cashier.firstName, cashier.lastName].filter(Boolean).join(" ") || cashier.email
    : null;

  // Sign-of-total split. Post-migration both the original and its
  // refund row carry the original tender, so positive = sale,
  // negative = refund. Legacy status='REFUNDED' positives that the
  // migration couldn't safely revert fall outside the named tender
  // buckets (matching pre-Task-#320 behavior).
  const txns = shift.transactions;
  const sales = txns.filter((t) => t.totalCents >= 0);
  const refunds = txns.filter((t) => t.totalCents < 0);

  // Headline totals.
  const grossSalesCents = sales.reduce(
    (s, t) => s + t.lineItems.reduce((ls, li) => ls + li.unitPriceCents * li.quantity, 0),
    0,
  );
  const discountsCents = sales.reduce(
    (s, t) => s + t.lineItems.reduce((ls, li) => ls + li.discountCents, 0),
    0,
  );
  const refundsAbsCents = refunds.reduce((s, t) => s + Math.abs(t.subtotalCents), 0);
  const netSalesCents = grossSalesCents - discountsCents - refundsAbsCents;
  const taxCents = sales.reduce((s, t) => s + t.taxCents, 0)
    - refunds.reduce((s, t) => s + Math.abs(t.taxCents), 0);
  const tipsCents = sales.reduce((s, t) => s + t.tipCents, 0)
    - refunds.reduce((s, t) => s + Math.abs(t.tipCents), 0);
  const totalCents = netSalesCents + taxCents + tipsCents;

  // Tender breakdown.
  const sumByStatus = (status: string, list: typeof sales) =>
    list.filter((t) => t.status === status).reduce((s, t) => s + Math.abs(t.totalCents), 0);

  const cashSalesCents = sumByStatus("CASH", sales);
  const cashRefundsCents = sumByStatus("CASH", refunds);

  const cardTerminalSales = sales.filter((t) => t.status === "CARD" && t.cardRail === "TERMINAL");
  const cardCnpSales = sales.filter((t) => t.status === "CARD" && t.cardRail !== "TERMINAL");
  const cardTerminalRefunds = refunds.filter((t) => t.status === "CARD" && t.cardRail === "TERMINAL");
  const cardCnpRefunds = refunds.filter((t) => t.status === "CARD" && t.cardRail !== "TERMINAL");

  const sum = (list: typeof sales) => list.reduce((s, t) => s + Math.abs(t.totalCents), 0);

  const tenders = {
    cash: {
      salesCents: cashSalesCents,
      refundsCents: cashRefundsCents,
      netCents: cashSalesCents - cashRefundsCents,
    },
    cardTerminal: {
      salesCents: sum(cardTerminalSales),
      refundsCents: sum(cardTerminalRefunds),
      netCents: sum(cardTerminalSales) - sum(cardTerminalRefunds),
      count: cardTerminalSales.length,
    },
    cardCnp: {
      salesCents: sum(cardCnpSales),
      refundsCents: sum(cardCnpRefunds),
      netCents: sum(cardCnpSales) - sum(cardCnpRefunds),
      count: cardCnpSales.length,
    },
    ach: {
      salesCents: sumByStatus("ACH", sales),
      refundsCents: sumByStatus("ACH", refunds),
      netCents: sumByStatus("ACH", sales) - sumByStatus("ACH", refunds),
    },
    check: { declaredCents: shift.declaredCheckCents },
    chargeToAr: {
      salesCents: sumByStatus("CHARGE_TO_AR", sales),
      refundsCents: sumByStatus("CHARGE_TO_AR", refunds),
      netCents: sumByStatus("CHARGE_TO_AR", sales) - sumByStatus("CHARGE_TO_AR", refunds),
      count: sales.filter((t) => t.status === "CHARGE_TO_AR").length,
    },
    other: { declaredCents: shift.declaredOtherCents },
  };

  // Stripe PI matching. We hit Stripe for each unique PI id on this
  // shift's card sales and verify capture state. PIs that come back
  // `succeeded` count toward `capturedSumCents` / `capturedCount`;
  // anything else (`requires_capture`, `canceled`, `processing`, etc.)
  // lands in `uncapturedRowIds` so the manager knows the funds aren't
  // actually settled. Network/permission errors land in
  // `unverifiedRowIds` rather than blocking the close — Z-out must run
  // even when Stripe is briefly unreachable. When the SDK isn't
  // configured we skip lookups entirely and flag the snapshot.
  const cardSales = [...cardTerminalSales, ...cardCnpSales];
  const expectedCardCents = cardSales.reduce((s, t) => s + t.totalCents, 0);
  const matchedCount = cardSales.filter((t) => !!t.stripePaymentIntentId).length;
  const unmatchedRowIds = cardSales
    .filter((t) => !t.stripePaymentIntentId)
    .map((t) => t.id);

  let capturedSumCents = 0;
  let capturedCount = 0;
  const uncapturedRowIds: string[] = [];
  const unverifiedRowIds: string[] = [];
  const verifiedAgainstStripe = stripe !== null;
  if (verifiedAgainstStripe) {
    // PI lookups must hit the same Stripe account that took the payment.
    // For per-location Stripe Connect marinas, that's the location's
    // connected account — looking the PI up on the platform account
    // raises `resource_missing` and used to flood Z-out with bogus
    // "PaymentIntent could not be retrieved" warnings (Task #332).
    //
    // Account resolution prefers the row's stored `stripeAccountId`
    // (captured at sale time, so it survives later location/account
    // re-mappings), then falls back to the shift location's currently
    // configured connected account. Null = platform account, exactly
    // like today.
    let fallbackAccountId: string | null = null;
    if (shift.locationId) {
      const loc = await (db as typeof prisma).location.findFirst({
        where: { id: shift.locationId, tenantId: shift.tenantId },
        select: { stripeAccountId: true },
      });
      fallbackAccountId = loc?.stripeAccountId ?? null;
    }

    // Group by (stripeAccountId, piId) so we still hit Stripe at most
    // once per unique PI. The same PI id can in principle exist on two
    // different connected accounts, so the account is part of the key.
    const piToRows = new Map<
      string,
      { acctId: string | null; piId: string; rows: typeof cardSales }
    >();
    for (const t of cardSales) {
      const pi = t.stripePaymentIntentId;
      if (!pi) continue;
      const acctId = t.stripeAccountId ?? fallbackAccountId;
      const key = `${acctId ?? ""}::${pi}`;
      const entry = piToRows.get(key) ?? { acctId, piId: pi, rows: [] };
      entry.rows.push(t);
      piToRows.set(key, entry);
    }
    for (const { acctId, piId, rows } of piToRows.values()) {
      try {
        const pi = acctId
          ? await stripe!.paymentIntents.retrieve(piId, undefined, { stripeAccount: acctId })
          : await stripe!.paymentIntents.retrieve(piId);
        if (pi.status === "succeeded") {
          capturedSumCents += pi.amount_received ?? 0;
          capturedCount += rows.length;
        } else {
          for (const r of rows) uncapturedRowIds.push(r.id);
        }
      } catch {
        for (const r of rows) unverifiedRowIds.push(r.id);
      }
    }
  }

  // Canonical expected cash (must match close endpoint and /shifts list):
  //   openingFloat + cashSales − cashRefunds − paidOuts
  //                − declaredCheck − declaredOther
  // Declared check/other physically leave the drawer at close.
  const expectedCashCents =
    shift.openingFloatCents
    + cashSalesCents
    - cashRefundsCents
    - shift.paidOutsCents
    - shift.declaredCheckCents
    - shift.declaredOtherCents;
  const counted = countedCashCents ?? shift.closingCashCents ?? 0;
  const cashDrawer = {
    openingFloatCents: shift.openingFloatCents,
    cashSalesCents,
    cashRefundsCents,
    paidOutsCents: shift.paidOutsCents,
    expectedCents: expectedCashCents,
    countedCents: counted,
    varianceCents: counted - expectedCashCents,
  };

  // By-category. Refund line items carry negative quantities & extendeds, so
  // they net out automatically when summed alongside sale lines.
  const catMap = new Map<string, {
    categoryId: string | null;
    categoryName: string;
    grossCents: number;
    discountsCents: number;
    netCents: number;
  }>();
  for (const t of txns) {
    for (const li of t.lineItems) {
      const catId = li.product?.productCategoryId ?? null;
      const catKey = catId ?? "__uncat__";
      const catName = li.product?.productCategory?.name ?? "Uncategorized";
      const gross = li.unitPriceCents * li.quantity;
      const disc = li.discountCents * (li.quantity < 0 ? -1 : 1);
      const net = gross - disc;
      const cur = catMap.get(catKey) ?? {
        categoryId: catId,
        categoryName: catName,
        grossCents: 0,
        discountsCents: 0,
        netCents: 0,
      };
      cur.grossCents += gross;
      cur.discountsCents += disc;
      cur.netCents += net;
      catMap.set(catKey, cur);
    }
  }
  const salesByCategory = Array.from(catMap.values()).sort((a, b) => b.netCents - a.netCents);

  // Top products by net revenue.
  const prodMap = new Map<string, {
    productId: string | null;
    productName: string;
    quantity: number;
    grossCents: number;
    netCents: number;
  }>();
  for (const t of txns) {
    for (const li of t.lineItems) {
      const pid = li.productId ?? "__adhoc__";
      const pname = li.product?.name ?? "Ad-hoc item";
      const gross = li.unitPriceCents * li.quantity;
      const cur = prodMap.get(pid) ?? {
        productId: li.productId,
        productName: pname,
        quantity: 0,
        grossCents: 0,
        netCents: 0,
      };
      cur.quantity += li.quantity;
      cur.grossCents += gross;
      cur.netCents += gross - li.discountCents * (li.quantity < 0 ? -1 : 1);
      prodMap.set(pid, cur);
    }
  }
  const topProducts = Array.from(prodMap.values())
    .sort((a, b) => b.netCents - a.netCents)
    .slice(0, 10);

  // Discounts grouped by label.
  const discMap = new Map<string, { label: string; count: number; totalCents: number }>();
  let discountedLines = 0;
  for (const t of sales) {
    for (const li of t.lineItems) {
      if (li.discountCents > 0) {
        discountedLines++;
        const label = li.discountSourceLabel ?? "Manual discount";
        const cur = discMap.get(label) ?? { label, count: 0, totalCents: 0 };
        cur.count++;
        cur.totalCents += li.discountCents;
        discMap.set(label, cur);
      }
    }
  }
  const discountsApplied = Array.from(discMap.values()).sort(
    (a, b) => b.totalCents - a.totalCents,
  );

  const refundsList = refunds.map((t) => ({
    transactionId: t.id,
    refundedAt: t.createdAt.toISOString(),
    totalCents: t.totalCents,
    reason: null as string | null,
  }));

  return {
    shiftId: shift.id,
    locationId: shift.locationId,
    cashierId: shift.cashierId,
    cashierName,
    openedAt: shift.openedAt.toISOString(),
    closedAt: shift.closedAt?.toISOString() ?? null,
    grossSalesCents,
    discountsCents,
    refundsCents: refundsAbsCents,
    netSalesCents,
    taxCents,
    tipsCents,
    totalCents,
    tenders,
    stripeMatching: {
      expectedCardCents,
      matchedCount,
      capturedSumCents,
      capturedCount,
      unmatchedRowIds,
      uncapturedRowIds,
      unverifiedRowIds,
      verifiedAgainstStripe,
    },
    cashDrawer,
    salesByCategory,
    topProducts,
    discountsApplied,
    refundsList,
    counts: {
      transactions: sales.length,
      refunds: refunds.length,
      discountedLines,
    },
  };
}

// ---------------------------------------------------------------------------
// GL posting for shift Z-out
// ---------------------------------------------------------------------------

/**
 * Post the summarized end-of-day journal for a shift. One balanced entry
 * per shift, posted via `postEntries` with sourceType="POS_ZOUT" and
 * sourceId=shiftId so re-running is naturally tied to the shift via the
 * existing GL audit trail.
 *
 * Lines (all sums are NET of refunds within the shift):
 *   DR Cash (1000)              cash net
 *   DR Stripe Clearing (1010)   card terminal net + card CNP net
 *   DR A/R (1200)               charge-to-AR sales (refunds rare; ignored)
 *   DR Cash Over/Short (5900)   if drawer was short
 *     CR Sales Revenue (per category, resolved via productGlAccounts)
 *     CR Sales Tax Payable (per location)
 *     CR Tips Payable (2210)    tips collected
 *     CR Cash Over/Short (5900) if drawer was over
 *
 * NOTE: Per-category revenue resolution requires every productCategory
 * touched to have a per-(category, location) GL mapping configured.
 * `resolveProductGlAccounts` already throws MISSING_GL_MAPPING with the
 * canonical wording when not — we let that bubble up and the Z-out
 * transaction rolls back so the manager fixes the mapping before retrying.
 */
export async function postShiftZOut(
  tenantId: string,
  shiftId: string,
  snapshot: ZOutSnapshot,
  tx: ZoutTx,
): Promise<string> {
  const locationId = snapshot.locationId;

  // ── Debits ──────────────────────────────────────────────────────────────
  const debits: Array<{
    accountId: string;
    debitCents: number;
    creditCents: number;
    description: string;
  }> = [];

  if (snapshot.tenders.cash.netCents > 0) {
    debits.push({
      accountId: await getAcct(tenantId, ACC_CASH, locationId, `zout cash shift=${shiftId}`, tx),
      debitCents: snapshot.tenders.cash.netCents,
      creditCents: 0,
      description: `Z-out cash net — shift ${shiftId}`,
    });
  } else if (snapshot.tenders.cash.netCents < 0) {
    // Net cash out (refunds > sales): credit cash, debit revenue contra
    // happens implicitly via the negative line items on the revenue side.
    debits.push({
      accountId: await getAcct(tenantId, ACC_CASH, locationId, `zout cash shift=${shiftId}`, tx),
      debitCents: 0,
      creditCents: -snapshot.tenders.cash.netCents,
      description: `Z-out cash net (refund-heavy) — shift ${shiftId}`,
    });
  }

  const cardNet = snapshot.tenders.cardTerminal.netCents + snapshot.tenders.cardCnp.netCents;
  if (cardNet !== 0) {
    debits.push({
      accountId: await getAcct(tenantId, ACC_STRIPE_CLEARING, locationId,
        `zout card shift=${shiftId}`, tx),
      debitCents: cardNet > 0 ? cardNet : 0,
      creditCents: cardNet < 0 ? -cardNet : 0,
      description: `Z-out card net — shift ${shiftId}`,
    });
  }

  if (snapshot.tenders.ach.netCents !== 0) {
    debits.push({
      accountId: await getAcct(tenantId, ACC_ACH_CLEARING, locationId,
        `zout ach shift=${shiftId}`, tx),
      debitCents: snapshot.tenders.ach.netCents > 0 ? snapshot.tenders.ach.netCents : 0,
      creditCents: snapshot.tenders.ach.netCents < 0 ? -snapshot.tenders.ach.netCents : 0,
      description: `Z-out ACH net — shift ${shiftId}`,
    });
  }

  // Declared check / "other" tenders are a tender RECLASSIFICATION at
  // close: the cashier rang those sales as CASH during the shift (POS
  // doesn't yet have CHECK as a first-class payment method — see
  // follow-up #322), then at close declared "$X of that drawer is
  // actually checks / other". Accounting-wise we move the declared
  // amount out of Cash (1000) and into Undeposited Funds (1020), which
  // is balanced on its own and leaves the per-category revenue credits
  // untouched. The previous cash debit above already includes these
  // amounts; this pair nets the cash debit down by the declared total.
  const undepositedCents =
    snapshot.tenders.check.declaredCents + snapshot.tenders.other.declaredCents;
  if (undepositedCents > 0) {
    debits.push({
      accountId: await getAcct(tenantId, ACC_UNDEPOSITED, locationId,
        `zout undeposited shift=${shiftId}`, tx),
      debitCents: undepositedCents,
      creditCents: 0,
      description: `Z-out reclass cash → undeposited (check + other) — shift ${shiftId}`,
    });
    debits.push({
      accountId: await getAcct(tenantId, ACC_CASH, locationId,
        `zout cash reclass shift=${shiftId}`, tx),
      debitCents: 0,
      creditCents: undepositedCents,
      description: `Z-out reclass cash → undeposited (check + other) — shift ${shiftId}`,
    });
  }

  // A/R posted NET of same-shift refunds (positive = DR, negative = CR).
  const arNet = snapshot.tenders.chargeToAr.netCents;
  if (arNet !== 0) {
    debits.push({
      accountId: await getAcct(tenantId, ACC_AR, locationId, `zout AR shift=${shiftId}`, tx),
      debitCents: arNet > 0 ? arNet : 0,
      creditCents: arNet < 0 ? -arNet : 0,
      description: `Z-out charge-to-A/R net — shift ${shiftId}`,
    });
  }

  // Cash over/short. Variance > 0 = drawer is OVER (more cash than expected) =
  // mystery income → CR 5900. Variance < 0 = drawer is SHORT → DR 5900.
  const variance = snapshot.cashDrawer.varianceCents;
  if (variance !== 0) {
    debits.push({
      accountId: await getAcct(tenantId, ACC_CASH_OVER_SHORT, locationId,
        `zout variance shift=${shiftId}`, tx),
      debitCents: variance < 0 ? -variance : 0,
      creditCents: variance > 0 ? variance : 0,
      description: variance < 0
        ? `Z-out cash short — shift ${shiftId}`
        : `Z-out cash over — shift ${shiftId}`,
    });
    // Offset variance with a same-side counter to cash so debits = credits
    // remain balanced. The cash leg above already reflects COUNTED cash, so
    // we add an offsetting cash entry equal to variance to make the journal
    // tie out: drawer-short means we're claiming less cash than sales would
    // imply, the difference goes to 5900 expense (debit).
    debits.push({
      accountId: await getAcct(tenantId, ACC_CASH, locationId,
        `zout variance offset shift=${shiftId}`, tx),
      debitCents: variance > 0 ? variance : 0,
      creditCents: variance < 0 ? -variance : 0,
      description: `Z-out variance offset — shift ${shiftId}`,
    });
  }

  // ── Credits: revenue per category, tax, tips ────────────────────────────
  // Per-category revenue. Use the category's per-(category, location) GL
  // mapping when present; fall back to the location's `defaultRevenue`.
  for (const cat of snapshot.salesByCategory) {
    if (cat.netCents === 0) continue;
    let revenueAcctId: string | null = null;
    // Only consult the per-(category, location) mapping when the shift
    // is location-scoped. Without a locationId, querying by category
    // alone would return an arbitrary location's mapping; null-location
    // shifts go straight to the tenant default revenue fallback below.
    if (cat.categoryId && locationId) {
      const mapping = await (tx as typeof prisma).productCategoryGlMapping.findFirst({
        where: { productCategoryId: cat.categoryId, locationId },
        select: { revenueGlAccountId: true },
      });
      revenueAcctId = mapping?.revenueGlAccountId ?? null;
    }
    if (!revenueAcctId) {
      revenueAcctId = await resolveLocationSystemPostingAccount(
        tenantId,
        locationId,
        "defaultRevenue",
        `zout category=${cat.categoryName} shift=${shiftId}`,
        tx,
      );
    }
    debits.push({
      accountId: revenueAcctId,
      debitCents: cat.netCents < 0 ? -cat.netCents : 0,
      creditCents: cat.netCents > 0 ? cat.netCents : 0,
      description: `Z-out revenue — ${cat.categoryName} — shift ${shiftId}`,
    });
  }

  // Sales tax payable.
  if (snapshot.taxCents !== 0) {
    const taxAcctId = await resolveLocationSystemPostingAccount(
      tenantId,
      locationId,
      "salesTax",
      `zout tax shift=${shiftId}`,
      tx,
    );
    debits.push({
      accountId: taxAcctId,
      debitCents: snapshot.taxCents < 0 ? -snapshot.taxCents : 0,
      creditCents: snapshot.taxCents > 0 ? snapshot.taxCents : 0,
      description: `Z-out sales tax — shift ${shiftId}`,
    });
  }

  // Tips payable. Held as a liability owed to staff; out of scope here is
  // the actual payout entry that clears it.
  if (snapshot.tipsCents !== 0) {
    const tipsAcctId = await getAcct(tenantId, ACC_TIPS_PAYABLE, locationId,
      `zout tips shift=${shiftId}`, tx);
    debits.push({
      accountId: tipsAcctId,
      debitCents: snapshot.tipsCents < 0 ? -snapshot.tipsCents : 0,
      creditCents: snapshot.tipsCents > 0 ? snapshot.tipsCents : 0,
      description: `Z-out tips — shift ${shiftId}`,
    });
  }

  // Some shifts (no sales, no refunds, no variance) produce a zero journal —
  // postEntries refuses zero-total journals, so short-circuit here.
  const totalDebits = debits.reduce((s, l) => s + l.debitCents, 0);
  const totalCredits = debits.reduce((s, l) => s + l.creditCents, 0);
  if (totalDebits === 0 && totalCredits === 0) {
    return ""; // empty journal id — caller treats as "no GL needed"
  }
  // Balance check is enforced by postEntries; we don't need to pre-check here.

  return postEntries(tenantId, debits, "POS_ZOUT", shiftId, tx, locationId);
}

// ---------------------------------------------------------------------------
// Z-number assignment
// ---------------------------------------------------------------------------

/**
 * Assign the next sequential Z number for a (tenant, locationId). Reads the
 * current MAX inside the same transaction the caller will write the
 * ZReport row in. The unique index on (tenantId, locationId, zNumber)
 * surfaces races as a P2002 — caller catches and retries once.
 */
export async function nextZNumber(
  tenantId: string,
  locationId: string | null,
  tx: ZoutTx,
): Promise<number> {
  const last = await (tx as typeof prisma).zReport.findFirst({
    where: { tenantId, locationId },
    orderBy: { zNumber: "desc" },
    select: { zNumber: true },
  });
  return (last?.zNumber ?? 0) + 1;
}
