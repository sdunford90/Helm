import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { mockPrisma } from '../setup.js';
import { buildTenant } from '../helpers.js';

let app: any;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('../../src/index.js');
  app = mod.default;
});

describe('GET /api/settings/marina', () => {
  it('returns tenant marina profile settings', async () => {
    const tenant = buildTenant({
      name: 'Sunrise Marina',
      timezone: 'America/New_York',
      fiscalYearEnd: '12/31',
      brandingJson: {
        address: '123 Harbor Dr',
        phone: '555-0100',
        email: 'info@sunrise.com',
        website: 'https://sunrise.com',
      },
    });

    mockPrisma.tenant.findUnique.mockResolvedValue(tenant);

    const res = await request(app).get('/api/settings/marina');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('name', 'Sunrise Marina');
    expect(res.body).toHaveProperty('timezone', 'America/New_York');
    expect(res.body).toHaveProperty('fiscalYearEnd', '12/31');
    expect(res.body).toHaveProperty('address', '123 Harbor Dr');
    expect(res.body).toHaveProperty('phone', '555-0100');
    expect(res.body).toHaveProperty('email', 'info@sunrise.com');
  });

  it('returns 404 when tenant not found', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue(null);

    const res = await request(app).get('/api/settings/marina');

    expect(res.status).toBe(404);
  });
});

describe('PUT /api/settings/marina', () => {
  it('updates tenant marina profile settings', async () => {
    const existing = buildTenant({
      name: 'Old Name',
      timezone: 'America/Chicago',
      fiscalYearEnd: '12/31',
      brandingJson: {},
    });
    const updated = buildTenant({
      name: 'New Marina Name',
      timezone: 'America/Los_Angeles',
      fiscalYearEnd: '06/30',
      brandingJson: {
        address: '456 Dock Rd',
        phone: '555-0200',
        email: 'new@marina.com',
        website: '',
      },
    });

    mockPrisma.tenant.findUnique.mockResolvedValue(existing);
    mockPrisma.tenant.update.mockResolvedValue(updated);

    const res = await request(app)
      .put('/api/settings/marina')
      .send({
        name: 'New Marina Name',
        timezone: 'America/Los_Angeles',
        fiscalYearEnd: '06/30',
        address: '456 Dock Rd',
        phone: '555-0200',
        email: 'new@marina.com',
      });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('name', 'New Marina Name');
    expect(res.body).toHaveProperty('timezone', 'America/Los_Angeles');
  });

  it('rejects invalid fiscal year format', async () => {
    const existing = buildTenant();
    mockPrisma.tenant.findUnique.mockResolvedValue(existing);

    const res = await request(app)
      .put('/api/settings/marina')
      .send({
        name: 'My Marina',
        timezone: 'America/New_York',
        fiscalYearEnd: 'invalid',
      });

    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/settings/catalog/dockage-rates/:id — safeguards linked contracts', () => {
  const RATE_ID = 'rate-to-delete';

  it('returns 409 when active contracts are linked and confirm is missing', async () => {
    mockPrisma.dockageRate.findFirst.mockResolvedValue({ id: RATE_ID, tenantId: 'test-tenant-id' });
    mockPrisma.slipContract.count.mockResolvedValue(3);

    const res = await request(app).delete(`/api/settings/catalog/dockage-rates/${RATE_ID}`);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DOCKAGE_RATE_HAS_LINKED_CONTRACTS');
    expect(res.body.linkedContractCount).toBe(3);
    expect(mockPrisma.dockageRate.delete).not.toHaveBeenCalled();
  });

  it('proceeds with delete when confirm: true is sent', async () => {
    mockPrisma.dockageRate.findFirst.mockResolvedValue({ id: RATE_ID, tenantId: 'test-tenant-id' });
    mockPrisma.slipContract.count.mockResolvedValue(2);
    mockPrisma.dockageRate.delete.mockResolvedValue({ id: RATE_ID });

    const res = await request(app)
      .delete(`/api/settings/catalog/dockage-rates/${RATE_ID}`)
      .send({ confirm: true });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(mockPrisma.dockageRate.delete).toHaveBeenCalledWith({ where: { id: RATE_ID } });
  });

  it('proceeds without confirm when no active contracts are linked', async () => {
    mockPrisma.dockageRate.findFirst.mockResolvedValue({ id: RATE_ID, tenantId: 'test-tenant-id' });
    mockPrisma.slipContract.count.mockResolvedValue(0);
    mockPrisma.dockageRate.delete.mockResolvedValue({ id: RATE_ID });

    const res = await request(app).delete(`/api/settings/catalog/dockage-rates/${RATE_ID}`);

    expect(res.status).toBe(200);
    expect(mockPrisma.dockageRate.delete).toHaveBeenCalled();
  });
});

describe('POST /api/settings/qbo/inventory-resync (job-based)', () => {
  it('returns 202 with a jobId so the UI can poll progress', async () => {
    // No failed sync refs → the background job completes near-instantly with
    // zero work, but the POST still needs to return a jobId for the UI flow.
    mockPrisma.qboInventorySyncRef.findMany.mockResolvedValue([]);

    const res = await request(app).post('/api/settings/qbo/inventory-resync').send({});

    expect(res.status).toBe(202);
    expect(res.body).toHaveProperty('jobId');
    expect(typeof res.body.jobId).toBe('string');
    expect(res.body).toHaveProperty('status', 'running');
    expect(res.body).toHaveProperty('processed', 0);
  });

  it('GET /qbo/inventory-resync/:jobId reports the job snapshot', async () => {
    mockPrisma.qboInventorySyncRef.findMany.mockResolvedValue([]);

    const start = await request(app).post('/api/settings/qbo/inventory-resync').send({});
    expect(start.status).toBe(202);
    const { jobId } = start.body;

    // Give the fire-and-forget runner a tick to flip from "running" to "succeeded".
    await new Promise((r) => setTimeout(r, 20));

    const poll = await request(app).get(`/api/settings/qbo/inventory-resync/${jobId}`);
    expect(poll.status).toBe(200);
    expect(poll.body).toHaveProperty('jobId', jobId);
    expect(poll.body).toHaveProperty('status', 'succeeded');
    expect(poll.body).toHaveProperty('processed', 0);
    expect(poll.body).toHaveProperty('attempted', 0);
    expect(poll.body).toHaveProperty('details');
  });

  it('GET returns 404 for unknown job ids', async () => {
    const res = await request(app).get('/api/settings/qbo/inventory-resync/no-such-job');
    expect(res.status).toBe(404);
  });
});
