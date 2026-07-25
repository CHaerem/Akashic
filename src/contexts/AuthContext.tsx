/**
 * Signed-in state, shared with the app.
 *
 * Since T3.3 the app renders for everyone: signed-out visitors see the public
 * showcase, family members who sign in get the full experience. Components that
 * expose edit affordances (edit mode, caption editing) read `signedIn` here to stay
 * read-only for the public. `AuthGuard` is the single writer of this value.
 */

import { createContext, useContext } from 'react';

export interface AuthState {
    /** True when an Apple ID session exists (or E2E test mode stands in for one). */
    signedIn: boolean;
    /** True until the initial session probe resolves. */
    loading: boolean;
}

export const AuthContext = createContext<AuthState>({ signedIn: false, loading: true });

/** Read the current signed-in state. Defaults to signed-out until AuthGuard resolves. */
export function useAuth(): AuthState {
    return useContext(AuthContext);
}
