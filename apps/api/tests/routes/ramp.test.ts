import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { mockPrisma } from '../setup.js';
import { buildRampTicket } from '../helpers.js';

let app: any;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('../../src/index.js');
  app = mod.default;
});

describe('GET /api/ramp/tickets', () => {
  it('returns ticket list with pagination', async () => {
    const tickets = [
      buildRampTicket({ ticketType: 'SINGLE_LAUNCH' }),
      buildRampTicket({ ticketType: 'DAILY_PASS' }),
    ];
    mockPrisma.rampTicket.findMany.mockResolvedValue(
      tickets.map((t) => ({ ...t, customer: null })),
    );
    mockPrisma.rampTicket.count.mockResolvedValue(2);

    const res = await request(app).get('/api/ramp/tickets');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body.data).toHaveLength(2);
    expect(res.body).toHaveProperty('total', 2);
  });
});

describe('POST /api/ramp/tickets', () => {
  it('creates a ramp ticket', async () => {
    const ticket = buildRampTicket({
      ticketType: 'SINGLE_LAUNCH',
      amountCents: 2500,
      guestName: 'Bob Smith',
    });

    mockPrisma.rampTicket.create.mockResolvedValue({
      ...ticket,
      customer: null,
    });

    const res = await request(app)
      .post('/api/ramp/tickets')
      .send({
        guestName: 'Bob Smith',
        ticketType: 'SINGLE_LAUNCH',
        amountCents: 2500,
        paymentMethod: 'CASH',
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('data');
    expect(res.body.data).toHaveProperty('ticketType', 'SINGLE_LAUNCH');
    expect(res.body.data).toHaveProperty('amountCents', 2500);
  });

  it('applies slip-holder discount when customer has active contract', async () => {
    const ticket = buildRampTicket({
      ticketType: 'SINGLE_LAUNCH',
      amountCents: 0,
      customerId: 'cust-123',
    });

    mockPrisma.slipContract.findFirst.mockResolvedValue({
      id: 'contract-1',
      status: 'ACTIVE',
    });
    mockPrisma.rampTicket.create.mockResolvedValue({
      ...ticket,
      customer: { id: 'cust-123' },
    });

    const res = await request(app)
      .post('/api/ramp/tickets')
      .send({
        customerId: 'cust-123',
        ticketType: 'SINGLE_LAUNCH',
        amountCents: 2500,
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('discountApplied', true);
  });
});
