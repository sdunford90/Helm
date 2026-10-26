import "dotenv/config";

import { startWorkers } from "./workers/index.js";
import { registerSchedulers } from "./workers/schedulers.js";
import { redisConnection } from "./lib/queue.js";
import { prisma } from "./lib/prisma.js";

// ---------------------------------------------------------------------------
// Worker process entrypoint
//
//   pnpm --filter @helm/api worker       (node dist/worker.js)
//   pnpm --filter @helm/api worker:dev   (tsx watch src/worker.ts)
//
// Starts the BullMQ workers and registers the recurring job schedulers.
// Only safe schedulers are registered by default; billing, auto-renew,
// tenant-lifecycle and algorithmic-pricing schedules each need an explicit
// ENABLE_*_SCHEDULER=true flag (see workers/schedulers.ts).
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const running = startWorkers();
  const { registered, removed } = await registerSchedulers();
  console.log(
    `[helm-workers] Schedulers: ${registered.length} registered, ${removed.length} disabled`,
  );

  let shuttingDown = false;
  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[helm-workers] ${signal} received, shutting down...`);
    try {
      await running.close();
      await prisma.$disconnect();
      await redisConnection.quit();
      console.log("[helm-workers] All workers stopped");
      process.exit(0);
    } catch (err) {
      console.error("[helm-workers] Error during shutdown:", err);
      process.exit(1);
    }
  }

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("[helm-workers] Failed to start:", err);
  process.exit(1);
});
