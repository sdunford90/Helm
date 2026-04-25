import { prisma } from "../lib/prisma.js";
import { queues } from "../lib/queue.js";

// ---------------------------------------------------------------------------
// Renewal Engine Service
//
// Handles bulk contract renewal logic: batch creation, rate calculations,
// preview generation, batch execution, and auto-renewal checks.
// ---------------------------------------------------------------------------

// ─── Types ────────────────────────────────────────────────────────────────────

export type RateIncreaseType = "none" | "fixedPercent" | "fixedDollar" | "custom";

export interface RenewalFilters {
  expiryDateFrom?: Date;
  expiryDateTo?: Date;
  dockId?: string;
  slipType?: string;
  billingCycle?: string;
  status?: string[];
}

export interface RateIncreaseConfig {
  type: RateIncreaseType;
  value?: number; // percent (e.g. 5 = 5%) or dollar amount in cents
}

export interface ContractPreviewItem {
  contractId: string;
  contractNumber: string;
  customerId: string;
  customerName: string;
  slipId: string;
  slipNumber: string;
  dockId: string | null;
  currentRateCents: number;
  newRateCents: number;
  deltaCents: number;
  billingCycle: string;
  startDate: Date;
  endDate: Date | null;
  overrideRateCents?: number | null;
}

export interface BatchPreview {
  batchId: string;
  contractCount: number;
  currentRevenueCents: number;
  newRevenueCents: number;
  revenueDeltaCents: number;
  contracts: ContractPreviewItem[];
}

// ─── Rate Calculation ─────────────────────────────────────────────────────────

/**
 * Calculate the new rate given a current rate and increase configuration.
 */
export function calculateNewRate(
  currentRateCents: number,
  increaseType: RateIncreaseType,
  increaseValue?: number,
): number {
  switch (increaseType) {
    case "none":
      return currentRateCents;

    case "fixedPercent": {
      if (increaseValue === undefined || increaseValue === null) return currentRateCents;
      const multiplier = 1 + increaseValue / 100;
      return Math.round(currentRateCents * multiplier);
    }

    case "fixedDollar": {
      if (increaseValue === undefined || increaseValue === null) return currentRateCents;
      return currentRateCents + Math.round(increaseValue);
    }

    case "custom":
      // For custom, the increaseValue IS the new rate
      if (increaseValue === undefined || increaseValue === null) return currentRateCents;
      return Math.round(increaseValue);

    default:
      return currentRateCents;
  }
}

// ─── Batch Creation ───────────────────────────────────────────────────────────

/**
 * Create a renewal batch: query matching contracts, calculate new rates,
 * and persist the RenewalBatch record with linked contracts.
 */
