import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

/**
 * ErrorBoundary — catches React component tree errors and shows a recovery UI.
 *
 * Usage:
 *   <ErrorBoundary>
 *     <SomePage />
 *   </ErrorBoundary>
 */
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    // Log to console during development so the error is still visible.
    console.error('[ErrorBoundary] Uncaught error:', error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const isDev = import.meta.env.DEV;

    return (
      <div className="flex flex-col items-center justify-center min-h-[300px] p-8 rounded-xl border border-rose-900/40 bg-rose-950/20 text-center">
        <div className="w-10 h-10 rounded-full bg-rose-950 border border-rose-800 flex items-center justify-center mb-4">
          <AlertTriangle size={20} className="text-rose-400" />
        </div>

        <h2 className="text-sm font-bold font-mono text-zinc-100 mb-1">
          Something went wrong
        </h2>
        <p className="text-xs text-zinc-400 font-sans mb-4 max-w-sm">
          This section encountered an unexpected error. You can try refreshing, or navigate to a different page.
        </p>

        {isDev && this.state.error && (
          <pre className="mb-4 text-left text-[11px] font-mono text-rose-300 bg-zinc-950 border border-zinc-800 rounded-lg p-3 max-w-xl w-full overflow-x-auto whitespace-pre-wrap break-all">
            {this.state.error.toString()}
          </pre>
        )}

        <button
          onClick={this.handleReset}
          className="flex items-center gap-2 px-4 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-mono border border-zinc-700 transition-colors"
        >
          <RefreshCw size={13} />
          Try again
        </button>
      </div>
    );
  }
}
