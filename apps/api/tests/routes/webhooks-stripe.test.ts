import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { mockPrisma } from '../setup.js';

vi.mock('../../src/services/webhook.js', () => ({
  checkAndMarkProcessed: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../src/services/ach-handler.js', () => ({
  handleAchReturn: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/lib/email.js', () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
  saasInvoicePaymentFailedHtml: vi.fn().mockReturnValue('<p>failed</p>'),
}));

const mockConstructEvent = vi.fn();

vi.mock('../../src/lib/stripe.js', () => ({
  stripe: null,
  requireStripe: vi.fn(() => ({
    webhooks: {
      constructEvent: mockConstructEvent,
    },
  })),
  createPaymentIntent: vi.fn().mockResolvedValue({ id: 'pi_test', client_secret: 'cs_test' }),
  createCustomer: vi.fn().mockResolvedValue({ id: 'cus_test' }),
  processWebhook: vi.fn().mockResolvedValue(null),
}));

let app: any;

beforeEach(async () => {
  vi.clearAllMocks();
  process.env.STRIPE_WEBHOOK_SECRET_CONNECT = 'whsec_test_connect';

  (mockPrisma as any).location = {
    findFirst: vi.fn().mockResolvedValue(null),
    findUnique: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue({ id: 'loc-1' }),
  };

  // Reset payment + invoice mocks for handler tests
  mockPrisma.payment.findFirst.mockResolvedValue(null);
  mockPrisma.payment.update.mockResolvedValue({ id: 'pay-1' } as any);
  mockPrisma.invoice.update.mockResolvedValue({ id: 'inv-1' } as any);

  const mod = await import('../../src/index.js');
  app = mod.default;
});

function buildAccountUpdatedEvent(
  connectedAccountId: string,
  chargesEnabled: boolean,
): Record<string, unknown> {
  return {
    id: 'evt_test_account_updated',
    type: 'account.updated',
    account: connectedAccountId,
    data: {
      object: {
        id: connectedAccountId,
        object: 'account',
        charges_enabled: chargesEnabled,
        details_submitted: chargesEnabled,
      },
    },
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 0,
    request: null,
  };
}

