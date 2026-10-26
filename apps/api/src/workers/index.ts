import { Worker, type Job } from "bullmq";
import { redisConnection, type EmailJobData, type SmsJobData } from "../lib/queue.js";
import { prisma } from "../lib/prisma.js";
import { runAlgorithmicPricing } from "../jobs/algorithmic-pricing.js";
import { runTenantLifecycleCheck } from "../jobs/tenant-lifecycle.js";
import { startRenewalWorker } from "../jobs/renewal-job.js";
import { generateRecurringInvoices } from "../services/billing.js";
import {
  processEmailJob,
  processSmsJob,
  processRentalAutomationJob,
  onEmailJobFinallyFailed,
  onSmsJobFinallyFailed,
  type RentalAutomationJobData,
} from "./processors.js";

// ---------------------------------------------------------------------------
// BullMQ workers
//
// Importing this module has no side effects. Call startWorkers() from the
// worker entrypoint (src/worker.ts). Job processing logic lives in
// ./processors.ts; recurring schedules live in ./schedulers.ts.
// ---------------------------------------------------------------------------

function isFinalAttempt(job: Job | undefined, err: Error): boolean {
  if (!job) return false;
  if (err.name === "UnrecoverableError") return true;
  return job.attemptsMade >= (job.opts.attempts ?? 1);
}

/** Billing jobs that move money must also be enabled at processing time. */
function recurringBillingEnabled(): boolean {
  return process.env.ENABLE_RECURRING_BILLING_SCHEDULER === "true";
}

export async function processAutomationQueueJob(job: Job): Promise<unknown> {
  if (job.name === "algorithmic-pricing") {
    const tenantId = job.data?.tenantId as string | undefined;
    if (tenantId) {
      const result = await runAlgorithmicPricing(tenantId);
      console.log(
        `[automation-worker] Algorithmic pricing complete: ${result.suggestionsCreated} suggestions created`,
      );
      return result;
    }
    const tenants = await prisma.tenant.findMany({
      where: { status: "ACTIVE" },
      select: { id: true },
    });
    let totalSuggestions = 0;
    for (const tenant of tenants) {
      try {
        const result = await runAlgorithmicPricing(tenant.id);
        totalSuggestions += result.suggestionsCreated;
      } catch (err) {
        // One tenant's failure must not abort the rest.
        console.error(`[automation-worker] Algorithmic pricing failed for tenant ${tenant.id}:`, err);
      }
    }
    console.log(
      `[automation-worker] Algorithmic pricing complete for ${tenants.length} tenants: ${totalSuggestions} total suggestions`,
    );
    return { suggestionsCreated: totalSuggestions };
  }

  const data = job.data as RentalAutomationJobData;
  const result = await processRentalAutomationJob(data);
  console.log(
    `[automation-worker] ${data.type} for customer ${data.customerId}: ${result.status}${result.reason ? ` (${result.reason})` : ""}`,
  );
  return result;
}

export async function processBillingQueueJob(job: Job): Promise<unknown> {
  switch (job.name) {
    case "tenant-lifecycle": {
      const result = await runTenantLifecycleCheck();
      console.log(
        `[billing-worker] Tenant lifecycle check complete: ${result.transitioned} transitions, ${result.notified} notifications`,
      );
      return result;
    }
    case "recurring-billing": {
      if (!recurringBillingEnabled()) {
        console.warn(
          "[billing-worker] recurring-billing job ignored: ENABLE_RECURRING_BILLING_SCHEDULER is not \"true\"",
        );
        return { skipped: true };
      }
      const tenants = await prisma.tenant.findMany({
        where: { status: "ACTIVE" },
        select: { id: true },
      });
      let invoices = 0;
      for (const tenant of tenants) {
        try {
          invoices += (await generateRecurringInvoices(tenant.id)).length;
        } catch (err) {
          console.error(`[billing-worker] Recurring billing failed for tenant ${tenant.id}:`, err);
        }
      }
      console.log(`[billing-worker] Recurring billing: ${invoices} invoices for ${tenants.length} tenants`);
      return { invoices };
    }
    default:
      console.warn(`[billing-worker] Unknown job name: ${job.name}`);
      return null;
  }
}

export interface RunningWorkers {
  workers: Worker[];
  close(): Promise<void>;
}

export function startWorkers(): RunningWorkers {
  // ── Email ────────────────────────────────────────────────────────────────
  const emailWorker = new Worker<EmailJobData>(
    "email",
    async (job) => processEmailJob(job.data),
    { connection: redisConnection, concurrency: 10 },
  );
  emailWorker.on("failed", (job, err) => {
    console.error(`[email-worker] Job ${job?.id} (${job?.data?.type}) failed:`, err.message);
    if (job && isFinalAttempt(job, err)) {
      onEmailJobFinallyFailed(job.data).catch((e) =>
        console.error("[email-worker] Failed to record final failure:", e),
      );
    }
  });

  // ── SMS ──────────────────────────────────────────────────────────────────
  const smsWorker = new Worker<SmsJobData>(
    "sms",
    async (job) => processSmsJob(job.data),
    { connection: redisConnection, concurrency: 5 },
  );
  smsWorker.on("failed", (job, err) => {
    console.error(`[sms-worker] Job ${job?.id} failed:`, err.message);
    if (job && isFinalAttempt(job, err)) {
      onSmsJobFinallyFailed(job.data).catch((e) =>
        console.error("[sms-worker] Failed to record final failure:", e),
      );
    }
  });

  // ── Automation (rental drip, algorithmic pricing) ────────────────────────
  const automationWorker = new Worker("automation", processAutomationQueueJob, {
    connection: redisConnection,
    concurrency: 5,
  });
  automationWorker.on("failed", (job, err) => {
    console.error(`[automation-worker] Job ${job?.id} failed:`, err.message);
  });

  // ── QBO sync (stub) ──────────────────────────────────────────────────────
  const qboSyncWorker = new Worker(
    "qbo-sync",
    async (job) => {
      // TODO: Implement OAuth token refresh + entity sync (invoice, payment,
      // customer, credit_memo). Intentionally a no-op stub in Phase 0.
      console.log("[qbo-sync] Stub: ignoring job", job.name, job.data?.type);
    },
    { connection: redisConnection, concurrency: 3 },
  );
  qboSyncWorker.on("failed", (job, err) => {
    console.error(`[qbo-sync] Job ${job?.id} failed:`, err.message);
  });

  // ── Billing (tenant lifecycle; recurring billing behind a flag) ──────────
  const billingWorker = new Worker("billing", processBillingQueueJob, {
    connection: redisConnection,
    concurrency: 1,
  });
  billingWorker.on("failed", (job, err) => {
    console.error(`[billing-worker] Job ${job?.id} failed:`, err.message);
  });

  // ── Renewals (auto-renew batches are DRAFT; execution needs APPROVED) ────
  const renewalWorker = startRenewalWorker();

  const workers: Worker[] = [
    emailWorker,
    smsWorker,
    automationWorker,
    qboSyncWorker,
    billingWorker,
    renewalWorker as unknown as Worker,
  ];

  console.log(`[helm-workers] Started ${workers.length} workers`);

  return {
    workers,
    async close() {
      await Promise.all(workers.map((w) => w.close()));
    },
  };
}
