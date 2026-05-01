import type { PrismaClient, Location } from '@prisma/client';

export async function seedLeadsAndWaitlist(prisma: PrismaClient, tenantId: string, locations: Location[]) {
  await prisma.waitlistEntry.deleteMany({ where: { tenantId } });
  await prisma.lead.deleteMany({ where: { tenantId } });

  const mainId = locations[0]?.id;          // Sunset Harbor
  const pelicanCoveId = locations[1]?.id ?? mainId; // Pelican Cove

  const leads = await Promise.all([
    prisma.lead.create({ data: { tenantId, locationId: mainId, firstName: 'Alex', lastName: 'Thompson', email: 'alex.t@email.com', phone: '9415551101', stage: 'NEW', source: 'WEBSITE', utmSource: 'google', utmMedium: 'cpc' } }),
    prisma.lead.create({ data: { tenantId, locationId: mainId, firstName: 'Jennifer', lastName: 'Walsh', email: 'jennifer.w@email.com', phone: '9415551102', stage: 'NEW', source: 'REFERRAL' } }),
    prisma.lead.create({ data: { tenantId, locationId: pelicanCoveId, firstName: 'Marcus', lastName: 'Bell', email: 'marcus.b@email.com', phone: '9415551103', stage: 'NEW', source: 'WALK_IN', boatLength: 35 } }),
    prisma.lead.create({ data: { tenantId, locationId: mainId, firstName: 'Diana', lastName: 'Foster', email: 'diana.f@email.com', phone: '9415551104', stage: 'CONTACTED', source: 'PHONE', boatLength: 42 } }),
    prisma.lead.create({ data: { tenantId, locationId: mainId, firstName: 'Steven', lastName: 'Park', email: 'steven.p@email.com', phone: '9415551105', stage: 'CONTACTED', source: 'REFERRAL', referralCode: 'BROKER-JONES' } }),
    prisma.lead.create({ data: { tenantId, locationId: pelicanCoveId, firstName: 'Rachel', lastName: 'Kim', email: 'rachel.k@email.com', phone: '9415551106', stage: 'QUALIFIED', source: 'WEBSITE', boatLength: 28, slipType: '30ft Open' } }),
    prisma.lead.create({ data: { tenantId, locationId: mainId, firstName: 'Brian', lastName: 'Cooper', email: 'brian.c@email.com', phone: '9415551107', stage: 'QUALIFIED', source: 'EMAIL', boatLength: 40, slipType: '40ft Covered' } }),
    prisma.lead.create({ data: { tenantId, locationId: mainId, firstName: 'Laura', lastName: 'Hughes', email: 'laura.h@email.com', phone: '9415551108', stage: 'PROPOSAL_SENT', source: 'WEBSITE', boatLength: 38 } }),
    prisma.lead.create({ data: { tenantId, locationId: mainId, firstName: 'Kevin', lastName: "O'Brien", email: 'kevin.ob@email.com', phone: '9415551109', stage: 'WON', source: 'REFERRAL', boatLength: 32, convertedAt: new Date('2026-03-10') } }),
    prisma.lead.create({ data: { tenantId, locationId: mainId, firstName: 'George', lastName: 'Martin', email: 'george.m@email.com', phone: '9415551110', stage: 'LOST', source: 'WEBSITE', lostReason: 'Price too high' } }),
    prisma.lead.create({ data: { tenantId, locationId: pelicanCoveId, firstName: 'Sandra', lastName: 'White', email: 'sandra.w@email.com', phone: '9415551111', stage: 'LOST', source: 'SOCIAL_MEDIA', lostReason: 'Chose competitor' } }),
  ]);

  const waitlist = await Promise.all([
    prisma.waitlistEntry.create({ data: { tenantId, locationId: mainId, slipType: '40ft Covered', boatLength: 38, status: 'WAITING', queuePosition: 1 } }),
    prisma.waitlistEntry.create({ data: { tenantId, locationId: mainId, slipType: '30ft Open', boatLength: 28, status: 'WAITING', queuePosition: 2 } }),
    prisma.waitlistEntry.create({ data: { tenantId, locationId: pelicanCoveId, slipType: '40ft Covered', boatLength: 42, status: 'WAITING', queuePosition: 1 } }),
    prisma.waitlistEntry.create({ data: { tenantId, locationId: mainId, slipType: '30ft Open', boatLength: 30, status: 'NOTIFIED', queuePosition: 3 } }),
    prisma.waitlistEntry.create({ data: { tenantId, locationId: pelicanCoveId, slipType: '30ft Open', boatLength: 26, status: 'ACCEPTED', queuePosition: 0 } }),
  ]);

  return { leads, waitlist };
}
