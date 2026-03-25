import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ClerkProvider } from '@clerk/clerk-react';
import App from './App';

const CLERK_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || '';

class ErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode; fallback: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

const MissingKeyFallback = () => (
  <div style={{
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', minHeight: '100vh', fontFamily: 'Inter, sans-serif',
    backgroundColor: '#F7F9FB', color: '#0A2342', gap: 16, padding: 32,
  }}>
    <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: '0.08em' }}>HELM</div>
    <div style={{
      background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12,
      padding: '32px 40px', maxWidth: 480, textAlign: 'center',
    }}>
      <h2 style={{ marginBottom: 12, fontSize: 20 }}>Authentication Setup Required</h2>
      <p style={{ color: '#2E4A6B', lineHeight: 1.6, marginBottom: 16 }}>
        This app uses Clerk for authentication. Add your Clerk publishable key as the
        environment variable <code style={{ background: '#F0F4F8', padding: '2px 6px', borderRadius: 4 }}>VITE_CLERK_PUBLISHABLE_KEY</code> to get started.
      </p>
      <p style={{ color: '#6B7FA3', fontSize: 13 }}>
        Get your key at{' '}
        <a href="https://dashboard.clerk.com" target="_blank" rel="noreferrer" style={{ color: '#00D4FF' }}>
          dashboard.clerk.com
        </a>
      </p>
    </div>
  </div>
);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary fallback={<MissingKeyFallback />}>
      <ClerkProvider publishableKey={CLERK_KEY}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ClerkProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
