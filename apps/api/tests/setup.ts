import { vi, beforeEach } from 'vitest';

// Mock environment
process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.REDIS_URL = 'redis://localhost:6379';

// Mock Prisma - create a mock that returns empty arrays/objects by default
const mockPrismaBase = {
  lead: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn(), update: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), count: vi.fn().mockResolvedValue(0), groupBy: vi.fn().mockResolvedValue([]) },
  customer: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn(), update: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), count: vi.fn().mockResolvedValue(0), groupBy: vi.fn().mockResolvedValue([]) },
  slip: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn(), update: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), count: vi.fn().mockResolvedValue(0), groupBy: vi.fn().mockResolvedValue([]), delete: vi.fn() },
  slipContract: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn(), update: vi.fn(), findUnique: vi.fn(), count: vi.fn().mockResolvedValue(0), groupBy: vi.fn().mockResolvedValue([]) },
  invoice: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn(), update: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), count: vi.fn().mockResolvedValue(0), aggregate: vi.fn().mockResolvedValue({ _sum: {}, _count: { id: 0 } }), groupBy: vi.fn().mockResolvedValue([]) },
  invoiceLineItem: { findMany: vi.fn().mockResolvedValue([]), aggregate: vi.fn().mockResolvedValue({ _sum: { taxCents: 0 } }), deleteMany: vi.fn() },
  payment: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn(), update: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), count: vi.fn().mockResolvedValue(0), aggregate: vi.fn().mockResolvedValue({ _sum: { amountCents: 0 }, _count: { id: 0 } }), groupBy: vi.fn().mockResolvedValue([]) },
  boat: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn(), findUnique: vi.fn(), count: vi.fn().mockResolvedValue(0) },
  waitlistEntry: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn(), count: vi.fn().mockResolvedValue(0), groupBy: vi.fn().mockResolvedValue([]) },
  dockWalk: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn(), count: vi.fn().mockResolvedValue(0) },
  dockWalkItem: { findMany: vi.fn().mockResolvedValue([]), groupBy: vi.fn().mockResolvedValue([]) },
  pumpOut: { count: vi.fn().mockResolvedValue(0) },
  announcement: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn(), count: vi.fn().mockResolvedValue(0) },
  announcementDelivery: { findMany: vi.fn().mockResolvedValue([]) },
  rentalProduct: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn() },
  reservation: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn(), groupBy: vi.fn().mockResolvedValue([]) },
  pricingRule: { findMany: vi.fn().mockResolvedValue([]) },
  pricingCalendarOverride: { count: vi.fn().mockResolvedValue(0) },
  demandSurgeTier: { count: vi.fn().mockResolvedValue(0) },
  algorithmicSuggestion: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn() },
  promoCode: { findMany: vi.fn().mockResolvedValue([]) },
  posTransaction: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn(), aggregate: vi.fn().mockResolvedValue({ _sum: {}, _count: { id: 0 } }) },
  posLineItem: { findMany: vi.fn().mockResolvedValue([]) },
  shift: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn() },
  product: { findMany: vi.fn().mockResolvedValue([]) },
  transientBooking: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn() },
  rampTicket: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn() },
  conciergeRequest: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn() },
  conciergeVendor: { findMany: vi.fn().mockResolvedValue([]) },
  collectionsAccount: { findMany: vi.fn().mockResolvedValue([]) },
  deferredSchedule: { findMany: vi.fn().mockResolvedValue([]) },
  securityDeposit: { findMany: vi.fn().mockResolvedValue([]), aggregate: vi.fn().mockResolvedValue({ _sum: { amountCents: 0 }, _count: { id: 0 } }) },
  chargeback: { findMany: vi.fn().mockResolvedValue([]) },
  glAccount: { findMany: vi.fn().mockResolvedValue([]) },
  glEntry: { findMany: vi.fn().mockResolvedValue([]), groupBy: vi.fn().mockResolvedValue([]), aggregate: vi.fn().mockResolvedValue({ _sum: { debitCents: 0, creditCents: 0 } }) },
  auditLog: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn(), count: vi.fn().mockResolvedValue(0), groupBy: vi.fn().mockResolvedValue([]) },
  insuranceRecord: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn(), count: vi.fn().mockResolvedValue(0) },
  renewalBatch: { findMany: vi.fn().mockResolvedValue([]) },
  referralPartner: { findMany: vi.fn().mockResolvedValue([]) },
  npsSurvey: { findMany: vi.fn().mockResolvedValue([]) },
  meterReading: { findMany: vi.fn().mockResolvedValue([]) },
  user: { findMany: vi.fn().mockResolvedValue([]) },
  apiKey: { findUnique: vi.fn() },
  inventory: { findMany: vi.fn().mockResolvedValue([]) },
  purchaseOrder: { findMany: vi.fn().mockResolvedValue([]) },
  tenant: { findFirst: vi.fn(), findUnique: vi.fn() },
  achReturn: { findMany: vi.fn().mockResolvedValue([]) },
  // Supports both interactive (callback) and batch (array) transactions.
  $transaction: vi.fn().mockImplementation((arg: any) =>
    typeof arg === 'function' ? arg(mockPrisma) : Promise.all(arg),
  ),
};

