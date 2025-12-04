import { Component, type ReactNode, type ErrorInfo } from 'react';

interface ErrorBoundaryProps {
    children: ReactNode;
    fallback?: ReactNode;
    onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
    hasError: boolean;
    error: Error | null;
}

/**
 * Error boundary component for graceful error handling
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    constructor(props: ErrorBoundaryProps) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
        console.error('ErrorBoundary caught an error:', error, errorInfo);
        this.props.onError?.(error, errorInfo);
    }

    render(): ReactNode {
        if (this.state.hasError) {
            // Use custom fallback if provided
            if (this.props.fallback) {
                return this.props.fallback;
            }
            return (
                <div className="fixed inset-0 bg-[var(--lg-bg-base)] flex flex-col items-center justify-center p-6">
                    {/* Glass card container */}
                    <div className="max-w-[420px] text-center backdrop-blur-2xl saturate-[180%] rounded-2xl p-8 border border-white/10 light:border-black/5 shadow-[0_16px_48px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.1)]"
                        style={{
                            background: 'linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.03) 100%)'
                        }}
                    >
                        <h1 className="text-2xl font-medium mb-4 text-white/95 light:text-slate-900">
                            Something went wrong
                        </h1>
                        <p className="text-sm text-white/50 light:text-slate-500 leading-relaxed mb-6">
                            An unexpected error occurred while loading the application.
                        </p>
                        {this.state.error && (
                            <details className="text-left bg-white/5 light:bg-black/5 p-4 rounded-lg mb-6 border border-white/10 light:border-black/5">
                                <summary className="cursor-pointer text-white/40 light:text-slate-400 text-[10px] uppercase tracking-[0.1em] mb-2">
                                    Error Details
                                </summary>
                                <pre className="text-xs text-white/70 light:text-slate-600 whitespace-pre-wrap break-words m-0">
                                    {this.state.error.toString()}
                                </pre>
                            </details>
                        )}
                        <button
                            onClick={() => window.location.reload()}
                            className="px-6 py-3 rounded-xl font-medium text-sm tracking-wide cursor-pointer transition-all duration-200 min-h-11 backdrop-blur-sm border border-white/15 light:border-black/10 text-white/95 light:text-slate-900 hover:bg-white/15 light:hover:bg-black/10"
                            style={{
                                background: 'linear-gradient(135deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.06) 100%)',
                                boxShadow: '0 4px 16px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.15)'
                            }}
                        >
                            Reload Application
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

interface ComponentErrorFallbackProps {
    message?: string;
    onRetry?: () => void;
}

/**
 * Lightweight error fallback for use inside cards/tabs
 */
export function ComponentErrorFallback({
    message = 'Failed to load content',
    onRetry
}: ComponentErrorFallbackProps) {
    return (
        <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
            <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center mb-3">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-red-400">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="12"/>
                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
            </div>
            <p className="text-sm text-white/50 mb-3">{message}</p>
            {onRetry && (
                <button
                    onClick={onRetry}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white/10 hover:bg-white/15 text-white/80 transition-colors"
                >
                    Try again
                </button>
            )}
        </div>
    );
}

interface MapErrorFallbackProps {
    error?: string | null;
    onRetry?: () => void;
}

/**
 * Map-specific error fallback component
 */
export function MapErrorFallback({ error, onRetry }: MapErrorFallbackProps) {
    return (
        <div className="absolute inset-0 bg-[var(--lg-bg-base)] flex flex-col items-center justify-center">
            <div
                className="text-center max-w-[300px] backdrop-blur-xl saturate-[180%] border border-white/10 light:border-black/5 rounded-xl p-6 shadow-[0_8px_32px_rgba(0,0,0,0.25),inset_0_1px_0_rgba(255,255,255,0.08)]"
                style={{
                    background: 'linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%)'
                }}
            >
                <p className="text-sm text-white/50 light:text-slate-500 mb-4">
                    Unable to load map
                </p>
                {error && (
                    <p className="text-xs text-white/40 light:text-slate-400 mb-4">
                        {error}
                    </p>
                )}
                {onRetry && (
                    <button
                        onClick={onRetry}
                        className="px-4 py-2 rounded-lg text-xs font-medium cursor-pointer transition-all duration-200 min-h-9 backdrop-blur-sm border border-white/15 light:border-black/10 text-white/95 light:text-slate-900 hover:bg-white/15 light:hover:bg-black/10"
                        style={{
                            background: 'linear-gradient(135deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.06) 100%)',
                            boxShadow: '0 4px 16px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.15)'
                        }}
                    >
                        Retry
                    </button>
                )}
            </div>
        </div>
    );
}
