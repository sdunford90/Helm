import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { clerkAuth, requireRole } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";

const MANAGER_ROLES = ["MARINA_OWNER", "MARINA_MANAGER", "TENANT_ADMIN", "PLATFORM_ADMIN"] as const;

const router: Router = Router();

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

const ProductCategoryEnum = z.enum([
  "WATERCRAFT",
  "STORAGE",
  "EQUIPMENT",
  "SLIP",
  "OTHER",
]);

const CreateProductSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  category: ProductCategoryEnum,
  basePriceCents: z.number().int().min(0).optional().nullable(),
  hourlyRateCents: z.number().int().min(0).optional().nullable(),
  dailyRateCents: z.number().int().min(0).optional().nullable(),
  weeklyRateCents: z.number().int().min(0).optional().nullable(),
  floorPriceCents: z.number().int().min(0).optional().nullable(),
  ceilingPriceCents: z.number().int().min(0).optional().nullable(),
  damageWaiverCents: z.number().int().min(0).optional().nullable(),
  totalQuantity: z.number().int().min(1).default(1),
  taxClass: z.string().optional().nullable(),
  isActive: z.boolean().optional().default(true),
});

const UpdateProductSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  category: ProductCategoryEnum.optional(),
  basePriceCents: z.number().int().min(0).optional().nullable(),
  hourlyRateCents: z.number().int().min(0).optional().nullable(),
  dailyRateCents: z.number().int().min(0).optional().nullable(),
  weeklyRateCents: z.number().int().min(0).optional().nullable(),
  floorPriceCents: z.number().int().min(0).optional().nullable(),
  ceilingPriceCents: z.number().int().min(0).optional().nullable(),
  damageWaiverCents: z.number().int().min(0).optional().nullable(),
  totalQuantity: z.number().int().min(1).optional(),
  taxClass: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
});

const PricingRuleTypeEnum = z.enum([
  "FLAT",
  "PER_FOOT",
  "TIERED",
  "SEASONAL",
  "DEMAND",
]);

const CreatePricingRuleSchema = z.object({
  name: z.string().min(1),
  type: PricingRuleTypeEnum,
  baseRateCents: z.number().int().min(0),
  perFootCents: z.number().int().min(0).optional().nullable(),
  tiersJson: z.array(z.record(z.unknown())).optional().nullable(),
  seasonStart: z.string().optional().nullable(),
  seasonEnd: z.string().optional().nullable(),
  seasonMultiplier: z.number().min(0).optional().nullable(),
  priority: z.number().int().min(0).default(0),
  isActive: z.boolean().optional().default(true),
});

