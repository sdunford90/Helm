import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createTestApp, buildPayment, buildCustomer, buildInvoice } from '../helpers.js';
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

describe('GET /api/payments', () => {
  it('returns a paginated list of payments', async () => {
    const payments = [buildPayment(), buildPayment({ id: 'pay-2', amountCents: 50000 })];
    mockPrisma.payment.findMany.mockResolvedValue(payments);
    mockPrisma.payment.count.mockResolvedValue(2);

    const res = await request(app).get('/api/payments');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('pagination');
    expect(res.body.data).toHaveLength(2);
    expect(res.body.pagination).toHaveProperty('total', 2);
    expect(res.body.pagination).toHaveProperty('skip');
    expect(res.body.pagination).toHaveProperty('take');
  });

  it('returns empty list when no payments exist', async () => {
    mockPrisma.payment.findMany.mockResolvedValue([]);
    mockPrisma.payment.count.mockResolvedValue(0);

    const res = await request(app).get('/api/payments');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.pagination.total).toBe(0);
  });

  it('supports method filter', async () => {
    mockPrisma.payment.findMany.mockResolvedValue([]);
    mockPrisma.payment.count.mockResolvedValue(0);

    const res = await request(app).get('/api/payments?method=CARD');

    expect(res.status).toBe(200);
    expect(mockPrisma.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ method: 'CARD' }),
      }),
    );
  });

  it('supports status filter', async () => {
    mockPrisma.payment.findMany.mockResolvedValue([]);
    mockPrisma.payment.count.mockResolvedValue(0);

    const res = await request(app).get('/api/payments?status=COMPLETED');

    expect(res.status).toBe(200);
    expect(mockPrisma.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'COMPLETED' }),
      }),
    );
  });
});

describe('POST /api/payments', () => {
  it('records a cash payment successfully', async () => {
    const customer = buildCustomer();
    const payment = buildPayment({ method: 'CASH', stripePaymentId: null });

    mockPrisma.customer.findFirst.mockResolvedValue(customer);
    // $transaction mock calls the function with mockPrisma
    mockPrisma.payment.create.mockResolvedValue(payment);
    mockPrisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .post('/api/payments')
      .send({
        customerId: '550e8400-e29b-41d4-a716-446655440000',
        amountCents: 107000,
        method: 'CASH',
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('amountCents');
  });

  it('records a payment against an invoice', async () => {
    const customer = buildCustomer();
    const invoice = {
      id: 'inv-1',
      balanceCents: 107000,
      status: 'ISSUED',
      customerId: '550e8400-e29b-41d4-a716-446655440000',
    };
    const payment = buildPayment({ method: 'CASH' });

    mockPrisma.customer.findFirst.mockResolvedValue(customer);
    mockPrisma.invoice.findFirst.mockResolvedValue(invoice);
    mockPrisma.payment.create.mockResolvedValue(payment);
    mockPrisma.invoice.update.mockResolvedValue({});
    mockPrisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .post('/api/payments')
      .send({
        customerId: '550e8400-e29b-41d4-a716-446655440000',
        invoiceId: '550e8400-e29b-41d4-a716-446655440001',
        amountCents: 107000,
        method: 'CASH',
      });

    expect(res.status).toBe(201);
  });

  it('rejects payment when customer not found', async () => {
    mockPrisma.customer.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/payments')
      .send({
        customerId: '550e8400-e29b-41d4-a716-446655440000',
        amountCents: 107000,
        method: 'CASH',
      });

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('code', 'CUSTOMER_NOT_FOUND');
  });

  it('rejects missing customerId', async () => {
    const res = await request(app)
      .post('/api/payments')
      .send({
        amountCents: 107000,
        method: 'CASH',
      });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
  });

  it('rejects missing amountCents', async () => {
    const res = await request(app)
      .post('/api/payments')
      .send({
        customerId: '550e8400-e29b-41d4-a716-446655440000',
        method: 'CASH',
      });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
  });

  it('rejects zero amountCents', async () => {
    const res = await request(app)
      .post('/api/payments')
      .send({
        customerId: '550e8400-e29b-41d4-a716-446655440000',
        amountCents: 0,
        method: 'CASH',
      });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
  });

  it('rejects invalid payment method', async () => {
    const res = await request(app)
      .post('/api/payments')
      .send({
        customerId: '550e8400-e29b-41d4-a716-446655440000',
        amountCents: 107000,
        method: 'BITCOIN',
      });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
  });

  it('rejects overpayment on invoice', async () => {
    const customer = buildCustomer();
    const invoice = {
      id: 'inv-1',
      balanceCents: 50000,
      status: 'ISSUED',
      customerId: '550e8400-e29b-41d4-a716-446655440000',
    };

    mockPrisma.customer.findFirst.mockResolvedValue(customer);
    mockPrisma.invoice.findFirst.mockResolvedValue(invoice);

    const res = await request(app)
      .post('/api/payments')
      .send({
        customerId: '550e8400-e29b-41d4-a716-446655440000',
        invoiceId: '550e8400-e29b-41d4-a716-446655440001',
        amountCents: 100000,
        method: 'CASH',
      });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'OVERPAYMENT');
  });

  it('rejects payment on voided invoice', async () => {
    const customer = buildCustomer();
    const invoice = {
      id: 'inv-1',
      balanceCents: 107000,
      status: 'VOID',
      customerId: '550e8400-e29b-41d4-a716-446655440000',
    };

    mockPrisma.customer.findFirst.mockResolvedValue(customer);
    mockPrisma.invoice.findFirst.mockResolvedValue(invoice);

    const res = await request(app)
      .post('/api/payments')
      .send({
        customerId: '550e8400-e29b-41d4-a716-446655440000',
        invoiceId: '550e8400-e29b-41d4-a716-446655440001',
        amountCents: 107000,
        method: 'CASH',
      });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'INVOICE_VOID');
  });
});