// Every model delegate (and every method on it) exists on demand, so a test
// never fails with "Cannot read properties of undefined (reading
// 'mockResolvedValue')" just because a delegate was not listed above.
// Defaults: list-like reads resolve to empty results, everything else to
// undefined.
const DELEGATE_DEFAULTS: Record<string, () => unknown> = {
  findMany: () => vi.fn().mockResolvedValue([]),
  count: () => vi.fn().mockResolvedValue(0),
  groupBy: () => vi.fn().mockResolvedValue([]),
  aggregate: () =>
    vi.fn().mockResolvedValue({ _sum: {}, _count: { id: 0 }, _avg: {}, _min: {}, _max: {} }),
  createMany: () => vi.fn().mockResolvedValue({ count: 0 }),
  updateMany: () => vi.fn().mockResolvedValue({ count: 0 }),
  deleteMany: () => vi.fn().mockResolvedValue({ count: 0 }),
};

function autoDelegate(initial: Record<string, any> = {}): any {
  return new Proxy(initial, {
    get(target, prop) {
      if (typeof prop !== 'string' || prop === 'then') return target[prop as any];
      if (!(prop in target)) target[prop] = DELEGATE_DEFAULTS[prop]?.() ?? vi.fn();
      return target[prop];
    },
  });
}

for (const key of Object.keys(mockPrismaBase)) {
  if (!key.startsWith('$')) {
    (mockPrismaBase as Record<string, any>)[key] = autoDelegate((mockPrismaBase as Record<string, any>)[key]);
  }
}

export const mockPrisma: any = new Proxy(mockPrismaBase as Record<string, any>, {
  get(target, prop) {
    if (typeof prop !== 'string' || prop === 'then' || prop.startsWith('$')) return target[prop as any];
    if (!(prop in target)) target[prop] = autoDelegate();
    return target[prop];
  },
});

vi.mock('../src/lib/prisma.js', () => ({
  prisma: mockPrisma,
  tenantStore: { run: (_ctx: any, fn: any) => fn() },
}));

// Mock Clerk auth
// The signed-in test user's role. Defaults to MARINA_OWNER; tests may set
// testAuth.role (reset before every test) to exercise role guards.
const hoistedAuth = vi.hoisted(() => ({ role: 'MARINA_OWNER' as string }));
export const testAuth = hoistedAuth;
beforeEach(() => {
  testAuth.role = 'MARINA_OWNER';
});

