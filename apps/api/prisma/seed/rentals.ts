import type { PrismaClient } from '@prisma/client';

export async function seedRentals(prisma: PrismaClient, tenantId: string, customers: any[]) {
  await prisma.reservation.deleteMany({ where: { tenantId } });
  await prisma.pricingRule.deleteMany({ where: { rentalProduct: { tenantId } } });
  await prisma.rentalProduct.deleteMany({ where: { tenantId } });

  const products = await Promise.all([
    prisma.rentalProduct.create({ data: { tenantId, name: 'Bay Cruiser 24', description: '24ft pontoon boat, perfect for families', durationType: 'HOURLY', basePriceCents: 8500, floorPriceCents: 6000, ceilingPriceCents: 15000, damageWaiverCents: 2500, depositCents: 50000, active: true } }),
    prisma.rentalProduct.create({ data: { tenantId, name: 'Wave Runner Pro', description: 'High-performance jet ski', durationType: 'HOURLY', basePriceCents: 6500, floorPriceCents: 4500, ceilingPriceCents: 12000, damageWaiverCents: 1500, depositCents: 30000, active: true } }),
    prisma.rentalProduct.create({ data: { tenantId, name: 'Harbor Explorer', description: 'Tandem kayak for harbor touring', durationType: 'HOURLY', basePriceCents: 2500, floorPriceCents: 1500, ceilingPriceCents: 5000, damageWaiverCents: 0, depositCents: 0, active: true } }),
    prisma.rentalProduct.create({ data: { tenantId, name: 'Sunset Sailor 28', description: '28ft sailboat with full rigging', durationType: 'HOURLY', basePriceCents: 9500, floorPriceCents: 7000, ceilingPriceCents: 18000, damageWaiverCents: 3500, depositCents: 75000, active: true } }),
    prisma.rentalProduct.create({ data: { tenantId, name: 'Fishing Charter 30', description: '30ft center console with fishing gear', durationType: 'HOURLY', basePriceCents: 12000, floorPriceCents: 9000, ceilingPriceCents: 20000, damageWaiverCents: 3000, depositCents: 60000, active: true } }),
    prisma.rentalProduct.create({ data: { tenantId, name: 'Family Pontoon 28', description: 'Large pontoon for groups up to 12', durationType: 'HOURLY', basePriceCents: 11000, floorPriceCents: 8000, ceilingPriceCents: 18000, damageWaiverCents: 2500, depositCents: 50000, active: true } }),
  ]);

  // Pricing rules
  await Promise.all([
    prisma.pricingRule.create({ data: { rentalProductId: products[0].id, ruleType: 'SEASONAL', value: 25, startDate: new Date('2026-06-01'), endDate: new Date('2026-09-01'), priority: 1 } }),
    prisma.pricingRule.create({ data: { rentalProductId: products[0].id, ruleType: 'PEAK_DAY', value: 15, startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31'), daysJson: [0, 6], priority: 2 } }),
    prisma.pricingRule.create({ data: { rentalProductId: products[1].id, ruleType: 'SEASONAL', value: 25, startDate: new Date('2026-06-01'), endDate: new Date('2026-09-01'), priority: 1 } }),
    prisma.pricingRule.create({ data: { rentalProductId: products[1].id, ruleType: 'LEAD_TIME', value: -10, startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31'), priority: 3 } }),
  ]);

  // Reservations
  const statuses = ['CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CONFIRMED', 'CONFIRMED', 'CANCELLED', 'CONFIRMED', 'CHECKED_OUT', 'NO_SHOW', 'CONFIRMED'] as const;
  const reservations = await Promise.all(statuses.map((status, i) => {
    const dayOffset = i < 5 ? i : -(i - 4);
    const startDt = new Date(2026, 2, 25 + dayOffset, 9, 0);
    const endDt = new Date(startDt); endDt.setHours(endDt.getHours() + 4);
    const product = products[i % products.length];
    const customer = customers[i % customers.length];
    return prisma.reservation.create({
      data: {
        tenantId, customerId: customer.id, rentalProductId: product.id,
        startDt, endDt, totalCents: product.basePriceCents * 4,
        status, waiverSelected: Math.random() > 0.3,
      },
    });
  }));

  return { products, reservations };
}
