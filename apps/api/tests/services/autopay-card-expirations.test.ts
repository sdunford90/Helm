import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockPrisma } from '../setup.js';

let buildAutopayCardExpirations: typeof import('../../src/services/report-data.js').buildAutopayCardExpirations;
let stripeMock: any;

beforeEach(async () => {
  vi.clearAllMocks();
  buildAutopayCardExpirations = (
    await import('../../src/services/report-data.js')
  ).buildAutopayCardExpirations;
  stripeMock = (await import('../../src/lib/stripe.js')).stripe;
  stripeMock.customers.retrieve.mockReset();

  // Default: every customer routes through a connected location.
  mockPrisma.invoice.findFirst.mockResolvedValue({
    location: {
      name: 'Main Marina',
      stripeAccountId: 'acct_main',
      stripeOnboardingComplete: true,
    },
  });
});

function makeCustomer(over: Partial<{ id: string; firstName: string; lastName: string; email: string; phone: string; stripeCustomerId: string }> = {}) {
  return {
    id: over.id ?? 'cust-1',
    firstName: over.firstName ?? 'Jane',
    lastName: over.lastName ?? 'Doe',
    email: over.email ?? 'jane@test.com',
    phone: over.phone ?? '5551234567',
    stripeCustomerId: over.stripeCustomerId ?? 'cus_stripe_1',
  };
}

function makeStripeCustomer(opts: {
  autopay?: boolean;
  card?: { exp_month: number; exp_year: number; brand?: string; last4?: string } | null;
  legacyCard?: { exp_month: number; exp_year: number; brand?: string; last4?: string } | null;
}) {
  return {
    id: 'cus_stripe_1',
    deleted: false,
    metadata: { autopay: opts.autopay === false ? 'false' : 'true' },
    invoice_settings: opts.card
      ? {
          default_payment_method: {
            id: 'pm_1',
            card: {
              brand: opts.card.brand ?? 'visa',
              last4: opts.card.last4 ?? '4242',
              exp_month: opts.card.exp_month,
              exp_year: opts.card.exp_year,
            },
          },
        }
      : { default_payment_method: null },
    default_source: opts.legacyCard
      ? {
          object: 'card',
          brand: opts.legacyCard.brand ?? 'mastercard',
          last4: opts.legacyCard.last4 ?? '5555',
          exp_month: opts.legacyCard.exp_month,
          exp_year: opts.legacyCard.exp_year,
        }
      : null,
  };
}

