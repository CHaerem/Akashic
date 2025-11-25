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
                    minHeight: '100vh',
                    backgroundColor: '#0f172a',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '1rem'
                }}
            >
                <div
                    style={{
                        textAlign: 'center',
                        maxWidth: '28rem',
                        backgroundColor: '#1e293b',
                        borderRadius: '0.75rem',
                        padding: '2rem',
                        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)'
                    }}
                >
                    <div
                        style={{
                            width: '4rem',
                            height: '4rem',
                            backgroundColor: 'rgba(239, 68, 68, 0.2)',
                            borderRadius: '50%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            margin: '0 auto 1.5rem'
                        }}
                    >
                        <svg style={{ width: '2rem', height: '2rem', color: '#f87171' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                    </div>
                    <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#ffffff', marginBottom: '0.75rem' }}>
                        Access Denied
                    </h1>
                    <p style={{ color: '#cbd5e1', marginBottom: '1.5rem' }}>
                        This is a private application. Your account is not authorized to access it.
                    </p>
                    <p style={{ color: '#94a3b8', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
                        Contact the owner if you believe this is a mistake.
                    </p>
                    <button
                        onClick={() => {
                            setAuthError(null);
                            setHasAttemptedLogin(false);
                            loginWithRedirect();
                        }}
                        style={{
                            backgroundColor: '#3b82f6',
                            color: '#ffffff',
                            padding: '0.75rem 1.5rem',
                            borderRadius: '0.5rem',
                            border: 'none',
                            fontSize: '0.875rem',
                            fontWeight: '500',
                            cursor: 'pointer',
                        }}
                    >
                        Try different account
                    </button>
                </div>
            </div>
        );
    }

    if (isLoading || !isAuthenticated) {
        return (
            <div className="min-h-screen bg-slate-900 flex items-center justify-center">
                <div className="text-center">
                    <div className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                    <p className="text-slate-400">Redirecting to login...</p>
                </div>
            </div>
        );
    }

    return <>{children}</>;
}
