import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createTestApp, buildLead } from '../helpers.js';
import { mockPrisma } from '../setup.js';

let app: Express;

beforeAll(async () => {
  app = await createTestApp();
});

beforeEach(() => {
  // Reset all mocks between tests
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

describe('GET /api/leads', () => {
  it('returns a paginated list of leads', async () => {
    const leads = [buildLead(), buildLead({ id: 'lead-2', firstName: 'Alice' })];
    mockPrisma.lead.findMany.mockResolvedValue(leads);
    mockPrisma.lead.count.mockResolvedValue(2);

    const res = await request(app).get('/api/leads');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('pagination');
    expect(res.body.data).toHaveLength(2);
    expect(res.body.pagination).toHaveProperty('total', 2);
    expect(res.body.pagination).toHaveProperty('page');
    expect(res.body.pagination).toHaveProperty('limit');
    expect(res.body.pagination).toHaveProperty('totalPages');
  });

  it('returns empty list when no leads exist', async () => {
    mockPrisma.lead.findMany.mockResolvedValue([]);
    mockPrisma.lead.count.mockResolvedValue(0);

    const res = await request(app).get('/api/leads');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.pagination.total).toBe(0);
  });

  it('supports stage filter query parameter', async () => {
    mockPrisma.lead.findMany.mockResolvedValue([]);
    mockPrisma.lead.count.mockResolvedValue(0);

    const res = await request(app).get('/api/leads?stage=NEW');

    expect(res.status).toBe(200);
    expect(mockPrisma.lead.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ stage: 'NEW' }),
      }),
    );
  });
});

describe('POST /api/leads', () => {
  it('creates a lead with valid data', async () => {
    const newLead = buildLead();
    mockPrisma.lead.create.mockResolvedValue(newLead);
    mockPrisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .post('/api/leads')
      .send({ firstName: 'John', lastName: 'Doe' });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('firstName');
    expect(mockPrisma.lead.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'test-tenant-id',
          firstName: 'John',
          lastName: 'Doe',
        }),
      }),
    );
  });

  it('creates a lead with all optional fields', async () => {
    const newLead = buildLead({ email: 'john@test.com', phone: '5551234567', boatLength: 35 });
    mockPrisma.lead.create.mockResolvedValue(newLead);
    mockPrisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .post('/api/leads')
      .send({
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@test.com',
        phone: '5551234567',
        boatLength: 35,
      });

    expect(res.status).toBe(201);
    expect(mockPrisma.lead.create).toHaveBeenCalled();
  });

  it('rejects when firstName is missing', async () => {
    const res = await request(app)
      .post('/api/leads')
      .send({ lastName: 'Doe' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
    expect(res.body).toHaveProperty('details');
  });

  it('rejects when lastName is missing', async () => {
    const res = await request(app)
      .post('/api/leads')
      .send({ firstName: 'John' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
  });

  it('rejects invalid email format', async () => {
    const res = await request(app)
      .post('/api/leads')
      .send({ firstName: 'John', lastName: 'Doe', email: 'not-an-email' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
  });
});

describe('PUT /api/leads/:id', () => {
  it('updates a lead with valid data', async () => {
    const existing = buildLead();
    const updated = buildLead({ firstName: 'Johnny' });
    mockPrisma.lead.findFirst.mockResolvedValue(existing);
    mockPrisma.lead.update.mockResolvedValue(updated);
    mockPrisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .put('/api/leads/lead-1')
      .send({ firstName: 'Johnny' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('firstName', 'Johnny');
  });

  it('returns 404 for non-existent lead', async () => {
    mockPrisma.lead.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .put('/api/leads/non-existent')
      .send({ firstName: 'Johnny' });

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('code', 'NOT_FOUND');
  });
});

describe('PUT /api/leads/:id/stage', () => {
  it('advances lead stage one step', async () => {
    const existing = buildLead({ stage: 'NEW' });
    const updated = buildLead({ stage: 'CONTACTED' });
    mockPrisma.lead.findFirst.mockResolvedValue(existing);
    mockPrisma.lead.update.mockResolvedValue(updated);
    mockPrisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .put('/api/leads/lead-1/stage')
      .send({ stage: 'CONTACTED' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('stage', 'CONTACTED');
  });

  it('rejects skipping stages', async () => {
    const existing = buildLead({ stage: 'NEW' });
    mockPrisma.lead.findFirst.mockResolvedValue(existing);

    const res = await request(app)
      .put('/api/leads/lead-1/stage')
      .send({ stage: 'QUALIFIED' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'INVALID_STAGE_TRANSITION');
  });

  it('allows moving to LOST from any stage', async () => {
    const existing = buildLead({ stage: 'NEW' });
    const updated = buildLead({ stage: 'LOST', lostReason: 'Not interested' });
    mockPrisma.lead.findFirst.mockResolvedValue(existing);
    mockPrisma.lead.update.mockResolvedValue(updated);
    mockPrisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .put('/api/leads/lead-1/stage')
      .send({ stage: 'LOST', lostReason: 'Not interested' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('stage', 'LOST');
  });

  it('requires lostReason when moving to LOST', async () => {
    const existing = buildLead({ stage: 'NEW' });
    mockPrisma.lead.findFirst.mockResolvedValue(existing);

    const res = await request(app)
      .put('/api/leads/lead-1/stage')
      .send({ stage: 'LOST' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'LOST_REASON_REQUIRED');
  });

  it('returns 404 for non-existent lead', async () => {
    mockPrisma.lead.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .put('/api/leads/non-existent/stage')
      .send({ stage: 'CONTACTED' });

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('code', 'NOT_FOUND');
  });
});
