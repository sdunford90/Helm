import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createTestApp, buildPayment, buildCustomer, buildInvoice } from '../helpers.js';
import { mockPrisma } from '../setup.js';
import { requireStripe } from '../../src/lib/stripe.js';
import { reversePostRefund } from '../../src/services/gl-posting.js';

// Mock the QBO sync helpers used by the refund handler so we can assert
// which branch (void vs refund-receipt) the route picks for each refund
// scenario, without executing real QBO HTTP calls. We import-actual to
// preserve the rest of the module's exports for other code paths that
// may transitively load it during the test app's bootstrap.
vi.mock('../../src/services/qbo-sync.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    voidQboPayment: vi.fn().mockResolvedValue(undefined),
    createQboRefundReceipt: vi
      .fn()
      .mockResolvedValue({ qboRefundReceiptId: 'RR-mock', skipped: false }),
  };
});

import { voidQboPayment, createQboRefundReceipt } from '../../src/services/qbo-sync.js';

let app: Express;

beforeAll(async () => {
  app = await createTestApp();
});

beforeEach(() => {
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

describe('GET /api/payments', () => {
  it('returns a paginated list of payments', async () => {
    const payments = [buildPayment(), buildPayment({ id: 'pay-2', amountCents: 50000 })];
    mockPrisma.payment.findMany.mockResolvedValue(payments);
    mockPrisma.payment.count.mockResolvedValue(2);

    const res = await request(app).get('/api/payments');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('pagination');
    expect(res.body.data).toHaveLength(2);
    expect(res.body.pagination).toHaveProperty('total', 2);
    expect(res.body.pagination).toHaveProperty('skip');
    expect(res.body.pagination).toHaveProperty('take');
  });

  it('returns empty list when no payments exist', async () => {
    mockPrisma.payment.findMany.mockResolvedValue([]);
    mockPrisma.payment.count.mockResolvedValue(0);

    const res = await request(app).get('/api/payments');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.pagination.total).toBe(0);
  });

  it('supports method filter', async () => {
    mockPrisma.payment.findMany.mockResolvedValue([]);
    mockPrisma.payment.count.mockResolvedValue(0);

    const res = await request(app).get('/api/payments?method=CARD');

    expect(res.status).toBe(200);
    expect(mockPrisma.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ method: 'CARD' }),
      }),
    );
  });

  it('supports status filter', async () => {
    mockPrisma.payment.findMany.mockResolvedValue([]);
    mockPrisma.payment.count.mockResolvedValue(0);

    const res = await request(app).get('/api/payments?status=COMPLETED');

    expect(res.status).toBe(200);
    expect(mockPrisma.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'COMPLETED' }),
      }),
    );
  });
});