const UpdatePricingRuleSchema = z.object({
  name: z.string().min(1).optional(),
  type: PricingRuleTypeEnum.optional(),
  baseRateCents: z.number().int().min(0).optional(),
  perFootCents: z.number().int().min(0).optional().nullable(),
  tiersJson: z.array(z.record(z.unknown())).optional().nullable(),
  seasonStart: z.string().optional().nullable(),
  seasonEnd: z.string().optional().nullable(),
  seasonMultiplier: z.number().min(0).optional().nullable(),
  priority: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

const CalendarOverrideSchema = z.object({
  overrideDate: z.string().min(1),
  priceCents: z.number().int().min(0),
  note: z.string().optional(),
});

const CalendarQuerySchema = z.object({
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().min(2020).max(2100).optional(),
});

const ReservationStatusEnum = z.enum([
  "PENDING",
  "CONFIRMED",
  "CHECKED_IN",
  "CHECKED_OUT",
  "CANCELLED",
  "NO_SHOW",
]);

const CreateReservationSchema = z.object({
  customerId: z.string().min(1),
  rentalProductId: z.string().min(1),
  unitId: z.string().optional().nullable(),
  timeSlotId: z.string().optional().nullable(),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  notes: z.string().optional().nullable(),
  cancellationPolicyId: z.string().optional().nullable(),
  depositCents: z.number().int().min(0).optional().default(0),
});

const CreateUnitSchema = z.object({
  name: z.string().min(1),
  serialNumber: z.string().optional().nullable(),
  status: z.enum(["AVAILABLE", "MAINTENANCE", "RETIRED"]).optional().default("AVAILABLE"),
  notes: z.string().optional().nullable(),
});

const UpdateUnitSchema = z.object({
  name: z.string().min(1).optional(),
  serialNumber: z.string().optional().nullable(),
  status: z.enum(["AVAILABLE", "MAINTENANCE", "RETIRED"]).optional(),
  notes: z.string().optional().nullable(),
});

const CreateTimeSlotSchema = z.object({
  name: z.string().min(1),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  locationId: z.string().optional().nullable(),
  sortOrder: z.number().int().min(0).optional().default(0),
  active: z.boolean().optional().default(true),
});

const UpdateTimeSlotSchema = z.object({
  name: z.string().min(1).optional(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  locationId: z.string().optional().nullable(),
  sortOrder: z.number().int().min(0).optional(),
  active: z.boolean().optional(),
});

const UpdateReservationSchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  notes: z.string().optional().nullable(),
  status: ReservationStatusEnum.optional(),
});

const ListReservationsQuerySchema = z.object({
  status: ReservationStatusEnum.optional(),
  rentalProductId: z.string().optional(),
  customerId: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  skip: z.coerce.number().int().min(0).default(0),
  take: z.coerce.number().int().positive().max(100).default(25),
  sortBy: z.enum(["createdAt", "startDt", "endDt", "totalCents"]).default("startDt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

const CheckOutSchema = z.object({
  overtimeMinutes: z.number().int().min(0).optional().default(0),
  damageChargeCents: z.number().int().min(0).optional().default(0),
  damageNotes: z.string().optional().nullable(),
});

const SuggestionActionSchema = z.object({
  action: z.enum(["ACCEPTED", "REJECTED"]),
});

const CreateCancellationPolicySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  rules: z.array(z.object({
    hoursBeforeStart: z.number().int().min(0),
    refundPct: z.number().int().min(0).max(100),
  })).min(1),
  isDefault: z.boolean().optional().default(false),
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

/**
 * Calculate dynamic price for a reservation based on pricing rules, demand
 * surge tiers, and calendar overrides. Uses the actual Prisma schema field names.
 */
async function calculateDynamicPrice(
  tenantId: string,
  productId: string,
  startDate: Date,
  endDate: Date,
): Promise<{ totalCents: number; baseRentalCents: number; damageWaiverCents: number; breakdown: Record<string, unknown> }> {
  // Fetch product with its pricing rules and demand surge tiers in one query
  const product = await prisma.rentalProduct.findFirst({
    where: { id: productId, tenantId },
    include: {
      pricingRules: { orderBy: { priority: "asc" } },
      demandSurgeTiers: { orderBy: { priority: "asc" } },
    },
  });
  if (!product) throw appError("Product not found", 404, "NOT_FOUND");

  const durationMs = endDate.getTime() - startDate.getTime();
  const durationHours = durationMs / (1000 * 60 * 60);
  const durationDays = durationHours / 24;

  // ── Base price ────────────────────────────────────────────
  let baseCents = 0;
  let rateType = "hourly";
  let rateUnits = 0;

  if (durationDays >= 7 && product.weeklyRateCents) {
    rateUnits = Math.ceil(durationDays / 7);
    baseCents = rateUnits * product.weeklyRateCents;
    rateType = "weekly";
  } else if (durationDays >= 1 && product.dailyRateCents) {
    rateUnits = Math.ceil(durationDays);
    baseCents = rateUnits * product.dailyRateCents;
    rateType = "daily";
  } else {
    rateUnits = Math.max(1, Math.ceil(durationHours));
    baseCents = rateUnits * (product.hourlyRateCents ?? product.basePriceCents);
    rateType = "hourly";
  }

  // ── Pricing rules (SEASONAL, PEAK_DAY, MULTI_DAY, LEAD_TIME) ─
  let ruleMultiplier = 1.0;
  let appliedRuleType: string | null = null;
  const startDow = startDate.getDay(); // 0=Sun
  const leadTimeDays = Math.max(0, (startDate.getTime() - Date.now()) / 86400000);

  for (const rule of product.pricingRules) {
    const rType = rule.ruleType;
    if (rType === "SEASONAL") {
      if (rule.startDate && rule.endDate &&
          startDate >= rule.startDate && startDate <= rule.endDate) {
        ruleMultiplier = rule.value;
        appliedRuleType = "Seasonal";
        break;
      }
    } else if (rType === "PEAK_DAY") {
      const peakDays: number[] = Array.isArray(rule.daysJson) ? rule.daysJson as number[] : [];
      if (peakDays.includes(startDow)) {
        ruleMultiplier = rule.value;
        appliedRuleType = "Peak day";
        break;
      }
    } else if (rType === "MULTI_DAY" && durationDays >= 2) {
      ruleMultiplier = rule.value;
      appliedRuleType = "Multi-day";
      break;
    } else if (rType === "LEAD_TIME") {
      // value = max lead-time days that qualifies for this rate
      if (leadTimeDays <= rule.value) {
        ruleMultiplier = rule.value < 1 ? rule.value : 0.9; // treat as 10% early-bird discount
        appliedRuleType = "Lead time";
        break;
      }
    }
  }

  // ── Calendar date overrides ───────────────────────────────
  // PricingCalendarOverride has overrideDate (single date) and priceCents
  let calendarOverrideCents: number | null = null;
  let calendarNote: string | null = null;

  const overrides = await (prisma as any).pricingCalendarOverride.findMany({
    where: {
      rentalProductId: productId,
      overrideDate: { gte: startDate, lte: endDate },
    },
  }) as Array<{ priceCents: number; note?: string | null }>;

  if (overrides.length > 0) {
    // Highest per-day price override wins
    const best = overrides.reduce((m, o) => o.priceCents > m.priceCents ? o : m, overrides[0]);
    calendarOverrideCents = best.priceCents;
    calendarNote = best.note ?? null;
  }

  // ── Demand surge tiers ────────────────────────────────────
  let surgeMultiplier = 1.0;
  let surgeThreshold: number | null = null;

  const activeReservations = await prisma.reservation.count({
    where: {
      tenantId,
      rentalProductId: productId,
      status: { in: ["CONFIRMED", "CHECKED_IN"] },
      startDt: { lte: endDate },
      endDt: { gte: startDate },
    },
  });

  // Products don't have totalQuantity in schema — default capacity to 1
  const capacity = 1;
  const utilizationPct = (activeReservations / capacity) * 100;

  for (const tier of product.demandSurgeTiers) {
    if (utilizationPct >= tier.availabilityThresholdPct) {
      surgeMultiplier = tier.multiplier;
      surgeThreshold = tier.availabilityThresholdPct;
      break;
    }
  }

  // ── Final price ───────────────────────────────────────────
  let totalCents: number;
  if (calendarOverrideCents !== null) {
    // Calendar override replaces base (per day)
    const days = Math.max(1, Math.ceil(durationDays));
    totalCents = Math.round(calendarOverrideCents * days * surgeMultiplier);
  } else {
    totalCents = Math.round(baseCents * ruleMultiplier * surgeMultiplier);
  }

  // Floor / ceiling
  if (product.floorPriceCents && totalCents < product.floorPriceCents) {
    totalCents = product.floorPriceCents;
  }
  if (product.ceilingPriceCents && totalCents > product.ceilingPriceCents) {
    totalCents = product.ceilingPriceCents;
  }

  const baseRentalCents = totalCents;
  const damageWaiverCents = product.damageWaiverCents ?? 0;
  const grandTotalCents = baseRentalCents + damageWaiverCents;

  return {
    totalCents: grandTotalCents,
    baseRentalCents,
    damageWaiverCents,
    breakdown: {
      baseCents,
      rateType,
      rateUnits,
      durationHours: Math.round(durationHours * 100) / 100,
      durationDays: Math.round(durationDays * 100) / 100,
      appliedRuleType,
      ruleMultiplier,
      calendarOverrideCents,
      calendarNote,
      surgeMultiplier,
      surgeThreshold,
      utilizationPct: Math.round(utilizationPct * 100) / 100,
      baseRentalCents,
      damageWaiverCents,
      totalCents: grandTotalCents,
    },
  };
}

// ─── Authenticated routes ───────────────────────────────────────────────────

router.use(...clerkAuth());

// ═══════════════════════════════════════════════════════════════════════════════
// PRODUCTS
// ═══════════════════════════════════════════════════════════════════════════════

// ─── GET /products — List rental products with availability ─────────────────

router.get(
  "/products",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;

      const [products, total] = await Promise.all([
        prisma.rentalProduct.findMany({
          where: { tenantId },
          orderBy: { name: "asc" },
        }),
        prisma.rentalProduct.count({ where: { tenantId } }),
      ]);

      // Calculate available quantity for each product
      const now = new Date();
      const productsWithAvailability = await Promise.all(
        products.map(async (product) => {
          const activeReservations = await prisma.reservation.count({
            where: {
              tenantId,
              rentalProductId: product.id,
              status: { in: ["CONFIRMED", "CHECKED_IN"] },
              startDt: { lte: now },
              endDt: { gte: now },
            },
          });
          return {
            ...product,
            availableQuantity: Math.max(0, (product as any).totalQuantity - activeReservations),
            utilizationPct:
              (product as any).totalQuantity > 0
                ? Math.round((activeReservations / (product as any).totalQuantity) * 10000) / 100
                : 0,
          };
        }),
      );

      res.json({ data: productsWithAvailability, pagination: { total } });
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /products — Create rental product ─────────────────────────────────

router.post(
  "/products",
  ...clerkAuth(), requireRole(...MANAGER_ROLES),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const data = CreateProductSchema.parse(req.body);

      const product = await prisma.rentalProduct.create({
        data: {
          tenantId,
          ...data,
        } as any,
      });

      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          userName: req.userRecord?.email,
          recordType: "RentalProduct",
          recordId: product.id,
          action: "CREATED",
        },
      });

      res.status(201).json(product);
    } catch (err) {
      next(err);
    }
  },
);

