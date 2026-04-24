import { prisma } from "../lib/prisma.js";
import { v4 as uuid } from "uuid";
import { calculateTax } from "./tax-engine.js";
import { postInvoice, postPayment } from "./gl-posting.js";
import { createDeferredSchedule } from "./deferred-revenue.js";
import { stripe } from "../lib/stripe.js";

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
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Find active contracts with billingAnchor <= today's day-of-month
  // In production this would use a dedicated next_billing_date column;
  // here we approximate by checking the billing anchor day.
  const contracts = await prisma.slipContract.findMany({
    where: {
      tenantId,
      status: "ACTIVE",
      billingAnchor: { lte: today.getDate() },
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
          electricityMode: true,
          flatFeeCents: true,
          kwhRateCents: true,
        },
      },
    },
  });

  // Filter out contracts that already have an invoice for this month
  const currentMonth = today.getMonth();
  const currentYear = today.getFullYear();
  const monthStart = new Date(currentYear, currentMonth, 1);
  const monthEnd = new Date(currentYear, currentMonth + 1, 0, 23, 59, 59, 999);

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

      // 1. Slip rental
      const billingStart = new Date(currentYear, currentMonth, 1);
      const billingEnd = new Date(currentYear, currentMonth + 1, 0);

      // Check if contract started mid-month for proration
      const contractStart = new Date(contract.startDate);
      const needsProration =
        contractStart > billingStart && contractStart <= billingEnd;

      const rentalAmount = needsProration
        ? calculateProration(
            contract.rateCents,
            contractStart,
            billingEnd,
          )
        : contract.rateCents;

      lineItems.push({
        description: `Slip ${contract.slip.slipNumber} — ${billingStart.toLocaleDateString("en-US", { month: "long", year: "numeric" })}${needsProration ? " (prorated)" : ""}`,
        quantity: 1,
        unitPriceCents: rentalAmount,
        taxCategory: "slip_rental",
        glAccountId: contract.qboItemId ?? undefined,
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
              isDeferred: false,
              sourceType: "METER_READING",
              sourceId: r.id,
            });
          }
        }
      }

      if (lineItems.length === 0) continue;

      // 3. Calculate tax
      const taxResult = await calculateTax(
        tenantId,
        contract.customerId,
        lineItems.map((li) => ({
          description: li.description,
          amountCents: li.unitPriceCents * li.quantity,
          taxCategory: li.taxCategory,
        })),
      );

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

        // Post GL entries
        await postInvoice(
          {
            id: inv.id,
            tenantId,
            totalCents: inv.totalCents,
            lineItems: inv.lineItems,
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

      if (
        contract.customer.stripeCustomerId &&
        !contract.customer.achBlocked
      ) {
        try {
          const tenant = await prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { stripeAccountId: true },
          });

          if (tenant?.stripeAccountId) {
            // Reload invoice balance after credits
            const currentInvoice = await prisma.invoice.findUnique({
              where: { id: invoiceId },
              select: { balanceCents: true },
            });

            const chargeAmount = currentInvoice?.balanceCents ?? totalCents;

            if (chargeAmount > 0) {
              const paymentIntent = await stripe.paymentIntents.create(
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
                { stripeAccount: tenant.stripeAccountId },
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

      results.push({
        invoiceId,
        customerId: contract.customerId,
        totalCents,
        autoChargeResult,
      });
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
  // Total days in the month (use endDate's month)
  const year = endDate.getFullYear();
  const month = endDate.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

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
