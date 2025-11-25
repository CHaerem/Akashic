import { useEffect, useState } from 'react';
import { useAuth0 } from '@auth0/auth0-react';

interface AuthGuardProps {
    children: React.ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
    const { isAuthenticated, isLoading, loginWithRedirect, error } = useAuth0();
    const [hasAttemptedLogin, setHasAttemptedLogin] = useState(false);

    useEffect(() => {
        if (!isLoading && !isAuthenticated && !error && !hasAttemptedLogin) {
            setHasAttemptedLogin(true);
            loginWithRedirect();
        }
    }, [isLoading, isAuthenticated, loginWithRedirect, error, hasAttemptedLogin]);

    // Show access denied message if there's an error (e.g., user not whitelisted)
    if (error) {
        return (
            <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
                <div className="text-center max-w-md bg-slate-800 rounded-xl p-8 shadow-xl">
                    <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
                        <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                    </div>
                    <h1 className="text-2xl font-bold text-white mb-3">Access Denied</h1>
                    <p className="text-slate-300 mb-6">
                        This is a private application. Your account is not authorized to access it.
                    </p>
                    <p className="text-slate-400 text-sm">
                        Contact the owner if you believe this is a mistake.
                    </p>
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
