import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockPrisma } from '../setup.js';

vi.mock('../../src/services/qbo-sync.js', async (importOriginal) => {
  return await importOriginal();
});

let syncInvoice: typeof import('../../src/services/qbo-sync.js').syncInvoice;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('../../src/services/qbo-sync.js');
  syncInvoice = mod.syncInvoice;
});

describe('syncInvoice — location credential guard', () => {
  it('throws "QuickBooks Online is not connected for location" when the invoice location has no QBO credentials', async () => {
    const locationId = 'loc-no-qbo';
    const invoiceId = 'inv-test';
    const tenantId = 'test-tenant-id';

    mockPrisma.invoice.findFirst.mockResolvedValue({
      id: invoiceId,
      tenantId,
      locationId,
      qboInvoiceId: null,
      dueDate: new Date(),
      issuedDate: new Date(),
      invoiceNumber: 'INV-001',
      memo: null,
      lineItems: [
        {
          id: 'li-1',
          description: 'Slip rental',
          quantity: 1,
          unitPriceCents: 100000,
          totalCents: 100000,
          qboItemId: null,
        },
      ],
      customer: {
        id: 'cust-1',
        firstName: 'Jane',
        lastName: 'Smith',
        email: 'jane@test.com',
        qboCustomerId: 'qbo-cust-1',
      },
    });

    (mockPrisma as any).location = {
      findUnique: vi.fn().mockResolvedValue({
        id: locationId,
        qboRealmId: null,
        qboAccessToken: null,
      }),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
    };

    await expect(syncInvoice(invoiceId, tenantId)).rejects.toThrow(
      `QuickBooks Online is not connected for location ${locationId}`,
    );
  });

  it('throws "QuickBooks Online is not connected for location" when location row does not exist', async () => {
    const locationId = 'loc-missing';
    const invoiceId = 'inv-missing-loc';
    const tenantId = 'test-tenant-id';

    mockPrisma.invoice.findFirst.mockResolvedValue({
      id: invoiceId,
      tenantId,
      locationId,
      qboInvoiceId: null,
      dueDate: null,
      issuedDate: null,
      invoiceNumber: null,
      memo: null,
      lineItems: [],
      customer: {
        id: 'cust-2',
        firstName: 'Bob',
        lastName: 'Jones',
        email: 'bob@test.com',
        qboCustomerId: 'qbo-cust-2',
      },
    });

    (mockPrisma as any).location = {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
    };

    await expect(syncInvoice(invoiceId, tenantId)).rejects.toThrow(
      `QuickBooks Online is not connected for location ${locationId}`,
    );
  });

  it('throws "Invoice not found" when invoice does not exist', async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue(null);

    await expect(syncInvoice('non-existent', 'test-tenant-id')).rejects.toThrow(
      'Invoice non-existent not found',
    );
  });
});

// ===========================================================================
// Inventory sync — items, bills, adjustments, void/refund propagation
// ===========================================================================

let syncInventoryItem: typeof import('../../src/services/qbo-sync.js').syncInventoryItem;
let postInventoryAdjustmentJournal: typeof import('../../src/services/qbo-sync.js').postInventoryAdjustmentJournal;
let voidQboInvoice: typeof import('../../src/services/qbo-sync.js').voidQboInvoice;
let voidQboPayment: typeof import('../../src/services/qbo-sync.js').voidQboPayment;
let getInventorySyncStatus: typeof import('../../src/services/qbo-sync.js').getInventorySyncStatus;

beforeEach(async () => {
  const mod = await import('../../src/services/qbo-sync.js');
  syncInventoryItem = mod.syncInventoryItem;
  postInventoryAdjustmentJournal = mod.postInventoryAdjustmentJournal;
  voidQboInvoice = mod.voidQboInvoice;
  voidQboPayment = mod.voidQboPayment;
  getInventorySyncStatus = mod.getInventorySyncStatus;

  // Reset mocks for the inventory-related tables
  (mockPrisma as any).qboInventorySyncRef = {
    findUnique: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
    upsert: vi.fn().mockResolvedValue({}),
  };
  (mockPrisma as any).vendor = {
    findFirst: vi.fn().mockResolvedValue(null),
    findUnique: vi.fn(),
    update: vi.fn(),
  };
  mockPrisma.product = {
    ...mockPrisma.product,
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
  } as any;
  mockPrisma.glAccount.findFirst = vi.fn();
  mockPrisma.auditLog.create = vi.fn().mockResolvedValue({});
});

describe('syncInventoryItem — GL account validation', () => {
  it('throws a descriptive error when the income GL account is not provided', async () => {
    await expect(
      syncInventoryItem(
        {
          productId: 'inv-prod-1',
          name: 'Bag of Ice',
          sku: 'ICE-10',
          priceCents: 500,
          costCents: 200,
          incomeGlAccountId: null,
          inventoryAssetGlAccountId: 'gl-1',
          cogsGlAccountId: 'gl-2',
        },
        'tenant-1',
      ),
    ).rejects.toThrow(/Missing GL account for Income/);

    // Failure should still be persisted to the sync ref so the UI can surface it
    expect((mockPrisma as any).qboInventorySyncRef.upsert).toHaveBeenCalled();
  });

  it('throws when the GL account exists but has not been mapped to QBO', async () => {
    mockPrisma.glAccount.findFirst = vi.fn().mockResolvedValue({
      id: 'gl-income',
      qboAccountId: null,
      name: 'Merchandise Sales',
      accountNumber: '4500',
    });

    await expect(
      syncInventoryItem(
        {
          productId: 'inv-prod-2',
          name: 'Boat Wax',
          sku: 'WAX-1',
          priceCents: 1500,
          costCents: 600,
          incomeGlAccountId: 'gl-income',
          inventoryAssetGlAccountId: 'gl-asset',
          cogsGlAccountId: 'gl-cogs',
        },
        'tenant-1',
      ),
    ).rejects.toThrow(/not linked to a QuickBooks account/);
  });
});