describe('POST /api/webhooks/stripe/connect — account.updated', () => {
  it('marks location stripeOnboardingComplete when charges_enabled is true', async () => {
    const connectedAccountId = 'acct_location_stripe';
    const fakeEvent = buildAccountUpdatedEvent(connectedAccountId, true);

    mockConstructEvent.mockReturnValue(fakeEvent);

    mockPrisma.tenant.findFirst.mockResolvedValue(null);
    (mockPrisma as any).location.findFirst.mockResolvedValue({
      id: 'loc-1',
      tenantId: 'test-tenant-id',
    });

    const res = await request(app)
      .post('/api/webhooks/stripe/connect')
      .set('stripe-signature', 'sig_test')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ id: 'evt_test' }));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });

    await new Promise((resolve) => setImmediate(resolve));

    expect((mockPrisma as any).location.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'loc-1' },
        data: { stripeOnboardingComplete: true },
      }),
    );
  });

  it('does not mark stripeOnboardingComplete when charges_enabled is false', async () => {
    const connectedAccountId = 'acct_incomplete';
    const fakeEvent = buildAccountUpdatedEvent(connectedAccountId, false);

    mockConstructEvent.mockReturnValue(fakeEvent);

    mockPrisma.tenant.findFirst.mockResolvedValue(null);
    (mockPrisma as any).location.findFirst.mockResolvedValue({
      id: 'loc-incomplete',
      tenantId: 'test-tenant-id',
    });

    const res = await request(app)
      .post('/api/webhooks/stripe/connect')
      .set('stripe-signature', 'sig_test')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ id: 'evt_test' }));

    expect(res.status).toBe(200);

    await new Promise((resolve) => setImmediate(resolve));

    const locationUpdateCalls = vi.mocked((mockPrisma as any).location.update).mock.calls;
    const onboardingCall = locationUpdateCalls.find(
      ([args]: [any]) => args?.data?.stripeOnboardingComplete === true,
    );
    expect(onboardingCall).toBeUndefined();
  });

  it('still writes an audit log for the account.updated event', async () => {
    const fakeEvent = buildAccountUpdatedEvent('acct_audit_test', true);
    mockConstructEvent.mockReturnValue(fakeEvent);

    mockPrisma.tenant.findFirst.mockResolvedValue(null);
    (mockPrisma as any).location.findFirst.mockResolvedValue({
      id: 'loc-audit',
      tenantId: 'test-tenant-id',
    });

    await request(app)
      .post('/api/webhooks/stripe/connect')
      .set('stripe-signature', 'sig_test')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ id: 'evt_test' }));

    await new Promise((resolve) => setImmediate(resolve));

    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'STRIPE_ACCOUNT_UPDATED',
          recordId: 'loc-audit',
        }),
      }),
    );
  });

  it('returns 400 when stripe-signature header is missing', async () => {
    const res = await request(app)
      .post('/api/webhooks/stripe/connect')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ id: 'evt_no_sig' }));

    expect(res.status).toBe(400);
  });

  it('returns 500 when STRIPE_WEBHOOK_SECRET_CONNECT is not configured', async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET_CONNECT;

    const res = await request(app)
      .post('/api/webhooks/stripe/connect')
      .set('stripe-signature', 'sig_test')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ id: 'evt_test' }));

    expect(res.status).toBe(500);
  });

  it('resolves Location BEFORE Tenant when both could match (Location-first ordering)', async () => {
    // Same connected account string registered against both tables — Location
    // should win now that per-Location Stripe is primary.
    const connectedAccountId = 'acct_dual_match';
    const fakeEvent = buildAccountUpdatedEvent(connectedAccountId, true);
    mockConstructEvent.mockReturnValue(fakeEvent);

    const tenantFindFirst = vi.fn().mockResolvedValue({ id: 'legacy-tenant' });
    mockPrisma.tenant.findFirst = tenantFindFirst as any;
    (mockPrisma as any).location.findFirst.mockResolvedValue({
      id: 'loc-priority',
      tenantId: 'loc-priority-tenant',
    });

    await request(app)
      .post('/api/webhooks/stripe/connect')
      .set('stripe-signature', 'sig_test')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ id: 'evt_test' }));

    await new Promise((resolve) => setImmediate(resolve));

    // Location lookup must happen; tenant fallback must NOT be consulted
    // when a Location matches.
    expect((mockPrisma as any).location.findFirst).toHaveBeenCalled();
    expect(tenantFindFirst).not.toHaveBeenCalled();

    // Audit log must record the Location id, not the legacy tenant id.
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'loc-priority-tenant',
          recordType: 'Location',
          recordId: 'loc-priority',
        }),
      }),
    );
  });

  it('handles account.updated for an unknown connected account without crashing', async () => {
    const fakeEvent = buildAccountUpdatedEvent('acct_unknown', true);
    mockConstructEvent.mockReturnValue(fakeEvent);

    mockPrisma.tenant.findFirst = vi.fn().mockResolvedValue(null) as any;
    (mockPrisma as any).location.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/webhooks/stripe/connect')
      .set('stripe-signature', 'sig_test')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ id: 'evt_unknown' }));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });

    await new Promise((resolve) => setImmediate(resolve));

    // No Location update should have happened (no match) and no audit log
    // (because handleAccountUpdated short-circuits when tenantId is null).
    expect((mockPrisma as any).location.update).not.toHaveBeenCalled();
    expect(mockPrisma.auditLog.create).not.toHaveBeenCalled();
  });
});

