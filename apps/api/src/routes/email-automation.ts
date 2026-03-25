import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { clerkAuth, requireRole } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import {
  TRIGGER_METADATA,
  getAvailableVariables,
  mergeTemplate,
  getSampleDataForTrigger,
  type AutomationTrigger,
} from "../services/email-automation.js";

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function appError(message: string, statusCode: number, code: string): Error {
  const err = new Error(message) as Error & {
    statusCode: number;
    code: string;
  };
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

// ─── Zod Schemas ──────────────────────────────────────────────────────────────

const TriggerEnum = z.enum([
  "invoice_created",
  "invoice_past_due",
  "invoice_past_due_7",
  "invoice_past_due_14",
  "invoice_past_due_30",
  "payment_received",
  "payment_failed",
  "ach_return",
  "contract_expiring_60",
  "contract_expiring_30",
  "contract_expiring_7",
  "contract_expired",
  "insurance_expiring_60",
  "insurance_expiring_30",
  "insurance_expiring_7",
  "insurance_expired",
  "registration_expiring_30",
  "rental_booking_confirmed",
  "rental_pre_arrival",
  "rental_post_return",
  "rental_abandoned_cart",
  "rental_nps_survey",
  "welcome_new_customer",
  "waitlist_position_available",
  "dock_walk_violation",
]);

const ChannelEnum = z.enum(["email", "sms"]);

const CategoryEnum = z.enum([
  "billing",
  "operations",
  "rental",
  "compliance",
  "marketing",
  "custom",
]);

const CreateRuleSchema = z.object({
  name: z.string().min(1).max(200),
  trigger: TriggerEnum,
  enabled: z.boolean().default(true),
  delayMinutes: z.number().int().min(0).default(0),
  templateId: z.string().uuid(),
  channels: z.array(ChannelEnum).min(1),
  conditions: z
    .object({
      customerStatus: z.array(z.string()).optional(),
      slipType: z.array(z.string()).optional(),
      minAmountCents: z.number().int().min(0).optional(),
    })
    .optional(),
});

const UpdateRuleSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  trigger: TriggerEnum.optional(),
  enabled: z.boolean().optional(),
  delayMinutes: z.number().int().min(0).optional(),
  templateId: z.string().uuid().optional(),
  channels: z.array(ChannelEnum).min(1).optional(),
  conditions: z
    .object({
      customerStatus: z.array(z.string()).optional(),
      slipType: z.array(z.string()).optional(),
      minAmountCents: z.number().int().min(0).optional(),
    })
    .optional()
    .nullable(),
});

const CreateTemplateSchema = z.object({
  name: z.string().min(1).max(200),
  subject: z.string().min(1).max(500),
  htmlBody: z.string().min(1),
  category: CategoryEnum,
  variables: z.array(z.string()).default([]),
});

const UpdateTemplateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  subject: z.string().min(1).max(500).optional(),
  htmlBody: z.string().min(1).optional(),
  category: CategoryEnum.optional(),
  variables: z.array(z.string()).optional(),
});

const ListLogsQuerySchema = z.object({
  status: z.enum(["QUEUED", "DELIVERED", "OPENED", "FAILED", "BOUNCED"]).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  skip: z.coerce.number().int().min(0).default(0),
  take: z.coerce.number().int().positive().max(100).default(25),
});

// ─── Auth middleware ──────────────────────────────────────────────────────────

router.use(...clerkAuth());
router.use(requireRole("admin", "manager", "PLATFORM_ADMIN", "MARINA_OWNER", "MARINA_MANAGER"));

// ══════════════════════════════════════════════════════════════════════════════
// TRIGGERS
// ══════════════════════════════════════════════════════════════════════════════

router.get(
  "/triggers",
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.json({ data: TRIGGER_METADATA });
    } catch (err) {
      next(err);
    }
  },
);

// ══════════════════════════════════════════════════════════════════════════════
// AUTOMATION RULES
// ══════════════════════════════════════════════════════════════════════════════

// ─── GET /rules — List all rules for tenant ──────────────────────────────────

