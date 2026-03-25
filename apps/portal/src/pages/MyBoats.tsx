import { Ship, CheckCircle, AlertTriangle, Edit, Anchor } from 'lucide-react';
import type { CSSProperties } from 'react';

const NAVY = '#0A2342';
const CYAN = '#00D4FF';

const card: CSSProperties = {
  background: '#fff',
  borderRadius: 12,
  padding: 24,
  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
};

const mockBoats = [
  {
    id: '1',
    name: 'Sea Breeze',
    make: 'Boston Whaler',
    model: 'Outrage 330',
    year: 2022,
    length: '33 ft',
    registration: 'FL-4821-MK',
    registrationExpiry: '2026-05-15',
    slip: 'C-12',
    compliance: 85,
    issues: ['Registration expiring soon'],
  },
  {
    id: '2',
    name: 'Knot Working',
    make: 'Sea Ray',
    model: 'Sundancer 320',
    year: 2019,
    length: '32 ft',
    registration: 'FL-7733-AB',
    registrationExpiry: '2027-01-20',
    slip: 'D-05',
    compliance: 100,
    issues: [],
  },
];

function complianceBadge(score: number): CSSProperties {
  const isGood = score >= 90;
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
  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: NAVY, marginBottom: 4 }}>My Boats</h1>
        <p style={{ color: '#64748B', fontSize: 14 }}>Manage your vessel information and compliance documents.</p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {mockBoats.map((boat) => (
          <div key={boat.id} style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ display: 'flex', gap: 20 }}>
                <div
                  style={{
                    width: 80,
                    height: 80,
                    borderRadius: 12,
                    background: '#EFF6FF',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Ship size={36} color={CYAN} />
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
                    <h2 style={{ fontSize: 20, fontWeight: 700, color: NAVY, margin: 0 }}>{boat.name}</h2>
                    <span style={complianceBadge(boat.compliance)}>
                      {boat.compliance >= 90 ? <CheckCircle size={14} /> : <AlertTriangle size={14} />}
                      {boat.compliance}% Compliant
                    </span>
                  </div>
                  <p style={{ color: '#64748B', fontSize: 14, margin: '2px 0' }}>
                    {boat.year} {boat.make} {boat.model}
                  </p>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, auto)', gap: '8px 32px', marginTop: 16 }}>
                    <div>
                      <div style={{ fontSize: 11, color: '#94A3B8', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Length
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: NAVY }}>{boat.length}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: '#94A3B8', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Registration
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: NAVY }}>{boat.registration}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: '#94A3B8', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Reg. Expiry
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: NAVY }}>{boat.registrationExpiry}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: '#94A3B8', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Assigned Slip
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: NAVY, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Anchor size={14} color={CYAN} /> {boat.slip}
                      </div>
                    </div>
                  </div>

                  {boat.issues.length > 0 && (
                    <div style={{ marginTop: 12 }}>
                      {boat.issues.map((issue, i) => (
                        <div
                          key={i}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            fontSize: 13,
                            color: '#D97706',
                          }}
                        >
                          <AlertTriangle size={14} /> {issue}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <button
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '8px 16px',
                  borderRadius: 8,
                  border: '1px solid #E2E8F0',
                  background: '#fff',
                  color: NAVY,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                <Edit size={14} /> Update Info
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
