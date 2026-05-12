import { CSSProperties, useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '@clerk/clerk-react';
import { Ship, Anchor, Shield, ImageIcon, MapPin, Phone, AlertCircle, Loader2, ArrowLeft } from 'lucide-react';

// P8 — Single-boat hub. One round-trip GET /api/portal/boats/:id returns
// boat + active contracts + insurance + photos. The page renders each
// piece in its own card. Read-only — boat editing lives in My Boats.

const NAVY = '#0A2342';

interface BoatPayload {
  boat: {
    id: string;
    name: string | null;
    make: string | null;
    model: string | null;
    year: number | null;
    lengthFt: number | null;
    beamFt: number | null;
    draftFt: number | null;
    fuelType: string | null;
    engineCount: number | null;
    engineHp: number | null;
    registrationNumber: string | null;
    registrationState: string | null;
    registrationExpiry: string | null;
    hin: string | null;
  };
  activeContracts: Array<{
    contractId: string;
    startDate: string;
    endDate: string | null;
    slip: {
      id: string;
      number: string;
      lengthFt: number;
      beamFt: number | null;
      shorePower: string | null;
      location: { name: string; address: string | null; phone: string | null } | null;
    } | null;
  }>;
  insurance: Array<{
    id: string;
    insurer: string | null;
    policyNumber: string | null;
    startDate: string | null;
    endDate: string | null;
    documentUrl: string | null;
  }>;
  photos: Array<{
    id: string;
    storageKey: string;
    caption: string | null;
    createdAt: string;
  }>;
}

const styles: Record<string, CSSProperties> = {
  page: { padding: 32, maxWidth: 1000 },
  back: { display: 'inline-flex', alignItems: 'center', gap: 6, color: NAVY, textDecoration: 'none', fontSize: 13, fontWeight: 600, marginBottom: 16 },
  title: { fontSize: 32, fontWeight: 700, color: NAVY, margin: 0, letterSpacing: '-0.02em' },
  subtitle: { fontSize: 14, color: '#64748B', marginTop: 6 },
  divider: { height: 4, background: 'linear-gradient(90deg, #00D4FF, transparent)', border: 'none', marginTop: 16, marginBottom: 24, borderRadius: 2 },
  card: { background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.04)', padding: 24, marginBottom: 18 },
  cardHead: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 },
  cardIcon: { width: 36, height: 36, borderRadius: 8, background: 'rgba(0,212,255,0.10)', color: NAVY, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 17, fontWeight: 700, color: NAVY, margin: 0 },
  factGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 },
  fact: { background: '#F8FAFC', borderRadius: 8, padding: '12px 14px', border: '1px solid #E2E8F0' },
  factLabel: { fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase' as const, letterSpacing: '0.04em', marginBottom: 4 },
  factValue: { fontSize: 15, fontWeight: 700, color: NAVY },
  empty: { textAlign: 'center' as const, color: '#94A3B8', fontSize: 13, padding: 24 },
  err: { display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderRadius: 8, background: '#FEE2E2', color: '#991B1B', fontSize: 13 },
  loading: { padding: 48, textAlign: 'center' as const, color: '#94A3B8' },
  rowCard: { background: '#F8FAFC', borderRadius: 10, padding: 14, border: '1px solid #E2E8F0', marginBottom: 8 },
  rowTitle: { fontWeight: 700, color: NAVY, marginBottom: 4, fontSize: 15 },
  rowMeta: { fontSize: 13, color: '#475569' },
  photosGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 },
  photoTile: { aspectRatio: '4/3', borderRadius: 8, background: '#F1F5F9', overflow: 'hidden' },
  photoImg: { width: '100%', height: '100%', objectFit: 'cover' as const, display: 'block' },
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((new Date(iso).getTime() - Date.now()) / 86400_000);
}

