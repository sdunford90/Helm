import type { PrismaClient } from '@prisma/client';

export async function seedOperations(prisma: PrismaClient, tenantId: string, users: any[], slips: any[], customers?: any[]) {
  await prisma.dockWalkItem.deleteMany({ where: { dockWalk: { tenantId } } });
  await prisma.dockWalk.deleteMany({ where: { tenantId } });
  await prisma.pumpOut.deleteMany({ where: { tenantId } });
  await prisma.announcementDelivery.deleteMany({ where: { announcement: { tenantId } } });
  await prisma.announcement.deleteMany({ where: { tenantId } });
  await prisma.rampTicket.deleteMany({ where: { tenantId } });
  await prisma.transientBooking.deleteMany({ where: { tenantId } });

  const dockStaff = users.filter((u: any) => ['DOCK_STAFF', 'MARINA_MANAGER'].includes(u.role));

  // ── Dock walks — last 8 days ──────────────────────────────────────────────
  const walks = await Promise.all([0, 1, 2, 3, 4, 5, 6, 7].map(async (dayBack) => {
    const d = new Date(2026, 3, 26 - dayBack, 7, 0);
    const inspector = dockStaff[dayBack % dockStaff.length];
    const dockLetter = dayBack % 3 === 0 ? 'A' : dayBack % 3 === 1 ? 'B' : 'C';
    const walk = await prisma.dockWalk.create({
      data: {
        tenantId,
        inspectorId: inspector.id,
        dockId: dockLetter,
        startedAt: d,
        completedAt: dayBack > 0 ? new Date(d.getTime() + (30 + dayBack * 5) * 60000) : null,
        status: dayBack > 0 ? 'COMPLETED' : 'IN_PROGRESS',
      },
    });

    const dockSlips = slips.filter((s: any) => s.dockId === dockLetter);
    for (const slip of dockSlips.slice(0, 6)) {
      const hasViolation = Math.random() < 0.15;
      await prisma.dockWalkItem.create({
        data: {
          dockWalkId: walk.id,
          slipId: slip.id,
          status: hasViolation ? 'VIOLATION' : 'OK',
          notes: hasViolation
            ? ['Shore power cord showing exposed insulation.', 'Port-side dock line frayed near cleat.', 'Oil sheen observed around vessel.', 'Fire extinguisher expired.'][Math.floor(Math.random() * 4)]
            : 'All clear',
          violationType: hasViolation
            ? ['SAFETY_HAZARD', 'LINE_CONDITION', 'ELECTRICAL', 'CLEANLINESS'][Math.floor(Math.random() * 4)]
            : null,
        },
      });
    }
    return walk;
  }));

  // ── Pump outs ─────────────────────────────────────────────────────────────
  const occupiedSlips = slips.filter((s: any) => s.status === 'OCCUPIED');
  await Promise.all([0, 2, 4, 6, 8, 10].map((dayBack, i) => {
    const d = new Date(2026, 3, 26 - dayBack, 10, 0);
    const staff = dockStaff[dayBack % dockStaff.length];
    const slip = occupiedSlips[i % occupiedSlips.length] ?? slips[0];
    return prisma.pumpOut.create({
      data: {
        tenantId,
        slipId: slip.id,
        staffId: staff.id,
        eventDate: d,
        gallons: Math.floor(Math.random() * 30) + 10,
        feeCents: 5000,
      },
    });
  }));

  // ── Announcements ─────────────────────────────────────────────────────────
  const announcements = await Promise.all([
    prisma.announcement.create({ data: { tenantId, subject: 'Weekend Marina Events — April 26-27', body: 'Join us for our spring boat show and BBQ this weekend. Live music, food trucks, and vendor exhibits from 10 AM to 6 PM.', audienceFilter: 'ALL', channels: 'BOTH', isEmergency: false, sentAt: new Date('2026-04-24'), staffId: users[0].id } }),
    prisma.announcement.create({ data: { tenantId, subject: 'Dock C Maintenance — April 28', body: 'Scheduled power maintenance on Dock C from 8 AM to 12 PM. Shore power will be temporarily unavailable during this window.', audienceFilter: 'DOCK_C', channels: 'BOTH', isEmergency: false, sentAt: new Date('2026-04-23'), staffId: users[1].id } }),
    prisma.announcement.create({ data: { tenantId, subject: 'Small Craft Advisory — Afternoon Storms', body: 'The National Weather Service has issued a small craft advisory for the Tampa Bay area from 2 PM to 8 PM today. Please secure your vessels and avoid open water.', audienceFilter: 'ALL', channels: 'BOTH', isEmergency: true, sentAt: new Date('2026-04-22'), staffId: users[0].id } }),
    prisma.announcement.create({ data: { tenantId, subject: 'New Fuel Pricing Effective May 1', body: 'Starting May 1, fuel prices will be updated to reflect current market rates. Regular: $4.39/gal, Premium: $4.89/gal, Diesel: $4.99/gal.', audienceFilter: 'ALL', channels: 'EMAIL', isEmergency: false, sentAt: new Date('2026-04-20'), staffId: users[0].id } }),
    prisma.announcement.create({ data: { tenantId, subject: 'Spring Insurance Renewal Reminder', body: 'Please ensure your vessel insurance is current. Upload your renewed certificate via the customer portal.', audienceFilter: 'SLIP_HOLDERS', channels: 'EMAIL', isEmergency: false, sentAt: new Date('2026-04-15'), staffId: users[0].id } }),
    prisma.announcement.create({ data: { tenantId, subject: 'Welcome to the 2026 Boating Season!', body: 'Spring is here! The marina office is now open extended hours (6 AM - 8 PM) through October. Fuel dock and ship store are fully stocked for the season.', audienceFilter: 'ALL', channels: 'BOTH', isEmergency: false, sentAt: new Date('2026-04-01'), staffId: users[0].id } }),
  ]);

  // ── Transient bookings ────────────────────────────────────────────────────
  const transientSlips = slips.filter((s: any) => s.transientCapable);
  const transientCustomers = customers ?? [];
  const transientData = [
    { daysBack: 0, nights: 2, guestName: 'James Harrington', boatName: 'Wanderer', length: 34 },
    { daysBack: 1, nights: 3, guestName: 'Cynthia Moore', boatName: 'Coastal Dream', length: 28 },
    { daysBack: 2, nights: 1, guestName: 'Ted Novak', boatName: 'Sea Hawk', length: 42 },
    { daysBack: 3, nights: 5, guestName: 'Barbara Klein', boatName: 'Moonrise', length: 38 },
    { daysBack: 0, nights: 1, guestName: 'Rick Sandoval', boatName: 'Blue Runner', length: 24 },
    { daysBack: 5, nights: 2, guestName: 'Pamela Torres', boatName: 'Serenity Now', length: 36 },
    { daysBack: 7, nights: 4, guestName: null, boatName: 'Island Hopper', length: 31, customerId: transientCustomers[0]?.id },
    { daysBack: 10, nights: 3, guestName: null, boatName: 'Tiderunner', length: 45, customerId: transientCustomers[1]?.id },
  ];
  await Promise.all(transientData.map((td, i) => {
    const slip = transientSlips[i % Math.max(transientSlips.length, 1)] ?? slips[0];
    const checkIn = new Date(2026, 3, 26 - td.daysBack);
    const checkOut = new Date(checkIn);
    checkOut.setDate(checkOut.getDate() + td.nights);
    const rateCents = 12500 + (td.length - 24) * 200;
    return prisma.transientBooking.create({
      data: {
        tenantId,
        slipId: slip.id,
        customerId: td.customerId ?? null,
        guestName: td.guestName,
        boatName: td.boatName,
        boatLengthFt: td.length,
        checkInDate: checkIn,
        checkOutDate: checkOut,
        nightlyRateCents: rateCents,
        totalCents: rateCents * td.nights,
        status: td.daysBack === 0 ? 'CHECKED_IN' : td.daysBack < 0 ? 'BOOKED' : 'CHECKED_OUT',
        staffId: dockStaff[0]?.id ?? null,
      },
    });
  }));

  // ── Ramp tickets ──────────────────────────────────────────────────────────
  const rampDays = [0, 0, 1, 1, 1, 2, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const rampTypes = ['SINGLE_LAUNCH', 'SINGLE_LAUNCH', 'SINGLE_LAUNCH', 'DAILY_PASS', 'SINGLE_LAUNCH', 'DAILY_PASS', 'SINGLE_LAUNCH', 'SINGLE_LAUNCH', 'DAILY_PASS', 'SEASONAL_PASS', 'SINGLE_LAUNCH', 'SEASONAL_PASS', 'SINGLE_LAUNCH', 'DAILY_PASS', 'SINGLE_LAUNCH'];
  const rampAmounts: Record<string, number> = { SINGLE_LAUNCH: 2500, DAILY_PASS: 4500, SEASONAL_PASS: 24900 };
  const rampGuests = ['Mike Donovan', 'Carol Simms', 'Guest', 'Frank Paulson', 'Guest', 'Rita Vance', 'Steve Hooper', 'Guest', 'Nancy Webb', 'Dave Kowalski', 'Guest', 'Jan Fisher', 'Guest', 'Carl Brooks', 'Amy Cole'];
  const rampPlates = ['ABC 1234', 'XYZ 9876', 'FL-1111', 'GA-2222', 'FL-3333', 'AL-4444', 'FL-5555', 'SC-6666', 'FL-7777', 'GA-8888', 'FL-9999', 'FL-0001', 'FL-0002', 'GA-0003', 'FL-0004'];
  await Promise.all(rampDays.map((daysBack, i) => {
    const d = new Date(2026, 3, 26 - daysBack, 7 + i % 8, 0);
    const ticketType = rampTypes[i] as 'SINGLE_LAUNCH' | 'DAILY_PASS' | 'SEASONAL_PASS';
    const cust = i < transientCustomers.length ? transientCustomers[i] : null;
    return prisma.rampTicket.create({
      data: {
        tenantId,
        ticketType,
        guestName: cust ? null : rampGuests[i],
        customerId: cust?.id ?? null,
        licensePlate: rampPlates[i],
        boatRegistration: `FL-${String(1000 + i).padStart(4, '0')}-AB`,
        amountCents: rampAmounts[ticketType],
        paymentMethod: (['CARD', 'CASH', 'CARD', 'CARD', 'CASH'] as const)[i % 5],
        createdAt: d,
      },
    });
  }));

  return { walks, announcements };
}
