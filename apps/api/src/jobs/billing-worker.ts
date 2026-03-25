import { Worker, type Job } from "bullmq";
import { redisConnection } from "../lib/queue.js";
import { generateRecurringInvoices } from "../services/billing.js";
import { recognizeDeferred } from "../services/deferred-revenue.js";

// ---------------------------------------------------------------------------
// Billing Worker
//
// BullMQ worker that processes the "billing" queue.
// Supports:
//   1. generate-invoices — Generates recurring invoices for a tenant
//   2. recognize-deferred — Runs deferred revenue recognition
// ---------------------------------------------------------------------------

interface GenerateInvoicesPayload {
  type: "generate-invoices";
  tenantId: string;
}

interface RecognizeDeferredPayload {
  type: "recognize-deferred";
  tenantId: string;
}

type BillingJobPayload = GenerateInvoicesPayload | RecognizeDeferredPayload;

async function processBillingJob(job: Job<BillingJobPayload>): Promise<unknown> {
  const { data } = job;

  switch (data.type) {
    case "generate-invoices": {
      console.log(`[billing-worker] Generating invoices for tenant ${data.tenantId}`);
      const results = await generateRecurringInvoices(data.tenantId);
      console.log(
        `[billing-worker] Generated ${results.length} invoices for tenant ${data.tenantId}`,
      );
      return { invoiceCount: results.length, results };
    }

    case "recognize-deferred": {
      console.log(`[billing-worker] Recognizing deferred revenue for tenant ${data.tenantId}`);
      const result = await recognizeDeferred(data.tenantId);
      console.log(
        `[billing-worker] Recognized ${result.entriesProcessed} deferred entries for tenant ${data.tenantId}`,
      );
      return result;
    }

    default:
      throw new Error(`Unknown billing job type: ${(data as { type: string }).type}`);
  }
}

const billingWorker = new Worker("billing", processBillingJob, {
  connection: redisConnection,
  concurrency: 2,
});

billingWorker.on("completed", (job) => {
  console.log(`[billing-worker] Job ${job.id} completed`);
});

billingWorker.on("failed", (job, err) => {
  console.error(`[billing-worker] Job ${job?.id} failed:`, err.message);
});

export default billingWorker;
