import { useEffect, useRef, useState, type ReactNode } from 'react';
import { supabase, isAuthEnabled } from '../lib/supabase';
import { isCloudKitBackend } from '../lib/backend';
import {
    getCloudKitSession,
    onCloudKitAuthChange,
    mountAppleSignInButton,
} from '../lib/cloudkit';
import type { User } from '@supabase/supabase-js';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { typography, colors } from '../styles/liquidGlass';

interface AuthGuardProps {
    children: ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
    const [user, setUser] = useState<User | CloudKitJS.UserIdentity | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const signInButtonRef = useRef<HTMLDivElement>(null);

    // Supabase (Google OAuth) session wiring.
    useEffect(() => {
        if (isCloudKitBackend) return;
        if (!supabase) {
            setLoading(false);
            return;
        }

        // Get initial session
        supabase.auth.getSession().then(({ data: { session } }) => {
            setUser(session?.user ?? null);
            setLoading(false);
        });

        // Listen for auth changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            setUser(session?.user ?? null);
            setError(null);
        });

        return () => subscription.unsubscribe();
    }, []);

    // CloudKit (Apple ID) session wiring.
    useEffect(() => {
        if (!isCloudKitBackend) return;
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

    const handleGoogleSignIn = async () => {
        if (!supabase) return;
        setError(null);

        const { error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: window.location.origin
            }
        });

        if (error) {
            setError(error.message);
        }
    };

    // Auth is required in CloudKit mode (Apple ID) as well as Supabase mode.
    const authEnabled = isCloudKitBackend || isAuthEnabled;

    // If auth is not enabled, show children directly
    const searchParams = new URLSearchParams(window.location.search);
    const isTestMode = searchParams.has('journey');

    const showLogin = authEnabled && !isTestMode && !loading && !user;

    // Let CloudKit JS render its own "Sign in with Apple" button once the
    // login screen is visible.
    useEffect(() => {
        if (!isCloudKitBackend || !showLogin) return;
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

                {isCloudKitBackend ? (
                    // CloudKit JS renders its own Apple ID sign-in button here.
                    <div ref={signInButtonRef} className="tracking-wider" />
                ) : (
                    // Google only (sign-ups disabled in Supabase)
                    <Button
                        variant="default"
                        size="lg"
                        onClick={handleGoogleSignIn}
                        className="tracking-wider"
                    >
                        Sign in with Google
                    </Button>
                )}

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
