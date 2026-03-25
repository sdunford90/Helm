import type { PrismaClient } from '@prisma/client';

export async function seedTiers(prisma: PrismaClient) {
  await prisma.saasTier.deleteMany();

  return Promise.all([
    prisma.saasTier.create({ data: { name: 'Starter', monthlyFeeCents: 29900, perLocationFeeCents: 0, achFeeRate: 0.008, cardFeeRate: 0.029, storageLimitGb: 5 } }),
    prisma.saasTier.create({ data: { name: 'Professional', monthlyFeeCents: 49900, perLocationFeeCents: 0, achFeeRate: 0.006, cardFeeRate: 0.025, storageLimitGb: 10 } }),
    prisma.saasTier.create({ data: { name: 'Enterprise', monthlyFeeCents: 99900, perLocationFeeCents: 0, achFeeRate: 0.004, cardFeeRate: 0.020, storageLimitGb: 50 } }),
  ]);
}