// ─── PUT /products/:id — Update rental product ─────────────────────────────

router.put(
  "/products/:id",
  ...clerkAuth(), requireRole(...MANAGER_ROLES),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const data = UpdateProductSchema.parse(req.body);

      const existing = await prisma.rentalProduct.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!existing) {
        throw appError("Product not found", 404, "NOT_FOUND");
      }

      const updated = await prisma.rentalProduct.update({
        where: { id: req.params.id },
        data,
      });

      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          userName: req.userRecord?.email,
          recordType: "RentalProduct",
          recordId: updated.id,
          action: "UPDATED",
        },
      });

      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /products/:id/pricing — Get pricing rules for a product ────────────

router.get(
  "/products/:id/pricing",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;

      const product = await prisma.rentalProduct.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!product) {
        throw appError("Product not found", 404, "NOT_FOUND");
      }

      const rules = await (prisma as any).pricingRule.findMany({
        where: { tenantId, rentalProductId: req.params.id },
        orderBy: { priority: "asc" },
      });

      res.json({ data: rules });
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /products/:id/pricing — Create pricing rule ──────────────────────

router.post(
  "/products/:id/pricing",
  ...clerkAuth(), requireRole(...MANAGER_ROLES),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const data = CreatePricingRuleSchema.parse(req.body);

      const product = await prisma.rentalProduct.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!product) {
        throw appError("Product not found", 404, "NOT_FOUND");
      }

      const rule = await (prisma as any).pricingRule.create({
        data: {
          tenantId,
          rentalProductId: req.params.id,
          ...data,
        },
      });

      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          userName: req.userRecord?.email,
          recordType: "PricingRule",
          recordId: rule.id,
          action: "CREATED",
        },
      });

      res.status(201).json(rule);
    } catch (err) {
      next(err);
    }
  },
);

// ─── PUT /pricing/:ruleId — Update pricing rule ────────────────────────────

router.put(
  "/pricing/:ruleId",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const data = UpdatePricingRuleSchema.parse(req.body);

      const existing = await (prisma as any).pricingRule.findFirst({
        where: { id: req.params.ruleId, tenantId },
      });
      if (!existing) {
        throw appError("Pricing rule not found", 404, "NOT_FOUND");
      }

      const updated = await (prisma as any).pricingRule.update({
        where: { id: req.params.ruleId },
        data,
      });

      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          userName: req.userRecord?.email,
          recordType: "PricingRule",
          recordId: updated.id,
          action: "UPDATED",
        },
      });

      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /products/:id/calendar-overrides — Set calendar override prices ──

