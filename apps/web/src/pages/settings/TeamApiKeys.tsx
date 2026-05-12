import { CSSProperties } from 'react';
import { Key } from 'lucide-react';

const styles: Record<string, CSSProperties> = {
  card: { background: '#FFFFFF', border: '1px dashed #CBD5E1', borderRadius: 10, padding: 32, textAlign: 'center', color: '#64748B' },
  icon: { color: '#00D4FF', marginBottom: 12 },
  title: { fontSize: 18, fontWeight: 700, color: '#0A2342', marginBottom: 6 },
  body: { fontSize: 14, lineHeight: 1.55, maxWidth: 560, margin: '0 auto' },
};

export default function TeamApiKeys() {
  return (
    <div style={styles.card}>
      <Key size={32} style={styles.icon} />
      <div style={styles.title}>API Keys</div>
      <div style={styles.body}>
        Issue, rotate, and revoke API keys for programmatic access to your
        marina&apos;s data. Backed by the existing <code>ApiKey</code> model;
        UI lands next pass.
      </div>
    </div>
  );
}
