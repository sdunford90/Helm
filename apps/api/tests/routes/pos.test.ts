import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { mockPrisma } from '../setup.js';
import { buildPosProduct, buildPosTransaction, buildShift } from '../helpers.js';

let app: any;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('../../src/index.js');
  app = mod.default;
});

describe('GET /api/pos/products', () => {
  it('returns POS products with pagination', async () => {
    const products = [
      buildPosProduct({ name: 'Dock Line 20ft' }),
      buildPosProduct({ name: 'Fender Medium' }),
    ];
    mockPrisma.product.findMany.mockResolvedValue(products);
    mockPrisma.product.count.mockResolvedValue(2);

    const res = await request(app).get('/api/pos/products');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body.data).toHaveLength(2);
    expect(res.body).toHaveProperty('pagination');
    expect(res.body.pagination).toEqual(
      expect.objectContaining({ total: 2 }),
    );
  });
});

describe('POST /api/pos/transactions', () => {
  it('creates a transaction with line items', async () => {
    const product = buildPosProduct({ priceCents: 1500, taxClass: null });
    const transaction = buildPosTransaction({
      subtotalCents: 3000,
      taxCents: 0,
      tipCents: 0,
      totalCents: 3000,
    });

    mockPrisma.product.findMany.mockResolvedValue([product]);
    mockPrisma.posTransaction.create.mockResolvedValue({
      ...transaction,
      lineItems: [
        {
          productId: product.id,
          quantity: 2,
          unitPriceCents: 1500,
          discountCents: 0,
          taxCents: 0,
          extendedCents: 3000,
          product,
        },
      ],
    });
    mockPrisma.inventory.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .post('/api/pos/transactions')
      .send({
        lineItems: [
          {
            productId: product.id,
            quantity: 2,
            unitPriceCents: 1500,
          },
        ],
        paymentMethod: 'CASH',
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('totalCents');
    expect(res.body).toHaveProperty('lineItems');
  });
});

describe('POST /api/pos/shifts/open', () => {
  it('opens a shift with opening float', async () => {
    const shift = buildShift({ status: 'OPEN', openingFloatCents: 20000 });

    mockPrisma.shift.findFirst.mockResolvedValue(null); // no existing open shift
    mockPrisma.shift.create.mockResolvedValue(shift);
    mockPrisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .post('/api/pos/shifts/open')
      .send({ openingFloatCents: 20000 });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('status', 'OPEN');
    expect(res.body).toHaveProperty('openingFloatCents', 20000);
  });

  it('rejects opening a second shift for same cashier', async () => {
    const existingShift = buildShift({ status: 'OPEN' });
    mockPrisma.shift.findFirst.mockResolvedValue(existingShift);

    const res = await request(app)
      .post('/api/pos/shifts/open')
      .send({ openingFloatCents: 20000 });

    expect(res.status).toBe(400);
  });
});

describe('GET /api/pos/transactions', () => {
  it('returns transaction list with pagination', async () => {
    const transactions = [buildPosTransaction(), buildPosTransaction()];
    mockPrisma.posTransaction.findMany.mockResolvedValue(
      transactions.map((t) => ({ ...t, lineItems: [] })),
    );
    mockPrisma.posTransaction.count.mockResolvedValue(2);

    const res = await request(app).get('/api/pos/transactions');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body.data).toHaveLength(2);
    expect(res.body).toHaveProperty('pagination');
  });
});
