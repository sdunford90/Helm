// A12 — Platform Announcements service.
//
// Returns the active set of platform announcements for a given user, filtered
// by audience (ALL / TIER / ROLE) and excluding rows the user has already
// dismissed. Used by the tenant banner; the admin console hits the raw
// Prisma model.

import { prisma } from "../lib/prisma.js";

export interface AnnouncementForUser {
  id: string;
  severity: string;
  title: string;
  body: string;
  link: string | null;
  dismissable: boolean;
}

interface ResolveOptions {
  userId: string | null;
  tenantTierId: string | null;
  userRole: string | null;
}

export async function getActiveAnnouncementsForUser(
  opts: ResolveOptions,
): Promise<AnnouncementForUser[]> {
  const now = new Date();
  const rows = await prisma.platformAnnouncement.findMany({
    where: {
      startsAt: { lte: now },
      OR: [{ endsAt: null }, { endsAt: { gt: now } }],
    },
    orderBy: { startsAt: "desc" },
    take: 50,
  });

  const dismissedIds = opts.userId
    ? new Set(
        (
          await prisma.platformAnnouncementDismissal.findMany({
            where: { userId: opts.userId },
            select: { announcementId: true },
          })
        ).map((d) => d.announcementId),
      )
    : new Set<string>();

  const matchesAudience = (a: typeof rows[number]): boolean => {
    if (a.audience === "ALL") return true;
    if (a.audience === "TIER") return !!opts.tenantTierId && a.audienceValue === opts.tenantTierId;
    if (a.audience === "ROLE") return !!opts.userRole && a.audienceValue === opts.userRole;
    return false;
  };

  return rows
    .filter((a) => matchesAudience(a) && !dismissedIds.has(a.id))
    .map((a) => ({
      id: a.id,
      severity: a.severity,
      title: a.title,
      body: a.body,
      link: a.link,
      dismissable: a.dismissable,
    }));
}

export async function dismissAnnouncement(announcementId: string, userId: string): Promise<void> {
  // Upsert so a repeat-dismiss doesn't error (the unique index would
  // otherwise reject).
  await prisma.platformAnnouncementDismissal.upsert({
    where: { announcementId_userId: { announcementId, userId } },
    create: { announcementId, userId },
    update: { dismissedAt: new Date() },
  });
}
