import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockPrisma } from '../setup.js';

vi.mock('../../src/services/costing-engine.js', async (importOriginal) => {
  return await importOriginal();
});

let recordInventoryReceipt: typeof import('../../src/services/costing-engine.js').recordInventoryReceipt;
let consumeInventoryForSale: typeof import('../../src/services/costing-engine.js').consumeInventoryForSale;
let restoreInventoryOnReturn: typeof import('../../src/services/costing-engine.js').restoreInventoryOnReturn;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('../../src/services/costing-engine.js');
  recordInventoryReceipt = mod.recordInventoryReceipt;
  consumeInventoryForSale = mod.consumeInventoryForSale;
  restoreInventoryOnReturn = mod.restoreInventoryOnReturn;
});

// ─── recordInventoryReceipt — WAC recalculation ───────────────────────────────

describe('recordInventoryReceipt — WAC recalculation', () => {
  it('blends new receipt into existing average cost (qoh=100, avg=500, recv 50 @ 600)', async () => {
    // Product with WAC costing method (non-fuel category)
    mockPrisma.product.findUnique.mockResolvedValueOnce({
      averageCostCents: 500,
      productCategory: { costingMethod: 'WAC', isFuelCategory: false },
    });

    // Existing inventory: 100 units on hand
    mockPrisma.inventory.findFirst
      .mockResolvedValueOnce({ qtyOnHand: 100 })  // WAC calculation lookup
      .mockResolvedValueOnce({ id: 'inv-1' });     // QOH update lookup

    mockPrisma.product.update.mockResolvedValue({});
    mockPrisma.inventory.update.mockResolvedValue({});

    await recordInventoryReceipt({
      tenantId: 'tenant-1',
      productId: 'prod-1',
      locationId: 'loc-1',
      qtyReceived: 50,
      unitCostCents: 600,
    });

    // Expected new WAC: (100*500 + 50*600) / 150 = 80000/150 = 533 (rounded)
    expect(mockPrisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'prod-1' },
        data: { averageCostCents: 533 },
      }),
    );

    // QOH should be incremented by 50
    expect(mockPrisma.inventory.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'inv-1' },
        data: { qtyOnHand: { increment: 50 } },
      }),
    );
  });

  it('first receipt on zero-stock product sets averageCostCents to unitCostCents', async () => {
    mockPrisma.product.findUnique.mockResolvedValueOnce({
      averageCostCents: null,
      productCategory: { costingMethod: 'WAC', isFuelCategory: false },
    });

    // No existing inventory
    mockPrisma.inventory.findFirst
      .mockResolvedValueOnce(null)   // WAC: no inventory record → currentQty = 0
      .mockResolvedValueOnce(null);  // QOH lookup → will create new record

    mockPrisma.product.update.mockResolvedValue({});
    mockPrisma.inventory.create.mockResolvedValue({ id: 'inv-new' });

    await recordInventoryReceipt({
      tenantId: 'tenant-1',
      productId: 'prod-2',
      locationId: 'loc-1',
      qtyReceived: 20,
      unitCostCents: 1000,
    });

    // newQty = 20, newTotalValue = 0*0 + 20*1000 = 20000, newAvgCost = 20000/20 = 1000
    expect(mockPrisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { averageCostCents: 1000 },
      }),
    );

    expect(mockPrisma.inventory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ qtyOnHand: 20 }),
      }),
    );
  });
});

// ─── recordInventoryReceipt — FIFO lot creation ───────────────────────────────

