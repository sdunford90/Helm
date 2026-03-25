import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { createHash } from "node:crypto";
import { prisma } from "../lib/prisma.js";

const router = Router();

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

const PaginationQuerySchema = z.object({
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  limit: z.coerce.number().int().positive().max(1000).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

// ─── API Key Authentication Middleware ───────────────────────────────────────

declare global {
  namespace Express {
    interface Request {
      apiKeyScope?: "TENANT" | "PORTFOLIO";
    }
  }
}

async function authenticateApiKey(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer helm_")) {
      res.status(401).json({
        error: "Missing or invalid API key",
        code: "INVALID_API_KEY",
      });
      return;
    }

    const token = authHeader.slice("Bearer ".length);
    const keyHash = createHash("sha256").update(token).digest("hex");

    const apiKey = await prisma.apiKey.findFirst({
      where: { keyHash },
    });

    if (!apiKey) {
      res.status(401).json({
        error: "Invalid API key",
        code: "INVALID_API_KEY",
      });
      return;
    }

    if (apiKey.revokedAt) {
      res.status(401).json({
        error: "API key has been revoked",
        code: "API_KEY_REVOKED",
      });
      return;
    }

    // Set tenant context from the API key
    req.tenantId = apiKey.tenantId;
    req.apiKeyScope = apiKey.scope as "TENANT" | "PORTFOLIO";

    // Update last_used_at (fire-and-forget)
    prisma.apiKey
      .update({
        where: { id: apiKey.id },
        data: { lastUsedAt: new Date() },
      })
      .catch(() => {
        // Swallow errors — non-critical
      });

    next();
  } catch (err) {
    next(err);
  }
}

router.use(authenticateApiKey);

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildDateFilter(startDate?: Date, endDate?: Date): Record<string, Date> | undefined {
  if (!startDate && !endDate) return undefined;
  const filter: Record<string, Date> = {};
  if (startDate) filter.gte = startDate;
  if (endDate) filter.lte = endDate;
  return filter;
}

function paginationMeta(offset: number, limit: number, total: number) {
  return {
    offset,
    limit,
    total,
    hasMore: offset + limit < total,
  };
}

// ─── GET /customers — All customers for tenant ──────────────────────────────

router.get(
  "/customers",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const { startDate, endDate, limit, offset } = PaginationQuerySchema.parse(req.query);

      const dateFilter = buildDateFilter(startDate, endDate);
      const where: Record<string, unknown> = { tenantId };
      if (dateFilter) where.createdAt = dateFilter;

      const [data, total] = await Promise.all([
        prisma.customer.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: offset,
          take: limit,
        }),
        prisma.customer.count({ where }),
      ]);

      res.json({ data, pagination: paginationMeta(offset, limit, total) });
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /invoices — All invoices with line items ───────────────────────────

router.get(
  "/invoices",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const { startDate, endDate, limit, offset } = PaginationQuerySchema.parse(req.query);

      const dateFilter = buildDateFilter(startDate, endDate);
      const where: Record<string, unknown> = { tenantId };
      if (dateFilter) where.issuedDate = dateFilter;

      const [data, total] = await Promise.all([
        prisma.invoice.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: offset,
          take: limit,
          include: {
            lineItems: true,
            customer: {
              select: { id: true, firstName: true, lastName: true, email: true },
            },
          },
        }),
        prisma.invoice.count({ where }),
      ]);

      res.json({ data, pagination: paginationMeta(offset, limit, total) });
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /payments — All payments ───────────────────────────────────────────

router.get(
  "/payments",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const { startDate, endDate, limit, offset } = PaginationQuerySchema.parse(req.query);

      const dateFilter = buildDateFilter(startDate, endDate);
      const where: Record<string, unknown> = { tenantId };
      if (dateFilter) where.postedDate = dateFilter;

      const [data, total] = await Promise.all([
        prisma.payment.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: offset,
          take: limit,
          include: {
            customer: {
              select: { id: true, firstName: true, lastName: true },
            },
            invoice: {
              select: { id: true, invoiceNumber: true },
            },
          },
        }),
        prisma.payment.count({ where }),
      ]);

      res.json({ data, pagination: paginationMeta(offset, limit, total) });
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /slips — Slip inventory with occupancy ─────────────────────────────

