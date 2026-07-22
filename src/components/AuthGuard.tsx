import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
    getCloudKitSession,
    onCloudKitAuthChange,
    mountAppleSignInButton,
} from '../lib/cloudkit';
import { Card } from './ui/card';
import { typography, colors } from '../styles/liquidGlass';

/** E2E runs need the app without an Apple ID prompt. */
const isE2ETestMode = import.meta.env.VITE_E2E_TEST_MODE === 'true';

interface AuthGuardProps {
    children: ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
    const [user, setUser] = useState<CloudKitJS.UserIdentity | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const signInButtonRef = useRef<HTMLDivElement>(null);

    // CloudKit (Apple ID) session wiring.
    useEffect(() => {
        let mounted = true;

        getCloudKitSession()
            .then((session) => {
                if (!mounted) return;
                setUser(session.user);
                setLoading(false);
            })
            .catch(() => {
                if (mounted) setLoading(false);
            });

        const unsubscribe = onCloudKitAuthChange((session) => {
            if (!mounted) return;
            setUser(session.user);
            setError(null);
        });

        return () => {
            mounted = false;
            unsubscribe();
        };
    }, []);

    // Signing in with an Apple ID is how the web app reaches the private database.
    const authEnabled = !isE2ETestMode;

    // If auth is not enabled, show children directly
    const searchParams = new URLSearchParams(window.location.search);
    const isTestMode = searchParams.has('journey');

    const showLogin = authEnabled && !isTestMode && !loading && !user;

    // Let CloudKit JS render its own "Sign in with Apple" button once the
    // login screen is visible.
    useEffect(() => {
        if (!showLogin) return;
        const el = signInButtonRef.current;
        if (!el) return;
        mountAppleSignInButton(el).catch((err: unknown) => {
            setError(err instanceof Error ? err.message : 'Sign-in unavailable');
        });
    }, [showLogin]);

    if (!authEnabled || isTestMode) {
        return <>{children}</>;
    }

    // Loading state
    if (loading) {
        return (
            <div className="fixed inset-0 bg-[var(--lg-bg-base)] flex items-center justify-center">
                <p className="text-sm text-white/35 light:text-slate-400">
                    Loading...
                </p>
            </div>
        );
    }

    // Authenticated - show app
    if (user) {
        return <>{children}</>;
    }

    // Login screen
    return (
        <div className="fixed inset-0 bg-[var(--lg-bg-base)] flex flex-col items-center justify-center p-6">
            <Card variant="elevated" className="px-10 py-12 flex flex-col items-center">
                <h1 style={{
                    ...typography.brand,
                    fontSize: 14,
                    color: colors.text.secondary,
                    marginBottom: 40,
                }}>
                    Akashic
                </h1>

                {/* CloudKit JS renders its own Apple ID sign-in button here. */}
                    <div ref={signInButtonRef} className="tracking-wider" />

                {error && (
                    <p className="text-red-400 text-xs mt-6 text-center transition-opacity">
                        {error}
                    </p>
                )}

                <p className="text-white/35 light:text-slate-400 text-xs mt-8 text-center">
                    Access restricted to authorized users
                </p>
            </Card>
        </div>
    );
}
