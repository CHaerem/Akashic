import { useEffect, useState, type ReactNode } from 'react';
import { supabase, isAuthEnabled } from '../lib/supabase';
import type { User } from '@supabase/supabase-js';

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
                background: '#0a0a0f',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
            }}>
                <p style={{
                    color: 'rgba(255,255,255,0.4)',
                    fontSize: 12,
                    letterSpacing: '0.2em',
                    textTransform: 'uppercase'
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
            background: '#0a0a0f',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24
        }}>
            <h1 style={{
                color: 'rgba(255,255,255,0.7)',
                fontSize: 14,
                letterSpacing: '0.3em',
                textTransform: 'uppercase',
                marginBottom: 48,
                fontWeight: 300
            }}>
                Akashic
            </h1>

            <button
                onClick={handleGoogleSignIn}
                style={{
                    background: 'rgba(255,255,255,0.1)',
                    border: '1px solid rgba(255,255,255,0.2)',
                    borderRadius: 4,
                    padding: '14px 28px',
                    color: 'rgba(255,255,255,0.8)',
                    fontSize: 12,
                    letterSpacing: '0.15em',
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 10
                }}
            >
                Sign in with Google
            </button>

            {error && (
                <p style={{
                    color: '#ff6b6b',
                    fontSize: 12,
                    marginTop: 24,
                    textAlign: 'center'
                }}>
                    {error}
                </p>
            )}

            <p style={{
                color: 'rgba(255,255,255,0.3)',
                fontSize: 11,
                marginTop: 32,
                textAlign: 'center'
            }}>
                Access restricted to authorized users
            </p>
        </div>
    );
}
