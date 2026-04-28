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

function buildBoatPhoto(overrides: Record<string, unknown> = {}) {
  return {
    id: 'photo-1',
    tenantId: TEST_TENANT_ID,
    boatId: 'boat-1',
    filename: 'bow.jpg',
    contentType: 'image/jpeg',
    sizeBytes: 1234,
    storageKey: `${TEST_TENANT_ID}/boats/bow.jpg`,
    uploadedById: 'test-user-id',
    createdAt: new Date(),
    ...overrides,
  };
}

describe('GET /api/boats/:id/photos', () => {
  it('returns photos for a boat in the caller’s tenant', async () => {
    mockPrisma.boat.findFirst.mockResolvedValue({ id: 'boat-1' });
    mockPrisma.boatPhoto.findMany.mockResolvedValue([buildBoatPhoto()]);

    const res = await request(app).get('/api/boats/boat-1/photos');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe('photo-1');
    expect(mockPrisma.boat.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'boat-1',
          tenantId: TEST_TENANT_ID,
        }),
      }),
    );
    expect(mockPrisma.boatPhoto.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          boatId: 'boat-1',
          tenantId: TEST_TENANT_ID,
        }),
      }),
    );
  });

  it('returns 404 when the boat belongs to a different tenant', async () => {
    mockPrisma.boat.findFirst.mockResolvedValue(null);

    const res = await request(app).get('/api/boats/other-tenant-boat/photos');

    expect(res.status).toBe(404);
    expect(mockPrisma.boatPhoto.findMany).not.toHaveBeenCalled();
  });
});

describe('POST /api/boats/:id/photos', () => {
  const validBody = {
    filename: 'stern.jpg',
    contentType: 'image/jpeg',
    sizeBytes: 5000,
    storageKey: `${TEST_TENANT_ID}/boats/stern.jpg`,
  };

  it('creates a photo when the boat and storage key both belong to the tenant', async () => {
    mockPrisma.boat.findFirst.mockResolvedValue({ id: 'boat-1' });
    mockPrisma.boatPhoto.create.mockResolvedValue(
      buildBoatPhoto({ id: 'photo-new', ...validBody }),
    );

    const res = await request(app)
      .post('/api/boats/boat-1/photos')
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

  it('returns 404 when the boat belongs to a different tenant', async () => {
    mockPrisma.boat.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/boats/other-tenant-boat/photos')
      .send(validBody);

    expect(res.status).toBe(404);
    expect(mockPrisma.boatPhoto.create).not.toHaveBeenCalled();
  });

  it('rejects upload when the storageKey is outside the caller’s tenant prefix', async () => {
    mockPrisma.boat.findFirst.mockResolvedValue({ id: 'boat-1' });

    const res = await request(app)
      .post('/api/boats/boat-1/photos')
      .send({ ...validBody, storageKey: 'other-tenant-id/boats/stern.jpg' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_STORAGE_KEY');
    expect(mockPrisma.boatPhoto.create).not.toHaveBeenCalled();
  });

  it('rejects upload when the storageKey points at a non-boats category', async () => {
    mockPrisma.boat.findFirst.mockResolvedValue({ id: 'boat-1' });

    const res = await request(app)
      .post('/api/boats/boat-1/photos')
      .send({
        ...validBody,
        storageKey: `${TEST_TENANT_ID}/documents/stern.jpg`,
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_STORAGE_KEY');
    expect(mockPrisma.boatPhoto.create).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/boats/:id/photos/:photoId', () => {
  it('deletes a photo that belongs to the caller’s tenant', async () => {
    mockPrisma.boatPhoto.findFirst.mockResolvedValue(buildBoatPhoto());
    mockPrisma.boatPhoto.delete.mockResolvedValue(buildBoatPhoto());

    const res = await request(app).delete('/api/boats/boat-1/photos/photo-1');

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

  it('returns 404 when the photo belongs to a different tenant', async () => {
    mockPrisma.boatPhoto.findFirst.mockResolvedValue(null);

    const res = await request(app).delete(
      '/api/boats/other-tenant-boat/photos/other-tenant-photo',
    );

    expect(res.status).toBe(404);
    expect(mockPrisma.boatPhoto.delete).not.toHaveBeenCalled();
  });
});
