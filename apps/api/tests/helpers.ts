export async function createTestApp() {
  // Dynamically import the app after mocks are set up
  const { default: app } = await import('../src/index.js');
  return app;
}

// Test data factories
export function buildLead(overrides = {}) {
  return {
    id: 'lead-1',
    tenantId: 'test-tenant-id',
    firstName: 'John',
    lastName: 'Doe',
    email: 'john@test.com',
    phone: '5551234567',
    stage: 'NEW',
    boatLength: null,
    slipType: null,
    notes: null,
    assignedTo: null,
    locationId: null,
    sourceFormId: null,
    sourceUrl: null,
    utmSource: null,
    utmMedium: null,
    referralCode: null,
    lostReason: null,
    convertedAt: null,
    customerId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function buildCustomer(overrides = {}) {
  return {
    id: 'cust-1',
    tenantId: 'test-tenant-id',
    firstName: 'Jane',
    lastName: 'Smith',
    email: 'jane@test.com',
    phone: '5559876543',
    company: null,
    status: 'ACTIVE',
    taxExempt: false,
    achBlocked: false,
    stripeCustomerId: null,
    addressJson: null,
    boats: [],
    _count: { invoices: 0, slipContracts: 0 },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function buildSlip(overrides = {}) {
  return {
    id: 'slip-1',
    tenantId: 'test-tenant-id',
    slipNumber: 'A-01',
    dockId: null,
    lengthFt: 40,
    beamFt: 14,
    depthFt: 8,
    status: 'VACANT',
    slipType: null,
    shorePower: null,
    transientCapable: false,
    electricityMode: 'METERED',
    flatFeeCents: null,
    kwhRateCents: null,
    qrCodeUrl: null,
    contracts: [],
    currentOccupant: null,
    ...overrides,
  };
}

export function buildInvoice(overrides = {}) {
  return {
    id: 'inv-1',
    tenantId: 'test-tenant-id',
    customerId: 'cust-1',
    invoiceNumber: 'INV-1001',
    issuedDate: new Date(),
    dueDate: new Date(Date.now() + 30 * 86400000),
    status: 'ISSUED',
    subtotalCents: 100000,
    taxCents: 7000,
    totalCents: 107000,
    balanceCents: 107000,
    pdfUrl: null,
    customer: {
      id: 'cust-1',
      firstName: 'Jane',
      lastName: 'Smith',
      email: 'jane@test.com',
      company: null,
    },
    _count: { lineItems: 1, payments: 0 },
    lineItems: [
      {
        id: 'li-1',
        description: 'Slip rental',
        quantity: 1,
        unitPriceCents: 100000,
        discountCents: 0,
        taxRate: 0.07,
        taxCents: 7000,
        extendedCents: 100000,
        glAccountId: null,
        isDeferred: false,
        sourceType: null,
        sourceId: null,
      },
    ],
    payments: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function buildPayment(overrides = {}) {
  return {
    id: 'pay-1',
    tenantId: 'test-tenant-id',
    customerId: 'cust-1',
    invoiceId: 'inv-1',
    amountCents: 107000,
    method: 'CARD',
    status: 'COMPLETED',
    stripePaymentId: 'pi_test',
    postedDate: new Date(),
    customer: {
      id: 'cust-1',
      firstName: 'Jane',
      lastName: 'Smith',
      email: 'jane@test.com',
    },
    invoice: {
      id: 'inv-1',
      invoiceNumber: 'INV-1001',
      totalCents: 107000,
      balanceCents: 0,
      status: 'PAID',
    },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function buildContract(overrides = {}) {
  return {
    id: 'con-1',
    tenantId: 'test-tenant-id',
    slipId: 'slip-1',
    customerId: 'cust-1',
    startDate: new Date(),
    endDate: new Date(Date.now() + 365 * 86400000),
    billingCycle: 'MONTHLY',
    rateCents: 250000,
    status: 'ACTIVE',
    ...overrides,
  };
}

export function buildReservation(overrides = {}) {
  return {
    id: 'res-1',
    tenantId: 'test-tenant-id',
    customerId: 'cust-1',
    rentalProductId: 'prod-1',
    startDt: new Date(),
    endDt: new Date(Date.now() + 4 * 3600000),
    totalCents: 34000,
    status: 'CONFIRMED',
    ...overrides,
  };
}