describe('postInventoryAdjustmentJournal — short-circuits & idempotency', () => {
  it('skips reasons handled elsewhere (received → bill, sold → auto-COGS)', async () => {
    const r1 = await postInventoryAdjustmentJournal(
      {
        adjustmentId: 'adj-1',
        productId: 'inv-prod-1',
        productName: 'Boat Wax',
        reason: 'received',
        quantityChange: 10,
        unitCostCents: 600,
        inventoryAssetGlAccountId: 'gl-asset',
        cogsGlAccountId: 'gl-cogs',
      },
      'tenant-1',
    );
    expect(r1).toEqual({ qboJournalEntryId: null, skipped: true, reason: 'received_handled_elsewhere' });

    const r2 = await postInventoryAdjustmentJournal(
      {
        adjustmentId: 'adj-2',
        productId: 'inv-prod-1',
        productName: 'Boat Wax',
        reason: 'sold',
        quantityChange: -1,
        unitCostCents: 600,
        inventoryAssetGlAccountId: 'gl-asset',
        cogsGlAccountId: 'gl-cogs',
      },
      'tenant-1',
    );
    expect(r2).toEqual({ qboJournalEntryId: null, skipped: true, reason: 'sold_handled_elsewhere' });
  });

  it('skips zero-quantity adjustments without hitting QBO', async () => {
    const r = await postInventoryAdjustmentJournal(
      {
        adjustmentId: 'adj-zero',
        productId: 'inv-prod-1',
        productName: 'Boat Wax',
        reason: 'damaged',
        quantityChange: 0,
        unitCostCents: 600,
        inventoryAssetGlAccountId: 'gl-asset',
        cogsGlAccountId: 'gl-cogs',
      },
      'tenant-1',
    );
    expect(r).toEqual({ qboJournalEntryId: null, skipped: true, reason: 'zero_qty_change' });
  });

  it('returns the existing JE id when the adjustment has already been posted (idempotency)', async () => {
    (mockPrisma as any).qboInventorySyncRef.findUnique = vi.fn().mockResolvedValue({
      qboId: 'JE-existing',
      lastSyncedAt: new Date(),
      lastError: null,
      lastErrorAt: null,
    });

    const r = await postInventoryAdjustmentJournal(
      {
        adjustmentId: 'adj-already-posted',
        productId: 'inv-prod-1',
        productName: 'Boat Wax',
        reason: 'damaged',
        quantityChange: -2,
        unitCostCents: 600,
        inventoryAssetGlAccountId: 'gl-asset',
        cogsGlAccountId: 'gl-cogs',
      },
      'tenant-1',
    );
    expect(r).toEqual({ qboJournalEntryId: 'JE-existing', skipped: true, reason: 'already_posted' });
  });
});

describe('void/refund propagation — no-ops when nothing was synced', () => {
  it('voidQboInvoice is a no-op when the local invoice has no qboInvoiceId', async () => {
    mockPrisma.invoice.findFirst = vi.fn().mockResolvedValue({
      id: 'inv-1',
      qboInvoiceId: null,
      locationId: null,
    }) as any;

    await expect(voidQboInvoice('inv-1', 'tenant-1')).resolves.toBeUndefined();
  });

  it('voidQboPayment is a no-op when the local payment has no qboPaymentId', async () => {
    mockPrisma.payment.findFirst = vi.fn().mockResolvedValue({
      id: 'pay-1',
      qboPaymentId: null,
      invoice: { locationId: null },
    }) as any;

    await expect(voidQboPayment('pay-1', 'tenant-1')).resolves.toBeUndefined();
  });
});

describe('getInventorySyncStatus — aggregates sync refs into a status summary', () => {
  it('counts items, bills, and adjustments by qboType and surfaces recent errors', async () => {
    const now = new Date();
    (mockPrisma as any).qboInventorySyncRef.findMany = vi.fn().mockResolvedValue([
      { qboType: 'Item', qboId: 'I1', lastSyncedAt: now, lastError: null, lastErrorAt: null, sourceType: 'product', sourceId: 'p1' },
      { qboType: 'Item', qboId: 'I2', lastSyncedAt: now, lastError: null, lastErrorAt: null, sourceType: 'product', sourceId: 'p2' },
      { qboType: 'Item', qboId: null, lastSyncedAt: null, lastError: 'boom', lastErrorAt: now, sourceType: 'product', sourceId: 'p3' },
      { qboType: 'Bill', qboId: 'B1', lastSyncedAt: now, lastError: null, lastErrorAt: null, sourceType: 'purchase_order', sourceId: 'po1' },
      { qboType: 'JournalEntry', qboId: 'JE1', lastSyncedAt: now, lastError: null, lastErrorAt: null, sourceType: 'inventory_adjustment', sourceId: 'adj1' },
    ]);

    const status = await getInventorySyncStatus('tenant-1');
    expect(status.itemsSynced).toBe(2);
    expect(status.itemsWithErrors).toBe(1);
    expect(status.billsSynced).toBe(1);
    expect(status.adjustmentsSynced).toBe(1);
    expect(status.recentErrors).toHaveLength(1);
    expect(status.recentErrors[0].error).toBe('boom');
  });
});
