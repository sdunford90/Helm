import { useEffect, useState } from 'react';
import { Ship, CheckCircle, AlertTriangle, Edit, Anchor } from 'lucide-react';
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
            </div>
          );
        })}
      </div>
    </div>
  );
}
