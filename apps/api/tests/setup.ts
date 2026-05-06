import { vi } from 'vitest';

// Mock environment
process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.IMPERSONATION_SECRET = process.env.IMPERSONATION_SECRET ?? 'test-impersonation-secret-1234567890';

// Mock Prisma - create a mock that returns empty arrays/objects by default
export const mockPrisma = {
  lead: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn(), update: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), count: vi.fn().mockResolvedValue(0), groupBy: vi.fn().mockResolvedValue([]) },
  customer: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn(), update: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), count: vi.fn().mockResolvedValue(0), groupBy: vi.fn().mockResolvedValue([]) },
  slip: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn(), update: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), count: vi.fn().mockResolvedValue(0), groupBy: vi.fn().mockResolvedValue([]), delete: vi.fn() },
  slipContract: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn(), update: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), count: vi.fn().mockResolvedValue(0), groupBy: vi.fn().mockResolvedValue([]) },
  invoice: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn(), update: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), count: vi.fn().mockResolvedValue(0), aggregate: vi.fn().mockResolvedValue({ _sum: {}, _count: { id: 0 } }), groupBy: vi.fn().mockResolvedValue([]) },
  invoiceLineItem: { findMany: vi.fn().mockResolvedValue([]), aggregate: vi.fn().mockResolvedValue({ _sum: { taxCents: 0 } }), deleteMany: vi.fn() },
  payment: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn(), update: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 1 }), findFirst: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), count: vi.fn().mockResolvedValue(0), aggregate: vi.fn().mockResolvedValue({ _sum: { amountCents: 0 }, _count: { id: 0 } }), groupBy: vi.fn().mockResolvedValue([]) },
  paymentRefund: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: data.id ?? 'refund-row-1', ...data, createdAt: new Date() })), update: vi.fn(), deleteMany: vi.fn().mockResolvedValue({ count: 0 }), groupBy: vi.fn().mockResolvedValue([]) },
  boat: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn(), update: vi.fn(), delete: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), count: vi.fn().mockResolvedValue(0) },
  boatPhoto: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn(), create: vi.fn(), delete: vi.fn() },
  waitlistEntry: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn(), count: vi.fn().mockResolvedValue(0), groupBy: vi.fn().mockResolvedValue([]) },
  dockWalk: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn(), count: vi.fn().mockResolvedValue(0) },
  dockWalkItem: { findMany: vi.fn().mockResolvedValue([]), groupBy: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
  pumpOut: { count: vi.fn().mockResolvedValue(0) },
  announcement: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn(), findFirst: vi.fn(), update: vi.fn(), count: vi.fn().mockResolvedValue(0) },
  announcementDelivery: { findMany: vi.fn().mockResolvedValue([]), createMany: vi.fn().mockResolvedValue({ count: 0 }), groupBy: vi.fn().mockResolvedValue([]) },
  rentalProduct: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn(), count: vi.fn().mockResolvedValue(0) },
  reservation: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn(), groupBy: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0), findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  pricingRule: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  cancellationPolicy: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null) },
  pricingCalendarOverride: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
  demandSurgeTier: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
  algorithmicSuggestion: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn() },
  promoCode: { findMany: vi.fn().mockResolvedValue([]) },
  posTransaction: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn(), count: vi.fn().mockResolvedValue(0), aggregate: vi.fn().mockResolvedValue({ _sum: {}, _count: { id: 0 } }) },
  posLineItem: { findMany: vi.fn().mockResolvedValue([]) },
  shift: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn(), findFirst: vi.fn() },
  product: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn().mockResolvedValue(0) },
  productCategory: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn().mockResolvedValue(0) },
  productCategoryGlMapping: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn(), upsert: vi.fn(), delete: vi.fn() },
  rentalProductGlMapping: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn(), upsert: vi.fn(), delete: vi.fn() },
  dockageRate: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), count: vi.fn().mockResolvedValue(0) },
  dockageRateGlMapping: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn(), findUnique: vi.fn(), upsert: vi.fn(), delete: vi.fn() },
  serviceFee: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn().mockResolvedValue(0) },
  serviceFeeGlMapping: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn(), findUnique: vi.fn(), upsert: vi.fn(), delete: vi.fn() },
  taxRate: { findMany: vi.fn().mockResolvedValue([]) },
  locationTaxJurisdiction: { findMany: vi.fn().mockResolvedValue([]) },
  transientBooking: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn(), count: vi.fn().mockResolvedValue(0) },
  rampTicket: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn(), count: vi.fn().mockResolvedValue(0) },
  conciergeRequest: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn(), count: vi.fn().mockResolvedValue(0) },
  conciergeVendor: { findMany: vi.fn().mockResolvedValue([]) },
  collectionsAccount: { findMany: vi.fn().mockResolvedValue([]) },
  deferredSchedule: { findMany: vi.fn().mockResolvedValue([]) },
  securityDeposit: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 0 }), aggregate: vi.fn().mockResolvedValue({ _sum: { amountCents: 0 }, _count: { id: 0 } }) },
  chargeback: { findMany: vi.fn().mockResolvedValue([]) },
  glAccount: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn() },
  vendor: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  qboInventorySyncRef: { findUnique: vi.fn(), findMany: vi.fn().mockResolvedValue([]), upsert: vi.fn(), update: vi.fn(), create: vi.fn() },
  // Tiny in-memory simulation of the persisted resync-job tables so any test
  // that hits the inventory-resync endpoints gets a working store without
  // having to wire up Prisma mocks itself.
  qboInventoryResyncJob: (() => {
    const store = new Map<string, any>();
    let idCounter = 0;
    const matches = (row: any, where: Record<string, any>) => {
      for (const [k, v] of Object.entries(where)) {
        if (v && typeof v === 'object' && !(v instanceof Date)) {
          if ('lt' in v && !(row[k] instanceof Date && row[k] < v.lt)) return false;
          if ('not' in v && row[k] === v.not) return false;
        } else if (row[k] !== v) {
          return false;
        }
      }
      return true;
    };
    return {
      _store: store,
      _reset: () => { store.clear(); idCounter = 0; },
      create: vi.fn(async ({ data }: any) => {
        const now = new Date();
        const row = {
          id: data.id ?? `job-${++idCounter}`,
          tenantId: data.tenantId,
          status: data.status ?? 'running',
          total: data.total ?? 0,
          processed: data.processed ?? 0,
          attempted: data.attempted ?? 0,
          succeeded: data.succeeded ?? 0,
          failed: data.failed ?? 0,
          skipped: data.skipped ?? 0,
          startedAt: data.startedAt ?? now,
          updatedAt: data.updatedAt ?? now,
          completedAt: data.completedAt ?? null,
          error: data.error ?? null,
        };
        store.set(row.id, row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = store.get(where.id);
        if (!row) throw new Error(`No job ${where.id}`);
        Object.assign(row, data);
        if (!data.updatedAt) row.updatedAt = new Date();
        return row;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const row of store.values()) {
          if (matches(row, where)) { Object.assign(row, data); count++; }
        }
        return { count };
      }),
      findFirst: vi.fn(async ({ where }: any) => {
        for (const row of store.values()) {
          if (matches(row, where)) return row;
        }
        return null;
      }),
      findMany: vi.fn(async () => Array.from(store.values())),
      deleteMany: vi.fn(async ({ where }: any = {}) => {
        let count = 0;
        for (const [id, row] of store) {
          if (!where || matches(row, where)) { store.delete(id); count++; }
        }
        return { count };
      }),
    };
  })(),
  qboInventoryResyncJobDetail: (() => {
    const list: any[] = [];
    let idCounter = 0;
    return {
      _store: list,
      _reset: () => { list.length = 0; idCounter = 0; },
      create: vi.fn(async ({ data }: any) => {
        const row = {
          id: data.id ?? `detail-${++idCounter}`,
          jobId: data.jobId,
          sequence: data.sequence,
          sourceType: data.sourceType,
          sourceId: data.sourceId,
          qboType: data.qboType,
          status: data.status,
          error: data.error ?? null,
          createdAt: new Date(),
        };
        list.push(row);
        return row;
      }),
      findMany: vi.fn(async ({ where, orderBy }: any) => {
        const rows = list.filter((d) => d.jobId === where.jobId);
        if (orderBy?.sequence === 'asc') rows.sort((a, b) => a.sequence - b.sequence);
        return rows;
      }),
      deleteMany: vi.fn(async () => {
        const count = list.length;
        list.length = 0;
        return { count };
      }),
    };
  })(),
  glEntry: { findMany: vi.fn().mockResolvedValue([]), groupBy: vi.fn().mockResolvedValue([]), aggregate: vi.fn().mockResolvedValue({ _sum: { debitCents: 0, creditCents: 0 } }), createMany: vi.fn().mockResolvedValue({ count: 0 }) },
  auditLog: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null), create: vi.fn(), count: vi.fn().mockResolvedValue(0), groupBy: vi.fn().mockResolvedValue([]) },
  insuranceRecord: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn(), count: vi.fn().mockResolvedValue(0) },
  renewalBatch: { findMany: vi.fn().mockResolvedValue([]) },
  referralPartner: { findMany: vi.fn().mockResolvedValue([]) },
  npsSurvey: { findMany: vi.fn().mockResolvedValue([]) },
  meterReading: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn() },
  fuelSale: {
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({
      id: 'test-fuel-sale-id', tenantId: data.tenantId ?? 'test-tenant', customerId: data.customerId ?? null,
      guestName: data.guestName ?? null, fuelType: data.fuelType, gallons: data.gallons,
      priceCentsPerGallon: data.priceCentsPerGallon, totalCents: data.totalCents,
      pumpNumber: data.pumpNumber ?? null, staffId: data.staffId ?? null,
      paymentMethod: data.paymentMethod ?? null, createdAt: new Date(),
    })),
    count: vi.fn().mockResolvedValue(0),
  },
  fuelDelivery: {
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({
      id: 'test-fuel-delivery-id', tenantId: data.tenantId ?? 'test-tenant',
      supplier: data.supplier, fuelType: data.fuelType, gallons: data.gallons,
      costCentsPerGallon: data.costCentsPerGallon, totalCostCents: data.totalCostCents,
      tankLevelAfterGallons: data.tankLevelAfterGallons ?? null,
      notes: data.notes ?? null, deliveredAt: new Date(),
    })),
    count: vi.fn().mockResolvedValue(0),
  },
  user: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  userLocation: {
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    createMany: vi.fn().mockResolvedValue({ count: 0 }),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    count: vi.fn().mockResolvedValue(0),
  },
  location: {
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn().mockResolvedValue(0),
  },
  saasTier: {
    findMany: vi.fn().mockResolvedValue([]),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
  },
  apiKey: { findUnique: vi.fn() },
  processed_webhooks: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() },
  qboWebhookDelivery: (() => {
    // Tiny in-memory store so create + findUnique + update behave like the
    // real Prisma model. Tests that need richer behavior can still
    // .mockResolvedValueOnce on individual methods.
    const rows = new Map<string, any>();
    let counter = 0;
    return {
      create: vi.fn().mockImplementation(({ data }: any) => {
        const id = `qbo-delivery-${++counter}`;
        const row = { id, attempts: 0, ...data };
        rows.set(id, row);
        return Promise.resolve(row);
      }),
      update: vi.fn().mockImplementation(({ where, data }: any) => {
        const existing = rows.get(where.id);
        const merged = { ...(existing ?? { id: where.id }), ...data };
        if (data?.attempts && typeof data.attempts === 'object' && 'increment' in data.attempts) {
          merged.attempts = (existing?.attempts ?? 0) + data.attempts.increment;
        }
        rows.set(where.id, merged);
        return Promise.resolve(merged);
      }),
      findUnique: vi.fn().mockImplementation(({ where }: any) =>
        Promise.resolve(rows.get(where.id) ?? null),
      ),
      findMany: vi.fn().mockResolvedValue([]),
    };
  })(),
  inventory: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null), updateMany: vi.fn().mockResolvedValue({ count: 0 }), update: vi.fn(), create: vi.fn() },
  inventoryLot: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null), create: vi.fn(), update: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
  accountingPeriod: { findFirst: vi.fn().mockResolvedValue(null) },
  purchaseOrder: { findMany: vi.fn().mockResolvedValue([]) },
  tenant: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn().mockResolvedValue([]), update: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 0 }), create: vi.fn(), count: vi.fn().mockResolvedValue(0) },
  tenantNote: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  adminAuditEvent: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue({ id: 'evt-1' }), count: vi.fn().mockResolvedValue(0) },
  saasInvoice: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn().mockResolvedValue(0), aggregate: vi.fn().mockResolvedValue({ _sum: {}, _count: { id: 0 } }) },
  saasTier: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  achReturn: { findMany: vi.fn().mockResolvedValue([]) },
  vesselSafetyRecord: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn(), update: vi.fn(), findUnique: vi.fn(), count: vi.fn().mockResolvedValue(0) },
  emailSuppression: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn(), findMany: vi.fn().mockResolvedValue([]), create: vi.fn(), delete: vi.fn() },
  cardExpiryReminder: { findUnique: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]), create: vi.fn(), update: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 1 }), deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
  $transaction: vi.fn().mockImplementation((arg: any) => {
    if (typeof arg === 'function') return arg(mockPrisma);
    if (Array.isArray(arg)) return Promise.all(arg);
    return Promise.resolve(arg);
  }),
};