router.post(
  "/products/:id/calendar-overrides",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const data = CalendarOverrideSchema.parse(req.body);

      const product = await prisma.rentalProduct.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!product) {
        throw appError("Product not found", 404, "NOT_FOUND");
      }

      const override = await (prisma as any).pricingCalendarOverride.create({
        data: {
          rentalProductId: req.params.id,
          overrideDate: new Date(data.overrideDate),
          priceCents: data.priceCents,
          note: data.note ?? null,
          createdBy: req.userId ?? null,
        },
      });

      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          userName: req.userRecord?.email,
          recordType: "PricingCalendarOverride",
          recordId: override.id,
          action: "CREATED",
        },
      });

      res.status(201).json(override);
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /products/:id/calendar — Get availability calendar with prices ────

router.get(
  "/products/:id/calendar",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const { month, year } = CalendarQuerySchema.parse(req.query);

      const now = new Date();
      const calMonth = month ?? now.getMonth() + 1;
      const calYear = year ?? now.getFullYear();

      const product = await prisma.rentalProduct.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!product) {
        throw appError("Product not found", 404, "NOT_FOUND");
      }

      const startOfMonth = new Date(calYear, calMonth - 1, 1);
      const endOfMonth = new Date(calYear, calMonth, 0, 23, 59, 59);

      // Get reservations for this month
      const reservations = await prisma.reservation.findMany({
        where: {
          tenantId,
          rentalProductId: req.params.id,
          status: { in: ["CONFIRMED", "CHECKED_IN", "PENDING"] },
          startDt: { lte: endOfMonth },
          endDt: { gte: startOfMonth },
        },
        include: {
          customer: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { startDt: "asc" },
      });

      // Get calendar overrides for this month
      const overrides = await (prisma as any).pricingCalendarOverride.findMany({
        where: {
          rentalProductId: req.params.id,
          overrideDate: { gte: startOfMonth, lte: endOfMonth },
        },
      });

      // Build calendar days
      const daysInMonth = endOfMonth.getDate();
      const days = [];

      for (let d = 1; d <= daysInMonth; d++) {
        const date = new Date(calYear, calMonth - 1, d);
        const dateStr = date.toISOString().slice(0, 10);

        // Count reservations overlapping this day
        const dayReservations = reservations.filter((r) => {
          const rStart = new Date((r as any).startDt).toISOString().slice(0, 10);
          const rEnd = new Date((r as any).endDt).toISOString().slice(0, 10);
          return dateStr >= rStart && dateStr <= rEnd;
        });

        const bookedCount = dayReservations.length;
        const available = Math.max(0, (product as any).totalQuantity - bookedCount);

        // Find applicable override
        const override = overrides.find((o: any) => {
          const oStart = new Date(o.startDate).toISOString().slice(0, 10);
          const oEnd = new Date(o.endDate).toISOString().slice(0, 10);
          return dateStr >= oStart && dateStr <= oEnd;
        });

        const basePrice = product.dailyRateCents ?? product.hourlyRateCents ?? 0;
        const effectivePrice = override
          ? Math.round(basePrice * override.multiplier)
          : basePrice;

        days.push({
          date: dateStr,
          available,
          totalQuantity: (product as any).totalQuantity,
          bookedCount,
          priceCents: effectivePrice,
          override: override ? { label: override.label, multiplier: override.multiplier } : null,
          reservations: dayReservations.map((r) => ({
            id: r.id,
            customerId: r.customerId,
            customerName: r.customer
              ? `${r.customer.firstName} ${r.customer.lastName}`
              : null,
            status: r.status,
            startDate: (r as any).startDt,
            endDate: (r as any).endDt,
          })),
        });
      }

      res.json({
        month: calMonth,
        year: calYear,
        product: { id: product.id, name: product.name, totalQuantity: (product as any).totalQuantity },
        days,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /pricing-rules — List all pricing rules for tenant ─────────────────
// PricingRule has no tenantId — filter via rentalProduct relation

router.get(
  "/pricing-rules",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;

      const [rules, total] = await Promise.all([
        prisma.pricingRule.findMany({
          where: { rentalProduct: { tenantId } },
          orderBy: { priority: "asc" },
          include: { rentalProduct: { select: { id: true, name: true } } },
        }),
        prisma.pricingRule.count({ where: { rentalProduct: { tenantId } } }),
      ]);

      res.json({ data: rules, pagination: { total } });
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /price-quote — Get dynamic price quote for given dates ─────────────

router.post(
  "/price-quote",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const { rentalProductId, startDate, endDate } = req.body as {
        rentalProductId: string;
        startDate: string;
        endDate: string;
      };

      if (!rentalProductId || !startDate || !endDate) {
        res.status(400).json({ error: "rentalProductId, startDate, endDate are required" });
        return;
      }

      const start = new Date(startDate);
      const end = new Date(endDate);

      if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
        res.status(400).json({ error: "Invalid date range" });
        return;
      }

      const pricing = await calculateDynamicPrice(tenantId, rentalProductId, start, end);
      res.json(pricing);
    } catch (err) {
      next(err);
    }
  },
);

// ═══════════════════════════════════════════════════════════════════════════════
// RENTAL UNITS
// ═══════════════════════════════════════════════════════════════════════════════

// ─── GET /products/:id/units — List units for a product ─────────────────────
router.get(
  "/products/:id/units",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const product = await prisma.rentalProduct.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!product) { res.status(404).json({ error: "Product not found" }); return; }

      const units = await (prisma as any).rentalUnit.findMany({
        where: { rentalProductId: req.params.id },
        orderBy: { name: "asc" },
      });
      res.json(units);
    } catch (err) { next(err); }
  },
);

