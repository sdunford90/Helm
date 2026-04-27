import { Queue } from "bullmq";
import IORedis from "ioredis";

// --------------------------------------------------------------------------
// Silence ECONNRESET on any IORedis instance.
// Upstash closes idle connections server-side after ~30s; ioredis reconnects
// automatically. We attach this to every connection including BullMQ's
// internal duplicates so the logs stay clean.
// --------------------------------------------------------------------------
function suppressIdleResets(conn: IORedis): IORedis {
  conn.on("error", (err) => {
    if ((err as NodeJS.ErrnoException).code !== "ECONNRESET") {
      console.warn("[redis] error:", err.message);
    }
  });

  // Patch duplicate() so every BullMQ-internal clone also gets the suppressor.
  const originalDuplicate = conn.duplicate.bind(conn);
  conn.duplicate = (...args: Parameters<typeof conn.duplicate>) => {
    return suppressIdleResets(originalDuplicate(...args));
  };

  return conn;
}

// --------------------------------------------------------------------------
// Redis connection
// --------------------------------------------------------------------------

function createRedisConnection(): IORedis {
  const redisUrl = process.env.REDIS_URL;

  const isExternal =
    redisUrl &&
    redisUrl !== "redis://localhost:6379" &&
    !redisUrl.startsWith("redis://localhost");

  let conn: IORedis;

  if (!isExternal) {
    // Local dev fallback — lazy so missing Redis doesn't crash the server
    conn = new IORedis("redis://localhost:6379", {
      maxRetriesPerRequest: null,
      lazyConnect: true,
    });
  } else {
    // Parse the URL to extract connection details — handles rediss:// (TLS)
    // correctly for Upstash and similar providers.
    const parsed = new URL(redisUrl!);
    const isTls = parsed.protocol === "rediss:";

    conn = new IORedis({
      host: parsed.hostname,
      port: parsed.port ? parseInt(parsed.port, 10) : isTls ? 6380 : 6379,
      username: parsed.username || undefined,
      password: parsed.password
        ? decodeURIComponent(parsed.password)
        : undefined,
      tls: isTls ? {} : undefined,
      maxRetriesPerRequest: null, // Required by BullMQ
      connectTimeout: 10_000,
      retryStrategy: (times) => Math.min(times * 200, 5_000),
    });

    // Keep the primary connection alive with a periodic PING so Upstash's
    // idle timeout doesn't close it between job enqueues.
    setInterval(() => {
      conn.ping().catch(() => {});
    }, 20_000);
  }

  // Log once on first successful connection.
  let announced = false;
  conn.on("connect", () => {
    if (!announced) {
      console.log("[redis] connected to", isExternal ? "Upstash" : "localhost");
      announced = true;
    }
  });

  return suppressIdleResets(conn);
}

export const redisConnection = createRedisConnection();

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
  "report-scheduler",
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
  "report-scheduler": createQueue("report-scheduler"),
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
