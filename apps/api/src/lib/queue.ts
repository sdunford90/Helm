import { Queue } from "bullmq";
import IORedis from "ioredis";

// --------------------------------------------------------------------------
// Redis connection
// --------------------------------------------------------------------------

function createRedisConnection(): IORedis {
  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl || redisUrl === "redis://localhost:6379") {
    // Local dev fallback
    return new IORedis("redis://localhost:6379", {
      maxRetriesPerRequest: null,
      lazyConnect: true,
    });
  }

  // Parse the URL to extract connection details — handles rediss:// (TLS)
  // correctly for Upstash and similar providers.
  const parsed = new URL(redisUrl);
  const isTls = parsed.protocol === "rediss:";

  return new IORedis({
    host: parsed.hostname,
    port: parsed.port ? parseInt(parsed.port, 10) : isTls ? 6380 : 6379,
    username: parsed.username || undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    tls: isTls ? {} : undefined,
    maxRetriesPerRequest: null, // Required by BullMQ
  });
}

export const redisConnection = createRedisConnection();

redisConnection.on("connect", () => {
  console.log("[redis] connected");
});
redisConnection.on("error", (err) => {
  // Log but don't crash — queues degrade gracefully when Redis is unavailable
  console.warn("[redis] connection error:", err.message);
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