vi.mock('../src/middleware/auth.js', () => ({
  clerkAuth: () => [
    (_req: any, _res: any, next: any) => {
      _req.auth = { userId: 'test-clerk-user' };
      next();
    },
    (_req: any, _res: any, next: any) => {
      _req.userId = 'test-user-id';
      _req.userRole = hoistedAuth.role;
      _req.userRecord = { id: 'test-user-id', clerkId: 'test-clerk-user', tenantId: 'test-tenant-id', role: hoistedAuth.role, email: 'owner@test.com' };
      next();
    },
  ],
  // Enforces roles like the real middleware, against the UserRole enum
  // values, so a guard written with non-existent role names (e.g. "admin")
  // fails in tests instead of only in production.
  requireRole: (...roles: string[]) => (req: any, res: any, next: any) => {
    req.userId = req.userId ?? 'test-user-id';
    req.userRole = hoistedAuth.role;
    if (!roles.includes(hoistedAuth.role)) {
      res.status(403).json({ error: 'Insufficient permissions', code: 'FORBIDDEN' });
      return;
    }
    next();
  },
  requirePlatformAdmin: () => [
    (_req: any, _res: any, next: any) => { next(); },
  ],
}));

// Mock tenant middleware
vi.mock('../src/middleware/tenant.js', () => ({
  tenantMiddleware: (_req: any, _res: any, next: any) => {
    _req.tenantId = 'test-tenant-id';
    _req.tenant = { id: 'test-tenant-id', name: 'Test Marina', subdomain: 'test' };
    next();
  },
}));

// Mock Stripe
vi.mock('../src/lib/stripe.js', () => ({
  stripe: {
    paymentIntents: { create: vi.fn().mockResolvedValue({ id: 'pi_test', client_secret: 'cs_test', status: 'succeeded' }) },
    refunds: { create: vi.fn().mockResolvedValue({ id: 're_test' }) },
  },
  createPaymentIntent: vi.fn().mockResolvedValue({ id: 'pi_test', client_secret: 'cs_test' }),
  createCustomer: vi.fn().mockResolvedValue({ id: 'cus_test' }),
  processWebhook: vi.fn().mockResolvedValue(null),
}));

// Mock BullMQ queues
vi.mock('../src/lib/queue.js', () => {
  const mkQueue = () => ({
    add: vi.fn(),
    upsertJobScheduler: vi.fn().mockResolvedValue(undefined),
    removeJobScheduler: vi.fn().mockResolvedValue(true),
  });
  const queues = {
    billing: mkQueue(),
    'deferred-revenue': mkQueue(),
    'qbo-sync': mkQueue(),
    email: mkQueue(),
    sms: mkQueue(),
    renewals: mkQueue(),
    automation: mkQueue(),
  };
  return {
    queues,
    redisConnection: { quit: vi.fn() },
    NOTIFICATION_JOB_OPTS: {},
    // Typed producers delegate to the queue mocks so tests can assert on
    // queues.email.add / queues.sms.add.
    enqueueEmail: vi.fn((name: string, data: unknown, opts?: unknown) => queues.email.add(name, data, opts)),
    enqueueSms: vi.fn((name: string, data: unknown, opts?: unknown) => queues.sms.add(name, data, opts)),
  };
});

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
  postSecurityDeposit: vi.fn().mockResolvedValue(undefined),
  releaseSecurityDeposit: vi.fn().mockResolvedValue(undefined),
  postAchReturn: vi.fn().mockResolvedValue('journal-ach'),
  postDeferredRecognition: vi.fn().mockResolvedValue(undefined),
  postEarlyTermination: vi.fn().mockResolvedValue('journal-term'),
  postManualJournalEntry: vi.fn().mockResolvedValue('journal-manual'),
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
}));

// Mock Sentry
vi.mock('@sentry/node', () => ({
  init: vi.fn(),
  captureException: vi.fn(),
  setUser: vi.fn(),
}));

export const TEST_TENANT_ID = 'test-tenant-id';
export const TEST_USER_ID = 'test-user-id';