// ─── POST /products/:id/units — Create unit ──────────────────────────────────
router.post(
  "/products/:id/units",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const data = CreateUnitSchema.parse(req.body);
      const product = await prisma.rentalProduct.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!product) { res.status(404).json({ error: "Product not found" }); return; }

      const unit = await (prisma as any).rentalUnit.create({
        data: { rentalProductId: req.params.id, ...data },
      });
      res.status(201).json(unit);
    } catch (err) { next(err); }
  },
);

// ─── PATCH /products/:id/units/:unitId — Update unit ────────────────────────
router.patch(
  "/products/:id/units/:unitId",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const data = UpdateUnitSchema.parse(req.body);
      const existing = await (prisma as any).rentalUnit.findFirst({
        where: { id: req.params.unitId, rentalProductId: req.params.id },
        include: { rentalProduct: { select: { tenantId: true } } },
      });
      if (!existing || existing.rentalProduct.tenantId !== tenantId) {
        res.status(404).json({ error: "Unit not found" }); return;
      }
      const unit = await (prisma as any).rentalUnit.update({
        where: { id: req.params.unitId },
        data,
      });
      res.json(unit);
    } catch (err) { next(err); }
  },
);

// ─── DELETE /products/:id/units/:unitId — Delete unit ───────────────────────
router.delete(
  "/products/:id/units/:unitId",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const existing = await (prisma as any).rentalUnit.findFirst({
        where: { id: req.params.unitId, rentalProductId: req.params.id },
        include: { rentalProduct: { select: { tenantId: true } } },
      });
      if (!existing || existing.rentalProduct.tenantId !== tenantId) {
        res.status(404).json({ error: "Unit not found" }); return;
      }
      await (prisma as any).rentalUnit.delete({ where: { id: req.params.unitId } });
      res.status(204).send();
    } catch (err) { next(err); }
  },
);

// ═══════════════════════════════════════════════════════════════════════════════
// TIME SLOTS
// ═══════════════════════════════════════════════════════════════════════════════

// ─── GET /time-slots — List time slots for tenant ────────────────────────────
router.get(
  "/time-slots",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const slots = await (prisma as any).rentalTimeSlot.findMany({
        where: { tenantId },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      });
      res.json(slots);
    } catch (err) { next(err); }
  },
);

// ─── POST /time-slots — Create time slot ─────────────────────────────────────
router.post(
  "/time-slots",
  ...clerkAuth(), requireRole(...MANAGER_ROLES),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const data = CreateTimeSlotSchema.parse(req.body);
      const slot = await (prisma as any).rentalTimeSlot.create({
        data: { tenantId, ...data },
      });
      res.status(201).json(slot);
    } catch (err) { next(err); }
  },
);

// ─── PATCH /time-slots/:id — Update time slot ────────────────────────────────
router.patch(
  "/time-slots/:id",
  ...clerkAuth(), requireRole(...MANAGER_ROLES),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const data = UpdateTimeSlotSchema.parse(req.body);
      const existing = await (prisma as any).rentalTimeSlot.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!existing) { res.status(404).json({ error: "Time slot not found" }); return; }
      const slot = await (prisma as any).rentalTimeSlot.update({
        where: { id: req.params.id },
        data,
      });
      res.json(slot);
    } catch (err) { next(err); }
  },
);

// ─── DELETE /time-slots/:id — Delete time slot ───────────────────────────────
router.delete(
  "/time-slots/:id",
  ...clerkAuth(), requireRole(...MANAGER_ROLES),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const existing = await (prisma as any).rentalTimeSlot.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!existing) { res.status(404).json({ error: "Time slot not found" }); return; }
      await (prisma as any).rentalTimeSlot.delete({ where: { id: req.params.id } });
      res.status(204).send();
    } catch (err) { next(err); }
  },
);

// ═══════════════════════════════════════════════════════════════════════════════
// RESERVATIONS
// ═══════════════════════════════════════════════════════════════════════════════

// ─── GET /reservations — List reservations ──────────────────────────────────