// Tests may reference rentalReservation — alias it to reservation so mock data flows through
(mockPrisma as any).rentalReservation = mockPrisma.reservation;

vi.mock('../src/lib/prisma.js', () => ({
  prisma: mockPrisma,
  tenantStore: { run: (_ctx: any, fn: any) => fn() },
}));

// Mock Clerk auth
vi.mock('../src/middleware/auth.js', () => ({
  clerkAuth: () => [
    (_req: any, _res: any, next: any) => {
      _req.auth = { userId: 'test-clerk-user' };
      next();
    },
    (_req: any, _res: any, next: any) => {
      _req.userId = 'test-user-id';
      _req.userRole = 'admin';
      _req.userRecord = { id: 'test-user-id', clerk_id: 'test-clerk-user', tenant_id: 'test-tenant-id', role: 'admin', email: 'admin@test.com' };
      _req.allowedLocationIds = null; // bypass — admins see everything
      next();
    },
  ],
  requireRole: (..._roles: string[]) => (_req: any, _res: any, next: any) => {
    _req.userId = 'test-user-id';
    _req.userRole = 'admin';
    next();
  },
  requirePlatformAdmin: () => [
    (_req: any, _res: any, next: any) => {
      _req.userId = 'test-user-id';
      _req.userRole = 'PLATFORM_ADMIN';
      _req.userRecord = { id: 'test-user-id', email: 'admin@test.com', role: 'PLATFORM_ADMIN' };
      _req.allowedLocationIds = null;
      next();
    },
  ],
  filterByAllowedLocations: (req: any, baseWhere: Record<string, unknown>, opts?: { field?: string; includeNull?: boolean }) => {
    const allowed = req?.allowedLocationIds;
    if (allowed === null || allowed === undefined) return baseWhere;
    const field = opts?.field ?? 'locationId';
    const cond = opts?.includeNull
      ? { OR: [{ [field]: { in: allowed } }, { [field]: null }] }
      : { [field]: { in: allowed } };
    return { ...baseWhere, ...cond };
  },
  requireLocationAccess: (req: any, locationId: string | null | undefined) => {
    const allowed = req?.allowedLocationIds;
    if (allowed === null || allowed === undefined) return true;
    if (!locationId) return false;
    return allowed.includes(locationId);
  },
  requireAdminRole: (..._roles: string[]) => (_req: any, _res: any, next: any) => {
    _req.userId = _req.userId ?? 'test-user-id';
    _req.userRole = _req.userRole ?? 'PLATFORM_ADMIN';
    _req.userAdminRole = _req.userAdminRole ?? 'SUPERUSER';
    next();
  },
  ADMIN_ROLES: ['SUPERUSER', 'BILLING_ADMIN', 'READ_ONLY_SUPPORT'] as const,
  isAdminRole: (value: unknown): boolean =>
    typeof value === 'string' && ['SUPERUSER', 'BILLING_ADMIN', 'READ_ONLY_SUPPORT'].includes(value),
  isLocationBypassRole: (role: string | undefined | null): boolean =>
    !!role && ['PLATFORM_ADMIN', 'TENANT_ADMIN', 'MARINA_OWNER'].includes(role),
  loadAllowedLocationIds: async () => null,
  assertAuthConfigOrExit: () => {},
}));

