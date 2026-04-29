import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { mockPrisma } from '../setup.js';

// Lock down task #196's third fix: when Stripe Connect onboarding closes
// successfully, the web client calls POST /api/settings/stripe/refresh-status.
// The handler pulls the live Stripe account, sees charges_enabled=true, and
// flips Location.stripeOnboardingComplete to true so the UI doesn't have to
// wait for the account.updated webhook. The flag must NEVER be flipped back
// to false here — handleAccountUpdated owns ongoing capability state.

const stripeAccountsRetrieve = vi.fn();

vi.mock('../../src/lib/stripe.js', () => ({
  stripe: { accounts: { retrieve: stripeAccountsRetrieve } },
  requireStripe: () => ({ accounts: { retrieve: stripeAccountsRetrieve } }),
  createPaymentIntent: vi.fn().mockResolvedValue({ id: 'pi_test', client_secret: 'cs_test' }),
  createCustomer: vi.fn().mockResolvedValue({ id: 'cus_test' }),
  processWebhook: vi.fn().mockResolvedValue(null),
}));

let app: any;

beforeEach(async () => {
  vi.clearAllMocks();
  stripeAccountsRetrieve.mockReset();

  // Wire up location and auditLog mocks. Other tests share mockPrisma so
  // we re-bind these per test.
  (mockPrisma as any).location.findFirst = vi.fn();
  (mockPrisma as any).location.update = vi.fn().mockResolvedValue({ id: 'loc-1' });
  mockPrisma.auditLog.create = vi.fn().mockResolvedValue({ id: 'audit-1' }) as any;

  const mod = await import('../../src/index.js');
  app = mod.default;
});

describe('POST /api/settings/stripe/refresh-status — flips stripeOnboardingComplete (task #196)', () => {
  it('flips Location.stripeOnboardingComplete to true and writes a STRIPE_ACCOUNT_UPDATED audit log when charges_enabled=true', async () => {
    (mockPrisma as any).location.findFirst.mockResolvedValue({
      id: 'loc-1',
      stripeAccountId: 'acct_live_1234567890',
      stripeOnboardingComplete: false,
    });
    stripeAccountsRetrieve.mockResolvedValue({
      id: 'acct_live_1234567890',
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
    });

    const res = await request(app)
      .post('/api/settings/stripe/refresh-status')
      .send({ locationId: 'loc-1' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      connected: true,
      onboardingComplete: true,
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    });

    // Stripe account was retrieved using the location's connected account id.
    expect(stripeAccountsRetrieve).toHaveBeenCalledWith('acct_live_1234567890');

    // Location was updated to mark onboarding complete.
    expect((mockPrisma as any).location.update).toHaveBeenCalledTimes(1);
    expect((mockPrisma as any).location.update).toHaveBeenCalledWith({
      where: { id: 'loc-1' },
      data: { stripeOnboardingComplete: true },
    });

    // Audit log entry was written with the right action and source.
    expect(mockPrisma.auditLog.create).toHaveBeenCalledTimes(1);
    const auditCall = vi.mocked(mockPrisma.auditLog.create).mock.calls[0][0] as any;
    expect(auditCall.data).toMatchObject({
      tenantId: 'test-tenant-id',
      recordType: 'Location',
      recordId: 'loc-1',
      action: 'STRIPE_ACCOUNT_UPDATED',
    });
    expect(auditCall.data.changedFieldsJson).toMatchObject({
      source: 'settings/stripe/refresh-status',
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
      locationId: 'loc-1',
    });
  });

  it('does NOT flip stripeOnboardingComplete back to false on a subsequent call where charges_enabled is now false', async () => {
    // Location is already marked complete. Stripe later reports
    // charges_enabled=false (e.g. capability dropped). The refresh-status
    // route is the client-side polling helper; it must not silently undo
    // the connected flag — the account.updated webhook owns ongoing
    // capability state.
    (mockPrisma as any).location.findFirst.mockResolvedValue({
      id: 'loc-1',
      stripeAccountId: 'acct_live_1234567890',
      stripeOnboardingComplete: true,
    });
    stripeAccountsRetrieve.mockResolvedValue({
      id: 'acct_live_1234567890',
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: true,
    });

    const res = await request(app)
      .post('/api/settings/stripe/refresh-status')
      .send({ locationId: 'loc-1' });

    expect(res.status).toBe(200);
    // onboardingComplete stays true because the persisted flag is true.
    expect(res.body).toMatchObject({
      onboardingComplete: true,
      chargesEnabled: false,
    });

    // No write to Location.update — the route never writes
    // stripeOnboardingComplete=false.
    expect((mockPrisma as any).location.update).not.toHaveBeenCalled();
    // No audit log entry — nothing changed.
    expect(mockPrisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('is idempotent — calling refresh-status again when the flag is already true is a no-op write/audit', async () => {
    // Location is already marked complete and Stripe still says yes.
    (mockPrisma as any).location.findFirst.mockResolvedValue({
      id: 'loc-1',
      stripeAccountId: 'acct_live_1234567890',
      stripeOnboardingComplete: true,
    });
    stripeAccountsRetrieve.mockResolvedValue({
      id: 'acct_live_1234567890',
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
    });

    const res = await request(app)
      .post('/api/settings/stripe/refresh-status')
      .send({ locationId: 'loc-1' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ onboardingComplete: true, chargesEnabled: true });

    // Critically: no duplicate audit log spam, no redundant DB write.
    expect((mockPrisma as any).location.update).not.toHaveBeenCalled();
    expect(mockPrisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('does not write the audit log when charges_enabled is still false on a fresh location', async () => {
    (mockPrisma as any).location.findFirst.mockResolvedValue({
      id: 'loc-1',
      stripeAccountId: 'acct_live_1234567890',
      stripeOnboardingComplete: false,
    });
    stripeAccountsRetrieve.mockResolvedValue({
      id: 'acct_live_1234567890',
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: false,
    });

    const res = await request(app)
      .post('/api/settings/stripe/refresh-status')
      .send({ locationId: 'loc-1' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      connected: false,
      onboardingComplete: false,
      chargesEnabled: false,
    });
    expect((mockPrisma as any).location.update).not.toHaveBeenCalled();
    expect(mockPrisma.auditLog.create).not.toHaveBeenCalled();
  });
});
