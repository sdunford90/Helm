import { Worker, type Job } from "bullmq";
import { redisConnection } from "../lib/queue.js";
import {
  syncCustomerToQbo,
  syncInvoiceToQbo,
  syncPaymentToQbo,
  syncChartOfAccounts,
} from "../lib/qbo.js";

// ---------------------------------------------------------------------------
// QBO Sync Worker
//
// BullMQ worker that processes the "qbo-sync" queue.
// Handles syncing customers, invoices, payments, and chart of accounts
// to QuickBooks Online.
// ---------------------------------------------------------------------------

interface SyncCustomerPayload {
  type: "sync-customer";
  tenantId: string;
  customerId: string;
}

interface SyncInvoicePayload {
  type: "sync-invoice";
  tenantId: string;
  invoiceId: string;
}

interface SyncPaymentPayload {
  type: "sync-payment";
  tenantId: string;
  paymentId: string;
}

interface SyncChartOfAccountsPayload {
  type: "sync-chart-of-accounts";
  tenantId: string;
}

type QboSyncJobPayload =
  | SyncCustomerPayload
  | SyncInvoicePayload
  | SyncPaymentPayload
  | SyncChartOfAccountsPayload;

async function processQboSyncJob(job: Job<QboSyncJobPayload>): Promise<unknown> {
  const { data } = job;

  switch (data.type) {
    case "sync-customer": {
      console.log(`[qbo-sync] Syncing customer ${data.customerId} for tenant ${data.tenantId}`);
      const qboId = await syncCustomerToQbo(data.tenantId, data.customerId);
      console.log(`[qbo-sync] Customer synced, QBO ID: ${qboId}`);
      return { qboCustomerId: qboId };
    }

    case "sync-invoice": {
      console.log(`[qbo-sync] Syncing invoice ${data.invoiceId} for tenant ${data.tenantId}`);
      const qboId = await syncInvoiceToQbo(data.tenantId, data.invoiceId);
      console.log(`[qbo-sync] Invoice synced, QBO ID: ${qboId}`);
      return { qboInvoiceId: qboId };
    }

    case "sync-payment": {
      console.log(`[qbo-sync] Syncing payment ${data.paymentId} for tenant ${data.tenantId}`);
      const qboId = await syncPaymentToQbo(data.tenantId, data.paymentId);
      console.log(`[qbo-sync] Payment synced, QBO ID: ${qboId}`);
      return { qboPaymentId: qboId };
    }

    case "sync-chart-of-accounts": {
      console.log(`[qbo-sync] Syncing chart of accounts for tenant ${data.tenantId}`);
      const count = await syncChartOfAccounts(data.tenantId);
      console.log(`[qbo-sync] Synced ${count} accounts for tenant ${data.tenantId}`);
      return { syncedAccounts: count };
    }

    default:
      throw new Error(`Unknown QBO sync job type: ${(data as { type: string }).type}`);
  }
}

const qboSyncWorker = new Worker("qbo-sync", processQboSyncJob, {
  connection: redisConnection,
  concurrency: 2,
});

qboSyncWorker.on("completed", (job) => {
  console.log(`[qbo-sync] Job ${job.id} completed`);
});

qboSyncWorker.on("failed", (job, err) => {
  console.error(`[qbo-sync] Job ${job?.id} failed:`, err.message);
});

export default qboSyncWorker;
