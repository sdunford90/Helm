import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockPrisma } from '../setup.js';

vi.mock('../../src/services/qbo-sync.js', async (importOriginal) => {
  return await importOriginal();
});

let syncInvoice: typeof import('../../src/services/qbo-sync.js').syncInvoice;
let handleQboWebhook: typeof import('../../src/services/qbo-sync.js').handleQboWebhook;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('../../src/services/qbo-sync.js');
  syncInvoice = mod.syncInvoice;
  handleQboWebhook = mod.handleQboWebhook;
});

let applyQboVendor: typeof import('../../src/services/qbo-sync.js').applyQboVendor;
let applyQboBill: typeof import('../../src/services/qbo-sync.js').applyQboBill;
let pullVendorsAndBillsForTenant: typeof import('../../src/services/qbo-sync.js').pullVendorsAndBillsForTenant;

beforeEach(async () => {
  const mod = await import('../../src/services/qbo-sync.js');
  applyQboVendor = mod.applyQboVendor;
  applyQboBill = mod.applyQboBill;
  pullVendorsAndBillsForTenant = mod.pullVendorsAndBillsForTenant;

  (mockPrisma as any).vendor = {
    findFirst: vi.fn().mockResolvedValue(null),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
  };
  (mockPrisma as any).purchaseOrder = {
    findFirst: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    update: vi.fn(),
  };
  (mockPrisma as any).location = {
    findUnique: vi.fn().mockResolvedValue(null),
    findFirst: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue({}),
  };
  mockPrisma.tenant.findUnique = vi.fn().mockResolvedValue({});
  mockPrisma.tenant.update = vi.fn().mockResolvedValue({});
  mockPrisma.auditLog.create = vi.fn().mockResolvedValue({});
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
let createQboRefundReceipt: typeof import('../../src/services/qbo-sync.js').createQboRefundReceipt;
let buildPaymentRefundSyncSourceId: typeof import('../../src/services/qbo-sync.js').buildPaymentRefundSyncSourceId;
let parsePaymentRefundSyncSourceId: typeof import('../../src/services/qbo-sync.js').parsePaymentRefundSyncSourceId;
let getInventorySyncStatus: typeof import('../../src/services/qbo-sync.js').getInventorySyncStatus;

beforeEach(async () => {
  const mod = await import('../../src/services/qbo-sync.js');
  syncInventoryItem = mod.syncInventoryItem;
  postInventoryAdjustmentJournal = mod.postInventoryAdjustmentJournal;
  voidQboInvoice = mod.voidQboInvoice;
  voidQboPayment = mod.voidQboPayment;
  createQboRefundReceipt = mod.createQboRefundReceipt;
  buildPaymentRefundSyncSourceId = mod.buildPaymentRefundSyncSourceId;
  parsePaymentRefundSyncSourceId = mod.parsePaymentRefundSyncSourceId;
  getInventorySyncStatus = mod.getInventorySyncStatus;

  // Reset mocks for the inventory-related tables
  (mockPrisma as any).qboInventorySyncRef = {
    findUnique: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
    upsert: vi.fn().mockResolvedValue({}),
    // Default: update simulates an existing row, returning post-increment count.
    update: vi.fn().mockResolvedValue({ retryCount: 1 }),
    create: vi.fn().mockResolvedValue({}),
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
          trackInventory: true,
          incomeGlAccountId: null,
          inventoryAssetGlAccountId: 'gl-1',
          cogsGlAccountId: 'gl-2',
        },
        'tenant-1',
      ),
    ).rejects.toThrow(/Missing GL account for Income/);

    // Failure should still be persisted to the sync ref so the UI can surface
    // it. With the probe-first refactor, the very first failure for a ref
    // creates the row instead of updating it.
    expect((mockPrisma as any).qboInventorySyncRef.create).toHaveBeenCalled();
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
          trackInventory: true,
          incomeGlAccountId: 'gl-income',
          inventoryAssetGlAccountId: 'gl-asset',
          cogsGlAccountId: 'gl-cogs',
        },
        'tenant-1',
      ),
    ).rejects.toThrow(/not linked to a QuickBooks account/);
  });

  it('does not invalidate the existing sync ref on a transient lookup failure', async () => {
    // Existing ref points at a QBO Item; the GET fails with a 5xx (transient).
    // We must NOT null out qboId — otherwise the next attempt would create a
    // duplicate Item in QBO every time QBO has a hiccup.
    (mockPrisma as any).qboInventorySyncRef.findUnique = vi
      .fn()
      .mockResolvedValue({ qboId: 'qbo-item-existing', qboType: 'Item' });
    const refUpdate = vi.fn().mockResolvedValue({ retryCount: 1 });
    (mockPrisma as any).qboInventorySyncRef.update = refUpdate;
    mockPrisma.glAccount.findFirst = vi.fn().mockResolvedValue({
      id: 'gl-income',
      qboAccountId: 'qbo-acct-1',
      name: 'Service Revenue',
      accountNumber: '4000',
    });
    mockPrisma.tenant.findUnique = vi.fn().mockResolvedValue({
      qboAccessToken: 'access-token',
      qboRefreshToken: 'refresh-token',
      qboRealmId: 'realm-1',
      qboTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{"Fault":{"Error":[{"Message":"ServiceUnavailable","code":"500"}]}}', {
        status: 503,
      }) as any,
    );

    try {
      await expect(
        syncInventoryItem(
          {
            productId: 'svc-prod-transient',
            name: 'Dockage Add-on',
            sku: 'ADD-2',
            priceCents: 1000,
            costCents: 0,
            trackInventory: false,
            incomeGlAccountId: 'gl-income',
            inventoryAssetGlAccountId: null,
            cogsGlAccountId: null,
          },
          'tenant-1',
        ),
      ).rejects.toThrow();

      // The stale-ref invalidation update (data: { qboId: null }) must NOT
      // have been issued. Only the failure-bookkeeping updates may run.
      const invalidationCalls = refUpdate.mock.calls.filter(
        ([args]: any) => args?.data?.qboId === null,
      );
      expect(invalidationCalls).toHaveLength(0);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('invalidates the sync ref and creates a new Item when QBO returns 404 (item deleted upstream)', async () => {
    (mockPrisma as any).qboInventorySyncRef.findUnique = vi
      .fn()
      .mockResolvedValue({ qboId: 'qbo-item-gone', qboType: 'Item' });
    const refUpdate = vi.fn().mockResolvedValue({ retryCount: 1 });
    (mockPrisma as any).qboInventorySyncRef.update = refUpdate;
    (mockPrisma as any).qboInventorySyncRef.upsert = vi.fn().mockResolvedValue({});
    mockPrisma.glAccount.findFirst = vi.fn().mockResolvedValue({
      id: 'gl-income',
      qboAccountId: 'qbo-acct-1',
      name: 'Service Revenue',
      accountNumber: '4000',
    });
    mockPrisma.tenant.findUnique = vi.fn().mockResolvedValue({
      qboAccessToken: 'access-token',
      qboRefreshToken: 'refresh-token',
      qboRealmId: 'realm-1',
      qboTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    // First call (GET item/qbo-item-gone) → 404; second call (POST item) → 200 create.
    const fetchSpy = vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response('{"Fault":{"Error":[{"Message":"Object Not Found","code":"610"}]}}', {
          status: 404,
        }) as any,
      )
      .mockResolvedValueOnce(
        new Response('{"Item":{"Id":"qbo-item-new"}}', { status: 200 }) as any,
      );

    try {
      await syncInventoryItem(
        {
          productId: 'svc-prod-recreated',
          name: 'Dockage Add-on',
          sku: 'ADD-3',
          priceCents: 1000,
          costCents: 0,
          trackInventory: false,
          incomeGlAccountId: 'gl-income',
          inventoryAssetGlAccountId: null,
          cogsGlAccountId: null,
        },
        'tenant-1',
      );

      // Stale ref WAS invalidated.
      const invalidationCalls = refUpdate.mock.calls.filter(
        ([args]: any) => args?.data?.qboId === null,
      );
      expect(invalidationCalls).toHaveLength(1);
      // A POST to item endpoint occurred (the new-item create).
      const postCalls = fetchSpy.mock.calls.filter(([, init]: any) => init?.method === 'POST');
      expect(postCalls.length).toBeGreaterThan(0);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('non-tracked products only require an Income mapping (no Inventory Asset / COGS)', async () => {
    // No Inventory Asset / COGS provided — would reject for an inventory item
    // but should pass GL validation for a service item.
    mockPrisma.glAccount.findFirst = vi.fn().mockResolvedValue({
      id: 'gl-income',
      qboAccountId: 'qbo-acct-1',
      name: 'Service Revenue',
      accountNumber: '4000',
    });
    // Mock a connected tenant so qboRequest can resolve credentials.
    mockPrisma.tenant.findUnique = vi.fn().mockResolvedValue({
      qboAccessToken: 'access-token',
      qboRefreshToken: 'refresh-token',
      qboRealmId: 'realm-1',
      qboTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    // Stub the QBO HTTP call so we can inspect the payload without a real
    // round-trip. We only care that GL validation succeeds and that the
    // payload sent to QBO uses Type:"Service".
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{"Item":{"Id":"qbo-item-1"}}', { status: 200 }) as any,
    );

    try {
      await syncInventoryItem(
        {
          productId: 'svc-prod-1',
          name: 'Dockage Add-on',
          sku: 'ADD-1',
          priceCents: 1000,
          costCents: 0,
          trackInventory: false,
          incomeGlAccountId: 'gl-income',
          inventoryAssetGlAccountId: null,
          cogsGlAccountId: null,
        },
        'tenant-1',
      );

      // The QBO POST body should reflect a Service item.
      const calls = fetchSpy.mock.calls.filter(([, init]: any) => init?.method === 'POST');
      expect(calls.length).toBeGreaterThan(0);
      const lastBody = JSON.parse((calls[calls.length - 1][1] as any).body as string);
      expect(lastBody.Type).toBe('Service');
      expect(lastBody.AssetAccountRef).toBeUndefined();
      expect(lastBody.ExpenseAccountRef).toBeUndefined();
      expect(lastBody.TrackQtyOnHand).toBeUndefined();
      expect(lastBody.IncomeAccountRef).toEqual({ value: 'qbo-acct-1' });
    } finally {
      fetchSpy.mockRestore();
    }
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

describe('createQboRefundReceipt — partial refund → QBO RefundReceipt', () => {
  it('encodes paymentId, prior, and amount into a unique sourceId', () => {
    const id = buildPaymentRefundSyncSourceId('pay-1', 0, 500);
    expect(id).toBe('pay-1:0:500');

    const parsed = parsePaymentRefundSyncSourceId(id);
    expect(parsed).toEqual({ paymentId: 'pay-1', priorRefundedCents: 0, refundAmountCents: 500 });
  });

  it('rejects malformed sourceIds so the retry path can skip them safely', () => {
    expect(parsePaymentRefundSyncSourceId('garbage')).toBeNull();
    expect(parsePaymentRefundSyncSourceId('pay-1:abc:500')).toBeNull();
    // Negative refund amount is invalid (refund must be positive cents).
    expect(parsePaymentRefundSyncSourceId('pay-1:0:-1')).toBeNull();
    // Zero refund amount is invalid (must be positive).
    expect(parsePaymentRefundSyncSourceId('pay-1:0:0')).toBeNull();
  });

  it('is idempotent: returns the existing RefundReceipt id when the sync ref already has one', async () => {
    mockPrisma.payment.findFirst = vi.fn().mockResolvedValue({
      id: 'pay-1',
      tenantId: 'tenant-1',
      amountCents: 1000,
      refundedCents: 0,
      customer: { id: 'cust-1', qboCustomerId: 'QBO-CUST-1' },
      invoice: { id: 'inv-1', locationId: null },
    }) as any;
    (mockPrisma as any).qboInventorySyncRef.findUnique = vi.fn().mockResolvedValue({
      qboId: 'RR-existing',
      lastSyncedAt: new Date(),
      lastError: null,
      lastErrorAt: null,
    });

    const r = await createQboRefundReceipt('pay-1', 500, 0, 'tenant-1');
    expect(r).toEqual({ qboRefundReceiptId: 'RR-existing', skipped: true });
    // Should NOT have called update/upsert: idempotent return short-circuits
    // before any QBO request or sync-ref write.
    expect((mockPrisma as any).qboInventorySyncRef.upsert).not.toHaveBeenCalled();
  });

  it('persists failures to qboInventorySyncRef so the Settings UI surfaces them', async () => {
    mockPrisma.payment.findFirst = vi.fn().mockResolvedValue({
      id: 'pay-1',
      tenantId: 'tenant-1',
      amountCents: 1000,
      refundedCents: 0,
      customer: { id: 'cust-1', qboCustomerId: 'QBO-CUST-1' },
      // No location → resolveQboContext will fail with "QuickBooks Online is
      // not connected" since the test setup has no QBO connection configured.
      invoice: { id: 'inv-1', locationId: 'loc-no-qbo' },
    }) as any;
    (mockPrisma as any).qboInventorySyncRef.findUnique = vi.fn().mockResolvedValue(null);

    await expect(createQboRefundReceipt('pay-1', 500, 0, 'tenant-1')).rejects.toThrow();

    // Failure was captured to the sync ref (either via update for an existing
    // row or upsert/create for a new one) so the recent-errors panel will
    // surface it.
    const upsertCalls = ((mockPrisma as any).qboInventorySyncRef.upsert as any).mock.calls;
    const updateCalls = ((mockPrisma as any).qboInventorySyncRef.update as any).mock.calls;
    const createCalls = ((mockPrisma as any).qboInventorySyncRef.create as any).mock.calls;
    expect(upsertCalls.length + updateCalls.length + createCalls.length).toBeGreaterThan(0);
  });

  it('rejects non-positive refund amounts before touching prisma or QBO', async () => {
    await expect(createQboRefundReceipt('pay-1', 0, 0, 'tenant-1')).rejects.toThrow(
      /positive integer/,
    );
    await expect(createQboRefundReceipt('pay-1', -100, 0, 'tenant-1')).rejects.toThrow(
      /positive integer/,
    );
  });
});

describe('getInventorySyncStatus — aggregates sync refs into a status summary', () => {
  it('counts items, bills, adjustments, and refund receipts by qboType and surfaces recent errors', async () => {
    const now = new Date();
    (mockPrisma as any).qboInventorySyncRef.findMany = vi.fn().mockResolvedValue([
      { qboType: 'Item', qboId: 'I1', lastSyncedAt: now, lastError: null, lastErrorAt: null, sourceType: 'product', sourceId: 'p1' },
      { qboType: 'Item', qboId: 'I2', lastSyncedAt: now, lastError: null, lastErrorAt: null, sourceType: 'product', sourceId: 'p2' },
      { qboType: 'Item', qboId: null, lastSyncedAt: null, lastError: 'boom', lastErrorAt: now, sourceType: 'product', sourceId: 'p3' },
      { qboType: 'Bill', qboId: 'B1', lastSyncedAt: now, lastError: null, lastErrorAt: null, sourceType: 'purchase_order', sourceId: 'po1' },
      { qboType: 'JournalEntry', qboId: 'JE1', lastSyncedAt: now, lastError: null, lastErrorAt: null, sourceType: 'inventory_adjustment', sourceId: 'adj1' },
      // Successful refund-receipt push and a failing one — both should be
      // accounted for and the failing one should appear in recentErrors so
      // the Settings UI surfaces it like any other QBO sync failure.
      { qboType: 'RefundReceipt', qboId: 'RR1', lastSyncedAt: now, lastError: null, lastErrorAt: null, sourceType: 'payment_refund', sourceId: 'pay-a:0:500' },
      { qboType: 'RefundReceipt', qboId: null, lastSyncedAt: null, lastError: 'qbo down', lastErrorAt: now, sourceType: 'payment_refund', sourceId: 'pay-b:0:1200' },
    ]);

    const status = await getInventorySyncStatus('tenant-1');
    expect(status.itemsSynced).toBe(2);
    expect(status.itemsWithErrors).toBe(1);
    expect(status.billsSynced).toBe(1);
    expect(status.adjustmentsSynced).toBe(1);
    expect(status.refundReceiptsSynced).toBe(1);
    expect(status.refundReceiptsWithErrors).toBe(1);
    expect(status.recentErrors).toHaveLength(2);
    const refundError = status.recentErrors.find((e) => e.qboType === 'RefundReceipt');
    expect(refundError?.error).toBe('qbo down');
  });
});

// ===========================================================================
// Pull-back from QBO — Vendors and Bills (webhook + manual pull)
// ===========================================================================

beforeEach(async () => {
  const mod = await import('../../src/services/qbo-sync.js');
  applyQboVendor = mod.applyQboVendor;
  applyQboBill = mod.applyQboBill;
  pullVendorsAndBillsForTenant = mod.pullVendorsAndBillsForTenant;

  (mockPrisma as any).vendor = {
    findFirst: vi.fn().mockResolvedValue(null),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
  };
  (mockPrisma as any).purchaseOrder = {
    findFirst: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    update: vi.fn(),
  };
  (mockPrisma as any).location = {
    findUnique: vi.fn().mockResolvedValue(null),
    findFirst: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue({}),
  };
  mockPrisma.tenant.findUnique = vi.fn().mockResolvedValue({});
  mockPrisma.tenant.update = vi.fn().mockResolvedValue({});
  mockPrisma.auditLog.create = vi.fn().mockResolvedValue({});
});

describe('applyQboVendor — upsert by qboVendorId', () => {
  it('creates a new local Vendor when none exists with the qboVendorId', async () => {
    (mockPrisma as any).vendor.findFirst = vi.fn().mockResolvedValue(null);
    (mockPrisma as any).vendor.create = vi.fn().mockResolvedValue({
      id: 'vendor-new',
      tenantId: 'tenant-1',
      name: 'ACME Marina Supplies',
      email: 'ap@acme.test',
      phone: '555-1212',
      address: '1 Dock Rd',
      active: true,
    });

    const result = await applyQboVendor(
      'tenant-1',
      null,
      {
        Id: '999',
        DisplayName: 'ACME Marina Supplies',
        PrimaryEmailAddr: { Address: 'ap@acme.test' },
        PrimaryPhone: { FreeFormNumber: '555-1212' },
        BillAddr: { Line1: '1 Dock Rd' },
        Active: true,
      },
      'webhook',
    );

    expect(result.created).toBe(true);
    expect(result.vendorId).toBe('vendor-new');
    expect((mockPrisma as any).vendor.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'tenant-1',
          name: 'ACME Marina Supplies',
          email: 'ap@acme.test',
          qboVendorId: '999',
        }),
      }),
    );
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'QBO_VENDOR_PULLED' }),
      }),
    );
  });

  it('updates an existing local Vendor matched by qboVendorId and audits the changed fields', async () => {
    (mockPrisma as any).vendor.findFirst = vi.fn().mockResolvedValue({
      id: 'vendor-1',
      tenantId: 'tenant-1',
      name: 'Old Name',
      email: null,
      phone: null,
      address: null,
      active: true,
      qboVendorId: '777',
    });
    (mockPrisma as any).vendor.update = vi.fn().mockResolvedValue({});

    const result = await applyQboVendor(
      'tenant-1',
      null,
      {
        Id: '777',
        DisplayName: 'New Name',
        PrimaryEmailAddr: { Address: 'new@test.com' },
      },
      'pull',
    );

    expect(result.created).toBe(false);
    expect(result.vendorId).toBe('vendor-1');
    expect((mockPrisma as any).vendor.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'vendor-1' },
        data: expect.objectContaining({ name: 'New Name', email: 'new@test.com' }),
      }),
    );
    const auditCalls = (mockPrisma.auditLog.create as any).mock.calls;
    const pulled = auditCalls.find((c: any) => c[0]?.data?.action === 'QBO_VENDOR_PULLED');
    expect(pulled).toBeTruthy();
    expect(pulled[0].data.changedFieldsJson.changed).toHaveProperty('name');
    expect(pulled[0].data.changedFieldsJson.changed).toHaveProperty('email');
  });

  it('skips audit log when nothing actually changed but still touches qboVendorSyncedAt', async () => {
    (mockPrisma as any).vendor.findFirst = vi.fn().mockResolvedValue({
      id: 'vendor-noop',
      tenantId: 'tenant-1',
      name: 'Same Name',
      email: 'same@test.com',
      phone: null,
      address: null,
      active: true,
      qboVendorId: '555',
    });
    (mockPrisma as any).vendor.update = vi.fn().mockResolvedValue({});

    await applyQboVendor(
      'tenant-1',
      null,
      {
        Id: '555',
        DisplayName: 'Same Name',
        PrimaryEmailAddr: { Address: 'same@test.com' },
        Active: true,
      },
      'pull',
    );

    expect((mockPrisma as any).vendor.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ qboVendorSyncedAt: expect.any(Date) }),
      }),
    );
    const auditCalls = (mockPrisma.auditLog.create as any).mock.calls;
    const pulled = auditCalls.find((c: any) => c[0]?.data?.action === 'QBO_VENDOR_PULLED');
    expect(pulled).toBeUndefined();
  });
});

