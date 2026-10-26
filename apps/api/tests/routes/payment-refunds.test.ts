import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mockPrisma } from '../setup';
import { requireStripe } from '../../src/lib/stripe.js';
import { errorHandler } from '../../src/middleware/error.js';
import paymentsRouter, { refundableCents } from '../../src/routes/payments.js';

// A stateful fake payment row whose conditional updateMany behaves like the
// real `UPDATE ... WHERE refundedCents <= X` and whose $transaction rolls
// back on error.
const m = mockPrisma as any;
let row: any;

function app() {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    req.tenantId = 'test-tenant-id';
    next();
  });
  a.use('/api/payments', paymentsRouter);
  a.use(errorHandler);
  return a;
}

const refund = (amountCents?: number) =>
  request(app())
    .post('/api/payments/pay-1/refund')
    .send(amountCents === undefined ? {} : { amountCents });

beforeEach(() => {
  row = {
    id: 'pay-1',
    tenantId: 'test-tenant-id',
    amountCents: 10_000,
    refundedCents: 0,
    status: 'COMPLETED',
    method: 'CARD',
    stripePaymentId: 'pi_1',
    invoice: null,
  };
  m.payment.findFirst = vi.fn(async () => ({ ...row }));
  m.payment.findFirstOrThrow = vi.fn(async () => ({ ...row }));
  m.payment.updateMany = vi.fn(async ({ where, data }: any) => {
    const ok =
      where.id === row.id &&
      !where.status.notIn.includes(row.status) &&
      row.refundedCents <= where.refundedCents.lte;
    if (!ok) return { count: 0 };
    row.refundedCents += data.refundedCents.increment;
    return { count: 1 };
  });
  m.payment.update = vi.fn(async ({ data }: any) => {
    Object.assign(row, data);
    return { ...row };
  });
  m.tenant.findUnique = vi.fn(async () => ({ stripeAccountId: 'acct_tenant' }));
  m.auditLog.create = vi.fn(async () => ({}));
  m.$transaction = vi.fn(async (fn: any) => {
    const snapshot = { ...row };
    try {
      return await fn(mockPrisma);
    } catch (err) {
      row = snapshot; // rollback
      throw err;
    }
  });
  vi.mocked(requireStripe().refunds.create).mockReset().mockResolvedValue({ id: 're_1' } as any);
});

describe('refundableCents', () => {
  it('is amount minus already refunded, never negative', () => {
    expect(refundableCents({ amountCents: 100, refundedCents: 30 })).toBe(70);
    expect(refundableCents({ amountCents: 100, refundedCents: 130 })).toBe(0);
  });
});

describe('POST /api/payments/:id/refund — cumulative cap', () => {
  it('allows partial refunds up to the payment amount, then marks REFUNDED', async () => {
    const r1 = await refund(6_000);
    expect(r1.status).toBe(200);
    expect(r1.body.status).toBe('PARTIALLY_REFUNDED');
    expect(row.refundedCents).toBe(6_000);

    const r2 = await refund(4_000);
    expect(r2.status).toBe(200);
    expect(r2.body.status).toBe('REFUNDED');
    expect(row.refundedCents).toBe(10_000);
  });

  it('rejects a partial refund that would exceed amount - refunded', async () => {
    expect((await refund(6_000)).status).toBe(200);
    const r2 = await refund(5_000);
    expect(r2.status).toBe(400);
    expect(r2.body.code).toBe('EXCESS_REFUND');
    expect(row.refundedCents).toBe(6_000);
    expect(requireStripe().refunds.create).toHaveBeenCalledTimes(1);
  });

  it('a default (no amount) refund refunds only the remainder', async () => {
    await refund(2_500);
    const r = await refund();
    expect(r.status).toBe(200);
    expect(requireStripe().refunds.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ amount: 7_500 }),
      expect.objectContaining({ stripeAccount: 'acct_tenant', idempotencyKey: expect.any(String) }),
    );
  });

  it('the atomic reservation stops a refund that races past the cap', async () => {
    // Stale read: the handler sees refundedCents=0, but another refund has
    // already committed 8000 by the time the conditional update runs.
    m.payment.findFirst = vi.fn(async () => ({ ...row, refundedCents: 0 }));
    row.refundedCents = 8_000;
    const r = await refund(5_000);
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('EXCESS_REFUND');
    expect(row.refundedCents).toBe(8_000);
    expect(requireStripe().refunds.create).not.toHaveBeenCalled();
  });

  it('rolls the reservation back when Stripe fails', async () => {
    vi.mocked(requireStripe().refunds.create).mockRejectedValueOnce(new Error('card_declined'));
    const r = await refund(3_000);
    expect(r.status).toBe(500);
    expect(row.refundedCents).toBe(0);
  });
});
