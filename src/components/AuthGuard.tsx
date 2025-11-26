import { useEffect, useState } from 'react';
import { useAuth0 } from '@auth0/auth0-react';

interface AuthGuardProps {
    children: React.ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
    const { isAuthenticated, isLoading, loginWithRedirect, error } = useAuth0();
    const [hasAttemptedLogin, setHasAttemptedLogin] = useState(false);
    const [authError, setAuthError] = useState<Error | null>(null);

    // Check if there are error params in URL (user was denied by Auth0)
    useEffect(() => {
        const url = new URL(window.location.href);
        const urlError = url.searchParams.get('error');

        if (urlError) {
            // User was redirected back with an error - they tried to login and were denied
            setAuthError(new Error(urlError));
            setHasAttemptedLogin(true);
            // Clear error params from URL
            url.searchParams.delete('error');
            url.searchParams.delete('error_description');
            window.history.replaceState({}, '', url.pathname);
        }
    }, []);

    // Capture SDK error only after login attempt
    useEffect(() => {
        if (error && hasAttemptedLogin) {
            setAuthError(error);
        }
    }, [error, hasAttemptedLogin]);

    useEffect(() => {
        if (!isLoading && !isAuthenticated && !authError && !hasAttemptedLogin) {
            setHasAttemptedLogin(true);
            loginWithRedirect();
        }
    }, [isLoading, isAuthenticated, loginWithRedirect, authError, hasAttemptedLogin]);

    // Show access denied message only if user attempted login and was denied
    if (authError && hasAttemptedLogin) {
        return (
            <div
                style={{
                    position: 'fixed',
                    inset: 0,
                    background: '#0a0a0f',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '24px'
                }}
            >
                <p style={{
                    color: 'rgba(255,255,255,0.4)',
                    fontSize: 10,
                    letterSpacing: '0.25em',
                    textTransform: 'uppercase',
                    marginBottom: 16
                }}>
                    Access Denied
                </p>
                <h1 style={{
                    color: 'white',
                    fontSize: 32,
                    fontWeight: 300,
                    marginBottom: 12,
                    textAlign: 'center'
                }}>
                    Private Application
                </h1>
                <p style={{
                    color: 'rgba(255,255,255,0.3)',
                    fontSize: 14,
                    marginBottom: 48,
                    textAlign: 'center',
                    maxWidth: 300
                }}>
                    Your account is not authorized to access this application.
                </p>
                <button
                    onClick={() => {
                        setAuthError(null);
                        // Keep hasAttemptedLogin true to prevent useEffect from interfering
                        loginWithRedirect({ authorizationParams: { prompt: 'login' } });
                    }}
                    style={{
                        background: 'rgba(255,255,255,0.1)',
                        border: 'none',
                        color: 'rgba(255,255,255,0.7)',
                        fontSize: 11,
                        letterSpacing: '0.2em',
                        textTransform: 'uppercase',
                        cursor: 'pointer',
                        padding: '16px 32px',
                        borderRadius: 8
                    }}
                >
                    Try Different Account →
                </button>
            </div>
        );
    }

    if (isLoading || !isAuthenticated) {
        return (
            <div
                style={{
                    position: 'fixed',
                    inset: 0,
                    background: '#0a0a0f',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center'
                }}
            >
                <p style={{
                    color: 'rgba(255,255,255,0.3)',
                    fontSize: 10,
                    letterSpacing: '0.15em',
                    textTransform: 'uppercase'
                }}>
                    Redirecting to login...
                </p>
            </div>
        );
    }

    return <>{children}</>;
}
