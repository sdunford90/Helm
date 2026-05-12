import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockPrisma } from '../setup.js';

// The global setup mocks `gl-posting` — we don't need the real impl here
// (postShiftZOut throws our new UNBALANCED_TENDERS error before reaching
// any GL helpers), so the default mock is fine. We DO need the real
// pos-zout module under test.
vi.mock('../../src/services/pos-zout.js', async (importOriginal) => {
  return await importOriginal();
});

let computeZOut: typeof import('../../src/services/pos-zout.js').computeZOut;
let postShiftZOut: typeof import('../../src/services/pos-zout.js').postShiftZOut;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('../../src/services/pos-zout.js');
  computeZOut = mod.computeZOut;
  postShiftZOut = mod.postShiftZOut;

  (mockPrisma as any).user.findUnique = vi.fn().mockResolvedValue({
    firstName: 'Cash',
    lastName: 'Ier',
    email: 'cashier@test.com',
  });
});

// Minimal POS transaction shape needed by computeZOut. `grossSalesCents`
// is summed from line items (unitPriceCents * quantity), so each helper
// builds a single line item that mirrors `subtotalCents` — that keeps
// the headline math (totalCents = netSales + tax + tips) consistent
// with `subtotalCents` so tests can reason about expected vs actual.
function txn(overrides: Partial<any> & { id?: string; status?: string; totalCents?: number }): any {
  const totalCents = overrides.totalCents ?? 0;
  return {
    id: 'txn-x',
    status: 'CASH',
    cardRail: null,
    totalCents,
    subtotalCents: totalCents,
    taxCents: 0,
    tipCents: 0,
    stripePaymentIntentId: null,
    voidedAt: null,
    customerId: null,
    invoiceId: null,
    paymentMethodId: null,
    createdAt: new Date('2026-05-11T10:00:00Z'),
    lineItems: [
      {
        id: `${overrides.id ?? 'txn-x'}-li-1`,
        unitPriceCents: Math.abs(totalCents),
        quantity: totalCents < 0 ? -1 : 1,
        discountCents: 0,
        taxCents: 0,
        product: null,
      },
    ],
    ...overrides,
  };
}

function shiftWith(transactions: any[]) {
  return {
    id: 'shift-1',
    locationId: 'loc-1',
    cashierId: 'user-1',
    openedAt: new Date('2026-05-11T08:00:00Z'),
    closedAt: null,
    openingFloatCents: 0,
    closingFloatCents: null,
    declaredCashCents: 0,
    declaredCheckCents: 0,
    declaredOtherCents: 0,
    notes: null,
    transactions,
  };
}

describe('computeZOut tenderReconciliation', () => {
  it('balances when every sale has a known tender', async () => {
    (mockPrisma as any).shift.findUnique = vi.fn().mockResolvedValue(
      shiftWith([
        txn({
          id: 'txn-cash',
          status: 'CASH',
          totalCents: 5000,
          subtotalCents: 5000,
        }),
        txn({
          id: 'txn-card',
          status: 'CARD',
          cardRail: 'TERMINAL',
          totalCents: 3000,
          subtotalCents: 3000,
          stripePaymentIntentId: 'pi_ok',
        }),
      ]),
    );

    const snap = await computeZOut('shift-1', null);

    expect(snap.tenderReconciliation.expectedCents).toBe(8000);
    expect(snap.tenderReconciliation.actualCents).toBe(8000);
    expect(snap.tenderReconciliation.diffCents).toBe(0);
    expect(snap.tenderReconciliation.missingTenderRowIds).toEqual([]);
  });

  it('flags rows whose status is not a known tender bucket', async () => {
    // Legacy "REFUNDED" positive (Task #320 migration could not safely
    // revert) — total counts toward revenue but no tender bucket picks
    // it up, which is exactly the gap that broke postEntries before.
    (mockPrisma as any).shift.findUnique = vi.fn().mockResolvedValue(
      shiftWith([
        txn({
          id: 'txn-cash',
          status: 'CASH',
          totalCents: 5000,
          subtotalCents: 5000,
        }),
        txn({
          id: 'txn-orphan',
          status: 'REFUNDED',
          totalCents: 1500,
          subtotalCents: 1500,
        }),
      ]),
    );

    const snap = await computeZOut('shift-1', null);

    expect(snap.tenderReconciliation.expectedCents).toBe(6500);
    expect(snap.tenderReconciliation.actualCents).toBe(5000);
    expect(snap.tenderReconciliation.diffCents).toBe(1500);
    expect(snap.tenderReconciliation.missingTenderRowIds).toEqual(['txn-orphan']);
  });
});

