import React from 'react';
import { Link } from 'react-router-dom';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Error boundary for a single page. AppLayout renders one around <Outlet/>,
 * keyed by pathname, so a crash on one page shows an error card inside the
 * layout (sidebar and navigation keep working) and navigating away resets it.
 */
export default class PageErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // TODO: report to Sentry once it is wired up.
    console.error('[helm] page crashed:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" style={{ display: 'flex', justifyContent: 'center', padding: '48px 16px' }}>
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
          <h2 style={{ fontSize: 20, color: '#0A2342', marginBottom: 12 }}>This page hit an error</h2>
          <p style={{ color: '#2E4A6B', lineHeight: 1.6, marginBottom: 8 }}>
            Something on this page failed to render. The rest of Helm still works.
          </p>
          <p style={{ color: '#64748B', fontSize: 13, marginBottom: 20, wordBreak: 'break-word' }}>
            {this.state.error.message}
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
            <button
              onClick={() => this.setState({ error: null })}
              style={{ background: '#0A2342', color: '#FFFFFF', border: 'none', borderRadius: 8, padding: '10px 20px', cursor: 'pointer', fontWeight: 600 }}
            >
              Try again
            </button>
            <Link
              to="/"
              onClick={() => this.setState({ error: null })}
              style={{ border: '1px solid #CBD5E1', color: '#0A2342', borderRadius: 8, padding: '10px 20px', textDecoration: 'none', fontWeight: 600 }}
            >
              Go to Dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }
}