export async function createBatch(
  tenantId: string,
  createdBy: string,
  filters: RenewalFilters,
  rateIncrease: RateIncreaseConfig,
): Promise<{ batchId: string; contractCount: number }> {
  // Build the where clause for matching contracts
  const where: Record<string, unknown> = {
    tenantId,
    status: { in: filters.status ?? ["ACTIVE", "EXPIRING"] },
  };

  if (filters.expiryDateFrom || filters.expiryDateTo) {
    where.endDate = {
      ...(filters.expiryDateFrom ? { gte: filters.expiryDateFrom } : {}),
      ...(filters.expiryDateTo ? { lte: filters.expiryDateTo } : {}),
    };
  }

  if (filters.billingCycle) {
    where.billingCycle = filters.billingCycle;
  }

  if (filters.dockId) {
    where.slip = { dockId: filters.dockId };
  }

  if (filters.slipType) {
    where.slip = { ...((where.slip as Record<string, unknown>) ?? {}), slipType: filters.slipType };
  }

  // Query matching contracts
  const contracts = await prisma.slipContract.findMany({
    where,
    include: {
      slip: { select: { id: true, slipNumber: true, dockId: true, slipType: true } },
      customer: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  if (contracts.length === 0) {
    throw Object.assign(new Error("No contracts match the given filters"), {
      statusCode: 400,
      code: "NO_MATCHING_CONTRACTS",
    });
  }

  // Calculate total revenue delta
  let totalDeltaCents = 0;
  for (const contract of contracts) {
    const newRate = calculateNewRate(contract.rateCents, rateIncrease.type, rateIncrease.value);
    totalDeltaCents += newRate - contract.rateCents;
  }

  // Create the batch record and link contracts
  const batch = await prisma.$transaction(async (tx) => {
    const newBatch = await tx.renewalBatch.create({
      data: {
        tenantId,
        createdBy,
        status: "DRAFT",
        rateIncreaseType: rateIncrease.type,
        rateIncreaseValue: rateIncrease.value ?? null,
        contractCount: contracts.length,
        revenueDeltaCents: totalDeltaCents,
      },
    });

    // Link all matching contracts to this batch
    await tx.slipContract.updateMany({
      where: { id: { in: contracts.map((c) => c.id) } },
      data: { renewalBatchId: newBatch.id },
    });

    return newBatch;
  });

  return { batchId: batch.id, contractCount: contracts.length };
}

// ─── Batch Preview ────────────────────────────────────────────────────────────

/**
 * Generate a contract-by-contract breakdown showing current/new rates
 * and the aggregate revenue delta.
 */
export async function previewBatch(batchId: string, tenantId: string): Promise<BatchPreview> {
  const batch = await prisma.renewalBatch.findFirst({
    where: { id: batchId, tenantId },
  });

  if (!batch) {
    throw Object.assign(new Error("Renewal batch not found"), {
      statusCode: 404,
      code: "BATCH_NOT_FOUND",
    });
  }

  const contracts = await prisma.slipContract.findMany({
    where: { renewalBatchId: batchId, tenantId },
    include: {
      slip: { select: { id: true, slipNumber: true, dockId: true } },
      customer: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  const increaseType = (batch.rateIncreaseType ?? "none") as RateIncreaseType;
  const increaseValue = batch.rateIncreaseValue ?? undefined;

  let currentRevenueCents = 0;
  let newRevenueCents = 0;

  const items: ContractPreviewItem[] = contracts.map((c) => {
    const newRate = calculateNewRate(c.rateCents, increaseType, increaseValue);
    const delta = newRate - c.rateCents;

    currentRevenueCents += c.rateCents;
    newRevenueCents += newRate;

    return {
      contractId: c.id,
      contractNumber: c.id.slice(0, 8).toUpperCase(),
      customerId: c.customer.id,
      customerName: `${c.customer.firstName} ${c.customer.lastName}`,
      slipId: c.slip.id,
      slipNumber: c.slip.slipNumber,
      dockId: c.slip.dockId,
      currentRateCents: c.rateCents,
      newRateCents: newRate,
      deltaCents: delta,
      billingCycle: c.billingCycle,
      startDate: c.startDate,
      endDate: c.endDate,
    };
  });

  return {
    batchId,
    contractCount: contracts.length,
    currentRevenueCents,
    newRevenueCents,
    revenueDeltaCents: newRevenueCents - currentRevenueCents,
    contracts: items,
  };
}

// ─── Batch Execution ──────────────────────────────────────────────────────────

/**
 * Execute a renewal batch:
 *  1. Create new successor contracts with updated rates
 *  2. Mark old contracts as RENEWED
 *  3. Queue e-signature emails for each renewed contract
 */
export async function executeBatch(
  batchId: string,
  tenantId: string,
  executedBy: string,
): Promise<{ renewedCount: number; newContractIds: string[] }> {
  const batch = await prisma.renewalBatch.findFirst({
    where: { id: batchId, tenantId },
  });

  if (!batch) {
    throw Object.assign(new Error("Renewal batch not found"), {
      statusCode: 404,
      code: "BATCH_NOT_FOUND",
    });
  }

  if (batch.status !== "APPROVED" && batch.status !== "DRAFT") {
    throw Object.assign(
      new Error(`Cannot execute batch with status "${batch.status}"`),
      { statusCode: 400, code: "INVALID_BATCH_STATUS" },
    );
  }

  const contracts = await prisma.slipContract.findMany({
    where: { renewalBatchId: batchId, tenantId },
    include: {
      customer: { select: { id: true, firstName: true, lastName: true, email: true } },
      slip: { select: { id: true, slipNumber: true } },
    },
  });

  const increaseType = (batch.rateIncreaseType ?? "none") as RateIncreaseType;
  const increaseValue = batch.rateIncreaseValue ?? undefined;

  const newContractIds: string[] = [];

  await prisma.$transaction(async (tx) => {
    for (const contract of contracts) {
      const newRate = calculateNewRate(contract.rateCents, increaseType, increaseValue);

      // Calculate new term dates: start = old end (or now), end = +1 year
      const newStartDate = contract.endDate ?? new Date();
      const newEndDate = new Date(newStartDate);
      newEndDate.setFullYear(newEndDate.getFullYear() + 1);

      // Create successor contract
      const successor = await tx.slipContract.create({
        data: {
          tenantId,
          slipId: contract.slipId,
          customerId: contract.customerId,
          boatId: contract.boatId,
          startDate: newStartDate,
          endDate: newEndDate,
          billingCycle: contract.billingCycle,
          billingAnchor: contract.billingAnchor,
          rateCents: newRate,
          electricityMode: contract.electricityMode,
          autoRenew: contract.autoRenew,
          status: "ACTIVE",
          securityDepositCents: contract.securityDepositCents,
          earlyTerminationType: contract.earlyTerminationType,
          earlyTerminationValue: contract.earlyTerminationValue,
          qboItemId: contract.qboItemId,
          renewalBatchId: batchId,
        },
      });

      newContractIds.push(successor.id);

      // Mark old contract as RENEWED
      await tx.slipContract.update({
        where: { id: contract.id },
        data: { status: "RENEWED" },
      });

      // Audit log
      await tx.auditLog.create({
        data: {
          tenantId,
          userId: executedBy,
          recordType: "SlipContract",
          recordId: successor.id,
          action: "BULK_RENEWED",
          changedFieldsJson: {
            previousContractId: contract.id,
            previousRate: contract.rateCents,
            newRate,
            batchId,
          },
        },
      });
    }

    // Update batch status
    await tx.renewalBatch.update({
      where: { id: batchId },
      data: { status: "EXECUTED" },
    });
  });

  // Queue e-signature emails (outside transaction)
  for (const contract of contracts) {
    if (contract.customer.email) {
      await queues.email.add("renewal-esign", {
        tenantId,
        customerId: contract.customer.id,
        email: contract.customer.email,
        customerName: `${contract.customer.firstName} ${contract.customer.lastName}`,
        slipNumber: contract.slip.slipNumber,
        batchId,
      });
    }
  }

  return { renewedCount: contracts.length, newContractIds };
}

// ─── Auto-Renewal Check ──────────────────────────────────────────────────────

/**
 * Transition contract lifecycle based on endDate alone — separate from the
 * auto-renew path because even manually-renewed contracts need their old
 * instance flipped to EXPIRED once the term runs out.
 *
 *   ACTIVE, endDate < now            → EXPIRED
 *   EXPIRING, endDate < now          → EXPIRED
 *   ACTIVE, endDate within 30 days   → EXPIRING
 *
 * Safe to run repeatedly; all changes are idempotent updateMany calls.
 */
export async function transitionContractLifecycle(
  tenantId: string,
): Promise<{ expired: number; expiring: number }> {
  const now = new Date();
  const expiringCutoff = new Date();
  expiringCutoff.setDate(now.getDate() + 30);

  const expired = await prisma.slipContract.updateMany({
    where: {
      tenantId,
      status: { in: ["ACTIVE", "EXPIRING"] },
      endDate: { lt: now },
    },
    data: { status: "EXPIRED" },
  });

  const expiring = await prisma.slipContract.updateMany({
    where: {
      tenantId,
      status: "ACTIVE",
      endDate: { gte: now, lte: expiringCutoff },
    },
    data: { status: "EXPIRING" },
  });

  return { expired: expired.count, expiring: expiring.count };
}

/**
 * BullMQ job handler: find contracts expiring within 30 days that have
 * autoRenew=true and create a rolling renewal batch for them.
 */
export async function autoRenewCheck(tenantId: string): Promise<{
  batchId: string | null;
  contractCount: number;
  executedCount: number;
  expired: number;
  expiring: number;
}> {
  // First: sweep lifecycle transitions so the renewal query below sees
  // correct statuses.
  const lifecycle = await transitionContractLifecycle(tenantId);

  const now = new Date();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + 30);

  const eligibleContracts = await prisma.slipContract.findMany({
    where: {
      tenantId,
      autoRenew: true,
      status: { in: ["ACTIVE", "EXPIRING"] },
      endDate: { gte: now, lte: cutoff },
      renewalBatchId: null, // Not already in a batch
    },
  });

  if (eligibleContracts.length === 0) {
    return { batchId: null, contractCount: 0, executedCount: 0, ...lifecycle };
  }

  const result = await createBatch(
    tenantId,
    "system:auto-renew",
    {
      expiryDateFrom: now,
      expiryDateTo: cutoff,
      status: ["ACTIVE", "EXPIRING"],
    },
    { type: "none" },
  );

  // Auto-approve auto-renewal batches
  await prisma.renewalBatch.update({
    where: { id: result.batchId },
    data: {
      status: "APPROVED",
      approvedBy: "system:auto-renew",
      approvedAt: new Date(),
    },
  });

  // Execute immediately when the tenant has opted in. Without this opt-in
  // the batch sits APPROVED waiting for a human to click 'Execute' — which
  // defeats the point of 'auto'-renew. Operators turn this on per-tenant
  // via tenant.autoExecuteRenewals.
  let executedCount = 0;
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { autoExecuteRenewals: true },
  });
  if (tenant?.autoExecuteRenewals) {
    try {
      const exec = await executeBatch(
        result.batchId,
        tenantId,
        "system:auto-renew",
      );
      executedCount = exec.renewedCount;
    } catch (err) {
      // Don't break the cron if one batch fails — log and let humans clean
      // up via the standard review UI.
      console.error(
        `[renewal-engine] auto-execute failed for batch ${result.batchId}:`,
        err,
      );
    }
  }

  return {
    batchId: result.batchId,
    contractCount: result.contractCount,
    executedCount,
    ...lifecycle,
  };
}
