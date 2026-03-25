import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { mockPrisma } from '../setup.js';
import { buildTransientBooking, buildSlip } from '../helpers.js';

let app: any;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('../../src/index.js');
  app = mod.default;
});

describe('GET /api/transient', () => {
  it('returns transient bookings with pagination', async () => {
    const bookings = [
      buildTransientBooking({ status: 'BOOKED' }),
      buildTransientBooking({ status: 'CHECKED_IN' }),
    ];
    mockPrisma.transientBooking.findMany.mockResolvedValue(
      bookings.map((b) => ({ ...b, slip: buildSlip(), customer: null })),
    );
    mockPrisma.transientBooking.count.mockResolvedValue(2);

    const res = await request(app).get('/api/transient');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body.data).toHaveLength(2);
    expect(res.body).toHaveProperty('total', 2);
  });
});

describe('POST /api/transient', () => {
  it('creates a transient booking', async () => {
    const slip = buildSlip({ transientCapable: true });
    const booking = buildTransientBooking({
      slipId: slip.id,
      guestName: 'John Doe',
      status: 'BOOKED',
    });

    mockPrisma.slip.findUnique.mockResolvedValue(slip);
    mockPrisma.transientBooking.create.mockResolvedValue({
      ...booking,
      slip,
    });

    const res = await request(app)
      .post('/api/transient')
      .send({
        slipId: slip.id,
        guestName: 'John Doe',
        checkIn: new Date().toISOString(),
        rateCents: 7500,
        totalCents: 7500,
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('data');
    expect(res.body.data).toHaveProperty('status', 'BOOKED');
    expect(res.body.data).toHaveProperty('guestName', 'John Doe');
  });

  it('rejects booking on non-transient-capable slip', async () => {
    const slip = buildSlip({ transientCapable: false });
    mockPrisma.slip.findUnique.mockResolvedValue(slip);

    const res = await request(app)
      .post('/api/transient')
      .send({
        slipId: slip.id,
        guestName: 'Jane Doe',
        checkIn: new Date().toISOString(),
        rateCents: 7500,
        totalCents: 7500,
      });

    expect(res.status).toBe(400);
  });
});