router.get(
  "/rules",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;

      const rules = await prisma.automationRule.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        include: {
          template: {
            select: { id: true, name: true, subject: true, category: true },
          },
        },
      });

      res.json({ data: rules });
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /rules — Create rule ───────────────────────────────────────────────

router.post(
  "/rules",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const data = CreateRuleSchema.parse(req.body);

      // Verify template exists
      const template = await prisma.emailTemplate.findFirst({
        where: { id: data.templateId, tenantId },
      });
      if (!template) {
        throw appError("Template not found", 404, "TEMPLATE_NOT_FOUND");
      }

      const rule = await prisma.automationRule.create({
        data: {
          tenantId,
          name: data.name,
          trigger: data.trigger,
          enabled: data.enabled,
          delayMinutes: data.delayMinutes,
          templateId: data.templateId,
          channels: data.channels,
          conditions: data.conditions ?? undefined,
        },
        include: {
          template: {
            select: { id: true, name: true, subject: true, category: true },
          },
        },
      });

      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          userName: req.userRecord?.email,
          recordType: "AutomationRule",
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

// ─── PUT /rules/:id — Update rule ───────────────────────────────────────────

router.put(
  "/rules/:id",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const data = UpdateRuleSchema.parse(req.body);

      const existing = await prisma.automationRule.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!existing) {
        throw appError("Rule not found", 404, "NOT_FOUND");
      }

      // If changing template, verify it exists
      if (data.templateId) {
        const template = await prisma.emailTemplate.findFirst({
          where: { id: data.templateId, tenantId },
        });
        if (!template) {
          throw appError("Template not found", 404, "TEMPLATE_NOT_FOUND");
        }
      }

      const updateData: Record<string, unknown> = {};
      if (data.name !== undefined) updateData.name = data.name;
      if (data.trigger !== undefined) updateData.trigger = data.trigger;
      if (data.enabled !== undefined) updateData.enabled = data.enabled;
      if (data.delayMinutes !== undefined) updateData.delayMinutes = data.delayMinutes;
      if (data.templateId !== undefined) updateData.templateId = data.templateId;
      if (data.channels !== undefined) updateData.channels = data.channels;
      if (data.conditions !== undefined) updateData.conditions = data.conditions;

      const updated = await prisma.automationRule.update({
        where: { id: req.params.id },
        data: updateData,
        include: {
          template: {
            select: { id: true, name: true, subject: true, category: true },
          },
        },
      });

      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          userName: req.userRecord?.email,
          recordType: "AutomationRule",
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

// ─── DELETE /rules/:id — Delete rule ─────────────────────────────────────────

router.delete(
  "/rules/:id",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;

      const existing = await prisma.automationRule.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!existing) {
        throw appError("Rule not found", 404, "NOT_FOUND");
      }

      await prisma.automationRule.delete({
        where: { id: req.params.id },
      });

      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          userName: req.userRecord?.email,
          recordType: "AutomationRule",
          recordId: req.params.id,
          action: "DELETED",
        },
      });

      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

// ══════════════════════════════════════════════════════════════════════════════
// EMAIL TEMPLATES
// ══════════════════════════════════════════════════════════════════════════════

// ─── GET /templates — List all templates ─────────────────────────────────────

router.get(
  "/templates",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;

      const templates = await prisma.emailTemplate.findMany({
        where: { tenantId },
        orderBy: [{ isDefault: "desc" }, { category: "asc" }, { name: "asc" }],
      });

      res.json({ data: templates });
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /templates — Create custom template ────────────────────────────────

router.post(
  "/templates",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const data = CreateTemplateSchema.parse(req.body);

      const template = await prisma.emailTemplate.create({
        data: {
          tenantId,
          name: data.name,
          subject: data.subject,
          htmlBody: data.htmlBody,
          category: data.category,
          isDefault: false,
          variables: data.variables,
        },
      });

      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          userName: req.userRecord?.email,
          recordType: "EmailTemplate",
          recordId: template.id,
          action: "CREATED",
        },
      });

      res.status(201).json(template);
    } catch (err) {
      next(err);
    }
  },
);

// ─── PUT /templates/:id — Update template ────────────────────────────────────