describe('applyQboBill — upsert PurchaseOrder by qboBillId', () => {
  it('creates a new PurchaseOrder when none exists, linking the existing local vendor', async () => {
    (mockPrisma as any).vendor.findFirst = vi.fn().mockResolvedValue({
      id: 'vendor-existing',
      tenantId: 'tenant-1',
      qboVendorId: '888',
      name: 'ACME',
    });
    (mockPrisma as any).purchaseOrder.findFirst = vi.fn().mockResolvedValue(null);
    (mockPrisma as any).purchaseOrder.create = vi.fn().mockResolvedValue({ id: 'po-new' });

    const result = await applyQboBill(
      'tenant-1',
      'loc-1',
      {
        Id: '4242',
        DocNumber: 'BILL-4242',
        TxnDate: '2026-04-28',
        DueDate: '2026-05-28',
        TotalAmt: 125.50,
        Balance: 125.50,
        VendorRef: { value: '888', name: 'ACME' },
      },
      'pull',
    );

    expect(result.created).toBe(true);
    expect(result.purchaseOrderId).toBe('po-new');
    expect((mockPrisma as any).purchaseOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'tenant-1',
          locationId: 'loc-1',
          vendorId: 'vendor-existing',
          qboBillId: '4242',
          poNumber: 'BILL-4242',
          totalCents: 12550,
          status: 'received',
        }),
      }),
    );
    const audited = (mockPrisma.auditLog.create as any).mock.calls.find(
      (c: any) => c[0]?.data?.action === 'QBO_BILL_PULLED',
    );
    expect(audited).toBeTruthy();
  });

  it('creates a stub local Vendor when the bill references a vendor we have not seen yet', async () => {
    let vendorLookups = 0;
    (mockPrisma as any).vendor.findFirst = vi.fn().mockImplementation(() => {
      vendorLookups++;
      return Promise.resolve(null);
    });
    (mockPrisma as any).vendor.create = vi.fn().mockResolvedValue({
      id: 'vendor-stub',
      tenantId: 'tenant-1',
      qboVendorId: '300',
      name: 'New QBO Vendor',
    });
    (mockPrisma as any).purchaseOrder.findFirst = vi.fn().mockResolvedValue(null);
    (mockPrisma as any).purchaseOrder.create = vi.fn().mockResolvedValue({ id: 'po-stub' });

    await applyQboBill(
      'tenant-1',
      null,
      {
        Id: '7000',
        TotalAmt: 50,
        VendorRef: { value: '300', name: 'New QBO Vendor' },
      },
      'webhook',
    );

    expect(vendorLookups).toBeGreaterThanOrEqual(1);
    expect((mockPrisma as any).vendor.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ qboVendorId: '300' }),
      }),
    );
    expect((mockPrisma as any).purchaseOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ vendorId: 'vendor-stub', qboBillId: '7000' }),
      }),
    );
    const stubAudit = (mockPrisma.auditLog.create as any).mock.calls.find(
      (c: any) => c[0]?.data?.action === 'QBO_VENDOR_STUB_CREATED',
    );
    expect(stubAudit).toBeTruthy();
  });

  it('updates an existing PurchaseOrder matched by qboBillId rather than duplicating', async () => {
    (mockPrisma as any).vendor.findFirst = vi.fn().mockResolvedValue({
      id: 'vendor-1',
      qboVendorId: '888',
      name: 'ACME',
    });
    (mockPrisma as any).purchaseOrder.findFirst = vi.fn().mockResolvedValue({
      id: 'po-existing',
      tenantId: 'tenant-1',
      vendorId: 'vendor-1',
      poNumber: 'BILL-OLD',
      totalCents: 10000,
      status: 'received',
      qboBillId: '4242',
    });
    (mockPrisma as any).purchaseOrder.update = vi.fn().mockResolvedValue({});

    const result = await applyQboBill(
      'tenant-1',
      null,
      {
        Id: '4242',
        DocNumber: 'BILL-NEW',
        TotalAmt: 200,
        Balance: 200,
        VendorRef: { value: '888' },
      },
      'webhook',
    );

    expect(result.created).toBe(false);
    expect(result.purchaseOrderId).toBe('po-existing');
    expect((mockPrisma as any).purchaseOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'po-existing' },
        data: expect.objectContaining({ totalCents: 20000, poNumber: 'BILL-NEW' }),
      }),
    );
    expect((mockPrisma as any).purchaseOrder.create).not.toHaveBeenCalled();
  });
});

