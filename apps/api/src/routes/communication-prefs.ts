import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { clerkAuth } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";

const router: Router = Router();

// ─── Constants ────────────────────────────────────────────────────────────────

const CHANNELS = ["email", "sms"] as const;
const CATEGORIES = ["billing", "inspections", "marketing", "announcements"] as const;

// Default preferences: all opted-in except marketing
const DEFAULT_PREFS: Array<{ channel: string; category: string; optedIn: boolean }> = [];
for (const channel of CHANNELS) {
  for (const category of CATEGORIES) {
    DEFAULT_PREFS.push({
      channel,
      category,
      optedIn: category !== "marketing", // marketing defaults to opted-out
    });
  }
}

// ─── Zod Schemas ──────────────────────────────────────────────────────────────

const UpdatePrefSchema = z.object({
  channel: z.enum(CHANNELS),
  category: z.enum(CATEGORIES),
  optedIn: z.boolean(),
});

const UpdatePrefsBodySchema = z.array(UpdatePrefSchema);

const CheckQuerySchema = z.object({
  channel: z.enum(CHANNELS),
  category: z.enum(CATEGORIES),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function ensureDefaultPrefs(tenantId: string, customerId: string) {
  const existing = await prisma.communicationPreference.findMany({
    where: { customerId },
  });

  if (existing.length > 0) return existing;

  // Create default preferences
  const created = await prisma.$transaction(
    DEFAULT_PREFS.map((pref) =>
      prisma.communicationPreference.create({
        data: {
          tenantId,
          customerId,
          channel: pref.channel,
          category: pref.category,
          optedIn: pref.optedIn,
        },
      }),
    ),
  );

  return created;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /communication-prefs/:customerId
// Returns all preferences for a customer, creating defaults if none exist.
router.get(
  "/:customerId",
  clerkAuth(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.tenantId!;
      const { customerId } = req.params;

      // Verify customer belongs to this tenant
      const customer = await prisma.customer.findFirst({
        where: { id: customerId, tenantId },
        select: { id: true },
      });

      if (!customer) {
        return res.status(404).json({ error: "Customer not found" });
      }

      const prefs = await ensureDefaultPrefs(tenantId, customerId);
      return res.json(prefs);
    } catch (err) {
      next(err);
    }
  },
);

// PUT /communication-prefs/:customerId
// Update preferences. Body: array of { channel, category, optedIn }
router.put(
  "/:customerId",
  clerkAuth(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.tenantId!;
      const { customerId } = req.params;

      const parsed = UpdatePrefsBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
      }

      // Verify customer belongs to this tenant
      const customer = await prisma.customer.findFirst({
        where: { id: customerId, tenantId },
        select: { id: true },
      });

      if (!customer) {
        return res.status(404).json({ error: "Customer not found" });
      }

      // Ensure defaults exist first
      await ensureDefaultPrefs(tenantId, customerId);

      // Upsert each preference
      const updates = await prisma.$transaction(
        parsed.data.map((pref) =>
          prisma.communicationPreference.upsert({
            where: {
              customerId_channel_category: {
                customerId,
                channel: pref.channel,
                category: pref.category,
              },
            },
            update: { optedIn: pref.optedIn },
            create: {
              tenantId,
              customerId,
              channel: pref.channel,
              category: pref.category,
              optedIn: pref.optedIn,
            },
          }),
        ),
      );

      return res.json(updates);
    } catch (err) {
      next(err);
    }
  },
);

// GET /communication-prefs/:customerId/check?channel=email&category=billing
// Check if a customer is opted in for a specific channel+category.
router.get(
  "/:customerId/check",
  clerkAuth(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.tenantId!;
      const { customerId } = req.params;

      const parsed = CheckQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "Invalid query params — channel and category are required" });
      }

      // Verify customer belongs to this tenant
      const customer = await prisma.customer.findFirst({
        where: { id: customerId, tenantId },
        select: { id: true },
      });

      if (!customer) {
        return res.status(404).json({ error: "Customer not found" });
      }

      // Ensure defaults exist
      await ensureDefaultPrefs(tenantId, customerId);

      const pref = await prisma.communicationPreference.findUnique({
        where: {
          customerId_channel_category: {
            customerId,
            channel: parsed.data.channel,
            category: parsed.data.category,
          },
        },
      });

      return res.json({
        channel: parsed.data.channel,
        category: parsed.data.category,
        optedIn: pref?.optedIn ?? true,
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
