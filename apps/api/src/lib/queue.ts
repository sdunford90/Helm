import { Queue } from "bullmq";
import IORedis from "ioredis";

// --------------------------------------------------------------------------
// Redis connection
// --------------------------------------------------------------------------

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

export const redisConnection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null, // Required by BullMQ
});

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

function createQueue(name: string): Queue {
  return new Queue(name, { connection: redisConnection });
}

export const queues: Record<QueueName, Queue> = {
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
export function getQueueRegistry(): Record<QueueName, Queue> {
  return queues;
}

/**
 * Gracefully drain all queues — waits for active jobs to finish then closes.
 * Call during deployment / shutdown.
 */
export async function drainAll(): Promise<void> {
  await Promise.all(
    Object.values(queues).map(async (q) => {
      await q.drain();
      await q.close();
    }),
  );
  await redisConnection.quit();
}
