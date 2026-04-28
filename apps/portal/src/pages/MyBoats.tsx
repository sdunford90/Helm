import { useEffect, useRef, useState } from 'react';
import { Ship, CheckCircle, AlertTriangle, Edit, Anchor, Camera, Plus, Trash2, Loader } from 'lucide-react';
import { useAuth } from '@clerk/clerk-react';
import type { CSSProperties } from 'react';
import { usePortalApi, formatDate } from '../lib/api';

const NAVY = '#0A2342';
const CYAN = '#00D4FF';

const card: CSSProperties = {
  background: '#fff',
  borderRadius: 12,
  padding: 24,
  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
};

interface ApiBoat {
  id: string;
  name: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  lengthFt: number | null;
  registrationNumber: string | null;
  registrationExpiresAt: string | null;
  slipContracts?: { slip?: { label: string } | null }[];
}

interface ApiBoatPhoto {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  storageKey: string;
  createdAt: string;
}

interface PresignResponse {
  url: string;
  key: string;
}

const PHOTO_ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const PHOTO_ALLOWED_EXTS = ['png', 'jpg', 'jpeg', 'webp'];
const PHOTO_MAX_BYTES = 10 * 1024 * 1024;
const PHOTO_ACCEPT_ATTR = [...PHOTO_ALLOWED_TYPES, '.png', '.jpg', '.jpeg', '.webp'].join(',');

function getPhotoExtension(name: string): string | null {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return null;
  return name.slice(dot + 1).toLowerCase();
}

function isAllowedPhoto(file: File): boolean {
  // Some browsers leave file.type empty for valid images, so fall back to
  // the filename extension (matches the staff-side preValidateBoatPhoto).
  if (file.type && PHOTO_ALLOWED_TYPES.includes(file.type)) return true;
  const ext = getPhotoExtension(file.name);
  return ext !== null && PHOTO_ALLOWED_EXTS.includes(ext);
}

function resolvePhotoContentType(file: File): string {
  if (file.type && PHOTO_ALLOWED_TYPES.includes(file.type)) return file.type;
  const ext = getPhotoExtension(file.name);
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  return file.type || 'application/octet-stream';
}

function complianceBadge(expiresAt: string | null): CSSProperties {
  if (!expiresAt) return { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 20, fontSize: 13, fontWeight: 600, background: '#F1F5F9', color: '#64748B' };
  const daysLeft = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86400000);
  const isGood = daysLeft > 60;
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 12px',
    borderRadius: 20,
    fontSize: 13,
    fontWeight: 600,
    background: isGood ? '#E6FAF0' : '#FFF8E6',
    color: isGood ? '#0D9F6E' : '#D97706',
  };
}

