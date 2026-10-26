import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ClerkProvider, RedirectToSignIn, SignedIn, SignedOut, useAuth } from '@clerk/clerk-react';
import App from './App';
import { setTokenGetter } from './lib/api';
// Shared design tokens, reset and the helm-* responsive classes.
import '../../../packages/ui-kit/src/styles/global.css';

const CLERK_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || '';

/** Hands Clerk's session token to the admin API client. */
function AuthTokenBridge({ children }: { children: React.ReactNode }) {
  const { getToken } = useAuth();
  // Registered during render (not in an effect) so it is in place before the
  // pages' own effects fire their first requests. Idempotent, so safe to repeat.
  setTokenGetter(() => getToken());
  return <>{children}</>;
}

const MissingKeyScreen = () => (
  <div style={{
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    minHeight: '100vh', fontFamily: 'system-ui, -apple-system, sans-serif', background: '#070E18', color: '#FFF', gap: 16, padding: 32,
  }}>
    <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: 3, color: '#00D4FF' }}>HELM</div>
    <div style={{ background: '#0D1B2A', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '28px 36px', maxWidth: 480, textAlign: 'center' }}>
      <h2 style={{ marginBottom: 12, fontSize: 18 }}>Authentication Setup Required</h2>
      <p style={{ color: 'rgba(255,255,255,0.6)', lineHeight: 1.6, fontSize: 14 }}>
        The admin console uses Clerk for sign-in. Set <code>VITE_CLERK_PUBLISHABLE_KEY</code> to get started.
      </p>
    </div>
  </div>
);

const root = ReactDOM.createRoot(document.getElementById('root')!);

if (!CLERK_KEY) {
  root.render(<MissingKeyScreen />);
} else {
  root.render(
    <React.StrictMode>
      <ClerkProvider publishableKey={CLERK_KEY}>
        <AuthTokenBridge>
          <SignedIn>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </SignedIn>
          <SignedOut>
            <RedirectToSignIn />
          </SignedOut>
        </AuthTokenBridge>
      </ClerkProvider>
    </React.StrictMode>,
  );
}
