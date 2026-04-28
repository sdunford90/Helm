import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createTestApp } from '../helpers.js';
import { mockPrisma } from '../setup.js';

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

describe('PUT /api/portal/autopay', () => {
  // Reach into the same Stripe mock the route uses, so each test can
  // tweak the per-call return values (cards on file, customer metadata).
  let stripe: {
    customers: {
      retrieve: ReturnType<typeof import('vitest').vi.fn>;
      update: ReturnType<typeof import('vitest').vi.fn>;
      create: ReturnType<typeof import('vitest').vi.fn>;
    };
    paymentMethods: { list: ReturnType<typeof import('vitest').vi.fn> };
  };

  beforeAll(async () => {
    stripe = (await import('../../src/lib/stripe.js')).stripe as any;
  });

  beforeEach(() => {
    // The outer beforeEach only resets prisma mocks; reset Stripe spies too
    // so each test sees a clean call count and can stack its own per-test
    // mockResolvedValueOnce returns without leftover state.
    stripe.customers.retrieve.mockReset();
    stripe.customers.update.mockReset();
    stripe.customers.create.mockReset();
    stripe.paymentMethods.list.mockReset();
    stripe.customers.retrieve.mockResolvedValue({
      id: 'cus_test',
      metadata: { autopay: 'true' },
    });
    stripe.customers.update.mockResolvedValue({ id: 'cus_test' });
    stripe.customers.create.mockResolvedValue({ id: 'cus_test' });
    stripe.paymentMethods.list.mockResolvedValue({ data: [] });
  });

  // The portal middleware (`resolvePortalCustomer`) matches the authenticated
  // user's email against a Customer row in the same tenant. The auth mock in
  // tests/setup.ts provides `email: admin@test.com` + `tenant_id: test-tenant-id`.
  // Wiring this up once per test gives the route a non-null portalCustomerId.
  function mockPortalCustomerResolver(stripeCustomerId: string | null = 'cus_test') {
    // First findFirst → the resolver in the portal middleware.
    mockPrisma.customer.findFirst.mockResolvedValue({ id: 'cust-1' } as any);
    // Then findUnique → the handler's own customer lookup for Stripe details.
    mockPrisma.customer.findUnique.mockResolvedValue({
      stripeCustomerId,
      email: 'admin@test.com',
      firstName: 'Jane',
      lastName: 'Doe',
    } as any);
  }

  function mockTenantWithStripe() {
    // No invoiceId in the request → route falls back to the tenant-level
    // Stripe account via getTenantStripeAccount(tenantId).
    mockPrisma.tenant.findUnique.mockResolvedValue({
      stripeAccountId: 'acct_test',
    } as any);
  }

  it('enables autopay when the default card is still valid', async () => {
    // Happy path: the customer's default Stripe payment method is a card
    // that is nowhere near its expiry, so the route should fall through
    // to the metadata.autopay="true" write.
    mockPortalCustomerResolver();
    mockTenantWithStripe();

    const validCard = {
      id: 'pm_card_valid',
      card: { exp_month: 12, exp_year: 2099, brand: 'visa', last4: '4242' },
    };
    stripe.paymentMethods.list.mockResolvedValueOnce({ data: [validCard] });
    stripe.customers.retrieve.mockResolvedValueOnce({
      id: 'cus_test',
      invoice_settings: { default_payment_method: 'pm_card_valid' },
      metadata: { autopay: 'false' },
    } as any);

    const res = await request(app)
      .put('/api/portal/autopay')
      .send({ autopay: true });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ autopay: true });
    expect(stripe.customers.update).toHaveBeenCalledWith(
      'cus_test',
      { metadata: { autopay: 'true' } },
      { stripeAccount: 'acct_test' },
    );
  });

  it('refuses to enable autopay when the default card on file is expired', async () => {
    // Customer has a card on file, and Stripe uses it as the default
    // for invoice charges, but it has already expired. The next off-session
    // attempt would be declined, so the route must reject the toggle with
    // a clear DEFAULT_CARD_EXPIRED code instead of writing
    // metadata.autopay=true. This mirrors the staff-side guard.
    mockPortalCustomerResolver();
    mockTenantWithStripe();

    // Pick a year safely in the past so this case stays expired regardless
    // of when the test is run.
    const expiredCard = {
      id: 'pm_card_expired',
      card: { exp_month: 1, exp_year: 2000, brand: 'visa', last4: '4242' },
    };
    stripe.paymentMethods.list.mockResolvedValueOnce({ data: [expiredCard] });
    stripe.customers.retrieve.mockResolvedValueOnce({
      id: 'cus_test',
      invoice_settings: { default_payment_method: 'pm_card_expired' },
      metadata: { autopay: 'false' },
    } as any);

    const res = await request(app)
      .put('/api/portal/autopay')
      .send({ autopay: true });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'DEFAULT_CARD_EXPIRED' });
    // Crucially, the metadata write must NOT happen on the rejection path,
    // otherwise we'd quietly flip the flag and get the very failure mode
    // this guard exists to prevent.
    expect(stripe.customers.update).not.toHaveBeenCalled();
  });

  it('always allows disabling autopay, even when the default card is expired', async () => {
    // Symmetric to the staff-side guard: the expired-card check is gated on
    // `if (autopay)`, so disabling must always succeed. This lets the
    // customer quiet the auto-pay banner while they fix the card without
    // being trapped by the very guard that's protecting them.
    mockPortalCustomerResolver();
    mockTenantWithStripe();

    const res = await request(app)
      .put('/api/portal/autopay')
      .send({ autopay: false });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ autopay: false });
    // The "skip the cards check on disable" branch must NOT call list or
    // retrieve — otherwise we'd be doing pointless Stripe round-trips and
    // could regress into running the expired-card check on the disable
    // path too.
    expect(stripe.paymentMethods.list).not.toHaveBeenCalled();
    expect(stripe.customers.retrieve).not.toHaveBeenCalled();
    expect(stripe.customers.update).toHaveBeenCalledWith(
      'cus_test',
      { metadata: { autopay: 'false' } },
      { stripeAccount: 'acct_test' },
    );
  });
});
