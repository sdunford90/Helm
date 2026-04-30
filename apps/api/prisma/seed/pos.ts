import type { PrismaClient, Location, ProductCategory } from '@prisma/client';

export async function seedPosAndInventory(
  prisma: PrismaClient,
  tenantId: string,
  users: any[],
  locations: Location[],
  categories: Record<string, ProductCategory>,
) {
  await prisma.posLineItem.deleteMany({ where: { transaction: { tenantId } } });
  await prisma.posTransaction.deleteMany({ where: { tenantId } });
  await prisma.shift.deleteMany({ where: { tenantId } });
  await prisma.inventory.deleteMany({ where: { tenantId } });
  await prisma.product.deleteMany({ where: { tenantId } });

  const mainId = locations[0]?.id;

  const fuelCat = categories['Fuel'].id;
  const baitCat = categories['Bait & Tackle'].id;
  const convCat = categories['Convenience'].id;
  const hardwareCat = categories['Marine Hardware'].id;
  const apparelCat = categories['Apparel'].id;

  const productSeeds = [
    { name: 'Regular Gas (gal)',     sku: 'FUEL-REG', barcode: '0012345000012', costCents: 365,  priceCents: 429,  taxClass: 'EXEMPT',   reorderQty: 500, productCategoryId: fuelCat },
    { name: 'Diesel (gal)',          sku: 'FUEL-DSL', barcode: '0012345000029', costCents: 410,  priceCents: 489,  taxClass: 'EXEMPT',   reorderQty: 400, productCategoryId: fuelCat },
    { name: 'Premium Gas (gal)',     sku: 'FUEL-PRM', barcode: '0012345000036', costCents: 408,  priceCents: 479,  taxClass: 'EXEMPT',   reorderQty: 300, productCategoryId: fuelCat },
    { name: 'Bag of Ice (10lb)',     sku: 'ICE-10LB', barcode: '0012345000043', costCents: 199,  priceCents: 399,  taxClass: 'STANDARD', reorderQty: 20,  productCategoryId: convCat },
    { name: 'Live Shrimp (dz)',      sku: 'BAIT-SHP', barcode: '0012345000050', costCents: 499,  priceCents: 899,  taxClass: 'STANDARD', reorderQty: 10,  productCategoryId: baitCat },
    { name: 'Bottled Water',         sku: 'SNK-WTR',  barcode: '0012345000074', costCents: 89,   priceCents: 249,  taxClass: 'STANDARD', reorderQty: 48,  productCategoryId: convCat },
    { name: 'Sunscreen SPF 50',      sku: 'SUN-SPF',  barcode: '0012345000098', costCents: 699,  priceCents: 1299, taxClass: 'STANDARD', reorderQty: 10,  productCategoryId: convCat },
    { name: 'Dock Line 3/8" 15\'',   sku: 'MRN-LINE', barcode: '0012345000104', costCents: 999,  priceCents: 1899, taxClass: 'STANDARD', reorderQty: 5,   productCategoryId: hardwareCat },
    { name: 'Marina Cap',            sku: 'APR-HAT',  barcode: '0012345000128', costCents: 800,  priceCents: 2200, taxClass: 'STANDARD', reorderQty: 12,  productCategoryId: apparelCat },
    { name: 'Marina T-Shirt',        sku: 'APR-TEE',  barcode: '0012345000135', costCents: 1000, priceCents: 2800, taxClass: 'STANDARD', reorderQty: 10,  productCategoryId: apparelCat },
  ];

  const products = await Promise.all(
    productSeeds.map((p) =>
      prisma.product.create({
        data: { tenantId, trackInventory: true, ...p },
      }),
    ),
  );

  // Inventory levels (assigned to Main Marina location)
  const qtyMap = [2400, 1800, 1200, 85, 24, 144, 32, 15, 48, 36];
  await Promise.all(products.map((p, i) => prisma.inventory.create({ data: { tenantId, locationId: mainId, productId: p.id, qtyOnHand: qtyMap[i], qtyOnOrder: 0 } })));

  // Shifts + transactions (all at Main Marina)
  const cashier = users.find((u: any) => u.role === 'POS_CASHIER') || users[0];
  const shifts = await Promise.all([0, 1, 2, 3, 4].map((dayBack) => {
    const d = new Date(2026, 2, 25 - dayBack, 8, 0);
    return prisma.shift.create({
      data: {
        tenantId,
        locationId: mainId,
        cashierId: cashier.id,
        openedAt: d,
        closedAt: dayBack > 0 ? new Date(d.getTime() + 10 * 3600000) : null,
        openingFloatCents: 10000,
        closingCashCents: dayBack > 0 ? 15000 + Math.floor(Math.random() * 5000) : 0,
        tipTotalCents: Math.floor(Math.random() * 3000),
        status: dayBack > 0 ? 'CLOSED' : 'OPEN',
      },
    });
  }));

  const transactions: any[] = [];
  for (let i = 0; i < 15; i++) {
    const dayBack = Math.floor(i / 3);
    const d = new Date(2026, 2, 25 - dayBack, 9 + (i % 8), Math.floor(Math.random() * 60));
    const p1 = products[Math.floor(Math.random() * products.length)];
    const qty = p1.sku!.startsWith('FUEL') ? Math.floor(Math.random() * 40) + 10 : Math.floor(Math.random() * 3) + 1;
    const sub = p1.priceCents * qty;
    const tax = p1.taxClass === 'STANDARD' ? Math.round(sub * 0.07) : 0;
    const tip = Math.random() > 0.7 ? Math.floor(Math.random() * 500) + 100 : 0;

    const txn = await prisma.posTransaction.create({
      data: {
        tenantId,
        cashierId: cashier.id,
        shiftId: shifts[dayBack]?.id,
        subtotalCents: sub,
        taxCents: tax,
        tipCents: tip,
        totalCents: sub + tax + tip,
        status: 'COMPLETED',
        createdAt: d,
      },
    });
    await prisma.posLineItem.create({
      data: { transactionId: txn.id, productId: p1.id, quantity: qty, unitPriceCents: p1.priceCents, taxCents: tax, extendedCents: sub },
    });
    transactions.push(txn);
  }

  return { products, transactions };
}
