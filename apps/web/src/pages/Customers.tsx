import { Users } from 'lucide-react';

const styles: Record<string, React.CSSProperties> = {
  page: { padding: '32px' },
  title: {
    fontSize: '36px',
    fontWeight: 700,
    color: '#0A2342',
    letterSpacing: '-0.02em',
    margin: 0,
  },
  divider: {
    height: '4px',
    background: 'linear-gradient(90deg, #00D4FF, transparent)',
    border: 'none',
    marginTop: '12px',
    marginBottom: '40px',
    borderRadius: '2px',
  },
  card: {
    maxWidth: '480px',
    margin: '0 auto',
    textAlign: 'center' as const,
    padding: '48px 32px',
    background: '#FFFFFF',
    borderRadius: '12px',
    border: '1px solid #E2E8F0',
    boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
  },
  icon: { marginBottom: '16px', color: '#2E4A6B' },
  headline: {
    fontSize: '20px',
    fontWeight: 600,
    color: '#0A2342',
    margin: '0 0 8px 0',
  },
  body: {
    fontSize: '15px',
    color: '#64748B',
    lineHeight: 1.6,
    margin: '0 0 24px 0',
  },
  button: {
    display: 'inline-block',
    padding: '10px 24px',
    fontSize: '15px',
    fontWeight: 600,
    color: '#FFFFFF',
    backgroundColor: '#0A2342',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
  },
};

export default function Customers() {
  return (
    <div style={styles.page}>
      <h1 style={styles.title}>Customers</h1>
      <hr style={styles.divider} />
      <div style={styles.card}>
        <div style={styles.icon}>
          <Users size={32} />
        </div>
        <h3 style={styles.headline}>No customers yet</h3>
        <p style={styles.body}>
          Add your first customer or import from your previous system.
        </p>
        <button style={styles.button}>Add Customer</button>
      </div>
    </div>
  );
}
