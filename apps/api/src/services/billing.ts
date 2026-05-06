import { prisma } from "../lib/prisma.js";
import { v4 as uuid } from "uuid";
import { todayDateOnly } from "@helm/shared-types";
import { getTaxProvider, checkTaxExempt } from "./tax-engine.js";
import { isTaxExempt } from "./product-defaults.js";
import { postInvoice, postPayment } from "./gl-posting.js";
import { createDeferredSchedule } from "./deferred-revenue.js";
import {
  resolveDockageRateGlAccount,
  isLocationQboConnected,
} from "./gl-account-resolver.js";
import { stripe, requireStripe } from "../lib/stripe.js";
import { getStripeAccountForCustomer } from "../lib/stripe-account.js";
import { queues } from "../lib/queue.js";

// ---------------------------------------------------------------------------
// Billing Engine Service
//
// Handles recurring invoice generation, electricity calculation, proration,
// credit application, and auto-charge via Stripe.
// ---------------------------------------------------------------------------

interface GeneratedInvoice {
  invoiceId: string;
  customerId: string;
  totalCents: number;
  autoChargeResult?: "SUCCESS" | "FAILED" | "SKIPPED";
}

/**
 * Generate recurring invoices for all contracts where next_billing_date <= today.
 *
 * For each due contract:
 * 1. Calculate base slip rental (with proration if partial month)
 * 2. Calculate electricity charges
 * 3. Generate draft invoice with line items
 * 4. Calculate tax per line item
 * 5. Apply outstanding credits
 * 6. Finalize invoice and post GL
 * 7. Attempt Stripe auto-charge if customer has payment method on file
 */
