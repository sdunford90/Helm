import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockPrisma } from '../setup.js';

// End-to-end test for the QuickBooks chart-of-accounts pull → mapping →
// invoice posting pipeline. Two locations whose QBO charts share the
// same account *numbers* must never cross-post into each other's
// GlAccount rows. Walks: connect → pull → map → resolve → postInvoice
// for two locations and asserts each invoice's GlEntries reference only
// its own location's accounts.

// Override the global gl-posting mock so we exercise the real implementation.
vi.mock('../../src/services/gl-posting.js', async (importOriginal) => {
  return await importOriginal();
});

const fetchMock = vi.fn();
(globalThis as any).fetch = fetchMock;

let pullChartOfAccountsForLocation: typeof import('../../src/services/qbo-sync.js').pullChartOfAccountsForLocation;
let resolveProductGlAccounts: typeof import('../../src/services/gl-account-resolver.js').resolveProductGlAccounts;
let postInvoice: typeof import('../../src/services/gl-posting.js').postInvoice;
let postPayment: typeof import('../../src/services/gl-posting.js').postPayment;
let postRefund: typeof import('../../src/services/gl-posting.js').postRefund;
let postEarlyTermination: typeof import('../../src/services/gl-posting.js').postEarlyTermination;

// In-memory store backing the prisma mocks: enough Prisma fidelity
// (notIn/not predicates, P2002 unique-conflict simulation, stateful
// GlAccount/GlEntry/ProductGlMapping rows) to exercise the real services.

interface GlAccountRow {
  id: string;
  tenantId: string;
  locationId: string | null;
  accountNumber: string;
  name: string;
  type: string;
  subType: string | null;
  qboAccountId: string | null;
  source: string;
  isActive: boolean;
  active: boolean;
  isDeferredRevenue: boolean;
}

interface LocationRow {
  id: string;
  tenantId: string;
  name: string;
  qboAccessToken: string | null;
  qboRefreshToken: string | null;
  qboRealmId: string | null;
  qboTokenExpiresAt: Date | null;
  qboLastChartOfAccountsSyncAt: Date | null;
  // Per-location SYSTEM posting account pins (Task #222). Optional so the
  // existing tests don't need updating; the location.findUnique stub just
  // returns the whole row and the resolver tolerates undefined as "no pin".
  defaultRevenueGlAccountId?: string | null;
  salesTaxGlAccountId?: string | null;
  earlyTerminationGlAccountId?: string | null;
  achReturnFeeGlAccountId?: string | null;
}

interface ProductGlMappingRow {
  id: string;
  tenantId: string;
  productId: string;
  locationId: string;
  revenueGlAccountId: string | null;
  cogsGlAccountId: string | null;
  inventoryAssetGlAccountId: string | null;
}

interface GlEntryRow {
  id: string;
  tenantId: string;
  journalId: string | null;
  accountId: string;
  debitCents: number;
  creditCents: number;
  description: string | null;
  postedAt: Date;
  sourceType: string | null;
  sourceId: string | null;
}

interface ProductRow {
  id: string;
  tenantId: string;
  productCategoryId: string | null;
  revenueGlAccountId: string | null;
  cogsGlAccountId: string | null;
  inventoryAssetGlAccountId: string | null;
}

const glAccounts = new Map<string, GlAccountRow>();
const locations = new Map<string, LocationRow>();
const productGlMappings: ProductGlMappingRow[] = [];
const glEntries: GlEntryRow[] = [];
const products = new Map<string, ProductRow>();

let idCounter = 0;
const nextId = (prefix: string) => `${prefix}-${++idCounter}`;

// Minimal where-matcher covering the predicate shapes used by the
// services under test.
function matchRow(row: any, where: any): boolean {
  if (!where) return true;
  for (const [k, v] of Object.entries(where)) {
    if (v === undefined) continue;
    const fieldVal = row[k];
    if (v === null) {
      if (fieldVal !== null && fieldVal !== undefined) return false;
      continue;
    }
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('not' in v) {
        const target = (v as any).not;
        if (target === null) {
          if (fieldVal === null || fieldVal === undefined) return false;
        } else if (fieldVal === target) {
          return false;
        }
      }
      if ('in' in v) {
        if (!(v as any).in.includes(fieldVal)) return false;
      }
      if ('notIn' in v) {
        if ((v as any).notIn.includes(fieldVal)) return false;
      }
    } else if (fieldVal !== v) {
      return false;
    }
  }
  return true;
}

