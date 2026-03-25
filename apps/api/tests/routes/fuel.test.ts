import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { mockPrisma } from '../setup.js';

let app: any;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('../../src/index.js');
  app = mod.default;
});

describe('GET /api/fuel/types', () => {
  it('returns fuel types with pricing and tank levels', async () => {
    const res = await request(app).get('/api/fuel/types');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('fuelTypes');
    expect(Array.isArray(res.body.fuelTypes)).toBe(true);
    expect(res.body.fuelTypes.length).toBeGreaterThan(0);

    const fuelType = res.body.fuelTypes[0];
    expect(fuelType).toHaveProperty('type');
    expect(fuelType).toHaveProperty('priceCentsPerGallon');
    expect(fuelType).toHaveProperty('costCentsPerGallon');
    expect(fuelType).toHaveProperty('marginCents');
    expect(fuelType).toHaveProperty('tankCapacityGallons');
    expect(fuelType).toHaveProperty('currentLevelGallons');
    expect(fuelType).toHaveProperty('levelPercent');
  });
});

describe('POST /api/fuel/sales', () => {
  it('records a fuel sale and returns computed total', async () => {
    const res = await request(app)
      .post('/api/fuel/sales')
      .send({
        fuelType: 'REGULAR',
        gallons: 50,
        guestName: 'Captain Hook',
        paymentMethod: 'CARD',
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('fuelType', 'REGULAR');
    expect(res.body).toHaveProperty('gallons', 50);
    expect(res.body).toHaveProperty('totalCents');
    expect(res.body.totalCents).toBeGreaterThan(0);
  });

  it('rejects invalid fuel type', async () => {
    const res = await request(app)
      .post('/api/fuel/sales')
      .send({
        fuelType: 'KEROSENE',
        gallons: 10,
      });

    expect(res.status).toBe(400);
  });
});

describe('GET /api/fuel/tank-levels', () => {
  it('returns tank level data for all fuel types', async () => {
    const res = await request(app).get('/api/fuel/tank-levels');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('tanks');
    expect(Array.isArray(res.body.tanks)).toBe(true);

    const tank = res.body.tanks[0];
    expect(tank).toHaveProperty('type');
    expect(tank).toHaveProperty('capacityGallons');
    expect(tank).toHaveProperty('currentGallons');
    expect(tank).toHaveProperty('levelPercent');
    expect(tank).toHaveProperty('estimatedDaysRemaining');
  });
});