describe('pullVendorsAndBillsForTenant — iterates connected QBO endpoints', () => {
  it('returns empty endpoint list when neither tenant nor any location has QBO connected', async () => {
    mockPrisma.tenant.findUnique = vi.fn().mockResolvedValue({
      qboAccessToken: null,
      qboRealmId: null,
    });
    (mockPrisma as any).location.findMany = vi.fn().mockResolvedValue([]);

    const result = await pullVendorsAndBillsForTenant('tenant-1');
    expect(result.endpoints).toHaveLength(0);
    expect(result.vendors).toEqual({ created: 0, updated: 0, skipped: 0 });
    expect(result.bills).toEqual({ created: 0, updated: 0, skipped: 0 });
  });
});

describe('findFailedInventorySyncRefs — drives bulk retry endpoint', () => {
  it('queries only sync refs whose lastError is set and shapes them for the retry helper', async () => {
    const now = new Date();
    const failingRow = {
      qboType: 'Item',
      qboId: null,
      lastSyncedAt: null,
      lastError: 'QBO 401',
      lastErrorAt: now,
      sourceType: 'product',
      sourceId: 'inv-prod-100',
      locationId: 'loc-1',
      retryCount: 0,
      nextRetryAt: null,
    };
    const findMany = vi.fn().mockResolvedValue([failingRow]);
    (mockPrisma as any).qboInventorySyncRef.findMany = findMany;

    const mod = await import('../../src/services/qbo-sync.js');
    const refs = await mod.findFailedInventorySyncRefs('tenant-1');

    expect(findMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', lastError: { not: null } },
      orderBy: [{ lastErrorAt: 'asc' }],
    });
    expect(refs).toHaveLength(1);
    expect(refs[0]).toEqual({
      sourceType: 'product',
      sourceId: 'inv-prod-100',
      qboType: 'Item',
      qboId: null,
      locationId: 'loc-1',
      lastError: 'QBO 401',
      lastErrorAt: now,
      retryCount: 0,
      nextRetryAt: null,
    });
  });

  it('with dueOnly=true, filters out refs whose nextRetryAt is in the future', async () => {
    const now = new Date('2026-04-28T12:00:00Z');
    const findMany = vi.fn().mockResolvedValue([]);
    (mockPrisma as any).qboInventorySyncRef.findMany = findMany;

    const mod = await import('../../src/services/qbo-sync.js');
    await mod.findFailedInventorySyncRefs('tenant-1', { dueOnly: true, now });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-1',
        lastError: { not: null },
        OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
      },
      orderBy: [{ lastErrorAt: 'asc' }],
    });
  });
});

