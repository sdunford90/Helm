import { CSSProperties } from 'react';
import { User } from 'lucide-react';

const NAVY = '#0A2342';

const styles: Record<string, CSSProperties> = {
  page: { padding: 32 },
  title: { fontSize: 32, fontWeight: 700, color: NAVY, margin: 0, letterSpacing: '-0.02em' },
  subtitle: { fontSize: 14, color: '#64748B', marginTop: 6 },
  divider: { height: 4, background: 'linear-gradient(90deg, #00D4FF, transparent)', border: 'none', marginTop: 16, marginBottom: 24, borderRadius: 2 },
  card: { background: '#fff', border: '1px solid #E2E8F0', borderRadius: 10, padding: 32, textAlign: 'center', color: '#64748B' },
  cardIcon: { color: '#00D4FF', marginBottom: 12 },
  cardTitle: { fontSize: 18, fontWeight: 600, color: NAVY, marginBottom: 6 },
  cardBody: { fontSize: 14, lineHeight: 1.5 },
};

export default function AccountProfile() {
  return (
    <div style={styles.page}>
      <h1 style={styles.title}>Profile</h1>
      <div style={styles.subtitle}>Your name, contact details, and how the marina reaches you.</div>
      <hr style={styles.divider} />
      <div style={styles.card}>
        <User size={32} style={styles.cardIcon} />
        <div style={styles.cardTitle}>Profile editor coming soon</div>
        <div style={styles.cardBody}>
          You'll be able to update your name, phone number, and emergency contact from here.
          For now, contact your marina to make changes.
        </div>
      </div>
    </div>
  );
}
