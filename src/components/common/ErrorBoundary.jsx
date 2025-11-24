import { Component } from 'react';

/**
 * Error boundary component for graceful error handling
 */
export class ErrorBoundary extends Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, errorInfo) {
        console.error('ErrorBoundary caught an error:', error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div style={{
                    position: 'fixed',
                    inset: 0,
                    background: '#0a0a0f',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'white',
                    padding: 24
                }}>
                    <div style={{
                        maxWidth: 400,
                        textAlign: 'center'
                    }}>
                        <h1 style={{
                            fontSize: 24,
                            fontWeight: 300,
                            marginBottom: 16,
                            color: 'rgba(255,255,255,0.9)'
                        }}>
                            Something went wrong
                        </h1>
                        <p style={{
                            fontSize: 14,
                            color: 'rgba(255,255,255,0.5)',
                            lineHeight: 1.6,
                            marginBottom: 24
                        }}>
                            An unexpected error occurred while loading the application.
                        </p>
                        {this.state.error && (
                            <details style={{
                                textAlign: 'left',
                                background: 'rgba(255,255,255,0.05)',
                                padding: 16,
                                borderRadius: 8,
                                marginBottom: 24
                            }}>
                                <summary style={{
                                    cursor: 'pointer',
                                    color: 'rgba(255,255,255,0.4)',
                                    fontSize: 12,
                                    letterSpacing: '0.1em',
                                    textTransform: 'uppercase',
                                    marginBottom: 8
                                }}>
                                    Error Details
                                </summary>
                                <pre style={{
                                    fontSize: 12,
                                    color: 'rgba(255,255,255,0.6)',
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
                            style={{
                                background: 'rgba(255,255,255,0.1)',
                                border: '1px solid rgba(255,255,255,0.2)',
                                color: 'white',
                                padding: '12px 24px',
                                borderRadius: 8,
                                cursor: 'pointer',
                                fontSize: 14,
                                letterSpacing: '0.05em'
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

/**
 * Map-specific error fallback component
 */
export function MapErrorFallback({ error, onRetry }) {
    return (
        <div style={{
            position: 'absolute',
            inset: 0,
            background: '#0a0a0f',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white'
        }}>
            <div style={{
                textAlign: 'center',
                maxWidth: 300
            }}>
                <p style={{
                    fontSize: 14,
                    color: 'rgba(255,255,255,0.5)',
                    marginBottom: 16
                }}>
                    Unable to load map
                </p>
                {error && (
                    <p style={{
                        fontSize: 12,
                        color: 'rgba(255,255,255,0.3)',
                        marginBottom: 16
                    }}>
                        {error}
                    </p>
                )}
                {onRetry && (
                    <button
                        onClick={onRetry}
                        style={{
                            background: 'rgba(255,255,255,0.1)',
                            border: '1px solid rgba(255,255,255,0.2)',
                            color: 'white',
                            padding: '8px 16px',
                            borderRadius: 4,
                            cursor: 'pointer',
                            fontSize: 12
                        }}
                    >
                        Retry
                    </button>
                )}
            </div>
        </div>
    );
}
