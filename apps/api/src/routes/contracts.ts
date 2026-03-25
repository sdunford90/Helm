import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { clerkAuth } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";

const router = Router();

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

const CreateContractSchema = z.object({
  slipId: z.string().uuid(),
  customerId: z.string().uuid(),
  boatId: z.string().uuid().optional().nullable(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date().optional().nullable(),
  billingCycle: BillingCycleEnum.optional(),
  billingAnchor: z.number().int().min(1).max(28).optional().nullable(),
  rateCents: z.number().int().positive(),
  electricityMode: z.enum(["FLAT_FEE", "METERED"]).optional().nullable(),
  autoRenew: z.boolean().optional(),
  status: ContractStatusEnum.optional(),
  securityDepositCents: z.number().int().min(0).optional().nullable(),
  earlyTerminationType: TerminationTypeEnum.optional().nullable(),
  earlyTerminationValue: z.number().optional().nullable(),
  qboItemId: z.string().optional().nullable(),
});

const UpdateContractSchema = z.object({
  boatId: z.string().uuid().optional().nullable(),
  endDate: z.coerce.date().optional().nullable(),
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
});

const ListContractsQuerySchema = z.object({
  status: ContractStatusEnum.optional(),
  customerId: z.string().uuid().optional(),
  slipId: z.string().uuid().optional(),
  billingCycle: BillingCycleEnum.optional(),
  expiryFrom: z.coerce.date().optional(),
  expiryTo: z.coerce.date().optional(),
  skip: z.coerce.number().int().min(0).default(0),
  take: z.coerce.number().int().positive().max(100).default(25),
  sortBy: z
    .enum(["startDate", "endDate", "rateCents", "createdAt"])
    .default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

const TerminateContractSchema = z.object({
  reason: z.string().optional(),
  terminationDate: z.coerce.date().optional(),
  penaltyOverrideCents: z.number().int().min(0).optional(),
  glAccountId: z.string().uuid().optional(),
});

const RenewContractSchema = z.object({
  newEndDate: z.coerce.date(),
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
  const dayOfMonth = startDate.getDate();

  // If starting on the 1st, no proration needed
  if (dayOfMonth === 1) {
    return { proratedCents: rateCents, proratedDays: 0, totalDays: 0 };
  }

  // Get the number of days in the start month
  const year = startDate.getFullYear();
  const month = startDate.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
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

// ─── Authenticated routes ───────────────────────────────────────────────────

router.use(...clerkAuth());

// ─── GET /expiring — Contracts expiring within N days ───────────────────────
// Registered before /:id so Express doesn't treat "expiring" as a UUID param.

router.get(
  "/expiring",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const { days, skip, take } = ExpiringQuerySchema.parse(req.query);

      const now = new Date();
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() + days);

      const where = {
        tenantId,
        status: { in: ["ACTIVE", "EXPIRING"] as const },
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

      // Add days until expiry
      const data = contracts.map((c) => ({
        ...c,
        daysUntilExpiry: c.endDate
          ? Math.ceil(
              (c.endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
            )
          : null,
      }));

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

      const where: Record<string, unknown> = { tenantId };

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
            slip: { select: { id: true, slipNumber: true, dockId: true } },
            customer: {
              select: { id: true, firstName: true, lastName: true },
            },
            boat: { select: { id: true, name: true } },
          },
        }),
        prisma.slipContract.count({ where }),
      ]);

      res.json({
        data: contracts,
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
        where: { id: req.params.id, tenantId },
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
        ...contract,
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

      // Verify slip exists and is available
      const slip = await prisma.slip.findFirst({
        where: { id: data.slipId, tenantId },
      });
      if (!slip) {
        throw appError("Slip not found", 404, "SLIP_NOT_FOUND");
      }
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

      // Verify customer exists
      const customer = await prisma.customer.findFirst({
        where: { id: data.customerId, tenantId },
        select: { id: true },
      });
      if (!customer) {
        throw appError("Customer not found", 404, "CUSTOMER_NOT_FOUND");
      }

      // Verify boat exists and belongs to customer (if provided)
      if (data.boatId) {
        const boat = await prisma.boat.findFirst({
          where: { id: data.boatId, tenantId, customerId: data.customerId },
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

      // Calculate proration if mid-month start
      const proration = calculateProration(
        data.rateCents,
        data.startDate,
        data.billingCycle ?? "MONTHLY",
      );

      // Set billing anchor to start day if not specified
      const billingAnchor = data.billingAnchor ?? data.startDate.getDate();

      // Create contract in a transaction
      const contract = await prisma.$transaction(async (tx) => {
        const newContract = await tx.slipContract.create({
          data: {
            tenantId,
            ...data,
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

        // Generate security deposit invoice if configured
        if (data.securityDepositCents && data.securityDepositCents > 0) {
          await tx.securityDeposit.create({
            data: {
              tenantId,
              customerId: data.customerId,
              contractId: newContract.id,
              amountCents: data.securityDepositCents,
              status: "HELD",
            },
          });
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
            rateCents: data.rateCents,
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
        ...contract,
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
        where: { id: req.params.id, tenantId },
      });
      if (!existing) {
        throw appError("Contract not found", 404, "NOT_FOUND");
      }

      const updated = await prisma.slipContract.update({
        where: { id: req.params.id },
        data,
      });

      const changedFields: Record<string, unknown> = {};
      for (const key of Object.keys(data) as (keyof typeof data)[]) {
        if (data[key] !== undefined) {
          changedFields[key] = {
            from: (existing as Record<string, unknown>)[key],
            to: data[key],
          };
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

      res.json(updated);
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
      } = TerminateContractSchema.parse(req.body);

      const contract = await prisma.slipContract.findFirst({
        where: { id: req.params.id, tenantId },
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

      const effectiveDate = terminationDate ?? new Date();

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

      await prisma.$transaction(async (tx) => {
        // Update contract status
        await tx.slipContract.update({
          where: { id: req.params.id },
          data: {
            status: "TERMINATED",
            endDate: effectiveDate,
          },
        });

        // Release slip
        await tx.slip.update({
          where: { id: contract.slipId },
          data: { status: "VACANT" },
        });

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

        // Create audit log
        await tx.auditLog.create({
          data: {
            tenantId,
            userId: req.userId,
            recordType: "SlipContract",
            recordId: req.params.id,
            action: "TERMINATED",
            changedFieldsJson: {
              reason,
              effectiveDate: effectiveDate.toISOString(),
              penaltyCents,
              previousStatus: contract.status,
            },
          },
        });
      });

      res.json({
        success: true,
        contractId: req.params.id,
        terminationDate: effectiveDate,
        penaltyCents,
        message: "Contract terminated successfully",
      });
    } catch (err) {
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
        where: { id: req.params.id, tenantId },
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

      const newStartDate = contract.endDate ?? new Date();
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

      res.status(201).json(result);
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
        where: { id: req.params.id, tenantId },
        include: {
          customer: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          slip: { select: { id: true, slipNumber: true } },
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

      // Update contract with e-signature tracking fields
      await prisma.slipContract.update({
        where: { id: req.params.id },
        data: {
          esignRequestId: requestId,
          esignStatus: "sent",
          esignSentAt: new Date(),
          esignSignerName: signerName,
          esignSignerEmail: signerEmail,
        } as Record<string, unknown>,
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

      res.json({
        requestId,
        status: "sent",
        signerName,
        signerEmail,
        message: "Signature request sent successfully",
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
      }[] = [];

      for (const contract of contracts) {
        const requestId = `esign_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
        const signerEmail = contract.customer?.email || "";
        const signerName = contract.customer
          ? `${contract.customer.firstName} ${contract.customer.lastName}`
          : "Unknown";

        await prisma.slipContract.update({
          where: { id: contract.id },
          data: {
            esignRequestId: requestId,
            esignStatus: "sent",
            esignSentAt: new Date(),
            esignSignerName: signerName,
            esignSignerEmail: signerEmail,
          } as Record<string, unknown>,
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

        results.push({
          contractId: contract.id,
          requestId,
          status: "sent",
          signerEmail,
        });
      }

      res.json({
        sent: results.length,
        skipped: contractIds.length - results.length,
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
        updateData.esignSignedAt = timestamp || new Date();
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
            timestamp: (timestamp || new Date()).toISOString(),
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
        where: { id: req.params.id, tenantId },
        select: {
          id: true,
          esignRequestId: true,
          esignStatus: true,
          esignSentAt: true,
          esignSignedAt: true,
          esignSignerName: true,
          esignSignerEmail: true,
          esignSignedDocumentUrl: true,
        } as Record<string, boolean>,
      });

      if (!contract) {
        throw appError("Contract not found", 404, "NOT_FOUND");
      }

      const c = contract as Record<string, unknown>;

      res.json({
        contractId: c.id,
        requestId: c.esignRequestId || null,
        status: c.esignStatus || null,
        sentAt: c.esignSentAt || null,
        signedAt: c.esignSignedAt || null,
        signerName: c.esignSignerName || null,
        signerEmail: c.esignSignerEmail || null,
        signedDocumentUrl: c.esignSignedDocumentUrl || null,
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
