import { Router } from "express";
import { z } from "zod";
import { randomBytes, createHash } from "crypto";
import { prisma } from "../lib/prisma.js";
import { clerkAuth, requireRole } from "../middleware/auth.js";

const router = Router();

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function generateApiKey(): string {
  return `helm_${randomBytes(32).toString("hex")}`;
}

// --------------------------------------------------------------------------
// Zod schemas
// --------------------------------------------------------------------------

const createKeySchema = z.object({
  scope: z.enum(["TENANT", "PORTFOLIO"]),
});

// --------------------------------------------------------------------------
// GET /api/api-keys — list all API keys for tenant
// --------------------------------------------------------------------------
router.get(
  "/",
  ...clerkAuth(),
  requireRole("MARINA_OWNER"),
  async (req, res, next) => {
    try {
      const keys = await prisma.apiKey.findMany({
        where: { tenantId: req.tenantId! },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          scope: true,
          createdBy: true,
          lastUsedAt: true,
          revokedAt: true,
          createdAt: true,
          keyHash: true,
        },
      });

      // Only show last 8 chars of hash as identifier
      const masked = keys.map((k) => ({
        ...k,
        keyHint: `****${k.keyHash.slice(-8)}`,
        keyHash: undefined,
      }));

      res.json({ keys: masked });
    } catch (err) {
      next(err);
    }
  },
);

// --------------------------------------------------------------------------
// POST /api/api-keys — create a new API key
// --------------------------------------------------------------------------
router.post(
  "/",
  ...clerkAuth(),
  requireRole("MARINA_OWNER"),
  async (req, res, next) => {
    try {
      const data = createKeySchema.parse(req.body);
      const rawKey = generateApiKey();
      const keyHash = hashKey(rawKey);

      const apiKey = await prisma.apiKey.create({
        data: {
          tenantId: req.tenantId!,
          keyHash,
          scope: data.scope,
          createdBy: req.userId ?? null,
        },
      });

      // Return the raw key only once — it cannot be retrieved again
      res.status(201).json({
        key: {
          id: apiKey.id,
          rawKey,
          scope: apiKey.scope,
          createdAt: apiKey.createdAt,
        },
        warning: "Store this key securely. It will not be shown again.",
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res
          .status(400)
          .json({ error: "Validation failed", details: err.errors });
        return;
      }
      next(err);
    }
  },
);

// --------------------------------------------------------------------------
// POST /api/api-keys/:id/revoke — revoke an API key
// --------------------------------------------------------------------------
router.post(
  "/:id/revoke",
  ...clerkAuth(),
  requireRole("MARINA_OWNER"),
  async (req, res, next) => {
    try {
      const key = await prisma.apiKey.findFirst({
        where: { id: req.params.id, tenantId: req.tenantId! },
      });

      if (!key) {
        res.status(404).json({ error: "API key not found" });
        return;
      }

      if (key.revokedAt) {
        res.status(400).json({ error: "Key is already revoked" });
        return;
      }

      await prisma.apiKey.update({
        where: { id: req.params.id },
        data: { revokedAt: new Date() },
      });

      res.json({ revoked: true });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