function installPrismaStubs(): void {
  // ---- glAccount ----
  (mockPrisma as any).glAccount = {
    findFirst: vi.fn(async ({ where }: any) => {
      for (const row of glAccounts.values()) {
        if (matchRow(row, where)) return row;
      }
      return null;
    }),
    findMany: vi.fn(async ({ where }: any = {}) => {
      const rows: GlAccountRow[] = [];
      for (const row of glAccounts.values()) {
        if (matchRow(row, where)) rows.push(row);
      }
      return rows;
    }),
    create: vi.fn(async ({ data }: any) => {
      // Enforce the unique (tenantId, locationId, accountNumber) constraint
      // so the pull's MANUAL → QBO rebind recovery path actually fires.
      for (const row of glAccounts.values()) {
        if (
          row.tenantId === data.tenantId &&
          (row.locationId ?? null) === (data.locationId ?? null) &&
          row.accountNumber === data.accountNumber
        ) {
          const err: any = new Error('Unique constraint failed');
          err.code = 'P2002';
          throw err;
        }
      }
      const id = data.id ?? nextId('gl');
      const row: GlAccountRow = {
        id,
        tenantId: data.tenantId,
        locationId: data.locationId ?? null,
        accountNumber: data.accountNumber,
        name: data.name,
        type: data.type,
        subType: data.subType ?? null,
        qboAccountId: data.qboAccountId ?? null,
        source: data.source ?? 'MANUAL',
        isActive: data.isActive ?? true,
        active: data.active ?? true,
        isDeferredRevenue: data.isDeferredRevenue ?? false,
      };
      glAccounts.set(id, row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const row = glAccounts.get(where.id);
      if (!row) {
        const err: any = new Error('Record to update not found');
        err.code = 'P2025';
        throw err;
      }
      Object.assign(row, data);
      return row;
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      let count = 0;
      for (const row of glAccounts.values()) {
        if (where.id?.in && !where.id.in.includes(row.id)) continue;
        if (where.id?.in === undefined && !matchRow(row, where)) continue;
        Object.assign(row, data);
        count++;
      }
      return { count };
    }),
    count: vi.fn(async ({ where }: any = {}) => {
      let count = 0;
      for (const row of glAccounts.values()) {
        if (matchRow(row, where)) count++;
      }
      return count;
    }),
  };

  // ---- location ----
  (mockPrisma as any).location = {
    findFirst: vi.fn(async ({ where }: any) => {
      for (const row of locations.values()) {
        if (matchRow(row, where)) return row;
      }
      return null;
    }),
    findUnique: vi.fn(async ({ where }: any) => {
      return locations.get(where.id) ?? null;
    }),
    findMany: vi.fn(async ({ where }: any = {}) => {
      const out: LocationRow[] = [];
      for (const row of locations.values()) {
        if (matchRow(row, where)) out.push(row);
      }
      return out;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const row = locations.get(where.id);
      if (!row) throw new Error(`Location ${where.id} not found`);
      Object.assign(row, data);
      return row;
    }),
    create: vi.fn(),
    count: vi.fn().mockResolvedValue(locations.size),
  };

  // ---- productGlMapping ----
  (mockPrisma as any).productGlMapping = {
    findFirst: vi.fn(async ({ where }: any) => {
      return productGlMappings.find((m) => matchRow(m, where)) ?? null;
    }),
    findMany: vi.fn(async ({ where }: any = {}) => {
      return productGlMappings.filter((m) => matchRow(m, where));
    }),
    create: vi.fn(async ({ data }: any) => {
      const row: ProductGlMappingRow = {
        id: data.id ?? nextId('pgm'),
        tenantId: data.tenantId,
        productId: data.productId,
        locationId: data.locationId,
        revenueGlAccountId: data.revenueGlAccountId ?? null,
        cogsGlAccountId: data.cogsGlAccountId ?? null,
        inventoryAssetGlAccountId: data.inventoryAssetGlAccountId ?? null,
      };
      productGlMappings.push(row);
      return row;
    }),
  };
  (mockPrisma as any).productCategoryGlMapping = {
    findFirst: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
  };

  // ---- product ----
  (mockPrisma as any).product = {
    findFirst: vi.fn(async ({ where }: any) => {
      for (const row of products.values()) {
        if (matchRow(row, where)) {
          // The resolver requests `productCategory` as a relation include.
          return { ...row, productCategory: null };
        }
      }
      return null;
    }),
    findMany: vi.fn().mockResolvedValue([]),
  };

  // ---- glEntry ----
  (mockPrisma as any).glEntry = {
    findMany: vi.fn(async ({ where }: any = {}) => {
      return glEntries.filter((e) => matchRow(e, where));
    }),
    createMany: vi.fn(async ({ data }: any) => {
      const rows = Array.isArray(data) ? data : [data];
      for (const r of rows) {
        glEntries.push({
          id: r.id ?? nextId('gle'),
          tenantId: r.tenantId,
          journalId: r.journalId ?? null,
          accountId: r.accountId,
          debitCents: r.debitCents ?? 0,
          creditCents: r.creditCents ?? 0,
          description: r.description ?? null,
          postedAt: r.postedAt ?? new Date(),
          sourceType: r.sourceType ?? null,
          sourceId: r.sourceId ?? null,
        });
      }
      return { count: rows.length };
    }),
    groupBy: vi.fn().mockResolvedValue([]),
    aggregate: vi.fn().mockResolvedValue({ _sum: { debitCents: 0, creditCents: 0 } }),
  };

  (mockPrisma as any).auditLog.create = vi.fn().mockResolvedValue({});
}

// QBO API responses keyed by realmId — the same fetch mock serves both
// locations because qbo-sync URLs encode realmId in the path.
const accountsByRealm: Record<string, Array<{ Id: string; Name: string; AcctNum: string; AccountType: string; AccountSubType?: string; Active?: boolean }>> = {};

function installFetchRouter(): void {
  fetchMock.mockImplementation(async (url: string) => {
    const match = /\/company\/([^/]+)\//.exec(url);
    const realmId = match?.[1] ?? '';
    const accounts = accountsByRealm[realmId] ?? [];
    const body = JSON.stringify({ QueryResponse: { Account: accounts } });
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      text: async () => body,
      json: async () => JSON.parse(body),
    } as any;
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  glAccounts.clear();
  locations.clear();
  productGlMappings.length = 0;
  glEntries.length = 0;
  products.clear();
  idCounter = 0;
  for (const k of Object.keys(accountsByRealm)) delete accountsByRealm[k];

  installPrismaStubs();
  installFetchRouter();

  // QBO OAuth env required by qbo-sync's getConfig() — refresh paths are
  // never hit in this test (token is fresh) but the module reads them at
  // call time, so we set them defensively.
  process.env.QBO_CLIENT_ID = 'test-client';
  process.env.QBO_CLIENT_SECRET = 'test-secret';
  process.env.QBO_REDIRECT_URI = 'https://test.example/qbo/cb';
  process.env.QBO_ENVIRONMENT = 'sandbox';

  const qbo = await import('../../src/services/qbo-sync.js');
  pullChartOfAccountsForLocation = qbo.pullChartOfAccountsForLocation;
  const resolver = await import('../../src/services/gl-account-resolver.js');
  resolveProductGlAccounts = resolver.resolveProductGlAccounts;
  const posting = await import('../../src/services/gl-posting.js');
  postInvoice = posting.postInvoice;
  postPayment = posting.postPayment;
  postRefund = posting.postRefund;
  postEarlyTermination = posting.postEarlyTermination;
});

describe('end-to-end: QBO pull → per-location mapping → invoice posting keeps locations isolated', () => {
  it('two locations with overlapping account numbers each post to their own GlAccount rows', async () => {
    const tenantId = 'tenant-multi';

    // 1. Connect two locations to two distinct QBO realms.  We seed the
    //    location row in the same shape handleCallbackForLocation would
    //    leave it after a successful OAuth exchange (token fresh for an
    //    hour, so getValidAccessTokenForLocation skips refresh entirely).
    const inAnHour = new Date(Date.now() + 60 * 60 * 1000);
    const locA: LocationRow = {
      id: 'loc-marina-a',
      tenantId,
      name: 'Marina A',
      qboAccessToken: 'access-A',
      qboRefreshToken: 'refresh-A',
      qboRealmId: 'realm-A',
      qboTokenExpiresAt: inAnHour,
      qboLastChartOfAccountsSyncAt: null,
    };
    const locB: LocationRow = {
      id: 'loc-marina-b',
      tenantId,
      name: 'Marina B',
      qboAccessToken: 'access-B',
      qboRefreshToken: 'refresh-B',
      qboRealmId: 'realm-B',
      qboTokenExpiresAt: inAnHour,
      qboLastChartOfAccountsSyncAt: null,
    };
    locations.set(locA.id, locA);
    locations.set(locB.id, locB);

    // 2. Each realm exposes a chart of accounts.  Critically, the *account
    //    numbers* overlap (1200 A/R, 4000 Slip Revenue) but the QBO Ids
    //    and names differ — this is the production case that has bitten
    //    us: a tenant-wide A/R lookup by number "1200" would silently
    //    pick whichever location happened to win the row insertion race.
    accountsByRealm['realm-A'] = [
      { Id: '1', Name: 'A/R — Marina A', AcctNum: '1200', AccountType: 'Accounts Receivable', Active: true },
      { Id: '2', Name: 'Slip Revenue — Marina A', AcctNum: '4000', AccountType: 'Income', AccountSubType: 'ServiceFeeIncome', Active: true },
      { Id: '3', Name: 'General Revenue — Marina A', AcctNum: '4500', AccountType: 'Income', Active: true },
    ];
    accountsByRealm['realm-B'] = [
      { Id: '11', Name: 'A/R — Marina B', AcctNum: '1200', AccountType: 'Accounts Receivable', Active: true },
      { Id: '12', Name: 'Slip Revenue — Marina B', AcctNum: '4000', AccountType: 'Income', AccountSubType: 'ServiceFeeIncome', Active: true },
      { Id: '13', Name: 'General Revenue — Marina B', AcctNum: '4500', AccountType: 'Income', Active: true },
    ];

    // 3. Pull both locations' charts of accounts.  Each pull should
    //    create three rows scoped to its own location.
    const pullA = await pullChartOfAccountsForLocation(locA.id, tenantId);
    const pullB = await pullChartOfAccountsForLocation(locB.id, tenantId);

    expect(pullA).toMatchObject({ pulled: 3, created: 3, updated: 0, deactivated: 0 });
    expect(pullB).toMatchObject({ pulled: 3, created: 3, updated: 0, deactivated: 0 });
    expect(glAccounts.size).toBe(6);

    // 3a. Helper to look up the local GlAccount by (locationId, accountNumber).
    const accountFor = (locationId: string, acctNum: string) => {
      const found = [...glAccounts.values()].find(
        (a) => a.locationId === locationId && a.accountNumber === acctNum,
      );
      if (!found) throw new Error(`No account ${acctNum} for ${locationId}`);
      return found;
    };

    const arA = accountFor(locA.id, '1200');
    const arB = accountFor(locB.id, '1200');
    const revA = accountFor(locA.id, '4000');
    const revB = accountFor(locB.id, '4000');

    // The two A/Rs share an account number but must be distinct rows
    // bound to different QBO realms — this is the cross-tenant safety
    // the per-location pull is supposed to guarantee.
    expect(arA.id).not.toBe(arB.id);
    expect(arA.qboAccountId).toBe('1');
    expect(arB.qboAccountId).toBe('11');
    expect(revA.id).not.toBe(revB.id);
    expect(revA.qboAccountId).toBe('2');
    expect(revB.qboAccountId).toBe('12');
    expect(revA.name).toContain('Marina A');
    expect(revB.name).toContain('Marina B');

    // 4. Define one tenant-wide product and pin a per-location revenue
    //    mapping for each location so the resolver picks each location's
    //    own "4000 Slip Revenue" row.  This is the operator workflow
    //    after the chart pull: open the catalog, set GL account per
    //    location.
    const productId = 'product-slip-rental';
    products.set(productId, {
      id: productId,
      tenantId,
      productCategoryId: null,
      revenueGlAccountId: null,
      cogsGlAccountId: null,
      inventoryAssetGlAccountId: null,
    });
    productGlMappings.push(
      {
        id: nextId('pgm'),
        tenantId,
        productId,
        locationId: locA.id,
        revenueGlAccountId: revA.id,
        cogsGlAccountId: null,
        inventoryAssetGlAccountId: null,
      },
      {
        id: nextId('pgm'),
        tenantId,
        productId,
        locationId: locB.id,
        revenueGlAccountId: revB.id,
        cogsGlAccountId: null,
        inventoryAssetGlAccountId: null,
      },
    );

    // 5. The resolver must return each location's own revenue row.
    const resolvedA = await resolveProductGlAccounts(tenantId, productId, locA.id);
    const resolvedB = await resolveProductGlAccounts(tenantId, productId, locB.id);
    expect(resolvedA.revenueGlAccountId).toBe(revA.id);
    expect(resolvedA.source).toBe('product_override');
    expect(resolvedB.revenueGlAccountId).toBe(revB.id);
    expect(resolvedB.source).toBe('product_override');
    // Sanity: the resolver should NOT cross-pollinate.
    expect(resolvedA.revenueGlAccountId).not.toBe(revB.id);
    expect(resolvedB.revenueGlAccountId).not.toBe(revA.id);

    // 6. Post one invoice per location, feeding the resolved per-location
    //    revenue account into the line item.  postInvoice will also look
    //    up the location's A/R account by number "1200" and must scope
    //    that lookup to the originating location.
    const invoiceA = {
      id: 'inv-A',
      tenantId,
      locationId: locA.id,
      totalCents: 50000,
      lineItems: [
        {
          id: 'li-A',
          extendedCents: 50000,
          taxCents: 0,
          glAccountId: resolvedA.revenueGlAccountId,
          isDeferred: false,
        },
      ],
    };
    const invoiceB = {
      id: 'inv-B',
      tenantId,
      locationId: locB.id,
      totalCents: 75000,
      lineItems: [
        {
          id: 'li-B',
          extendedCents: 75000,
          taxCents: 0,
          glAccountId: resolvedB.revenueGlAccountId,
          isDeferred: false,
        },
      ],
    };

    await postInvoice(invoiceA);
    await postInvoice(invoiceB);

    // 7. Assertions: each invoice's GL entries reference exactly its own
    //    location's accounts — never the other location's.
    const entriesA = glEntries.filter((e) => e.sourceId === 'inv-A');
    const entriesB = glEntries.filter((e) => e.sourceId === 'inv-B');

    expect(entriesA).toHaveLength(2);
    expect(entriesB).toHaveLength(2);

    const accountIdsA = new Set(entriesA.map((e) => e.accountId));
    const accountIdsB = new Set(entriesB.map((e) => e.accountId));

    // Marina A's invoice posts to Marina A's A/R + Marina A's revenue.
    expect(accountIdsA).toEqual(new Set([arA.id, revA.id]));
    // Marina B's invoice posts to Marina B's A/R + Marina B's revenue.
    expect(accountIdsB).toEqual(new Set([arB.id, revB.id]));

    // Cross-pollination check: neither invoice touched the other
    // location's accounts.
    expect(accountIdsA.has(arB.id)).toBe(false);
    expect(accountIdsA.has(revB.id)).toBe(false);
    expect(accountIdsB.has(arA.id)).toBe(false);
    expect(accountIdsB.has(revA.id)).toBe(false);

    // Double-entry sanity: each invoice balances debits == credits and
    // the totals match the invoice amount.
    const sum = (entries: GlEntryRow[], field: 'debitCents' | 'creditCents') =>
      entries.reduce((s, e) => s + e[field], 0);
    expect(sum(entriesA, 'debitCents')).toBe(50000);
    expect(sum(entriesA, 'creditCents')).toBe(50000);
    expect(sum(entriesB, 'debitCents')).toBe(75000);
    expect(sum(entriesB, 'creditCents')).toBe(75000);

    // The A/R debit sits on each location's own A/R row.
    const arDebitA = entriesA.find((e) => e.debitCents > 0);
    const arDebitB = entriesB.find((e) => e.debitCents > 0);
    expect(arDebitA?.accountId).toBe(arA.id);
    expect(arDebitB?.accountId).toBe(arB.id);

    // And the revenue credit lands on each location's own revenue row.
    const revCreditA = entriesA.find((e) => e.creditCents > 0);
    const revCreditB = entriesB.find((e) => e.creditCents > 0);
    expect(revCreditA?.accountId).toBe(revA.id);
    expect(revCreditB?.accountId).toBe(revB.id);
  });

  it('a second pull is idempotent — overlapping account numbers do not duplicate or cross-rebind rows', async () => {
    // Regression guard for the unique-conflict recovery path: if the same
    // QBO chart is pulled twice, the second pass should update existing
    // rows in place (matched by qboAccountId), never create duplicates and
    // never accidentally re-bind one location's row to another location's
    // QBO account.
    const tenantId = 'tenant-idempotent';
    const inAnHour = new Date(Date.now() + 60 * 60 * 1000);
    const locA: LocationRow = {
      id: 'loc-idem-a',
      tenantId,
      name: 'Idem A',
      qboAccessToken: 'a',
      qboRefreshToken: 'a',
      qboRealmId: 'realm-A',
      qboTokenExpiresAt: inAnHour,
      qboLastChartOfAccountsSyncAt: null,
    };
    const locB: LocationRow = {
      id: 'loc-idem-b',
      tenantId,
      name: 'Idem B',
      qboAccessToken: 'b',
      qboRefreshToken: 'b',
      qboRealmId: 'realm-B',
      qboTokenExpiresAt: inAnHour,
      qboLastChartOfAccountsSyncAt: null,
    };
    locations.set(locA.id, locA);
    locations.set(locB.id, locB);

    accountsByRealm['realm-A'] = [
      { Id: '101', Name: 'Slip Revenue A', AcctNum: '4000', AccountType: 'Income', Active: true },
    ];
    accountsByRealm['realm-B'] = [
      { Id: '201', Name: 'Slip Revenue B', AcctNum: '4000', AccountType: 'Income', Active: true },
    ];

    await pullChartOfAccountsForLocation(locA.id, tenantId);
    await pullChartOfAccountsForLocation(locB.id, tenantId);
    expect(glAccounts.size).toBe(2);

    // Second pull with the same payload should be a pure update — no new
    // rows, and definitely no row whose locationId got swapped.
    const second = await pullChartOfAccountsForLocation(locA.id, tenantId);
    expect(second).toMatchObject({ pulled: 1, created: 0, updated: 1, deactivated: 0 });
    expect(glAccounts.size).toBe(2);

    const aRows = [...glAccounts.values()].filter((a) => a.locationId === locA.id);
    const bRows = [...glAccounts.values()].filter((a) => a.locationId === locB.id);
    expect(aRows).toHaveLength(1);
    expect(bRows).toHaveLength(1);
    expect(aRows[0].qboAccountId).toBe('101');
    expect(bRows[0].qboAccountId).toBe('201');
  });

  it('payment + refund posting hits each location\'s own A/R and bank rows under a per-location chart of accounts', async () => {
    // Regression guard for the cross-location GL bleed in postPayment /
    // postRefund.  Same shape as the invoice-posting test above: two
    // QBO-connected locations whose pulled charts share account numbers
    // (1200 A/R, 1010 Bank) but resolve to *different* GlAccount rows.
    // Without locationId-scoped lookups, postPayment/postRefund would
    // pick whichever row Prisma returned first and silently mis-route
    // both locations' cash + receivables.
    const tenantId = 'tenant-pay-refund';
    const inAnHour = new Date(Date.now() + 60 * 60 * 1000);
    const locA: LocationRow = {
      id: 'loc-pay-a',
      tenantId,
      name: 'Pay Marina A',
      qboAccessToken: 'access-A',
      qboRefreshToken: 'refresh-A',
      qboRealmId: 'realm-A',
      qboTokenExpiresAt: inAnHour,
      qboLastChartOfAccountsSyncAt: null,
    };
    const locB: LocationRow = {
      id: 'loc-pay-b',
      tenantId,
      name: 'Pay Marina B',
      qboAccessToken: 'access-B',
      qboRefreshToken: 'refresh-B',
      qboRealmId: 'realm-B',
      qboTokenExpiresAt: inAnHour,
      qboLastChartOfAccountsSyncAt: null,
    };
    locations.set(locA.id, locA);
    locations.set(locB.id, locB);

    // Each realm exposes the A/R + Bank pair postPayment/postRefund will
    // look up.  Account numbers overlap; QBO Ids and names diverge.
    accountsByRealm['realm-A'] = [
      { Id: '1', Name: 'A/R — Marina A', AcctNum: '1200', AccountType: 'Accounts Receivable', Active: true },
      { Id: '2', Name: 'Operating Bank — Marina A', AcctNum: '1010', AccountType: 'Bank', Active: true },
    ];
    accountsByRealm['realm-B'] = [
      { Id: '11', Name: 'A/R — Marina B', AcctNum: '1200', AccountType: 'Accounts Receivable', Active: true },
      { Id: '12', Name: 'Operating Bank — Marina B', AcctNum: '1010', AccountType: 'Bank', Active: true },
    ];

    await pullChartOfAccountsForLocation(locA.id, tenantId);
    await pullChartOfAccountsForLocation(locB.id, tenantId);
    expect(glAccounts.size).toBe(4);

    const accountFor = (locationId: string, acctNum: string) => {
      const found = [...glAccounts.values()].find(
        (a) => a.locationId === locationId && a.accountNumber === acctNum,
      );
      if (!found) throw new Error(`No account ${acctNum} for ${locationId}`);
      return found;
    };

    const arA = accountFor(locA.id, '1200');
    const arB = accountFor(locB.id, '1200');
    const bankA = accountFor(locA.id, '1010');
    const bankB = accountFor(locB.id, '1010');

    expect(arA.id).not.toBe(arB.id);
    expect(bankA.id).not.toBe(bankB.id);

    // Post one CARD payment per location.  In production the route layer
    // pulls payment.invoice.locationId off the Payment row and threads it
    // through; here we hand it directly to postPayment.
    await postPayment({
      id: 'pay-A',
      tenantId,
      amountCents: 50000,
      method: 'CARD',
      locationId: locA.id,
    });
    await postPayment({
      id: 'pay-B',
      tenantId,
      amountCents: 75000,
      method: 'CARD',
      locationId: locB.id,
    });

    const payEntriesA = glEntries.filter((e) => e.sourceId === 'pay-A');
    const payEntriesB = glEntries.filter((e) => e.sourceId === 'pay-B');
    expect(payEntriesA).toHaveLength(2);
    expect(payEntriesB).toHaveLength(2);

    // Marina A's payment debits Marina A's bank and credits Marina A's
    // A/R — never Marina B's rows, even though account numbers match.
    const payDebitA = payEntriesA.find((e) => e.debitCents > 0);
    const payCreditA = payEntriesA.find((e) => e.creditCents > 0);
    expect(payDebitA?.accountId).toBe(bankA.id);
    expect(payCreditA?.accountId).toBe(arA.id);

    const payDebitB = payEntriesB.find((e) => e.debitCents > 0);
    const payCreditB = payEntriesB.find((e) => e.creditCents > 0);
    expect(payDebitB?.accountId).toBe(bankB.id);
    expect(payCreditB?.accountId).toBe(arB.id);

    // Cross-pollination guard.
    const payAccountsA = new Set(payEntriesA.map((e) => e.accountId));
    const payAccountsB = new Set(payEntriesB.map((e) => e.accountId));
    expect(payAccountsA.has(bankB.id)).toBe(false);
    expect(payAccountsA.has(arB.id)).toBe(false);
    expect(payAccountsB.has(bankA.id)).toBe(false);
    expect(payAccountsB.has(arA.id)).toBe(false);

    // Now refund a portion of each payment.  postRefund must reverse
    // each location's own A/R + bank pair so the books stay balanced
    // per location instead of moving cash between marinas.
    await postRefund(
      {
        id: 'pay-A',
        tenantId,
        amountCents: 50000,
        method: 'CARD',
        locationId: locA.id,
      },
      20000,
    );
    await postRefund(
      {
        id: 'pay-B',
        tenantId,
        amountCents: 75000,
        method: 'CARD',
        locationId: locB.id,
      },
      30000,
    );

    const refundEntriesA = glEntries.filter(
      (e) => e.sourceId === 'pay-A' && e.sourceType === 'REFUND',
    );
    const refundEntriesB = glEntries.filter(
      (e) => e.sourceId === 'pay-B' && e.sourceType === 'REFUND',
    );
    expect(refundEntriesA).toHaveLength(2);
    expect(refundEntriesB).toHaveLength(2);

    // Refund debits A/R (reinstating the receivable) and credits bank
    // (cash leaves) — both on the originating location's own rows.
    const refundDebitA = refundEntriesA.find((e) => e.debitCents > 0);
    const refundCreditA = refundEntriesA.find((e) => e.creditCents > 0);
    expect(refundDebitA?.accountId).toBe(arA.id);
    expect(refundDebitA?.debitCents).toBe(20000);
    expect(refundCreditA?.accountId).toBe(bankA.id);
    expect(refundCreditA?.creditCents).toBe(20000);

    const refundDebitB = refundEntriesB.find((e) => e.debitCents > 0);
    const refundCreditB = refundEntriesB.find((e) => e.creditCents > 0);
    expect(refundDebitB?.accountId).toBe(arB.id);
    expect(refundDebitB?.debitCents).toBe(30000);
    expect(refundCreditB?.accountId).toBe(bankB.id);
    expect(refundCreditB?.creditCents).toBe(30000);

    // And the refund entries also must not touch the other location.
    const refundAccountsA = new Set(refundEntriesA.map((e) => e.accountId));
    const refundAccountsB = new Set(refundEntriesB.map((e) => e.accountId));
    expect(refundAccountsA.has(arB.id)).toBe(false);
    expect(refundAccountsA.has(bankB.id)).toBe(false);
    expect(refundAccountsB.has(arA.id)).toBe(false);
    expect(refundAccountsB.has(bankA.id)).toBe(false);
  });

  it('per-location pinned SYSTEM posting accounts route default-revenue, sales-tax, and early-termination postings to each location\'s own chart row', async () => {
    // Regression guard for Task #222: gl-posting.ts no longer falls back to
    // hardcoded account numbers (4500 default revenue, 2400 sales tax,
    // 4700 early termination, 4600 ACH return fee) for QBO-connected
    // locations. Two QBO-connected locations whose pulled charts share
    // those numbers but live in different realms must each post to their
    // own pinned chart rows; a third QBO-connected location with NO pin
    // must throw UNCONFIGURED_GL_MAPPING rather than silently picking
    // whichever 4500/2400/4700 row Prisma returned first.
    const tenantId = 'tenant-system-posting';
    const inAnHour = new Date(Date.now() + 60 * 60 * 1000);

    const locA: LocationRow = {
      id: 'loc-sys-a',
      tenantId,
      name: 'Sys Marina A',
      qboAccessToken: 'access-A',
      qboRefreshToken: 'refresh-A',
      qboRealmId: 'realm-A',
      qboTokenExpiresAt: inAnHour,
      qboLastChartOfAccountsSyncAt: null,
    };
    const locB: LocationRow = {
      id: 'loc-sys-b',
      tenantId,
      name: 'Sys Marina B',
      qboAccessToken: 'access-B',
      qboRefreshToken: 'refresh-B',
      qboRealmId: 'realm-B',
      qboTokenExpiresAt: inAnHour,
      qboLastChartOfAccountsSyncAt: null,
    };
    const locC: LocationRow = {
      id: 'loc-sys-c',
      tenantId,
      name: 'Sys Marina C (no pins)',
      qboAccessToken: 'access-C',
      qboRefreshToken: 'refresh-C',
      qboRealmId: 'realm-C',
      qboTokenExpiresAt: inAnHour,
      qboLastChartOfAccountsSyncAt: null,
    };
    locations.set(locA.id, locA);
    locations.set(locB.id, locB);
    locations.set(locC.id, locC);

    // Each realm exposes the same five account numbers but distinct QBO
    // Ids and names. Numbers picked to exercise every system slot:
    //   1200 A/R, 4500 default revenue, 2400 sales tax payable,
    //   4700 early termination income, 2100 deferred revenue.
    accountsByRealm['realm-A'] = [
      { Id: 'a1',  Name: 'A/R — A',                   AcctNum: '1200', AccountType: 'Accounts Receivable',   Active: true },
      { Id: 'a45', Name: 'Default Revenue — A',       AcctNum: '4500', AccountType: 'Income',                Active: true },
      { Id: 'a24', Name: 'Sales Tax Payable — A',     AcctNum: '2400', AccountType: 'Other Current Liability', Active: true },
      { Id: 'a47', Name: 'Early Termination Inc — A', AcctNum: '4700', AccountType: 'Income',                Active: true },
      { Id: 'a21', Name: 'Deferred Revenue — A',      AcctNum: '2100', AccountType: 'Other Current Liability', Active: true },
    ];
    accountsByRealm['realm-B'] = [
      { Id: 'b1',  Name: 'A/R — B',                   AcctNum: '1200', AccountType: 'Accounts Receivable',   Active: true },
      { Id: 'b45', Name: 'Default Revenue — B',       AcctNum: '4500', AccountType: 'Income',                Active: true },
      { Id: 'b24', Name: 'Sales Tax Payable — B',     AcctNum: '2400', AccountType: 'Other Current Liability', Active: true },
      { Id: 'b47', Name: 'Early Termination Inc — B', AcctNum: '4700', AccountType: 'Income',                Active: true },
      { Id: 'b21', Name: 'Deferred Revenue — B',      AcctNum: '2100', AccountType: 'Other Current Liability', Active: true },
    ];
    accountsByRealm['realm-C'] = [
      { Id: 'c1',  Name: 'A/R — C',                   AcctNum: '1200', AccountType: 'Accounts Receivable',   Active: true },
      { Id: 'c45', Name: 'Default Revenue — C',       AcctNum: '4500', AccountType: 'Income',                Active: true },
    ];

    await pullChartOfAccountsForLocation(locA.id, tenantId);
    await pullChartOfAccountsForLocation(locB.id, tenantId);
    await pullChartOfAccountsForLocation(locC.id, tenantId);

    const accountFor = (locationId: string, acctNum: string) => {
      const found = [...glAccounts.values()].find(
        (a) => a.locationId === locationId && a.accountNumber === acctNum,
      );
      if (!found) throw new Error(`No account ${acctNum} for ${locationId}`);
      return found;
    };

    // Mark deferred-revenue rows so getDeferredRevenueAccountId picks them
    // (postEarlyTermination's washout branch needs this).
    accountFor(locA.id, '2100').isDeferredRevenue = true;
    accountFor(locB.id, '2100').isDeferredRevenue = true;

    const arA = accountFor(locA.id, '1200');
    const arB = accountFor(locB.id, '1200');
    const defRevA = accountFor(locA.id, '4500');
    const defRevB = accountFor(locB.id, '4500');
    const taxA = accountFor(locA.id, '2400');
    const taxB = accountFor(locB.id, '2400');
    const termA = accountFor(locA.id, '4700');
    const termB = accountFor(locB.id, '4700');
    const defrA = accountFor(locA.id, '2100');
    const defrB = accountFor(locB.id, '2100');

    // Pin each location's system posting slots — the operator workflow
    // after the chart pull. Also pin A/R + deferred so postInvoice and
    // postEarlyTermination route their non-system legs to the right rows.
    locA.arGlAccountId = arA.id as any;
    (locA as any).defaultRevenueGlAccountId = defRevA.id;
    (locA as any).salesTaxGlAccountId = taxA.id;
    (locA as any).earlyTerminationGlAccountId = termA.id;
    locB.arGlAccountId = arB.id as any;
    (locB as any).defaultRevenueGlAccountId = defRevB.id;
    (locB as any).salesTaxGlAccountId = taxB.id;
    (locB as any).earlyTerminationGlAccountId = termB.id;

    // ----- Invoice posting with a per-line revenue GL set explicitly
    // (mirrors the QBO operator workflow — the line carries the per-
    // product GL mapping) BUT a tax breakdown with NO rate-level
    // glAccountId. The sales-tax credit must resolve through the
    // location's pinned salesTax slot, never through a tenant-wide
    // 2400/2401 lookup that could pick the other realm's row.
    const invoiceA = {
      id: 'inv-sys-A',
      tenantId,
      locationId: locA.id,
      totalCents: 11000,
      lineItems: [
        {
          id: 'li-sys-A',
          extendedCents: 10000,
          taxCents: 1000,
          glAccountId: defRevA.id, // per-product GL mapping (set by operator)
          isDeferred: false,
        },
      ],
      taxBreakdowns: [
        { glAccountId: null, taxCents: 1000 }, // forces salesTax resolution
      ],
    };
    const invoiceB = {
      id: 'inv-sys-B',
      tenantId,
      locationId: locB.id,
      totalCents: 22000,
      lineItems: [
        {
          id: 'li-sys-B',
          extendedCents: 20000,
          taxCents: 2000,
          glAccountId: defRevB.id,
          isDeferred: false,
        },
      ],
      taxBreakdowns: [{ glAccountId: null, taxCents: 2000 }],
    };

    await postInvoice(invoiceA);
    await postInvoice(invoiceB);

    const entriesA = glEntries.filter((e) => e.sourceId === 'inv-sys-A');
    const entriesB = glEntries.filter((e) => e.sourceId === 'inv-sys-B');

    // Each invoice = A/R debit + revenue credit + sales-tax credit.
    expect(entriesA).toHaveLength(3);
    expect(entriesB).toHaveLength(3);

    const accountIdsA = new Set(entriesA.map((e) => e.accountId));
    const accountIdsB = new Set(entriesB.map((e) => e.accountId));

    // A's invoice hits A's A/R + A's revenue + A's sales tax row — never
    // B's, even though account numbers match.
    expect(accountIdsA).toEqual(new Set([arA.id, defRevA.id, taxA.id]));
    expect(accountIdsB).toEqual(new Set([arB.id, defRevB.id, taxB.id]));
    expect(accountIdsA.has(taxB.id)).toBe(false);
    expect(accountIdsB.has(taxA.id)).toBe(false);

    // The sales-tax credit lands on each location's pinned sales-tax row.
    const taxCreditA = entriesA.find((e) => e.accountId === taxA.id);
    const taxCreditB = entriesB.find((e) => e.accountId === taxB.id);
    expect(taxCreditA?.creditCents).toBe(1000);
    expect(taxCreditB?.creditCents).toBe(2000);

    // ----- Early termination: penalty leg uses the earlyTermination pin,
    // washout leg uses defaultRevenue.
    await postEarlyTermination(
      { id: 'contract-sys-A', tenantId, locationId: locA.id },
      5000,
      3000,
    );
    await postEarlyTermination(
      { id: 'contract-sys-B', tenantId, locationId: locB.id },
      7000,
      4000,
    );

    // postEarlyTermination posts two journals per contract with distinct
    // sourceTypes: 'EARLY_TERMINATION' (penalty) and 'DEFERRED_WASHOUT'
    // (washout). Capture both.
    const termEntriesA = glEntries.filter(
      (e) =>
        e.sourceId === 'contract-sys-A' &&
        (e.sourceType === 'EARLY_TERMINATION' || e.sourceType === 'DEFERRED_WASHOUT'),
    );
    const termEntriesB = glEntries.filter(
      (e) =>
        e.sourceId === 'contract-sys-B' &&
        (e.sourceType === 'EARLY_TERMINATION' || e.sourceType === 'DEFERRED_WASHOUT'),
    );

    // Each contract: 1 penalty journal (A/R debit + termination-income
    // credit) + 1 washout journal (deferred-revenue debit + default-
    // revenue credit) = 4 entries.
    expect(termEntriesA).toHaveLength(4);
    expect(termEntriesB).toHaveLength(4);

    // Penalty income credits land on each location's pinned earlyTermination
    // row — never the other location's, never the legacy 4700 lookup.
    const penaltyCreditA = termEntriesA.find((e) => e.accountId === termA.id);
    const penaltyCreditB = termEntriesB.find((e) => e.accountId === termB.id);
    expect(penaltyCreditA?.creditCents).toBe(5000);
    expect(penaltyCreditB?.creditCents).toBe(7000);
    expect(termEntriesA.some((e) => e.accountId === termB.id)).toBe(false);
    expect(termEntriesB.some((e) => e.accountId === termA.id)).toBe(false);

    // Washout revenue credits land on each location's pinned default-
    // revenue row.
    const washoutCreditA = termEntriesA.find(
      (e) => e.accountId === defRevA.id && e.creditCents > 0,
    );
    const washoutCreditB = termEntriesB.find(
      (e) => e.accountId === defRevB.id && e.creditCents > 0,
    );
    expect(washoutCreditA?.creditCents).toBe(3000);
    expect(washoutCreditB?.creditCents).toBe(4000);

    // Washout deferred debits hit each location's own deferred-revenue row.
    const washoutDebitA = termEntriesA.find(
      (e) => e.accountId === defrA.id && e.debitCents > 0,
    );
    const washoutDebitB = termEntriesB.find(
      (e) => e.accountId === defrB.id && e.debitCents > 0,
    );
    expect(washoutDebitA?.debitCents).toBe(3000);
    expect(washoutDebitB?.debitCents).toBe(4000);

    // ----- Negative case: location C is QBO-connected but has NO system
    // posting pins. The resolver MUST throw UNCONFIGURED_GL_MAPPING
    // instead of silently posting to the wrong realm's chart row.
    //
    // Sales-tax slot: post an invoice on C with a tax breakdown that has
    // no rate-level glAccountId. The resolver hits step (2) for QBO-
    // connected locations and throws.
    const accountIdC1200 = accountFor(locC.id, '1200').id;
    const accountIdC4500 = accountFor(locC.id, '4500').id;
    locC.arGlAccountId = accountIdC1200 as any;
    const invoiceC = {
      id: 'inv-sys-C',
      tenantId,
      locationId: locC.id,
      totalCents: 5500,
      lineItems: [
        {
          id: 'li-sys-C',
          extendedCents: 5000,
          taxCents: 500,
          glAccountId: accountIdC4500, // line-level mapping is set; only the tax breakdown is missing
          isDeferred: false,
        },
      ],
      taxBreakdowns: [{ glAccountId: null, taxCents: 500 }],
    };
    await expect(postInvoice(invoiceC)).rejects.toThrow(
      /UNCONFIGURED_GL_MAPPING.*sales tax payable/,
    );

    // Early-termination slot: postEarlyTermination on C without an
    // earlyTermination pin must throw — never silently routing the
    // penalty to the wrong realm's 4700 row.
    await expect(
      postEarlyTermination(
        { id: 'contract-sys-C', tenantId, locationId: locC.id },
        1000,
        0,
      ),
    ).rejects.toThrow(/UNCONFIGURED_GL_MAPPING.*early termination income/);

    // Default-revenue slot: post a washout-only early termination on C.
    // We pin earlyTermination + add a flagged deferred-revenue row so the
    // penalty + deferred lookups succeed; defaultRevenue stays unpinned,
    // and the washout's revenue resolution must throw rather than silently
    // pick the wrong realm's 4500 row.
    const termC: GlAccountRow = {
      id: nextId('gl'),
      tenantId,
      locationId: locC.id,
      accountNumber: '4700',
      name: 'Early Term Inc — C',
      type: 'Income',
      subType: null,
      qboAccountId: 'c47',
      source: 'QBO',
      isActive: true,
      active: true,
      isDeferredRevenue: false,
    };
    const defrC: GlAccountRow = {
      id: nextId('gl'),
      tenantId,
      locationId: locC.id,
      accountNumber: '2100',
      name: 'Deferred Revenue — C',
      type: 'Other Current Liability',
      subType: null,
      qboAccountId: 'c21',
      source: 'QBO',
      isActive: true,
      active: true,
      isDeferredRevenue: true,
    };
    glAccounts.set(termC.id, termC);
    glAccounts.set(defrC.id, defrC);
    (locC as any).earlyTerminationGlAccountId = termC.id;
    // defaultRevenueGlAccountId still unpinned on C → washout must throw.
    await expect(
      postEarlyTermination(
        { id: 'contract-sys-C-washout', tenantId, locationId: locC.id },
        0,
        2000,
      ),
    ).rejects.toThrow(/UNCONFIGURED_GL_MAPPING.*default revenue/);
  });
});
