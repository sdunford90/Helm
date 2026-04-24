import { Router, type Request, type Response } from "express";
import { prisma } from "../lib/prisma.js";
import { redisConnection } from "../lib/queue.js";

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/health
//
// Basic liveness — used by load balancers that only need to know the
// process is accepting requests. Always 200 unless the process is dying.
// ---------------------------------------------------------------------------

router.get("/", (_req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ---------------------------------------------------------------------------
// GET /api/health/ready
//
// Deep readiness — used by K8s/Fly/Render to gate traffic. Returns 503 if
// the DB is unreachable or Redis (when configured) is down. Responds within
// a bounded time budget per dependency so a slow dep doesn't cascade.
// ---------------------------------------------------------------------------

const PING_TIMEOUT_MS = 2000;

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms),
    ),
  ]);
}

router.get("/ready", async (_req: Request, res: Response) => {
  const checks: Record<string, { ok: boolean; error?: string; ms?: number }> = {};

  // --- Postgres ---
  {
    const start = Date.now();
    try {
      await withTimeout(prisma.$queryRaw`SELECT 1`, PING_TIMEOUT_MS, "db");
      checks.database = { ok: true, ms: Date.now() - start };
    } catch (err) {
      checks.database = {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        ms: Date.now() - start,
      };
    }
  }

  // --- Redis (optional — treat missing URL as skipped, not failed) ---
  if (process.env.REDIS_URL) {
    const start = Date.now();
    try {
      await withTimeout(redisConnection.ping(), PING_TIMEOUT_MS, "redis");
      checks.redis = { ok: true, ms: Date.now() - start };
    } catch (err) {
      checks.redis = {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        ms: Date.now() - start,
      };
    }
  } else {
    checks.redis = { ok: true, error: "not_configured" };
  }

  const allOk = Object.values(checks).every((c) => c.ok);
  res.status(allOk ? 200 : 503).json({
    status: allOk ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    checks,
  });
});

export default router;
