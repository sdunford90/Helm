import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { mockPrisma } from '../setup.js';

function makeP2002Error() {
  return new Prisma.PrismaClientKnownRequestError(
    'Unique constraint failed on the fields: (`tenant_pm_expiry_window`)',
    { code: 'P2002', clientVersion: 'test', meta: { target: ['tenant_pm_expiry_window'] } },
  );
}

// We mock the Stripe-account resolver so the unit test doesn't need to
// build invoice/location data — every customer resolves to the same fake
// connected account.
vi.mock('../../src/lib/stripe-account.js', () => ({
  getStripeAccountForCustomer: vi.fn().mockResolvedValue({
    stripeAccountId: 'acct_test',
    locationConnected: true,
    locationName: null,
  }),
}));

// We also need to mock the queue module's `email.add` so we can assert on
// the queued payload. `setup.ts` already provides this stub but we capture
// a reference for direct introspection.
import { queues } from '../../src/lib/queue.js';

// And the Stripe SDK mock (provided by setup.ts) — we override
// `customers.retrieve` and `paymentMethods.retrieve` per test.
import { stripe } from '../../src/lib/stripe.js';

let runCardExpiryReminders: typeof import('../../src/services/card-expiry-reminders.js').runCardExpiryReminders;
let pickExpiryWindow: typeof import('../../src/services/card-expiry-reminders.js').pickExpiryWindow;
let cardExpiryDate: typeof import('../../src/services/card-expiry-reminders.js').cardExpiryDate;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('../../src/services/card-expiry-reminders.js');
  runCardExpiryReminders = mod.runCardExpiryReminders;
  pickExpiryWindow = mod.pickExpiryWindow;
  cardExpiryDate = mod.cardExpiryDate;

  // Default: tenant exists.
  mockPrisma.tenant.findUnique.mockResolvedValue({
    id: 'tenant-1',
    name: 'Test Marina',
    subdomain: 'test',
  });

  // Default: no prior reminder rows. The service inserts a PENDING row
  // first (the reservation), then flips it to SENT after enqueue succeeds.
  mockPrisma.cardExpiryReminder.findUnique.mockResolvedValue(null);
  mockPrisma.cardExpiryReminder.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'reminder-1',
    sentAt: null,
    ...data,
  }));
  mockPrisma.cardExpiryReminder.update.mockImplementation(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => ({
    id: (where.id as string) ?? 'reminder-1',
    ...data,
  }));
});

function makeCustomer(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cust-1',
    tenantId: 'tenant-1',
    firstName: 'Jane',
    lastName: 'Smith',
    email: 'jane@test.com',
    stripeCustomerId: 'cus_test',
    ...overrides,
  };
}

function stubStripeForDefaultCard(card: {
  id?: string;
  exp_month: number | null;
  exp_year: number | null;
  brand?: string;
  last4?: string;
}) {
  (stripe!.customers.retrieve as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    id: 'cus_test',
    invoice_settings: { default_payment_method: card.id ?? 'pm_test' },
    default_source: null,
  });
  (stripe!.paymentMethods as unknown as { retrieve: ReturnType<typeof vi.fn> }).retrieve = vi
    .fn()
    .mockResolvedValueOnce({
      id: card.id ?? 'pm_test',
      type: 'card',
      card: {
        brand: card.brand ?? 'visa',
        last4: card.last4 ?? '4242',
        exp_month: card.exp_month,
        exp_year: card.exp_year,
      },
    });
}

describe('cardExpiryDate', () => {
  it('returns the last moment of the expiry month in UTC', () => {
    const d = cardExpiryDate(2, 2026);
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(1); // February (0-indexed)
    expect(d.getUTCDate()).toBe(28);
    expect(d.getUTCHours()).toBe(23);
  });

  it('handles year-end rollover', () => {
    const d = cardExpiryDate(12, 2026);
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(11); // December
    expect(d.getUTCDate()).toBe(31);
  });
});

