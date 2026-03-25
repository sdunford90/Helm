import { Clock, Users, MapPin, ChevronRight, AlertCircle, CheckCircle, Settings, XCircle } from 'lucide-react';
import type { CSSProperties } from 'react';

const NAVY = '#0A2342';
const CYAN = '#00D4FF';

const card: CSSProperties = {
  background: '#fff',
  borderRadius: 12,
  padding: 24,
  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
};

const waitlistEntry = {
  position: 3,
  slipType: '40ft Covered Slip',
  joinedDate: '2025-08-15',
  estimatedWait: '3-6 months',
  requirements: [
    { label: 'Insurance on file', met: true },
    { label: 'Registration current', met: true },
    { label: 'Deposit paid ($500)', met: true },
    { label: 'Vessel inspection scheduled', met: false },
  ],
  preferences: {
    location: 'C-Dock or D-Dock',
    electrical: '50 Amp',
    water: 'Yes',
    maxBudget: '$1,500/mo',
  },
};

export default function WaitlistStatus() {
  const isOnWaitlist = true;

  if (!isOnWaitlist) {
    return (
      <div>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: NAVY, marginBottom: 4 }}>Waitlist</h1>
          <p style={{ color: '#64748B', fontSize: 14 }}>You are not currently on any waitlist.</p>
        </div>
        <div style={{ ...card, textAlign: 'center', padding: 48 }}>
          <Users size={48} color="#94A3B8" style={{ marginBottom: 16 }} />
          <h2 style={{ fontSize: 20, fontWeight: 600, color: NAVY, marginBottom: 8 }}>Join the Waitlist</h2>
          <p style={{ color: '#64748B', fontSize: 14, maxWidth: 400, margin: '0 auto 20px' }}>
            Interested in a slip at Bayview Marina? Join our waitlist and we'll notify you when a spot becomes available.
          </p>
          <button
            style={{
              padding: '12px 32px',
              borderRadius: 8,
              border: 'none',
              background: CYAN,
              color: NAVY,
              fontSize: 15,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Join Waitlist
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: NAVY, marginBottom: 4 }}>Waitlist Status</h1>
        <p style={{ color: '#64748B', fontSize: 14 }}>Track your position and requirements for your waitlisted slip.</p>
      </div>

      {/* Position Card */}
      <div
        style={{
          ...card,
          marginBottom: 24,
          background: `linear-gradient(135deg, ${NAVY} 0%, #0F3460 100%)`,
          color: '#fff',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 13, color: '#A0AEC0', fontWeight: 500, marginBottom: 8 }}>Your Position</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 56, fontWeight: 800, color: CYAN, lineHeight: 1 }}>#{waitlistEntry.position}</span>
              <span style={{ fontSize: 16, color: '#A0AEC0' }}>in queue</span>
            </div>
            <div style={{ fontSize: 15, marginTop: 8 }}>
              for <strong>{waitlistEntry.slipType}</strong>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <Clock size={16} color="#A0AEC0" />
              <div>
                <div style={{ fontSize: 12, color: '#A0AEC0' }}>Estimated Wait</div>
                <div style={{ fontSize: 16, fontWeight: 600 }}>{waitlistEntry.estimatedWait}</div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <MapPin size={16} color="#A0AEC0" />
              <div>
                <div style={{ fontSize: 12, color: '#A0AEC0' }}>Joined</div>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{waitlistEntry.joinedDate}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
        {/* Requirements */}
        <div style={card}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: NAVY, marginBottom: 16 }}>Requirements</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {waitlistEntry.requirements.map((req, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {req.met ? (
                  <CheckCircle size={18} color="#0D9F6E" />
                ) : (
                  <AlertCircle size={18} color="#D97706" />
                )}
                <span
                  style={{
                    fontSize: 14,
                    color: req.met ? '#334155' : '#D97706',
                    fontWeight: req.met ? 400 : 500,
                  }}
                >
                  {req.label}
                </span>
              </div>
            ))}
          </div>
          <div
            style={{
              marginTop: 16,
              padding: 12,
              background: '#FFF8E6',
              borderRadius: 8,
              fontSize: 13,
              color: '#92400E',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <AlertCircle size={16} />
            Complete all requirements to maintain your position.
          </div>
        </div>

        {/* Preferences */}
        <div style={card}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: NAVY, marginBottom: 16 }}>Your Preferences</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {Object.entries(waitlistEntry.preferences).map(([key, value]) => (
              <div key={key} style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, color: '#64748B', textTransform: 'capitalize' }}>
                  {key.replace(/([A-Z])/g, ' $1').trim()}
                </span>
                <span style={{ fontSize: 14, fontWeight: 600, color: NAVY }}>{value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 12 }}>
        <button
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 20px',
            borderRadius: 8,
            border: '1px solid #E2E8F0',
            background: '#fff',
            color: NAVY,
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          <Settings size={16} /> Update Preferences
        </button>
        <button
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 20px',
            borderRadius: 8,
            border: '1px solid #FCA5A5',
            background: '#fff',
            color: '#DC2626',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          <XCircle size={16} /> Remove from Waitlist
        </button>
      </div>
    </div>
  );
}
