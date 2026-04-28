import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ClerkProvider, RedirectToSignIn, SignedIn, SignedOut } from '@clerk/clerk-react';
import App from './App';
import { ClerkAuthBridge, NoAuthBridge } from './lib/api';
import PlatformAdminGate from './components/PlatformAdminGate';

const CLERK_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || '';
const DEV_BYPASS = import.meta.env.VITE_ENABLE_AUTH_DEV_BYPASS === 'true';

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, message: error?.message || 'Unknown error' };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', minHeight: '100vh',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          background: '#070E18', color: '#FFF', gap: 16, padding: 32,
        }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#00D4FF', letterSpacing: 3 }}>HELM</div>
          <div style={{
            background: '#0D1B2A', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12,
            padding: '32px 40px', maxWidth: 480, textAlign: 'center',
          }}>
            <h2 style={{ marginBottom: 12, fontSize: 18, color: '#FFF' }}>Something went wrong</h2>
            <p style={{ color: 'rgba(255,255,255,0.6)', lineHeight: 1.6, marginBottom: 16, fontSize: 13 }}>
              An unexpected error occurred. Please refresh the page to try again.
            </p>
            <button
              onClick={() => window.location.reload()}
              style={{
                background: '#00D4FF', color: '#0A2342', border: 'none',
                borderRadius: 6, padding: '9px 20px', cursor: 'pointer',
                fontWeight: 700, fontSize: 13,
              }}
            >
              Refresh
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const MissingKeyScreen: React.FC = () => (
  <div style={{
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', minHeight: '100vh',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    background: '#070E18', color: '#FFF', gap: 16, padding: 32,
  }}>
    <div style={{ fontSize: 28, fontWeight: 800, color: '#00D4FF', letterSpacing: 3 }}>HELM</div>
    <div style={{
      background: '#0D1B2A', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12,
      padding: '32px 40px', maxWidth: 480, textAlign: 'center',
    }}>
      <h2 style={{ marginBottom: 12, fontSize: 18, color: '#FFF' }}>Authentication Setup Required</h2>
      <p style={{ color: 'rgba(255,255,255,0.6)', lineHeight: 1.6, marginBottom: 16, fontSize: 13 }}>
        The admin console uses Clerk for authentication. Set the
        environment variable <code style={{ background: 'rgba(0,212,255,0.1)', color: '#00D4FF', padding: '2px 6px', borderRadius: 4 }}>VITE_CLERK_PUBLISHABLE_KEY</code> to get started.
      </p>
      <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>
        Or set <code style={{ background: 'rgba(0,212,255,0.1)', color: '#00D4FF', padding: '2px 6px', borderRadius: 4 }}>VITE_ENABLE_AUTH_DEV_BYPASS=true</code> for local development.
      </p>
    </div>
  </div>
);

const root = ReactDOM.createRoot(document.getElementById('root')!);

if (DEV_BYPASS) {
  // Local-development escape hatch: skip the Clerk gate entirely so
  // contributors can work on the admin SPA without a Clerk dev tenant.
  // The API-side `ENABLE_AUTH_DEV_BYPASS` mirrors this for backend auth.
  root.render(
    <React.StrictMode>
      <ErrorBoundary>
        <NoAuthBridge>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </NoAuthBridge>
      </ErrorBoundary>
    </React.StrictMode>,
  );
} else if (!CLERK_KEY) {
  root.render(<MissingKeyScreen />);
} else {
  root.render(
    <React.StrictMode>
      <ErrorBoundary>
        <ClerkProvider publishableKey={CLERK_KEY}>
          <SignedOut>
            <RedirectToSignIn />
          </SignedOut>
          <SignedIn>
            <ClerkAuthBridge>
              <PlatformAdminGate>
                <BrowserRouter>
                  <App />
                </BrowserRouter>
              </PlatformAdminGate>
            </ClerkAuthBridge>
          </SignedIn>
        </ClerkProvider>
      </ErrorBoundary>
    </React.StrictMode>,
  );
}
