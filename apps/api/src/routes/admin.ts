import { Router } from "express";
import { randomUUID, createHmac } from "node:crypto";
import { requirePlatformAdmin } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { queues, type QueueName } from "../lib/queue.js";

const router = Router();

// All admin routes require platform_admin role
router.use(...requirePlatformAdmin());

// --------------------------------------------------------------------------
// POST /api/admin/queues/pause — pause every BullMQ queue
// --------------------------------------------------------------------------
router.post("/queues/pause", async (_req, res, next) => {
  try {
    await Promise.all(Object.values(queues).map((q) => q.pause()));
    res.json({ status: "paused", queues: Object.keys(queues) });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// POST /api/admin/queues/unpause — resume every BullMQ queue
// --------------------------------------------------------------------------
router.post("/queues/unpause", async (_req, res, next) => {
  try {
    await Promise.all(Object.values(queues).map((q) => q.resume()));
    res.json({ status: "resumed", queues: Object.keys(queues) });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------
// GET /api/admin/queues/status — per-queue job counts
// --------------------------------------------------------------------------
router.get("/queues/status", async (_req, res, next) => {
  try {
    const statuses: Record<string, unknown> = {};

    for (const [name, queue] of Object.entries(queues) as [QueueName, typeof queues[QueueName]][]) {
      const counts = await queue.getJobCounts(
        "active",
        "completed",
        "delayed",
        "failed",
        "paused",
        "waiting",
      );
      const isPaused = await queue.isPaused();
      statuses[name] = { isPaused, counts };
    }

    res.json({ queues: statuses });
  } catch (err) {
    next(err);
  }
});

export default router;