describe('computeRetryBackoffMs — exponential backoff for repeated sync failures', () => {
  it('starts at 15 minutes and doubles each retry, capping at 24 hours', async () => {
    const mod = await import('../../src/services/qbo-sync.js');
    const min = (n: number) => n * 60 * 1000;
    expect(mod.computeRetryBackoffMs(1)).toBe(min(15));
    expect(mod.computeRetryBackoffMs(2)).toBe(min(30));
    expect(mod.computeRetryBackoffMs(3)).toBe(min(60));
    expect(mod.computeRetryBackoffMs(4)).toBe(min(120));
    expect(mod.computeRetryBackoffMs(5)).toBe(min(240));
    expect(mod.computeRetryBackoffMs(6)).toBe(min(480));
    expect(mod.computeRetryBackoffMs(7)).toBe(min(960));
    // 8+ caps at 24h
    expect(mod.computeRetryBackoffMs(8)).toBe(min(24 * 60));
    expect(mod.computeRetryBackoffMs(20)).toBe(min(24 * 60));
  });
});

describe('nextQuarterHour — advertises the next sweep tick to the UI', () => {
  it('returns the next 15-minute boundary after the given time, in UTC', async () => {
    const mod = await import('../../src/services/qbo-sync.js');
    expect(mod.nextQuarterHour(new Date('2026-04-28T12:00:00Z')).toISOString())
      .toBe('2026-04-28T12:15:00.000Z');
    expect(mod.nextQuarterHour(new Date('2026-04-28T12:14:59Z')).toISOString())
      .toBe('2026-04-28T12:15:00.000Z');
    expect(mod.nextQuarterHour(new Date('2026-04-28T12:46:30Z')).toISOString())
      .toBe('2026-04-28T13:00:00.000Z');
  });
});

