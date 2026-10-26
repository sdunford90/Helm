import { Link, useLocation } from 'react-router-dom';

export default function NotFound() {
  const location = useLocation();
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '48px 16px' }}>
      <div
        style={{
          background: '#FFFFFF',
          border: '1px solid #E2E8F0',
          borderRadius: 12,
          padding: '32px 40px',
          maxWidth: 520,
          width: '100%',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 40, fontWeight: 700, color: '#0A2342', fontFamily: 'monospace' }}>404</div>
        <h2 style={{ fontSize: 20, color: '#0A2342', margin: '8px 0 12px' }}>Page not found</h2>
        <p style={{ color: '#2E4A6B', lineHeight: 1.6, marginBottom: 20, wordBreak: 'break-word' }}>
          There is no page at <code style={{ background: '#F1F5F9', padding: '2px 6px', borderRadius: 4 }}>{location.pathname}</code>.
        </p>
        <Link
          to="/"
          style={{ background: '#0A2342', color: '#FFFFFF', borderRadius: 8, padding: '10px 20px', textDecoration: 'none', fontWeight: 600 }}
        >
          Go to Dashboard
        </Link>
      </div>
    </div>
  );
}
