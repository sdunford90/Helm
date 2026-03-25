import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { clerkAuth } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";

const router = Router();

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

const ConciergeStatusEnum = z.enum([
  "SUBMITTED",
  "QUOTED",
  "APPROVED",
  "SCHEDULED",
  "IN_PROGRESS",
  "COMPLETED",
  "INVOICED",
]);

const CreateRequestSchema = z.object({
  customerId: z.string().uuid(),
  boatId: z.string().uuid().optional().nullable(),
  serviceType: z.string().min(1),
  preferredDate: z.string().datetime().optional().nullable(),
  notes: z.string().optional().nullable(),
  urgency: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
});

const UpdateRequestSchema = z.object({
  serviceType: z.string().min(1).optional(),
  preferredDate: z.string().datetime().optional().nullable(),
  notes: z.string().optional().nullable(),
  urgency: z.string().optional(),
  status: ConciergeStatusEnum.optional(),
  assignedTo: z.string().optional().nullable(),
  vendorId: z.string().uuid().optional().nullable(),
});

const SubmitQuoteSchema = z.object({
  quoteCents: z.number().int().positive(),
  vendorId: z.string().uuid().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const ListRequestsQuerySchema = z.object({
  status: ConciergeStatusEnum.optional(),
  serviceType: z.string().optional(),
  customerId: z.string().uuid().optional(),
  skip: z.coerce.number().int().min(0).default(0),
  take: z.coerce.number().int().positive().max(200).default(50),
});

const CreateVendorSchema = z.object({
  name: z.string().min(1),
  specialty: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const UpdateVendorSchema = z.object({
  name: z.string().min(1).optional(),
  specialty: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  notes: z.string().optional().nullable(),
  active: z.boolean().optional(),
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function appError(message: string, statusCode: number, code: string): Error {
  const err = new Error(message) as Error & {
    statusCode: number;
    code: string;
  };
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

// ─── Request Routes ─────────────────────────────────────────────────────────

// GET /api/concierge/requests — List requests with filters
router.get(
  "/requests",
  clerkAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = ListRequestsQuerySchema.parse(req.query);
      const where: Record<string, unknown> = {};

      if (query.status) where.status = query.status;
      if (query.serviceType) where.serviceType = query.serviceType;
      if (query.customerId) where.customerId = query.customerId;

      const [data, total] = await Promise.all([
        prisma.conciergeRequest.findMany({
          where,
          include: { customer: true, vendor: true },
          skip: query.skip,
          take: query.take,
          orderBy: { preferredDate: "asc" },
        }),
        prisma.conciergeRequest.count({ where }),
      ]);

      res.json({ data, total });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/concierge/requests/:id — Request detail
router.get(
  "/requests/:id",
  clerkAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const request = await prisma.conciergeRequest.findUnique({
        where: { id: req.params.id },
        include: { customer: true, vendor: true },
      });

      if (!request) throw appError("Request not found", 404, "NOT_FOUND");
      res.json({ data: request });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/concierge/requests — Create request
router.post(
  "/requests",
  clerkAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = CreateRequestSchema.parse(req.body);

      // Verify customer exists
      const customer = await prisma.customer.findUnique({
        where: { id: body.customerId },
      });
      if (!customer) throw appError("Customer not found", 404, "CUSTOMER_NOT_FOUND");

      const request = await prisma.conciergeRequest.create({
        data: {
          tenantId: (req as any).tenantId,
          customerId: body.customerId,
          boatId: body.boatId ?? null,
          serviceType: body.serviceType,
          preferredDate: body.preferredDate ? new Date(body.preferredDate) : null,
          notes: body.notes ?? null,
          urgency: body.urgency ?? "NORMAL",
          status: "SUBMITTED",
        },
        include: { customer: true },
      });

      res.status(201).json({ data: request });
    } catch (err) {
      next(err);
    }
  },
);

// PUT /api/concierge/requests/:id — Update request
router.put(
  "/requests/:id",
  clerkAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = UpdateRequestSchema.parse(req.body);

      const existing = await prisma.conciergeRequest.findUnique({
        where: { id: req.params.id },
      });
      if (!existing) throw appError("Request not found", 404, "NOT_FOUND");

      const data: Record<string, unknown> = {};
      if (body.serviceType !== undefined) data.serviceType = body.serviceType;
      if (body.preferredDate !== undefined) data.preferredDate = body.preferredDate ? new Date(body.preferredDate) : null;
      if (body.notes !== undefined) data.notes = body.notes;
      if (body.urgency !== undefined) data.urgency = body.urgency;
      if (body.status !== undefined) data.status = body.status;
      if (body.assignedTo !== undefined) data.assignedTo = body.assignedTo;
      if (body.vendorId !== undefined) data.vendorId = body.vendorId;

      const updated = await prisma.conciergeRequest.update({
        where: { id: req.params.id },
        data,
        include: { customer: true, vendor: true },
      });

      res.json({ data: updated });
    } catch (err) {
      next(err);
    }
  },
);

// PUT /api/concierge/requests/:id/quote — Submit quote
router.put(
  "/requests/:id/quote",
  clerkAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = SubmitQuoteSchema.parse(req.body);

      const existing = await prisma.conciergeRequest.findUnique({
        where: { id: req.params.id },
      });
      if (!existing) throw appError("Request not found", 404, "NOT_FOUND");

      const updated = await prisma.conciergeRequest.update({
        where: { id: req.params.id },
        data: {
          quoteCents: body.quoteCents,
          vendorId: body.vendorId ?? existing.vendorId,
          notes: body.notes ?? existing.notes,
          status: "QUOTED",
        },
        include: { customer: true, vendor: true },
      });

      res.json({ data: updated });
    } catch (err) {
      next(err);
    }
  },
);

// PUT /api/concierge/requests/:id/approve — Customer approves quote
router.put(
  "/requests/:id/approve",
  clerkAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const existing = await prisma.conciergeRequest.findUnique({
        where: { id: req.params.id },
      });
      if (!existing) throw appError("Request not found", 404, "NOT_FOUND");
      if (existing.status !== "QUOTED") {
        throw appError("Request must be in QUOTED status to approve", 400, "INVALID_STATUS");
      }

      const updated = await prisma.conciergeRequest.update({
        where: { id: req.params.id },
        data: {
          status: "APPROVED",
          approvedAt: new Date(),
        },
        include: { customer: true, vendor: true },
      });

      res.json({ data: updated });
    } catch (err) {
      next(err);
    }
  },
);

// PUT /api/concierge/requests/:id/complete — Mark completed, create billable charge
router.put(
  "/requests/:id/complete",
  clerkAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const existing = await prisma.conciergeRequest.findUnique({
        where: { id: req.params.id },
        include: { customer: true },
      });
      if (!existing) throw appError("Request not found", 404, "NOT_FOUND");
      if (!["APPROVED", "SCHEDULED", "IN_PROGRESS"].includes(existing.status)) {
        throw appError("Request must be approved or in progress to complete", 400, "INVALID_STATUS");
      }

      const updated = await prisma.conciergeRequest.update({
        where: { id: req.params.id },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
        },
        include: { customer: true, vendor: true },
      });

      // TODO: Create billable charge / invoice line item from quoteCents

      res.json({ data: updated });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Vendor Routes ──────────────────────────────────────────────────────────

// GET /api/concierge/vendors — List vendors
router.get(
  "/vendors",
  clerkAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const vendors = await prisma.conciergeVendor.findMany({
        orderBy: { name: "asc" },
      });
      res.json({ data: vendors });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/concierge/vendors — Create vendor
router.post(
  "/vendors",
  clerkAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = CreateVendorSchema.parse(req.body);

      const vendor = await prisma.conciergeVendor.create({
        data: {
          tenantId: (req as any).tenantId,
          name: body.name,
          specialty: body.specialty ?? null,
          phone: body.phone ?? null,
          email: body.email ?? null,
          notes: body.notes ?? null,
          active: true,
        },
      });

      res.status(201).json({ data: vendor });
    } catch (err) {
      next(err);
    }
  },
);

// PUT /api/concierge/vendors/:id — Update vendor
router.put(
  "/vendors/:id",
  clerkAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = UpdateVendorSchema.parse(req.body);

      const existing = await prisma.conciergeVendor.findUnique({
        where: { id: req.params.id },
      });
      if (!existing) throw appError("Vendor not found", 404, "NOT_FOUND");

      const data: Record<string, unknown> = {};
      if (body.name !== undefined) data.name = body.name;
      if (body.specialty !== undefined) data.specialty = body.specialty;
      if (body.phone !== undefined) data.phone = body.phone;
      if (body.email !== undefined) data.email = body.email;
      if (body.notes !== undefined) data.notes = body.notes;
      if (body.active !== undefined) data.active = body.active;

      const vendor = await prisma.conciergeVendor.update({
        where: { id: req.params.id },
        data,
      });

      res.json({ data: vendor });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