// Mock tenant middleware
vi.mock('../src/middleware/tenant.js', () => ({
  tenantMiddleware: (_req: any, _res: any, next: any) => {
    _req.tenantId = 'test-tenant-id';
    _req.tenant = { id: 'test-tenant-id', name: 'Test Marina', subdomain: 'test' };
    next();
  },
}));

// Mock Stripe — keep `stripe` and `requireStripe()` returning the SAME object
// so tests can mutate one mock and have the route see the changes.
const stripeMock = {
  paymentIntents: {
    create: vi.fn().mockResolvedValue({ id: 'pi_test', client_secret: 'cs_test', status: 'succeeded' }),
    retrieve: vi.fn().mockResolvedValue({ id: 'pi_test', status: 'succeeded', amount: 0 }),
  },
  refunds: { create: vi.fn().mockResolvedValue({ id: 're_test' }) },
  customers: {
    retrieve: vi.fn().mockResolvedValue({ id: 'cus_test', metadata: { autopay: 'true' } }),
    update: vi.fn().mockResolvedValue({ id: 'cus_test' }),
    create: vi.fn().mockResolvedValue({ id: 'cus_test' }),
  },
  paymentMethods: {
    list: vi.fn().mockResolvedValue({ data: [] }),
  },
  checkout: {
    sessions: {
      create: vi.fn().mockResolvedValue({ id: 'cs_test', url: 'https://checkout.stripe.com/test' }),
    },
  },
};
vi.mock('../src/lib/stripe.js', () => ({
  stripe: stripeMock,
  requireStripe: () => stripeMock,
  createPaymentIntent: vi.fn().mockResolvedValue({ id: 'pi_test', client_secret: 'cs_test' }),
  createCustomer: vi.fn().mockResolvedValue({ id: 'cus_test' }),
  processWebhook: vi.fn().mockResolvedValue(null),
  // Mirror the real export. Tests for direct-charge routes (POS CNP) want
  // to assert that `application_fee_amount` is computed and included in the
  // `paymentIntents.create` call, so we use the real arithmetic instead of
  // a constant — keeps tests honest without pulling in the real module.
  calculateApplicationFee: (amountCents: number, pctBps: number, fixedCents: number) => {
    const pct = Math.ceil((amountCents * pctBps) / 10_000);
    return Math.max(0, pct + fixedCents);
  },
}));

