import { Worker, type Job } from "bullmq";
import { redisConnection } from "../lib/queue.js";
import { prisma } from "../lib/prisma.js";
import { autoRenewCheck, executeBatch } from "../services/renewal-engine.js";

// ---------------------------------------------------------------------------
// Renewal Job Worker
//
// BullMQ worker that processes the "renewals" queue.
// Supports two job types:
//   1. auto-renew-check — scans for contracts approaching expiry with
//      autoRenew=true and creates rolling renewal batches
//   2. execute-batch — executes an approved renewal batch
// ---------------------------------------------------------------------------

interface AutoRenewPayload {
  type: "auto-renew-check";
  tenantId: string;
}

interface ExecuteBatchPayload {
  type: "execute-batch";
  batchId: string;
  tenantId: string;
  executedBy: string;
}

type RenewalJobPayload = AutoRenewPayload | ExecuteBatchPayload;

async function processRenewalJob(job: Job<RenewalJobPayload>): Promise<unknown> {
  const { data } = job;

  switch (data.type) {
    case "auto-renew-check": {
      console.log(`[renewal-job] Running auto-renew check for tenant ${data.tenantId}`);
      const result = await autoRenewCheck(data.tenantId);
      console.log(
        `[renewal-job] Auto-renew check complete: ${result.contractCount} contracts` +
          (result.batchId ? `, batch ${result.batchId}` : ", no batch created"),
      );
      return result;
    }

    case "execute-batch": {
      console.log(`[renewal-job] Executing batch ${data.batchId} for tenant ${data.tenantId}`);
      const result = await executeBatch(data.batchId, data.tenantId, data.executedBy);
      console.log(
        `[renewal-job] Batch ${data.batchId} executed: ${result.renewedCount} contracts renewed`,
      );
      return result;
    }

    default: {
      const _exhaustive: never = data;
      throw new Error(`Unknown renewal job type: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Worker setup
// ---------------------------------------------------------------------------

export function startRenewalWorker(): Worker<RenewalJobPayload> {
  const worker = new Worker<RenewalJobPayload>("renewals", processRenewalJob, {
    connection: redisConnection,
    concurrency: 5,
  });

  worker.on("completed", (job) => {
    console.log(`[renewal-job] Job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[renewal-job] Job ${job?.id} failed:`, err.message);
  });

  console.log("[renewal-job] Worker started");
  return worker;
}

// ---------------------------------------------------------------------------
// Cron scheduler — enqueue auto-renew checks for all active tenants
// ---------------------------------------------------------------------------

export async function scheduleAutoRenewChecks(): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    where: { status: "ACTIVE" },
    select: { id: true },
  });

  const { queues } = await import("../lib/queue.js");

  for (const tenant of tenants) {
    await queues.renewals.add(
      "auto-renew-check",
      { type: "auto-renew-check", tenantId: tenant.id },
      {
        jobId: `auto-renew-${tenant.id}-${new Date().toISOString().slice(0, 10)}`,
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    );
  }

  console.log(`[renewal-job] Scheduled auto-renew checks for ${tenants.length} tenants`);
}
