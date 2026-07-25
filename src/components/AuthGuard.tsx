import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
    getCloudKitSession,
    onCloudKitAuthChange,
    mountAppleSignInButton,
} from '../lib/cloudkit';
import { resetAuthCache } from '../lib/journeys/adapters/cloudkit/publicAdapter';
import { AuthContext } from '../contexts/AuthContext';
import { Card } from './ui/card';
import { Attribution } from './public/Attribution';
import { typography, colors, radius } from '../styles/liquidGlass';

/** E2E runs need the app without an Apple ID prompt — treated as the full experience. */
const isE2ETestMode = import.meta.env.VITE_E2E_TEST_MODE === 'true';

interface AuthGuardProps {
    children: ReactNode;
}

/**
 * Since T3.3 this no longer walls the app off. Everyone is shown the public showcase
 * (the globe + world-readable journeys); the data layer serves the public mirror when
 * signed out and the private database when signed in. All this component adds on top
 * of the app is a discreet "Family sign-in" pill and a dismissible overlay that hosts
 * CloudKit JS's own Apple button.
 */
export function AuthGuard({ children }: AuthGuardProps) {
    const [user, setUser] = useState<CloudKitJS.UserIdentity | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showSignIn, setShowSignIn] = useState(false);
    const signInButtonRef = useRef<HTMLDivElement>(null);
    // Tracks the last known signed-in state so an actual sign-in/out transition (as
    // opposed to the initial resolve) can reset the app cleanly.
    const signedInRef = useRef<boolean | null>(null);

    // CloudKit (Apple ID) session wiring. setUpAuth resolves the persisted identity
    // (or null) without popping any UI — so this is safe to run for signed-out
    // visitors: they simply resolve to null and stay on the showcase.
    useEffect(() => {
        let mounted = true;

        getCloudKitSession()
            .then((session) => {
                if (!mounted) return;
                signedInRef.current = session.user != null;
                setUser(session.user);
                setLoading(false);
            })
            .catch(() => {
                if (mounted) {
                    signedInRef.current = false;
                    setLoading(false);
                }
            });

        const unsubscribe = onCloudKitAuthChange((session) => {
            if (!mounted) return;
            const nowSignedIn = session.user != null;
            // A real sign-in/out flips the whole data layer (public mirror <-> private
            // DB) and the module-level caches (journeyCache, session probe). Rather
            // than reconcile every cache in place, reset and reload — this is the same
            // fresh-mount the old login wall gave on sign-in, and it only fires on an
            // actual transition, so there is no reload loop.
            if (signedInRef.current !== null && signedInRef.current !== nowSignedIn) {
                resetAuthCache();
                window.location.reload();
                return;
            }
            signedInRef.current = nowSignedIn;
            setUser(session.user);
            setError(null);
        });

        return () => {
            mounted = false;
            unsubscribe();
        };
    }, []);

    // Let CloudKit JS render its own "Sign in with Apple" button once the overlay is
    // open (it renders into the element carrying the canonical sign-in-button id).
    useEffect(() => {
        if (!showSignIn) return;
        const el = signInButtonRef.current;
        if (!el) return;
        mountAppleSignInButton(el).catch((err: unknown) => {
            setError(err instanceof Error ? err.message : 'Sign-in unavailable');
        });
    }, [showSignIn]);

    const signedIn = isE2ETestMode || user != null;
    // The pill is only for genuine signed-out visitors — never in E2E (which stands in
    // for the full experience) and never once signed in.
    const showPill = !signedIn && !loading;

    return (
        <AuthContext.Provider value={{ signedIn, loading }}>
            {children}

            {showPill && (
                <button
                    type="button"
                    onClick={() => {
                        setError(null);
                        setShowSignIn(true);
                    }}
                    aria-label="Family sign-in"
                    style={{
                        position: 'fixed',
                        bottom: 20,
                        left: 20,
                        zIndex: 50,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 7,
                        padding: '8px 14px',
                        borderRadius: radius.pill,
                        border: `1px solid ${colors.glass.border}`,
                        background: 'rgba(20, 20, 24, 0.55)',
                        backdropFilter: 'blur(16px) saturate(180%)',
                        WebkitBackdropFilter: 'blur(16px) saturate(180%)',
                        color: colors.text.secondary,
                        fontSize: 12,
                        fontWeight: 500,
                        letterSpacing: '0.01em',
                        cursor: 'pointer',
                        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.28)',
                    }}
                >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M12 11c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4Z" />
                        <path d="M4 21c0-3.87 3.58-7 8-7s8 3.13 8 7" />
                    </svg>
                    Family sign-in
                </button>
            )}

            {/* Signed-out public showcase: attribution chip + legal/support links. */}
            {showPill && <Attribution />}

            {showSignIn && (
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-label="Family sign-in"
                    onClick={() => setShowSignIn(false)}
                    style={{
                        position: 'fixed',
                        inset: 0,
                        zIndex: 60,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: 24,
                        background: 'rgba(0, 0, 0, 0.55)',
                        backdropFilter: 'blur(4px)',
                        WebkitBackdropFilter: 'blur(4px)',
                    }}
                >
                    <Card
                        variant="elevated"
                        onClick={(e) => e.stopPropagation()}
                        className="px-10 py-12 flex flex-col items-center relative"
                    >
                        <button
                            type="button"
                            onClick={() => setShowSignIn(false)}
                            aria-label="Close"
                            style={{
                                position: 'absolute',
                                top: 12,
                                right: 12,
                                width: 28,
                                height: 28,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                borderRadius: radius.pill,
                                border: 'none',
                                background: 'transparent',
                                color: colors.text.tertiary,
                                cursor: 'pointer',
                            }}
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                                <path d="M18 6 6 18M6 6l12 12" />
                            </svg>
                        </button>

                        <h1 style={{
                            ...typography.brand,
                            fontSize: 14,
                            color: colors.text.secondary,
                            marginBottom: 12,
                        }}>
                            Akashic
                        </h1>

                        <p className="text-white/50 light:text-slate-500 text-xs text-center" style={{ marginBottom: 32, maxWidth: 220 }}>
                            Sign in with the family Apple ID for comments, private photos and editing.
                        </p>

                        {/* CloudKit JS renders its own Apple ID sign-in button here. */}
                        <div ref={signInButtonRef} className="tracking-wider" />

                        {error && (
                            <p className="text-red-400 text-xs mt-6 text-center transition-opacity">
                                {error}
                            </p>
                        )}
                    </Card>
                </div>
            )}
        </AuthContext.Provider>
    );
}