describe('POST /api/payments', () => {
  it('records a cash payment successfully', async () => {
    const customer = buildCustomer();
    const payment = buildPayment({ method: 'CASH', stripePaymentId: null });

    mockPrisma.customer.findFirst.mockResolvedValue(customer);
    // $transaction mock calls the function with mockPrisma
    mockPrisma.payment.create.mockResolvedValue(payment);
    mockPrisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .post('/api/payments')
      .send({
        customerId: '550e8400-e29b-41d4-a716-446655440000',
        amountCents: 107000,
        method: 'CASH',
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('amountCents');
  });

  it('records a payment against an invoice', async () => {
    const customer = buildCustomer();
    const invoice = {
      id: 'inv-1',
      balanceCents: 107000,
      status: 'ISSUED',
      customerId: '550e8400-e29b-41d4-a716-446655440000',
    };
    const payment = buildPayment({ method: 'CASH' });

    mockPrisma.customer.findFirst.mockResolvedValue(customer);
    mockPrisma.invoice.findFirst.mockResolvedValue(invoice);
    mockPrisma.payment.create.mockResolvedValue(payment);
    mockPrisma.invoice.update.mockResolvedValue({});
    mockPrisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .post('/api/payments')
      .send({
        customerId: '550e8400-e29b-41d4-a716-446655440000',
        invoiceId: '550e8400-e29b-41d4-a716-446655440001',
        amountCents: 107000,
        method: 'CASH',
      });

    expect(res.status).toBe(201);
  });

  it('rejects payment when customer not found', async () => {
    mockPrisma.customer.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/payments')
      .send({
        customerId: '550e8400-e29b-41d4-a716-446655440000',
        amountCents: 107000,
        method: 'CASH',
      });

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('code', 'CUSTOMER_NOT_FOUND');
  });

  it('rejects missing customerId', async () => {
    const res = await request(app)
      .post('/api/payments')
      .send({
        amountCents: 107000,
        method: 'CASH',
      });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
  });

  it('rejects missing amountCents', async () => {
    const res = await request(app)
      .post('/api/payments')
      .send({
        customerId: '550e8400-e29b-41d4-a716-446655440000',
        method: 'CASH',
      });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
  });

  it('rejects zero amountCents', async () => {
    const res = await request(app)
      .post('/api/payments')
      .send({
        customerId: '550e8400-e29b-41d4-a716-446655440000',
        amountCents: 0,
        method: 'CASH',
      });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
  });

  it('rejects invalid payment method', async () => {
    const res = await request(app)
      .post('/api/payments')
      .send({
        customerId: '550e8400-e29b-41d4-a716-446655440000',
        amountCents: 107000,
        method: 'BITCOIN',
      });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'VALIDATION_ERROR');
  });

  it('rejects overpayment on invoice', async () => {
    const customer = buildCustomer();
    const invoice = {
      id: 'inv-1',
      balanceCents: 50000,
      status: 'ISSUED',
      customerId: '550e8400-e29b-41d4-a716-446655440000',
    };

    mockPrisma.customer.findFirst.mockResolvedValue(customer);
    mockPrisma.invoice.findFirst.mockResolvedValue(invoice);

    const res = await request(app)
      .post('/api/payments')
      .send({
        customerId: '550e8400-e29b-41d4-a716-446655440000',
        invoiceId: '550e8400-e29b-41d4-a716-446655440001',
        amountCents: 100000,
        method: 'CASH',
      });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'OVERPAYMENT');
  });

  it('rejects partial refund that exceeds the remaining refundable balance', async () => {
    // A previously partial-refunded payment: $1000 originally, $700 already
    // refunded. A new request for $400 must fail (only $300 remaining), even
    // though it would have passed the legacy "amount <= original" check.
    const payment = buildPayment({
      id: 'pay-partial',
      amountCents: 100000,
      refundedCents: 70000,
      status: 'PARTIALLY_REFUNDED',
      stripePaymentId: 'pi_partial',
      invoice: { id: 'inv-1', balanceCents: 70000, totalCents: 100000, status: 'ISSUED' },
    });

    mockPrisma.payment.findFirst.mockResolvedValue(payment);

    const res = await request(app)
      .post('/api/payments/pay-partial/refund')
      .send({ amountCents: 40000 });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'EXCESS_REFUND');
  });

  it('rejects refund when payment is already fully refunded via the ledger', async () => {
    // Status is still PARTIALLY_REFUNDED but the ledger shows the full
    // amount has been refunded — should reject as ALREADY_REFUNDED so a
    // stale row cannot be re-refunded.
    const payment = buildPayment({
      id: 'pay-exhausted',
      amountCents: 100000,
      refundedCents: 100000,
      status: 'PARTIALLY_REFUNDED',
      stripePaymentId: 'pi_exhausted',
    });

    mockPrisma.payment.findFirst.mockResolvedValue(payment);

    const res = await request(app)
      .post('/api/payments/pay-exhausted/refund')
      .send({ amountCents: 1000 });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'ALREADY_REFUNDED');
  });

  it('rejects with REFUND_CONFLICT and skips Stripe when a concurrent refund wins the race', async () => {
    // Simulate a concurrent refund: both requests pass the
    // remaining-balance check, but updateMany only returns count=1 for
    // the one that matches the prior refundedCents value. The losing
    // request must fail BEFORE any external Stripe charge is issued.
    const payment = buildPayment({
      id: 'pay-race',
      amountCents: 100000,
      refundedCents: 0,
      status: 'COMPLETED',
      stripePaymentId: 'pi_race',
      invoice: { id: 'inv-race', balanceCents: 0, totalCents: 100000, status: 'PAID' },
    });

    mockPrisma.payment.findFirst.mockResolvedValue(payment);
    // Optimistic guard fails — a concurrent caller already bumped
    // refundedCents.
    mockPrisma.payment.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.tenant.findUnique.mockResolvedValue({ stripeAccountId: 'acct_x' });

    const stripe = requireStripe();
    (stripe.refunds.create as any).mockClear();

    const res = await request(app)
      .post('/api/payments/pay-race/refund')
      .send({ amountCents: 50000 });

    expect(res.status).toBe(409);
    expect(res.body).toHaveProperty('code', 'REFUND_CONFLICT');
    // Critical: no external charge issued for the losing request.
    expect(stripe.refunds.create).not.toHaveBeenCalled();
  });

  it('rolls back the ledger with atomic decrements when Stripe refund fails', async () => {
    // Phase 1 succeeds (DB reserves the slot), Phase 2 (Stripe) fails.
    // The compensating transaction must back out using atomic
    // decrements (NOT absolute snapshot restores) so any concurrent
    // refund that committed in the meantime is preserved. It must
    // also post a REFUND_REVERSAL GL entry and decrement the invoice
    // balance.
    const payment = buildPayment({
      id: 'pay-rollback',
      amountCents: 100000,
      refundedCents: 0,
      status: 'COMPLETED',
      stripePaymentId: 'pi_rollback',
      invoice: { id: 'inv-rb', balanceCents: 0, totalCents: 100000, status: 'PAID' },
    });

    mockPrisma.payment.findFirst.mockResolvedValue(payment);
    mockPrisma.payment.updateMany.mockResolvedValue({ count: 1 });
    // Sequence the two findUniqueOrThrow calls:
    //   1. End of Phase 1 — returns the reserved state (refundedCents=30000).
    //   2. Inside rollback — returns the post-decrement state
    //      (refundedCents=0, no concurrent refund here).
    mockPrisma.payment.findUniqueOrThrow
      .mockResolvedValueOnce({
        ...payment,
        refundedCents: 30000,
        status: 'PARTIALLY_REFUNDED',
      })
      .mockResolvedValueOnce({
        refundedCents: 0,
        status: 'PARTIALLY_REFUNDED',
      });
    mockPrisma.invoice.findUniqueOrThrow.mockResolvedValue({
      balanceCents: 0,
      status: 'PAID',
    });
    mockPrisma.payment.update.mockResolvedValue(payment);
    mockPrisma.invoice.update.mockResolvedValue({});
    mockPrisma.tenant.findUnique.mockResolvedValue({ stripeAccountId: 'acct_x' });
    mockPrisma.auditLog.create.mockResolvedValue({});

    const stripe = requireStripe();
    (stripe.refunds.create as any).mockRejectedValueOnce(
      new Error('stripe down'),
    );
    (reversePostRefund as any).mockClear();
    mockPrisma.payment.update.mockClear();
    mockPrisma.invoice.update.mockClear();

    const res = await request(app)
      .post('/api/payments/pay-rollback/refund')
      .send({ amountCents: 30000 });

    expect(res.status).toBe(500);
    // Atomic-decrement rollback on the payment ledger.
    expect(mockPrisma.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pay-rollback' },
        data: { refundedCents: { decrement: 30000 } },
      }),
    );
    // Status recomputed from the post-decrement value (now 0 → COMPLETED).
    expect(mockPrisma.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pay-rollback' },
        data: { status: 'COMPLETED' },
      }),
    );
    // Invoice balance restored via decrement, never an absolute write.
    expect(mockPrisma.invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'inv-rb' },
        data: { balanceCents: { decrement: 30000 } },
      }),
    );
    expect(reversePostRefund).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'pay-rollback', method: 'CARD' }),
      30000,
      expect.anything(),
    );
  });

  it('preserves a concurrent successful refund when rolling back a Stripe failure', async () => {
    // Concurrency interleaving: A reserves $30 (refundedCents 0→30), then
    // B reserves AND completes $20 (refundedCents 30→50). A's Stripe call
    // then fails. Rollback must use atomic decrements so B's $20 stays
    // reflected — naively writing back A's pre-request snapshot
    // (refundedCents=0, status=COMPLETED) would erase B's valid refund.
    const payment = buildPayment({
      id: 'pay-interleave',
      amountCents: 100000,
      refundedCents: 0,
      status: 'COMPLETED',
      stripePaymentId: 'pi_interleave',
      invoice: { id: 'inv-il', balanceCents: 0, totalCents: 100000, status: 'PAID' },
    });

    mockPrisma.payment.findFirst.mockResolvedValue(payment);
    mockPrisma.payment.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.payment.findUniqueOrThrow
      // End of Phase 1 — A's reserved state.
      .mockResolvedValueOnce({
        ...payment,
        refundedCents: 30000,
        status: 'PARTIALLY_REFUNDED',
      })
      // Inside rollback — POST-decrement: A's 30000 just came back off
      // the 50000 total (which included B's 20000), leaving 20000.
      .mockResolvedValueOnce({
        refundedCents: 20000,
        status: 'PARTIALLY_REFUNDED',
      });
    mockPrisma.invoice.findUniqueOrThrow.mockResolvedValue({
      // B's refund left 20000 outstanding on the invoice; rollback
      // decremented A's 30000 from 50000.
      balanceCents: 20000,
      status: 'ISSUED',
    });
    mockPrisma.payment.update.mockResolvedValue(payment);
    mockPrisma.invoice.update.mockResolvedValue({});
    mockPrisma.tenant.findUnique.mockResolvedValue({ stripeAccountId: 'acct_x' });
    mockPrisma.auditLog.create.mockResolvedValue({});

    const stripe = requireStripe();
    (stripe.refunds.create as any).mockRejectedValueOnce(
      new Error('stripe down'),
    );
    mockPrisma.payment.update.mockClear();
    mockPrisma.invoice.update.mockClear();

    const res = await request(app)
      .post('/api/payments/pay-interleave/refund')
      .send({ amountCents: 30000 });

    expect(res.status).toBe(500);

    // Critical: rollback must NOT issue an absolute refundedCents
    // write — that would clobber B's concurrent refund. The payment
    // ledger is only touched during rollback in this scenario (Phase 1
    // uses updateMany), so every payment.update must be either a
    // decrement of refundedCents or a status-only update.
    const paymentUpdateCalls = mockPrisma.payment.update.mock.calls;
    expect(paymentUpdateCalls.length).toBeGreaterThan(0);
    for (const [args] of paymentUpdateCalls) {
      if ('refundedCents' in (args.data ?? {})) {
        expect(args.data.refundedCents).toEqual({ decrement: 30000 });
      }
    }

    // Status must reflect the post-rollback ledger (still
    // PARTIALLY_REFUNDED because B's $20 refund remains). The
    // mocked findUniqueOrThrow already reports status=PARTIALLY_REFUNDED
    // and the recomputed value (20000 between 0 and 100000) matches,
    // so no status update should be issued. Critically, no
    // status:'COMPLETED' write — that would erase B's PARTIALLY_REFUNDED.
    const statusResetToCompleted = paymentUpdateCalls.some(
      ([args]) => args.data?.status === 'COMPLETED',
    );
    expect(statusResetToCompleted).toBe(false);

    // Invoice: Phase 1 forward path writes an absolute balance (safe
    // because the payment-level optimistic guard serialises refunds
    // on a given payment row). The rollback path MUST use a decrement
    // so concurrent refunds on the same invoice (e.g. via a different
    // payment) aren't clobbered. Verify the rollback decrement was
    // issued and that no rollback-style absolute reset (balanceCents:0)
    // occurred.
    const invoiceUpdateCalls = mockPrisma.invoice.update.mock.calls;
    const sawDecrement = invoiceUpdateCalls.some(
      ([args]) =>
        args.data?.balanceCents &&
        typeof args.data.balanceCents === 'object' &&
        args.data.balanceCents.decrement === 30000,
    );
    expect(sawDecrement).toBe(true);
    const sawAbsoluteReset = invoiceUpdateCalls.some(
      ([args]) => args.data?.balanceCents === 0,
    );
    expect(sawAbsoluteReset).toBe(false);
  });

  it('accepts a partial refund up to the remaining refundable balance', async () => {
    const payment = buildPayment({
      id: 'pay-ok',
      amountCents: 100000,
      refundedCents: 60000,
      status: 'PARTIALLY_REFUNDED',
      stripePaymentId: null, // skip Stripe path
      invoice: { id: 'inv-ok', balanceCents: 60000, totalCents: 100000, status: 'ISSUED' },
    });

    mockPrisma.payment.findFirst.mockResolvedValue(payment);
    mockPrisma.payment.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.payment.findUniqueOrThrow.mockResolvedValue({
      ...payment,
      refundedCents: 100000,
      status: 'REFUNDED',
    });
    mockPrisma.invoice.update.mockResolvedValue({});
    mockPrisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .post('/api/payments/pay-ok/refund')
      .send({ amountCents: 40000 });

    expect(res.status).toBe(200);
    // Atomic guard: updateMany must filter on the prior refundedCents
    // value to detect concurrent refunds.
    expect(mockPrisma.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'pay-ok',
          refundedCents: 60000,
        }),
        data: expect.objectContaining({
          refundedCents: 100000,
          status: 'REFUNDED',
        }),
      }),
    );
  });

  describe('QBO sync routing — partial vs full refund vs mixed sequence', () => {
    beforeEach(() => {
      (voidQboPayment as any).mockClear();
      (createQboRefundReceipt as any).mockClear();
    });

    it('vanilla full refund (no prior partials) voids the QBO payment', async () => {
      const payment = buildPayment({
        id: 'pay-full',
        amountCents: 100000,
        refundedCents: 0,
        status: 'COMPLETED',
        stripePaymentId: null,
        invoice: { id: 'inv-full', balanceCents: 0, totalCents: 100000, status: 'PAID' },
      });
      mockPrisma.payment.findFirst.mockResolvedValue(payment);
      mockPrisma.payment.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.payment.findUniqueOrThrow.mockResolvedValue({
        ...payment,
        refundedCents: 100000,
        status: 'REFUNDED',
      });
      mockPrisma.invoice.update.mockResolvedValue({});
      mockPrisma.auditLog.create.mockResolvedValue({});

      const res = await request(app)
        .post('/api/payments/pay-full/refund')
        .send({ amountCents: 100000 });

      expect(res.status).toBe(200);
      expect(voidQboPayment).toHaveBeenCalledTimes(1);
      expect(voidQboPayment).toHaveBeenCalledWith('pay-full', expect.any(String));
      expect(createQboRefundReceipt).not.toHaveBeenCalled();
    });

    it('pure partial refund (not yet fully refunded) pushes a RefundReceipt with the correct prior amount', async () => {
      const payment = buildPayment({
        id: 'pay-partial-only',
        amountCents: 100000,
        refundedCents: 0,
        status: 'COMPLETED',
        stripePaymentId: null,
        invoice: { id: 'inv-p', balanceCents: 0, totalCents: 100000, status: 'PAID' },
      });
      mockPrisma.payment.findFirst.mockResolvedValue(payment);
      mockPrisma.payment.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.payment.findUniqueOrThrow.mockResolvedValue({
        ...payment,
        refundedCents: 30000,
        status: 'PARTIALLY_REFUNDED',
      });
      mockPrisma.invoice.update.mockResolvedValue({});
      mockPrisma.auditLog.create.mockResolvedValue({});

      const res = await request(app)
        .post('/api/payments/pay-partial-only/refund')
        .send({ amountCents: 30000 });

      expect(res.status).toBe(200);
      expect(voidQboPayment).not.toHaveBeenCalled();
      expect(createQboRefundReceipt).toHaveBeenCalledTimes(1);
      // (paymentId, refundAmount, priorRefundedCents, tenantId)
      expect(createQboRefundReceipt).toHaveBeenCalledWith(
        'pay-partial-only',
        30000,
        0,
        expect.any(String),
      );
    });

    it('mixed sequence: final remainder after prior partials still pushes a RefundReceipt (does NOT void)', async () => {
      // This is the reconciliation-critical case. The payment already has
      // prior RefundReceipts in QBO ($30 of $100). The final $70 refund
      // makes it fully refunded — but voiding the QBO payment now would
      // double-count the prior refunds. Instead we must push a final
      // RefundReceipt for the $70 remainder so the sum of QBO
      // RefundReceipts matches Helm's refundedCents ($30 + $70 = $100).
      const payment = buildPayment({
        id: 'pay-mixed',
        amountCents: 100000,
        refundedCents: 30000,
        status: 'PARTIALLY_REFUNDED',
        stripePaymentId: null,
        invoice: { id: 'inv-mixed', balanceCents: 0, totalCents: 100000, status: 'PAID' },
      });
      mockPrisma.payment.findFirst.mockResolvedValue(payment);
      mockPrisma.payment.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.payment.findUniqueOrThrow.mockResolvedValue({
        ...payment,
        refundedCents: 100000,
        status: 'REFUNDED',
      });
      mockPrisma.invoice.update.mockResolvedValue({});
      mockPrisma.auditLog.create.mockResolvedValue({});

      const res = await request(app)
        .post('/api/payments/pay-mixed/refund')
        .send({ amountCents: 70000 });

      expect(res.status).toBe(200);
      // Critical assertion: void must NOT be called when prior partials exist.
      expect(voidQboPayment).not.toHaveBeenCalled();
      expect(createQboRefundReceipt).toHaveBeenCalledTimes(1);
      expect(createQboRefundReceipt).toHaveBeenCalledWith(
        'pay-mixed',
        70000,
        30000,
        expect.any(String),
      );
    });

    it('refund handler swallows QBO push failures so the local refund still succeeds', async () => {
      (createQboRefundReceipt as any).mockRejectedValueOnce(new Error('qbo offline'));

      const payment = buildPayment({
        id: 'pay-qbo-fail',
        amountCents: 100000,
        refundedCents: 0,
        status: 'COMPLETED',
        stripePaymentId: null,
        invoice: { id: 'inv-x', balanceCents: 0, totalCents: 100000, status: 'PAID' },
      });
      mockPrisma.payment.findFirst.mockResolvedValue(payment);
      mockPrisma.payment.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.payment.findUniqueOrThrow.mockResolvedValue({
        ...payment,
        refundedCents: 25000,
        status: 'PARTIALLY_REFUNDED',
      });
      mockPrisma.invoice.update.mockResolvedValue({});
      mockPrisma.auditLog.create.mockResolvedValue({});

      const res = await request(app)
        .post('/api/payments/pay-qbo-fail/refund')
        .send({ amountCents: 25000 });

      // Local refund still succeeds — QBO failure is best-effort and
      // captured to the sync ref by createQboRefundReceipt itself.
      expect(res.status).toBe(200);
      expect(createQboRefundReceipt).toHaveBeenCalledTimes(1);
    });
  });

  it('rejects payment on voided invoice', async () => {
    const customer = buildCustomer();
    const invoice = {
      id: 'inv-1',
      balanceCents: 107000,
      status: 'VOID',
      customerId: '550e8400-e29b-41d4-a716-446655440000',
    };

    mockPrisma.customer.findFirst.mockResolvedValue(customer);
    mockPrisma.invoice.findFirst.mockResolvedValue(invoice);

    const res = await request(app)
      .post('/api/payments')
      .send({
        customerId: '550e8400-e29b-41d4-a716-446655440000',
        invoiceId: '550e8400-e29b-41d4-a716-446655440001',
        amountCents: 107000,
        method: 'CASH',
      });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('code', 'INVOICE_VOID');
  });
});