// Mock BullMQ queues
vi.mock('../src/lib/queue.js', () => ({
  queues: {
    billing: { add: vi.fn() },
    'deferred-revenue': { add: vi.fn() },
    'qbo-sync': { add: vi.fn() },
    email: { add: vi.fn() },
    sms: { add: vi.fn() },
    renewals: { add: vi.fn() },
    automation: { add: vi.fn() },
  },
  redisConnection: { quit: vi.fn() },
}));

// Mock services used by invoice routes
vi.mock('../src/services/tax-engine.js', () => ({
  calculateTax: vi.fn().mockResolvedValue({
    items: [{ taxCents: 700, taxRate: 0.07 }],
    totalTaxCents: 700,
  }),
}));

vi.mock('../src/services/gl-posting.js', () => ({
  postInvoice: vi.fn().mockResolvedValue(undefined),
  postVoid: vi.fn().mockResolvedValue(undefined),
  postPayment: vi.fn().mockResolvedValue(undefined),
  postRefund: vi.fn().mockResolvedValue(undefined),
  reversePostRefund: vi.fn().mockResolvedValue(undefined),
  postManualJournalEntry: vi.fn().mockResolvedValue('je-test-id'),
  postSecurityDeposit: vi.fn().mockResolvedValue('je-deposit-id'),
  releaseSecurityDeposit: vi.fn().mockResolvedValue('je-deposit-release-id'),
}));

