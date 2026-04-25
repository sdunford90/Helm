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
    const SLIP_UUID = '00000000-0000-0000-0000-000000000001';
    const slip = buildSlip({ id: SLIP_UUID, transientCapable: true });
    const booking = buildTransientBooking({
      slipId: SLIP_UUID,
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
        slipId: SLIP_UUID,
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
    const SLIP_UUID = '00000000-0000-0000-0000-000000000002';
    const slip = buildSlip({ id: SLIP_UUID, transientCapable: false });
    mockPrisma.slip.findUnique.mockResolvedValue(slip);

    const res = await request(app)
      .post('/api/transient')
      .send({
        slipId: SLIP_UUID,
        guestName: 'Jane Doe',
        checkIn: new Date().toISOString(),
        rateCents: 7500,
        totalCents: 7500,
      });

    expect(res.status).toBe(400);
  });
});
