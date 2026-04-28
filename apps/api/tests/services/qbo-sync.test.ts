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