describe('buildAutopayCardExpirations', () => {
  it('returns no rows and stripeConfigured=true when there are no customers', async () => {
    mockPrisma.customer.findMany.mockResolvedValue([]);
    const data = await buildAutopayCardExpirations('tenant-1');
    expect(data.rows).toEqual([]);
    expect(data.stripeConfigured).toBe(true);
    expect(data.summary.total).toBe(0);
    expect(data.summary.stripeError).toBe(0);
  });

  it('skips confirmed non-autopay customers (no row, no stripeError)', async () => {
    mockPrisma.customer.findMany.mockResolvedValue([makeCustomer()]);
    stripeMock.customers.retrieve.mockResolvedValue(
      makeStripeCustomer({ autopay: false, card: { exp_month: 12, exp_year: 2099 } }),
    );
    const data = await buildAutopayCardExpirations('tenant-1');
    expect(data.rows).toEqual([]);
    expect(data.summary.total).toBe(0);
    expect(data.summary.stripeError).toBe(0);
  });

  it('emits "No card on file" when autopay customer has no default payment method', async () => {
    mockPrisma.customer.findMany.mockResolvedValue([makeCustomer()]);
    stripeMock.customers.retrieve.mockResolvedValue(
      makeStripeCustomer({ autopay: true, card: null, legacyCard: null }),
    );
    const data = await buildAutopayCardExpirations('tenant-1');
    expect(data.rows).toHaveLength(1);
    expect(data.rows[0].bucket).toBe('No card on file');
    expect(data.rows[0].cardBrand).toBeNull();
    expect(data.summary.noCard).toBe(1);
    expect(data.summary.total).toBe(1);
  });

  it('emits a "Stripe error" row (not silently dropped) when the customer has no Connect account', async () => {
    mockPrisma.customer.findMany.mockResolvedValue([makeCustomer()]);
    // No location-level stripe account, and no tenant-level fallback.
    mockPrisma.invoice.findFirst.mockResolvedValue(null);
    mockPrisma.tenant.findUnique.mockResolvedValue({ stripeAccountId: null });
    const data = await buildAutopayCardExpirations('tenant-1');
    expect(stripeMock.customers.retrieve).not.toHaveBeenCalled();
    expect(data.rows).toHaveLength(1);
    expect(data.rows[0].bucket).toBe('Stripe error');
    expect(data.rows[0].status).toMatch(/Stripe Connect/);
    expect(data.summary.stripeError).toBe(1);
    expect(data.summary.total).toBe(1);
  });

  it('emits a "Stripe error" row when stripe.customers.retrieve throws', async () => {
    mockPrisma.customer.findMany.mockResolvedValue([makeCustomer()]);
    stripeMock.customers.retrieve.mockRejectedValue(new Error('rate limited'));
    const data = await buildAutopayCardExpirations('tenant-1');
    expect(data.rows).toHaveLength(1);
    expect(data.rows[0].bucket).toBe('Stripe error');
    expect(data.rows[0].status).toContain('rate limited');
    expect(data.summary.stripeError).toBe(1);
  });

  it('emits a "Stripe error" row when the Stripe customer is deleted', async () => {
    mockPrisma.customer.findMany.mockResolvedValue([makeCustomer()]);
    stripeMock.customers.retrieve.mockResolvedValue({ id: 'cus_stripe_1', deleted: true });
    const data = await buildAutopayCardExpirations('tenant-1');
    expect(data.rows).toHaveLength(1);
    expect(data.rows[0].bucket).toBe('Stripe error');
    expect(data.rows[0].status).toMatch(/deleted/i);
    expect(data.summary.stripeError).toBe(1);
  });

  it('buckets an already-expired card as "Expired"', async () => {
    mockPrisma.customer.findMany.mockResolvedValue([makeCustomer()]);
    stripeMock.customers.retrieve.mockResolvedValue(
      makeStripeCustomer({ autopay: true, card: { exp_month: 1, exp_year: 2020 } }),
    );
    const data = await buildAutopayCardExpirations('tenant-1');
    expect(data.rows).toHaveLength(1);
    expect(data.rows[0].bucket).toBe('Expired');
    expect(data.rows[0].cardBrand).toBe('visa');
    expect(data.rows[0].last4).toBe('4242');
    expect(data.summary.expired).toBe(1);
  });

  it('falls back to legacy default_source card when default_payment_method is null', async () => {
    mockPrisma.customer.findMany.mockResolvedValue([makeCustomer()]);
    stripeMock.customers.retrieve.mockResolvedValue(
      makeStripeCustomer({
        autopay: true,
        card: null,
        legacyCard: { exp_month: 1, exp_year: 2020, brand: 'mastercard', last4: '5555' },
      }),
    );
    const data = await buildAutopayCardExpirations('tenant-1');
    expect(data.rows).toHaveLength(1);
    expect(data.rows[0].bucket).toBe('Expired');
    expect(data.rows[0].cardBrand).toBe('mastercard');
    expect(data.rows[0].last4).toBe('5555');
  });

  it('sorts rows by bucket severity (Expired/No card/Stripe error first, then by days)', async () => {
    const c1 = makeCustomer({ id: 'a', stripeCustomerId: 'cus_a' });
    const c2 = makeCustomer({ id: 'b', stripeCustomerId: 'cus_b' });
    const c3 = makeCustomer({ id: 'c', stripeCustomerId: 'cus_c' });
    mockPrisma.customer.findMany.mockResolvedValue([c1, c2, c3]);

    const future = new Date();
    future.setMonth(future.getMonth() + 24);
    stripeMock.customers.retrieve.mockImplementation((id: string) => {
      if (id === 'cus_a') {
        // Expires far in the future
        return Promise.resolve(
          makeStripeCustomer({
            autopay: true,
            card: { exp_month: future.getMonth() + 1, exp_year: future.getFullYear() },
          }),
        );
      }
      if (id === 'cus_b') {
        // Already expired
        return Promise.resolve(
          makeStripeCustomer({ autopay: true, card: { exp_month: 1, exp_year: 2020 } }),
        );
      }
      // c
      return Promise.resolve(makeStripeCustomer({ autopay: true, card: null }));
    });

    const data = await buildAutopayCardExpirations('tenant-1');
    expect(data.rows.map((r) => r.bucket)).toEqual([
      'Expired',
      'No card on file',
      '>90 days',
    ]);
  });

  it('returns stripeConfigured=false and no rows when STRIPE_SECRET_KEY is missing', async () => {
    // Re-mock the stripe module so `stripeClient` is null at import time.
    vi.resetModules();
    vi.doMock('../../src/lib/stripe.js', () => ({
      stripe: null,
      requireStripe: () => {
        throw new Error('Stripe is not configured');
      },
    }));
    const fresh = await import('../../src/services/report-data.js');
    mockPrisma.customer.findMany.mockResolvedValue([makeCustomer()]);
    const data = await fresh.buildAutopayCardExpirations('tenant-1');
    expect(data.stripeConfigured).toBe(false);
    expect(data.rows).toEqual([]);
    expect(data.summary.total).toBe(0);
    vi.doUnmock('../../src/lib/stripe.js');
    vi.resetModules();
  });
});
