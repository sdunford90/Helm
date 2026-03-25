import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { clerkAuth, requireRole } from "../middleware/auth.js";

const router = Router();

// --------------------------------------------------------------------------
// Zod schemas
// --------------------------------------------------------------------------

const createAccountSchema = z.object({
  accountNumber: z.string().min(1).max(20),
  name: z.string().min(1).max(255),
  type: z.enum(["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"]),
  subType: z.string().max(100).optional(),
  isDeferredRevenue: z.boolean().optional(),
});

const updateAccountSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  subType: z.string().max(100).optional(),
  isDeferredRevenue: z.boolean().optional(),
});

// --------------------------------------------------------------------------
// GET /api/gl-accounts — list all GL accounts for tenant
// --------------------------------------------------------------------------
router.get(
  "/",
  ...clerkAuth(),
  requireRole("MARINA_OWNER", "MARINA_MANAGER", "ACCOUNTING"),
  async (req, res, next) => {
    try {
      const accounts = await prisma.glAccount.findMany({
        where: { tenantId: req.tenantId! },
        orderBy: { accountNumber: "asc" },
        include: {
          _count: { select: { entries: true } },
        },
      });

      res.json({ accounts });
    } catch (err) {
      next(err);
    }
  },
);

// --------------------------------------------------------------------------
// GET /api/gl-accounts/:id — get single account with recent entries
// --------------------------------------------------------------------------
router.get(
  "/:id",
  ...clerkAuth(),
  requireRole("MARINA_OWNER", "MARINA_MANAGER", "ACCOUNTING"),
  async (req, res, next) => {
    try {
      const account = await prisma.glAccount.findFirst({
        where: { id: req.params.id, tenantId: req.tenantId! },
        include: {
          entries: {
            orderBy: { postedAt: "desc" },
            take: 50,
          },
        },
      });

      if (!account) {
        res.status(404).json({ error: "GL account not found" });
        return;
      }

      // Compute running balance
      const allEntries = await prisma.glEntry.findMany({
        where: { accountId: account.id, tenantId: req.tenantId! },
      });
      const balanceCents = allEntries.reduce(
        (sum, e) => sum + e.debitCents - e.creditCents,
        0,
      );

      res.json({ account, balanceCents });
    } catch (err) {
      next(err);
    }
  },
);

// --------------------------------------------------------------------------
// POST /api/gl-accounts — create a new GL account
// --------------------------------------------------------------------------
router.post(
  "/",
  ...clerkAuth(),
  requireRole("MARINA_OWNER", "MARINA_MANAGER", "ACCOUNTING"),
  async (req, res, next) => {
    try {
      const data = createAccountSchema.parse(req.body);

      // Check for duplicate account number
      const existing = await prisma.glAccount.findFirst({
        where: {
          tenantId: req.tenantId!,
          accountNumber: data.accountNumber,
        },
      });

      if (existing) {
        res.status(409).json({
          error: `Account number ${data.accountNumber} already exists`,
        });
        return;
      }

      const account = await prisma.glAccount.create({
        data: {
          tenantId: req.tenantId!,
          ...data,
        },
      });

      res.status(201).json({ account });
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
// PUT /api/gl-accounts/:id — update a GL account
// --------------------------------------------------------------------------
router.put(
  "/:id",
  ...clerkAuth(),
  requireRole("MARINA_OWNER", "MARINA_MANAGER", "ACCOUNTING"),
  async (req, res, next) => {
    try {
      const data = updateAccountSchema.parse(req.body);

      const account = await prisma.glAccount.findFirst({
        where: { id: req.params.id, tenantId: req.tenantId! },
      });

      if (!account) {
        res.status(404).json({ error: "GL account not found" });
        return;
      }

      const updated = await prisma.glAccount.update({
        where: { id: req.params.id },
        data,
      });

      res.json({ account: updated });
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
// DELETE /api/gl-accounts/:id — delete a GL account (only if no entries)
// --------------------------------------------------------------------------
router.delete(
  "/:id",
  ...clerkAuth(),
  requireRole("MARINA_OWNER"),
  async (req, res, next) => {
    try {
      const account = await prisma.glAccount.findFirst({
        where: { id: req.params.id, tenantId: req.tenantId! },
        include: { _count: { select: { entries: true } } },
      });

      if (!account) {
        res.status(404).json({ error: "GL account not found" });
        return;
      }

      if (account._count.entries > 0) {
        res.status(400).json({
          error: "Cannot delete account with existing entries",
          entryCount: account._count.entries,
        });
        return;
      }

      await prisma.glAccount.delete({ where: { id: req.params.id } });

      res.json({ deleted: true });
    } catch (err) {
      next(err);
    }
  },
);

// --------------------------------------------------------------------------
// GET /api/gl-accounts/:id/entries — paginated GL entries for an account
// --------------------------------------------------------------------------
router.get(
  "/:id/entries",
  ...clerkAuth(),
  requireRole("MARINA_OWNER", "MARINA_MANAGER", "ACCOUNTING"),
  async (req, res, next) => {
    try {
      const take = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const skip = parseInt(req.query.offset as string) || 0;

      const account = await prisma.glAccount.findFirst({
        where: { id: req.params.id, tenantId: req.tenantId! },
      });

      if (!account) {
        res.status(404).json({ error: "GL account not found" });
        return;
      }

      const [entries, total] = await Promise.all([
        prisma.glEntry.findMany({
          where: { accountId: req.params.id, tenantId: req.tenantId! },
          orderBy: { postedAt: "desc" },
          take,
          skip,
        }),
        prisma.glEntry.count({
          where: { accountId: req.params.id, tenantId: req.tenantId! },
        }),
      ]);

      res.json({ entries, total, limit: take, offset: skip });
    } catch (err) {
      next(err);
    }
  },
);

// --------------------------------------------------------------------------
// GET /api/gl-accounts/trial-balance — trial balance report
// --------------------------------------------------------------------------
router.get(
  "/reports/trial-balance",
  ...clerkAuth(),
  requireRole("MARINA_OWNER", "MARINA_MANAGER", "ACCOUNTING"),
  async (req, res, next) => {
    try {
      const accounts = await prisma.glAccount.findMany({
        where: { tenantId: req.tenantId! },
        orderBy: { accountNumber: "asc" },
        include: { entries: true },
      });

      const trialBalance = accounts.map((acct) => {
        const totalDebits = acct.entries.reduce(
          (s, e) => s + e.debitCents,
          0,
        );
        const totalCredits = acct.entries.reduce(
          (s, e) => s + e.creditCents,
          0,
        );
        return {
          id: acct.id,
          accountNumber: acct.accountNumber,
          name: acct.name,
          type: acct.type,
          totalDebitsCents: totalDebits,
          totalCreditsCents: totalCredits,
          balanceCents: totalDebits - totalCredits,
        };
      });

      const totalDebits = trialBalance.reduce(
        (s, a) => s + a.totalDebitsCents,
        0,
      );
      const totalCredits = trialBalance.reduce(
        (s, a) => s + a.totalCreditsCents,
        0,
      );

      res.json({
        accounts: trialBalance,
        totalDebitsCents: totalDebits,
        totalCreditsCents: totalCredits,
        balanced: totalDebits === totalCredits,
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
