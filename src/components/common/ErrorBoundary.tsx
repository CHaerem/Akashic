import { Component, type ReactNode, type ErrorInfo } from 'react';
import { colors, gradients, radius, typography, transitions } from '../../styles/liquidGlass';

interface ErrorBoundaryProps {
    children: ReactNode;
}

interface ErrorBoundaryState {
    hasError: boolean;
    error: Error | null;
}

// Glass button style for class components (can't use hooks)
const glassButtonStyle: React.CSSProperties = {
    background: gradients.glass.button,
    backdropFilter: 'blur(8px) saturate(180%)',
    WebkitBackdropFilter: 'blur(8px) saturate(180%)',
    border: `1px solid ${colors.glass.border}`,
    boxShadow: `
        0 4px 16px rgba(0, 0, 0, 0.2),
        inset 0 1px 0 rgba(255, 255, 255, 0.15)
    `,
    color: colors.text.primary,
    padding: '12px 24px',
    borderRadius: radius.md,
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 500,
    letterSpacing: '0.02em',
    transition: `all ${transitions.smooth}`,
};

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
    }

    render(): ReactNode {
        if (this.state.hasError) {
            return (
                <div style={{
                    position: 'fixed',
                    inset: 0,
                    background: colors.background.base,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: colors.text.primary,
                    padding: 24
                }}>
                    {/* Glass card container */}
                    <div style={{
                        maxWidth: 420,
                        textAlign: 'center',
                        background: gradients.glass.card,
                        backdropFilter: 'blur(24px) saturate(180%)',
                        WebkitBackdropFilter: 'blur(24px) saturate(180%)',
                        border: `1px solid ${colors.glass.borderSubtle}`,
                        borderRadius: radius.xl,
                        padding: 32,
                        boxShadow: `
                            0 16px 48px rgba(0, 0, 0, 0.3),
                            inset 0 1px 0 rgba(255, 255, 255, 0.1)
                        `,
                    }}>
                        <h1 style={{
                            ...typography.heading,
                            fontSize: 24,
                            marginBottom: 16,
                            color: colors.text.primary,
                        }}>
                            Something went wrong
                        </h1>
                        <p style={{
                            ...typography.body,
                            fontSize: 14,
                            color: colors.text.tertiary,
                            lineHeight: 1.6,
                            marginBottom: 24
                        }}>
                            An unexpected error occurred while loading the application.
                        </p>
                        {this.state.error && (
                            <details style={{
                                textAlign: 'left',
                                background: colors.glass.subtle,
                                padding: 16,
                                borderRadius: radius.md,
                                marginBottom: 24,
                                border: `1px solid ${colors.glass.borderSubtle}`,
                            }}>
                                <summary style={{
                                    ...typography.label,
                                    cursor: 'pointer',
                                    color: colors.text.subtle,
                                    marginBottom: 8
                                }}>
                                    Error Details
                                </summary>
                                <pre style={{
                                    fontSize: 12,
                                    color: colors.text.secondary,
                                    whiteSpace: 'pre-wrap',
                                    wordBreak: 'break-word',
                                    margin: 0
                                }}>
                                    {this.state.error.toString()}
                                </pre>
                            </details>
                        )}
                        <button
                            onClick={() => window.location.reload()}
                            style={glassButtonStyle}
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

interface MapErrorFallbackProps {
    error?: string | null;
    onRetry?: () => void;
}

/**
 * Map-specific error fallback component
 */
export function MapErrorFallback({ error, onRetry }: MapErrorFallbackProps) {
    return (
        <div style={{
            position: 'absolute',
            inset: 0,
            background: colors.background.base,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            color: colors.text.primary,
        }}>
            <div style={{
                textAlign: 'center',
                maxWidth: 300,
                background: gradients.glass.subtle,
                backdropFilter: 'blur(16px) saturate(180%)',
                WebkitBackdropFilter: 'blur(16px) saturate(180%)',
                border: `1px solid ${colors.glass.borderSubtle}`,
                borderRadius: radius.lg,
                padding: 24,
                boxShadow: `
                    0 8px 32px rgba(0, 0, 0, 0.25),
                    inset 0 1px 0 rgba(255, 255, 255, 0.08)
                `,
            }}>
                <p style={{
                    ...typography.body,
                    fontSize: 14,
                    color: colors.text.tertiary,
                    marginBottom: 16
                }}>
                    Unable to load map
                </p>
                {error && (
                    <p style={{
                        fontSize: 12,
                        color: colors.text.subtle,
                        marginBottom: 16
                    }}>
                        {error}
                    </p>
                )}
                {onRetry && (
                    <button
                        onClick={onRetry}
                        style={{
                            ...glassButtonStyle,
                            padding: '8px 16px',
                            fontSize: 12,
                        }}
                    >
                        Retry
                    </button>
                )}
            </div>
        </div>
    );
}