describe('recordInventoryReceipt — FIFO lot creation (fuel category)', () => {
  it('creates an InventoryLot for fuel (isFuelCategory=true) and updates QOH', async () => {
    mockPrisma.product.findUnique.mockResolvedValueOnce({
      averageCostCents: 320,
      productCategory: { costingMethod: 'WAC', isFuelCategory: true },
    });

    mockPrisma.inventoryLot.create.mockResolvedValue({ id: 'lot-1' });

    // Existing inventory for QOH increment
    mockPrisma.inventory.findFirst.mockResolvedValueOnce({ id: 'inv-fuel' });
    mockPrisma.inventory.update.mockResolvedValue({});

    await recordInventoryReceipt({
      tenantId: 'tenant-1',
      productId: 'prod-fuel',
      locationId: 'loc-1',
      qtyReceived: 500,
      unitCostCents: 350,
    });

    // Should create a lot with the received qty and cost
    expect(mockPrisma.inventoryLot.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'tenant-1',
          productId: 'prod-fuel',
          locationId: 'loc-1',
          qtyRemaining: 500,
          unitCostCents: 350,
        }),
      }),
    );

    // Should NOT call product.update for WAC (FIFO skips WAC update)
    expect(mockPrisma.product.update).not.toHaveBeenCalled();

    // Should still update QOH
    expect(mockPrisma.inventory.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { qtyOnHand: { increment: 500 } },
      }),
    );
  });

  it('does not throw when InventoryLot table is unavailable (P2021-style error)', async () => {
    mockPrisma.product.findUnique.mockResolvedValueOnce({
      averageCostCents: 0,
      productCategory: { costingMethod: 'WAC', isFuelCategory: true },
    });

    mockPrisma.inventoryLot.create.mockRejectedValueOnce(new Error('P2021: table does not exist'));
    mockPrisma.inventory.findFirst.mockResolvedValueOnce({ id: 'inv-1' });
    mockPrisma.inventory.update.mockResolvedValue({});

    // Should not throw — it swallows the lot-creation error
    await expect(
      recordInventoryReceipt({
        tenantId: 'tenant-1',
        productId: 'prod-fuel',
        locationId: 'loc-1',
        qtyReceived: 100,
        unitCostCents: 300,
      }),
    ).resolves.toBeUndefined();
  });
});

// ─── consumeInventoryForSale — FIFO lot consumption ──────────────────────────

describe('consumeInventoryForSale — FIFO lot consumption', () => {
  it('consumes oldest lots first and returns correct COGS breakdown (multi-lot)', async () => {
    mockPrisma.product.findUnique.mockResolvedValueOnce({
      averageCostCents: 350,
      productCategory: { costingMethod: 'FIFO', isFuelCategory: true },
    });

    // Lot A: 100 units @ $3.00, received first
    // Lot B: 200 units @ $4.00, received second
    mockPrisma.inventoryLot.findMany.mockResolvedValueOnce([
      { id: 'lot-A', qtyRemaining: 100, unitCostCents: 300, receivedAt: new Date('2024-01-01') },
      { id: 'lot-B', qtyRemaining: 200, unitCostCents: 400, receivedAt: new Date('2024-02-01') },
    ]);

    mockPrisma.inventoryLot.update.mockResolvedValue({});
    mockPrisma.inventory.updateMany.mockResolvedValue({ count: 1 });

    const result = await consumeInventoryForSale({
      tenantId: 'tenant-1',
      productId: 'prod-fuel',
      locationId: 'loc-1',
      qtySold: 150,
    });

    expect(result).not.toBeNull();
    expect(result!.method).toBe('FIFO');

    // Lot A fully consumed: 100 units @ 300 = 30000
    // Lot B partially consumed: 50 units @ 400 = 20000
    // Total COGS = 50000
    expect(result!.totalCostCents).toBe(50000);

    expect(result!.lotsConsumed).toHaveLength(2);

    const lotA = result!.lotsConsumed!.find((l) => l.lotId === 'lot-A');
    expect(lotA).toBeDefined();
    expect(lotA!.qty).toBe(100);
    expect(lotA!.unitCostCents).toBe(300);

    const lotB = result!.lotsConsumed!.find((l) => l.lotId === 'lot-B');
    expect(lotB).toBeDefined();
    expect(lotB!.qty).toBe(50);
    expect(lotB!.unitCostCents).toBe(400);

    // inventoryLot.update called twice — once per lot consumed
    expect(mockPrisma.inventoryLot.update).toHaveBeenCalledTimes(2);
    // QOH decremented by total sold
    expect(mockPrisma.inventory.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { qtyOnHand: { decrement: 150 } },
      }),
    );
  });

  it('falls back to WAC when lots are exhausted mid-sale (lot qty < sold qty)', async () => {
    mockPrisma.product.findUnique.mockResolvedValueOnce({
      averageCostCents: 400,
      productCategory: { costingMethod: 'FIFO', isFuelCategory: true },
    });

    // Only 30 units available in lots, but we want to sell 50
    mockPrisma.inventoryLot.findMany.mockResolvedValueOnce([
      { id: 'lot-X', qtyRemaining: 30, unitCostCents: 350, receivedAt: new Date('2024-01-01') },
    ]);

    mockPrisma.inventoryLot.update.mockResolvedValue({});
    mockPrisma.inventory.updateMany.mockResolvedValue({ count: 1 });

    // Should not throw — remaining 20 units use WAC fallback via lot exhaustion
    const result = await consumeInventoryForSale({
      tenantId: 'tenant-1',
      productId: 'prod-fuel',
      locationId: 'loc-1',
      qtySold: 50,
    });

    expect(result).not.toBeNull();
    // Only the 30 lot units are consumed via FIFO; the 20 remaining are billed at $0 (lots exhausted)
    expect(result!.method).toBe('FIFO');
    expect(result!.lotsConsumed).toHaveLength(1);
    // Total cost = 30 * 350 = 10500 (only lot cost; remaining 20 had no lot)
    expect(result!.totalCostCents).toBe(10500);
  });

  it('falls back to WAC immediately when InventoryLot table throws', async () => {
    mockPrisma.product.findUnique.mockResolvedValueOnce({
      averageCostCents: 750,
      productCategory: { costingMethod: 'FIFO', isFuelCategory: true },
    });

    mockPrisma.inventoryLot.findMany.mockRejectedValueOnce(new Error('P2021: table does not exist'));
    mockPrisma.inventory.updateMany.mockResolvedValue({ count: 1 });

    const result = await consumeInventoryForSale({
      tenantId: 'tenant-1',
      productId: 'prod-fuel',
      locationId: 'loc-1',
      qtySold: 10,
    });

    expect(result).not.toBeNull();
    expect(result!.method).toBe('WAC');
    expect(result!.totalCostCents).toBe(7500); // 750 * 10
  });
});

