import type { PrismaClient } from '@prisma/client';

export async function seedOperations(prisma: PrismaClient, tenantId: string, users: any[], slips: any[]) {
  await prisma.dockWalkItem.deleteMany({ where: { dockWalk: { tenantId } } });
  await prisma.dockWalk.deleteMany({ where: { tenantId } });
  await prisma.pumpOut.deleteMany({ where: { tenantId } });
  await prisma.announcementDelivery.deleteMany({ where: { announcement: { tenantId } } });
  await prisma.announcement.deleteMany({ where: { tenantId } });

  const dockStaff = users.filter((u: any) => ['DOCK_STAFF', 'MARINA_MANAGER'].includes(u.role));

  // Dock walks — last 8 days
  const walks = await Promise.all([0, 1, 2, 3, 4, 5, 6, 7].map(async (dayBack) => {
    const d = new Date(2026, 2, 25 - dayBack, 7, 0);
    const inspector = dockStaff[dayBack % dockStaff.length];
    const walk = await prisma.dockWalk.create({
      data: { tenantId, inspectorId: inspector.id, dockId: dayBack % 3 === 0 ? 'A' : dayBack % 3 === 1 ? 'B' : 'C', startedAt: d, completedAt: dayBack > 0 ? new Date(d.getTime() + 45 * 60000) : null, status: dayBack > 0 ? 'COMPLETED' : 'IN_PROGRESS' },
    });

    // Walk items for occupied slips in that dock
    const dockLetter = dayBack % 3 === 0 ? 'A' : dayBack % 3 === 1 ? 'B' : 'C';
    const dockSlips = slips.filter((s: any) => s.dockId === dockLetter);
    for (const slip of dockSlips.slice(0, 5)) {
      const hasViolation = Math.random() < 0.15;
      await prisma.dockWalkItem.create({
        data: {
          dockWalkId: walk.id, slipId: slip.id, status: hasViolation ? 'VIOLATION' : 'OK',
          notes: hasViolation ? 'See violation details' : 'All clear',
          violationType: hasViolation ? ['SAFETY_HAZARD', 'LINE_CONDITION', 'ELECTRICAL', 'CLEANLINESS'][Math.floor(Math.random() * 4)] : null,
        },
      });
    }
    return walk;
  }));

  // Pump outs
  await Promise.all([0, 2, 4, 6].map((dayBack) => {
    const d = new Date(2026, 2, 25 - dayBack, 10, 0);
    const staff = dockStaff[dayBack % dockStaff.length];
    const slip = slips.filter((s: any) => s.status === 'OCCUPIED')[dayBack % 5];
    return prisma.pumpOut.create({
      data: { tenantId, slipId: slip?.id || slips[0].id, staffId: staff.id, eventDate: d, gallons: Math.floor(Math.random() * 30) + 10, feeCents: 5000 },
    });
  }));

  // Announcements
  const announcements = await Promise.all([
    prisma.announcement.create({ data: { tenantId, subject: 'Weekend Marina Events — March 28-29', body: 'Join us for our spring boat show and BBQ this weekend. Live music, food trucks, and vendor exhibits from 10 AM to 6 PM.', audienceFilter: 'ALL', channels: 'BOTH', isEmergency: false, sentAt: new Date('2026-03-24'), staffId: users[0].id } }),
    prisma.announcement.create({ data: { tenantId, subject: 'Dock C Maintenance — March 26', body: 'Scheduled power maintenance on Dock C from 8 AM to 12 PM on March 26. Shore power will be temporarily unavailable during this window.', audienceFilter: 'DOCK_C', channels: 'BOTH', isEmergency: false, sentAt: new Date('2026-03-23'), staffId: users[1].id } }),
    prisma.announcement.create({ data: { tenantId, subject: 'Small Craft Advisory — Afternoon Storms', body: 'The National Weather Service has issued a small craft advisory for the Tampa Bay area from 2 PM to 8 PM today. Please secure your vessels and avoid open water.', audienceFilter: 'ALL', channels: 'BOTH', isEmergency: true, sentAt: new Date('2026-03-22'), staffId: users[0].id } }),
    prisma.announcement.create({ data: { tenantId, subject: 'New Fuel Pricing Effective April 1', body: 'Starting April 1, fuel prices will be updated to reflect current market rates. Regular: $4.39/gal, Premium: $4.89/gal, Diesel: $4.99/gal.', audienceFilter: 'ALL', channels: 'EMAIL', isEmergency: false, sentAt: new Date('2026-03-20'), staffId: users[0].id } }),
    prisma.announcement.create({ data: { tenantId, subject: 'Spring Insurance Renewal Reminder', body: 'Please ensure your vessel insurance is current. Upload your renewed certificate via the customer portal to keep your compliance status up to date.', audienceFilter: 'SLIP_HOLDERS', channels: 'EMAIL', isEmergency: false, sentAt: new Date('2026-03-15'), staffId: users[0].id } }),
    prisma.announcement.create({ data: { tenantId, subject: 'Welcome to the 2026 Boating Season!', body: 'Spring is here! The marina office is now open extended hours (6 AM - 8 PM) through October. Fuel dock and ship store are fully stocked for the season.', audienceFilter: 'ALL', channels: 'BOTH', isEmergency: false, sentAt: new Date('2026-03-01'), staffId: users[0].id } }),
  ]);

  return { walks, announcements };
}
