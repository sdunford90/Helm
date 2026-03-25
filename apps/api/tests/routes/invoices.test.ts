import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createTestApp, buildInvoice, buildCustomer } from '../helpers.js';
import { mockPrisma } from '../setup.js';

let app: Express;

beforeAll(async () => {
  app = await createTestApp();
});

beforeEach(() => {
  Object.values(mockPrisma).forEach((model) => {
    if (typeof model === 'object' && model !== null) {
      Object.values(model).forEach((fn) => {
        if (typeof fn === 'function' && 'mockReset' in fn) {
          (fn as any).mockReset();
        }
      });
    }
  });
});

describe('GET /api/invoices', () => {
  it('returns a paginated list of invoices', async () => {
    const invoices = [buildInvoice(), buildInvoice({ id: 'inv-2', invoiceNumber: 'INV-1002' })];
    mockPrisma.invoice.findMany.mockResolvedValue(invoices);
    mockPrisma.invoice.count.mockResolvedValue(2);

    const res = await request(app).get('/api/invoices');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('pagination');
    expect(res.body.data).toHaveLength(2);
    expect(res.body.pagination).toHaveProperty('total', 2);
    expect(res.body.pagination).toHaveProperty('skip');
    expect(res.body.pagination).toHaveProperty('take');
  });

  it('returns empty list when no invoices exist', async () => {
    mockPrisma.invoice.findMany.mockResolvedValue([]);
    mockPrisma.invoice.count.mockResolvedValue(0);

    const res = await request(app).get('/api/invoices');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.pagination.total).toBe(0);
  });

  it('supports status filter', async () => {
    mockPrisma.invoice.findMany.mockResolvedValue([]);
    mockPrisma.invoice.count.mockResolvedValue(0);

    const res = await request(app).get('/api/invoices?status=ISSUED');

    expect(res.status).toBe(200);
    expect(mockPrisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'ISSUED' }),
      }),
    );
  });

  it('supports customerId filter', async () => {
    mockPrisma.invoice.findMany.mockResolvedValue([]);
    mockPrisma.invoice.count.mockResolvedValue(0);

    const res = await request(app).get('/api/invoices?customerId=550e8400-e29b-41d4-a716-446655440000');

    expect(res.status).toBe(200);
    expect(mockPrisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ customerId: '550e8400-e29b-41d4-a716-446655440000' }),
      }),
    );
  });
});

describe('POST /api/invoices', () => {
  it('creates an invoice with line items', async () => {
    const customer = buildCustomer();
    const invoice = buildInvoice({ status: 'DRAFT' });
    mockPrisma.customer.findFirst.mockResolvedValue(customer);
    mockPrisma.invoice.create.mockResolvedValue(invoice);
    mockPrisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .post('/api/invoices')
      .send({
        customerId: '550e8400-e29b-41d4-a716-446655440000',
        issuedDate: '2025-01-15',
        dueDate: '2025-02-15',
        lineItems: [
          {
            description: 'Slip rental - January',
            quantity: 1,
            unitPriceCents: 100000,
          },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(mockPrisma.invoice.create).toHaveBeenCalled();
  });

  it('rejects invoice without line items', async () => {
    const res = await request(app)
      .post('/api/invoices')
      .send({
        customerId: '550e8400-e29b-41d4-a716-446655440000',
        issuedDate: '2025-01-15',
        dueDate: '2025-02-15',
        lineItems: [],
      });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
  });

  it('rejects invoice without customerId', async () => {
    const res = await request(app)
      .post('/api/invoices')
      .send({
        issuedDate: '2025-01-15',
        dueDate: '2025-02-15',
        lineItems: [{ description: 'Test', quantity: 1, unitPriceCents: 5000 }],
      });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
  });

  it('returns 404 when customer does not exist', async () => {
    mockPrisma.customer.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/invoices')
      .send({
        customerId: '550e8400-e29b-41d4-a716-446655440000',
        issuedDate: '2025-01-15',
        dueDate: '2025-02-15',
        lineItems: [{ description: 'Test', quantity: 1, unitPriceCents: 5000 }],
      });

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('code', 'CUSTOMER_NOT_FOUND');
  });
});

describe('GET /api/invoices/:id', () => {
  it('returns an invoice with line items and GL entries', async () => {
    const invoice = buildInvoice();
    mockPrisma.invoice.findFirst.mockResolvedValue(invoice);
    mockPrisma.glEntry.findMany.mockResolvedValue([]);

    const res = await request(app).get('/api/invoices/inv-1');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('id', 'inv-1');
    expect(res.body).toHaveProperty('invoiceNumber');
    expect(res.body).toHaveProperty('lineItems');
    expect(res.body).toHaveProperty('glEntries');
    expect(res.body).toHaveProperty('customer');
    expect(Array.isArray(res.body.lineItems)).toBe(true);
  });

  it('returns 404 for non-existent invoice', async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue(null);

    const res = await request(app).get('/api/invoices/non-existent');

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('code', 'NOT_FOUND');
  });
});