// ─── consumeInventoryForSale — WAC consumption ───────────────────────────────

describe('consumeInventoryForSale — WAC consumption', () => {
  it('returns totalCOGSCents = averageCostCents * qtySold and decrements QOH', async () => {
    mockPrisma.product.findUnique.mockResolvedValueOnce({
      averageCostCents: 750,
      productCategory: { costingMethod: 'WAC', isFuelCategory: false },
    });

    mockPrisma.inventory.updateMany.mockResolvedValue({ count: 1 });

    const result = await consumeInventoryForSale({
      tenantId: 'tenant-1',
      productId: 'prod-1',
      locationId: 'loc-1',
      qtySold: 10,
    });

    expect(result).not.toBeNull();
    expect(result!.method).toBe('WAC');
    expect(result!.unitCostCents).toBe(750);
    expect(result!.totalCostCents).toBe(7500);

    expect(mockPrisma.inventory.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { productId: 'prod-1', locationId: 'loc-1' },
        data: { qtyOnHand: { decrement: 10 } },
      }),
    );
  });

  it('returns null when product is not found', async () => {
    mockPrisma.product.findUnique.mockResolvedValueOnce(null);

    const result = await consumeInventoryForSale({
      tenantId: 'tenant-1',
      productId: 'prod-missing',
      locationId: 'loc-1',
      qtySold: 5,
    });

    expect(result).toBeNull();
  });
});

// ─── restoreInventoryOnReturn — COGS reversal ─────────────────────────────────

describe('restoreInventoryOnReturn — COGS reversal', () => {
  it('restores at current WAC and returns correct cost figures', async () => {
    mockPrisma.product.findUnique.mockResolvedValueOnce({
      averageCostCents: 800,
    });

    mockPrisma.inventory.updateMany.mockResolvedValue({ count: 1 });

    const result = await restoreInventoryOnReturn({
      tenantId: 'tenant-1',
      productId: 'prod-1',
      locationId: 'loc-1',
      qtyReturned: 3,
    });

    // 800 * 3 = 2400 cents
    expect(result.unitCostCents).toBe(800);
    expect(result.totalCostCents).toBe(2400);
  });

  it('increments QOH by qtyReturned', async () => {
    mockPrisma.product.findUnique.mockResolvedValueOnce({
      averageCostCents: 500,
    });

    mockPrisma.inventory.updateMany.mockResolvedValue({ count: 1 });

    await restoreInventoryOnReturn({
      tenantId: 'tenant-1',
      productId: 'prod-1',
      locationId: 'loc-1',
      qtyReturned: 5,
    });

    expect(mockPrisma.inventory.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { productId: 'prod-1', locationId: 'loc-1' },
        data: { qtyOnHand: { increment: 5 } },
      }),
    );
  });

  it('uses 0 as unitCostCents when product has no averageCostCents', async () => {
    mockPrisma.product.findUnique.mockResolvedValueOnce({
      averageCostCents: null,
    });

    mockPrisma.inventory.updateMany.mockResolvedValue({ count: 1 });

    const result = await restoreInventoryOnReturn({
      tenantId: 'tenant-1',
      productId: 'prod-1',
      locationId: 'loc-1',
      qtyReturned: 2,
    });

    expect(result.unitCostCents).toBe(0);
    expect(result.totalCostCents).toBe(0);
  });
});