export async function generateRecurringInvoices(
  tenantId: string,
): Promise<GeneratedInvoice[]> {
  // Anchor every billing-window comparison to UTC midnight today so the
  // same set of contracts gets billed regardless of the server's local
  // timezone. billingAnchor is a 1–31 day-of-month integer that's
  // compared against UTC components of the contract's startDate, so use
  // UTC components here as well.
  const today = todayDateOnly();
  const contracts = await prisma.slipContract.findMany({
    where: {
      tenantId,
      status: "ACTIVE",
      billingAnchor: { lte: today.getUTCDate() },
    },
    include: {
      customer: {
        select: {
          id: true,
          stripeCustomerId: true,
          achBlocked: true,
          firstName: true,
          lastName: true,
        },
      },
      slip: {
        select: {
          id: true,
          slipNumber: true,
          locationId: true,
          slipType: true,
          electricityMode: true,
          flatFeeCents: true,
          kwhRateCents: true,
        },
      },
      // pull the linked rate plan so GL/tax resolution is
      // deterministic per contract instead of re-deriving by
      // (location, slipType) on every run. `active: false` plans are
      // still returned so we can warn-and-fall-back rather than
      // silently mis-billing.
      dockageRate: {
        select: { id: true, glAccountId: true, active: true, slipType: true, taxClass: true },
      },
    },
  });

  // Filter out contracts that already have an invoice for this month.
  // Use UTC components throughout so the month window aligns with the
  // UTC-midnight contract dates we compare against below.
  const currentMonth = today.getUTCMonth();
  const currentYear = today.getUTCFullYear();
  const monthStart = new Date(Date.UTC(currentYear, currentMonth, 1));
  const monthEnd = new Date(
    Date.UTC(currentYear, currentMonth + 1, 0, 23, 59, 59, 999),
  );

  const results: GeneratedInvoice[] = [];

  for (const contract of contracts) {
    try {
      // Check if invoice already exists for this billing period
      const existingInvoice = await prisma.invoice.findFirst({
        where: {
          tenantId,
          customerId: contract.customerId,
          issuedDate: { gte: monthStart, lte: monthEnd },
          lineItems: {
            some: { sourceType: "CONTRACT", sourceId: contract.id },
          },
        },
      });

      if (existingInvoice) continue;

      // Build line items
      const lineItems: {
        description: string;
        quantity: number;
        unitPriceCents: number;
        taxCategory: string;
        glAccountId?: string;
        isDeferred: boolean;
        sourceType: string;
        sourceId: string;
      }[] = [];

      // 1. Slip rental — billing window and contract start are both
      // calendar values; keep both at UTC midnight so the proration check
      // ("did this contract start mid-month?") behaves identically on
      // every server timezone.
      const billingStart = new Date(Date.UTC(currentYear, currentMonth, 1));
      const billingEnd = new Date(Date.UTC(currentYear, currentMonth + 1, 0));
      const contractStart = contract.startDate;
      const needsProration =
        contractStart > billingStart && contractStart <= billingEnd;

      const rentalAmount = needsProration
        ? calculateProration(
            contract.rateCents,
            contractStart,
            billingEnd,
          )
        : contract.rateCents;

      // GL + tax class resolution. The contract's linked rate plan is
      // the source of truth when present (even if deactivated — we
      // warn but don't re-route to a different plan). Only unlinked
      // contracts fall back to the (location, slipType) lookup.
      let slipGlAccountId: string | undefined;
      let slipTaxClass: string | null = null;
      const linkedPlan = contract.dockageRate;
      if (linkedPlan) {
        if (!linkedPlan.active) {
          console.warn(
            `[billing] contract ${contract.id} uses deactivated dockage rate ${linkedPlan.id}; re-link to an active plan to silence`,
          );
        }
        const resolved = await resolveDockageRateGlAccount(
          tenantId,
          linkedPlan.id,
          contract.slip.locationId ?? null,
        );
        slipGlAccountId = resolved ?? linkedPlan.glAccountId ?? undefined;
        slipTaxClass = linkedPlan.taxClass ?? null;
      } else if (contract.slip.locationId && contract.slip.slipType) {
        console.warn(
          `[billing] contract ${contract.id} has no linked dockage rate; falling back to (location, slipType) lookup`,
        );
        const dockageRate = await prisma.dockageRate.findFirst({
          where: {
            tenantId,
            locationId: contract.slip.locationId,
            slipType: contract.slip.slipType,
            active: true,
          },
          select: { id: true, glAccountId: true, taxClass: true },
          orderBy: { createdAt: "desc" },
        });
        if (dockageRate) {
          const resolved = await resolveDockageRateGlAccount(
            tenantId,
            dockageRate.id,
            contract.slip.locationId,
          );
          slipGlAccountId = resolved ?? dockageRate.glAccountId ?? undefined;
          slipTaxClass = dockageRate.taxClass ?? null;
        }
      }
      // A "Tax Exempt" plan flips the slip line to an exempt tax
      // category so the calculator skips it. Other taxClass values are
      // passed through verbatim as the category hint.
      const slipTaxCategory = isTaxExempt(slipTaxClass)
        ? "exempt"
        : (slipTaxClass && slipTaxClass !== "Standard"
            ? slipTaxClass
            : "slip_rental");

      lineItems.push({
        description: `Slip ${contract.slip.slipNumber} — ${billingStart.toLocaleDateString("en-US", { month: "long", year: "numeric" })}${needsProration ? " (prorated)" : ""}`,
        quantity: 1,
        unitPriceCents: rentalAmount,
        taxCategory: slipTaxCategory,
        glAccountId: slipGlAccountId,
        isDeferred: contract.billingCycle !== "MONTHLY",
        sourceType: "CONTRACT",
        sourceId: contract.id,
      });

      // 2. Electricity
      const electricityMode =
        contract.electricityMode ?? contract.slip.electricityMode;

      if (electricityMode === "FLAT_FEE" && contract.slip.flatFeeCents) {
        lineItems.push({
          description: `Electricity — Flat fee — Slip ${contract.slip.slipNumber}`,
          quantity: 1,
          unitPriceCents: contract.slip.flatFeeCents,
          taxCategory: "electricity",
          glAccountId: slipGlAccountId,
          isDeferred: false,
          sourceType: "ELECTRICITY",
          sourceId: contract.slipId,
        });
      } else if (electricityMode === "METERED") {
        // Pull every unbilled meter reading for the slip and emit one line
        // per reading so the InvoiceLineItem.sourceId join blocks
        // double-billing on re-run. Sums still appear on the invoice as
        // a single electricity subtotal.
        const elecResult = await calculateElectricity(
          contract.slipId,
          tenantId,
        );
        if (elecResult) {
          const perReading = await prisma.meterReading.findMany({
            where: { id: { in: elecResult.meterReadingIds } },
            orderBy: { readingDate: "asc" },
          });
          for (const r of perReading) {
            lineItems.push({
              description: `Electricity — ${r.consumedKwh} kWh @ $${(r.rateCents / 100).toFixed(2)}/kWh — Slip ${contract.slip.slipNumber} (${r.readingDate.toISOString().slice(0, 10)})`,
              quantity: 1,
              unitPriceCents: r.amountCents,
              taxCategory: "electricity",
              glAccountId: slipGlAccountId,
              isDeferred: false,
              sourceType: "METER_READING",
              sourceId: r.id,
            });
          }
        }
      }

      if (lineItems.length === 0) continue;

      // 3. Calculate tax (multi-jurisdiction)
      // Resolve the location's taxProvider so the factory can route to
      // Avalara / TaxJar when the marina has configured an external provider.
      const locationForTax = contract.slip.locationId
        ? await prisma.location.findUnique({
            where: { id: contract.slip.locationId },
            select: { taxProvider: true },
          })
        : null;

      const customerExempt = contract.customerId
        ? await checkTaxExempt(contract.customerId, tenantId)
        : false;

      const taxResult = customerExempt || !contract.slip.locationId
        ? { totalTaxCents: 0, items: lineItems.map((li) => ({ description: li.description, taxRate: 0, taxCents: 0, breakdowns: [] })) }
        : await getTaxProvider(locationForTax?.taxProvider).calculateTax({
            tenantId,
            locationId: contract.slip.locationId,
            lineItems: lineItems.map((li) => ({
              description: li.description,
              amountCents: li.unitPriceCents * li.quantity,
              taxCategory: li.taxCategory,
            })),
            customerExempt,
          });

      // 4. Create invoice in a transaction
      const invoiceId = uuid();
      const invoiceNumber = `INV-${Date.now().toString(36).toUpperCase()}`;
      const dueDate = new Date(today);
      dueDate.setDate(dueDate.getDate() + 30);

      let subtotalCents = 0;
      let totalTaxCents = 0;

      const invoiceLineItemData = lineItems.map((li, idx) => {
        const extendedCents = li.unitPriceCents * li.quantity;
        const taxCents = taxResult.items[idx]?.taxCents ?? 0;
        const taxRate = taxResult.items[idx]?.taxRate ?? 0;
        subtotalCents += extendedCents;
        totalTaxCents += taxCents;

        return {
          id: uuid(),
          description: li.description,
          quantity: li.quantity,
          unitPriceCents: li.unitPriceCents,
          discountCents: 0,
          taxRate,
          taxCents,
          extendedCents,
          glAccountId: li.glAccountId ?? null,
          isDeferred: li.isDeferred,
          sourceType: li.sourceType,
          sourceId: li.sourceId,
        };
      });

      const totalCents = subtotalCents + totalTaxCents;

      const invoice = await prisma.$transaction(async (tx) => {
        const inv = await tx.invoice.create({
          data: {
            id: invoiceId,
            tenantId,
            locationId: contract.slip.locationId ?? null,
            customerId: contract.customerId,
            invoiceNumber,
            issuedDate: today,
            dueDate,
            status: "ISSUED",
            subtotalCents,
            taxCents: totalTaxCents,
            totalCents,
            balanceCents: totalCents,
            lineItems: {
              createMany: { data: invoiceLineItemData },
            },
          },
          include: { lineItems: true },
        });

        // Persist per-jurisdiction tax breakdown rows for reporting
        const lineItemTaxRows: {
          id: string;
          tenantId: string;
          lineItemId: string;
          jurisdictionId: string;
          ratePctBps: number;
          taxableCents: number;
          taxCents: number;
        }[] = [];

        inv.lineItems.forEach((dbLi, idx) => {
          const breakdowns = taxResult.items[idx]?.breakdowns ?? [];
          for (const bd of breakdowns) {
            lineItemTaxRows.push({
              id: uuid(),
              tenantId,
              lineItemId: dbLi.id,
              jurisdictionId: bd.jurisdictionId,
              ratePctBps: bd.ratePctBps,
              taxableCents: bd.taxableAmountCents,
              taxCents: bd.taxCents,
            });
          }
        });

        if (lineItemTaxRows.length > 0) {
          await tx.invoiceLineItemTax.createMany({ data: lineItemTaxRows });
        }

        // Post GL entries (with per-jurisdiction tax breakdowns)
        const allBreakdowns = taxResult.items.flatMap((item) => item.breakdowns);
        await postInvoice(
          {
            id: inv.id,
            tenantId,
            locationId: inv.locationId,
            totalCents: inv.totalCents,
            lineItems: inv.lineItems,
            taxBreakdowns: allBreakdowns,
          },
          tx,
        );

        // Create deferred schedules for deferred line items
        for (const li of inv.lineItems) {
          if (li.isDeferred) {
            await createDeferredSchedule(
              tenantId,
              { id: li.id, extendedCents: li.extendedCents, taxCents: li.taxCents },
              billingStart,
              billingEnd,
            );
          }
        }

        return inv;
      });

      // 5. Apply credits
      await applyCredits(invoiceId, tenantId);

      // 6. Auto-charge
      let autoChargeResult: "SUCCESS" | "FAILED" | "SKIPPED" = "SKIPPED";
      let skipReason: string | null = null;

      if (!contract.customer.stripeCustomerId) {
        skipReason = "no Stripe customer";
      } else if (contract.customer.achBlocked) {
        skipReason = "ACH blocked";
      } else {
        try {
          // Resolve the Stripe Connect account using the SHARED helper used
          // by the staff/portal autopay toggles. This guarantees the
          // metadata.autopay flag is read from the same Stripe account it
          // was written to — no cross-account drift in multi-location
          // marinas.
          const { stripeAccountId } = await getStripeAccountForCustomer(
            contract.customer.id,
            tenantId,
          );

          if (!stripeAccountId) {
            skipReason = "no Stripe account configured";
          } else {
            // Read the autopay opt-in flag from the customer's Stripe
            // metadata before charging. Without this gate, anyone who
            // saved a card for one-off use would silently get auto-charged
            // on every recurring invoice. The portal writes this same
            // flag, so the staff toggle and customer toggle agree.
            const stripeForRead = requireStripe();
            const stripeCustomer = (await stripeForRead.customers.retrieve(
              contract.customer.stripeCustomerId,
              {},
              { stripeAccount: stripeAccountId },
            )) as import("stripe").default.Customer;

            if (stripeCustomer.metadata?.autopay !== "true") {
              skipReason = "autopay not enabled";
            } else {
            // Reload invoice balance after credits
            const currentInvoice = await prisma.invoice.findUnique({
              where: { id: invoiceId },
              select: { balanceCents: true },
            });

            const chargeAmount = currentInvoice?.balanceCents ?? totalCents;

            if (chargeAmount > 0) {
              const paymentIntent = await requireStripe().paymentIntents.create(
                {
                  amount: chargeAmount,
                  currency: "usd",
                  customer: contract.customer.stripeCustomerId,
                  confirm: true,
                  off_session: true,
                  automatic_payment_methods: {
                    enabled: true,
                    allow_redirects: "never",
                  },
                  metadata: {
                    invoiceId,
                    tenantId,
                    contractId: contract.id,
                  },
                },
                { stripeAccount: stripeAccountId },
              );

              if (paymentIntent.status === "succeeded") {
                // Record payment
                const paymentId = uuid();
                await prisma.$transaction(async (tx) => {
                  await tx.payment.create({
                    data: {
                      id: paymentId,
                      tenantId,
                      customerId: contract.customerId,
                      invoiceId,
                      amountCents: chargeAmount,
                      method: "CARD",
                      stripePaymentId: paymentIntent.id,
                      postedDate: new Date(),
                      status: "COMPLETED",
                    },
                  });

                  await postPayment(
                    {
                      id: paymentId,
                      tenantId,
                      amountCents: chargeAmount,
                      method: "CARD",
                      // Per-location chart of accounts: thread the slip's
                      // location so A/R and bank lookups land on this
                      // marina's own rows instead of whichever location
                      // Prisma happens to return first.
                      locationId: contract.slip.locationId ?? null,
                    },
                    tx,
                  );

                  await tx.invoice.update({
                    where: { id: invoiceId },
                    data: {
                      balanceCents: { decrement: chargeAmount },
                      status: "PAID",
                    },
                  });
                });

                autoChargeResult = "SUCCESS";
              } else {
                autoChargeResult = "FAILED";
              }
            } else {
              // Invoice fully covered by credits
              autoChargeResult = "SKIPPED";
              skipReason = "invoice covered by credits";
            }
            }
          }
        } catch (err) {
          console.error(
            `Auto-charge failed for invoice ${invoiceId}:`,
            err instanceof Error ? err.message : err,
          );
          autoChargeResult = "FAILED";
        }
      }

      if (autoChargeResult === "SKIPPED" && skipReason) {
        console.log(
          `[billing] auto-charge skipped for invoice ${invoiceId}: ${skipReason}`,
        );
      }

      results.push({
        invoiceId,
        customerId: contract.customerId,
        totalCents,
        autoChargeResult,
      });

      // Hand the freshly-finalized invoice off to the QBO sync worker so it
      // gets pushed to QuickBooks (mirrors the manual finalize route at
      // POST /api/invoices/:id/finalize). Without this, recurring invoices
      // stay stuck with qboInvoiceId=null and surface in the Failed Syncs
      // panel as "never attempted". Gate on per-location connection first,
      // then fall back to tenant-level realm so multi-location marinas with
      // a single tenant-level QBO realm still get queued. Enqueue failures
      // must not block invoice creation — log and continue.
      try {
        const locationConnected = contract.slip.locationId
          ? await isLocationQboConnected(contract.slip.locationId)
          : false;
        let shouldEnqueue = locationConnected;
        if (!shouldEnqueue) {
          const tenantForQbo = await prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { qboRealmId: true },
          });
          shouldEnqueue = !!tenantForQbo?.qboRealmId;
        }
        if (shouldEnqueue) {
          await queues["qbo-sync"].add("sync-invoice", {
            tenantId,
            invoiceId,
          });
        }
      } catch (err) {
        console.error(
          `[billing] failed to enqueue qbo-sync for invoice ${invoiceId}:`,
          err instanceof Error ? err.message : err,
        );
      }
    } catch (err) {
      console.error(
        `Failed to generate invoice for contract ${contract.id}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Electricity calculation
// ---------------------------------------------------------------------------

interface ElectricityResult {
  meterReadingIds: string[];
  consumedKwh: number;
  rateCents: number;
  amountCents: number;
}

/**
 * Return the aggregate charge for all meter readings on a slip that fall
 * within the billing period (the last ~90 days) and have NOT yet been
 * invoiced.
 *
 * "Already billed" is detected by joining to InvoiceLineItem via
 * (sourceType: "METER_READING", sourceId: reading.id). The billing run
 * writes line items with those fields; once an invoice is finalised,
 * re-running the job won't double-bill.
 *
 * The returned meterReadingIds list is used by the caller to emit one
 * InvoiceLineItem per reading (or we can emit a single aggregate line —
 * current caller emits a single line with the first id on record, which
 * is enough for the anti-double-bill join because all ids are captured
 * in sourceId semantics only when each reading gets its own line).
 */
export async function calculateElectricity(
  slipId: string,
  tenantId: string,
): Promise<ElectricityResult | null> {
  // Look back 90 days — covers weekly-read marinas without dragging in
  // ancient readings that should have been billed long ago.
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);

  const readings = await prisma.meterReading.findMany({
    where: {
      tenantId,
      slipId,
      readingDate: { gte: cutoff },
    },
    orderBy: { readingDate: "asc" },
  });
  if (readings.length === 0) return null;

  // Exclude any reading that's already referenced by an InvoiceLineItem.
  const billed = await prisma.invoiceLineItem.findMany({
    where: {
      sourceType: "METER_READING",
      sourceId: { in: readings.map((r) => r.id) },
      invoice: { tenantId },
    },
    select: { sourceId: true },
  });
  const billedIds = new Set(billed.map((b) => b.sourceId));
  const unbilled = readings.filter((r) => !billedIds.has(r.id));
  if (unbilled.length === 0) return null;

  const consumedKwh = unbilled.reduce((sum, r) => sum + r.consumedKwh, 0);
  const amountCents = unbilled.reduce((sum, r) => sum + r.amountCents, 0);
  // Use the most recent rate for display purposes.
  const rateCents = unbilled[unbilled.length - 1]!.rateCents;

  return {
    meterReadingIds: unbilled.map((r) => r.id),
    consumedKwh,
    rateCents,
    amountCents,
  };
}

// ---------------------------------------------------------------------------
// Proration
// ---------------------------------------------------------------------------

/**
 * Calculate prorated amount based on per-diem for partial months.
 *
 * @param rateCents   Full monthly rate in cents
 * @param startDate   Start of the partial period
 * @param endDate     End of the partial period
 * @returns Prorated amount in cents
 */
export function calculateProration(
  rateCents: number,
  startDate: Date,
  endDate: Date,
): number {
  // Total days in the month (use endDate's month). Read UTC components
  // because callers pass UTC-midnight calendar dates.
  const year = endDate.getUTCFullYear();
  const month = endDate.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  // Days of service
  const msPerDay = 1000 * 60 * 60 * 24;
  const serviceDays =
    Math.floor((endDate.getTime() - startDate.getTime()) / msPerDay) + 1;

  const perDiem = rateCents / daysInMonth;
  return Math.round(perDiem * serviceDays);
}

// ---------------------------------------------------------------------------
// Credit application
// ---------------------------------------------------------------------------

/**
 * Apply outstanding customer credits (unapplied payments) to an invoice balance.
 *
 * Credits are payments with status=COMPLETED and no invoiceId (overpayments, manual credits).
 */
export async function applyCredits(
  invoiceId: string,
  tenantId: string,
): Promise<number> {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, tenantId },
    select: { id: true, customerId: true, balanceCents: true, status: true },
  });

  if (!invoice || invoice.balanceCents <= 0) return 0;

  // Find unapplied credit payments
  const credits = await prisma.payment.findMany({
    where: {
      tenantId,
      customerId: invoice.customerId,
      invoiceId: null,
      status: "COMPLETED",
    },
    orderBy: { createdAt: "asc" },
  });

  let totalApplied = 0;
  let remainingBalance = invoice.balanceCents;

  for (const credit of credits) {
    if (remainingBalance <= 0) break;

    const applyAmount = Math.min(credit.amountCents, remainingBalance);

    await prisma.$transaction(async (tx) => {
      // Link credit payment to this invoice
      await tx.payment.update({
        where: { id: credit.id },
        data: { invoiceId: invoice.id },
      });

      remainingBalance -= applyAmount;
      totalApplied += applyAmount;

      // Update invoice balance
      await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          balanceCents: remainingBalance,
          status: remainingBalance <= 0 ? "PAID" : undefined,
        },
      });
    });
  }

  return totalApplied;
}