vi.mock('../src/services/deferred-revenue.js', () => ({
  createDeferredSchedule: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/services/lead-conversion.js', () => ({
  convertLeadToCustomer: vi.fn().mockResolvedValue({ customer: { id: 'cust-new' }, lead: { id: 'lead-1', stage: 'WON' } }),
}));

vi.mock('../src/services/customer-merge.js', () => ({
  mergeCustomers: vi.fn().mockResolvedValue({ mergeId: 'merge-1', primaryId: 'cust-1' }),
  undoMerge: vi.fn().mockResolvedValue({ success: true }),
}));

// Mock @clerk/express to prevent real initialization
vi.mock('@clerk/express', () => ({
  requireAuth: () => (_req: any, _res: any, next: any) => next(),
  getAuth: () => ({ userId: 'test-clerk-user' }),
  // src/index.ts mounts clerkMiddleware() globally; without this the
  // import fails before any contracts route can be exercised.
  clerkMiddleware: () => (_req: any, _res: any, next: any) => next(),
}));

// Mock Sentry
vi.mock('@sentry/node', () => ({
  init: vi.fn(),
  captureException: vi.fn(),
  setUser: vi.fn(),
}));

export const TEST_TENANT_ID = 'test-tenant-id';
export const TEST_USER_ID = 'test-user-id';
