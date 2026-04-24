import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { clerkAuth } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { queues } from "../lib/queue.js";

const router: Router = Router();

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

const ChannelEnum = z.enum(["EMAIL", "SMS", "BOTH"]);
const AudienceEnum = z.enum([
  "all",
  "active_customers",
  "slip_holders",
  "waitlist",
  "custom",
]);

const CreateAnnouncementSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1),
  channel: ChannelEnum.default("EMAIL"),
  audience: AudienceEnum.default("all"),
  scheduledAt: z.coerce.date().optional().nullable(),
  customRecipientIds: z.array(z.string().uuid()).optional(),
});

const UpdateAnnouncementSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  body: z.string().min(1).optional(),
  channel: ChannelEnum.optional(),
  audience: AudienceEnum.optional(),
  scheduledAt: z.coerce.date().optional().nullable(),
  customRecipientIds: z.array(z.string().uuid()).optional(),
});

const ListAnnouncementsQuerySchema = z.object({
  channel: ChannelEnum.optional(),
  status: z.enum(["DRAFT", "SCHEDULED", "SENDING", "SENT", "CANCELLED"]).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  skip: z.coerce.number().int().min(0).default(0),
  take: z.coerce.number().int().positive().max(100).default(25),
});

const DeliveriesQuerySchema = z.object({
  status: z.enum(["PENDING", "SENT", "DELIVERED", "FAILED", "OPENED"]).optional(),
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

/**
 * Resolve the list of customer IDs for a given audience filter.
 */
async function resolveRecipients(
  tenantId: string,
  audience: string,
  customRecipientIds?: string[],
): Promise<{ id: string; email: string | null; phone: string | null }[]> {
  if (audience === "custom" && customRecipientIds?.length) {
    return prisma.customer.findMany({
      where: { tenantId, id: { in: customRecipientIds }, status: { not: "INACTIVE" } },
      select: { id: true, email: true, phone: true },
    });
  }

  const baseWhere: Record<string, unknown> = { tenantId };

  switch (audience) {
    case "active_customers":
      baseWhere.status = "ACTIVE";
      break;
    case "slip_holders":
      baseWhere.slipContracts = { some: { status: "ACTIVE" } };
      break;
    case "waitlist":
      baseWhere.status = "WAITLIST";
      break;
    case "all":
    default:
      baseWhere.status = { not: "INACTIVE" };
      break;
  }

  return prisma.customer.findMany({
    where: baseWhere,
    select: { id: true, email: true, phone: true },
  });
}

// ─── Authenticated routes ───────────────────────────────────────────────────

router.use(...clerkAuth());

// ─── GET / — List announcements ─────────────────────────────────────────────

router.get(
  "/",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const query = ListAnnouncementsQuerySchema.parse(req.query);

      const where: Record<string, unknown> = { tenantId };

      if (query.channel) where.channels = query.channel;

      if (query.status) {
        // Map status to query conditions
        switch (query.status) {
          case "DRAFT":
            where.sentAt = null;
            where.scheduledAt = null;
            break;
          case "SCHEDULED":
            where.sentAt = null;
            where.scheduledAt = { not: null };
            break;
          case "SENDING":
            // Announcements that have been triggered but deliveries are still pending
            where.sentAt = { not: null };
            where.deliveries = { some: { status: "PENDING" } };
            break;
          case "SENT":
            where.sentAt = { not: null };
            break;
          case "CANCELLED":
            // No explicit cancel field in schema — skip for now
            break;
        }
      }

      if (query.from || query.to) {
        const dateFilter: Record<string, Date> = {};
        if (query.from) dateFilter.gte = query.from;
        if (query.to) dateFilter.lte = query.to;
        where.createdAt = dateFilter;
      }

      const [announcements, total] = await Promise.all([
        prisma.announcement.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: query.skip,
          take: query.take,
          include: {
            _count: {
              select: { deliveries: true },
            },
          },
        }),
        prisma.announcement.count({ where }),
      ]);

      // Enrich with delivery stats
      const enriched = await Promise.all(
        announcements.map(async (a) => {
          const stats = await prisma.announcementDelivery.groupBy({
            by: ["status"],
            _count: { id: true },
            where: { announcementId: a.id },
          });

          const statusCounts: Record<string, number> = {};
          for (const s of stats) {
            statusCounts[s.status] = s._count.id;
          }

          const recipientCount = a._count.deliveries;
          const sent = (statusCounts.SENT ?? 0) + (statusCounts.DELIVERED ?? 0) + (statusCounts.OPENED ?? 0);
          const delivered = (statusCounts.DELIVERED ?? 0) + (statusCounts.OPENED ?? 0);
          const opened = statusCounts.OPENED ?? 0;

          // Derive status
          let status: string;
          if (a.sentAt) {
            status = "SENT";
          } else if (a.scheduledAt) {
            status = "SCHEDULED";
          } else {
            status = "DRAFT";
          }

          return {
            ...a,
            status,
            recipientCount,
            deliveryStats: {
              sent,
              delivered,
              failed: statusCounts.FAILED ?? 0,
              opened,
              pending: statusCounts.PENDING ?? 0,
            },
            deliveryRate: recipientCount > 0 ? Math.round((delivered / recipientCount) * 100) : 0,
            openRate: recipientCount > 0 ? Math.round((opened / recipientCount) * 100) : 0,
          };
        }),
      );

      res.json({
        data: enriched,
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

// ─── GET /stats — Summary stats ─────────────────────────────────────────────

router.get(
  "/stats",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      const [totalSentThisMonth, totalDeliveries, totalOpened, scheduledCount] =
        await Promise.all([
          prisma.announcement.count({
            where: { tenantId, sentAt: { not: null, gte: startOfMonth } },
          }),
          prisma.announcementDelivery.count({
            where: {
              announcement: { tenantId },
              status: { in: ["SENT", "DELIVERED", "OPENED"] },
            },
          }),
          prisma.announcementDelivery.count({
            where: {
              announcement: { tenantId },
              status: "OPENED",
            },
          }),
          prisma.announcement.count({
            where: { tenantId, sentAt: null, scheduledAt: { not: null } },
          }),
        ]);

      const totalRecipients = await prisma.announcementDelivery.count({
        where: { announcement: { tenantId } },
      });

      res.json({
        totalSentThisMonth,
        deliveryRate: totalRecipients > 0 ? Math.round((totalDeliveries / totalRecipients) * 100) : 0,
        openRate: totalRecipients > 0 ? Math.round((totalOpened / totalRecipients) * 100) : 0,
        scheduledCount,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /:id — Single announcement with delivery stats ─────────────────────

router.get(
  "/:id",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;

      const announcement = await prisma.announcement.findFirst({
        where: { id: req.params.id, tenantId },
        include: {
          deliveries: {
            include: {
              customer: {
                select: { id: true, firstName: true, lastName: true, email: true, phone: true },
              },
            },
          },
        },
      });

      if (!announcement) {
        throw appError("Announcement not found", 404, "NOT_FOUND");
      }

      // Compute stats
      const stats = { sent: 0, delivered: 0, failed: 0, opened: 0, pending: 0 };
      for (const d of announcement.deliveries) {
        switch (d.status) {
          case "SENT":
            stats.sent++;
            break;
          case "DELIVERED":
            stats.delivered++;
            break;
          case "FAILED":
            stats.failed++;
            break;
          case "OPENED":
            stats.opened++;
            break;
          case "PENDING":
            stats.pending++;
            break;
        }
      }

      const recipientCount = announcement.deliveries.length;

      let status: string;
      if (announcement.sentAt) {
        status = "SENT";
      } else if (announcement.scheduledAt) {
        status = "SCHEDULED";
      } else {
        status = "DRAFT";
      }

      res.json({
        ...announcement,
        status,
        recipientCount,
        deliveryStats: stats,
        deliveryRate: recipientCount > 0 ? Math.round(((stats.delivered + stats.opened) / recipientCount) * 100) : 0,
        openRate: recipientCount > 0 ? Math.round((stats.opened / recipientCount) * 100) : 0,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST / — Create announcement ──────────────────────────────────────────

router.post(
  "/",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const data = CreateAnnouncementSchema.parse(req.body);

      const announcement = await prisma.announcement.create({
        data: {
          tenantId,
          subject: data.title,
          body: data.body,
          channels: data.channel,
          audienceFilter: {
            audience: data.audience,
            customRecipientIds: data.customRecipientIds ?? [],
          },
          scheduledAt: data.scheduledAt ?? null,
          staffId: req.userId ?? null,
        },
      });

      // If scheduled, we leave it as-is — a scheduler worker will pick it up.
      // If not scheduled and no scheduledAt, queue immediately.
      if (!data.scheduledAt) {
        // Resolve recipients and queue
        const recipients = await resolveRecipients(
          tenantId,
          data.audience,
          data.customRecipientIds,
        );

        if (recipients.length > 0) {
          // Create delivery records
          const deliveryData = [];
          for (const recipient of recipients) {
            const channels =
              data.channel === "BOTH" ? ["EMAIL", "SMS"] : [data.channel];
            for (const ch of channels) {
              deliveryData.push({
                announcementId: announcement.id,
                customerId: recipient.id,
                channel: ch,
                status: "PENDING" as const,
              });
            }
          }

          await prisma.announcementDelivery.createMany({ data: deliveryData });

          // Queue jobs
          for (const recipient of recipients) {
            if (data.channel === "EMAIL" || data.channel === "BOTH") {
              if (recipient.email) {
                await queues.email.add("announcement-email", {
                  announcementId: announcement.id,
                  customerId: recipient.id,
                  email: recipient.email,
                  subject: data.title,
                  body: data.body,
                  tenantId,
                });
              }
            }
            if (data.channel === "SMS" || data.channel === "BOTH") {
              if (recipient.phone) {
                await queues.sms.add("announcement-sms", {
                  announcementId: announcement.id,
                  customerId: recipient.id,
                  phone: recipient.phone,
                  body: data.body,
                  tenantId,
                });
              }
            }
          }

          // Mark as sent
          await prisma.announcement.update({
            where: { id: announcement.id },
            data: { sentAt: new Date() },
          });
        }
      }

      const result = await prisma.announcement.findFirst({
        where: { id: announcement.id, tenantId },
        include: { _count: { select: { deliveries: true } } },
      });

      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          userName: req.userRecord?.email,
          recordType: "Announcement",
          recordId: announcement.id,
          action: "CREATED",
        },
      });

      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
);

// ─── PUT /:id — Update draft announcement ──────────────────────────────────

router.put(
  "/:id",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const data = UpdateAnnouncementSchema.parse(req.body);

      const existing = await prisma.announcement.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!existing) {
        throw appError("Announcement not found", 404, "NOT_FOUND");
      }
      if (existing.sentAt) {
        throw appError("Cannot update a sent announcement", 400, "ALREADY_SENT");
      }

      const updateData: Record<string, unknown> = {};
      if (data.title !== undefined) updateData.subject = data.title;
      if (data.body !== undefined) updateData.body = data.body;
      if (data.channel !== undefined) updateData.channels = data.channel;
      if (data.scheduledAt !== undefined) updateData.scheduledAt = data.scheduledAt;
      if (data.audience !== undefined || data.customRecipientIds !== undefined) {
        const currentFilter = (existing.audienceFilter as Record<string, unknown>) ?? {};
        updateData.audienceFilter = {
          ...currentFilter,
          ...(data.audience !== undefined ? { audience: data.audience } : {}),
          ...(data.customRecipientIds !== undefined
            ? { customRecipientIds: data.customRecipientIds }
            : {}),
        };
      }

      const updated = await prisma.announcement.update({
        where: { id: req.params.id },
        data: updateData,
      });

      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          recordType: "Announcement",
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

// ─── DELETE /:id — Delete draft only ────────────────────────────────────────

router.delete(
  "/:id",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;

      const existing = await prisma.announcement.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!existing) {
        throw appError("Announcement not found", 404, "NOT_FOUND");
      }
      if (existing.sentAt) {
        throw appError("Cannot delete a sent announcement", 400, "ALREADY_SENT");
      }

      // Delete any pending delivery records first
      await prisma.announcementDelivery.deleteMany({
        where: { announcementId: req.params.id },
      });

      await prisma.announcement.delete({
        where: { id: req.params.id },
      });

      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          recordType: "Announcement",
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

// ─── POST /:id/send — Queue for immediate sending ──────────────────────────

router.post(
  "/:id/send",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;

      const announcement = await prisma.announcement.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!announcement) {
        throw appError("Announcement not found", 404, "NOT_FOUND");
      }
      if (announcement.sentAt) {
        throw appError("Announcement has already been sent", 400, "ALREADY_SENT");
      }

      const filter = (announcement.audienceFilter as Record<string, unknown>) ?? {};
      const audience = (filter.audience as string) ?? "all";
      const customIds = (filter.customRecipientIds as string[]) ?? [];

      const recipients = await resolveRecipients(tenantId, audience, customIds);

      if (recipients.length === 0) {
        throw appError("No recipients found for the selected audience", 400, "NO_RECIPIENTS");
      }

      // Create delivery records
      const channel = announcement.channels as string;
      const deliveryData = [];
      for (const recipient of recipients) {
        const channels = channel === "BOTH" ? ["EMAIL", "SMS"] : [channel];
        for (const ch of channels) {
          deliveryData.push({
            announcementId: announcement.id,
            customerId: recipient.id,
            channel: ch,
            status: "PENDING" as const,
          });
        }
      }

      await prisma.announcementDelivery.createMany({ data: deliveryData });

      // Queue jobs
      for (const recipient of recipients) {
        if (channel === "EMAIL" || channel === "BOTH") {
          if (recipient.email) {
            await queues.email.add("announcement-email", {
              announcementId: announcement.id,
              customerId: recipient.id,
              email: recipient.email,
              subject: announcement.subject,
              body: announcement.body,
              tenantId,
            });
          }
        }
        if (channel === "SMS" || channel === "BOTH") {
          if (recipient.phone) {
            await queues.sms.add("announcement-sms", {
              announcementId: announcement.id,
              customerId: recipient.id,
              phone: recipient.phone,
              body: announcement.body,
              tenantId,
            });
          }
        }
      }

      // Mark as sent
      const updated = await prisma.announcement.update({
        where: { id: announcement.id },
        data: { sentAt: new Date() },
      });

      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          recordType: "Announcement",
          recordId: announcement.id,
          action: "SENT",
          changedFieldsJson: { recipientCount: recipients.length },
        },
      });

      res.json({
        ...updated,
        recipientCount: deliveryData.length,
        status: "SENT",
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /:id/deliveries — List delivery records ───────────────────────────

router.get(
  "/:id/deliveries",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;
      const query = DeliveriesQuerySchema.parse(req.query);

      // Verify the announcement belongs to this tenant
      const announcement = await prisma.announcement.findFirst({
        where: { id: req.params.id, tenantId },
        select: { id: true },
      });
      if (!announcement) {
        throw appError("Announcement not found", 404, "NOT_FOUND");
      }

      const where: Record<string, unknown> = {
        announcementId: req.params.id,
      };
      if (query.status) where.status = query.status;

      const [deliveries, total] = await Promise.all([
        prisma.announcementDelivery.findMany({
          where,
          skip: query.skip,
          take: query.take,
          include: {
            customer: {
              select: { id: true, firstName: true, lastName: true, email: true, phone: true },
            },
          },
        }),
        prisma.announcementDelivery.count({ where }),
      ]);

      res.json({
        data: deliveries,
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

// ─── POST /:id/duplicate — Clone an announcement as draft ──────────────────

router.post(
  "/:id/duplicate",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId!;

      const original = await prisma.announcement.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!original) {
        throw appError("Announcement not found", 404, "NOT_FOUND");
      }

      const duplicate = await prisma.announcement.create({
        data: {
          tenantId,
          subject: `${original.subject} (Copy)`,
          body: original.body,
          channels: original.channels,
          audienceFilter: original.audienceFilter ?? undefined,
          isEmergency: original.isEmergency,
          staffId: req.userId ?? null,
          // sentAt and scheduledAt intentionally omitted — new draft
        },
      });

      await prisma.auditLog.create({
        data: {
          tenantId,
          userId: req.userId,
          recordType: "Announcement",
          recordId: duplicate.id,
          action: "CREATED",
          changedFieldsJson: { duplicatedFrom: original.id },
        },
      });

      res.status(201).json(duplicate);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
