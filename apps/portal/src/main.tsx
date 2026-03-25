import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ClerkProvider } from '@clerk/clerk-react';
import App from './App';

const CLERK_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || '';

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'Inter, sans-serif', backgroundColor: '#F7F9FB', color: '#0A2342', gap: 16, padding: 32 }}>
          <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: '0.08em' }}>HELM PORTAL</div>
          <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, padding: '32px 40px', maxWidth: 480, textAlign: 'center' }}>
            <h2 style={{ marginBottom: 12, fontSize: 20 }}>Something went wrong</h2>
            <p style={{ color: '#2E4A6B', lineHeight: 1.6, marginBottom: 16 }}>Please refresh the page to try again.</p>
            <button onClick={() => window.location.reload()} style={{ background: '#0A2342', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 24px', cursor: 'pointer', fontWeight: 600 }}>Refresh</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const MissingKeyScreen = () => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'Inter, sans-serif', backgroundColor: '#F7F9FB', color: '#0A2342', gap: 16, padding: 32 }}>
    <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: '0.08em' }}>HELM PORTAL</div>
    <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, padding: '32px 40px', maxWidth: 480, textAlign: 'center' }}>
      <h2 style={{ marginBottom: 12, fontSize: 20 }}>Authentication Setup Required</h2>
      <p style={{ color: '#2E4A6B', lineHeight: 1.6 }}>
        Add <code style={{ background: '#F0F4F8', padding: '2px 6px', borderRadius: 4 }}>VITE_CLERK_PUBLISHABLE_KEY</code> to your environment variables.
      </p>
    </div>
  </div>
);

if (!CLERK_KEY) {
  ReactDOM.createRoot(document.getElementById('root')!).render(<MissingKeyScreen />);
} else {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ErrorBoundary>
        <ClerkProvider publishableKey={CLERK_KEY}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </ClerkProvider>
      </ErrorBoundary>
    </React.StrictMode>,
  );
}
