import { CSSProperties, useEffect, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { Anchor, MapPin, Phone, Ship, Zap, Ruler, AlertCircle, Loader2 } from 'lucide-react';

const NAVY = '#0A2342';

interface SlipInfo {
  contractId: string;
  startDate: string;
  endDate: string | null;
  slip: {
    id: string;
    number: string;
    lengthFt: number;
    beamFt: number | null;
    shorePower: string | null;
    dock: string | null;
    location: { name: string; address: string | null; phone: string | null } | null;
  } | null;
  boat: { name: string | null; registrationNumber: string | null } | null;
}

const styles: Record<string, CSSProperties> = {
  page: { padding: 32, maxWidth: 920 },
  title: { fontSize: 32, fontWeight: 700, color: NAVY, margin: 0, letterSpacing: '-0.02em' },
  subtitle: { fontSize: 14, color: '#64748B', marginTop: 6 },
  divider: { height: 4, background: 'linear-gradient(90deg, #00D4FF, transparent)', border: 'none', marginTop: 16, marginBottom: 24, borderRadius: 2 },
  slipCard: { background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.04)', padding: 28, marginBottom: 18 },
  slipHeader: { display: 'flex', alignItems: 'center', gap: 16, marginBottom: 18 },
  slipBadge: { width: 56, height: 56, borderRadius: 14, background: NAVY, color: '#00D4FF', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  slipNumber: { fontSize: 28, fontWeight: 800, color: NAVY, margin: 0, letterSpacing: '-0.01em' },
  dockLine: { fontSize: 14, color: '#64748B', marginTop: 2 },
  factGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 18 },
  fact: { background: '#F8FAFC', borderRadius: 8, padding: '12px 14px', border: '1px solid #E2E8F0' },
  factLabel: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase' as const, letterSpacing: '0.04em', marginBottom: 4 },
  factValue: { fontSize: 16, fontWeight: 700, color: NAVY, fontVariantNumeric: 'tabular-nums' as const },
  locBlock: { borderTop: '1px solid #F1F5F9', paddingTop: 16, marginTop: 4, display: 'flex', flexDirection: 'column' as const, gap: 6, color: NAVY, fontSize: 14 },
  locName: { fontWeight: 700, fontSize: 15 },
  locLine: { display: 'flex', alignItems: 'center', gap: 8, color: '#475569' },
  empty: { background: '#FFFFFF', border: '1px dashed #CBD5E1', borderRadius: 12, padding: 40, textAlign: 'center' as const, color: '#64748B' },
  emptyIcon: { color: '#00D4FF', marginBottom: 12 },
  emptyTitle: { fontSize: 18, fontWeight: 700, color: NAVY, marginBottom: 6 },
  err: { display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderRadius: 8, background: '#FEE2E2', color: '#991B1B', fontSize: 13 },
  loading: { padding: 48, textAlign: 'center' as const, color: '#94A3B8' },
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function MySlip() {
  const { getToken } = useAuth();
  const [slips, setSlips] = useState<SlipInfo[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        const res = await fetch('/api/portal/my-slip', {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error(`Failed to load (${res.status})`);
        const body = (await res.json()) as { slips: SlipInfo[] };
        if (!cancelled) setSlips(body.slips ?? []);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [getToken]);

  return (
    <div style={styles.page}>
      <h1 style={styles.title}>My Slip</h1>
      <div style={styles.subtitle}>
        Where your boat lives at the marina. Read-only — contact the dockmaster
        if anything looks wrong.
      </div>
      <hr style={styles.divider} />

      {err ? (
        <div style={styles.err}><AlertCircle size={16} /> {err}</div>
      ) : slips === null ? (
        <div style={styles.loading}><Loader2 size={20} /></div>
      ) : slips.length === 0 ? (
        <div style={styles.empty}>
          <Anchor size={32} style={styles.emptyIcon} />
          <div style={styles.emptyTitle}>No active slip assignments</div>
          <div>
            You don&apos;t have an active dockage contract right now. If you think
            this is wrong, reach out to the marina office.
          </div>
        </div>
      ) : (
        slips.map((s) => (
          <div key={s.contractId} style={styles.slipCard}>
            <div style={styles.slipHeader}>
              <div style={styles.slipBadge}>
                <Anchor size={28} />
              </div>
              <div>
                <h2 style={styles.slipNumber}>Slip {s.slip?.number ?? '—'}</h2>
                <div style={styles.dockLine}>
                  {s.slip?.dock ? `${s.slip.dock} · ` : ''}
                  Contract since {formatDate(s.startDate)}
                  {s.endDate && ` · through ${formatDate(s.endDate)}`}
                </div>
              </div>
            </div>

            <div style={styles.factGrid}>
              <div style={styles.fact}>
                <div style={styles.factLabel}><Ruler size={12} /> Length</div>
                <div style={styles.factValue}>{s.slip?.lengthFt ?? '—'} ft</div>
              </div>
              {s.slip?.beamFt && (
                <div style={styles.fact}>
                  <div style={styles.factLabel}><Ruler size={12} /> Beam</div>
                  <div style={styles.factValue}>{s.slip.beamFt} ft</div>
                </div>
              )}
              {s.slip?.shorePower && (
                <div style={styles.fact}>
                  <div style={styles.factLabel}><Zap size={12} /> Shore Power</div>
                  <div style={styles.factValue}>{s.slip.shorePower}</div>
                </div>
              )}
              {s.boat?.name && (
                <div style={styles.fact}>
                  <div style={styles.factLabel}><Ship size={12} /> Boat</div>
                  <div style={styles.factValue}>{s.boat.name}</div>
                </div>
              )}
            </div>

            {s.slip?.location && (
              <div style={styles.locBlock}>
                <div style={styles.locName}>{s.slip.location.name}</div>
                {s.slip.location.address && (
                  <div style={styles.locLine}>
                    <MapPin size={14} /> {s.slip.location.address}
                  </div>
                )}
                {s.slip.location.phone && (
                  <div style={styles.locLine}>
                    <Phone size={14} /> <a href={`tel:${s.slip.location.phone}`} style={{ color: '#0A2342' }}>{s.slip.location.phone}</a>
                  </div>
                )}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
