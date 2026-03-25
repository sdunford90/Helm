import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockPrisma } from '../setup.js';
import { buildBoat, buildInsuranceRecord, buildSafetyRecord } from '../helpers.js';

let calculateBoatCompliance: typeof import('../../src/services/compliance.js').calculateBoatCompliance;
let getExpiringCompliance: typeof import('../../src/services/compliance.js').getExpiringCompliance;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('../../src/services/compliance.js');
  calculateBoatCompliance = mod.calculateBoatCompliance;
  getExpiringCompliance = mod.getExpiringCompliance;
});

describe('calculateBoatCompliance', () => {
  it('returns ALL_GOOD when insurance, registration, and safety are valid', async () => {
    const futureDate = new Date();
    futureDate.setFullYear(futureDate.getFullYear() + 1);

    const boat = buildBoat({
      registrationNumber: 'FL1234AB',
      registrationExpiry: futureDate,
      insuranceRecords: [
        buildInsuranceRecord({
          expiryDate: futureDate,
          policyNumber: 'POL-999',
          insurer: 'MarineGuard',
        }),
      ],
      safetyRecords: [
        buildSafetyRecord({
          inspectionDate: new Date(),
          nextDueDate: futureDate,
          passFail: 'PASS',
          fireExtExpiry: futureDate,
          flareExpiry: futureDate,
          hasHorn: true,
          hasThrowable: true,
        }),
      ],
    });

    mockPrisma.boat.findUnique.mockResolvedValue(boat);

    const result = await calculateBoatCompliance(boat.id, 'tenant-1');

    expect(result.overallScore).toBe('ALL_GOOD');
    expect(result.insurance.status).toBe('VALID');
    expect(result.registration.status).toBe('VALID');
    expect(result.safety.status).toBe('ALL_GOOD');
    expect(result.safety.issues).toHaveLength(0);
  });

  it('identifies expired insurance', async () => {
    const pastDate = new Date();
    pastDate.setFullYear(pastDate.getFullYear() - 1);

    const futureDate = new Date();
    futureDate.setFullYear(futureDate.getFullYear() + 1);

    const boat = buildBoat({
      registrationNumber: 'FL5678CD',
      registrationExpiry: futureDate,
      insuranceRecords: [
        buildInsuranceRecord({
          expiryDate: pastDate,
          policyNumber: 'POL-EXPIRED',
          insurer: 'OldInsurer',
        }),
      ],
      safetyRecords: [
        buildSafetyRecord({
          inspectionDate: new Date(),
          nextDueDate: futureDate,
          passFail: 'PASS',
          fireExtExpiry: futureDate,
          flareExpiry: futureDate,
          hasHorn: true,
          hasThrowable: true,
        }),
      ],
    });

    mockPrisma.boat.findUnique.mockResolvedValue(boat);

    const result = await calculateBoatCompliance(boat.id, 'tenant-1');

    expect(result.overallScore).toBe('ATTENTION_REQUIRED');
    expect(result.insurance.status).toBe('EXPIRED');
    expect(result.registration.status).toBe('VALID');
  });

  it('returns NON_COMPLIANT when insurance is missing', async () => {
    const futureDate = new Date();
    futureDate.setFullYear(futureDate.getFullYear() + 1);

    const boat = buildBoat({
      registrationNumber: 'FL0000XX',
      registrationExpiry: futureDate,
      insuranceRecords: [],
      safetyRecords: [
        buildSafetyRecord({
          inspectionDate: new Date(),
          nextDueDate: futureDate,
          passFail: 'PASS',
          fireExtExpiry: futureDate,
          flareExpiry: futureDate,
          hasHorn: true,
          hasThrowable: true,
        }),
      ],
    });

    mockPrisma.boat.findUnique.mockResolvedValue(boat);

    const result = await calculateBoatCompliance(boat.id, 'tenant-1');

    expect(result.overallScore).toBe('NON_COMPLIANT');
    expect(result.insurance.status).toBe('MISSING');
  });

  it('flags missing safety equipment', async () => {
    const futureDate = new Date();
    futureDate.setFullYear(futureDate.getFullYear() + 1);

    const pastDate = new Date();
    pastDate.setMonth(pastDate.getMonth() - 1);

    const boat = buildBoat({
      registrationNumber: 'FL9999ZZ',
      registrationExpiry: futureDate,
      insuranceRecords: [
        buildInsuranceRecord({ expiryDate: futureDate }),
      ],
      safetyRecords: [
        buildSafetyRecord({
          inspectionDate: new Date(),
          nextDueDate: futureDate,
          passFail: 'PASS',
          fireExtExpiry: pastDate, // expired
          flareExpiry: pastDate,   // expired
          hasHorn: false,          // missing
          hasThrowable: false,     // missing
        }),
      ],
    });

    mockPrisma.boat.findUnique.mockResolvedValue(boat);

    const result = await calculateBoatCompliance(boat.id, 'tenant-1');

    expect(result.safety.status).toBe('NEEDS_ATTENTION');
    expect(result.safety.issues).toContain('Fire extinguisher expired');
    expect(result.safety.issues).toContain('Flares expired');
    expect(result.safety.issues).toContain('No horn recorded');
    expect(result.safety.issues).toContain('No throwable device recorded');
    expect(result.overallScore).toBe('ATTENTION_REQUIRED');
  });

  it('returns NON_COMPLIANT when no safety inspection exists', async () => {
    const futureDate = new Date();
    futureDate.setFullYear(futureDate.getFullYear() + 1);

    const boat = buildBoat({
      registrationNumber: 'FL1111AA',
      registrationExpiry: futureDate,
      insuranceRecords: [
        buildInsuranceRecord({ expiryDate: futureDate }),
      ],
      safetyRecords: [],
    });

    mockPrisma.boat.findUnique.mockResolvedValue(boat);

    const result = await calculateBoatCompliance(boat.id, 'tenant-1');

    expect(result.overallScore).toBe('NON_COMPLIANT');
    expect(result.safety.status).toBe('NO_INSPECTION');
  });
});

