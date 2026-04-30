import React from 'react';

interface State {
  error: Error | null;
}

/** Top-level error boundary so an unhandled render error doesn't blank the
 *  entire window — which is what was happening when the last tab in a
 *  session was closed. Clicking the bug-report area copies the stack so
 *  we can debug it. */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Log so it's visible in the dev console too.
    // eslint-disable-next-line no-console
    console.error('Marko render error:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="errorboundary">
        <div className="errorboundary-card">
          <div className="errorboundary-title">Something went wrong</div>
          <div className="errorboundary-msg">{this.state.error.message}</div>
          <pre className="errorboundary-stack">{this.state.error.stack}</pre>
          <div className="errorboundary-actions">
            <button
              className="errorboundary-btn"
              onClick={() => this.setState({ error: null })}
            >
              Try again
            </button>
            <button
              className="errorboundary-btn"
              onClick={() => window.location.reload()}
            >
              Reload window
            </button>
          </div>
        </div>
      </div>
    );
  }
}