function BoatPhotos({ boatId }: { boatId: string }) {
  const { getToken } = useAuth();
  const [photos, setPhotos] = useState<ApiBoatPhoto[]>([]);
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    setLoading(true);
    try {
      const token = await getToken();
      const res = await fetch(`/api/portal/boats/${boatId}/photos`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Failed to load photos');
      const data = (await res.json()) as ApiBoatPhoto[];
      setPhotos(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load photos');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boatId]);

  // Resolve presigned download URLs so the <img> tags can load private R2 objects.
  useEffect(() => {
    let cancelled = false;
    const missing = photos.filter((p) => !thumbUrls[p.id]);
    if (missing.length === 0) return;
    (async () => {
      const token = await getToken();
      const next: Record<string, string> = {};
      for (const p of missing) {
        try {
          const res = await fetch(`/api/storage/presign-download/${encodeURIComponent(p.storageKey)}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          if (res.ok) {
            const body = (await res.json()) as { url: string };
            next[p.id] = body.url;
          }
        } catch {
          /* leave missing — UI shows fallback icon */
        }
      }
      if (!cancelled && Object.keys(next).length > 0) {
        setThumbUrls((prev) => ({ ...prev, ...next }));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos]);

  async function handleUpload(file: File) {
    if (!isAllowedPhoto(file)) {
      setError('Please choose a PNG, JPG, or WEBP image.');
      return;
    }
    if (file.size > PHOTO_MAX_BYTES) {
      setError('Boat photos must be 10 MB or smaller.');
      return;
    }
    if (file.size === 0) {
      setError('That file is empty.');
      return;
    }

    setUploading(true);
    setError(null);
    const contentType = resolvePhotoContentType(file);
    try {
      const token = await getToken();
      const authHeaders: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

      // 1. Presign — server validates content-type/extension here.
      const presignRes = await fetch('/api/storage/presign-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          category: 'boats',
          filename: file.name,
          contentType,
        }),
      });
      if (!presignRes.ok) {
        const body = await presignRes.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? 'Failed to get upload URL');
      }
      const { url: presignUrl, key } = (await presignRes.json()) as PresignResponse;

      // 2. PUT directly to R2. Wrap network errors with the same r2Host
      // diagnostic the Insurance/Documents/Logo/Disputes uploaders use so
      // CORS regressions are visible from the browser console.
      let uploadRes: Response;
      try {
        uploadRes = await fetch(presignUrl, {
          method: 'PUT',
          headers: { 'Content-Type': contentType },
          body: file,
        });
      } catch (netErr) {
        let r2Host = 'unknown';
        try {
          r2Host = new URL(presignUrl).host;
        } catch {
          /* malformed presign URL */
        }
        console.error('[boat photo upload network error]', {
          stage: 'r2-put',
          r2Host,
          storageKey: key,
          filename: file.name,
          sizeBytes: file.size,
          contentType,
          error: netErr,
        });
        throw new Error("Couldn't reach file storage. This is usually a network or CORS issue — please contact support.");
      }
      if (!uploadRes.ok) throw new Error(`Upload to storage failed (status ${uploadRes.status})`);

      // 3. Magic-byte verify; orphan cleanup on failure.
      const verifyRes = await fetch('/api/storage/verify-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ key, contentType }),
      });
      if (!verifyRes.ok) {
        await fetch(`/api/storage/${encodeURIComponent(key)}`, { method: 'DELETE', headers: authHeaders }).catch(() => {});
        const body = await verifyRes.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? 'Uploaded file was rejected');
      }

      // 4. Persist the photo metadata. If this fails, clean up the R2
      // object so we don't leave a verified-but-unreferenced orphan.
      const persistRes = await fetch(`/api/portal/boats/${boatId}/photos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          filename: file.name,
          contentType,
          sizeBytes: file.size,
          storageKey: key,
        }),
      });
      if (!persistRes.ok) {
        await fetch(`/api/storage/${encodeURIComponent(key)}`, { method: 'DELETE', headers: authHeaders }).catch(() => {});
        const body = await persistRes.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? 'Failed to save photo');
      }

      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleDelete(photo: ApiBoatPhoto) {
    if (!window.confirm(`Delete "${photo.filename}"?`)) return;
    setError(null);
    try {
      const token = await getToken();
      const authHeaders: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
      // Server-side handler best-effort cleans up the R2 object, so the
      // client doesn't need to follow up with an extra storage delete.
      const res = await fetch(`/api/portal/boats/${boatId}/photos/${photo.id}`, {
        method: 'DELETE',
        headers: authHeaders,
      });
      if (!res.ok) throw new Error('Delete failed');
      setThumbUrls((prev) => {
        const { [photo.id]: _removed, ...rest } = prev;
        return rest;
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  const triggerPicker = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  return (
    <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid #E2E8F0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: NAVY, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          <Camera size={14} /> Photos
        </div>
        <button
          type="button"
          onClick={triggerPicker}
          disabled={uploading}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '6px 14px', fontSize: 13, fontWeight: 600,
            color: '#fff', background: uploading ? '#94A3B8' : NAVY,
            border: 'none', borderRadius: 6,
            cursor: uploading ? 'wait' : 'pointer',
          }}
        >
          {uploading ? <Loader size={14} /> : <Plus size={14} />}
          {uploading ? 'Uploading…' : 'Add Photo'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept={PHOTO_ACCEPT_ATTR}
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleUpload(f);
          }}
        />
      </div>
      {error && (
        <div style={{ color: '#DC2626', fontSize: 13, marginBottom: 8, padding: '8px 12px', background: '#FEF2F2', borderRadius: 6 }}>{error}</div>
      )}
      {loading ? (
        <div style={{ color: '#94A3B8', fontSize: 13 }}>Loading photos…</div>
      ) : photos.length === 0 ? (
        <div style={{ color: '#94A3B8', fontSize: 14 }}>
          No photos uploaded yet. PNG, JPG, or WEBP up to 10 MB.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12 }}>
          {photos.map((p) => {
            const url = thumbUrls[p.id];
            return (
              <div
                key={p.id}
                style={{
                  position: 'relative', borderRadius: 8, overflow: 'hidden',
                  border: '1px solid #E2E8F0', background: '#F8FAFC',
                  aspectRatio: '1 / 1', display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                }}
              >
                {url ? (
                  <a href={url} target="_blank" rel="noopener noreferrer" style={{ display: 'block', width: '100%', height: '100%' }}>
                    <img
                      src={url}
                      alt={p.filename}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    />
                  </a>
                ) : (
                  <Camera size={28} color="#94A3B8" />
                )}
                <button
                  type="button"
                  onClick={() => handleDelete(p)}
                  title="Delete photo"
                  aria-label={`Delete ${p.filename}`}
                  style={{
                    position: 'absolute', top: 6, right: 6,
                    background: 'rgba(10, 35, 66, 0.85)', color: '#fff',
                    border: 'none', borderRadius: '50%', width: 24, height: 24,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer',
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function MyBoats() {
  const { data, loading, error } = usePortalApi<ApiBoat[]>(
    'get',
    '/api/portal/boats',
    { immediate: true },
  );

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: NAVY, marginBottom: 4 }}>My Boats</h1>
        <p style={{ color: '#64748B', fontSize: 14 }}>Manage your vessel information and compliance documents.</p>
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: 48, color: '#64748B' }}>Loading boats...</div>
      )}

      {error && (
        <div style={{ ...card, textAlign: 'center', padding: 32, color: '#DC2626' }}>
          Failed to load boat information.
        </div>
      )}

      {!loading && !error && (!data || data.length === 0) && (
        <div style={{ ...card, textAlign: 'center', padding: 48 }}>
          <Ship size={48} color="#94A3B8" style={{ marginBottom: 16 }} />
          <h2 style={{ fontSize: 18, fontWeight: 600, color: NAVY, marginBottom: 8 }}>No boats on file</h2>
          <p style={{ color: '#64748B', fontSize: 14 }}>Contact the marina office to register your vessel.</p>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {(data ?? []).map((boat) => {
          const expiresAt = boat.registrationExpiresAt ?? null;
          const daysLeft = expiresAt ? Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86400000) : null;
          const isGood = daysLeft === null || daysLeft > 60;
          const slipLabel = boat.slipContracts?.[0]?.slip?.label ?? '—';
          const issues: string[] = [];
          if (daysLeft !== null && daysLeft <= 60) issues.push('Registration expiring soon');

          return (
            <div key={boat.id} style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', gap: 20 }}>
                  <div style={{ width: 80, height: 80, borderRadius: 12, background: '#EFF6FF', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Ship size={36} color={CYAN} />
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
                      <h2 style={{ fontSize: 20, fontWeight: 700, color: NAVY, margin: 0 }}>{boat.name || 'Unnamed Vessel'}</h2>
                      <span style={complianceBadge(expiresAt)}>
                        {isGood ? <CheckCircle size={14} /> : <AlertTriangle size={14} />}
                        {isGood ? 'Registration Current' : 'Reg. Expiring Soon'}
                      </span>
                    </div>
                    {(boat.year || boat.make || boat.model) && (
                      <p style={{ color: '#64748B', fontSize: 14, margin: '2px 0' }}>
                        {[boat.year, boat.make, boat.model].filter(Boolean).join(' ')}
                      </p>
                    )}

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, auto)', gap: '8px 32px', marginTop: 16 }}>
                      {boat.lengthFt && (
                        <div>
                          <div style={{ fontSize: 11, color: '#94A3B8', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Length</div>
                          <div style={{ fontSize: 14, fontWeight: 600, color: NAVY }}>{boat.lengthFt} ft</div>
                        </div>
                      )}
                      {boat.registrationNumber && (
                        <div>
                          <div style={{ fontSize: 11, color: '#94A3B8', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Registration</div>
                          <div style={{ fontSize: 14, fontWeight: 600, color: NAVY }}>{boat.registrationNumber}</div>
                        </div>
                      )}
                      {expiresAt && (
                        <div>
                          <div style={{ fontSize: 11, color: '#94A3B8', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Reg. Expiry</div>
                          <div style={{ fontSize: 14, fontWeight: 600, color: NAVY }}>{formatDate(expiresAt)}</div>
                        </div>
                      )}
                      <div>
                        <div style={{ fontSize: 11, color: '#94A3B8', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Assigned Slip</div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: NAVY, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Anchor size={14} color={CYAN} /> {slipLabel}
                        </div>
                      </div>
                    </div>

                    {issues.length > 0 && (
                      <div style={{ marginTop: 12 }}>
                        {issues.map((issue, i) => (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#D97706' }}>
                            <AlertTriangle size={14} /> {issue}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <button style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8, border: '1px solid #E2E8F0', background: '#fff', color: NAVY, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                  <Edit size={14} /> Update Info
                </button>
              </div>

              <BoatPhotos boatId={boat.id} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
