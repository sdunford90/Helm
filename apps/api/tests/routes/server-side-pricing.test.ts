import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mockPrisma } from '../setup';
import { createPaymentIntent } from '../../src/lib/stripe.js';
import { errorHandler } from '../../src/middleware/error.js';
import transientRouter, { priceTransientStay } from '../../src/routes/transient.js';
import rampRouter, { rampPriceCents } from '../../src/routes/ramp.js';
import posRouter from '../../src/routes/pos.js';

const m = mockPrisma as any;

// Auth is mocked globally (tests/setup.ts) as an active MARINA_OWNER.
function app(path: string, router: express.Router) {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    req.tenantId = 'test-tenant-id';
    next();
  });
  a.use(path, router);
  a.use(errorHandler);
  return { a };
}

beforeEach(() => {
  vi.mocked(createPaymentIntent).mockClear();
  m.tenant.findUnique = vi.fn();
  m.customer.findFirst = vi.fn().mockResolvedValue({ id: 'cust-1' });
  m.slipContract.findFirst = vi.fn().mockResolvedValue(null);
  m.shift.findFirst = vi.fn().mockResolvedValue({ id: 'shift-1' });
  m.inventory.updateMany = vi.fn();
});

describe('transient pricing', () => {
  it('priceTransientStay = slip length × tenant rate per ft × nights', () => {
    expect(
      priceTransientStay({
        ratePerFtCents: 250,
        slipLengthFt: 40,
        checkIn: new Date('2026-07-01T15:00:00Z'),
        checkOut: new Date('2026-07-04T11:00:00Z'),
      }),
    ).toEqual({ rateCents: 10000, nights: 3, totalCents: 30000 });
  });

  it('refuses to price when no rate is configured', () => {
    expect(() =>
      priceTransientStay({
        ratePerFtCents: undefined,
        slipLengthFt: 40,
        checkIn: new Date('2026-07-01'),
        checkOut: new Date('2026-07-02'),
      }),
    ).toThrow(/not configured/);
  });

  it('ignores client totals and client Stripe account ids', async () => {
    m.slip.findUnique.mockResolvedValue({ id: 'slip-1', transientCapable: true, lengthFt: 40 });
    m.tenant.findUnique.mockResolvedValue({
      invoiceTemplateJson: { transientRatePerFtCents: 250 },
      stripeAccountId: 'acct_tenant_own',
    });
    m.transientBooking.create.mockImplementation(async ({ data }: any) => ({ id: 'b1', ...data }));

    const res = await request(app('/api/transient', transientRouter).a)
      .post('/api/transient')
      .send({
        slipId: '11111111-1111-4111-8111-111111111111',
        guestName: 'Guest',
        checkIn: '2026-07-01T15:00:00.000Z',
        checkOut: '2026-07-03T11:00:00.000Z',
        rateCents: 1,
        totalCents: 1,
        stripeConnectedAccountId: 'acct_attacker',
        collectPayment: true,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.totalCents).toBe(20000);
    expect(res.body.data.rateCents).toBe(10000);
    expect(createPaymentIntent).toHaveBeenCalledWith(20000, 'usd', 'acct_tenant_own', 600);
  });

  it('400s when the marina has no transient rate configured', async () => {
    m.slip.findUnique.mockResolvedValue({ id: 'slip-1', transientCapable: true, lengthFt: 40 });
    m.tenant.findUnique.mockResolvedValue({ invoiceTemplateJson: {}, stripeAccountId: null });
    const res = await request(app('/api/transient', transientRouter).a)
      .post('/api/transient')
      .send({
        slipId: '11111111-1111-4111-8111-111111111111',
        guestName: 'Guest',
        checkIn: '2026-07-01T15:00:00.000Z',
        checkOut: '2026-07-03T11:00:00.000Z',
        totalCents: 1,
      });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('TRANSIENT_RATE_NOT_CONFIGURED');
    expect(m.transientBooking.create).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ totalCents: 1 }) }),
    );
  });
});

describe('ramp pricing', () => {
  it('rampPriceCents reads tenant config and refuses when missing', () => {
    expect(rampPriceCents({ rampPricesCents: { SINGLE_LAUNCH: 1500 } }, 'SINGLE_LAUNCH')).toBe(1500);
    expect(() => rampPriceCents({}, 'SINGLE_LAUNCH')).toThrow(/not configured/);
    expect(() => rampPriceCents({ rampPricesCents: { DAILY_PASS: -5 } }, 'DAILY_PASS')).toThrow();
  });

  it("charges the configured price on the tenant's own account, ignoring client amount/account", async () => {
    m.tenant.findUnique.mockResolvedValue({
      invoiceTemplateJson: { rampPricesCents: { DAILY_PASS: 2500 } },
      stripeAccountId: 'acct_tenant_own',
    });
    m.rampTicket.create.mockImplementation(async ({ data }: any) => ({ id: 't1', ...data }));

    const res = await request(app('/api/ramp', rampRouter).a)
      .post('/api/ramp/tickets')
      .send({
        guestName: 'G',
        ticketType: 'DAILY_PASS',
        amountCents: 1,
        paymentMethod: 'CARD',
        stripeConnectedAccountId: 'acct_attacker',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.amountCents).toBe(2500);
    expect(createPaymentIntent).toHaveBeenCalledWith(2500, 'usd', 'acct_tenant_own', 75);
  });
});

describe('POS pricing', () => {
  beforeEach(() => {
    m.product.findMany.mockResolvedValue([
      { id: 'p1', tenantId: 'test-tenant-id', priceCents: 1000, taxClass: null, trackInventory: false },
    ]);
    m.posTransaction.create.mockImplementation(async ({ data }: any) => ({ id: 'tx1', ...data }));
    m.auditLog.create.mockResolvedValue({});
  });

  it('uses the DB unit price, not the client one', async () => {
    const res = await request(app('/api/pos', posRouter).a)
      .post('/api/pos/transactions')
      .send({ lineItems: [{ productId: 'p1', quantity: 2, unitPriceCents: 1 }] });
    expect(res.status).toBe(201);
    expect(res.body.subtotalCents).toBe(2000);
    expect(res.body.lineItems.create[0].unitPriceCents).toBe(1000);
  });

  it('rejects unknown products instead of selling them at a client price', async () => {
    const res = await request(app('/api/pos', posRouter).a)
      .post('/api/pos/transactions')
      .send({ lineItems: [{ productId: 'not-in-tenant', quantity: 1, unitPriceCents: 1 }] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('UNKNOWN_PRODUCT');
  });

  it('rejects discounts larger than the line', async () => {
    const res = await request(app('/api/pos', posRouter).a)
      .post('/api/pos/transactions')
      .send({ lineItems: [{ productId: 'p1', quantity: 1, discountCents: 5000 }] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('DISCOUNT_EXCEEDS_LINE');
  });
});