router.put(
  "/templates/:id",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const data = UpdateTemplateSchema.parse(req.body);

      const existing = await prisma.emailTemplate.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!existing) {
        throw appError("Template not found", 404, "NOT_FOUND");
      }

      const updateData: Record<string, unknown> = {};
      if (data.name !== undefined) updateData.name = data.name;
      if (data.subject !== undefined) updateData.subject = data.subject;
      if (data.htmlBody !== undefined) updateData.htmlBody = data.htmlBody;
      if (data.category !== undefined) updateData.category = data.category;
      if (data.variables !== undefined) updateData.variables = data.variables;

      const updated = await prisma.emailTemplate.update({
        where: { id: req.params.id },
        data: updateData,
      });

      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          userName: req.userRecord?.email,
          recordType: "EmailTemplate",
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

// ─── DELETE /templates/:id — Delete custom template ──────────────────────────

router.delete(
  "/templates/:id",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;

      const existing = await prisma.emailTemplate.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!existing) {
        throw appError("Template not found", 404, "NOT_FOUND");
      }

      if (existing.isDefault) {
        throw appError(
          "Cannot delete a system default template",
          400,
          "CANNOT_DELETE_DEFAULT",
        );
      }

      // Check if any rules reference this template
      const ruleCount = await prisma.automationRule.count({
        where: { templateId: req.params.id, tenantId },
      });
      if (ruleCount > 0) {
        throw appError(
          `Template is used by ${ruleCount} automation rule(s). Remove those rules first.`,
          400,
          "TEMPLATE_IN_USE",
        );
      }

      await prisma.emailTemplate.delete({
        where: { id: req.params.id },
      });

      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          userName: req.userRecord?.email,
          recordType: "EmailTemplate",
          recordId: req.params.id,
          action: "DELETED",
        },
      });

      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /templates/:id/preview — Preview template with sample data ────────

router.post(
  "/templates/:id/preview",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;

      const template = await prisma.emailTemplate.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!template) {
        throw appError("Template not found", 404, "NOT_FOUND");
      }

      // Use provided trigger or infer from category
      const trigger = (req.body.trigger as AutomationTrigger) ?? "invoice_created";
      const customVariables = (req.body.variables as Record<string, string>) ?? {};

      const sampleData = getSampleDataForTrigger(trigger);
      const mergedVars = { ...sampleData, ...customVariables };

      const previewSubject = mergeTemplate(template.subject, mergedVars);
      const previewHtml = mergeTemplate(template.htmlBody, mergedVars);

      res.json({
        subject: previewSubject,
        html: previewHtml,
        variables: mergedVars,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /templates/:id/variables — Get merge variables ──────────────────────

router.get(
  "/templates/:id/variables",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;

      const template = await prisma.emailTemplate.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!template) {
        throw appError("Template not found", 404, "NOT_FOUND");
      }

      // Collect all available variables from all triggers of the same category
      const categoryTriggers = TRIGGER_METADATA.filter(
        (t) => t.category === template.category || template.category === "custom",
      );

      const allVars = new Set<string>();
      for (const t of categoryTriggers) {
        for (const v of t.availableVariables) {
          allVars.add(v);
        }
      }

      // Always include common variables
      allVars.add("customerName");
      allVars.add("customerEmail");
      allVars.add("marinaName");
      allVars.add("portalUrl");

      res.json({
        variables: Array.from(allVars).sort(),
        templateVariables: template.variables,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ══════════════════════════════════════════════════════════════════════════════
// LOGS
// ══════════════════════════════════════════════════════════════════════════════

router.get(
  "/logs",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const query = ListLogsQuerySchema.parse(req.query);

      const where: Record<string, unknown> = { tenantId };

      if (query.status) where.status = query.status;

      if (query.from || query.to) {
        const dateFilter: Record<string, Date> = {};
        if (query.from) dateFilter.gte = query.from;
        if (query.to) dateFilter.lte = query.to;
        where.createdAt = dateFilter;
      }

      const [logs, total] = await Promise.all([
        prisma.emailAutomationLog.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: query.skip,
          take: query.take,
        }),
        prisma.emailAutomationLog.count({ where }),
      ]);

      res.json({
        data: logs,
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

export default router;
