import { prisma } from "../lib/prisma.js";
import { v4 as uuid } from "uuid";
import { postDeferredRecognition } from "./gl-posting.js";

// ---------------------------------------------------------------------------
// Deferred Revenue Service
//
// Manages creation, recognition, and washout of deferred revenue schedules.
// Used for annual/multi-month contracts where revenue must be recognized
// monthly over the service period.
// ---------------------------------------------------------------------------

/**
 * Create a deferred schedule for an invoice line item.
 *
 * Generates monthly recognition entries from startDate to endDate,
 * distributing totalCents evenly with remainder allocated to the last entry.
 */
export async function createDeferredSchedule(
  tenantId: string,
  invoiceLineItem: {
    id: string;
    extendedCents: number;
    taxCents: number;
  },
  startDate: Date,
  endDate: Date,
): Promise<string> {
  const totalCents = invoiceLineItem.extendedCents + invoiceLineItem.taxCents;

  // Calculate number of months
  const startYear = startDate.getFullYear();
  const startMonth = startDate.getMonth();
  const endYear = endDate.getFullYear();
  const endMonth = endDate.getMonth();
  const monthCount = (endYear - startYear) * 12 + (endMonth - startMonth) + 1;

  if (monthCount <= 0) {
    throw new Error("Deferred schedule endDate must be after startDate");
  }

  const perMonthCents = Math.floor(totalCents / monthCount);
  const remainder = totalCents - perMonthCents * monthCount;

  const scheduleId = uuid();
  const entries: {
    id: string;
    scheduleId: string;
    recognitionDate: Date;
    amountCents: number;
    status: "PENDING";
  }[] = [];

  for (let i = 0; i < monthCount; i++) {
    const recognitionDate = new Date(startYear, startMonth + i, 1);
    const isLast = i === monthCount - 1;

    entries.push({
      id: uuid(),
      scheduleId,
      recognitionDate,
      amountCents: isLast ? perMonthCents + remainder : perMonthCents,
      status: "PENDING" as const,
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.deferredSchedule.create({
      data: {
        id: scheduleId,
        tenantId,
        invoiceLineItemId: invoiceLineItem.id,
        totalCents,
        recognizedCents: 0,
        startDate,
        endDate,
        status: "ACTIVE",
      },
    });

    await tx.deferredEntry.createMany({
      data: entries,
    });
  });

  return scheduleId;
}

/**
 * Nightly job: recognize all PENDING deferred entries where recognitionDate <= today.
 *
 * Posts GL entries (debit Deferred Revenue, credit Revenue) and marks entries as RECOGNIZED.
 */
export async function recognizeDeferred(tenantId: string): Promise<number> {
  const today = new Date();
  today.setHours(23, 59, 59, 999);

  const pendingEntries = await prisma.deferredEntry.findMany({
    where: {
      status: "PENDING",
      recognitionDate: { lte: today },
      schedule: {
        tenantId,
        status: "ACTIVE",
      },
    },
    include: {
      schedule: {
        include: {
          invoiceLineItem: {
            select: {
              glAccountId: true,
              invoice: { select: { locationId: true } },
            },
          },
        },
      },
    },
  });

  let recognized = 0;

  for (const entry of pendingEntries) {
    try {
      await prisma.$transaction(async (tx) => {
        // Post GL entry — thread the originating invoice's locationId so
        // the deferred-revenue side honours per-location pinned accounts.
        const glJournalId = await postDeferredRecognition(
          {
            id: entry.id,
            tenantId,
            amountCents: entry.amountCents,
            revenueAccountId: entry.schedule.invoiceLineItem.glAccountId ?? undefined,
            locationId:
              entry.schedule.invoiceLineItem.invoice?.locationId ?? null,
          },
          tx,
        );

        // Mark entry as recognized
        await tx.deferredEntry.update({
          where: { id: entry.id },
          data: {
            status: "RECOGNIZED",
            glEntryId: glJournalId,
          },
        });

        // Update schedule recognized total
        await tx.deferredSchedule.update({
          where: { id: entry.scheduleId },
          data: {
            recognizedCents: {
              increment: entry.amountCents,
            },
          },
        });

        // Check if schedule is fully recognized
        const schedule = await tx.deferredSchedule.findUnique({
          where: { id: entry.scheduleId },
        });

        if (schedule && schedule.recognizedCents >= schedule.totalCents) {
          await tx.deferredSchedule.update({
            where: { id: entry.scheduleId },
            data: { status: "COMPLETED" },
          });
        }
      });

      recognized++;
    } catch (err) {
      // Log but continue processing other entries
      console.error(
        `Failed to recognize deferred entry ${entry.id}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return recognized;
}

/**
 * Wash out remaining deferred revenue on early termination.
 *
 * - Recognizes earned portion (entries with recognitionDate <= today)
 * - Marks remaining PENDING entries as RECOGNIZED with washout
 * - Posts GL to move remaining deferred to revenue
 */
export async function washoutDeferred(
  scheduleId: string,
  tenantId: string,
): Promise<{ earnedCents: number; washedOutCents: number }> {
  const schedule = await prisma.deferredSchedule.findFirst({
    where: { id: scheduleId, tenantId },
    include: {
      entries: true,
      invoiceLineItem: {
        select: {
          glAccountId: true,
          invoice: { select: { locationId: true } },
        },
      },
    },
  });

  if (!schedule) {
    throw new Error(`Deferred schedule ${scheduleId} not found`);
  }

  const today = new Date();
  today.setHours(23, 59, 59, 999);

  const pendingEntries = schedule.entries.filter((e) => e.status === "PENDING");
  const earnedPending = pendingEntries.filter(
    (e) => e.recognitionDate <= today,
  );
  const futurePending = pendingEntries.filter(
    (e) => e.recognitionDate > today,
  );

  let earnedCents = 0;
  let washedOutCents = 0;

  await prisma.$transaction(async (tx) => {
    // First: recognize earned portion (past due entries)
    const scheduleLocationId =
      schedule.invoiceLineItem.invoice?.locationId ?? null;
    for (const entry of earnedPending) {
      const glJournalId = await postDeferredRecognition(
        {
          id: entry.id,
          tenantId,
          amountCents: entry.amountCents,
          revenueAccountId: schedule.invoiceLineItem.glAccountId ?? undefined,
          locationId: scheduleLocationId,
        },
        tx,
      );

      await tx.deferredEntry.update({
        where: { id: entry.id },
        data: { status: "RECOGNIZED", glEntryId: glJournalId },
      });

      earnedCents += entry.amountCents;
    }

    // Second: wash out future entries — recognize them all at once
    for (const entry of futurePending) {
      const glJournalId = await postDeferredRecognition(
        {
          id: entry.id,
          tenantId,
          amountCents: entry.amountCents,
          revenueAccountId: schedule.invoiceLineItem.glAccountId ?? undefined,
          locationId: scheduleLocationId,
        },
        tx,
      );

      await tx.deferredEntry.update({
        where: { id: entry.id },
        data: { status: "RECOGNIZED", glEntryId: glJournalId },
      });

      washedOutCents += entry.amountCents;
    }

    // Mark schedule complete
    await tx.deferredSchedule.update({
      where: { id: scheduleId },
      data: {
        status: "TERMINATED",
        recognizedCents: schedule.totalCents,
      },
    });
  });

  return { earnedCents, washedOutCents };
}
