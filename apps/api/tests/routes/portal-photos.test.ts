import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createTestApp } from '../helpers.js';
import { mockPrisma, TEST_TENANT_ID } from '../setup.js';

vi.mock('../../src/lib/storage.js', () => ({
  deleteFile: vi.fn().mockResolvedValue(undefined),
}));

let app: Express;

beforeAll(async () => {
  app = await createTestApp();
});

beforeEach(() => {
  Object.values(mockPrisma).forEach((model) => {
    if (typeof model === 'object' && model !== null) {
      Object.values(model).forEach((fn) => {
        if (typeof fn === 'function' && 'mockReset' in fn) {
          (fn as { mockReset: () => void }).mockReset();
        }
      });
    }
  });
});

const PORTAL_CUSTOMER_ID = 'cust-portal-1';

// resolvePortalCustomer matches req.userRecord.email → Customer in tenant.
// The auth mock seeds admin@test.com + test-tenant-id, so this stub gives
// the resolver a customer to attach to req.portalCustomerId.
function mockResolverReturnsCustomer() {
  mockPrisma.customer.findFirst.mockResolvedValueOnce({
    id: PORTAL_CUSTOMER_ID,
  });
}

function buildBoatPhoto(overrides: Record<string, unknown> = {}) {
  return {
    id: 'photo-1',
    tenantId: TEST_TENANT_ID,
    boatId: 'boat-1',
    filename: 'bow.jpg',
    contentType: 'image/jpeg',
    sizeBytes: 1234,
    storageKey: `${TEST_TENANT_ID}/boats/bow.jpg`,
    uploadedById: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe('GET /api/portal/boats/:boatId/photos', () => {
  it('returns photos for a boat owned by the portal customer', async () => {
    mockResolverReturnsCustomer();
    mockPrisma.boat.findFirst.mockResolvedValueOnce({ id: 'boat-1' });
    mockPrisma.boatPhoto.findMany.mockResolvedValue([buildBoatPhoto()]);

    const res = await request(app).get('/api/portal/boats/boat-1/photos');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    // Boat lookup must scope by tenantId AND customerId so a portal user
    // can't read another customer's photos within the same marina.
    expect(mockPrisma.boat.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'boat-1',
          tenantId: TEST_TENANT_ID,
          customerId: PORTAL_CUSTOMER_ID,
        }),
      }),
    );
  });

  it('returns 404 when the boat belongs to another customer in the same tenant', async () => {
    mockResolverReturnsCustomer();
    mockPrisma.boat.findFirst.mockResolvedValueOnce(null);

    const res = await request(app).get(
      '/api/portal/boats/other-customers-boat/photos',
    );

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
    expect(mockPrisma.boatPhoto.findMany).not.toHaveBeenCalled();
  });

  it('returns 404 when the boat belongs to another tenant entirely', async () => {
    mockResolverReturnsCustomer();
    mockPrisma.boat.findFirst.mockResolvedValueOnce(null);

    const res = await request(app).get(
      '/api/portal/boats/other-tenant-boat/photos',
    );

    expect(res.status).toBe(404);
    expect(mockPrisma.boatPhoto.findMany).not.toHaveBeenCalled();
  });
});

describe('POST /api/portal/boats/:boatId/photos', () => {
  const validBody = {
    filename: 'stern.jpg',
    contentType: 'image/jpeg' as const,
    sizeBytes: 5000,
    storageKey: `${TEST_TENANT_ID}/boats/stern.jpg`,
  };

  it('creates a photo when the boat belongs to the portal customer', async () => {
    mockResolverReturnsCustomer();
    mockPrisma.boat.findFirst.mockResolvedValueOnce({ id: 'boat-1' });
    mockPrisma.boatPhoto.create.mockResolvedValue(
      buildBoatPhoto({ id: 'photo-new', ...validBody }),
    );

    const res = await request(app)
      .post('/api/portal/boats/boat-1/photos')
      .send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.id).toBe('photo-new');
    expect(mockPrisma.boatPhoto.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: TEST_TENANT_ID,
          boatId: 'boat-1',
          storageKey: validBody.storageKey,
        }),
      }),
    );
  });

  it('returns 404 when uploading to a boat owned by another customer', async () => {
    mockResolverReturnsCustomer();
    mockPrisma.boat.findFirst.mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/api/portal/boats/other-customers-boat/photos')
      .send(validBody);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
    expect(mockPrisma.boatPhoto.create).not.toHaveBeenCalled();
  });

  it('rejects upload when the storageKey is outside the caller’s tenant prefix', async () => {
    mockResolverReturnsCustomer();
    mockPrisma.boat.findFirst.mockResolvedValueOnce({ id: 'boat-1' });

    const res = await request(app)
      .post('/api/portal/boats/boat-1/photos')
      .send({ ...validBody, storageKey: 'other-tenant-id/boats/stern.jpg' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_STORAGE_KEY');
    expect(mockPrisma.boatPhoto.create).not.toHaveBeenCalled();
  });

  it('rejects upload when the storageKey points at a non-boats category', async () => {
    mockResolverReturnsCustomer();
    mockPrisma.boat.findFirst.mockResolvedValueOnce({ id: 'boat-1' });

    const res = await request(app)
      .post('/api/portal/boats/boat-1/photos')
      .send({
        ...validBody,
        storageKey: `${TEST_TENANT_ID}/insurance/stern.jpg`,
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_STORAGE_KEY');
    expect(mockPrisma.boatPhoto.create).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/portal/boats/:boatId/photos/:photoId', () => {
  it('deletes a photo on a boat owned by the portal customer', async () => {
    mockResolverReturnsCustomer();
    mockPrisma.boat.findFirst.mockResolvedValueOnce({ id: 'boat-1' });
    mockPrisma.boatPhoto.findFirst.mockResolvedValue(buildBoatPhoto());
    mockPrisma.boatPhoto.delete.mockResolvedValue(buildBoatPhoto());

    const res = await request(app).delete(
      '/api/portal/boats/boat-1/photos/photo-1',
    );

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockPrisma.boatPhoto.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'photo-1',
          boatId: 'boat-1',
          tenantId: TEST_TENANT_ID,
        }),
      }),
    );
    expect(mockPrisma.boatPhoto.delete).toHaveBeenCalledWith({
      where: { id: 'photo-1' },
    });
  });

  it('returns 404 when deleting a photo on a boat owned by another customer', async () => {
    mockResolverReturnsCustomer();
    mockPrisma.boat.findFirst.mockResolvedValueOnce(null);

    const res = await request(app).delete(
      '/api/portal/boats/other-customers-boat/photos/photo-1',
    );

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
    expect(mockPrisma.boatPhoto.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.boatPhoto.delete).not.toHaveBeenCalled();
  });

  it('returns 404 when the photoId belongs to a different boat', async () => {
    mockResolverReturnsCustomer();
    mockPrisma.boat.findFirst.mockResolvedValueOnce({ id: 'boat-1' });
    mockPrisma.boatPhoto.findFirst.mockResolvedValue(null);

    const res = await request(app).delete(
      '/api/portal/boats/boat-1/photos/some-other-boats-photo',
    );

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
    expect(mockPrisma.boatPhoto.delete).not.toHaveBeenCalled();
  });
});
