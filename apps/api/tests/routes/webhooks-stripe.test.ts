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
});