describe('findTenantsWithDueFailedInventorySyncs — drives the background sweep', () => {
  it('queries distinct tenantIds where lastError is set and nextRetryAt is null or past', async () => {
    const now = new Date('2026-04-28T12:00:00Z');
    const findMany = vi.fn().mockResolvedValue([
      { tenantId: 'tenant-a' },
      { tenantId: 'tenant-b' },
    ]);
    (mockPrisma as any).qboInventorySyncRef.findMany = findMany;

    const mod = await import('../../src/services/qbo-sync.js');
    const tenants = await mod.findTenantsWithDueFailedInventorySyncs(now);

    expect(findMany).toHaveBeenCalledWith({
      where: {
        lastError: { not: null },
        OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
      },
      select: { tenantId: true },
      distinct: ['tenantId'],
    });
    expect(tenants).toEqual(['tenant-a', 'tenant-b']);
  });
});

describe('writeSyncRefFailure backoff bookkeeping', () => {
  it('atomically increments retryCount and stamps nextRetryAt with exponential backoff on each failure', async () => {
    // Probe-first: findUnique returns an existing row, then update() is
    // called twice (increment then nextRetryAt stamp).
    (mockPrisma as any).qboInventorySyncRef.findUnique = vi
      .fn()
      .mockResolvedValue({ id: 'ref-1' });
    const update = vi.fn()
      .mockResolvedValueOnce({ retryCount: 3 })
      .mockResolvedValueOnce({});
    (mockPrisma as any).qboInventorySyncRef.update = update;
    (mockPrisma as any).qboInventorySyncRef.create = vi.fn();
    mockPrisma.glAccount.findFirst = vi.fn().mockResolvedValue(null);

    const before = Date.now();
    const mod = await import('../../src/services/qbo-sync.js');
    await expect(
      mod.syncInventoryItem(
        {
          productId: 'p-99',
          name: 'Test',
          sku: 'T-99',
          priceCents: 100,
          costCents: 50,
          trackInventory: true,
          incomeGlAccountId: null,
          inventoryAssetGlAccountId: 'gl-asset',
          cogsGlAccountId: 'gl-cogs',
        },
        'tenant-1',
      ),
    ).rejects.toThrow();
    const after = Date.now();

    // First update increments retryCount atomically.
    expect(update).toHaveBeenCalledTimes(2);
    const incArgs = update.mock.calls[0][0];
    expect(incArgs.data.retryCount).toEqual({ increment: 1 });
    expect(incArgs.data.lastError).toMatch(/Missing GL account/);

    // Second update stamps the nextRetryAt computed from the new retryCount.
    const stampArgs = update.mock.calls[1][0];
    const nextRetryAt: Date = stampArgs.data.nextRetryAt;
    expect(nextRetryAt).toBeInstanceOf(Date);
    const expectedDelay = 60 * 60 * 1000; // 1h for retryCount=3
    expect(nextRetryAt.getTime()).toBeGreaterThanOrEqual(before + expectedDelay - 10);
    expect(nextRetryAt.getTime()).toBeLessThanOrEqual(after + expectedDelay + 10);

    // No create on the existing-row path.
    expect((mockPrisma as any).qboInventorySyncRef.create).not.toHaveBeenCalled();
  });

  it('creates the ref with retryCount=1 on the very first failure (no scary P2025 log)', async () => {
    // Probe-first: findUnique returns null → we go straight to create without
    // ever issuing an update-of-missing-row that Prisma would log at error
    // level.
    (mockPrisma as any).qboInventorySyncRef.findUnique = vi.fn().mockResolvedValue(null);
    const update = vi.fn();
    (mockPrisma as any).qboInventorySyncRef.update = update;
    const create = vi.fn().mockResolvedValue({});
    (mockPrisma as any).qboInventorySyncRef.create = create;
    mockPrisma.glAccount.findFirst = vi.fn().mockResolvedValue(null);

    const before = Date.now();
    const mod = await import('../../src/services/qbo-sync.js');
    await expect(
      mod.syncInventoryItem(
        {
          productId: 'p-new',
          name: 'New',
          sku: 'N-1',
          priceCents: 100,
          costCents: 50,
          trackInventory: true,
          incomeGlAccountId: null,
          inventoryAssetGlAccountId: 'gl-asset',
          cogsGlAccountId: 'gl-cogs',
        },
        'tenant-1',
      ),
    ).rejects.toThrow();
    const after = Date.now();

    // No update call should ever occur on the first-failure path.
    expect(update).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(1);
    const args = create.mock.calls[0][0];
    expect(args.data.retryCount).toBe(1);
    const nextRetryAt: Date = args.data.nextRetryAt;
    const expectedDelay = 15 * 60 * 1000; // 15m for first retry
    expect(nextRetryAt.getTime()).toBeGreaterThanOrEqual(before + expectedDelay - 10);
    expect(nextRetryAt.getTime()).toBeLessThanOrEqual(after + expectedDelay + 10);
  });
});

