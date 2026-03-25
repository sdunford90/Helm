import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createTestApp, buildSlip } from '../helpers.js';
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

describe('GET /api/slips', () => {
  it('returns a paginated list of slips', async () => {
    const slips = [
      buildSlip(),
      buildSlip({ id: 'slip-2', slipNumber: 'A-02' }),
    ];
    mockPrisma.slip.findMany.mockResolvedValue(slips);
    mockPrisma.slip.count.mockResolvedValue(2);

    const res = await request(app).get('/api/slips');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('pagination');
    expect(res.body.data).toHaveLength(2);
    expect(res.body.pagination).toHaveProperty('total', 2);
    expect(res.body.pagination).toHaveProperty('skip');
    expect(res.body.pagination).toHaveProperty('take');
  });

  it('returns empty list when no slips exist', async () => {
    mockPrisma.slip.findMany.mockResolvedValue([]);
    mockPrisma.slip.count.mockResolvedValue(0);

    const res = await request(app).get('/api/slips');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.pagination.total).toBe(0);
  });

  it('supports status filter', async () => {
    mockPrisma.slip.findMany.mockResolvedValue([]);
    mockPrisma.slip.count.mockResolvedValue(0);

    const res = await request(app).get('/api/slips?status=VACANT');

    expect(res.status).toBe(200);
    expect(mockPrisma.slip.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'VACANT' }),
      }),
    );
  });

  it('supports electricityMode filter', async () => {
    mockPrisma.slip.findMany.mockResolvedValue([]);
    mockPrisma.slip.count.mockResolvedValue(0);

    const res = await request(app).get('/api/slips?electricityMode=METERED');

    expect(res.status).toBe(200);
    expect(mockPrisma.slip.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ electricityMode: 'METERED' }),
      }),
    );
  });
});

describe('POST /api/slips', () => {
  it('creates a slip with valid data', async () => {
    const newSlip = buildSlip();
    mockPrisma.slip.findFirst.mockResolvedValue(null); // no duplicate
    mockPrisma.slip.create.mockResolvedValue(newSlip);
    mockPrisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .post('/api/slips')
      .send({ slipNumber: 'A-01', lengthFt: 40 });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('slipNumber', 'A-01');
    expect(mockPrisma.slip.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'test-tenant-id',
          slipNumber: 'A-01',
          lengthFt: 40,
        }),
      }),
    );
  });

  it('rejects duplicate slip number', async () => {
    mockPrisma.slip.findFirst.mockResolvedValue({ id: 'existing-slip' }); // duplicate exists

    const res = await request(app)
      .post('/api/slips')
      .send({ slipNumber: 'A-01', lengthFt: 40 });

    expect(res.status).toBe(409);
    expect(res.body).toHaveProperty('code', 'DUPLICATE_SLIP_NUMBER');
  });

  it('rejects missing slipNumber', async () => {
    const res = await request(app)
      .post('/api/slips')
      .send({ lengthFt: 40 });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
  });

  it('rejects missing lengthFt', async () => {
    const res = await request(app)
      .post('/api/slips')
      .send({ slipNumber: 'A-01' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
  });

  it('rejects negative lengthFt', async () => {
    const res = await request(app)
      .post('/api/slips')
      .send({ slipNumber: 'A-01', lengthFt: -10 });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
  });
});

describe('GET /api/slips/:id', () => {
  it('returns a single slip with contracts and meter readings', async () => {
    const slip = buildSlip({
      contracts: [
        {
          id: 'con-1',
          status: 'ACTIVE',
          customer: { id: 'cust-1', firstName: 'Jane', lastName: 'Smith', email: 'jane@test.com' },
          boat: { id: 'boat-1', name: 'Sea Breeze', lengthFt: 35, beamFt: 12 },
        },
      ],
      meterReadings: [],
      dockWalkItems: [],
    });
    mockPrisma.slip.findFirst.mockResolvedValue(slip);

    const res = await request(app).get('/api/slips/slip-1');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('id', 'slip-1');
    expect(res.body).toHaveProperty('slipNumber', 'A-01');
    expect(res.body).toHaveProperty('currentContract');
    expect(res.body.currentContract).toHaveProperty('status', 'ACTIVE');
  });

  it('returns 404 for non-existent slip', async () => {
    mockPrisma.slip.findFirst.mockResolvedValue(null);

    const res = await request(app).get('/api/slips/non-existent');

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('code', 'NOT_FOUND');
  });

  it('returns null currentContract when no active contract', async () => {
    const slip = buildSlip({
      contracts: [
        { id: 'con-1', status: 'EXPIRED', customer: {}, boat: {} },
      ],
      meterReadings: [],
      dockWalkItems: [],
    });
    mockPrisma.slip.findFirst.mockResolvedValue(slip);

    const res = await request(app).get('/api/slips/slip-1');

    expect(res.status).toBe(200);
    expect(res.body.currentContract).toBeNull();
  });
});
