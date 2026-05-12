import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import { clerkAuth } from "../middleware/auth.js";
import {
  locationContext,
  scopedWhere,
} from "../middleware/location-context.js";
import { prisma } from "../lib/prisma.js";
import { sendEmail } from "../lib/email.js";
import {
  formatDateOnlyISO,
  parseDateOnly,
  todayDateOnly,
} from "@helm/shared-types";
import {
  postSecurityDeposit,
  releaseSecurityDeposit,
} from "../services/gl-posting.js";
import { isLocationQboConnected } from "../services/gl-account-resolver.js";

const router: Router = Router();

// Calendar-only fields surfaced on the wire as `YYYY-MM-DD` instead of
// the ISO timestamp Date.toJSON() would emit.
const CONTRACT_DATE_FIELDS = [
  "startDate",
  "endDate",
  "signedAt",
  "terminationDate",
] as const;

function serializeContract<T extends Record<string, unknown>>(c: T): T {
  const out: Record<string, unknown> = { ...c };
  for (const f of CONTRACT_DATE_FIELDS) {
    if (f in c) {
      const v = c[f];
      out[f] =
        v == null
          ? null
          : formatDateOnlyISO(v as Date | string);
    }
  }
  return out as T;
}

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

const ContractStatusEnum = z.enum([
  "DRAFT",
  "ACTIVE",
  "EXPIRING",
  "EXPIRED",
  "TERMINATED",
  "RENEWED",
]);

const BillingCycleEnum = z.enum([
  "MONTHLY",
  "QUARTERLY",
  "SEMI_ANNUAL",
  "ANNUAL",
]);

const TerminationTypeEnum = z.enum(["FIXED", "FORMULA"]);

// Calendar-date input. Normalizes via parseDateOnly so a body like
// "2026-05-01T23:30:00-07:00" persists as May 1 — not May 2 after
// timezone conversion + DATE truncation.
const dateOnlySchema = z
  .union([z.string(), z.date()])
  .transform((v, ctx) => {
    try {
      return parseDateOnly(v);
    } catch (e) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: e instanceof Error ? e.message : "Invalid date",
      });
      return z.NEVER;
    }
  });

const CreateContractSchema = z.object({
  slipId: z.string().uuid(),
  customerId: z.string().uuid(),
  boatId: z.string().uuid().optional().nullable(),
  startDate: dateOnlySchema,
  endDate: dateOnlySchema.optional().nullable(),
  billingCycle: BillingCycleEnum.optional(),
  billingAnchor: z.number().int().min(1).max(28).optional().nullable(),
  // Optional when a dockageRateId is supplied (defaulted from plan).
  // The refine() below enforces that one of the two is present.
  rateCents: z.number().int().positive().optional(),
  electricityMode: z.enum(["FLAT_FEE", "METERED"]).optional().nullable(),
  autoRenew: z.boolean().optional(),
  status: ContractStatusEnum.optional(),
  securityDepositCents: z.number().int().min(0).optional().nullable(),
  earlyTerminationType: TerminationTypeEnum.optional().nullable(),
  earlyTerminationValue: z.number().optional().nullable(),
  qboItemId: z.string().optional().nullable(),
  // Optional rate-plan FK. Server validates tenant + location +
  // slipType and defaults rate / electricityMode from the plan.
  dockageRateId: z.string().uuid().optional().nullable(),
}).refine((d) => d.rateCents != null || d.dockageRateId != null, {
  message: "Either rateCents or dockageRateId must be provided",
  path: ["rateCents"],
});

const UpdateContractSchema = z.object({
  boatId: z.string().uuid().optional().nullable(),
  endDate: dateOnlySchema.optional().nullable(),
  billingCycle: BillingCycleEnum.optional(),
  billingAnchor: z.number().int().min(1).max(28).optional().nullable(),
  rateCents: z.number().int().positive().optional(),
  electricityMode: z.enum(["FLAT_FEE", "METERED"]).optional().nullable(),
  autoRenew: z.boolean().optional(),
  status: ContractStatusEnum.optional(),
  securityDepositCents: z.number().int().min(0).optional().nullable(),
  earlyTerminationType: TerminationTypeEnum.optional().nullable(),
  earlyTerminationValue: z.number().optional().nullable(),
  qboItemId: z.string().optional().nullable(),
  // allow re-linking (or clearing) the rate plan via PUT.
  dockageRateId: z.string().uuid().optional().nullable(),
});

