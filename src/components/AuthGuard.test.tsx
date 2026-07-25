import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the CloudKit bootstrap so no CDN load / network happens. The auth-change
// handler is captured so a sign-in/out transition can be driven from a test.
const getCloudKitSession = vi.fn();
type AuthSession = { user: CloudKitJS.UserIdentity | null };
let authChangeHandler: ((s: AuthSession) => void) | null = null;
const onCloudKitAuthChange = vi.fn((handler: (s: AuthSession) => void) => {
    authChangeHandler = handler;
    return () => {};
});
const mountAppleSignInButton = vi.fn(async (_el?: HTMLElement) => {});

vi.mock('../lib/cloudkit', () => ({
    getCloudKitSession: () => getCloudKitSession(),
    onCloudKitAuthChange: (handler: (s: AuthSession) => void) => onCloudKitAuthChange(handler),
    mountAppleSignInButton: (el: HTMLElement) => mountAppleSignInButton(el),
}));

// Spy on the module cache reset AuthGuard performs on an auth transition.
const resetAuthCache = vi.fn();
vi.mock('../lib/journeys/adapters/cloudkit/publicAdapter', () => ({
    resetAuthCache: () => resetAuthCache(),
}));

import { AuthGuard } from './AuthGuard';

const CHILD = 'PUBLIC_SHOWCASE';

/** Swap window.location for one carrying a mock reload; returns a restore fn. */
function stubReload(): { reload: ReturnType<typeof vi.fn>; restore: () => void } {
    const reload = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', {
        configurable: true,
        value: { ...original, reload },
    });
    return { reload, restore: () => Object.defineProperty(window, 'location', { configurable: true, value: original }) };
}

describe('AuthGuard — public showcase (T3.3)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        authChangeHandler = null;
    });

    it('renders the app (children) for a signed-out visitor — no wall', async () => {
        getCloudKitSession.mockResolvedValue({ user: null });

        render(<AuthGuard><div>{CHILD}</div></AuthGuard>);

        // Children are shown immediately, signed-out (no login wall).
        expect(screen.getByText(CHILD)).not.toBeNull();
        // And a discreet family sign-in affordance appears once the probe resolves.
        expect(await screen.findByRole('button', { name: 'Family sign-in' })).not.toBeNull();
    });

    it('opens a dismissible sign-in overlay that mounts the Apple button', async () => {
        getCloudKitSession.mockResolvedValue({ user: null });

        render(<AuthGuard><div>{CHILD}</div></AuthGuard>);

        const pill = await screen.findByRole('button', { name: 'Family sign-in' });
        fireEvent.click(pill);

        const dialog = await screen.findByRole('dialog', { name: 'Family sign-in' });
        expect(dialog).not.toBeNull();
        // CloudKit JS renders its own Apple button into the overlay.
        await waitFor(() => expect(mountAppleSignInButton).toHaveBeenCalled());

        // Dismissible: the close button hides the overlay again.
        fireEvent.click(screen.getByRole('button', { name: 'Close' }));
        await waitFor(() =>
            expect(screen.queryByRole('dialog', { name: 'Family sign-in' })).toBeNull()
        );
    });

    it('shows no sign-in pill once a session exists', async () => {
        getCloudKitSession.mockResolvedValue({ user: { userRecordName: 'owner' } });

        render(<AuthGuard><div>{CHILD}</div></AuthGuard>);

        await waitFor(() => expect(getCloudKitSession).toHaveBeenCalled());
        expect(screen.getByText(CHILD)).not.toBeNull();
        expect(screen.queryByRole('button', { name: 'Family sign-in' })).toBeNull();
    });

    it('does not reload on the initial resolve, nor on a same-state auth event', async () => {
        getCloudKitSession.mockResolvedValue({ user: null }); // start signed-out
        const loc = stubReload();

        render(<AuthGuard><div>{CHILD}</div></AuthGuard>);
        // Wait for the initial resolve (the pill appears once loading is false).
        await screen.findByRole('button', { name: 'Family sign-in' });

        // The initial resolve alone must never reload — that is the reload-loop guard.
        expect(loc.reload).not.toHaveBeenCalled();

        // A same-state event (still signed-out) is not a transition → still no reload.
        expect(authChangeHandler).toBeTypeOf('function');
        act(() => authChangeHandler!({ user: null }));
        expect(loc.reload).not.toHaveBeenCalled();
        expect(resetAuthCache).not.toHaveBeenCalled();

        loc.restore();
    });

    it('resets the cache and reloads exactly once on a real sign-in transition', async () => {
        getCloudKitSession.mockResolvedValue({ user: null }); // start signed-out
        const loc = stubReload();

        render(<AuthGuard><div>{CHILD}</div></AuthGuard>);
        await screen.findByRole('button', { name: 'Family sign-in' });
        expect(authChangeHandler).toBeTypeOf('function');

        // Genuine transition: signed-out -> signed-in flips the whole data layer.
        act(() => authChangeHandler!({ user: { userRecordName: 'owner' } as CloudKitJS.UserIdentity }));

        expect(resetAuthCache).toHaveBeenCalledTimes(1);
        expect(loc.reload).toHaveBeenCalledTimes(1);

        loc.restore();
    });
});
