import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockPrisma } from '../setup.js';

// Exercise the real computeZOut implementation. Setup.ts doesn't mock
// pos-zout, so importOriginal isn't strictly needed — but we re-import
// inside beforeEach to pick up a fresh module each test.
let computeZOut: typeof import('../../src/services/pos-zout.js').computeZOut;
let stripeMockRef: {
  paymentIntents: {
    retrieve: ReturnType<typeof vi.fn>;
  };
};

beforeEach(async () => {
  vi.clearAllMocks();
  const stripeMod = await import('../../src/lib/stripe.js');
  stripeMockRef = stripeMod.stripe as unknown as typeof stripeMockRef;
  const mod = await import('../../src/services/pos-zout.js');
  computeZOut = mod.computeZOut;
});

// ---------------------------------------------------------------------------
// Task #332: Z-out PI verification must hit the connected Stripe account
// for per-location Connect marinas. Looking the PI up on the platform
// account raises `resource_missing` and used to flood successful card
// sales into `unverifiedRowIds`.
// ---------------------------------------------------------------------------

describe('computeZOut Stripe account routing', () => {
  it('retrieves PIs on the connected account when the location has one and counts them as captured', async () => {
    mockPrisma.shift.findUnique = vi.fn().mockResolvedValue({
      id: 'shift-1',
      tenantId: 'tenant-1',
      locationId: 'loc-1',
      cashierId: 'user-1',
      openedAt: new Date('2026-05-04T20:00:00Z'),
      closedAt: new Date('2026-05-04T20:31:35Z'),
      openingFloatCents: 0,
      closingCashCents: 0,
      declaredCheckCents: 0,
      declaredOtherCents: 0,
      paidOutsCents: 0,
      transactions: [
        {
          id: 'tx-1',
          tenantId: 'tenant-1',
          status: 'CARD',
          cardRail: 'CNP',
          totalCents: 5000,
          subtotalCents: 5000,
          taxCents: 0,
          tipCents: 0,
          stripePaymentIntentId: 'pi_connected_1',
          stripeAccountId: 'acct_connect_loc1',
          createdAt: new Date(),
          lineItems: [],
        },
        // Second sale with no stored stripeAccountId — should fall back
        // to the location's currently-configured connected account.
        {
          id: 'tx-2',
          tenantId: 'tenant-1',
          status: 'CARD',
          cardRail: 'CNP',
          totalCents: 2500,
          subtotalCents: 2500,
          taxCents: 0,
          tipCents: 0,
          stripePaymentIntentId: 'pi_connected_2',
          stripeAccountId: null,
          createdAt: new Date(),
          lineItems: [],
        },
      ],
    });
    mockPrisma.user.findUnique = vi.fn().mockResolvedValue(null);
    mockPrisma.location.findFirst = vi
      .fn()
      .mockResolvedValue({ stripeAccountId: 'acct_connect_loc1' });

    stripeMockRef.paymentIntents.retrieve = vi
      .fn()
      .mockImplementation((piId: string) =>
        Promise.resolve({ id: piId, status: 'succeeded', amount_received: piId === 'pi_connected_1' ? 5000 : 2500 }),
      );

    const snap = await computeZOut('shift-1', null);

    // Both PIs were looked up on the connected account.
    expect(stripeMockRef.paymentIntents.retrieve).toHaveBeenCalledTimes(2);
    for (const call of stripeMockRef.paymentIntents.retrieve.mock.calls) {
      expect(call[0]).toMatch(/^pi_connected_/);
      // signature: retrieve(id, params?, options?)
      expect(call[2]).toEqual({ stripeAccount: 'acct_connect_loc1' });
    }

    expect(snap.stripeMatching.verifiedAgainstStripe).toBe(true);
    expect(snap.stripeMatching.capturedCount).toBe(2);
    expect(snap.stripeMatching.capturedSumCents).toBe(7500);
    expect(snap.stripeMatching.unverifiedRowIds).toEqual([]);
    expect(snap.stripeMatching.uncapturedRowIds).toEqual([]);
  });

  it('flows real Stripe errors into unverifiedRowIds without blocking the close', async () => {
    mockPrisma.shift.findUnique = vi.fn().mockResolvedValue({
      id: 'shift-2',
      tenantId: 'tenant-1',
      locationId: 'loc-1',
      cashierId: 'user-1',
      openedAt: new Date(),
      closedAt: new Date(),
      openingFloatCents: 0,
      closingCashCents: 0,
      declaredCheckCents: 0,
      declaredOtherCents: 0,
      paidOutsCents: 0,
      transactions: [
        {
          id: 'tx-err',
          tenantId: 'tenant-1',
          status: 'CARD',
          cardRail: 'CNP',
          totalCents: 1000,
          subtotalCents: 1000,
          taxCents: 0,
          tipCents: 0,
          stripePaymentIntentId: 'pi_unreachable',
          stripeAccountId: 'acct_connect_loc1',
          createdAt: new Date(),
          lineItems: [],
        },
      ],
    });
    mockPrisma.user.findUnique = vi.fn().mockResolvedValue(null);
    mockPrisma.location.findFirst = vi
      .fn()
      .mockResolvedValue({ stripeAccountId: 'acct_connect_loc1' });

    stripeMockRef.paymentIntents.retrieve = vi
      .fn()
      .mockRejectedValue(new Error('network down'));

    const snap = await computeZOut('shift-2', null);

    expect(stripeMockRef.paymentIntents.retrieve).toHaveBeenCalledWith(
      'pi_unreachable',
      undefined,
      { stripeAccount: 'acct_connect_loc1' },
    );
    expect(snap.stripeMatching.unverifiedRowIds).toEqual(['tx-err']);
    expect(snap.stripeMatching.capturedCount).toBe(0);
    expect(snap.stripeMatching.capturedSumCents).toBe(0);
  });

  it('omits the stripeAccount option for platform-account locations', async () => {
    mockPrisma.shift.findUnique = vi.fn().mockResolvedValue({
      id: 'shift-3',
      tenantId: 'tenant-1',
      locationId: 'loc-platform',
      cashierId: 'user-1',
      openedAt: new Date(),
      closedAt: new Date(),
      openingFloatCents: 0,
      closingCashCents: 0,
      declaredCheckCents: 0,
      declaredOtherCents: 0,
      paidOutsCents: 0,
      transactions: [
        {
          id: 'tx-plat',
          tenantId: 'tenant-1',
          status: 'CARD',
          cardRail: 'CNP',
          totalCents: 1500,
          subtotalCents: 1500,
          taxCents: 0,
          tipCents: 0,
          stripePaymentIntentId: 'pi_platform',
          stripeAccountId: null,
          createdAt: new Date(),
          lineItems: [],
        },
      ],
    });
    mockPrisma.user.findUnique = vi.fn().mockResolvedValue(null);
    mockPrisma.location.findFirst = vi
      .fn()
      .mockResolvedValue({ stripeAccountId: null });

    stripeMockRef.paymentIntents.retrieve = vi
      .fn()
      .mockResolvedValue({ id: 'pi_platform', status: 'succeeded', amount_received: 1500 });

    const snap = await computeZOut('shift-3', null);

    expect(stripeMockRef.paymentIntents.retrieve).toHaveBeenCalledTimes(1);
    const call = stripeMockRef.paymentIntents.retrieve.mock.calls[0];
    expect(call[0]).toBe('pi_platform');
    // No options arg → routes to the platform account, like before.
    expect(call.length).toBe(1);
    expect(snap.stripeMatching.capturedCount).toBe(1);
    expect(snap.stripeMatching.capturedSumCents).toBe(1500);
  });
});