describe('postShiftZOut UNBALANCED_TENDERS guard', () => {
  it('throws a 422 with offending row IDs before posting any GL entries', async () => {
    const snapshot: any = {
      shiftId: 'shift-1',
      locationId: 'loc-1',
      cashierId: 'user-1',
      cashierName: 'Cash Ier',
      openedAt: new Date().toISOString(),
      closedAt: null,
      grossSalesCents: 6500,
      discountsCents: 0,
      refundsCents: 0,
      netSalesCents: 6500,
      taxCents: 0,
      tipsCents: 0,
      totalCents: 6500,
      tenders: {
        cash: { salesCents: 5000, refundsCents: 0, netCents: 5000 },
        cardTerminal: { salesCents: 0, refundsCents: 0, netCents: 0, count: 0 },
        cardCnp: { salesCents: 0, refundsCents: 0, netCents: 0, count: 0 },
        ach: { salesCents: 0, refundsCents: 0, netCents: 0 },
        check: { declaredCents: 0 },
        chargeToAr: { salesCents: 0, refundsCents: 0, netCents: 0, count: 0 },
        other: { declaredCents: 0 },
      },
      stripeMatching: {
        expectedCardCents: 0,
        matchedCount: 0,
        capturedSumCents: 0,
        capturedCount: 0,
        unmatchedRowIds: [],
        uncapturedRowIds: [],
        unverifiedRowIds: [],
        verifiedAgainstStripe: true,
      },
      tenderReconciliation: {
        expectedCents: 6500,
        actualCents: 5000,
        diffCents: 1500,
        missingTenderRowIds: ['txn-orphan'],
        extraTenderRowIds: [],
      },
      cashDrawer: {
        openingFloatCents: 0,
        cashSalesCents: 5000,
        cashRefundsCents: 0,
        declaredCashCents: 0,
        expectedDrawerCents: 5000,
        overShortCents: -5000,
      },
      salesByCategory: [],
      topProducts: [],
      discountsApplied: [],
      refundsList: [],
    };

    let err: any;
    try {
      await postShiftZOut('tenant-1', 'shift-1', snapshot, mockPrisma as any);
    } catch (e) {
      err = e;
    }

    expect(err).toBeDefined();
    expect(err.code).toBe('UNBALANCED_TENDERS');
    expect(err.statusCode).toBe(422);
    expect(err.message).toMatch(/UNBALANCED_TENDERS/);
    expect(err.message).toMatch(/\$65\.00/); // expected
    expect(err.message).toMatch(/\$50\.00/); // actual
    expect(err.message).toMatch(/\$15\.00/); // gap
    expect(err.message).toMatch(/txn-orphan/);

    // Crucially, no journal/GL writes were attempted before the throw.
    expect(mockPrisma.glEntry.createMany).not.toHaveBeenCalled();
  });

  it('passes the guard for a balanced snapshot and proceeds to GL posting', async () => {
    // Same fixture as the unbalanced case but with diffCents=0 — the
    // pre-posting guard must not throw UNBALANCED_TENDERS, so execution
    // continues into the real GL-resolution path. We don't fully mock
    // the rest of postShiftZOut (that's covered by integration tests of
    // the commit route) — we only assert the guard didn't fire.
    const snapshot: any = {
      shiftId: 'shift-1',
      locationId: 'loc-1',
      cashierId: 'user-1',
      cashierName: 'Cash Ier',
      openedAt: new Date().toISOString(),
      closedAt: null,
      grossSalesCents: 5000,
      discountsCents: 0,
      refundsCents: 0,
      netSalesCents: 5000,
      taxCents: 0,
      tipsCents: 0,
      totalCents: 5000,
      tenders: {
        cash: { salesCents: 5000, refundsCents: 0, netCents: 5000 },
        cardTerminal: { salesCents: 0, refundsCents: 0, netCents: 0, count: 0 },
        cardCnp: { salesCents: 0, refundsCents: 0, netCents: 0, count: 0 },
        ach: { salesCents: 0, refundsCents: 0, netCents: 0 },
        check: { declaredCents: 0 },
        chargeToAr: { salesCents: 0, refundsCents: 0, netCents: 0, count: 0 },
        other: { declaredCents: 0 },
      },
      stripeMatching: {
        expectedCardCents: 0,
        matchedCount: 0,
        capturedSumCents: 0,
        capturedCount: 0,
        unmatchedRowIds: [],
        uncapturedRowIds: [],
        unverifiedRowIds: [],
        verifiedAgainstStripe: true,
      },
      tenderReconciliation: {
        expectedCents: 5000,
        actualCents: 5000,
        diffCents: 0,
        missingTenderRowIds: [],
        extraTenderRowIds: [],
      },
      cashDrawer: {
        openingFloatCents: 0,
        cashSalesCents: 5000,
        cashRefundsCents: 0,
        declaredCashCents: 0,
        expectedDrawerCents: 5000,
        overShortCents: -5000,
      },
      salesByCategory: [],
      topProducts: [],
      discountsApplied: [],
      refundsList: [],
    };

    let err: any;
    try {
      await postShiftZOut('tenant-1', 'shift-1', snapshot, mockPrisma as any);
    } catch (e) {
      err = e;
    }

    // Whatever happens after the guard (missing GL mappings, etc) is
    // fine — we only assert the guard itself didn't trip.
    expect(err?.code).not.toBe('UNBALANCED_TENDERS');
  });
});
