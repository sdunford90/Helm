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