router.get(
  "/slips",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const { limit, offset } = PaginationQuerySchema.parse(req.query);

      const where = { tenantId };

      const [data, total] = await Promise.all([
        prisma.slip.findMany({
          where,
          orderBy: { slipNumber: "asc" },
          skip: offset,
          take: limit,
          include: {
            contracts: {
              where: { status: "ACTIVE" },
              select: {
                id: true,
                customerId: true,
                startDate: true,
                endDate: true,
                rateCents: true,
              },
            },
          },
        }),
        prisma.slip.count({ where }),
      ]);

      res.json({ data, pagination: paginationMeta(offset, limit, total) });
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /contracts — Active contracts ──────────────────────────────────────

router.get(
  "/contracts",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const { startDate, endDate, limit, offset } = PaginationQuerySchema.parse(req.query);

      const dateFilter = buildDateFilter(startDate, endDate);
      const where: Record<string, unknown> = {
        tenantId,
        status: { in: ["ACTIVE", "EXPIRING"] },
      };
      if (dateFilter) where.startDate = dateFilter;

      const [data, total] = await Promise.all([
        prisma.slipContract.findMany({
          where,
          orderBy: { startDate: "desc" },
          skip: offset,
          take: limit,
          include: {
            slip: { select: { id: true, slipNumber: true } },
            customer: {
              select: { id: true, firstName: true, lastName: true },
            },
            boat: { select: { id: true, name: true, lengthFt: true } },
          },
        }),
        prisma.slipContract.count({ where }),
      ]);

      res.json({ data, pagination: paginationMeta(offset, limit, total) });
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /reservations — Rental reservations ────────────────────────────────

router.get(
  "/reservations",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const { startDate, endDate, limit, offset } = PaginationQuerySchema.parse(req.query);

      const dateFilter = buildDateFilter(startDate, endDate);
      const where: Record<string, unknown> = { tenantId };
      if (dateFilter) where.startDt = dateFilter;

      const [data, total] = await Promise.all([
        prisma.reservation.findMany({
          where,
          orderBy: { startDt: "desc" },
          skip: offset,
          take: limit,
          include: {
            customer: {
              select: { id: true, firstName: true, lastName: true },
            },
            rentalProduct: {
              select: { id: true, name: true, category: true },
            },
          },
        }),
        prisma.reservation.count({ where }),
      ]);

      res.json({ data, pagination: paginationMeta(offset, limit, total) });
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /transactions — POS transactions ───────────────────────────────────

router.get(
  "/transactions",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const { startDate, endDate, limit, offset } = PaginationQuerySchema.parse(req.query);

      const dateFilter = buildDateFilter(startDate, endDate);
      const where: Record<string, unknown> = { tenantId };
      if (dateFilter) where.createdAt = dateFilter;

      const [data, total] = await Promise.all([
        prisma.posTransaction.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: offset,
          take: limit,
          include: {
            lineItems: {
              include: { product: true },
            },
          },
        }),
        prisma.posTransaction.count({ where }),
      ]);

      res.json({ data, pagination: paginationMeta(offset, limit, total) });
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /gl-entries — GL entries ───────────────────────────────────────────

router.get(
  "/gl-entries",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const { startDate, endDate, limit, offset } = PaginationQuerySchema.parse(req.query);

      const dateFilter = buildDateFilter(startDate, endDate);
      const where: Record<string, unknown> = { tenantId };
      if (dateFilter) where.postedAt = dateFilter;

      const [data, total] = await Promise.all([
        prisma.glEntry.findMany({
          where,
          orderBy: { postedAt: "desc" },
          skip: offset,
          take: limit,
          include: {
            account: {
              select: { id: true, accountNumber: true, name: true, type: true },
            },
          },
        }),
        prisma.glEntry.count({ where }),
      ]);

      res.json({ data, pagination: paginationMeta(offset, limit, total) });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
