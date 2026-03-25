import { Worker, type Job } from "bullmq";
import { redisConnection } from "../lib/queue.js";
import { recognizeDeferred } from "../services/deferred-revenue.js";

// ---------------------------------------------------------------------------
// Deferred Revenue Worker
//
// BullMQ worker that processes the "deferred-revenue" queue.
// Supports:
//   1. recognize — Runs deferred revenue recognition for a tenant
// ---------------------------------------------------------------------------

interface RecognizePayload {
  type: "recognize";
  tenantId: string;
}

type DeferredRevenueJobPayload = RecognizePayload;

async function processDeferredRevenueJob(
  job: Job<DeferredRevenueJobPayload>,
): Promise<unknown> {
  const { data } = job;

  switch (data.type) {
    case "recognize": {
      console.log(
        `[deferred-revenue-worker] Recognizing deferred revenue for tenant ${data.tenantId}`,
      );
      const result = await recognizeDeferred(data.tenantId);
      console.log(
        `[deferred-revenue-worker] Recognized ${result.entriesProcessed} entries for tenant ${data.tenantId}`,
      );
      return result;
    }

    default:
      throw new Error(
        `Unknown deferred-revenue job type: ${(data as { type: string }).type}`,
      );
  }
}

const deferredRevenueWorker = new Worker(
  "deferred-revenue",
  processDeferredRevenueJob,
  {
    connection: redisConnection,
    concurrency: 2,
  },
);

deferredRevenueWorker.on("completed", (job) => {
  console.log(`[deferred-revenue-worker] Job ${job.id} completed`);
});

deferredRevenueWorker.on("failed", (job, err) => {
  console.error(
    `[deferred-revenue-worker] Job ${job?.id} failed:`,
    err.message,
  );
});

export default deferredRevenueWorker;
