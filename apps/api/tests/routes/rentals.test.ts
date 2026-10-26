import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { mockPrisma } from '../setup.js';

// The rentals module is disabled until its Phase 3 rebuild: index.ts mounts
// routes/rentals-disabled.ts. routes/rentals.ts is kept (excluded from tsc)
// only as the rebuild reference.

let app: any;

beforeEach(async () => {
  const mod = await import('../../src/index.js');
  app = mod.default;
});

describe('/api/rentals (disabled)', () => {
  it.each([
    ['get', '/api/rentals/products'],
    ['post', '/api/rentals/products'],
    ['get', '/api/rentals/reservations'],
    ['post', '/api/rentals/reservations'],
    ['get', '/api/rentals/pricing-rules'],
    ['delete', '/api/rentals/products/prod-1'],
  ] as const)('%s %s returns 503 MODULE_DISABLED', async (method, path) => {
    const res = await (request(app) as any)[method](path).send({});
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'Rentals module is being rebuilt', code: 'MODULE_DISABLED' });
  });

  it('never touches the database', async () => {
    await request(app).get('/api/rentals/products');
    expect(mockPrisma.rentalProduct.findMany).not.toHaveBeenCalled();
  });
});