router.get(
  "/reservations",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const query = ListReservationsQuerySchema.parse(req.query);

      const where: Record<string, unknown> = { tenantId };

      if (query.status) where.status = query.status;
      if (query.rentalProductId) where.rentalProductId = query.rentalProductId;
      if (query.customerId) where.customerId = query.customerId;

      if (query.dateFrom || query.dateTo) {
        where.startDt = {};
        if (query.dateFrom) (where.startDt as Record<string, unknown>).gte = new Date(query.dateFrom);
        if (query.dateTo) (where.startDt as Record<string, unknown>).lte = new Date(query.dateTo);
      }

      const [reservations, total] = await Promise.all([
        prisma.reservation.findMany({
          where,
          orderBy: { [query.sortBy]: query.sortOrder },
          skip: query.skip,
          take: query.take,
          include: {
            customer: {
              select: { id: true, firstName: true, lastName: true, email: true, phone: true },
            },
            rentalProduct: {
              select: { id: true, name: true, category: true },
            },
            unit: { select: { id: true, name: true } },
            timeSlot: { select: { id: true, name: true, startTime: true, endTime: true } },
          },
        }),
        prisma.reservation.count({ where }),
      ]);

      res.json({
        data: reservations,
        pagination: { skip: query.skip, take: query.take, total },
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /reservations/:id — Single reservation detail ──────────────────────

router.get(
  "/reservations/:id",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;

      const reservation = await prisma.reservation.findFirst({
        where: { id: req.params.id, tenantId },
        include: {
          customer: {
            select: { id: true, firstName: true, lastName: true, email: true, phone: true },
          },
          rentalProduct: true,
        },
      });

      if (!reservation) {
        throw appError("Reservation not found", 404, "NOT_FOUND");
      }

      res.json(reservation);
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /reservations — Create reservation with dynamic pricing ───────────

router.post(
  "/reservations",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const data = CreateReservationSchema.parse(req.body);

      // Verify customer exists
      const customer = await prisma.customer.findFirst({
        where: { id: data.customerId, tenantId },
      });
      if (!customer) {
        throw appError("Customer not found", 404, "NOT_FOUND");
      }

      // Verify product exists and is active
      const product = await prisma.rentalProduct.findFirst({
        where: { id: data.rentalProductId, tenantId, active: true },
      });
      if (!product) {
        throw appError("Product not found or inactive", 404, "NOT_FOUND");
      }

      const startDate = new Date(data.startDate);
      const endDate = new Date(data.endDate);

      if (endDate <= startDate) {
        throw appError("End date must be after start date", 400, "INVALID_DATES");
      }

      // Check availability
      const overlapping = await prisma.reservation.count({
        where: {
          tenantId,
          rentalProductId: data.rentalProductId,
          status: { in: ["CONFIRMED", "CHECKED_IN", "PENDING"] },
          startDt: { lt: endDate },
          endDt: { gt: startDate },
        },
      });

      if (overlapping >= (product as any).totalQuantity) {
        throw appError("No availability for the requested dates", 409, "NO_AVAILABILITY");
      }

      // Calculate dynamic price
      const pricing = await calculateDynamicPrice(tenantId, data.rentalProductId, startDate, endDate);

      // Apply cancellation policy — use whichever was passed in (no schema-level default)
      const cancellationPolicyId = data.cancellationPolicyId ?? null;

      // If a time slot is provided, apply slot times to the dates
      let startDt = startDate;
      let endDt = endDate;
      if (data.timeSlotId) {
        const slot = await (prisma as any).rentalTimeSlot.findFirst({
          where: { id: data.timeSlotId, tenantId },
        });
        if (slot) {
          const [sh, sm] = slot.startTime.split(":").map(Number);
          const [eh, em] = slot.endTime.split(":").map(Number);
          startDt = new Date(startDate);
          startDt.setHours(sh, sm, 0, 0);
          endDt = new Date(startDate); // same date, different time
          endDt.setHours(eh, em, 0, 0);
          // If slot crosses midnight or is full-day spanning multiple dates keep endDate
          if (endDt <= startDt) endDt = endDate;
        }
      }

      const reservation = await prisma.reservation.create({
        data: {
          tenantId,
          customerId: data.customerId,
          rentalProductId: data.rentalProductId,
          unitId: data.unitId ?? null,
          timeSlotId: data.timeSlotId ?? null,
          startDt,
          endDt,
          status: "CONFIRMED",
          totalCents: pricing.totalCents,
          damageWaiverCents: pricing.damageWaiverCents,
          notes: data.notes ?? null,
        } as any,
        include: {
          customer: {
            select: { id: true, firstName: true, lastName: true },
          },
          rentalProduct: {
            select: { id: true, name: true, category: true },
          },
          unit: { select: { id: true, name: true } },
          timeSlot: { select: { id: true, name: true, startTime: true, endTime: true } },
        },
      });

      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          userName: req.userRecord?.email,
          recordType: "Reservation",
          recordId: reservation.id,
          action: "CREATED",
          changedFieldsJson: pricing.breakdown,
        },
      });

      res.status(201).json(reservation);
    } catch (err) {
      next(err);
    }
  },
);

// ─── PUT /reservations/:id — Update reservation ────────────────────────────

router.put(
  "/reservations/:id",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const data = UpdateReservationSchema.parse(req.body);

      const existing = await prisma.reservation.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!existing) {
        throw appError("Reservation not found", 404, "NOT_FOUND");
      }

      // Recalculate price if dates changed
      let updateData: Record<string, unknown> = { ...data };
      if (data.startDate || data.endDate) {
        const startDate = data.startDate ? new Date(data.startDate) : (existing as any).startDt;
        const endDate = data.endDate ? new Date(data.endDate) : (existing as any).endDt;

        if (endDate <= startDate) {
          throw appError("End date must be after start date", 400, "INVALID_DATES");
        }

        const pricing = await calculateDynamicPrice(
          tenantId,
          existing.rentalProductId!,
          startDate,
          endDate,
        );

        updateData = {
          ...updateData,
          startDate,
          endDate,
          totalCents: pricing.totalCents,
          pricingBreakdownJson: pricing.breakdown,
        };
      }

      const updated = await prisma.reservation.update({
        where: { id: req.params.id },
        data: updateData,
        include: {
          customer: {
            select: { id: true, firstName: true, lastName: true },
          },
          rentalProduct: {
            select: { id: true, name: true },
          },
        },
      });

      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          userName: req.userRecord?.email,
          recordType: "Reservation",
          recordId: updated.id,
          action: "UPDATED",
        },
      });

      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /reservations/:id/check-in — Mark checked in ─────────────────────

router.post(
  "/reservations/:id/check-in",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;

      const reservation = await prisma.reservation.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!reservation) {
        throw appError("Reservation not found", 404, "NOT_FOUND");
      }

      if (reservation.status !== "CONFIRMED") {
        throw appError(
          `Cannot check in a reservation with status ${reservation.status}`,
          400,
          "INVALID_STATUS",
        );
      }

      const updated = await prisma.reservation.update({
        where: { id: req.params.id },
        data: {
          status: "CHECKED_IN",
        } as any,
        include: {
          customer: {
            select: { id: true, firstName: true, lastName: true },
          },
          rentalProduct: {
            select: { id: true, name: true },
          },
        },
      });

      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          userName: req.userRecord?.email,
          recordType: "Reservation",
          recordId: updated.id,
          action: "CHECKED_IN",
        },
      });

      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /reservations/:id/check-out — Mark checked out, finalize charges ─

