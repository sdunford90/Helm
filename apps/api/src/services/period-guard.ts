import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

export class PeriodLockedError extends Error {
  code = "PERIOD_LOCKED";
  periodId: string;
  periodLabel: string;

  constructor(periodId: string, periodStart: Date) {
    const label = periodStart.toLocaleString("en-US", { month: "long", year: "numeric" });
    super(`Accounting period ${label} is closed and cannot accept new entries`);
    this.periodId = periodId;
    this.periodLabel = label;
  }
}

// Check whether a GL entry dated at `entryDate` for `locationId` would fall
// into a closed accounting period. Throws PeriodLockedError if so.
// Pass a Prisma transaction client when called inside a transaction.
export async function assertPeriodOpen(
  tenantId: string,
  locationId: string | null | undefined,
  entryDate: Date,
  tx?: Prisma.TransactionClient
): Promise<void> {
  if (!locationId) return; // no location = no period check

  const db: Prisma.TransactionClient = tx ?? (prisma as unknown as Prisma.TransactionClient);

  let lockedPeriod: { id: string; periodStart: Date } | null = null;
  try {
    lockedPeriod = await db.accountingPeriod.findFirst({
      where: {
        tenantId,
        locationId,
        periodStart: { lte: entryDate },
        periodEnd: { gte: entryDate },
        closedAt: { not: null },
      },
      select: { id: true, periodStart: true },
    });
  } catch (err) {
    // AccountingPeriod table may not exist yet (pre-migration). Fail open.
    console.warn("[period-guard] Could not query accounting_periods:", (err as Error).message);
    return;
  }

  if (lockedPeriod) {
    throw new PeriodLockedError(lockedPeriod.id, lockedPeriod.periodStart);
  }
}
