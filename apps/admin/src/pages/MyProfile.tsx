import React from 'react';
import { useUser } from '@clerk/clerk-react';
import { useAdminMe, adminRoleLabel } from '../hooks/useAdminMe';

const DEV_BYPASS = import.meta.env.VITE_ENABLE_AUTH_DEV_BYPASS === 'true';

const page: React.CSSProperties = { padding: 0 };
const header: React.CSSProperties = { fontSize: 24, fontWeight: 700, color: '#FFFFFF', margin: 0, letterSpacing: '-0.01em' };
const subtitle: React.CSSProperties = { fontSize: 13, color: 'rgba(255,255,255,0.5)', marginTop: 6 };
const card: React.CSSProperties = {
  background: '#0D1B2A',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.06)',
  padding: 24,
  marginTop: 24,
};
const row: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '160px 1fr',
  gap: 12,
  padding: '12px 0',
  borderBottom: '1px solid rgba(255,255,255,0.04)',
  fontSize: 13,
};
const rowLabel: React.CSSProperties = { color: 'rgba(255,255,255,0.5)' };
const rowValue: React.CSSProperties = { color: '#FFFFFF' };
const placeholder: React.CSSProperties = {
  marginTop: 24,
  padding: 24,
  background: 'rgba(0,212,255,0.04)',
  border: '1px dashed rgba(0,212,255,0.3)',
  borderRadius: 8,
  color: 'rgba(255,255,255,0.6)',
  fontSize: 13,
  lineHeight: 1.6,
};

const MyProfile: React.FC = () => {
  const { user, isLoaded } = useUser();
  const { me } = useAdminMe();

  const first = user?.firstName ?? '';
  const last = user?.lastName ?? '';
  const fullName = `${first} ${last}`.trim() || user?.username || 'Platform Admin';
  const email = user?.primaryEmailAddress?.emailAddress ?? '';
  const roleLabel = me?.adminRole ? adminRoleLabel(me.adminRole) : null;

  return (
    <div style={page}>
      <h1 style={header}>My Profile</h1>
      <div style={subtitle}>Your account on the Helm admin console.</div>

      <div style={card}>
        {DEV_BYPASS ? (
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>
            Dev auth bypass is enabled — sign-in is mocked and there is no Clerk profile to show.
          </div>
        ) : !isLoaded ? (
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>Loading profile…</div>
        ) : (
          <>
            <div style={row}><span style={rowLabel}>Name</span><span style={rowValue}>{fullName}</span></div>
            <div style={row}><span style={rowLabel}>Email</span><span style={rowValue}>{email || '—'}</span></div>
            <div style={row}><span style={rowLabel}>Admin role</span><span style={rowValue}>{roleLabel ?? '—'}</span></div>
            <div style={{ ...row, borderBottom: 'none' }}><span style={rowLabel}>User ID</span><span style={{ ...rowValue, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 }}>{user?.id ?? '—'}</span></div>
          </>
        )}
      </div>

      <div style={placeholder}>
        Profile editing (name, avatar) and security controls (password, 2FA, active sessions) will land here.
        For now, manage your sign-in details directly in Clerk.
      </div>
    </div>
  );
};

export default MyProfile;
