import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { mockPrisma } from '../setup.js';
import { buildInsuranceRecord, buildCustomer } from '../helpers.js';

let app: any;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('../../src/index.js');
  app = mod.default;
});

describe('GET /api/insurance/compliance', () => {
  it('returns compliance summary with counts', async () => {
    mockPrisma.insuranceRecord.count
      .mockResolvedValueOnce(40) // compliant
      .mockResolvedValueOnce(5)  // pendingReview
      .mockResolvedValueOnce(3)  // expired
      .mockResolvedValueOnce(7)  // expiringSoon
      .mockResolvedValueOnce(55); // total

    mockPrisma.insuranceRecord.findMany.mockResolvedValue([]);

    const res = await request(app).get('/api/insurance/compliance');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('summary');
    expect(res.body.summary).toEqual(
      expect.objectContaining({
        total: 55,
        compliant: 40,
        expiringSoon: 7,
        expired: 3,
        pendingReview: 5,
      }),
    );
    expect(res.body).toHaveProperty('upcomingExpirations');
  });

  it('includes upcoming expirations with days-until-expiry', async () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 15);

    const record = buildInsuranceRecord({
      status: 'APPROVED',
      expiryDate: futureDate,
    });

    mockPrisma.insuranceRecord.count
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(12);

    mockPrisma.insuranceRecord.findMany.mockResolvedValue([
      {
        ...record,
        customer: {
          id: 'cust-1',
          firstName: 'John',
          lastName: 'Doe',
          email: 'john@example.com',
        },
        boat: { id: 'boat-1', name: 'Sea Breeze' },
      },
    ]);

    const res = await request(app).get('/api/insurance/compliance');

    expect(res.status).toBe(200);
    expect(res.body.upcomingExpirations).toHaveLength(1);
    expect(res.body.upcomingExpirations[0]).toHaveProperty('daysUntilExpiry');
    expect(res.body.upcomingExpirations[0].daysUntilExpiry).toBeGreaterThan(0);
  });
});

describe('GET /api/insurance/review-queue', () => {
  it('returns pending review records with pagination', async () => {
    const records = [
      buildInsuranceRecord({
        status: 'PENDING_REVIEW',
        extractionConfidence: JSON.stringify({
          policyNumber: 'high',
          insurer: 'low',
        }),
      }),
    ];

    mockPrisma.insuranceRecord.findMany.mockResolvedValue(
      records.map((r) => ({
        ...r,
        customer: {
          id: 'cust-1',
          firstName: 'Jane',
          lastName: 'Smith',
          email: 'jane@example.com',
        },
        boat: { id: 'boat-1', name: 'Wind Runner', make: 'Boston Whaler', model: '250' },
      })),
    );
    mockPrisma.insuranceRecord.count.mockResolvedValue(1);

    const res = await request(app).get('/api/insurance/review-queue');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toHaveProperty('hasLowConfidence', true);
    expect(res.body.data[0]).toHaveProperty('confidenceParsed');
    expect(res.body).toHaveProperty('pagination');
  });
});
