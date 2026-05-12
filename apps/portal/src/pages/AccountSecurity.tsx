import { CSSProperties } from 'react';
import { UserProfile } from '@clerk/clerk-react';
import { Shield } from 'lucide-react';

const NAVY = '#0A2342';

const styles: Record<string, CSSProperties> = {
  page: { padding: 32, maxWidth: 980 },
  title: { fontSize: 32, fontWeight: 700, color: NAVY, margin: 0, letterSpacing: '-0.02em' },
  subtitle: { fontSize: 14, color: '#64748B', marginTop: 6, maxWidth: 720 },
  divider: { height: 4, background: 'linear-gradient(90deg, #00D4FF, transparent)', border: 'none', marginTop: 16, marginBottom: 24, borderRadius: 2 },
  shell: { display: 'flex', justifyContent: 'flex-start' },
  fallback: {
    background: '#FFFFFF', border: '1px dashed #CBD5E1', borderRadius: 10,
    padding: 32, textAlign: 'center', color: '#64748B',
  },
  fallbackIcon: { color: '#00D4FF', marginBottom: 12 },
  fallbackTitle: { fontSize: 18, fontWeight: 700, color: NAVY, marginBottom: 6 },
};

export default function AccountSecurity() {
  return (
    <div style={styles.page}>
      <h1 style={styles.title}>Security</h1>
      <div style={styles.subtitle}>
        Update your password, turn on two-factor authentication, and see where you&apos;re signed in.
        Sign-in is handled by Clerk — these controls let you manage your account directly.
      </div>
      <hr style={styles.divider} />

      <div style={styles.shell}>
        <UserProfile
          routing="hash"
          appearance={{
            elements: {
              rootBox: { boxShadow: 'none' },
              card: { boxShadow: '0 1px 3px rgba(0,0,0,0.06)', border: '1px solid #E2E8F0' },
            },
          }}
        />
      </div>

      <noscript>
        <div style={styles.fallback}>
          <Shield size={32} style={styles.fallbackIcon} />
          <div style={styles.fallbackTitle}>JavaScript required</div>
          <div>Security controls need JavaScript to load. Re-enable it and refresh.</div>
        </div>
      </noscript>
    </div>
  );
}
