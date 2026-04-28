import React from 'react';
import { useAuth, useClerk, useUser } from '@clerk/clerk-react';

interface MeResponse {
  isPlatformAdmin: boolean;
  user: {
    id: string;
    email: string;
    role: string;
    firstName: string;
    lastName: string;
  } | null;
}

type GateState =
  | { status: 'loading' }
  | { status: 'allowed' }
  | { status: 'denied' }
  | { status: 'error'; message: string };

const screen: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: '100vh',
  fontFamily: 'system-ui, -apple-system, sans-serif',
  background: '#070E18',
  color: '#FFF',
  gap: 16,
  padding: 32,
};

const card: React.CSSProperties = {
  background: '#0D1B2A',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 12,
  padding: '32px 40px',
  maxWidth: 480,
  textAlign: 'center',
};

const logo: React.CSSProperties = {
  fontSize: 28,
  fontWeight: 800,
  color: '#00D4FF',
  letterSpacing: 3,
};

const primaryBtn: React.CSSProperties = {
  background: '#00D4FF',
  color: '#0A2342',
  border: 'none',
  borderRadius: 6,
  padding: '9px 20px',
  cursor: 'pointer',
  fontWeight: 700,
  fontSize: 13,
  fontFamily: 'inherit',
};

const secondaryBtn: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid rgba(255,255,255,0.15)',
  color: 'rgba(255,255,255,0.7)',
  borderRadius: 6,
  padding: '9px 20px',
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: 13,
  fontFamily: 'inherit',
  marginLeft: 8,
};

const LoadingScreen: React.FC = () => (
  <div style={screen}>
    <div style={logo}>HELM</div>
    <div style={{ ...card, color: 'rgba(255,255,255,0.6)', fontSize: 13 }}>
      Verifying access…
    </div>
  </div>
);

const NoAccessScreen: React.FC<{ email?: string }> = ({ email }) => {
  const clerk = useClerk();
  const handleSignOut = async () => {
    await clerk.signOut({ redirectUrl: '/' });
  };

  return (
    <div style={screen}>
      <div style={logo}>HELM</div>
      <div style={card}>
        <h2 style={{ marginBottom: 12, fontSize: 18, color: '#FFF' }}>
          You don't have access
        </h2>
        <p
          style={{
            color: 'rgba(255,255,255,0.6)',
            lineHeight: 1.6,
            marginBottom: 20,
            fontSize: 13,
          }}
        >
          {email ? (
            <>
              <strong style={{ color: '#FFF' }}>{email}</strong> isn't a Platform
              Admin. The HELM admin console is only available to platform staff.
            </>
          ) : (
            <>
              Your account isn't a Platform Admin. The HELM admin console is
              only available to platform staff.
            </>
          )}
        </p>
        <p
          style={{
            color: 'rgba(255,255,255,0.4)',
            lineHeight: 1.6,
            marginBottom: 24,
            fontSize: 12,
          }}
        >
          If you're a marina user, please use your marina's portal instead.
        </p>
        <button onClick={handleSignOut} style={primaryBtn}>
          Sign out
        </button>
      </div>
    </div>
  );
};

const ErrorScreen: React.FC<{ message: string; onRetry: () => void }> = ({
  message,
  onRetry,
}) => {
  const clerk = useClerk();
  const handleSignOut = async () => {
    await clerk.signOut({ redirectUrl: '/' });
  };

  return (
    <div style={screen}>
      <div style={logo}>HELM</div>
      <div style={card}>
        <h2 style={{ marginBottom: 12, fontSize: 18, color: '#FFF' }}>
          Couldn't verify access
        </h2>
        <p
          style={{
            color: 'rgba(255,255,255,0.6)',
            lineHeight: 1.6,
            marginBottom: 20,
            fontSize: 13,
          }}
        >
          {message}
        </p>
        <div>
          <button onClick={onRetry} style={primaryBtn}>
            Try again
          </button>
          <button onClick={handleSignOut} style={secondaryBtn}>
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
};

export const PlatformAdminGate: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { getToken, isLoaded: authLoaded } = useAuth();
  const { user, isLoaded: userLoaded } = useUser();
  const [state, setState] = React.useState<GateState>({ status: 'loading' });
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    if (!authLoaded) return;
    let cancelled = false;
    setState({ status: 'loading' });

    (async () => {
      try {
        const token = await getToken();
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetch('/api/admin/me', { headers });
        if (cancelled) return;

        if (!res.ok) {
          setState({
            status: 'error',
            message: `The server returned ${res.status} while checking your access.`,
          });
          return;
        }

        const data = (await res.json()) as MeResponse;
        if (cancelled) return;
        setState({ status: data.isPlatformAdmin ? 'allowed' : 'denied' });
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof Error ? err.message : 'Unknown network error';
        setState({ status: 'error', message });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authLoaded, getToken, attempt]);

  if (state.status === 'loading' || !authLoaded || !userLoaded) {
    return <LoadingScreen />;
  }

  if (state.status === 'error') {
    return (
      <ErrorScreen
        message={state.message}
        onRetry={() => setAttempt((n) => n + 1)}
      />
    );
  }

  if (state.status === 'denied') {
    return (
      <NoAccessScreen
        email={user?.primaryEmailAddress?.emailAddress ?? undefined}
      />
    );
  }

  return <>{children}</>;
};

export default PlatformAdminGate;
