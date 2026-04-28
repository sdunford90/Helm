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
