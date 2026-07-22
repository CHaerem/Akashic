import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the CloudKit bootstrap so no CDN load / network happens.
const getCloudKitSession = vi.fn();
const onCloudKitAuthChange = vi.fn((_handler?: (s: unknown) => void) => () => {});
const mountAppleSignInButton = vi.fn(async (_el?: HTMLElement) => {});

vi.mock('../lib/cloudkit', () => ({
    getCloudKitSession: () => getCloudKitSession(),
    onCloudKitAuthChange: (handler: (s: unknown) => void) => onCloudKitAuthChange(handler),
    mountAppleSignInButton: (el: HTMLElement) => mountAppleSignInButton(el),
}));

import { AuthGuard } from './AuthGuard';

const CHILD = 'PUBLIC_SHOWCASE';

describe('AuthGuard — public showcase (T3.3)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
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
});