describe('pickExpiryWindow', () => {
  it('returns null when card is more than 30 days out', () => {
    const now = new Date(Date.UTC(2026, 0, 1)); // Jan 1 2026
    expect(pickExpiryWindow(6, 2026, now)).toBeNull();
  });

  it('returns 30_DAY in the [30..7] window', () => {
    // Card expires May 31 2026; today = May 15 2026 → ~16 days out.
    const now = new Date(Date.UTC(2026, 4, 15));
    expect(pickExpiryWindow(5, 2026, now)).toBe('30_DAY');
  });

  it('returns 7_DAY when within 7 days of expiry', () => {
    // Card expires May 31 2026; today = May 28 2026 → 3 days out.
    const now = new Date(Date.UTC(2026, 4, 28));
    expect(pickExpiryWindow(5, 2026, now)).toBe('7_DAY');
  });

  it('returns null for already-expired cards', () => {
    const now = new Date(Date.UTC(2026, 6, 1)); // Jul 1 2026
    expect(pickExpiryWindow(5, 2026, now)).toBeNull();
  });
});

describe('runCardExpiryReminders', () => {
  it('does not send when card is more than 30 days out', async () => {
    mockPrisma.customer.findMany.mockResolvedValue([makeCustomer()]);
    stubStripeForDefaultCard({ exp_month: 12, exp_year: 2026 });

    const now = new Date(Date.UTC(2026, 0, 1));
    const r = await runCardExpiryReminders('tenant-1', now);

    expect(r.scanned).toBe(1);
    expect(r.remindersSent).toBe(0);
    expect(queues.email.add).not.toHaveBeenCalled();
    expect(mockPrisma.cardExpiryReminder.create).not.toHaveBeenCalled();
  });

  it('sends a 30_DAY reminder and writes the idempotency row', async () => {
    mockPrisma.customer.findMany.mockResolvedValue([makeCustomer()]);
    stubStripeForDefaultCard({ exp_month: 5, exp_year: 2026, last4: '1111', brand: 'visa' });

    // May 15 2026 → ~16 days from end of May.
    const now = new Date(Date.UTC(2026, 4, 15));
    const r = await runCardExpiryReminders('tenant-1', now);

    expect(r.remindersSent).toBe(1);
    expect(queues.email.add).toHaveBeenCalledTimes(1);
    const [, payload] = (queues.email.add as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(payload.type).toBe('card_expiry_reminder');
    expect(payload.to).toBe('jane@test.com');
    expect(payload.tenantId).toBe('tenant-1');
    expect(payload.data.window).toBe('30_DAY');
    expect(payload.data.last4).toBe('1111');
    expect(payload.data.expiryLabel).toBe('05/2026');
    expect(payload.data.portalUrl).toMatch(/\/payments$/);

    // Reservation is written FIRST as PENDING (before enqueue) and then
    // flipped to SENT — that's what guarantees the at-most-once contract.
    expect(mockPrisma.cardExpiryReminder.create).toHaveBeenCalledTimes(1);
    const createArg = (mockPrisma.cardExpiryReminder.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(createArg.data).toMatchObject({
      tenantId: 'tenant-1',
      customerId: 'cust-1',
      stripePaymentMethodId: 'pm_test',
      stripeAccountId: 'acct_test',
      expMonth: 5,
      expYear: 2026,
      window: '30_DAY',
      status: 'PENDING',
    });

    expect(mockPrisma.cardExpiryReminder.update).toHaveBeenCalledTimes(1);
    const updateArg = (mockPrisma.cardExpiryReminder.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(updateArg.data).toMatchObject({ status: 'SENT' });
    expect(updateArg.data.sentAt).toBeInstanceOf(Date);

    // Ordering: reservation must complete before the email is enqueued.
    const createOrder = (mockPrisma.cardExpiryReminder.create as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    const enqueueOrder = (queues.email.add as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    expect(createOrder).toBeLessThan(enqueueOrder);
  });

  it('sends a 7_DAY reminder when within a week of expiry', async () => {
    mockPrisma.customer.findMany.mockResolvedValue([makeCustomer()]);
    stubStripeForDefaultCard({ exp_month: 5, exp_year: 2026 });

    // May 28 2026 → 3 days left.
    const now = new Date(Date.UTC(2026, 4, 28));
    const r = await runCardExpiryReminders('tenant-1', now);

    expect(r.remindersSent).toBe(1);
    const [, payload] = (queues.email.add as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(payload.data.window).toBe('7_DAY');
  });

  it('skips already-sent (tenant + pm + expiry-month + window) rows', async () => {
    // Concurrent or repeat run: the unique-index insert loses (P2002) and
    // the existing row is already SENT — skip without enqueuing.
    mockPrisma.customer.findMany.mockResolvedValue([makeCustomer()]);
    stubStripeForDefaultCard({ exp_month: 5, exp_year: 2026 });
    mockPrisma.cardExpiryReminder.create.mockRejectedValueOnce(makeP2002Error());
    mockPrisma.cardExpiryReminder.findUnique.mockResolvedValueOnce({
      id: 'existing-sent',
      tenantId: 'tenant-1',
      stripePaymentMethodId: 'pm_test',
      expMonth: 5,
      expYear: 2026,
      window: '30_DAY',
      status: 'SENT',
    });

    const now = new Date(Date.UTC(2026, 4, 15));
    const r = await runCardExpiryReminders('tenant-1', now);

    expect(r.remindersSent).toBe(0);
    expect(r.skippedAlreadySent).toBe(1);
    expect(queues.email.add).not.toHaveBeenCalled();
    expect(mockPrisma.cardExpiryReminder.update).not.toHaveBeenCalled();
  });

  it('does not double-enqueue when a concurrent sweep already holds a fresh PENDING reservation', async () => {
    // Two sweeps run in the same minute. Sweep A inserts PENDING and is
    // mid-flight (still fresh — within the lease window). Sweep B's
    // INSERT loses the unique race (P2002), looks up the existing row,
    // sees PENDING + fresh, and MUST skip without enqueuing — otherwise
    // the customer gets two reminder emails for the same card+window.
    const now = new Date(Date.UTC(2026, 4, 15, 12, 0, 0));
    mockPrisma.customer.findMany.mockResolvedValue([makeCustomer()]);
    stubStripeForDefaultCard({ exp_month: 5, exp_year: 2026 });
    mockPrisma.cardExpiryReminder.create.mockRejectedValueOnce(makeP2002Error());
    mockPrisma.cardExpiryReminder.findUnique.mockResolvedValueOnce({
      id: 'in-flight',
      tenantId: 'tenant-1',
      stripePaymentMethodId: 'pm_test',
      expMonth: 5,
      expYear: 2026,
      window: '30_DAY',
      status: 'PENDING',
      // reservedAt is one minute ago — well inside the 1-hour lease.
      reservedAt: new Date(now.getTime() - 60_000),
    });

    const r = await runCardExpiryReminders('tenant-1', now);

    expect(r.remindersSent).toBe(0);
    expect(r.skippedAlreadySent).toBe(1);
    expect(queues.email.add).not.toHaveBeenCalled();
    expect(mockPrisma.cardExpiryReminder.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.cardExpiryReminder.update).not.toHaveBeenCalled();
  });

  it('skips when the existing reservation is already SENT', async () => {
    mockPrisma.customer.findMany.mockResolvedValue([makeCustomer()]);
    stubStripeForDefaultCard({ exp_month: 5, exp_year: 2026 });
    mockPrisma.cardExpiryReminder.create.mockRejectedValueOnce(makeP2002Error());
    mockPrisma.cardExpiryReminder.findUnique.mockResolvedValueOnce({
      id: 'already-sent',
      tenantId: 'tenant-1',
      stripePaymentMethodId: 'pm_test',
      expMonth: 5,
      expYear: 2026,
      window: '30_DAY',
      status: 'SENT',
      reservedAt: new Date(Date.UTC(2026, 4, 14)),
    });

    const r = await runCardExpiryReminders('tenant-1', new Date(Date.UTC(2026, 4, 15)));

    expect(r.skippedAlreadySent).toBe(1);
    expect(queues.email.add).not.toHaveBeenCalled();
  });

  it('takes over a stale PENDING reservation (crashed prior run) and completes the send', async () => {
    // A previous sweep reserved PENDING and crashed before enqueueing.
    // The reservedAt is older than the 1-hour lease, so the next sweep
    // can take over via the conditional updateMany.
    const now = new Date(Date.UTC(2026, 4, 15, 13, 0, 0));
    mockPrisma.customer.findMany.mockResolvedValue([makeCustomer()]);
    stubStripeForDefaultCard({ exp_month: 5, exp_year: 2026 });
    mockPrisma.cardExpiryReminder.create.mockRejectedValueOnce(makeP2002Error());
    mockPrisma.cardExpiryReminder.findUnique.mockResolvedValueOnce({
      id: 'stale-pending',
      tenantId: 'tenant-1',
      stripePaymentMethodId: 'pm_test',
      expMonth: 5,
      expYear: 2026,
      window: '30_DAY',
      status: 'PENDING',
      // 2 hours ago — definitely past the 1-hour lease.
      reservedAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
    });
    // Our updateMany takeover wins.
    mockPrisma.cardExpiryReminder.updateMany.mockResolvedValueOnce({ count: 1 });

    const r = await runCardExpiryReminders('tenant-1', now);

    expect(r.remindersSent).toBe(1);
    expect(queues.email.add).toHaveBeenCalledTimes(1);
    expect(mockPrisma.cardExpiryReminder.updateMany).toHaveBeenCalledTimes(1);
    const takeoverArg = (mockPrisma.cardExpiryReminder.updateMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(takeoverArg.where).toMatchObject({
      id: 'stale-pending',
      status: 'PENDING',
    });
    expect(takeoverArg.where.reservedAt).toMatchObject({ lt: expect.any(Date) });
    // The flip-to-SENT should target the existing reserved row.
    const updateArg = (mockPrisma.cardExpiryReminder.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(updateArg.where).toMatchObject({ id: 'stale-pending' });
    expect(updateArg.data).toMatchObject({ status: 'SENT' });
  });

  it('skips when losing the takeover race for a stale PENDING reservation', async () => {
    // Two sweeps both see the same stale PENDING and both attempt the
    // conditional updateMany. Only one wins (count=1); the loser sees
    // count=0 and MUST skip — otherwise both would enqueue the email.
    const now = new Date(Date.UTC(2026, 4, 15, 13, 0, 0));
    mockPrisma.customer.findMany.mockResolvedValue([makeCustomer()]);
    stubStripeForDefaultCard({ exp_month: 5, exp_year: 2026 });
    mockPrisma.cardExpiryReminder.create.mockRejectedValueOnce(makeP2002Error());
    mockPrisma.cardExpiryReminder.findUnique.mockResolvedValueOnce({
      id: 'stale-pending',
      tenantId: 'tenant-1',
      stripePaymentMethodId: 'pm_test',
      expMonth: 5,
      expYear: 2026,
      window: '30_DAY',
      status: 'PENDING',
      reservedAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
    });
    // The other runner won; our conditional update affects 0 rows.
    mockPrisma.cardExpiryReminder.updateMany.mockResolvedValueOnce({ count: 0 });

    const r = await runCardExpiryReminders('tenant-1', now);

    expect(r.remindersSent).toBe(0);
    expect(r.skippedAlreadySent).toBe(1);
    expect(queues.email.add).not.toHaveBeenCalled();
    expect(mockPrisma.cardExpiryReminder.update).not.toHaveBeenCalled();
  });

  it('two simultaneous sweeps result in exactly one enqueue (end-to-end concurrency check)', async () => {
    // Drives two `runCardExpiryReminders` calls in parallel, simulating
    // the realistic Postgres behaviour: the unique-index INSERT
    // serialises the two writers — one returns the row, the other gets
    // P2002. Asserts the queue is hit exactly once across both runs.
    mockPrisma.customer.findMany.mockResolvedValue([makeCustomer()]);

    // Each run does its own customer.retrieve + paymentMethods.retrieve.
    (stripe!.customers.retrieve as ReturnType<typeof vi.fn>)
      .mockResolvedValue({
        id: 'cus_test',
        invoice_settings: { default_payment_method: 'pm_test' },
        default_source: null,
      });
    const pmRetrieve = vi.fn().mockResolvedValue({
      id: 'pm_test',
      type: 'card',
      card: { brand: 'visa', last4: '4242', exp_month: 5, exp_year: 2026 },
    });
    (stripe!.paymentMethods as unknown as { retrieve: ReturnType<typeof vi.fn> }).retrieve = pmRetrieve;

    const now = new Date(Date.UTC(2026, 4, 15, 12, 0, 0));
    // Simulate the unique-index race: first create wins, second gets P2002.
    // reservedAt must equal `now` so the loser sees a *fresh* lease and
    // refuses to adopt — this is the entire point of the protection.
    const winnerRow = {
      id: 'winner',
      tenantId: 'tenant-1',
      customerId: 'cust-1',
      stripePaymentMethodId: 'pm_test',
      stripeAccountId: 'acct_test',
      brand: 'visa',
      last4: '4242',
      expMonth: 5,
      expYear: 2026,
      window: '30_DAY',
      status: 'PENDING',
      reservedAt: now,
      sentAt: null,
    };
    (mockPrisma.cardExpiryReminder.create as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(winnerRow)
      .mockRejectedValueOnce(makeP2002Error());
    // Loser's findUnique sees the freshly-inserted PENDING row.
    mockPrisma.cardExpiryReminder.findUnique.mockResolvedValueOnce(winnerRow);
    const [a, b] = await Promise.all([
      runCardExpiryReminders('tenant-1', now),
      runCardExpiryReminders('tenant-1', now),
    ]);

    // Exactly one enqueue across both sweeps.
    expect(queues.email.add).toHaveBeenCalledTimes(1);
    // Exactly one flip-to-SENT.
    expect(mockPrisma.cardExpiryReminder.update).toHaveBeenCalledTimes(1);
    // One sweep sends, the other accounts for the duplicate as already-in-flight.
    expect(a.remindersSent + b.remindersSent).toBe(1);
    expect(a.skippedAlreadySent + b.skippedAlreadySent).toBe(1);
  });

  it('skips already-expired cards', async () => {
    mockPrisma.customer.findMany.mockResolvedValue([makeCustomer()]);
    stubStripeForDefaultCard({ exp_month: 1, exp_year: 2026 });

    // Card expired Jan 31 2026; today is Feb 5 2026.
    const now = new Date(Date.UTC(2026, 1, 5));
    const r = await runCardExpiryReminders('tenant-1', now);

    expect(r.remindersSent).toBe(0);
    expect(r.skippedExpired).toBe(1);
    expect(queues.email.add).not.toHaveBeenCalled();
  });

  it('skips customers with no email on file', async () => {
    mockPrisma.customer.findMany.mockResolvedValue([
      makeCustomer({ email: null }),
    ]);

    const r = await runCardExpiryReminders('tenant-1', new Date(Date.UTC(2026, 4, 15)));
    expect(r.remindersSent).toBe(0);
    expect(r.skippedNoCard).toBe(1);
  });

  it('skips customers whose default payment method is not a card', async () => {
    mockPrisma.customer.findMany.mockResolvedValue([makeCustomer()]);
    (stripe!.customers.retrieve as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'cus_test',
      invoice_settings: { default_payment_method: 'pm_bank' },
      default_source: null,
    });
    (stripe!.paymentMethods as unknown as { retrieve: ReturnType<typeof vi.fn> }).retrieve = vi
      .fn()
      .mockResolvedValueOnce({
        id: 'pm_bank',
        type: 'us_bank_account',
        us_bank_account: { last4: '0000', bank_name: 'Test Bank' },
      });

    const r = await runCardExpiryReminders('tenant-1', new Date(Date.UTC(2026, 4, 15)));
    expect(r.remindersSent).toBe(0);
    expect(r.skippedNoCard).toBe(1);
  });

  it('skips customers with no default payment method set', async () => {
    mockPrisma.customer.findMany.mockResolvedValue([makeCustomer()]);
    (stripe!.customers.retrieve as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'cus_test',
      invoice_settings: { default_payment_method: null },
      default_source: null,
    });

    const r = await runCardExpiryReminders('tenant-1', new Date(Date.UTC(2026, 4, 15)));
    expect(r.remindersSent).toBe(0);
    expect(r.skippedNoCard).toBe(1);
  });

  it('counts errors per-customer without aborting the whole sweep', async () => {
    mockPrisma.customer.findMany.mockResolvedValue([
      makeCustomer({ id: 'cust-a', email: 'a@test.com' }),
      makeCustomer({ id: 'cust-b', email: 'b@test.com' }),
    ]);

    // Customer A throws on Stripe retrieve; Customer B succeeds with a 30-day card.
    (stripe!.customers.retrieve as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('stripe down'))
      .mockResolvedValueOnce({
        id: 'cus_test',
        invoice_settings: { default_payment_method: 'pm_b' },
        default_source: null,
      });
    (stripe!.paymentMethods as unknown as { retrieve: ReturnType<typeof vi.fn> }).retrieve = vi
      .fn()
      .mockResolvedValueOnce({
        id: 'pm_b',
        type: 'card',
        card: { brand: 'visa', last4: '4242', exp_month: 5, exp_year: 2026 },
      });

    const r = await runCardExpiryReminders('tenant-1', new Date(Date.UTC(2026, 4, 15)));
    expect(r.scanned).toBe(2);
    expect(r.errors).toBe(1);
    expect(r.remindersSent).toBe(1);
  });
});
