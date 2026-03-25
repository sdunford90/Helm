import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { mockPrisma } from '../setup.js';
import { buildConciergeRequest, buildConciergeVendor, buildCustomer } from '../helpers.js';

let app: any;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('../../src/index.js');
  app = mod.default;
});

describe('GET /api/concierge/requests', () => {
  it('returns concierge requests with pagination', async () => {
    const requests = [
      buildConciergeRequest({ status: 'SUBMITTED' }),
      buildConciergeRequest({ status: 'COMPLETED' }),
    ];
    mockPrisma.conciergeRequest.findMany.mockResolvedValue(
      requests.map((r) => ({ ...r, customer: buildCustomer(), vendor: null })),
    );
    mockPrisma.conciergeRequest.count.mockResolvedValue(2);

    const res = await request(app).get('/api/concierge/requests');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body.data).toHaveLength(2);
    expect(res.body).toHaveProperty('total', 2);
  });
});

describe('POST /api/concierge/requests', () => {
  it('creates a concierge request', async () => {
    const customer = buildCustomer();
    const req = buildConciergeRequest({
      customerId: customer.id,
      serviceType: 'Hull Cleaning',
      status: 'SUBMITTED',
    });

    mockPrisma.customer.findUnique.mockResolvedValue(customer);
    mockPrisma.conciergeRequest.create.mockResolvedValue({
      ...req,
      customer,
    });

    const res = await request(app)
      .post('/api/concierge/requests')
      .send({
        customerId: customer.id,
        serviceType: 'Hull Cleaning',
        urgency: 'NORMAL',
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('data');
    expect(res.body.data).toHaveProperty('serviceType', 'Hull Cleaning');
    expect(res.body.data).toHaveProperty('status', 'SUBMITTED');
  });

  it('returns 404 when customer does not exist', async () => {
    mockPrisma.customer.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/concierge/requests')
      .send({
        customerId: '00000000-0000-0000-0000-000000000099',
        serviceType: 'Engine Repair',
      });

    expect(res.status).toBe(404);
  });
});

describe('GET /api/concierge/vendors', () => {
  it('returns vendor list', async () => {
    const vendors = [
      buildConciergeVendor({ name: 'Marine Mechanics Inc' }),
      buildConciergeVendor({ name: 'Bottom Paint Pros' }),
    ];
    mockPrisma.conciergeVendor.findMany.mockResolvedValue(vendors);

    const res = await request(app).get('/api/concierge/vendors');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body.data).toHaveLength(2);
  });
});
