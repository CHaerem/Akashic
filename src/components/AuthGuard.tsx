import { useEffect, useState, type ReactNode } from 'react';
import { supabase, isAuthEnabled } from '../lib/supabase';
import type { User, AuthError } from '@supabase/supabase-js';

// Allowed email addresses (whitelist)
const ALLOWED_EMAILS = [
    'christopherhaerem@gmail.com',
    // Add more allowed emails here
];

interface AuthGuardProps {
    children: ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [isSignUp, setIsSignUp] = useState(false);
    const [message, setMessage] = useState<string | null>(null);

    useEffect(() => {
        if (!supabase) {
            setLoading(false);
            return;
        }

        // Get initial session
        supabase.auth.getSession().then(({ data: { session } }) => {
            const currentUser = session?.user ?? null;
            if (currentUser && !isAllowed(currentUser.email)) {
                setError('Access denied. Your email is not authorized.');
                supabase.auth.signOut();
                setUser(null);
            } else {
                setUser(currentUser);
            }
            setLoading(false);
        });

        // Listen for auth changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            const currentUser = session?.user ?? null;
            if (currentUser && !isAllowed(currentUser.email)) {
                setError('Access denied. Your email is not authorized.');
                supabase.auth.signOut();
                setUser(null);
            } else {
                setUser(currentUser);
                setError(null);
            }
        });

        return () => subscription.unsubscribe();
    }, []);

    const isAllowed = (email: string | undefined): boolean => {
        if (!email) return false;
        return ALLOWED_EMAILS.includes(email.toLowerCase());
    };

    const handleAuth = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!supabase) return;

        setError(null);
        setMessage(null);

        try {
            let result: { error: AuthError | null };

            if (isSignUp) {
                result = await supabase.auth.signUp({ email, password });
                if (!result.error) {
                    setMessage('Check your email for the confirmation link.');
                }
            } else {
                result = await supabase.auth.signInWithPassword({ email, password });
            }

            if (result.error) {
                setError(result.error.message);
            }
        } catch {
            setError('An unexpected error occurred');
        }
    };

    const handleSignOut = async () => {
        if (!supabase) return;
        await supabase.auth.signOut();
        setUser(null);
    };

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

    // Login form
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

            <form onSubmit={handleAuth} style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 16,
                width: '100%',
                maxWidth: 320
            }}>
                <input
                    type="email"
                    placeholder="Email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    style={{
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: 4,
                        padding: '12px 16px',
                        color: 'white',
                        fontSize: 14,
                        outline: 'none'
                    }}
                />
                <input
                    type="password"
                    placeholder="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                    style={{
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: 4,
                        padding: '12px 16px',
                        color: 'white',
                        fontSize: 14,
                        outline: 'none'
                    }}
                />

                <button
                    type="submit"
                    style={{
                        background: 'rgba(255,255,255,0.1)',
                        border: 'none',
                        borderRadius: 4,
                        padding: '12px 16px',
                        color: 'rgba(255,255,255,0.8)',
                        fontSize: 12,
                        letterSpacing: '0.15em',
                        textTransform: 'uppercase',
                        cursor: 'pointer',
                        marginTop: 8
                    }}
                >
                    {isSignUp ? 'Sign Up' : 'Sign In'}
                </button>

                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 16,
                    margin: '8px 0'
                }}>
                    <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.1)' }} />
                    <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11, textTransform: 'uppercase' }}>or</span>
                    <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.1)' }} />
                </div>

                <button
                    type="button"
                    onClick={handleGoogleSignIn}
                    style={{
                        background: 'transparent',
                        border: '1px solid rgba(255,255,255,0.2)',
                        borderRadius: 4,
                        padding: '12px 16px',
                        color: 'rgba(255,255,255,0.6)',
                        fontSize: 12,
                        letterSpacing: '0.1em',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 8
                    }}
                >
                    Continue with Google
                </button>
            </form>

            <button
                onClick={() => {
                    setIsSignUp(!isSignUp);
                    setError(null);
                    setMessage(null);
                }}
                style={{
                    background: 'none',
                    border: 'none',
                    color: 'rgba(255,255,255,0.4)',
                    fontSize: 11,
                    marginTop: 24,
                    cursor: 'pointer',
                    letterSpacing: '0.1em'
                }}
            >
                {isSignUp ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
            </button>

            {error && (
                <p style={{
                    color: '#ff6b6b',
                    fontSize: 12,
                    marginTop: 16,
                    textAlign: 'center'
                }}>
                    {error}
                </p>
            )}

            {message && (
                <p style={{
                    color: '#69db7c',
                    fontSize: 12,
                    marginTop: 16,
                    textAlign: 'center'
                }}>
                    {message}
                </p>
            )}
        </div>
    );
}
