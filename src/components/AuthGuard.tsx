import { useEffect, useState, type ReactNode } from 'react';
import { supabase, isAuthEnabled } from '../lib/supabase';
import type { User } from '@supabase/supabase-js';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { typography, colors } from '../styles/liquidGlass';

interface AuthGuardProps {
    children: ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
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

    // If auth is not enabled, show children directly
    if (!isAuthEnabled) {
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

    // Login screen - Google only (sign-ups disabled in Supabase)
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

                <Button
                    variant="default"
                    size="lg"
                    onClick={handleGoogleSignIn}
                    className="tracking-wider"
                >
                    Sign in with Google
                </Button>

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