export default function BoatDetail() {
  const { id } = useParams<{ id: string }>();
  const { getToken } = useAuth();
  const [data, setData] = useState<BoatPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        const res = await fetch(`/api/portal/boats/${id}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) {
          if (res.status === 404) throw new Error('Boat not found');
          throw new Error(`Failed to load (${res.status})`);
        }
        const body = (await res.json()) as BoatPayload;
        if (!cancelled) setData(body);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [id, getToken]);

  return (
    <div style={styles.page}>
      <Link to="/boats" style={styles.back}>
        <ArrowLeft size={14} /> Back to all boats
      </Link>

      {err ? (
        <div style={styles.err}><AlertCircle size={16} /> {err}</div>
      ) : !data ? (
        <div style={styles.loading}><Loader2 size={20} /></div>
      ) : (
        <>
          <h1 style={styles.title}>
            {data.boat.name ?? 'Unnamed boat'}
          </h1>
          <div style={styles.subtitle}>
            {[data.boat.year, data.boat.make, data.boat.model].filter(Boolean).join(' ') || '—'}
            {data.boat.lengthFt ? ` · ${data.boat.lengthFt} ft` : ''}
            {data.boat.registrationNumber ? ` · Reg ${data.boat.registrationNumber}` : ''}
          </div>
          <hr style={styles.divider} />

          {/* Specs */}
          <div style={styles.card}>
            <div style={styles.cardHead}>
              <div style={styles.cardIcon}><Ship size={18} /></div>
              <h2 style={styles.cardTitle}>Specs</h2>
            </div>
            <div style={styles.factGrid}>
              {data.boat.lengthFt && <div style={styles.fact}><div style={styles.factLabel}>Length</div><div style={styles.factValue}>{data.boat.lengthFt} ft</div></div>}
              {data.boat.beamFt && <div style={styles.fact}><div style={styles.factLabel}>Beam</div><div style={styles.factValue}>{data.boat.beamFt} ft</div></div>}
              {data.boat.draftFt && <div style={styles.fact}><div style={styles.factLabel}>Draft</div><div style={styles.factValue}>{data.boat.draftFt} ft</div></div>}
              {data.boat.fuelType && <div style={styles.fact}><div style={styles.factLabel}>Fuel</div><div style={styles.factValue}>{data.boat.fuelType}</div></div>}
              {data.boat.engineCount && <div style={styles.fact}><div style={styles.factLabel}>Engines</div><div style={styles.factValue}>{data.boat.engineCount} × {data.boat.engineHp ?? '—'} HP</div></div>}
              {data.boat.hin && <div style={styles.fact}><div style={styles.factLabel}>HIN</div><div style={{ ...styles.factValue, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13 }}>{data.boat.hin}</div></div>}
              {data.boat.registrationState && <div style={styles.fact}><div style={styles.factLabel}>Registration</div><div style={styles.factValue}>{data.boat.registrationState}{data.boat.registrationExpiry ? ` · exp ${formatDate(data.boat.registrationExpiry)}` : ''}</div></div>}
            </div>
          </div>

          {/* Slip */}
          <div style={styles.card}>
            <div style={styles.cardHead}>
              <div style={styles.cardIcon}><Anchor size={18} /></div>
              <h2 style={styles.cardTitle}>Where it lives</h2>
            </div>
            {data.activeContracts.length === 0 ? (
              <div style={styles.empty}>No active slip assignment.</div>
            ) : (
              data.activeContracts.map((c) => (
                <div key={c.contractId} style={styles.rowCard}>
                  <div style={styles.rowTitle}>Slip {c.slip?.number ?? '—'}</div>
                  <div style={styles.rowMeta}>
                    Since {formatDate(c.startDate)}{c.endDate ? ` · through ${formatDate(c.endDate)}` : ''}
                  </div>
                  {c.slip?.location && (
                    <div style={{ marginTop: 6, fontSize: 13, color: '#0A2342' }}>
                      <strong>{c.slip.location.name}</strong>
                      {c.slip.location.address && <span style={{ color: '#64748B' }}> · <MapPin size={11} style={{ verticalAlign: 'middle' }} /> {c.slip.location.address}</span>}
                      {c.slip.location.phone && <span style={{ color: '#64748B' }}> · <a href={`tel:${c.slip.location.phone}`} style={{ color: NAVY }}><Phone size={11} style={{ verticalAlign: 'middle' }} /> {c.slip.location.phone}</a></span>}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Insurance */}
          <div style={styles.card}>
            <div style={styles.cardHead}>
              <div style={styles.cardIcon}><Shield size={18} /></div>
              <h2 style={styles.cardTitle}>Insurance</h2>
            </div>
            {data.insurance.length === 0 ? (
              <div style={styles.empty}>
                No insurance on file. <Link to="/insurance" style={{ color: NAVY, fontWeight: 600 }}>Add a policy →</Link>
              </div>
            ) : (
              data.insurance.map((p) => {
                const daysLeft = daysUntil(p.endDate);
                const expiringSoon = daysLeft !== null && daysLeft >= 0 && daysLeft <= 30;
                const expired = daysLeft !== null && daysLeft < 0;
                return (
                  <div key={p.id} style={styles.rowCard}>
                    <div style={styles.rowTitle}>{p.insurer ?? 'Insurance policy'}</div>
                    <div style={styles.rowMeta}>
                      {p.policyNumber && <>Policy <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 }}>{p.policyNumber}</span> · </>}
                      {formatDate(p.startDate)} — {formatDate(p.endDate)}
                      {expired && <span style={{ marginLeft: 8, color: '#DC2626', fontWeight: 700 }}>EXPIRED</span>}
                      {expiringSoon && !expired && <span style={{ marginLeft: 8, color: '#B45309', fontWeight: 700 }}>EXPIRES IN {daysLeft}D</span>}
                    </div>
                    {p.documentUrl && (
                      <a href={p.documentUrl} target="_blank" rel="noopener noreferrer" style={{ color: NAVY, fontSize: 12, fontWeight: 600, marginTop: 6, display: 'inline-block' }}>
                        View document →
                      </a>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Photos */}
          <div style={styles.card}>
            <div style={styles.cardHead}>
              <div style={styles.cardIcon}><ImageIcon size={18} /></div>
              <h2 style={styles.cardTitle}>Photos</h2>
            </div>
            {data.photos.length === 0 ? (
              <div style={styles.empty}>No photos uploaded yet.</div>
            ) : (
              <div style={styles.photosGrid}>
                {data.photos.map((p) => (
                  <div key={p.id} style={styles.photoTile}>
                    {/* Photos go through the existing thumbnail-URL hook in
                        MyBoats; for MVP we just show the storage key path
                        and let the browser request it (works when R2 has
                        public read or signed URLs in front). */}
                    <img src={`/api/storage/file/${encodeURIComponent(p.storageKey)}`} alt={p.caption ?? 'Boat photo'} style={styles.photoImg} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