const ListContractsQuerySchema = z.object({
  status: ContractStatusEnum.optional(),
  customerId: z.string().uuid().optional(),
  slipId: z.string().uuid().optional(),
  billingCycle: BillingCycleEnum.optional(),
  expiryFrom: dateOnlySchema.optional(),
  expiryTo: dateOnlySchema.optional(),
  skip: z.coerce.number().int().min(0).default(0),
  take: z.coerce.number().int().positive().max(100).default(25),
  sortBy: z
    .enum(["startDate", "endDate", "rateCents", "createdAt"])
    .default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

const DepositInstructionSchema = z.discriminatedUnion("action", [
  z.object({
    depositId: z.string().uuid(),
    action: z.literal("REFUND"),
  }),
  z.object({
    depositId: z.string().uuid(),
    action: z.literal("APPLY_TO_INVOICE"),
    invoiceId: z.string().uuid(),
  }),
]);

const TerminateContractSchema = z.object({
  reason: z.string().optional(),
  terminationDate: dateOnlySchema.optional(),
  penaltyOverrideCents: z.number().int().min(0).optional(),
  glAccountId: z.string().uuid().optional(),
  depositInstructions: z.array(DepositInstructionSchema).optional(),
});

const RenewContractSchema = z.object({
  newEndDate: dateOnlySchema,
  newRateCents: z.number().int().positive().optional(),
  billingCycle: BillingCycleEnum.optional(),
});

const SendForSignatureSchema = z.object({
  signerName: z.string().min(1),
  signerEmail: z.string().email(),
  message: z.string().optional(),
});

const BulkSendForSignatureSchema = z.object({
  contractIds: z.array(z.string().uuid()).min(1).max(50),
  message: z.string().optional(),
});

const EsignWebhookSchema = z.object({
  event: z.enum(["signature_request_signed", "signature_request_declined", "signature_request_viewed"]),
  requestId: z.string(),
  contractId: z.string(),
  signedDocumentUrl: z.string().url().optional(),
  signerEmail: z.string().email().optional(),
  timestamp: z.coerce.date().optional(),
});

const ExpiringQuerySchema = z.object({
  days: z.coerce.number().int().positive().default(30),
  skip: z.coerce.number().int().min(0).default(0),
  take: z.coerce.number().int().positive().max(100).default(25),
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

/** Calculate proration amount for mid-month starts. */
function calculateProration(
  rateCents: number,
  startDate: Date,
  billingCycle: string,
): { proratedCents: number; proratedDays: number; totalDays: number } {
  // startDate arrives as a UTC-midnight Date from the DATE column; use
  // UTC getters so a non-UTC server timezone can't shift the day.
  const dayOfMonth = startDate.getUTCDate();

  // If starting on the 1st, no proration needed
  if (dayOfMonth === 1) {
    return { proratedCents: rateCents, proratedDays: 0, totalDays: 0 };
  }

  // Get the number of days in the start month
  const year = startDate.getUTCFullYear();
  const month = startDate.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const remainingDays = daysInMonth - dayOfMonth + 1;

  let cycleDays = daysInMonth;
  if (billingCycle === "QUARTERLY") cycleDays = 90;
  else if (billingCycle === "SEMI_ANNUAL") cycleDays = 182;
  else if (billingCycle === "ANNUAL") cycleDays = 365;

  const dailyRate = rateCents / cycleDays;
  const proratedCents = Math.round(dailyRate * remainingDays);

  return {
    proratedCents,
    proratedDays: remainingDays,
    totalDays: cycleDays,
  };
}

// ─── Public esign routes (no auth — requestId is the token) ─────────────────

const EsignSubmitSchema = z.object({
  // vessel
  hin: z.string().optional().nullable(),
  registrationNumber: z.string().optional().nullable(),
  registrationState: z.string().optional().nullable(),
  registrationExpiry: z.coerce.date().optional().nullable(),
  make: z.string().optional().nullable(),
  model: z.string().optional().nullable(),
  year: z.number().int().optional().nullable(),
  // insurance
  insurer: z.string().optional().nullable(),
  policyNumber: z.string().optional().nullable(),
  insStartDate: z.coerce.date().optional().nullable(),
  insExpiryDate: z.coerce.date().optional().nullable(),
  // emergency contact
  ecName: z.string().optional().nullable(),
  ecPhone: z.string().optional().nullable(),
  ecRelationship: z.string().optional().nullable(),
  // signature
  signerName: z.string().min(1),
  agreed: z.literal(true),
});

// GET /api/esign/:requestId — look up contract by requestId (public)
router.get(
  "/public/esign/:requestId",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const contract = await prisma.slipContract.findFirst({
        where: { esignEnvelopeId: req.params.requestId },
        include: {
          slip: { select: { id: true, slipNumber: true, dockId: true } },
          customer: {
            select: {
              id: true, firstName: true, lastName: true, email: true,
              emergencyContactJson: true,
            },
          },
          boat: true,
        },
      });

      if (!contract) {
        res.status(404).json({ error: "Signing link not found or expired", code: "NOT_FOUND" });
        return;
      }
      if (contract.signedAt) {
        res.status(410).json({ error: "This contract has already been signed", code: "ALREADY_SIGNED" });
        return;
      }

      // Fetch latest insurance for the boat
      const latestInsurance = contract.boatId
        ? await prisma.insuranceRecord.findFirst({
            where: { boatId: contract.boatId },
            orderBy: { expiryDate: "desc" },
            select: { insurer: true, policyNumber: true, startDate: true, expiryDate: true },
          })
        : null;

      res.json({
        contractId: contract.id,
        requestId: req.params.requestId,
        status: contract.signedAt ? "signed" : "pending",
        rateCents: contract.rateCents,
        billingCycle: contract.billingCycle,
        // Slip contract dates are calendar-only — emit YYYY-MM-DD strings
        // so the e-sign page never sees a timestamp it would have to
        // .split('T')[0] back into a date.
        startDate: formatDateOnlyISO(contract.startDate),
        endDate: formatDateOnlyISO(contract.endDate),
        signedAt: formatDateOnlyISO(contract.signedAt),
        autoRenew: contract.autoRenew,
        slip: contract.slip,
        customer: contract.customer,
        boat: contract.boat,
        latestInsurance,
      });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/esign/:requestId/submit — customer fills in info + confirms (public)
router.post(
  "/public/esign/:requestId/submit",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = EsignSubmitSchema.parse(req.body);

      const contract = await prisma.slipContract.findFirst({
        where: { esignEnvelopeId: req.params.requestId },
        include: {
          customer: { select: { id: true, tenantId: true } },
          boat: { select: { id: true } },
        },
      });

      if (!contract) {
        res.status(404).json({ error: "Signing link not found or expired", code: "NOT_FOUND" });
        return;
      }
      if (contract.signedAt) {
        res.status(410).json({ error: "This contract has already been signed", code: "ALREADY_SIGNED" });
        return;
      }

      const ops: Promise<unknown>[] = [];

      // Update boat if present
      if (contract.boatId) {
        const boatUpdate: Record<string, unknown> = {};
        if (data.hin !== undefined) boatUpdate.hin = data.hin;
        if (data.registrationNumber !== undefined) boatUpdate.registrationNumber = data.registrationNumber;
        if (data.registrationState !== undefined) boatUpdate.registrationState = data.registrationState;
        if (data.registrationExpiry !== undefined) boatUpdate.registrationExpiry = data.registrationExpiry;
        if (data.make !== undefined) boatUpdate.make = data.make;
        if (data.model !== undefined) boatUpdate.model = data.model;
        if (data.year !== undefined) boatUpdate.year = data.year;
        if (Object.keys(boatUpdate).length) {
          ops.push(prisma.boat.update({ where: { id: contract.boatId }, data: boatUpdate }));
        }
      }

      // Create insurance record if provided
      if ((data.insurer || data.policyNumber) && contract.customer.id) {
        ops.push(prisma.insuranceRecord.create({
          data: {
            tenantId: contract.customer.tenantId,
            customerId: contract.customer.id,
            boatId: contract.boatId ?? null,
            insurer: data.insurer ?? null,
            policyNumber: data.policyNumber ?? null,
            startDate: data.insStartDate ?? null,
            expiryDate: data.insExpiryDate ?? null,
            status: "APPROVED",
          },
        }));
      }

      // Update emergency contact on customer
      if (data.ecName || data.ecPhone) {
        ops.push(prisma.customer.update({
          where: { id: contract.customer.id },
          data: {
            emergencyContactJson: {
              name: data.ecName ?? null,
              phone: data.ecPhone ?? null,
              relationship: data.ecRelationship ?? null,
            },
          },
        }));
      }

      // Mark contract as signed. signedAt is a calendar date (which day the
      // customer signed), not a wall-clock timestamp — store it normalized
      // so it renders as the same day for every viewer.
      ops.push(prisma.slipContract.update({
        where: { id: contract.id },
        data: {
          signedAt: todayDateOnly(),
          esignEnvelopeId: req.params.requestId,
        } as Record<string, unknown>,
      }));

      await Promise.all(ops);

      res.json({ success: true, message: "Contract signed and information saved" });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Authenticated routes ───────────────────────────────────────────────────

router.use(...clerkAuth());
router.use(locationContext());

// ─── GET /expiring — Contracts expiring within N days ───────────────────────
// Registered before /:id so Express doesn't treat "expiring" as a UUID param.

router.get(
  "/expiring",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const { days, skip, take } = ExpiringQuerySchema.parse(req.query);

      // Compare against UTC midnight today so a contract whose endDate is
      // exactly today is treated identically regardless of when in the day
      // this query runs (avoids the day-boundary flicker where a contract
      // fell out of "expiring within 30 days" because the query happened
      // to run after midnight in one timezone but before in another).
      const now = todayDateOnly();
      const cutoff = new Date(now);
      cutoff.setUTCDate(cutoff.getUTCDate() + days);

      const where = {
        tenantId,
        ...scopedWhere(req, { includeNull: true }),
        status: { in: ["ACTIVE", "EXPIRING"] as ("ACTIVE" | "EXPIRING")[] },
        endDate: { gte: now, lte: cutoff },
      };

      const [contracts, total] = await Promise.all([
        prisma.slipContract.findMany({
          where,
          include: {
            slip: { select: { id: true, slipNumber: true, dockId: true } },
            customer: {
              select: { id: true, firstName: true, lastName: true, email: true },
            },
            boat: { select: { id: true, name: true, lengthFt: true } },
          },
          orderBy: { endDate: "asc" },
          skip,
          take,
        }),
        prisma.slipContract.count({ where }),
      ]);

      // Add days until expiry. daysUntilExpiry must be computed BEFORE
      // serializing the dates to YYYY-MM-DD strings since it needs Date math.
      const data = contracts.map((c) =>
        serializeContract({
          ...c,
          daysUntilExpiry: c.endDate
            ? Math.ceil(
                (c.endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
              )
            : null,
        }),
      );

      res.json({
        data,
        pagination: { skip, take, total },
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET / — List contracts ─────────────────────────────────────────────────

router.get(
  "/",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const query = ListContractsQuerySchema.parse(req.query);

      const where: Record<string, unknown> = {
        tenantId,
        // Task #339: scope to active location.
        ...scopedWhere(req, { includeNull: true }),
      };

      if (query.status) where.status = query.status;
      if (query.customerId) where.customerId = query.customerId;
      if (query.slipId) where.slipId = query.slipId;
      if (query.billingCycle) where.billingCycle = query.billingCycle;

      if (query.expiryFrom || query.expiryTo) {
        where.endDate = {
          ...(query.expiryFrom ? { gte: query.expiryFrom } : {}),
          ...(query.expiryTo ? { lte: query.expiryTo } : {}),
        };
      }

      const [contracts, total] = await Promise.all([
        prisma.slipContract.findMany({
          where,
          orderBy: { [query.sortBy]: query.sortOrder },
          skip: query.skip,
          take: query.take,
          include: {
            // locationId/slipType feed the detail-modal plan picker.
            slip: { select: { id: true, slipNumber: true, dockId: true, locationId: true, slipType: true } },
            customer: {
              select: { id: true, firstName: true, lastName: true },
            },
            boat: { select: { id: true, name: true } },
            // Plan label + active flag for the list "Unlinked" badge.
            dockageRate: {
              select: { id: true, slipType: true, monthlyRateCents: true, active: true },
            },
          },
        }),
        prisma.slipContract.count({ where }),
      ]);

      res.json({
        data: contracts.map((c) => serializeContract(c)),
        pagination: {
          skip: query.skip,
          take: query.take,
          total,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /:id — Get single contract ─────────────────────────────────────────

router.get(
  "/:id",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;

      const contract = await prisma.slipContract.findFirst({
        where: {
          id: req.params.id,
          tenantId,
          ...scopedWhere(req, { includeNull: true }),
        },
        include: {
          slip: true,
          customer: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
            },
          },
          boat: true,
          securityDeposits: true,
          // include the linked rate plan so the detail
          // modal can show plan name / unlinked badge.
          dockageRate: {
            select: {
              id: true,
              slipType: true,
              monthlyRateCents: true,
              active: true,
              taxClass: true,
            },
          },
        },
      });

      if (!contract) {
        throw appError("Contract not found", 404, "NOT_FOUND");
      }

      // Billing history: invoices that reference this slip for this customer
      const billingHistory = await prisma.invoice.findMany({
        where: {
          customerId: contract.customerId,
          tenantId,
          lineItems: {
            some: {
              sourceType: "SlipContract",
              sourceId: contract.id,
            },
          },
        },
        orderBy: { issuedDate: "desc" },
        take: 24,
        select: {
          id: true,
          invoiceNumber: true,
          issuedDate: true,
          dueDate: true,
          status: true,
          totalCents: true,
          balanceCents: true,
        },
      });

      res.json({
        ...serializeContract(contract),
        billingHistory,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST / — Create contract ───────────────────────────────────────────────

router.post(
  "/",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const data = CreateContractSchema.parse(req.body);

      // Verify slip exists, is available, and belongs to a location the
      // caller can see (Task #339). Scope on the slip's locationId so a
      // user with picker on Marina A can't create a contract against a
      // slip in Marina B by guessing the slip id.
      const slip = await prisma.slip.findFirst({
        where: { id: data.slipId, tenantId, ...scopedWhere(req) },
      });
      if (!slip) {
        throw appError("Slip not found", 404, "SLIP_NOT_FOUND");
      }

      // Validate the optional rate-plan link and capture the plan for
      // defaulting rateCents / electricityMode below. Tenant + slip
      // location must agree; slipType only when both sides have one
      // (older slips have no slipType).
      let linkedPlanForDefaults: {
        monthlyRateCents: number;
        electricityMode: "FLAT_FEE" | "METERED";
      } | null = null;
      if (data.dockageRateId) {
        const plan = await prisma.dockageRate.findFirst({
          where: { id: data.dockageRateId, tenantId },
          select: {
            id: true,
            locationId: true,
            slipType: true,
            active: true,
            monthlyRateCents: true,
            electricityMode: true,
          },
        });
        if (!plan) {
          throw appError("Rate plan not found", 404, "DOCKAGE_RATE_NOT_FOUND");
        }
        if (slip.locationId && plan.locationId !== slip.locationId) {
          throw appError(
            "Rate plan belongs to a different location than the slip",
            400,
            "DOCKAGE_RATE_LOCATION_MISMATCH",
          );
        }
        if (slip.slipType && plan.slipType && plan.slipType !== slip.slipType) {
          throw appError(
            `Rate plan is for slip type "${plan.slipType}" but slip is "${slip.slipType}"`,
            400,
            "DOCKAGE_RATE_SLIP_TYPE_MISMATCH",
          );
        }
        if (!plan.active) {
          throw appError(
            "Rate plan is inactive",
            400,
            "DOCKAGE_RATE_INACTIVE",
          );
        }
        linkedPlanForDefaults = {
          monthlyRateCents: plan.monthlyRateCents,
          electricityMode: plan.electricityMode as "FLAT_FEE" | "METERED",
        };
      }

      // Default from plan when caller omitted; explicit values win so
      // off-plan negotiated rates stay locked on the contract.
      const resolvedRateCents =
        data.rateCents ?? linkedPlanForDefaults?.monthlyRateCents;
      if (resolvedRateCents == null) {
        // Belt-and-braces: refine() should have rejected this already.
        throw appError(
          "rateCents is required when no dockageRateId is provided",
          400,
          "RATE_REQUIRED",
        );
      }
      const resolvedElectricityMode =
        data.electricityMode ?? linkedPlanForDefaults?.electricityMode ?? null;
      if (slip.status === "OCCUPIED") {
        // Check for active contracts on this slip
        const activeContract = await prisma.slipContract.findFirst({
          where: {
            slipId: data.slipId,
            tenantId,
            status: "ACTIVE",
          },
          select: { id: true },
        });
        if (activeContract) {
          throw appError(
            "Slip already has an active contract",
            409,
            "SLIP_OCCUPIED",
          );
        }
      }

      // Verify customer exists and is visible from the active location.
      const customer = await prisma.customer.findFirst({
        where: {
          id: data.customerId,
          tenantId,
          ...scopedWhere(req, { includeNull: true }),
        },
        select: { id: true },
      });
      if (!customer) {
        throw appError("Customer not found", 404, "CUSTOMER_NOT_FOUND");
      }

      // Verify boat exists and belongs to customer (if provided).
      if (data.boatId) {
        const boat = await prisma.boat.findFirst({
          where: {
            id: data.boatId,
            tenantId,
            customerId: data.customerId,
            ...scopedWhere(req, { includeNull: true }),
          },
          select: { id: true },
        });
        if (!boat) {
          throw appError(
            "Boat not found or does not belong to customer",
            404,
            "BOAT_NOT_FOUND",
          );
        }
      }

      const startDate = data.startDate;
      const endDate = data.endDate ?? null;

      // Calculate proration if mid-month start
      const proration = calculateProration(
        resolvedRateCents,
        startDate,
        data.billingCycle ?? "MONTHLY",
      );

      // Set billing anchor to start day if not specified
      const billingAnchor = data.billingAnchor ?? startDate.getUTCDate();

      // Create contract in a transaction
      const contract = await prisma.$transaction(async (tx) => {
        const newContract = await tx.slipContract.create({
          data: {
            tenantId,
            ...data,
            // Task #339: a contract always lives at the slip's marina,
            // so derive locationId from the slip rather than the picker.
            locationId: slip.locationId,
            // Plan-defaulted overrides (post-spread so they replace
            // undefined from input; explicit caller values won earlier).
            rateCents: resolvedRateCents,
            electricityMode: resolvedElectricityMode,
            startDate,
            endDate,
            billingAnchor,
            status: data.status ?? "ACTIVE",
          },
        });

        // Update slip status to OCCUPIED if contract is ACTIVE
        if ((data.status ?? "ACTIVE") === "ACTIVE") {
          await tx.slip.update({
            where: { id: data.slipId },
            data: { status: "OCCUPIED" },
          });
        }

        // Generate security deposit invoice if configured.
        // Stamp the originating marina (slip.locationId) onto the deposit row
        // so postSecurityDeposit / releaseSecurityDeposit always credit/debit
        // that marina's bank and security-deposits-held accounts under its
        // per-location chart of accounts. Without this, multi-marina operators
        // with separate QBO realms could see deposits land on the wrong
        // marina's books.
        if (data.securityDepositCents && data.securityDepositCents > 0) {
          const deposit = await tx.securityDeposit.create({
            data: {
              tenantId,
              locationId: slip.locationId,
              customerId: data.customerId,
              contractId: newContract.id,
              amountCents: data.securityDepositCents,
              status: "HELD",
            },
          });

          // Book the deposit to the GL inside the same transaction so the
          // SecurityDeposit row and its balanced bank/2300-liability journal
          // either both land or both roll back. The deposit's locationId
          // scopes the chart-of-accounts lookups to the originating
          // marina's bank and security-deposits-held rows.
          await postSecurityDeposit(
            {
              id: deposit.id,
              tenantId,
              amountCents: deposit.amountCents,
              locationId: deposit.locationId,
            },
            tx,
          );
        }

        return newContract;
      });

      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          recordType: "SlipContract",
          recordId: contract.id,
          action: "CREATED",
          changedFieldsJson: {
            slipId: data.slipId,
            customerId: data.customerId,
            dockageRateId: data.dockageRateId ?? null,
            rateCents: resolvedRateCents,
            proration:
              proration.proratedDays > 0
                ? {
                    proratedCents: proration.proratedCents,
                    proratedDays: proration.proratedDays,
                    totalDays: proration.totalDays,
                  }
                : null,
          },
        },
      });

      res.status(201).json({
        ...serializeContract(contract),
        proration:
          proration.proratedDays > 0
            ? {
                proratedCents: proration.proratedCents,
                proratedDays: proration.proratedDays,
                totalDays: proration.totalDays,
              }
            : null,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── PUT /:id — Update contract ─────────────────────────────────────────────

router.put(
  "/:id",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const data = UpdateContractSchema.parse(req.body);

      const existing = await prisma.slipContract.findFirst({
        where: { id: req.params.id, tenantId, ...scopedWhere(req, { includeNull: true }) },
        include: { slip: { select: { locationId: true, slipType: true } } },
      });
      if (!existing) {
        throw appError("Contract not found", 404, "NOT_FOUND");
      }

      // Re-validate the link on update and capture the plan for
      // defaulting rate / electricity when the caller is just re-linking.
      let linkedPlanForDefaults: {
        monthlyRateCents: number;
        electricityMode: "FLAT_FEE" | "METERED";
      } | null = null;
      if (data.dockageRateId) {
        const plan = await prisma.dockageRate.findFirst({
          where: { id: data.dockageRateId, tenantId },
          select: {
            id: true,
            locationId: true,
            slipType: true,
            active: true,
            monthlyRateCents: true,
            electricityMode: true,
          },
        });
        if (!plan) {
          throw appError("Rate plan not found", 404, "DOCKAGE_RATE_NOT_FOUND");
        }
        const slipLoc = existing.slip?.locationId;
        const slipType = existing.slip?.slipType;
        if (slipLoc && plan.locationId !== slipLoc) {
          throw appError(
            "Rate plan belongs to a different location than the slip",
            400,
            "DOCKAGE_RATE_LOCATION_MISMATCH",
          );
        }
        if (slipType && plan.slipType && plan.slipType !== slipType) {
          throw appError(
            `Rate plan is for slip type "${plan.slipType}" but slip is "${slipType}"`,
            400,
            "DOCKAGE_RATE_SLIP_TYPE_MISMATCH",
          );
        }
        if (!plan.active) {
          throw appError("Rate plan is inactive", 400, "DOCKAGE_RATE_INACTIVE");
        }
        linkedPlanForDefaults = {
          monthlyRateCents: plan.monthlyRateCents,
          electricityMode: plan.electricityMode as "FLAT_FEE" | "METERED",
        };
      }

      const persistData: Record<string, unknown> = { ...data };

      // Re-link flow: inherit rate / electricity from the new plan
      // when the caller didn't pass them. Explicit values still win.
      if (linkedPlanForDefaults) {
        if (data.rateCents == null) {
          persistData.rateCents = linkedPlanForDefaults.monthlyRateCents;
        }
        if (data.electricityMode == null) {
          persistData.electricityMode = linkedPlanForDefaults.electricityMode;
        }
      }

      const updated = await prisma.slipContract.update({
        where: { id: req.params.id },
        data: persistData,
      });

      // Slip-contract date columns are calendar dates — surface them in the
      // audit diff as YYYY-MM-DD instead of full ISO timestamps so the
      // history reads as "endDate: 2026-05-01 → 2026-06-01".
      const dateOnlyFields = new Set([
        "startDate",
        "endDate",
        "signedAt",
        "terminationDate",
      ]);
      const changedFields: Record<string, unknown> = {};
      for (const key of Object.keys(data) as (keyof typeof data)[]) {
        if (data[key] !== undefined) {
          const fromVal = (existing as Record<string, unknown>)[key];
          const toVal = persistData[key as string] ?? data[key];
          if (dateOnlyFields.has(key as string)) {
            changedFields[key] = {
              from: formatDateOnlyISO(fromVal as Date | null | undefined),
              to: formatDateOnlyISO(toVal as Date | null | undefined),
            };
          } else {
            changedFields[key] = { from: fromVal, to: toVal };
          }
        }
      }

      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          recordType: "SlipContract",
          recordId: updated.id,
          action: "UPDATED",
          changedFieldsJson: changedFields,
        },
      });

      res.json(serializeContract(updated));
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /:id/terminate — Early termination ───────────────────────────────

router.post(
  "/:id/terminate",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const {
        reason,
        terminationDate,
        penaltyOverrideCents,
        glAccountId,
        depositInstructions,
      } = TerminateContractSchema.parse(req.body);

      const contract = await prisma.slipContract.findFirst({
        where: { id: req.params.id, tenantId, ...scopedWhere(req, { includeNull: true }) },
        include: {
          slip: { select: { id: true } },
          securityDeposits: { where: { status: "HELD" } },
        },
      });

      if (!contract) {
        throw appError("Contract not found", 404, "NOT_FOUND");
      }

      if (contract.status === "TERMINATED") {
        throw appError("Contract is already terminated", 400, "ALREADY_TERMINATED");
      }

      if (contract.status !== "ACTIVE" && contract.status !== "EXPIRING") {
        throw appError(
          `Cannot terminate contract with status "${contract.status}"`,
          400,
          "INVALID_STATUS",
        );
      }

      // Build a per-deposit instruction map.  Default action for any held
      // deposit not explicitly addressed is REFUND, preserving prior behavior.
      const instructionByDeposit = new Map<
        string,
        { action: "REFUND" } | { action: "APPLY_TO_INVOICE"; invoiceId: string }
      >();
      for (const inst of depositInstructions ?? []) {
        instructionByDeposit.set(inst.depositId, inst);
      }

      // Validate every supplied instruction targets a held deposit on this
      // contract, and that any "apply to invoice" target is an open invoice
      // for the same customer with enough balance to absorb every deposit
      // pointed at it. We aggregate the requested totals per invoice so that
      // multiple deposits applied to the same invoice can't collectively
      // over-credit A/R (the per-deposit pass would otherwise pass each
      // check individually while their sum exceeds the balance).
      //
      // "Open" here means ISSUED / PAST_DUE / COLLECTIONS — DRAFT is not
      // yet a customer-facing receivable, PAID has nothing to apply to,
      // and VOID is closed.
      const OPEN_INVOICE_STATUSES = new Set([
        "ISSUED",
        "PAST_DUE",
        "COLLECTIONS",
      ]);
      const heldIds = new Set(contract.securityDeposits.map((d) => d.id));
      const seenDepositIds = new Set<string>();
      const requestedByInvoice = new Map<string, number>();

      for (const inst of depositInstructions ?? []) {
        if (!heldIds.has(inst.depositId)) {
          throw appError(
            `Deposit ${inst.depositId} is not a held deposit on this contract`,
            400,
            "INVALID_DEPOSIT",
          );
        }
        if (seenDepositIds.has(inst.depositId)) {
          throw appError(
            `Deposit ${inst.depositId} appears more than once in depositInstructions`,
            400,
            "DUPLICATE_DEPOSIT_INSTRUCTION",
          );
        }
        seenDepositIds.add(inst.depositId);

        if (inst.action === "APPLY_TO_INVOICE") {
          const heldAmount =
            contract.securityDeposits.find((d) => d.id === inst.depositId)
              ?.amountCents ?? 0;
          requestedByInvoice.set(
            inst.invoiceId,
            (requestedByInvoice.get(inst.invoiceId) ?? 0) + heldAmount,
          );
        }
      }

      for (const [invoiceId, requestedTotal] of requestedByInvoice) {
        const targetInvoice = await prisma.invoice.findFirst({
          where: { id: invoiceId, tenantId },
          select: {
            id: true,
            customerId: true,
            balanceCents: true,
            status: true,
          },
        });
        if (!targetInvoice) {
          throw appError(
            `Invoice ${invoiceId} not found`,
            404,
            "INVOICE_NOT_FOUND",
          );
        }
        if (targetInvoice.customerId !== contract.customerId) {
          throw appError(
            "Invoice does not belong to this contract's customer",
            400,
            "INVOICE_CUSTOMER_MISMATCH",
          );
        }
        if (!OPEN_INVOICE_STATUSES.has(targetInvoice.status)) {
          throw appError(
            `Invoice ${invoiceId} is not open (status=${targetInvoice.status}); only ISSUED, PAST_DUE, or COLLECTIONS invoices can absorb a deposit`,
            400,
            "INVOICE_NOT_OPEN",
          );
        }
        if (targetInvoice.balanceCents <= 0) {
          throw appError(
            `Invoice ${invoiceId} has no outstanding balance`,
            400,
            "INVOICE_NO_BALANCE",
          );
        }
        if (requestedTotal > targetInvoice.balanceCents) {
          throw appError(
            `Deposits applied to invoice ${invoiceId} (total ${
              requestedTotal / 100
            }) exceed its balance (${
              targetInvoice.balanceCents / 100
            }); partial application is not supported`,
            400,
            "DEPOSIT_EXCEEDS_INVOICE_BALANCE",
          );
        }
      }

      const effectiveDate = terminationDate ?? todayDateOnly();

      // Calculate penalty
      let penaltyCents = 0;
      if (penaltyOverrideCents !== undefined) {
        penaltyCents = penaltyOverrideCents;
      } else if (contract.earlyTerminationType && contract.earlyTerminationValue) {
        if (contract.earlyTerminationType === "FIXED") {
          penaltyCents = Math.round(contract.earlyTerminationValue);
        } else if (contract.earlyTerminationType === "FORMULA") {
          // Formula: value is number of months of rent as penalty
          penaltyCents = Math.round(
            contract.rateCents * contract.earlyTerminationValue,
          );
        }
      }

      // Pre-flight: every held deposit's release will post a reversing
      // journal that needs the SECURITY_DEPOSITS_HELD account (2300) — and,
      // for "apply to invoice", A/R (1200) — at the deposit's frozen
      // location. If the chart of accounts on that location is missing
      // either, the GL helpers throw a plain Error mid-transaction which
      // surfaces as a generic 500. Validate up-front per location so we
      // can return a clear, actionable 400 instead.
      // Bucket deposits by their frozen release location so we can compute
      // each location's account requirements independently — a refund-only
      // location must NOT be blocked because some other location's deposit
      // is being applied to an invoice.
      const depositsByLocation = new Map<string, typeof contract.securityDeposits>();
      for (const d of contract.securityDeposits) {
        if (!d.locationId) continue;
        const list = depositsByLocation.get(d.locationId) ?? [];
        list.push(d);
        depositsByLocation.set(d.locationId, list);
      }
      for (const [locId, deposits] of depositsByLocation) {
        const locNeedsAr = deposits.some((d) => {
          const inst = instructionByDeposit.get(d.id);
          const target = inst
            ? inst.action === "APPLY_TO_INVOICE"
              ? inst.invoiceId
              : null
            : (d.appliedToInvoiceId ?? null);
          return Boolean(target);
        });
        const required: Array<{ number: string; label: string; subType?: string }> = [
          { number: "2300", label: "Security Deposits Held" },
        ];
        if (locNeedsAr) {
          required.push({
            number: "1200",
            label: "Accounts Receivable",
            // `getAccountByNumber` falls back to subType match for QBO-imported
            // charts where account numbers are "QBO-NN" rather than "1200".
            // Mirror that here so we don't false-positive on those tenants.
            subType: "AccountsReceivable",
          });
        }
        // Match resolution rules used by gl-posting helpers: when QBO is
        // connected, only this location's chart counts (no tenant-wide /
        // cross-realm fallback); otherwise location-scoped OR tenant-wide.
        const qboConnected = await isLocationQboConnected(locId);
        for (const acct of required) {
          const exists = await prisma.glAccount.findFirst({
            where: {
              tenantId,
              ...(qboConnected
                ? { locationId: locId }
                : { OR: [{ locationId: locId }, { locationId: null }] }),
              OR: [
                { accountNumber: acct.number },
                ...(acct.subType && !qboConnected
                  ? [{ subType: acct.subType }]
                  : []),
              ],
            },
            select: { id: true },
          });
          if (!exists) {
            throw appError(
              `Cannot release security deposit: GL account ${acct.number} (${acct.label}) is not configured for this location's chart of accounts. Open Settings → Accounting and add the ${acct.label} account before terminating this contract.`,
              400,
              "DEPOSIT_GL_UNCONFIGURED",
            );
          }
        }
      }

      await prisma.$transaction(async (tx) => {
        // Record the early-termination date in its own column; leave the
        // scheduled endDate intact so we can still tell ended-early from
        // ended-on-schedule.
        await tx.slipContract.update({
          where: { id: req.params.id },
          data: {
            status: "TERMINATED",
            terminationDate: effectiveDate,
          },
        });

        // Release slip
        await tx.slip.update({
          where: { id: contract.slipId },
          data: { status: "VACANT" },
        });

        // Release any held security deposits back to the originating marina's
        // books. Each deposit's frozen locationId scopes the reversal to the
        // same per-location bank and security-deposits-held rows the original
        // postSecurityDeposit touched, even on multi-marina operators with
        // separate QBO realms. We mark the deposit RELEASED and post the
        // reversing journal in the same transaction so the row state and the
        // ledger stay in lockstep.
        //
        // Per-deposit operator choice: the terminate request can specify
        // `depositInstructions` to apply specific deposits to a customer
        // invoice (debit 2300 / credit A/R) instead of refunding to the bank.
        // Any deposit not addressed defaults to REFUND, matching the prior
        // behavior. When a deposit is applied to an invoice we also reduce
        // that invoice's `balanceCents` and flip its status to PAID if the
        // application zeroes it out, so the customer's open balance and the
        // ledger move together.
        for (const heldDeposit of contract.securityDeposits) {
          const instruction = instructionByDeposit.get(heldDeposit.id);
          // Resolution order:
          //   1. Explicit operator instruction from the request (refund vs.
          //      apply-to-invoice).
          //   2. Otherwise, fall back to the deposit row's pre-existing
          //      `appliedToInvoiceId` (legacy behavior — if it was already
          //      earmarked, keep that earmark).
          const targetInvoiceId = instruction
            ? instruction.action === "APPLY_TO_INVOICE"
              ? instruction.invoiceId
              : null
            : heldDeposit.appliedToInvoiceId ?? null;

          await tx.securityDeposit.update({
            where: { id: heldDeposit.id },
            data: {
              status: "RELEASED",
              releasedAt: effectiveDate,
              appliedToInvoiceId: targetInvoiceId,
            },
          });
          await releaseSecurityDeposit(
            {
              id: heldDeposit.id,
              tenantId,
              amountCents: heldDeposit.amountCents,
              appliedToInvoiceId: targetInvoiceId,
              locationId: heldDeposit.locationId ?? null,
            },
            tx,
          );

          if (targetInvoiceId) {
            // Re-read inside the transaction so concurrent payments cannot
            // race the deposit application past zero balance. If a payment
            // landed between the request-time validation and now, the live
            // balance may be too small to absorb this deposit — bail and
            // roll the whole termination back rather than silently clamping
            // to zero (which would leave A/R over-credited by the GL post).
            const liveInvoice = await tx.invoice.findUnique({
              where: { id: targetInvoiceId },
              select: { balanceCents: true, status: true },
            });
            if (!liveInvoice) {
              throw appError(
                `Invoice ${targetInvoiceId} disappeared during termination`,
                409,
                "INVOICE_GONE",
              );
            }
            if (liveInvoice.balanceCents < heldDeposit.amountCents) {
              throw appError(
                `Invoice ${targetInvoiceId} balance changed during termination (now ${
                  liveInvoice.balanceCents / 100
                }, deposit ${heldDeposit.amountCents / 100}); please retry`,
                409,
                "INVOICE_BALANCE_CHANGED",
              );
            }
            const newBalance = liveInvoice.balanceCents - heldDeposit.amountCents;
            await tx.invoice.update({
              where: { id: targetInvoiceId },
              data: {
                balanceCents: newBalance,
                status:
                  newBalance === 0 && liveInvoice.status !== "VOID"
                    ? "PAID"
                    : liveInvoice.status,
              },
            });
          }
        }

        // Post penalty GL entry if applicable
        if (penaltyCents > 0 && glAccountId) {
          await tx.glEntry.create({
            data: {
              tenantId,
              accountId: glAccountId,
              debitCents: 0,
              creditCents: penaltyCents,
              description: `Early termination penalty - Contract ${req.params.id}`,
              sourceType: "SlipContract",
              sourceId: req.params.id,
            },
          });
        }

        // Wash out any deferred revenue schedules
        const deferredSchedules = await tx.deferredSchedule.findMany({
          where: {
            tenantId,
            status: "PENDING",
            invoiceLineItem: {
              sourceType: "SlipContract",
              sourceId: req.params.id,
            },
          },
        });

        for (const schedule of deferredSchedules) {
          await tx.deferredSchedule.update({
            where: { id: schedule.id },
            data: { status: "RECOGNIZED" },
          });
        }

        // Create audit log — include the per-deposit refund/apply choices so
        // the trail explains why some deposits were refunded vs. applied to
        // outstanding balances. The recorded action reflects what actually
        // happened (the *effective* target invoice), including the legacy
        // fallback where a deposit row's pre-existing `appliedToInvoiceId`
        // was used because no explicit instruction was supplied.
        const depositActions = contract.securityDeposits.map((d) => {
          const inst = instructionByDeposit.get(d.id);
          const effectiveInvoiceId =
            inst?.action === "APPLY_TO_INVOICE"
              ? inst.invoiceId
              : inst?.action === "REFUND"
                ? null
                : (d.appliedToInvoiceId ?? null);
          return {
            depositId: d.id,
            amountCents: d.amountCents,
            action: effectiveInvoiceId ? "APPLY_TO_INVOICE" : "REFUND",
            invoiceId: effectiveInvoiceId,
            instructionSource: inst ? "explicit" : "legacy_fallback",
          };
        });

        await tx.auditLog.create({
          data: {
            tenantId,
            userId: req.userId,
            recordType: "SlipContract",
            recordId: req.params.id,
            action: "TERMINATED",
            changedFieldsJson: {
              reason,
              terminationDate: formatDateOnlyISO(effectiveDate),
              // Preserved on the row, mirrored here so audit readers can
              // see ended-early vs. ended-on-schedule at a glance.
              scheduledEndDate: contract.endDate
                ? formatDateOnlyISO(contract.endDate)
                : null,
              penaltyCents,
              previousStatus: contract.status,
              depositActions,
            },
          },
        });
      });

      res.json({
        success: true,
        contractId: req.params.id,
        terminationDate: formatDateOnlyISO(effectiveDate),
        // Preserved scheduled end so callers can show both dates.
        endDate: contract.endDate ? formatDateOnlyISO(contract.endDate) : null,
        penaltyCents,
        message: "Contract terminated successfully",
      });
    } catch (err) {
      // Translate the well-known GL-account-missing errors thrown from
      // gl-posting helpers (plain `Error` instances) into a clear 400 so
      // the operator sees an actionable message instead of "Internal
      // server error". The pre-flight check above catches the common
      // tenant-wide-or-location-scoped case, but the QBO-connected
      // branch in `resolveLocationScopedAccountByNumber` enforces a
      // stricter location-only rule that can still throw mid-tx.
      const msg = err instanceof Error ? err.message : "";
      if (
        msg.startsWith("UNCONFIGURED_GL_ACCOUNT:") ||
        msg.startsWith("UNCONFIGURED_GL_MAPPING:") ||
        /^GL account .* not found for tenant /.test(msg)
      ) {
        return next(
          appError(
            `Cannot release security deposit: ${msg.replace(/^UNCONFIGURED_GL_(?:ACCOUNT|MAPPING):\s*/, "")}. Open Settings → Accounting and configure the missing account before terminating this contract.`,
            400,
            "DEPOSIT_GL_UNCONFIGURED",
          ),
        );
      }
      next(err);
    }
  },
);

// ─── POST /:id/renew — Single contract renewal ────────────────────────────

router.post(
  "/:id/renew",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const { newEndDate, newRateCents, billingCycle } =
        RenewContractSchema.parse(req.body);

      const contract = await prisma.slipContract.findFirst({
        where: { id: req.params.id, tenantId, ...scopedWhere(req, { includeNull: true }) },
      });

      if (!contract) {
        throw appError("Contract not found", 404, "NOT_FOUND");
      }

      if (
        contract.status !== "ACTIVE" &&
        contract.status !== "EXPIRING" &&
        contract.status !== "EXPIRED"
      ) {
        throw appError(
          `Cannot renew contract with status "${contract.status}"`,
          400,
          "INVALID_STATUS",
        );
      }

      // Picks up where the previous contract ended, or today if it
      // had no end date.
      const newStartDate = contract.endDate ?? todayDateOnly();
      const effectiveRate = newRateCents ?? contract.rateCents;
      const effectiveBillingCycle = billingCycle ?? contract.billingCycle;

      const result = await prisma.$transaction(async (tx) => {
        // Mark old contract as RENEWED
        await tx.slipContract.update({
          where: { id: req.params.id },
          data: { status: "RENEWED" },
        });

        // Create new contract
        const renewed = await tx.slipContract.create({
          data: {
            tenantId,
            slipId: contract.slipId,
            customerId: contract.customerId,
            boatId: contract.boatId,
            startDate: newStartDate,
            endDate: newEndDate,
            billingCycle: effectiveBillingCycle,
            billingAnchor: contract.billingAnchor,
            rateCents: effectiveRate,
            electricityMode: contract.electricityMode,
            autoRenew: contract.autoRenew,
            status: "ACTIVE",
            securityDepositCents: contract.securityDepositCents,
            earlyTerminationType: contract.earlyTerminationType,
            earlyTerminationValue: contract.earlyTerminationValue,
            qboItemId: contract.qboItemId,
          },
        });

        // Audit
        await tx.auditLog.create({
          data: {
            tenantId,
            userId: req.userId,
            recordType: "SlipContract",
            recordId: renewed.id,
            action: "RENEWED",
            changedFieldsJson: {
              previousContractId: req.params.id,
              previousRate: contract.rateCents,
              newRate: effectiveRate,
              rateChange:
                effectiveRate !== contract.rateCents
                  ? effectiveRate - contract.rateCents
                  : 0,
            },
          },
        });

        return renewed;
      });

      res.status(201).json(serializeContract(result));
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /:id/send-for-signature — Send contract for e-signature ──────────

router.post(
  "/:id/send-for-signature",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const { signerName, signerEmail, message } =
        SendForSignatureSchema.parse(req.body);

      const contract = await prisma.slipContract.findFirst({
        where: { id: req.params.id, tenantId, ...scopedWhere(req, { includeNull: true }) },
        include: {
          customer: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          // locationId is needed so sendEmail() picks the correct
          // per-location FROM domain override (Task #273).
          slip: { select: { id: true, slipNumber: true, locationId: true } },
        },
      });

      if (!contract) {
        throw appError("Contract not found", 404, "NOT_FOUND");
      }

      if (contract.status === "TERMINATED") {
        throw appError(
          "Cannot send terminated contract for signature",
          400,
          "INVALID_STATUS",
        );
      }

      // Generate a request ID (in production this comes from the esign provider)
      const requestId = `esign_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

      // Update contract — esignEnvelopeId holds the requestId token
      await prisma.slipContract.update({
        where: { id: req.params.id },
        data: {
          esignEnvelopeId: requestId,
        },
      });

      // Audit log
      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          recordType: "SlipContract",
          recordId: req.params.id,
          action: "ESIGN_SENT",
          changedFieldsJson: {
            requestId,
            signerName,
            signerEmail,
            message: message || null,
          },
        },
      });

      // Send e-signature request email. We surface failures explicitly
      // (Task #273) — the contract has already been updated and the
      // audit logged, so we still return 200 with `emailDelivered:false`
      // and `emailError` so the UI can warn the operator instead of
      // silently swallowing a Resend bounce.
      let emailDelivered = false;
      let emailError: string | undefined;
      if (signerEmail) {
        const signingUrl = `${process.env.APP_URL || "https://app.gethelm.com"}/esign/${requestId}`;
        try {
          await sendEmail({
            to: signerEmail,
            subject: "Signature Request — Slip Contract",
            tenantId,
            locationId: contract.slip?.locationId ?? undefined,
            html: `
              <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px;">
                <h2 style="color:#0A2342;">You have a document to sign</h2>
                <p>Hi ${signerName},</p>
                <p>Your marina has sent a slip contract that requires your signature.</p>
                ${message ? `<p style="background:#f5f8ff;padding:12px;border-left:4px solid #0A2342;border-radius:4px;"><em>${message}</em></p>` : ""}
                <p style="text-align:center;margin:24px 0;">
                  <a href="${signingUrl}" style="display:inline-block;padding:12px 28px;background:#0A2342;color:#fff;border-radius:6px;text-decoration:none;font-weight:600;">Review &amp; Sign</a>
                </p>
                <p style="font-size:13px;color:#666;">If you did not expect this, please contact your marina directly.</p>
              </div>`,
          });
          emailDelivered = true;
        } catch (err) {
          emailError = err instanceof Error ? err.message : String(err);
          console.error("[contracts] esign email failed:", emailError);
        }
      }

      res.json({
        requestId,
        status: "sent",
        signerName,
        signerEmail,
        emailDelivered,
        ...(emailError ? { emailError } : {}),
        message: emailError
          ? `Signature request created, but email delivery failed: ${emailError}`
          : "Signature request sent successfully",
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /bulk-send-for-signature — Send multiple contracts for signature ──

router.post(
  "/bulk-send-for-signature",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const { contractIds, message } =
        BulkSendForSignatureSchema.parse(req.body);

      const contracts = await prisma.slipContract.findMany({
        where: {
          id: { in: contractIds },
          tenantId,
          status: { notIn: ["TERMINATED"] },
        },
        include: {
          customer: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          // locationId drives per-location FROM domain selection (Task #273).
          slip: { select: { locationId: true } },
        },
      });

      if (contracts.length === 0) {
        throw appError(
          "No eligible contracts found",
          404,
          "NO_CONTRACTS_FOUND",
        );
      }

      const results: {
        contractId: string;
        requestId: string;
        status: string;
        signerEmail: string;
        emailDelivered: boolean;
        emailError?: string;
      }[] = [];

      for (const contract of contracts) {
        const requestId = `esign_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
        const signerEmail = contract.customer?.email || "";
        const signerName = contract.customer
          ? `${contract.customer.firstName} ${contract.customer.lastName}`
          : "Unknown";

        await prisma.slipContract.update({
          where: { id: contract.id },
          data: { esignEnvelopeId: requestId },
        });

        await prisma.auditLog.create({
          data: {
            tenantId,
            userId: req.userId,
            recordType: "SlipContract",
            recordId: contract.id,
            action: "ESIGN_SENT",
            changedFieldsJson: {
              requestId,
              signerName,
              signerEmail,
              message: message || null,
              batchOperation: true,
            },
          },
        });

        // Send e-signature request email. Per Task #273, surface delivery
        // failures per-contract so the operator can see which signer mails
        // bounced (instead of silently swallowing every failure).
        let emailDelivered = false;
        let emailError: string | undefined;
        if (signerEmail) {
          const signingUrl = `${process.env.APP_URL || "https://app.gethelm.com"}/esign/${requestId}`;
          try {
            await sendEmail({
              to: signerEmail,
              subject: "Signature Request — Slip Contract",
              tenantId,
              locationId: contract.slip?.locationId ?? undefined,
              html: `
                <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px;">
                  <h2 style="color:#0A2342;">You have a document to sign</h2>
                  <p>Hi ${signerName},</p>
                  <p>Your marina has sent a slip contract that requires your signature.</p>
                  ${message ? `<p style="background:#f5f8ff;padding:12px;border-left:4px solid #0A2342;border-radius:4px;"><em>${message}</em></p>` : ""}
                  <p style="text-align:center;margin:24px 0;">
                    <a href="${signingUrl}" style="display:inline-block;padding:12px 28px;background:#0A2342;color:#fff;border-radius:6px;text-decoration:none;font-weight:600;">Review &amp; Sign</a>
                  </p>
                  <p style="font-size:13px;color:#666;">If you did not expect this, please contact your marina directly.</p>
                </div>`,
            });
            emailDelivered = true;
          } catch (err) {
            emailError = err instanceof Error ? err.message : String(err);
            console.error("[contracts] bulk esign email failed:", emailError);
          }
        }

        results.push({
          contractId: contract.id,
          requestId,
          status: "sent",
          signerEmail,
          emailDelivered,
          ...(emailError ? { emailError } : {}),
        });
      }

      const emailFailures = results.filter((r) => r.signerEmail && !r.emailDelivered).length;
      res.json({
        sent: results.length,
        skipped: contractIds.length - results.length,
        emailFailures,
        results,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /esign-webhook — Handle e-signature provider callbacks ────────────

router.post(
  "/esign-webhook",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Shared-secret gate. Without this, any unauthenticated caller can
      // flip esign status on any contract. The provider (DocuSign, HelloSign,
      // etc.) must be configured to send this header on webhook delivery.
      // Fail-closed in all envs: no secret configured ⇒ webhook is disabled.
      const expected = process.env.ESIGN_WEBHOOK_SECRET;
      const provided = req.header("x-esign-webhook-secret");
      if (!expected) {
        throw appError(
          "E-signature webhooks are disabled until ESIGN_WEBHOOK_SECRET is configured",
          503,
          "ESIGN_WEBHOOK_DISABLED",
        );
      }
      if (!provided || provided.length !== expected.length) {
        throw appError("Invalid esign webhook credentials", 401, "UNAUTHORIZED");
      }
      const ok = crypto.timingSafeEqual(
        Buffer.from(provided),
        Buffer.from(expected),
      );
      if (!ok) {
        throw appError("Invalid esign webhook credentials", 401, "UNAUTHORIZED");
      }

      const {
        event,
        requestId,
        contractId,
        signedDocumentUrl,
        signerEmail,
        timestamp,
      } = EsignWebhookSchema.parse(req.body);

      const contract = await prisma.slipContract.findFirst({
        where: { id: contractId },
      });

      if (!contract) {
        throw appError("Contract not found", 404, "NOT_FOUND");
      }

      let newStatus: string;
      switch (event) {
        case "signature_request_signed":
          newStatus = "signed";
          break;
        case "signature_request_declined":
          newStatus = "declined";
          break;
        case "signature_request_viewed":
          newStatus = "viewed";
          break;
        default:
          newStatus = "sent";
      }

      const updateData: Record<string, unknown> = {
        esignStatus: newStatus,
      };

      if (event === "signature_request_signed") {
        // The provider sends a full moment-in-time; reduce it to the
        // calendar day to match how `signedAt` is stored.
        updateData.esignSignedAt = timestamp
          ? parseDateOnly(timestamp)
          : todayDateOnly();
        if (signedDocumentUrl) {
          updateData.esignSignedDocumentUrl = signedDocumentUrl;
        }
      }

      await prisma.slipContract.update({
        where: { id: contractId },
        data: updateData,
      });

      // Audit log
      await prisma.auditLog.create({
        data: {
          tenantId: contract.tenantId,
          userId: null,
          recordType: "SlipContract",
          recordId: contractId,
          action: `ESIGN_${newStatus.toUpperCase()}`,
          changedFieldsJson: {
            event,
            requestId,
            signerEmail: signerEmail || null,
            signedDocumentUrl: signedDocumentUrl || null,
            // The contract-side concept of "when this happened" is the
            // calendar day, matching how signedAt is stored — keep the
            // audit entry date-only so the diff history reads as
            // YYYY-MM-DD rather than a wall-clock timestamp.
            timestamp: formatDateOnlyISO(timestamp ?? todayDateOnly()),
          },
        },
      });

      res.json({ received: true, status: newStatus });
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /:id/signature-status — Get current signing status ─────────────────

router.get(
  "/:id/signature-status",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;

      const contract = await prisma.slipContract.findFirst({
        where: { id: req.params.id, tenantId, ...scopedWhere(req, { includeNull: true }) },
        select: {
          id: true,
          esignEnvelopeId: true,
          signedAt: true,
          signedDocumentUrl: true,
        },
      });

      if (!contract) {
        throw appError("Contract not found", 404, "NOT_FOUND");
      }

      res.json({
        contractId: contract.id,
        requestId: contract.esignEnvelopeId || null,
        status: contract.signedAt ? "signed" : contract.esignEnvelopeId ? "sent" : null,
        sentAt: null,
        // signedAt is a calendar date (which day the customer signed) —
        // emit as YYYY-MM-DD so the polling UI doesn't render a timestamp.
        signedAt: formatDateOnlyISO(contract.signedAt),
        signerName: null,
        signerEmail: null,
        signedDocumentUrl: contract.signedDocumentUrl || null,
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
