import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { mockPrisma } from '../setup.js';
import { buildDockWalk, buildDockWalkItem } from '../helpers.js';

let app: any;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('../../src/index.js');
  app = mod.default;
});

describe('GET /api/dock-walks', () => {
  it('returns dock walk list with pagination', async () => {
    const walks = [
      buildDockWalk({ status: 'COMPLETED' }),
      buildDockWalk({ status: 'IN_PROGRESS' }),
    ];
    mockPrisma.dockWalk.findMany.mockResolvedValue(
      walks.map((w) => ({ ...w, items: [] })),
    );
    mockPrisma.dockWalk.count.mockResolvedValue(2);

    const res = await request(app).get('/api/dock-walks');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body.data).toHaveLength(2);
    expect(res.body).toHaveProperty('pagination');
    expect(res.body.pagination.total).toBe(2);
  });
});

describe('POST /api/dock-walks', () => {
  it('starts a new dock walk', async () => {
    const walk = buildDockWalk({ status: 'IN_PROGRESS' });

    mockPrisma.dockWalk.create.mockResolvedValue(walk);
    mockPrisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .post('/api/dock-walks')
      .send({ inspectorId: 'inspector-001' });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('status', 'IN_PROGRESS');
    expect(res.body).toHaveProperty('id');
  });
});

describe('GET /api/dock-walks/issues', () => {
  it('returns violation and needs-attention items', async () => {
    const items = [
      buildDockWalkItem({ status: 'VIOLATION', violationType: 'EXPIRED_REGISTRATION' }),
      buildDockWalkItem({ status: 'NEEDS_ATTENTION', notes: 'Loose dock line' }),
    ];

    mockPrisma.dockWalkItem.findMany.mockResolvedValue(
      items.map((item) => ({
        ...item,
        slip: { id: 'slip-1', slipNumber: 'A-1', dockId: 'dock-1' },
        dockWalk: {
          id: 'walk-1',
          startedAt: new Date(),
          inspectorId: 'inspector-001',
          status: 'COMPLETED',
        },
      })),
    );
    mockPrisma.dockWalkItem.count.mockResolvedValue(2);

    const res = await request(app).get('/api/dock-walks/issues');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body.data).toHaveLength(2);
    expect(res.body).toHaveProperty('pagination');
  });
});
