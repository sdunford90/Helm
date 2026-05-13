import React, { useEffect, useState } from 'react';
import { useApiFetch } from '../lib/api';

// Plan 11 — Surfaces accounting-completeness gaps on the admin Tenant
// Detail page so a platform admin sees "must-fix before go-live" gaps at
// a glance. Calls /api/admin/tenants/:id/accounting-completeness; renders
// a compact list, color-coded by severity.

interface Gap {
  kind: string;
  label: string;
  detail: string;
  locationName: string;
  severity: 'ERROR' | 'WARNING';
}
interface ApiResponse {
  summary: { totalLocations: number; totalGaps: number; errors: number; warnings: number };
  gaps: Gap[];
}

const cardStyle: React.CSSProperties = {
  background: '#0D1B2A',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.06)',
  padding: 16,
};

const sectionLabel: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: 'rgba(255,255,255,0.4)',
  textTransform: 'uppercase',
  letterSpacing: 1,
  marginBottom: 10,
};

export default function AccountingHealthPanel({ tenantId }: { tenantId: string }) {
  const api = useApiFetch();
  const [data, setData] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<ApiResponse>(`/api/admin/tenants/${tenantId}/accounting-completeness`)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [api, tenantId]);

  if (error) return null; // best-effort — don't block the overview
  if (!data) return null;

  const { summary, gaps } = data;
  const allClear = summary.totalGaps === 0;
  const headlineColor = summary.errors > 0 ? '#F44336' : summary.warnings > 0 ? '#FF9800' : '#4CAF50';

  return (
    <div style={cardStyle}>
      <div style={sectionLabel}>Accounting health</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 10 }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: headlineColor }}>
          {allClear ? 'All clear' : `${summary.errors} error${summary.errors === 1 ? '' : 's'}, ${summary.warnings} warning${summary.warnings === 1 ? '' : 's'}`}
        </div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>
          across {summary.totalLocations} location{summary.totalLocations === 1 ? '' : 's'}
        </div>
      </div>

      {allClear ? (
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)' }}>
          Every required GL slot is pinned. Postings will land in the configured accounts.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflowY: 'auto' }}>
          {gaps.slice(0, 12).map((g, idx) => (
            <div key={idx} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 12 }}>
              <span style={{
                padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 700,
                background: g.severity === 'ERROR' ? 'rgba(244,67,54,0.2)' : 'rgba(255,152,0,0.2)',
                color: g.severity === 'ERROR' ? '#F44336' : '#FF9800',
              }}>
                {g.severity}
              </span>
              <span style={{ color: '#FFF', fontWeight: 500 }}>{g.label}</span>
              <span style={{ color: 'rgba(255,255,255,0.45)' }}>at {g.locationName}</span>
            </div>
          ))}
          {gaps.length > 12 && (
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
              + {gaps.length - 12} more.
            </div>
          )}
        </div>
      )}

      <div style={{ marginTop: 12, fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
        Errors block postings on QBO-connected locations; warnings fall back to the default revenue account.
      </div>
    </div>
  );
}