describe('getExpiringCompliance', () => {
  it('returns expiring insurance, registration, and safety items', async () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 15);

    // Expiring insurance
    mockPrisma.insuranceRecord.findMany.mockResolvedValue([
      {
        boatId: 'boat-1',
        customerId: 'cust-1',
        expiryDate: futureDate,
        boat: { name: 'Sea Breeze' },
        customer: { firstName: 'John', lastName: 'Doe' },
      },
    ]);

    // Expiring registration
    mockPrisma.boat.findMany.mockResolvedValue([
      {
        id: 'boat-2',
        name: 'Wind Runner',
        customerId: 'cust-2',
        registrationExpiry: futureDate,
        customer: { firstName: 'Jane', lastName: 'Smith' },
      },
    ]);

    // Expiring safety equipment
    mockPrisma.vesselSafetyRecord.findMany.mockResolvedValue([
      {
        boatId: 'boat-3',
        fireExtExpiry: futureDate,
        flareExpiry: null,
        nextDueDate: null,
        boat: {
          name: 'Fast One',
          customerId: 'cust-3',
          customer: { firstName: 'Bob', lastName: 'Jones' },
        },
      },
    ]);

    const result = await getExpiringCompliance('tenant-1', 30);

    expect(result.insurance).toHaveLength(1);
    expect(result.insurance[0].type).toBe('INSURANCE');
    expect(result.insurance[0].daysUntilExpiry).toBeGreaterThan(0);

    expect(result.registration).toHaveLength(1);
    expect(result.registration[0].type).toBe('REGISTRATION');

    expect(result.safetyEquipment).toHaveLength(1);
    expect(result.safetyEquipment[0].type).toBe('FIRE_EXTINGUISHER');
  });
});
