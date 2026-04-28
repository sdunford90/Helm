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
    refundedCents: 0,
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

export function buildRentalReservation(overrides = {}) {
  return buildReservation(overrides);
}

export function buildRentalProduct(overrides = {}) {
  return {
    id: 'prod-1',
    tenantId: 'test-tenant-id',
    name: 'Kayak',
    category: 'WATERCRAFT',
    description: null,
    totalQuantity: 3,
    hourlyRateCents: 2500,
    dailyRateCents: 15000,
    weeklyRateCents: null,
    depositCents: 5000,
    requiresWaiver: false,
    isActive: true,
    active: true,
    floorPriceCents: null,
    ceilingPriceCents: null,
    damageWaiverCents: 0,
    pricingRules: [],
    demandSurgeTiers: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function buildPricingRule(overrides = {}) {
  return {
    id: 'rule-1',
    tenantId: 'test-tenant-id',
    name: 'Standard Rate',
    type: 'FLAT',
    baseRateCents: 5000,
    minLengthFt: null,
    maxLengthFt: null,
    slipType: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function buildAnnouncement(overrides = {}) {
  return {
    id: 'ann-1',
    tenantId: 'test-tenant-id',
    subject: 'Welcome to the Marina',
    body: 'Thank you for being a member.',
    sendEmail: true,
    sendSms: false,
    scheduledAt: null,
    sentAt: null,
    status: 'SENT',
    createdById: 'test-user-id',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function buildAuditLogEntry(overrides = {}) {
  return {
    id: 'audit-1',
    tenantId: 'test-tenant-id',
    userId: null,
    action: 'CREATED',
    recordType: 'Invoice',
    recordId: 'inv-1',
    diff: null,
    ipAddress: null,
    userAgent: null,
    createdAt: new Date(),
    ...overrides,
  };
}

export function buildConciergeRequest(overrides = {}) {
  return {
    id: 'conc-1',
    tenantId: 'test-tenant-id',
    customerId: 'cust-1',
    vendorId: null,
    serviceType: 'Boat Detailing',
    description: null,
    status: 'SUBMITTED',
    scheduledAt: null,
    completedAt: null,
    amountCents: null,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function buildConciergeVendor(overrides = {}) {
  return {
    id: 'vend-1',
    tenantId: 'test-tenant-id',
    name: 'Marine Services Co',
    serviceTypes: ['Boat Detailing'],
    phone: null,
    email: null,
    website: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function buildDockWalk(overrides = {}) {
  return {
    id: 'walk-1',
    tenantId: 'test-tenant-id',
    userId: 'test-user-id',
    status: 'COMPLETED',
    startedAt: new Date(),
    completedAt: new Date(),
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function buildDockWalkItem(overrides = {}) {
  return {
    id: 'item-1',
    dockWalkId: 'walk-1',
    slipId: 'slip-1',
    status: 'OK',
    violationType: null,
    notes: null,
    photoUrls: [],
    createdAt: new Date(),
    ...overrides,
  };
}

export function buildInsuranceRecord(overrides = {}) {
  return {
    id: 'ins-1',
    tenantId: 'test-tenant-id',
    customerId: 'cust-1',
    boatId: null,
    policyNumber: 'POL-12345',
    insurer: 'MarineInsure',
    expiryDate: new Date(Date.now() + 90 * 86400000),
    status: 'APPROVED',
    documentUrl: null,
    extractionConfidence: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function buildRampTicket(overrides = {}) {
  return {
    id: 'ramp-1',
    tenantId: 'test-tenant-id',
    customerId: null,
    ticketType: 'SINGLE_LAUNCH',
    guestName: null,
    vehiclePlate: null,
    trailerPlate: null,
    amountCents: 2500,
    paymentMethod: 'CARD',
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function buildPosProduct(overrides = {}) {
  return {
    id: 'posp-1',
    tenantId: 'test-tenant-id',
    name: 'Dock Line 20ft',
    sku: null,
    category: 'SUPPLIES',
    priceCents: 2499,
    taxable: true,
    trackInventory: false,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function buildPosTransaction(overrides = {}) {
  return {
    id: 'post-1',
    tenantId: 'test-tenant-id',
    cashierId: 'test-user-id',
    shiftId: null,
    customerId: null,
    subtotalCents: 2499,
    taxCents: 175,
    totalCents: 2674,
    paymentMethod: 'CARD',
    stripePaymentId: null,
    receiptUrl: null,
    voided: false,
    lineItems: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function buildShift(overrides = {}) {
  return {
    id: 'shift-1',
    tenantId: 'test-tenant-id',
    cashierId: 'test-user-id',
    openedAt: new Date(),
    closedAt: null,
    openingFloatCents: 20000,
    closingFloatCents: null,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function buildTransientBooking(overrides = {}) {
  return {
    id: 'trans-1',
    tenantId: 'test-tenant-id',
    slipId: 'slip-1',
    customerId: null,
    vesselName: 'Sea Breeze',
    vesselLength: 38,
    checkIn: new Date(),
    checkOut: new Date(Date.now() + 3 * 86400000),
    rateCents: 8500,
    totalCents: 25500,
    status: 'CONFIRMED',
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function buildTenant(overrides = {}) {
  return {
    id: 'test-tenant-id',
    name: 'Test Marina',
    subdomain: 'test',
    domain: null,
    stripeAccountId: null,
    stripeSubscriptionId: null,
    plan: 'STARTER',
    status: 'ACTIVE',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function buildBoat(overrides: any = {}) {
  return {
    id: 'boat-1',
    tenantId: 'test-tenant-id',
    customerId: 'cust-1',
    make: 'Bayliner',
    model: 'Element',
    year: 2020,
    lengthFt: 18,
    registrationNumber: 'FL1234AB',
    registrationExpiry: new Date(Date.now() + 365 * 86400000),
    hullId: null,
    insuranceRecords: [],
    safetyRecords: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function buildSafetyRecord(overrides: any = {}) {
  return {
    id: 'safe-1',
    boatId: 'boat-1',
    tenantId: 'test-tenant-id',
    inspectionDate: new Date(),
    nextDueDate: new Date(Date.now() + 365 * 86400000),
    passFail: 'PASS',
    fireExtExpiry: new Date(Date.now() + 365 * 86400000),
    flareExpiry: new Date(Date.now() + 365 * 86400000),
    lifeJacketCount: 4,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function buildMeterReading(overrides = {}) {
  return {
    id: 'meter-1',
    tenantId: 'test-tenant-id',
    slipId: 'slip-1',
    readingKwh: 150.5,
    recordedAt: new Date(),
    recordedById: 'test-user-id',
    createdAt: new Date(),
    ...overrides,
  };
}
