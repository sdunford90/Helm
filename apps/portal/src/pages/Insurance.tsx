import { useState, useRef } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { Shield, Upload, FileText, CheckCircle, AlertTriangle, Clock, Download, Loader, AlertCircle } from 'lucide-react';
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

type InsuranceStatus = 'PENDING_REVIEW' | 'ACTIVE' | 'EXPIRING_SOON' | 'EXPIRED';

interface InsuranceRecord {
  id: string;
  insurer: string | null;
  policyNumber: string | null;
  startDate: string | null;
  expiryDate: string | null;
  status: InsuranceStatus;
  documentUrl: string | null;
  boat: { id: string; name: string } | null;
}

interface Boat {
  id: string;
  name: string;
  registrationExpiry: string | null;
}

interface InsuranceApiResponse {
  records: InsuranceRecord[];
  boats: Boat[];
}

interface PresignResponse {
  url: string;
  key: string;
}

const STATUS_LABELS: Record<InsuranceStatus, string> = {
  PENDING_REVIEW: 'Pending Review',
  ACTIVE: 'Active',
  EXPIRING_SOON: 'Expiring Soon',
  EXPIRED: 'Expired',
};

const statusStyle = (status: InsuranceStatus): CSSProperties => {
  const map: Record<InsuranceStatus, { bg: string; text: string }> = {
    ACTIVE: { bg: '#E6FAF0', text: '#0D9F6E' },
    EXPIRING_SOON: { bg: '#FFF8E6', text: '#D97706' },
    EXPIRED: { bg: '#FFE6E6', text: '#DC2626' },
    PENDING_REVIEW: { bg: '#EEF2FF', text: '#6366F1' },
  };
  const s = map[status] ?? map.PENDING_REVIEW;
  return {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '3px 10px', borderRadius: 20,
    fontSize: 12, fontWeight: 600,
    background: s.bg, color: s.text,
  };
};

const StatusIcon = ({ status }: { status: InsuranceStatus }) => {
  if (status === 'ACTIVE') return <CheckCircle size={12} />;
  if (status === 'EXPIRED' || status === 'EXPIRING_SOON') return <AlertTriangle size={12} />;
  return <Clock size={12} />;
};