describe('POST /api/webhooks/stripe/connect — payment_intent.succeeded for Location', () => {
  function buildPaymentIntentSucceeded(
    connectedAccountId: string,
    paymentIntentId: string,
    metadata: Record<string, string> = {},
  ): Record<string, unknown> {
    return {
      id: 'evt_pi_succeeded',
      type: 'payment_intent.succeeded',
      account: connectedAccountId,
      data: {
        object: {
          id: paymentIntentId,
          object: 'payment_intent',
          amount: 5000,
          currency: 'usd',
          metadata,
        },
      },
      created: Math.floor(Date.now() / 1000),
      livemode: false,
      pending_webhooks: 0,
      request: null,
    };
  }

  it('writes locationId into the audit log when the payment came from a location-connected account', async () => {
    const connectedAccountId = 'acct_loc_pi';
    const fakeEvent = buildPaymentIntentSucceeded(connectedAccountId, 'pi_loc_001');
    mockConstructEvent.mockReturnValue(fakeEvent);

    mockPrisma.tenant.findFirst = vi.fn().mockResolvedValue(null) as any;
    (mockPrisma as any).location.findFirst.mockResolvedValue({
      id: 'loc-pi-1',
      tenantId: 'tenant-pi-1',
    });
    mockPrisma.payment.findFirst.mockResolvedValue({
      id: 'pay-100',
      tenantId: 'tenant-pi-1',
      amountCents: 5000,
      method: 'CARD',
      status: 'PENDING',
      stripePaymentId: 'pi_loc_001',
      invoice: { id: 'inv-100', balanceCents: 5000, status: 'OPEN' },
    } as any);

    await request(app)
      .post('/api/webhooks/stripe/connect')
      .set('stripe-signature', 'sig_test')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ id: 'evt_pi_succeeded' }));

    await new Promise((resolve) => setImmediate(resolve));

    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'PAYMENT_SUCCEEDED',
          recordId: 'pay-100',
          changedFieldsJson: expect.objectContaining({
            stripePaymentId: 'pi_loc_001',
            locationId: 'loc-pi-1',
          }),
        }),
      }),
    );
  });

  it('resolves the Payment row deterministically via metadata.paymentId before falling back to stripePaymentId', async () => {
    const connectedAccountId = 'acct_loc_meta';
    const fakeEvent = buildPaymentIntentSucceeded(connectedAccountId, 'pi_meta_001', {
      paymentId: 'pay-meta-42',
    });
    mockConstructEvent.mockReturnValue(fakeEvent);

    mockPrisma.tenant.findFirst = vi.fn().mockResolvedValue(null) as any;
    (mockPrisma as any).location.findFirst.mockResolvedValue({
      id: 'loc-pi-meta',
      tenantId: 'tenant-pi-meta',
    });

    // First findFirst call (metadata path) returns the row; fallback would
    // return null. The handler must not invoke the fallback at all.
    mockPrisma.payment.findFirst
      .mockResolvedValueOnce({
        id: 'pay-meta-42',
        tenantId: 'tenant-pi-meta',
        amountCents: 5000,
        method: 'CARD',
        status: 'PENDING',
        stripePaymentId: null,
        invoice: { id: 'inv-meta', balanceCents: 5000, status: 'OPEN' },
      } as any)
      .mockResolvedValue(null);
    mockPrisma.payment.updateMany.mockResolvedValue({ count: 1 } as any);

    await request(app)
      .post('/api/webhooks/stripe/connect')
      .set('stripe-signature', 'sig_test')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ id: 'evt_pi_succeeded' }));

    await new Promise((resolve) => setImmediate(resolve));

    // Exactly one Payment lookup: the metadata-keyed one. No fallback,
    // no retry sleep loop.
    expect(mockPrisma.payment.findFirst).toHaveBeenCalledTimes(1);
    expect(mockPrisma.payment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'pay-meta-42' }),
      }),
    );
    // Backfill stripePaymentId on rows located via metadata.
    expect(mockPrisma.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pay-meta-42', stripePaymentId: null },
        data: { stripePaymentId: 'pi_meta_001' },
      }),
    );
  });

  it('falls back to stripePaymentId without retrying when metadata.paymentId is absent', async () => {
    const connectedAccountId = 'acct_loc_legacy';
    const fakeEvent = buildPaymentIntentSucceeded(connectedAccountId, 'pi_legacy_001');
    mockConstructEvent.mockReturnValue(fakeEvent);

    mockPrisma.tenant.findFirst = vi.fn().mockResolvedValue(null) as any;
    (mockPrisma as any).location.findFirst.mockResolvedValue({
      id: 'loc-legacy',
      tenantId: 'tenant-legacy',
    });

    // Always return null — no Payment row exists. The handler must call
    // findFirst exactly once (no metadata path) and NOT enter a retry
    // sleep loop. With the old behavior this would be 5 calls
    // (1 + 4 retries).
    mockPrisma.payment.findFirst.mockResolvedValue(null);

    const start = Date.now();
    await request(app)
      .post('/api/webhooks/stripe/connect')
      .set('stripe-signature', 'sig_test')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ id: 'evt_pi_succeeded' }));
    await new Promise((resolve) => setImmediate(resolve));
    const elapsed = Date.now() - start;

    expect(mockPrisma.payment.findFirst).toHaveBeenCalledTimes(1);
    expect(mockPrisma.payment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ stripePaymentId: 'pi_legacy_001' }),
      }),
    );
    // The previous retry loop slept ~1.95s in aggregate. Anything well
    // under 500ms confirms the loop is gone.
    expect(elapsed).toBeLessThan(500);
  });
});