describe('Payment refund history', () => {
  it('writes a PaymentRefund row inside the same transaction as the ledger bump', async () => {
    // The history row and the running-total bump must commit together —
    // otherwise an operator could see a refund in the history that the
    // ledger doesn't reflect (or vice versa). We verify by asserting the
    // create call shape after a successful (Stripe-skipped) refund.
    const payment = buildPayment({
      id: 'pay-hist-1',
      amountCents: 100000,
      refundedCents: 0,
      status: 'COMPLETED',
      stripePaymentId: null,
      invoice: { id: 'inv-h1', balanceCents: 0, totalCents: 100000, status: 'PAID' },
    });

    mockPrisma.payment.findFirst.mockResolvedValue(payment);
    mockPrisma.payment.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.payment.findUniqueOrThrow.mockResolvedValue({
      ...payment,
      refundedCents: 25000,
      status: 'PARTIALLY_REFUNDED',
    });
    mockPrisma.paymentRefund.create.mockResolvedValue({
      id: 'pr-1',
      paymentId: 'pay-hist-1',
      amountCents: 25000,
    });
    mockPrisma.invoice.update.mockResolvedValue({});
    mockPrisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .post('/api/payments/pay-hist-1/refund')
      .send({ amountCents: 25000, reason: 'overcharge' });

    expect(res.status).toBe(200);
    expect(mockPrisma.paymentRefund.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          paymentId: 'pay-hist-1',
          amountCents: 25000,
          reason: 'overcharge',
          isFullRefund: false,
        }),
      }),
    );
  });

  it('deletes the PaymentRefund row when Stripe rollback fires', async () => {
    // If the external processor call fails after the in-DB reservation,
    // the per-refund history row must also be removed so the audit-style
    // history doesn't claim a refund happened that never reached Stripe.
    const payment = buildPayment({
      id: 'pay-hist-rb',
      amountCents: 100000,
      refundedCents: 0,
      status: 'COMPLETED',
      stripePaymentId: 'pi_hist_rb',
      invoice: { id: 'inv-hrb', balanceCents: 0, totalCents: 100000, status: 'PAID' },
    });

    mockPrisma.payment.findFirst.mockResolvedValue(payment);
    mockPrisma.payment.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.payment.findUniqueOrThrow
      .mockResolvedValueOnce({
        ...payment,
        refundedCents: 30000,
        status: 'PARTIALLY_REFUNDED',
      })
      .mockResolvedValueOnce({ refundedCents: 0, status: 'PARTIALLY_REFUNDED' });
    mockPrisma.invoice.findUniqueOrThrow.mockResolvedValue({
      balanceCents: 0,
      status: 'PAID',
    });
    mockPrisma.paymentRefund.create.mockResolvedValue({ id: 'pr-rb-1' });
    mockPrisma.tenant.findUnique.mockResolvedValue({ stripeAccountId: 'acct_x' });
    mockPrisma.auditLog.create.mockResolvedValue({});

    const stripe = requireStripe();
    (stripe.refunds.create as any).mockRejectedValueOnce(new Error('stripe down'));

    const res = await request(app)
      .post('/api/payments/pay-hist-rb/refund')
      .send({ amountCents: 30000 });

    expect(res.status).toBe(500);
    expect(mockPrisma.paymentRefund.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'pr-rb-1' }),
      }),
    );
  });

  it('GET /api/payments/:id/refunds returns the per-refund history in chronological order', async () => {
    const payment = buildPayment({ id: 'pay-list', refundedCents: 50000 });
    mockPrisma.payment.findFirst.mockResolvedValue(payment);
    // Mock returns rows in the order Prisma would after ORDER BY createdAt
    // ASC — oldest first. The route doesn't re-sort; we just verify the
    // serialized response preserves that order so the UI sub-table reads
    // top-to-bottom in the same direction the refunds happened.
    const rows = [
      {
        id: 'r1',
        paymentId: 'pay-list',
        amountCents: 20000,
        reason: 'first partial',
        userId: 'u1',
        userName: 'admin@test.com',
        stripeRefundId: 're_1',
        isFullRefund: false,
        source: 'payment-detail',
        createdAt: new Date('2026-04-19T00:00:00Z'),
      },
      {
        id: 'r2',
        paymentId: 'pay-list',
        amountCents: 30000,
        reason: 'second partial',
        userId: 'u1',
        userName: 'admin@test.com',
        stripeRefundId: 're_2',
        isFullRefund: false,
        source: 'payment-detail',
        createdAt: new Date('2026-04-20T00:00:00Z'),
      },
    ];
    mockPrisma.paymentRefund.findMany.mockResolvedValue(rows);

    const res = await request(app).get('/api/payments/pay-list/refunds');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0]).toMatchObject({ id: 'r1', amountCents: 20000 });
    expect(res.body.data[1]).toMatchObject({ id: 'r2', amountCents: 30000 });
    expect(mockPrisma.paymentRefund.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ paymentId: 'pay-list' }),
        orderBy: expect.objectContaining({ createdAt: 'asc' }),
      }),
    );
  });
});
