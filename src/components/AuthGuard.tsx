import { useEffect, useState, type ReactNode } from 'react';
import { supabase, isAuthEnabled } from '../lib/supabase';
import type { User } from '@supabase/supabase-js';
import { colors, gradients, radius, transitions, typography } from '../styles/liquidGlass';
import { GlassButton } from './common/GlassButton';

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
            <div style={{
                position: 'fixed',
                inset: 0,
                background: colors.background.base,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
            }}>
                <p style={{
                    ...typography.label,
                    color: colors.text.subtle
                }}>
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
        <div style={{
            position: 'fixed',
            inset: 0,
            background: colors.background.base,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24
        }}>
            {/* Subtle glass card for login */}
            <div style={{
                background: gradients.glass.subtle,
                backdropFilter: 'blur(16px) saturate(180%)',
                WebkitBackdropFilter: 'blur(16px) saturate(180%)',
                border: `1px solid ${colors.glass.borderSubtle}`,
                borderRadius: radius.xl,
                padding: '48px 40px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                boxShadow: `
                    0 16px 48px rgba(0, 0, 0, 0.3),
                    inset 0 1px 0 rgba(255, 255, 255, 0.1)
                `,
            }}>
                <h1 style={{
                    ...typography.label,
                    fontSize: 14,
                    letterSpacing: '0.3em',
                    color: colors.text.secondary,
                    marginBottom: 40,
                }}>
                    Akashic
                </h1>

                <GlassButton
                    variant="default"
                    size="lg"
                    onClick={handleGoogleSignIn}
                    style={{
                        ...typography.label,
                        letterSpacing: '0.15em',
                    }}
                >
                    Sign in with Google
                </GlassButton>

                {error && (
                    <p style={{
                        color: colors.accent.error,
                        fontSize: 12,
                        marginTop: 24,
                        textAlign: 'center',
                        transition: `opacity ${transitions.normal}`,
                    }}>
                        {error}
                    </p>
                )}

                <p style={{
                    color: colors.text.subtle,
                    fontSize: 11,
                    marginTop: 32,
                    textAlign: 'center'
                }}>
                    Access restricted to authorized users
                </p>
            </div>
        </div>
    );
}
