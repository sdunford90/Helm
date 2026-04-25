import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { mockPrisma } from '../setup.js';
import {
  buildRentalProduct,
  buildRentalReservation,
  buildPricingRule,
  buildCustomer,
} from '../helpers.js';

let app: any;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('../../src/index.js');
  app = mod.default;
});

describe('GET /api/rentals/products', () => {
  it('returns product list with pagination', async () => {
    const products = [
      buildRentalProduct({ name: 'Kayak' }),
      buildRentalProduct({ name: 'Paddleboard' }),
    ];
    mockPrisma.rentalProduct.findMany.mockResolvedValue(products);
    mockPrisma.rentalProduct.count.mockResolvedValue(2);

    const res = await request(app).get('/api/rentals/products');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body.data).toHaveLength(2);
    expect(res.body).toHaveProperty('pagination');
  });
});

describe('POST /api/rentals/products', () => {
  it('creates a rental product', async () => {
    const product = buildRentalProduct({
      name: 'Jet Ski',
      category: 'WATERCRAFT',
      hourlyRateCents: 7500,
    });
    mockPrisma.rentalProduct.create.mockResolvedValue(product);
    mockPrisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .post('/api/rentals/products')
      .send({
        name: 'Jet Ski',
        category: 'WATERCRAFT',
        hourlyRateCents: 7500,
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('name', 'Jet Ski');
  });
});

describe('GET /api/rentals/reservations', () => {
  it('returns reservations list', async () => {
    const reservations = [buildRentalReservation()];
    mockPrisma.rentalReservation.findMany.mockResolvedValue(reservations);
    mockPrisma.rentalReservation.count.mockResolvedValue(1);

    const res = await request(app).get('/api/rentals/reservations');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body.data).toHaveLength(1);
  });
});

describe('POST /api/rentals/reservations', () => {
  it('creates a reservation', async () => {
    const customer = buildCustomer();
    const product = buildRentalProduct({ totalQuantity: 5 });
    const reservation = buildRentalReservation({
      rentalProductId: product.id,
      status: 'CONFIRMED',
    });

    mockPrisma.customer.findFirst.mockResolvedValue(customer);
    mockPrisma.rentalProduct.findFirst.mockResolvedValue(product);
    mockPrisma.rentalReservation.findMany.mockResolvedValue([]);
    mockPrisma.rentalReservation.create.mockResolvedValue(reservation);
    mockPrisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .post('/api/rentals/reservations')
      .send({
        customerId: reservation.customerId,
        rentalProductId: product.id,
        startDate: '2025-06-01T09:00:00Z',
        endDate: '2025-06-01T17:00:00Z',
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
  });
});

describe('GET /api/rentals/pricing-rules', () => {
  it('returns pricing rules', async () => {
    const rules = [
      buildPricingRule({ type: 'FLAT', baseRateCents: 5000 }),
      buildPricingRule({ type: 'PER_FOOT', baseRateCents: 200 }),
    ];
    mockPrisma.pricingRule.findMany.mockResolvedValue(rules);
    mockPrisma.pricingRule.count.mockResolvedValue(2);

    const res = await request(app).get('/api/rentals/pricing-rules');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body.data).toHaveLength(2);
  });
});
