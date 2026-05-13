// Plan 67 — Tenant-facing API key management.
//
// Auth via Clerk (regular staff session). Returns keys scoped to the caller's
// tenant. The plaintext key is shown ONCE on issue — we only store the hash.

import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../lib/prisma.js";

const router: Router = Router();

const CreateSchema = z.object({
  scope: z.enum(["TENANT", "PORTFOLIO"]).default("TENANT"),
  note: z.string().max(200).optional(),
});

function hashKey(plain: string): string {
  return createHash("sha256").update(plain).digest("hex");
}

function shortFingerprint(plain: string): string {
  // Last 4 chars so the operator can recognize the key in the list. We never
  // store the plaintext.
  return plain.slice(-4);
}

// GET /api/settings/api-keys — list (never returns plaintext)
router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenantId!;
    const keys = await prisma.apiKey.findMany({
      where: { tenantId },
      orderBy: [{ revokedAt: "asc" }, { id: "desc" }],
    });
    res.json({
      keys: keys.map((k) => ({
        id: k.id,
        scope: k.scope,
        createdBy: k.createdBy,
        lastUsedAt: k.lastUsedAt,
        revokedAt: k.revokedAt,
        // A 4-char hint pulled from the hash, since we don't have plaintext.
        // Operators recognize by lastUsedAt + scope; the hint is a tiebreaker.
        hint: k.keyHash.slice(-6),
      })),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/settings/api-keys — issue a fresh key; returned plaintext is shown
// once on the client side.
router.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenantId!;
    const { scope } = CreateSchema.parse(req.body ?? {});
    const plain = `helm_pk_${randomBytes(24).toString("hex")}`;
    const row = await prisma.apiKey.create({
      data: {
        tenantId,
        keyHash: hashKey(plain),
        scope,
        createdBy: req.userId ?? null,
      },
    });
    res.status(201).json({
      id: row.id,
      scope: row.scope,
      plaintext: plain,
      fingerprint: shortFingerprint(plain),
      message: "Copy this key now — it will not be shown again.",
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/settings/api-keys/:id — revoke (soft; sets revokedAt).
router.delete("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenantId!;
    const row = await prisma.apiKey.findFirst({ where: { id: req.params.id, tenantId } });
    if (!row) {
      res.status(404).json({ error: "API key not found" });
      return;
    }
    if (row.revokedAt) {
      res.status(400).json({ error: "Already revoked" });
      return;
    }
    await prisma.apiKey.update({
      where: { id: row.id },
      data: { revokedAt: new Date() },
    });
    res.json({ id: row.id, revokedAt: new Date() });
  } catch (err) {
    next(err);
  }
});

export default router;
