import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createTestApp, buildCustomer } from '../helpers.js';
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

describe('GET /api/customers', () => {
  it('returns a paginated list of customers', async () => {
    const customers = [buildCustomer(), buildCustomer({ id: 'cust-2', firstName: 'Bob' })];
    mockPrisma.customer.findMany.mockResolvedValue(customers);
    mockPrisma.customer.count.mockResolvedValue(2);
    mockPrisma.invoice.groupBy.mockResolvedValue([]);

    const res = await request(app).get('/api/customers');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('pagination');
    expect(res.body.data).toHaveLength(2);
    expect(res.body.pagination).toHaveProperty('total', 2);
    expect(res.body.pagination).toHaveProperty('skip');
    expect(res.body.pagination).toHaveProperty('take');
  });

  it('returns empty list when no customers exist', async () => {
    mockPrisma.customer.findMany.mockResolvedValue([]);
    mockPrisma.customer.count.mockResolvedValue(0);

    const res = await request(app).get('/api/customers');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.pagination.total).toBe(0);
  });

  it('supports status filter', async () => {
    mockPrisma.customer.findMany.mockResolvedValue([]);
    mockPrisma.customer.count.mockResolvedValue(0);

    const res = await request(app).get('/api/customers?status=ACTIVE');

    expect(res.status).toBe(200);
    expect(mockPrisma.customer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'ACTIVE' }),
      }),
    );
  });

  it('supports search query', async () => {
    mockPrisma.customer.findMany.mockResolvedValue([]);
    mockPrisma.customer.count.mockResolvedValue(0);

    const res = await request(app).get('/api/customers?search=Jane');

    expect(res.status).toBe(200);
    expect(mockPrisma.customer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({ firstName: expect.any(Object) }),
          ]),
        }),
      }),
    );
  });
});

describe('POST /api/customers', () => {
  it('creates a customer with valid data', async () => {
    const newCustomer = buildCustomer();
    mockPrisma.customer.create.mockResolvedValue(newCustomer);
    mockPrisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .post('/api/customers')
      .send({ firstName: 'Jane', lastName: 'Smith' });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('firstName');
    expect(mockPrisma.customer.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'test-tenant-id',
          firstName: 'Jane',
          lastName: 'Smith',
        }),
      }),
    );
  });

  it('creates a customer with optional fields', async () => {
    const newCustomer = buildCustomer({ email: 'jane@test.com', phone: '5559876543' });
    mockPrisma.customer.create.mockResolvedValue(newCustomer);
    mockPrisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .post('/api/customers')
      .send({
        firstName: 'Jane',
        lastName: 'Smith',
        email: 'jane@test.com',
        phone: '5559876543',
      });

    expect(res.status).toBe(201);
  });

  it('rejects invalid email', async () => {
    const res = await request(app)
      .post('/api/customers')
      .send({ firstName: 'Jane', lastName: 'Smith', email: 'bad-email' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(res.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'email' }),
      ]),
    );
  });

  it('rejects missing firstName', async () => {
    const res = await request(app)
      .post('/api/customers')
      .send({ lastName: 'Smith' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
  });

  it('rejects missing lastName', async () => {
    const res = await request(app)
      .post('/api/customers')
      .send({ firstName: 'Jane' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
  });
});

describe('GET /api/customers/:id', () => {
  it('returns a single customer with related data', async () => {
    const customer = buildCustomer({
      boats: [],
      slipContracts: [],
      securityDeposits: [],
    });
    mockPrisma.customer.findFirst.mockResolvedValue(customer);
    mockPrisma.invoice.groupBy.mockResolvedValue([]);
    mockPrisma.invoice.aggregate.mockResolvedValue({ _sum: { balanceCents: 0 } });
    mockPrisma.payment.aggregate.mockResolvedValue({ _sum: { amountCents: 0 } });
    mockPrisma.securityDeposit.aggregate.mockResolvedValue({ _sum: { amountCents: 0 } });

    const res = await request(app).get('/api/customers/cust-1');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('id', 'cust-1');
    expect(res.body).toHaveProperty('firstName');
    expect(res.body).toHaveProperty('invoiceSummary');
    expect(res.body).toHaveProperty('complianceScore');
    expect(res.body).toHaveProperty('balanceSummary');
  });

  it('returns 404 for non-existent customer', async () => {
    mockPrisma.customer.findFirst.mockResolvedValue(null);

    const res = await request(app).get('/api/customers/non-existent');

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('code', 'NOT_FOUND');
  });
});
