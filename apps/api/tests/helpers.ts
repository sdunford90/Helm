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

// ---------------------------------------------------------------------------
// Additional factories (shapes follow prisma/schema.prisma)
// ---------------------------------------------------------------------------

let seq = 0;
function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}-${seq}`;
}

export function buildTenant(overrides = {}) {
  return {
    id: 'test-tenant-id',
    name: 'Test Marina',
    subdomain: 'test',
    customDomain: null,
    brandingJson: null,
    invoiceTemplateJson: null,
    stripeAccountId: null,
    qboRealmId: null,
    timezone: 'America/New_York',
    fiscalYearEnd: '12/31',
    saasTierId: null,
    status: 'ACTIVE',
    gracePeriodStartedAt: null,
    lockedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function buildBoat(overrides = {}) {
  return {
    id: 'boat-1',
    tenantId: 'test-tenant-id',
    customerId: 'cust-1',
    name: 'Sea Breeze',
    registrationNumber: 'FL1234AB',
    registrationState: 'FL',
    registrationExpiry: new Date(Date.now() + 180 * 86400000),
    hin: null,
    make: 'Boston Whaler',
    model: '250',
    year: 2020,
    lengthFt: 25,
    beamFt: 8.5,
    draftFt: 1.5,
    fuelType: 'GAS',
    engineCount: 1,
    engineHp: 300,
    insuranceRecords: [],
    safetyRecords: [],
    ...overrides,
  };
}

export function buildInsuranceRecord(overrides = {}) {
  return {
    id: nextId('ins'),
    tenantId: 'test-tenant-id',
    customerId: 'cust-1',
    boatId: 'boat-1',
    documentUrl: 'https://files.example.com/coi.pdf',
    insurer: 'Acme Marine Insurance',
    policyNumber: 'POL-123456',
    startDate: new Date(Date.now() - 180 * 86400000),
    expiryDate: new Date(Date.now() + 180 * 86400000),
    coverageJson: { limits: { bodilyInjury: 500000, propertyDamage: 500000 } },
    extractionConfidence: null,
    status: 'APPROVED',
    ...overrides,
  };
}

export function buildSafetyRecord(overrides = {}) {
  return {
    id: nextId('safety'),
    tenantId: 'test-tenant-id',
    boatId: 'boat-1',
    inspectionDate: new Date(Date.now() - 30 * 86400000),
    inspectorId: null,
    passFail: 'PASS',
    notes: null,
    fireExtCount: 1,
    fireExtExpiry: new Date(Date.now() + 365 * 86400000),
    lifeJacketCount: 4,
    flareExpiry: new Date(Date.now() + 365 * 86400000),
    hasHorn: true,
    hasThrowable: true,
    nextDueDate: new Date(Date.now() + 335 * 86400000),
    ...overrides,
  };
}

export function buildAuditLogEntry(overrides = {}) {
  return {
    id: nextId('audit'),
    tenantId: 'test-tenant-id',
    userId: null,
    userName: null,
    recordType: 'Customer',
    recordId: 'cust-1',
    action: 'CREATED',
    changedFieldsJson: null,
    ipAddress: null,
    createdAt: new Date(),
    ...overrides,
  };
}

export function buildAnnouncement(overrides = {}) {
  return {
    id: nextId('ann'),
    tenantId: 'test-tenant-id',
    subject: 'Dock maintenance',
    body: 'Dock B will be closed on Saturday.',
    audienceFilter: { audience: 'all', customRecipientIds: [] },
    channels: 'EMAIL',
    isEmergency: false,
    scheduledAt: null,
    sentAt: null,
    staffId: 'test-user-id',
    createdAt: new Date(),
    ...overrides,
  };
}

export function buildDockWalk(overrides = {}) {
  return {
    id: nextId('walk'),
    tenantId: 'test-tenant-id',
    inspectorId: 'inspector-001',
    dockId: null,
    startedAt: new Date(),
    completedAt: null,
    status: 'IN_PROGRESS',
    ...overrides,
  };
}

export function buildDockWalkItem(overrides = {}) {
  return {
    id: nextId('walkitem'),
    dockWalkId: 'walk-1',
    slipId: 'slip-1',
    status: 'OK',
    notes: null,
    violationType: null,
    photoUrls: null,
    feeCents: null,
    notifiedAt: null,
    ...overrides,
  };
}

export function buildMeterReading(overrides = {}) {
  return {
    id: nextId('meter'),
    tenantId: 'test-tenant-id',
    slipId: 'slip-1',
    readingDate: new Date(),
    previousKwh: 1000,
    currentKwh: 1350,
    consumedKwh: 350,
    rateCents: 12,
    amountCents: 4200,
    isEstimated: false,
    staffId: null,
    ...overrides,
  };
}

export function buildRentalProduct(overrides = {}) {
  return {
    id: nextId('prod'),
    tenantId: 'test-tenant-id',
    locationId: null,
    boatId: null,
    name: 'Kayak',
    description: null,
    durationType: 'HOURLY',
    basePriceCents: 5000,
    floorPriceCents: null,
    ceilingPriceCents: null,
    damageWaiverCents: null,
    depositCents: null,
    cancellationPolicyId: null,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function buildRentalReservation(overrides = {}) {
  return {
    ...buildReservation(),
    id: nextId('res'),
    waiverSelected: false,
    depositAuthId: null,
    cancellationReason: null,
    refundCents: null,
    stripePaymentIntentId: null,
    priceLockExpiresAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function buildPricingRule(overrides = {}) {
  return {
    id: nextId('rule'),
    rentalProductId: 'prod-1',
    ruleType: 'WEEKEND',
    value: 1.2,
    startDate: null,
    endDate: null,
    daysJson: null,
    priority: 0,
    ...overrides,
  };
}

export function buildRampTicket(overrides = {}) {
  return {
    id: nextId('ramp'),
    tenantId: 'test-tenant-id',
    locationId: null,
    customerId: null,
    guestName: 'Walk-in Guest',
    licensePlate: null,
    boatRegistration: null,
    ticketType: 'SINGLE_LAUNCH',
    amountCents: 1500,
    paymentMethod: 'CASH',
    stripePaymentId: null,
    createdAt: new Date(),
    ...overrides,
  };
}

export function buildConciergeRequest(overrides = {}) {
  return {
    id: nextId('conc'),
    tenantId: 'test-tenant-id',
    customerId: 'cust-1',
    boatId: null,
    serviceType: 'DETAILING',
    preferredDate: new Date(Date.now() + 7 * 86400000),
    notes: null,
    urgency: 'NORMAL',
    status: 'SUBMITTED',
    assignedTo: null,
    vendorId: null,
    quoteCents: null,
    approvedAt: null,
    completedAt: null,
    invoiceId: null,
    ...overrides,
  };
}

export function buildConciergeVendor(overrides = {}) {
  return {
    id: nextId('vendor'),
    tenantId: 'test-tenant-id',
    name: 'Marine Mechanics Inc',
    specialty: 'Engines',
    phone: null,
    email: null,
    notes: null,
    active: true,
    ...overrides,
  };
}

export function buildPosProduct(overrides = {}) {
  return {
    id: nextId('posprod'),
    tenantId: 'test-tenant-id',
    name: 'Dock Line 20ft',
    sku: null,
    barcode: null,
    departmentId: null,
    costCents: 800,
    priceCents: 1500,
    taxClass: null,
    trackInventory: false,
    reorderQty: null,
    ...overrides,
  };
}

export function buildPosTransaction(overrides = {}) {
  return {
    id: nextId('postx'),
    tenantId: 'test-tenant-id',
    cashierId: 'test-user-id',
    shiftId: null,
    subtotalCents: 1500,
    taxCents: 0,
    tipCents: 0,
    totalCents: 1500,
    offlineQueued: false,
    syncedAt: null,
    status: 'COMPLETED',
    createdAt: new Date(),
    lineItems: [],
    ...overrides,
  };
}

export function buildShift(overrides = {}) {
  return {
    id: nextId('shift'),
    tenantId: 'test-tenant-id',
    locationId: null,
    cashierId: 'test-user-id',
    openedAt: new Date(),
    closedAt: null,
    openingFloatCents: 10000,
    closingCashCents: null,
    tipTotalCents: 0,
    status: 'OPEN',
    ...overrides,
  };
}

export function buildTransientBooking(overrides = {}) {
  return {
    id: nextId('trans'),
    tenantId: 'test-tenant-id',
    slipId: 'slip-1',
    guestName: 'Visiting Boater',
    guestEmail: 'guest@example.com',
    guestPhone: null,
    boatName: 'Wanderer',
    boatLength: 32,
    checkIn: new Date(),
    checkOut: new Date(Date.now() + 2 * 86400000),
    rateCents: 15000,
    totalCents: 30000,
    stripePaymentId: null,
    status: 'BOOKED',
    customerId: null,
    createdAt: new Date(),
    ...overrides,
  };
}
