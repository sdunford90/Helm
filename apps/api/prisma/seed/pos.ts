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
  await prisma.inventoryLot.deleteMany({ where: { tenantId } });
  await prisma.product.deleteMany({ where: { tenantId } });

  const mainId = locations[0]?.id;

  const fuelCatId = categories['Fuel'].id;
  const shipStoreCatId = categories['Ship Store'].id;
  const servicesCatId = categories['Marine Services'].id;

  // ── Products ────────────────────────────────────────────────────────────────
  const productSeeds = [
    // Fuel
    { name: 'Regular Unleaded (gal)', sku: 'FUEL-REG', costCents: 320, priceCents: 450, taxClass: 'EXEMPT', reorderQty: 1000, productCategoryId: fuelCatId, trackInventory: true },
    { name: 'Premium Unleaded (gal)', sku: 'FUEL-PRM', costCents: 345, priceCents: 480, taxClass: 'EXEMPT', reorderQty: 500, productCategoryId: fuelCatId, trackInventory: true },
    { name: 'Diesel (gal)', sku: 'FUEL-DSL', costCents: 310, priceCents: 420, taxClass: 'EXEMPT', reorderQty: 2000, productCategoryId: fuelCatId, trackInventory: true },
    // Ship Store
    { name: 'Marine Rope 50ft', sku: 'SS-ROPE50', costCents: 1399, priceCents: 2499, taxClass: 'STANDARD', reorderQty: 10, productCategoryId: shipStoreCatId, trackInventory: true },
    { name: 'Dock Lines Set', sku: 'SS-DKLN', costCents: 2199, priceCents: 3999, taxClass: 'STANDARD', reorderQty: 10, productCategoryId: shipStoreCatId, trackInventory: true },
    { name: 'Boat Cleaner 32oz', sku: 'SS-CLNR', costCents: 799, priceCents: 1499, taxClass: 'STANDARD', reorderQty: 20, productCategoryId: shipStoreCatId, trackInventory: true },
    { name: 'Life Vest Adult', sku: 'SS-PFD', costCents: 2799, priceCents: 4999, taxClass: 'STANDARD', reorderQty: 12, productCategoryId: shipStoreCatId, trackInventory: true },
    { name: 'Sunscreen SPF50', sku: 'SS-SUN50', costCents: 699, priceCents: 1299, taxClass: 'STANDARD', reorderQty: 24, productCategoryId: shipStoreCatId, trackInventory: true },
    { name: 'Ice Bag 20lb', sku: 'SS-ICE20', costCents: 349, priceCents: 699, taxClass: 'STANDARD', reorderQty: 50, productCategoryId: shipStoreCatId, trackInventory: true },
    // Services (not tracked in inventory)
    { name: 'Bottom Paint (per ft)', sku: 'SVC-BPNT', costCents: 900, priceCents: 1800, taxClass: 'STANDARD', reorderQty: 0, productCategoryId: servicesCatId, trackInventory: false },
    { name: 'Engine Service', sku: 'SVC-ENG', costCents: 19500, priceCents: 35000, taxClass: 'STANDARD', reorderQty: 0, productCategoryId: servicesCatId, trackInventory: false },
    { name: 'Haul & Launch', sku: 'SVC-HAUL', costCents: 14000, priceCents: 25000, taxClass: 'STANDARD', reorderQty: 0, productCategoryId: servicesCatId, trackInventory: false },
  ];

  const products = await Promise.all(
    productSeeds.map((p) =>
      prisma.product.create({
        data: { tenantId, locationId: mainId, ...p },
      }),
    ),
  );

  // ── Inventory levels ────────────────────────────────────────────────────────
  // Fuel quantities and lots
  const fuelInventory = [
    { idx: 0, qty: 5000, avgCost: 320, lotQty: 5000 }, // Regular Unleaded
    { idx: 1, qty: 2000, avgCost: 345, lotQty: 2000 }, // Premium Unleaded
    { idx: 2, qty: 8000, avgCost: 310, lotQty: 8000 }, // Diesel
  ];

  // Ship store quantities (indices 3-8)
  const shipStoreInventory = [
    { idx: 3, qty: 25 },  // Marine Rope
    { idx: 4, qty: 30 },  // Dock Lines Set
    { idx: 5, qty: 48 },  // Boat Cleaner
    { idx: 6, qty: 20 },  // Life Vest
    { idx: 7, qty: 36 },  // Sunscreen
    { idx: 8, qty: 50 },  // Ice Bag
  ];

  // Create inventory records for all trackInventory products
  const inventoryEntries = [...fuelInventory.map(f => ({ idx: f.idx, qty: f.qty })), ...shipStoreInventory];
  await Promise.all(
    inventoryEntries.map(({ idx, qty }) =>
      prisma.inventory.create({
        data: {
          tenantId,
          locationId: mainId,
          productId: products[idx].id,
          qtyOnHand: qty,
          qtyOnOrder: 0,
          lastCountDate: new Date('2026-04-01'),
        },
      }),
    ),
  );

  // Create FIFO lots for fuel products
  for (const f of fuelInventory) {
    await prisma.inventoryLot.create({
      data: {
        tenantId,
        productId: products[f.idx].id,
        locationId: mainId!,
        qtyRemaining: f.lotQty,
        unitCostCents: f.avgCost,
        receivedAt: new Date('2026-04-01'),
      },
    });
  }

  // ── Shifts + POS Transactions ───────────────────────────────────────────────
  const cashier = users.find((u: any) => u.role === 'POS_CASHIER') || users[0];
  const shifts = await Promise.all(
    [0, 1, 2, 3, 4].map((dayBack) => {
      const d = new Date(2026, 3, 26 - dayBack, 8, 0); // April 22-26, 2026
      return prisma.shift.create({
        data: {
          tenantId,
          locationId: mainId,
          cashierId: cashier.id,
          openedAt: d,
          closedAt: dayBack > 0 ? new Date(d.getTime() + 10 * 3600000) : null,
          openingFloatCents: 10000,
          closingCashCents: dayBack > 0 ? 15000 + Math.floor(Math.random() * 5000) : 0,
          tipTotalCents: Math.floor(Math.random() * 2000),
          status: dayBack > 0 ? 'CLOSED' : 'OPEN',
        },
      });
    }),
  );

  const transactions: any[] = [];
  const fuelProducts = products.slice(0, 3);
  const storeProducts = products.slice(3, 9);

  for (let i = 0; i < 15; i++) {
    const dayBack = Math.floor(i / 3);
    const d = new Date(2026, 3, 26 - dayBack, 9 + (i % 7), Math.floor(Math.random() * 60));
    const isFuelSale = i % 4 === 0;
    const p1 = isFuelSale
      ? fuelProducts[i % fuelProducts.length]
      : storeProducts[i % storeProducts.length];
    const qty = isFuelSale ? Math.floor(Math.random() * 50) + 10 : Math.floor(Math.random() * 3) + 1;
    const sub = p1.priceCents * qty;
    const tax = p1.taxClass === 'STANDARD' ? Math.round(sub * 0.07) : 0;
    const tip = !isFuelSale && Math.random() > 0.7 ? Math.floor(Math.random() * 500) + 100 : 0;

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
      data: {
        transactionId: txn.id,
        productId: p1.id,
        quantity: qty,
        unitPriceCents: p1.priceCents,
        taxCents: tax,
        extendedCents: sub,
      },
    });
    transactions.push(txn);
  }

  return { products, transactions };
}
