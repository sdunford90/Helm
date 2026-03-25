import type { PrismaClient } from '@prisma/client';

export async function seedContracts(prisma: PrismaClient, tenantId: string, customers: any[], boats: any[], slips: any[]) {
  await prisma.securityDeposit.deleteMany({ where: { tenantId } });
  await prisma.slipContract.deleteMany({ where: { tenantId } });

  const occupied = slips.filter((s: any) => s.status === 'OCCUPIED');
  const contracts: any[] = [];

  const assignments = [
    { custIdx: 0, boatIdx: 0, slipIdx: 0, rate: 245000, cycle: 'MONTHLY', start: '2024-03-15', end: '2025-03-14', auto: true },
    { custIdx: 1, boatIdx: 1, slipIdx: 1, rate: 195000, cycle: 'MONTHLY', start: '2024-06-01', end: '2025-05-31', auto: true },
    { custIdx: 8, boatIdx: 8, slipIdx: 4, rate: 220000, cycle: 'QUARTERLY', start: '2025-01-01', end: '2026-12-31', auto: true },
    { custIdx: 7, boatIdx: 7, slipIdx: 5, rate: 185000, cycle: 'MONTHLY', start: '2025-08-01', end: '2026-07-31', auto: false },
    { custIdx: 13, boatIdx: 12, slipIdx: 6, rate: 245000, cycle: 'MONTHLY', start: '2025-06-01', end: '2026-05-31', auto: true },
    { custIdx: 2, boatIdx: 2, slipIdx: 8, rate: 420000, cycle: 'ANNUAL', start: '2024-01-05', end: '2027-01-04', auto: true },
    { custIdx: 5, boatIdx: 5, slipIdx: 10, rate: 380000, cycle: 'MONTHLY', start: '2025-06-01', end: '2026-05-31', auto: true },
    { custIdx: 6, boatIdx: 6, slipIdx: 11, rate: 450000, cycle: 'MONTHLY', start: '2025-03-01', end: '2026-02-28', auto: false, status: 'EXPIRING' },
    { custIdx: 4, boatIdx: 4, slipIdx: 12, rate: 350000, cycle: 'MONTHLY', start: '2025-09-01', end: '2026-08-31', auto: true },
    { custIdx: 3, boatIdx: 3, slipIdx: 14, rate: 120000, cycle: 'MONTHLY', start: '2025-04-01', end: '2025-10-31', auto: false },
    { custIdx: 10, boatIdx: 10, slipIdx: 15, rate: 110000, cycle: 'MONTHLY', start: '2025-07-01', end: '2026-06-30', auto: true },
    { custIdx: 11, boatIdx: 11, slipIdx: 17, rate: 135000, cycle: 'QUARTERLY', start: '2025-01-01', end: '2026-06-30', auto: true },
    { custIdx: 9, boatIdx: 9, slipIdx: 18, rate: 95000, cycle: 'MONTHLY', start: '2026-01-01', end: '2026-12-31', auto: false },
    { custIdx: 14, boatIdx: 13, slipIdx: 19, rate: 85000, cycle: 'MONTHLY', start: '2025-09-01', end: '2026-08-31', auto: true },
  ];

  for (const a of assignments) {
    const slip = slips[a.slipIdx];
    if (!slip) continue;
    const c = await prisma.slipContract.create({
      data: {
        tenantId,
        slipId: slip.id,
        customerId: customers[a.custIdx].id,
        boatId: boats[a.boatIdx]?.id,
        startDate: new Date(a.start),
        endDate: new Date(a.end),
        billingCycle: a.cycle as any,
        rateCents: a.rate,
        autoRenew: a.auto,
        status: (a as any).status || 'ACTIVE',
        securityDepositCents: a.rate,
      },
    });
    contracts.push(c);

    await prisma.securityDeposit.create({
      data: { tenantId, customerId: customers[a.custIdx].id, contractId: c.id, amountCents: a.rate, status: 'HELD' },
    });
  }

  return contracts;
}