// ===========================================================================
// Per-location SaaS subscription dispatch (platform webhook).
// Each marina (= Location) has its own Stripe subscription. Webhooks must
// route to the LOCATION using metadata.locationId, never to the tenant.
// ===========================================================================

describe('POST /api/webhooks/stripe/platform — per-location SaaS lifecycle', () => {
  beforeEach(() => {
    process.env.STRIPE_WEBHOOK_SECRET_PLATFORM = 'whsec_test_platform';
  });

  it('checkout.session.completed writes subscription onto Location.metadata.locationId', async () => {
    mockConstructEvent.mockReturnValue({
      id: 'evt_co_completed_loc',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_1',
          subscription: 'sub_loc_a',
          metadata: { locationId: 'loc-A', tenantId: 'tenant-X', tierId: 'tier-pro' },
        },
      },
    });

    await request(app)
      .post('/api/webhooks/stripe/platform')
      .set('stripe-signature', 'sig_test')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ id: 'evt_co_completed_loc' }));

    expect((mockPrisma as any).location.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'loc-A' },
        data: expect.objectContaining({
          stripeSubscriptionId: 'sub_loc_a',
          subscriptionStatus: 'active',
          saasTierId: 'tier-pro',
        }),
      }),
    );
    // The Tenant row must NOT be touched.
    expect(mockPrisma.tenant.update).not.toHaveBeenCalled();
  });

  it('customer.subscription.deleted clears the Location subscription', async () => {
    mockConstructEvent.mockReturnValue({
      id: 'evt_sub_deleted_loc',
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: 'sub_loc_b',
          status: 'canceled',
          metadata: { locationId: 'loc-B' },
        },
      },
    });

    await request(app)
      .post('/api/webhooks/stripe/platform')
      .set('stripe-signature', 'sig_test')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ id: 'evt_sub_deleted_loc' }));

    expect((mockPrisma as any).location.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'loc-B' },
        data: expect.objectContaining({
          stripeSubscriptionId: null,
          saasTierId: null,
          subscriptionStatus: 'canceled',
        }),
      }),
    );
    expect(mockPrisma.tenant.update).not.toHaveBeenCalled();
  });

  it('invoice.payment_failed marks Location.gracePeriodStartedAt and writes audit log', async () => {
    (mockPrisma as any).location.findFirst.mockResolvedValue({
      id: 'loc-C',
      name: 'Pier 99',
      tenantId: 'tenant-Y',
      gracePeriodStartedAt: null,
      tenant: { name: 'Pier 99 Holdings' },
    });
    mockPrisma.user.findMany.mockResolvedValue([] as any);

    mockConstructEvent.mockReturnValue({
      id: 'evt_invoice_failed',
      type: 'invoice.payment_failed',
      data: {
        object: {
          id: 'in_1',
          customer: 'cus_loc_c',
          amount_due: 49900,
          attempt_count: 1,
        },
      },
    });

    await request(app)
      .post('/api/webhooks/stripe/platform')
      .set('stripe-signature', 'sig_test')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ id: 'evt_invoice_failed' }));

    expect((mockPrisma as any).location.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { stripeCustomerId: 'cus_loc_c' } }),
    );
    expect((mockPrisma as any).location.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'loc-C' },
        data: expect.objectContaining({
          subscriptionStatus: 'past_due',
          gracePeriodStartedAt: expect.any(Date),
        }),
      }),
    );
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'tenant-Y',
          recordType: 'Location',
          recordId: 'loc-C',
          action: 'SAAS_INVOICE_PAYMENT_FAILED',
        }),
      }),
    );
  });

  it('invoice.paid clears Location.gracePeriodStartedAt', async () => {
    (mockPrisma as any).location.findFirst.mockResolvedValue({
      id: 'loc-D',
      gracePeriodStartedAt: new Date('2026-01-01T00:00:00Z'),
    });

    mockConstructEvent.mockReturnValue({
      id: 'evt_invoice_paid',
      type: 'invoice.paid',
      data: {
        object: { id: 'in_2', customer: 'cus_loc_d' },
      },
    });

    await request(app)
      .post('/api/webhooks/stripe/platform')
      .set('stripe-signature', 'sig_test')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ id: 'evt_invoice_paid' }));

    expect((mockPrisma as any).location.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'loc-D' },
        data: expect.objectContaining({
          gracePeriodStartedAt: null,
          subscriptionStatus: 'active',
        }),
      }),
    );
  });
});