export default function Insurance() {
  const { getToken } = useAuth();
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data, loading, error, execute: refetch } = usePortalApi<InsuranceApiResponse>(
    'get',
    '/api/portal/insurance',
    { immediate: true },
  );

  const { execute: createRecord } = usePortalApi<InsuranceRecord>(
    'post',
    '/api/portal/insurance',
  );

  const records = data?.records ?? [];
  const boats = data?.boats ?? [];

  const expiringBoats = boats.filter((b) => {
    if (!b.registrationExpiry) return false;
    const expiry = new Date(b.registrationExpiry);
    const daysUntil = (expiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    return daysUntil > 0 && daysUntil <= 60;
  });

  const latestActive = records.find((r) => r.status === 'ACTIVE' || r.status === 'EXPIRING_SOON');

  const handleFileDrop = async (file: File) => {
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png'];
    if (!allowedTypes.includes(file.type)) {
      setUploadError('Please upload a PDF, JPG, or PNG file.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setUploadError('File size must be under 10MB.');
      return;
    }

    setUploading(true);
    setUploadError(null);
    setUploadSuccess(false);

    try {
      const token = await getToken();
      const authHeaders: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

      // Step 1: Get presigned upload URL from storage service.
      // Field names must match the backend's PresignUploadSchema exactly
      // (category/filename/contentType) — earlier mismatches were the
      // cause of the "failed to fetch" error customers saw on insurance
      // doc upload.
      const presignRes = await fetch('/api/storage/presign-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          category: 'insurance',
          filename: file.name,
          contentType: file.type,
        }),
      });
      if (!presignRes.ok) {
        const errBody = await presignRes.json().catch(() => ({})) as Record<string, string>;
        throw new Error(errBody.error ?? 'Failed to get upload URL');
      }
      const { url: presignUrl, key } = (await presignRes.json()) as PresignResponse;

      // Step 2: Upload directly to R2/S3
      // A `TypeError`/"Failed to fetch" here means the request was blocked
      // before any HTTP response arrived — almost always the bucket's CORS
      // policy not allowing PUT (or the Content-Type request header) from
      // this origin. See apps/api/r2-cors.json + apps/api/scripts/README.md.
      let uploadRes: Response;
      try {
        uploadRes = await fetch(presignUrl, {
          method: 'PUT',
          headers: { 'Content-Type': file.type },
          body: file,
        });
      } catch (netErr) {
        let r2Host = 'unknown';
        try {
          r2Host = new URL(presignUrl).host;
        } catch {
          /* presign URL was malformed; the host helps diagnose anyway */
        }
        console.error('[insurance upload network error]', {
          stage: 'r2-put',
          r2Host,
          storageKey: key,
          filename: file.name,
          sizeBytes: file.size,
          contentType: file.type,
          error: netErr,
        });
        throw new Error("Couldn't reach file storage. This is usually a network or CORS issue — please contact support.");
      }
      if (!uploadRes.ok) throw new Error(`File upload to storage failed (status ${uploadRes.status})`);

      // Step 3: Record the document in the database
      await createRecord({ documentUrl: key });

      setUploadSuccess(true);
      setTimeout(() => setUploadSuccess(false), 5000);
      await refetch();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = async (key: string) => {
    try {
      const token = await getToken();
      const res = await fetch(`/api/storage/presign-download/${encodeURIComponent(key)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const { url } = await res.json() as { url: string };
        window.open(url, '_blank');
      }
    } catch {
      // silently ignore
    }
  };

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: NAVY, marginBottom: 4 }}>Insurance</h1>
        <p style={{ color: '#64748B', fontSize: 14 }}>Manage your vessel insurance certificates and compliance.</p>
      </div>

      {/* Current Policy Card */}
      {loading ? (
        <div style={{ ...card, marginBottom: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, color: '#64748B', padding: 48 }}>
          <Loader size={20} /> <span>Loading insurance records…</span>
        </div>
      ) : error ? (
        <div style={{ ...card, marginBottom: 24, textAlign: 'center', padding: 48, color: '#DC2626' }}>
          <AlertCircle size={24} style={{ marginBottom: 8 }} />
          <p style={{ margin: 0 }}>Could not load insurance records. Please refresh.</p>
        </div>
      ) : latestActive ? (
        <div style={{ ...card, marginBottom: 24, border: '2px solid #E6FAF0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 44, height: 44, borderRadius: 10, background: '#E6FAF0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Shield size={22} color="#0D9F6E" />
              </div>
              <div>
                <h2 style={{ fontSize: 17, fontWeight: 600, color: NAVY, margin: 0 }}>Current Policy</h2>
                <p style={{ color: '#64748B', fontSize: 13, margin: 0 }}>{latestActive.boat?.name ?? 'Vessel'}</p>
              </div>
            </div>
            <span style={statusStyle(latestActive.status)}>
              <StatusIcon status={latestActive.status} /> {STATUS_LABELS[latestActive.status]}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
            {[
              { label: 'Insurer', value: latestActive.insurer ?? '—' },
              { label: 'Policy Number', value: latestActive.policyNumber ?? '—' },
              {
                label: 'Coverage Period',
                value: latestActive.startDate && latestActive.expiryDate
                  ? `${formatDate(latestActive.startDate)} – ${formatDate(latestActive.expiryDate)}`
                  : latestActive.expiryDate ? `Expires ${formatDate(latestActive.expiryDate)}` : '—',
              },
            ].map((item) => (
              <div key={item.label}>
                <div style={{ fontSize: 11, color: '#94A3B8', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                  {item.label}
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: NAVY }}>{item.value}</div>
              </div>
            ))}
          </div>
        </div>
      ) : !loading && (
        <div style={{ ...card, marginBottom: 24, border: '2px dashed #E2E8F0', textAlign: 'center', padding: 32 }}>
          <Shield size={36} color="#CBD5E1" style={{ marginBottom: 12 }} />
          <p style={{ fontSize: 15, fontWeight: 600, color: NAVY, margin: '0 0 4px' }}>No active policy on file</p>
          <p style={{ fontSize: 13, color: '#64748B', margin: 0 }}>Upload your insurance certificate below to stay compliant.</p>
        </div>
      )}

      {/* Expiry Alerts */}
      {expiringBoats.map((b) => (
        <div key={b.id} style={{ ...card, marginBottom: 16, background: '#FFF8E6', border: '1px solid #FDE68A', display: 'flex', alignItems: 'center', gap: 12 }}>
          <AlertTriangle size={20} color="#D97706" />
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#92400E' }}>
              Registration for "{b.name}" expires {formatDate(b.registrationExpiry)}
            </div>
            <div style={{ fontSize: 13, color: '#92400E', opacity: 0.8 }}>
              Please upload updated registration documents before expiry.
            </div>
          </div>
        </div>
      ))}

      {/* Upload feedback */}
      {uploadError && (
        <div style={{ ...card, marginBottom: 12, background: '#FFF0F0', border: '1px solid #FCA5A5', display: 'flex', alignItems: 'center', gap: 10, color: '#DC2626' }}>
          <AlertCircle size={18} /> <span style={{ fontSize: 14 }}>{uploadError}</span>
        </div>
      )}
      {uploadSuccess && (
        <div style={{ ...card, marginBottom: 12, background: '#E6FAF0', border: '1px solid #6EE7B7', display: 'flex', alignItems: 'center', gap: 10, color: '#0D9F6E' }}>
          <CheckCircle size={18} /> <span style={{ fontSize: 14 }}>Document uploaded successfully — pending marina review.</span>
        </div>
      )}

      {/* Upload Area */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png"
        style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFileDrop(f); e.target.value = ''; }}
      />
      <div
        style={{
          ...card, marginBottom: 24,
          border: dragOver ? `2px dashed ${CYAN}` : '2px dashed #CBD5E1',
          background: dragOver ? 'rgba(0, 212, 255, 0.04)' : '#fff',
          textAlign: 'center', cursor: uploading ? 'not-allowed' : 'pointer', transition: 'all 0.15s ease',
          opacity: uploading ? 0.7 : 1,
        }}
        onDragOver={(e) => { e.preventDefault(); if (!uploading) setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); if (!uploading) { const f = e.dataTransfer.files[0]; if (f) void handleFileDrop(f); } }}
        onClick={() => !uploading && fileInputRef.current?.click()}
      >
        {uploading
          ? <Loader size={32} color={CYAN} style={{ marginBottom: 12 }} />
          : <Upload size={32} color={dragOver ? CYAN : '#94A3B8'} style={{ marginBottom: 12 }} />}
        <div style={{ fontSize: 15, fontWeight: 600, color: NAVY, marginBottom: 4 }}>
          {uploading ? 'Uploading…' : 'Upload Insurance Certificate or Registration'}
        </div>
        {!uploading && (
          <>
            <div style={{ fontSize: 13, color: '#64748B' }}>
              Drag and drop your file here, or <span style={{ color: CYAN, fontWeight: 500 }}>browse</span>
            </div>
            <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 8 }}>PDF, JPG, or PNG up to 10MB</div>
          </>
        )}
      </div>

      {/* Document History */}
      <div style={card}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: NAVY, marginBottom: 16 }}>Document History</h2>
        {records.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '24px 0', color: '#94A3B8', fontSize: 14 }}>
            No documents on file yet.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #F1F5F9' }}>
                {['Document', 'Boat', 'Expiry', 'Status', ''].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '10px 12px', fontSize: 12, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {records.map((rec) => (
                <tr key={rec.id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                  <td style={{ padding: '12px', fontSize: 14, color: '#334155' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <FileText size={16} color="#64748B" />
                      {rec.insurer ? `${rec.insurer} — Certificate` : 'Insurance Certificate'}
                    </div>
                    {rec.policyNumber && (
                      <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 2 }}>Policy: {rec.policyNumber}</div>
                    )}
                  </td>
                  <td style={{ padding: '12px', fontSize: 13, color: '#64748B' }}>{rec.boat?.name ?? '—'}</td>
                  <td style={{ padding: '12px', fontSize: 13, color: '#64748B' }}>
                    {rec.expiryDate ? formatDate(rec.expiryDate) : '—'}
                  </td>
                  <td style={{ padding: '12px' }}>
                    <span style={statusStyle(rec.status)}>
                      <StatusIcon status={rec.status} /> {STATUS_LABELS[rec.status]}
                    </span>
                  </td>
                  <td style={{ padding: '12px' }}>
                    {rec.documentUrl && (
                      <button
                        style={{ background: 'none', border: 'none', color: '#64748B', cursor: 'pointer', padding: 4 }}
                        title="Download"
                        onClick={() => void handleDownload(rec.documentUrl!)}
                      >
                        <Download size={16} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
