import { Queue } from "bullmq";
import IORedis from "ioredis";

// --------------------------------------------------------------------------
// Redis connection — optional. Queues are disabled when Redis is unavailable.
// --------------------------------------------------------------------------

const REDIS_URL = process.env.REDIS_URL;

export const redisConnection: IORedis | null = REDIS_URL
  ? new IORedis(REDIS_URL, { maxRetriesPerRequest: null })
  : (() => {
      if (process.env.NODE_ENV !== "test") {
        console.warn("[helm-api] REDIS_URL not set — background queues are disabled");
      }
      return null;
    })();

// --------------------------------------------------------------------------
// Queue definitions
// --------------------------------------------------------------------------

const QUEUE_NAMES = [
  "billing",
  "deferred-revenue",
  "qbo-sync",
  "email",
  "sms",
  "renewals",
  "automation",
] as const;

export type QueueName = (typeof QUEUE_NAMES)[number];

function createQueue(name: string): Queue | null {
  if (!redisConnection) return null;
  return new Queue(name, { connection: redisConnection });
}

export const queues: Record<QueueName, Queue | null> = {
  billing: createQueue("billing"),
  "deferred-revenue": createQueue("deferred-revenue"),
  "qbo-sync": createQueue("qbo-sync"),
  email: createQueue("email"),
  sms: createQueue("sms"),
  renewals: createQueue("renewals"),
  automation: createQueue("automation"),
};

/**
 * Return the full registry of queues (useful for admin introspection).
 */
export function getQueueRegistry(): Record<QueueName, Queue | null> {
  return queues;
}

/**
 * Gracefully drain all queues — waits for active jobs to finish then closes.
 * Call during deployment / shutdown.
 */
export async function drainAll(): Promise<void> {
  if (!redisConnection) return;
  await Promise.all(
    Object.values(queues).map(async (q) => {
      if (!q) return;
      await q.drain();
      await q.close();
    }),
  );
  await redisConnection.quit();
}