// ===========================================================================
// syncPosTicketAsReceipt — QBO line `Amount === UnitPrice * Qty` invariant
// ===========================================================================
//
// Production POS receipts were failing with:
//   "Amount calculation incorrect in the request. Amount is not equal to
//    UnitPrice * Qty. Supplied value: 4.29"
// because the builder sent post-discount/post-tax `extendedCents` as Amount
// while sending the pre-discount `unitPriceCents` as UnitPrice. These tests
// pin down that every SalesItemLineDetail line we send to QBO satisfies the
// equality to the cent for the production failure shapes.
describe('syncPosTicketAsReceipt — Amount === UnitPrice * Qty invariant', () => {
  const tenantId = 'tenant-pos-1';
  const locationId = 'loc-pos-1';

  beforeEach(() => {
    (mockPrisma as any).location = {
      findUnique: vi.fn().mockResolvedValue({
        id: locationId,
        qboRealmId: 'realm-pos',
        qboAccessToken: 'access-token',
        qboRefreshToken: 'refresh-token',
        qboTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
        // For getLocationPostingAccounts — only undeposited funds is needed
        // for non-cash sales.
        arGlAccount: null,
        undepositedFundsGlAccount: { id: 'gl-uf', accountNumber: '1199', name: 'Undeposited Funds', qboAccountId: 'qbo-uf' },
        deferredRevenueGlAccount: null,
        defaultRevenueGlAccount: null,
        salesTaxGlAccount: null,
        earlyTerminationGlAccount: null,
        achReturnFeeGlAccount: null,
        bankGlAccount: null,
      }),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
    };
  });

  // Helper — builds a synthetic POS transaction matching the failing shape and
  // captures the JSON payload sent to QBO so we can assert on every line.
  async function runReceiptSync(tx: any): Promise<any> {
    (mockPrisma as any).posTransaction = {
      ...((mockPrisma as any).posTransaction ?? {}),
      findFirst: vi.fn().mockResolvedValue(tx),
    };

    const captured: any[] = [];
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(
      async (_url: any, init: any) => {
        if (init?.method === 'POST' && init?.body) {
          captured.push(JSON.parse(init.body as string));
        }
        return new Response('{"SalesReceipt":{"Id":"sr-1"}}', { status: 200 }) as any;
      },
    );

    try {
      const mod = await import('../../src/services/qbo-sync.js');
      await mod.syncPosTicketAsReceipt(tx.id, tenantId);
      // The salesreceipt payload is the last POST body.
      return captured[captured.length - 1];
    } finally {
      fetchSpy.mockRestore();
    }
  }

  it('reproduces the production "$4.29" failure: every line satisfies Amount === UnitPrice * Qty when discounts and line tax are present', async () => {
    // Production case: qty 3 @ $1.43 with a $0.50 discount and $0.30 line tax.
    // Old builder: Amount=extendedCents/100=(429-50+30)/100=4.09 but
    // UnitPrice*Qty = 1.43*3 = 4.29 → QBO rejects "Supplied value: 4.29".
    const tx = {
      id: 'tx-prod-failure',
      tenantId,
      taxCents: 30,
      totalCents: 429 - 50 + 30, // 409
      createdAt: new Date('2026-04-15T12:00:00Z'),
      status: 'CARD',
      shift: { locationId },
      customer: null,
      lineItems: [
        {
          id: 'li-1',
          quantity: 3,
          unitPriceCents: 143,
          discountCents: 50,
          taxCents: 30,
          extendedCents: 429 - 50 + 30, // 409 — the post-discount, post-tax value
          product: { id: 'p-1', name: 'Bag of Ice', qboItemId: 'qbo-item-1' },
        },
      ],
    };

    const payload = await runReceiptSync(tx);
    expect(payload).toBeDefined();
    expect(payload.Line).toBeDefined();

    // Every SalesItemLineDetail line must satisfy QBO's invariant exactly.
    for (const line of payload.Line) {
      if (line.DetailType !== 'SalesItemLineDetail') continue;
      const qty = line.SalesItemLineDetail.Qty;
      const unitPrice = line.SalesItemLineDetail.UnitPrice;
      expect(Math.round(line.Amount * 100)).toBe(Math.round(unitPrice * qty * 100));
    }

    // The item line carries the *pre-discount* subtotal as Amount.
    const itemLine = payload.Line.find((l: any) => l.SalesItemLineDetail?.ItemRef?.value === 'qbo-item-1');
    expect(itemLine).toBeDefined();
    expect(itemLine.Amount).toBe(4.29);
    expect(itemLine.SalesItemLineDetail.Qty).toBe(3);
    expect(itemLine.SalesItemLineDetail.UnitPrice).toBe(1.43);

    // Discount surfaced as a separate DiscountLineDetail line.
    const discountLine = payload.Line.find((l: any) => l.DetailType === 'DiscountLineDetail');
    expect(discountLine).toBeDefined();
    expect(discountLine.Amount).toBe(0.5);

    // Single sales-tax line, value drawn from tx.taxCents (no double-count).
    const taxLines = payload.Line.filter((l: any) => l.Description === 'Sales Tax');
    expect(taxLines).toHaveLength(1);
    expect(taxLines[0].Amount).toBe(0.3);

    // Receipt total ties out to the POS ticket total.
    expect(payload.TotalAmt).toBe(4.09);
  });

  it('handles mixed lines (qty 3 @ $1.43, qty 7 @ $0.99) with no discounts or tax', async () => {
    const tx = {
      id: 'tx-mixed',
      tenantId,
      taxCents: 0,
      totalCents: 143 * 3 + 99 * 7, // 429 + 693 = 1122
      createdAt: new Date('2026-04-15T12:00:00Z'),
      status: 'CARD',
      shift: { locationId },
      customer: null,
      lineItems: [
        { id: 'li-a', quantity: 3, unitPriceCents: 143, discountCents: 0, taxCents: 0, extendedCents: 429, product: { id: 'p-a', name: 'A', qboItemId: 'qbo-a' } },
        { id: 'li-b', quantity: 7, unitPriceCents: 99,  discountCents: 0, taxCents: 0, extendedCents: 693, product: { id: 'p-b', name: 'B', qboItemId: 'qbo-b' } },
      ],
    };

    const payload = await runReceiptSync(tx);
    for (const line of payload.Line) {
      if (line.DetailType !== 'SalesItemLineDetail') continue;
      const qty = line.SalesItemLineDetail.Qty;
      const unitPrice = line.SalesItemLineDetail.UnitPrice;
      expect(Math.round(line.Amount * 100)).toBe(Math.round(unitPrice * qty * 100));
    }
    expect(payload.TotalAmt).toBe(11.22);
    expect(payload.Line.find((l: any) => l.DetailType === 'DiscountLineDetail')).toBeUndefined();
  });

  it('aggregates multiple per-line discounts into a single receipt-level DiscountLineDetail', async () => {
    const tx = {
      id: 'tx-multi-disc',
      tenantId,
      taxCents: 0,
      totalCents: (200 * 2 - 25) + (500 * 1 - 75), // 375 + 425 = 800
      createdAt: new Date('2026-04-15T12:00:00Z'),
      status: 'CARD',
      shift: { locationId },
      customer: null,
      lineItems: [
        { id: 'li-1', quantity: 2, unitPriceCents: 200, discountCents: 25, taxCents: 0, extendedCents: 375, product: { id: 'p-1', name: 'X', qboItemId: 'qbo-x' } },
        { id: 'li-2', quantity: 1, unitPriceCents: 500, discountCents: 75, taxCents: 0, extendedCents: 425, product: { id: 'p-2', name: 'Y', qboItemId: 'qbo-y' } },
      ],
    };

    const payload = await runReceiptSync(tx);
    const discountLines = payload.Line.filter((l: any) => l.DetailType === 'DiscountLineDetail');
    expect(discountLines).toHaveLength(1);
    expect(discountLines[0].Amount).toBe(1.0); // (25 + 75) / 100
    expect(payload.TotalAmt).toBe(8.0);
    for (const line of payload.Line) {
      if (line.DetailType !== 'SalesItemLineDetail') continue;
      const qty = line.SalesItemLineDetail.Qty;
      const unitPrice = line.SalesItemLineDetail.UnitPrice;
      expect(Math.round(line.Amount * 100)).toBe(Math.round(unitPrice * qty * 100));
    }
  });

  it('throws when computed total drifts from PosTransaction.totalCents (defense in depth)', async () => {
    const tx = {
      id: 'tx-drift',
      tenantId,
      taxCents: 0,
      totalCents: 9999, // intentionally wrong vs lines (429)
      createdAt: new Date('2026-04-15T12:00:00Z'),
      status: 'CARD',
      shift: { locationId },
      customer: null,
      lineItems: [
        { id: 'li-1', quantity: 3, unitPriceCents: 143, discountCents: 0, taxCents: 0, extendedCents: 429, product: { id: 'p-1', name: 'X', qboItemId: 'qbo-x' } },
      ],
    };

    (mockPrisma as any).posTransaction = {
      ...((mockPrisma as any).posTransaction ?? {}),
      findFirst: vi.fn().mockResolvedValue(tx),
    };
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{"SalesReceipt":{"Id":"sr-1"}}', { status: 200 }) as any,
    );
    try {
      const mod = await import('../../src/services/qbo-sync.js');
      await expect(mod.syncPosTicketAsReceipt(tx.id, tenantId)).rejects.toThrow(/total mismatch/);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

// ===========================================================================
// syncInvoice — QBO line `Amount === UnitPrice * Qty` invariant (Task #312)
// ===========================================================================
//
// The customer-invoice → QBO Invoice line builder previously used the same
// pattern that broke POS receipts in Task #309: it sent post-discount/post-tax
// `extendedCents` as `Line.Amount` while sending the pre-discount
// `unitPriceCents` as `UnitPrice`. The moment a customer invoice line carries
// a discount (or per-line tax that doesn't divide cleanly), QBO rejects the
// whole invoice with "Amount is not equal to UnitPrice * Qty". These tests
// pin the invoice builder to the same invariant.
describe('syncInvoice — Amount === UnitPrice * Qty invariant (discounts/tax)', () => {
  const tenantId = 'tenant-inv-1';
  const locationId = 'loc-inv-1';

  beforeEach(() => {
    (mockPrisma as any).location = {
      findUnique: vi.fn().mockResolvedValue({
        id: locationId,
        qboRealmId: 'realm-inv',
        qboAccessToken: 'access-token',
        qboRefreshToken: 'refresh-token',
        qboTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
        arGlAccount: null,
        undepositedFundsGlAccount: null,
        deferredRevenueGlAccount: null,
        defaultRevenueGlAccount: null,
        salesTaxGlAccount: null,
        earlyTerminationGlAccount: null,
        achReturnFeeGlAccount: null,
      }),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
    };
    mockPrisma.invoice.update = vi.fn().mockResolvedValue({}) as any;
    (mockPrisma as any).qboInventorySyncRef = {
      ...((mockPrisma as any).qboInventorySyncRef ?? {}),
      findMany: vi.fn().mockResolvedValue([]),
    };
  });

  async function runInvoiceSync(invoice: any): Promise<any> {
    mockPrisma.invoice.findFirst = vi.fn().mockResolvedValue(invoice) as any;

    const captured: any[] = [];
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(
      async (_url: any, init: any) => {
        if (init?.method === 'POST' && init?.body) {
          captured.push(JSON.parse(init.body as string));
        }
        return new Response('{"Invoice":{"Id":"inv-qbo-1"}}', { status: 200 }) as any;
      },
    );

    try {
      const mod = await import('../../src/services/qbo-sync.js');
      await mod.syncInvoice(invoice.id, tenantId);
      return captured[captured.length - 1];
    } finally {
      fetchSpy.mockRestore();
    }
  }

  it('reproduces the discounted-invoice failure: every SalesItemLineDetail line satisfies Amount === UnitPrice * Qty', async () => {
    // Same shape as the POS production failure: qty 3 @ $1.43 with $0.50
    // discount and $0.30 line tax. Pre-fix: Amount=extendedCents/100=4.09 but
    // UnitPrice*Qty=4.29 → QBO rejects.
    const invoice = {
      id: 'inv-disc-1',
      tenantId,
      locationId,
      qboInvoiceId: null,
      invoiceNumber: 'INV-1001',
      memo: null,
      dueDate: new Date('2026-05-15T00:00:00Z'),
      issuedDate: new Date('2026-04-15T00:00:00Z'),
      subtotalCents: 429,
      taxCents: 30,
      totalCents: 429 - 50 + 30, // 409
      customer: {
        id: 'cust-1',
        firstName: 'Jane',
        lastName: 'Smith',
        email: 'jane@test.com',
        qboCustomerId: 'qbo-cust-1',
      },
      lineItems: [
        {
          id: 'li-1',
          description: 'Slip rental',
          quantity: 3,
          unitPriceCents: 143,
          discountCents: 50,
          taxCents: 30,
          extendedCents: 429 - 50 + 30,
          sourceType: null,
          sourceId: null,
          qboItemId: 'qbo-item-1',
        },
      ],
    };

    const payload = await runInvoiceSync(invoice);
    expect(payload).toBeDefined();
    expect(payload.Line).toBeDefined();

    for (const line of payload.Line) {
      if (line.DetailType !== 'SalesItemLineDetail') continue;
      const qty = line.SalesItemLineDetail.Qty;
      const unitPrice = line.SalesItemLineDetail.UnitPrice;
      expect(Math.round(line.Amount * 100)).toBe(Math.round(unitPrice * qty * 100));
    }

    const itemLine = payload.Line.find(
      (l: any) => l.SalesItemLineDetail?.ItemRef?.value === 'qbo-item-1',
    );
    expect(itemLine).toBeDefined();
    expect(itemLine.Amount).toBe(4.29);
    expect(itemLine.SalesItemLineDetail.Qty).toBe(3);
    expect(itemLine.SalesItemLineDetail.UnitPrice).toBe(1.43);

    const discountLine = payload.Line.find((l: any) => l.DetailType === 'DiscountLineDetail');
    expect(discountLine).toBeDefined();
    expect(discountLine.Amount).toBe(0.5);

    const taxLines = payload.Line.filter((l: any) => l.Description === 'Sales Tax');
    expect(taxLines).toHaveLength(1);
    expect(taxLines[0].Amount).toBe(0.3);

    // Sum of QBO line amounts (item subtotals + tax - discount) ties to
    // Invoice.totalCents — i.e. QBO will compute the same TotalAmt.
    const sumCents = payload.Line.reduce((acc: number, l: any) => {
      if (l.DetailType === 'DiscountLineDetail') return acc - Math.round(l.Amount * 100);
      return acc + Math.round(l.Amount * 100);
    }, 0);
    expect(sumCents).toBe(invoice.totalCents);
  });

  it('throws when computed invoice total drifts from Invoice.totalCents (defense in depth)', async () => {
    const invoice = {
      id: 'inv-drift',
      tenantId,
      locationId,
      qboInvoiceId: null,
      invoiceNumber: 'INV-9999',
      memo: null,
      dueDate: null,
      issuedDate: null,
      subtotalCents: 429,
      taxCents: 0,
      totalCents: 9999, // intentionally wrong
      customer: {
        id: 'cust-2',
        firstName: 'A',
        lastName: 'B',
        email: 'a@b.com',
        qboCustomerId: 'qbo-cust-2',
      },
      lineItems: [
        {
          id: 'li-1',
          description: 'Item',
          quantity: 3,
          unitPriceCents: 143,
          discountCents: 0,
          taxCents: 0,
          extendedCents: 429,
          sourceType: null,
          sourceId: null,
          qboItemId: null,
        },
      ],
    };

    mockPrisma.invoice.findFirst = vi.fn().mockResolvedValue(invoice) as any;
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{"Invoice":{"Id":"x"}}', { status: 200 }) as any,
    );
    try {
      const mod = await import('../../src/services/qbo-sync.js');
      await expect(mod.syncInvoice(invoice.id, tenantId)).rejects.toThrow(/total mismatch/);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