router.post(
  "/reservations/:id/check-out",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const data = CheckOutSchema.parse(req.body);

      const reservation = await prisma.reservation.findFirst({
        where: { id: req.params.id, tenantId },
        include: { rentalProduct: true },
      });
      if (!reservation) {
        throw appError("Reservation not found", 404, "NOT_FOUND");
      }

      if (reservation.status !== "CHECKED_IN") {
        throw appError(
          `Cannot check out a reservation with status ${reservation.status}`,
          400,
          "INVALID_STATUS",
        );
      }

      // Calculate overtime charges
      let overtimeChargeCents = 0;
      if (data.overtimeMinutes > 0 && reservation.rentalProduct?.hourlyRateCents) {
        const overtimeHours = data.overtimeMinutes / 60;
        overtimeChargeCents = Math.round(overtimeHours * reservation.rentalProduct.hourlyRateCents);
      }

      const finalTotalCents = reservation.totalCents + overtimeChargeCents + data.damageChargeCents;

      const updated = await prisma.reservation.update({
        where: { id: req.params.id },
        data: {
          status: "CHECKED_OUT",
          totalCents: finalTotalCents,
        } as any,
        include: {
          customer: {
            select: { id: true, firstName: true, lastName: true },
          },
          rentalProduct: {
            select: { id: true, name: true },
          },
        },
      });

      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          userName: req.userRecord?.email,
          recordType: "Reservation",
          recordId: updated.id,
          action: "CHECKED_OUT",
          changedFieldsJson: {
            overtimeMinutes: data.overtimeMinutes,
            overtimeChargeCents,
            damageChargeCents: data.damageChargeCents,
            finalTotalCents,
          },
        },
      });

      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /reservations/:id/cancel — Cancel with policy enforcement ────────

router.post(
  "/reservations/:id/cancel",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;

      const reservation = await prisma.reservation.findFirst({
        where: { id: req.params.id, tenantId },
        include: {},
      });
      if (!reservation) {
        throw appError("Reservation not found", 404, "NOT_FOUND");
      }

      if (reservation.status === "CANCELLED" || reservation.status === "CHECKED_OUT") {
        throw appError(
          `Cannot cancel a reservation with status ${reservation.status}`,
          400,
          "INVALID_STATUS",
        );
      }

      // Calculate refund based on cancellation policy
      let refundPct = 0;
      let refundCents = 0;

      const res0 = reservation as any;
      if (res0.cancellationPolicy) {
        const hoursUntilStart =
          (new Date(res0.startDt).getTime() - Date.now()) / (1000 * 60 * 60);

        const rules = (res0.cancellationPolicy.rulesJson as { hoursBeforeStart: number; refundPct: number }[]) || [];
        // Sort rules by hoursBeforeStart descending (most generous first)
        const sortedRules = [...rules].sort((a, b) => b.hoursBeforeStart - a.hoursBeforeStart);

        for (const rule of sortedRules) {
          if (hoursUntilStart >= rule.hoursBeforeStart) {
            refundPct = rule.refundPct;
            break;
          }
        }

        refundCents = Math.round(reservation.totalCents * (refundPct / 100));
      }

      const updated = await prisma.reservation.update({
        where: { id: req.params.id },
        data: {
          status: "CANCELLED",
          refundCents,
        } as any,
        include: {
          customer: {
            select: { id: true, firstName: true, lastName: true },
          },
          rentalProduct: {
            select: { id: true, name: true },
          },
        },
      });

      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          userName: req.userRecord?.email,
          recordType: "Reservation",
          recordId: updated.id,
          action: "CANCELLED",
          changedFieldsJson: { refundPct, refundCents },
        },
      });

      res.json({ ...updated, refundPct, refundCents });
    } catch (err) {
      next(err);
    }
  },
);

// ═══════════════════════════════════════════════════════════════════════════════
// DYNAMIC PRICING
// ═══════════════════════════════════════════════════════════════════════════════

// ─── GET /pricing/suggestions — Algorithmic pricing suggestions ─────────────

router.get(
  "/pricing/suggestions",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;

      const suggestions = await (prisma as any).algorithmicSuggestion.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        include: {
          pricingRule: { select: { id: true, name: true, type: true } },
        },
      });

      res.json({ data: suggestions });
    } catch (err) {
      next(err);
    }
  },
);

// ─── PUT /pricing/suggestions/:id — Accept/reject suggestion ────────────────

router.put(
  "/pricing/suggestions/:id",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const { action } = SuggestionActionSchema.parse(req.body);

      const suggestion = await (prisma as any).algorithmicSuggestion.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!suggestion) {
        throw appError("Suggestion not found", 404, "NOT_FOUND");
      }

      if (suggestion.status !== "PENDING") {
        throw appError(
          `Suggestion already ${suggestion.status.toLowerCase()}`,
          400,
          "ALREADY_PROCESSED",
        );
      }

      const s = suggestion as any;
      const mappedStatus = action === "ACCEPTED" ? "APPROVED" : "IGNORED";

      // If accepted, apply the suggested rate to the pricing rule
      if (action === "ACCEPTED" && s.pricingRuleId) {
        await (prisma as any).pricingRule.update({
          where: { id: s.pricingRuleId },
          data: { baseRateCents: s.suggestedPriceCents },
        });
      }

      const updated = await (prisma as any).algorithmicSuggestion.update({
        where: { id: req.params.id },
        data: {
          status: mappedStatus,
          reviewedBy: req.userId,
          reviewedAt: new Date(),
        },
      });

      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          userName: req.userRecord?.email,
          recordType: "AlgorithmicSuggestion",
          recordId: updated.id,
          action: action === "ACCEPTED" ? "SUGGESTION_ACCEPTED" : "SUGGESTION_REJECTED",
          changedFieldsJson: {
            suggestedPriceCents: s.suggestedPriceCents,
          },
        },
      });

      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

// ═══════════════════════════════════════════════════════════════════════════════
// CANCELLATION POLICIES
// ═══════════════════════════════════════════════════════════════════════════════

// ─── GET /cancellation-policies — List policies ─────────────────────────────

router.get(
  "/cancellation-policies",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;

      const policies = await (prisma as any).cancellationPolicy.findMany({
        where: { tenantId },
        orderBy: { name: "asc" },
      });

      res.json({ data: policies });
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /cancellation-policies — Create policy ───────────────────────────

router.post(
  "/cancellation-policies",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const data = CreateCancellationPolicySchema.parse(req.body);

      // If setting as default, unset current default
      if (data.isDefault) {
        await (prisma as any).cancellationPolicy.updateMany({
          where: { tenantId, isDefault: true },
          data: { isDefault: false },
        });
      }

      const policy = await (prisma as any).cancellationPolicy.create({
        data: {
          tenantId,
          name: data.name,
          description: data.description,
          rulesJson: data.rules,
          isDefault: data.isDefault,
        },
      });

      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          userName: req.userRecord?.email,
          recordType: "CancellationPolicy",
          recordId: policy.id,
          action: "CREATED",
        },
      });

      res.status(201).json(policy);
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /availability — 14-day slot grid for all products ───────────────────

router.get(
  "/availability",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const rawStart =
        (req.query.startDate as string) ||
        new Date().toISOString().slice(0, 10);
      const days = Math.min(
        parseInt((req.query.days as string) || "14", 10),
        30,
      );

      const startDate = new Date(`${rawStart}T00:00:00.000Z`);
      const endDate = new Date(startDate);
      endDate.setUTCDate(endDate.getUTCDate() + days);

      const products = await prisma.rentalProduct.findMany({
        where: { tenantId },
        select: { id: true, active: true },
      });

      const reservations = await prisma.reservation.findMany({
        where: {
          tenantId,
          status: { notIn: ["CANCELLED", "NO_SHOW"] as any[] },
          startDt: { lt: endDate },
          endDt: { gt: startDate },
        },
        select: {
          id: true,
          rentalProductId: true,
          startDt: true,
          endDt: true,
          customer: { select: { firstName: true } },
        },
      });

      type SlotStatus = "available" | "booked" | "maintenance" | "blocked";
      type SlotData = {
        status: SlotStatus;
        customerFirstName?: string;
        reservationId?: string;
      };
      type DayData = {
        morning: SlotData;
        afternoon: SlotData;
        evening: SlotData;
      };
      type TimeSlotKey = "morning" | "afternoon" | "evening";

      const SLOT_HOURS: Record<TimeSlotKey, [number, number]> = {
        morning: [8, 12],
        afternoon: [12, 16],
        evening: [16, 20],
      };

      const result: Record<string, Record<string, DayData>> = {};

      for (const product of products) {
        result[product.id] = {};
        for (let i = 0; i < days; i++) {
          const date = new Date(startDate);
          date.setUTCDate(date.getUTCDate() + i);
          const dateStr = date.toISOString().slice(0, 10);

          const defaultStatus: SlotStatus = product.active
            ? "available"
            : "maintenance";
          const dayData: DayData = {
            morning: { status: defaultStatus },
            afternoon: { status: defaultStatus },
            evening: { status: defaultStatus },
          };

          if (product.active) {
            const dayStart = new Date(`${dateStr}T00:00:00.000Z`);
            const dayEnd = new Date(`${dateStr}T23:59:59.999Z`);

            const dayRes = reservations.filter(
              (r) =>
                r.rentalProductId === product.id &&
                r.startDt < dayEnd &&
                r.endDt > dayStart,
            );

            for (const r of dayRes) {
              const resDayStart = r.startDt.toISOString().slice(0, 10);
              const resDayEnd = r.endDt.toISOString().slice(0, 10);
              const isFirstDay = resDayStart === dateStr;
              const isLastDay = resDayEnd === dateStr;

              const slotKeys: TimeSlotKey[] = [
                "morning",
                "afternoon",
                "evening",
              ];
              for (const slotKey of slotKeys) {
                const [slotStart, slotEnd] = SLOT_HOURS[slotKey];
                let overlaps = false;
                if (!isFirstDay && !isLastDay) {
                  overlaps = true;
                } else if (isFirstDay && isLastDay) {
                  const startH = r.startDt.getUTCHours();
                  const endH = r.endDt.getUTCHours();
                  overlaps = startH < slotEnd && endH > slotStart;
                } else if (isFirstDay) {
                  overlaps = r.startDt.getUTCHours() < slotEnd;
                } else {
                  overlaps = r.endDt.getUTCHours() > slotStart;
                }

                if (overlaps) {
                  dayData[slotKey] = {
                    status: "booked",
                    customerFirstName:
                      r.customer?.firstName ?? undefined,
                    reservationId: r.id,
                  };
                }
              }
            }
          }

          result[product.id][dateStr] = dayData;
        }
      }

      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
