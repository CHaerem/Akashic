import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setSheetCoversChrome } from '../../lib/sheetOverlay';

// Mirror AuthGuard.test.tsx: stub CloudKit so no CDN load / network happens, and
// capture the auth-change handler. The attribution chip is a public-showcase
// affordance mounted by AuthGuard, so we drive it the same way — through the
// signed-out / signed-in probe result.
const getCloudKitSession = vi.fn();
type AuthSession = { user: CloudKitJS.UserIdentity | null };
const onCloudKitAuthChange = vi.fn((_handler: (s: AuthSession) => void) => () => {});
const mountAppleSignInButton = vi.fn(async (_el?: HTMLElement) => {});

vi.mock('../../lib/cloudkit', () => ({
    getCloudKitSession: () => getCloudKitSession(),
    onCloudKitAuthChange: (handler: (s: AuthSession) => void) => onCloudKitAuthChange(handler),
    mountAppleSignInButton: (el: HTMLElement) => mountAppleSignInButton(el),
}));

vi.mock('../../lib/journeys/adapters/cloudkit/publicAdapter', () => ({
    resetAuthCache: () => {},
}));

import { AuthGuard } from '../AuthGuard';
import { LANDING_URL } from '../../lib/branding';

const CHILD = 'PUBLIC_SHOWCASE';

describe('Attribution — "Made with Akashic" chip (public showcase)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        // Reset the shared sheet-overlay signal so it can't leak between tests.
        setSheetCoversChrome(false);
    });

    it('renders for a signed-out visitor, pointing at the landing URL', async () => {
        getCloudKitSession.mockResolvedValue({ user: null });

        render(<AuthGuard><div>{CHILD}</div></AuthGuard>);

        const chip = await screen.findByRole('link', { name: /Made with Akashic/i });
        expect(chip).not.toBeNull();
        expect(chip.getAttribute('href')).toBe(LANDING_URL);
    });

    it('exposes Privacy, Terms and Support links to the public', async () => {
        getCloudKitSession.mockResolvedValue({ user: null });

        render(<AuthGuard><div>{CHILD}</div></AuthGuard>);

        expect(await screen.findByRole('link', { name: 'Privacy' })).not.toBeNull();
        expect(screen.getByRole('link', { name: 'Terms' })).not.toBeNull();
        expect(screen.getByRole('link', { name: 'Support' })).not.toBeNull();
    });

    it('steps aside while the mobile bottom sheet covers it (no tap-stealing overlay)', async () => {
        getCloudKitSession.mockResolvedValue({ user: null });
        // AkashicApp raises this while the full-width sheet is open on mobile.
        setSheetCoversChrome(true);

        render(<AuthGuard><div>{CHILD}</div></AuthGuard>);

        // The showcase child still renders; the chip + legal links step aside so
        // the sheet owns every tap in the bottom-right region.
        await waitFor(() => expect(getCloudKitSession).toHaveBeenCalled());
        expect(screen.getByText(CHILD)).not.toBeNull();
        expect(screen.queryByRole('link', { name: /Made with Akashic/i })).toBeNull();
        expect(screen.queryByRole('link', { name: 'Privacy' })).toBeNull();
    });

    it('does NOT render once a session exists (signed-in family)', async () => {
        getCloudKitSession.mockResolvedValue({ user: { userRecordName: 'owner' } });

        render(<AuthGuard><div>{CHILD}</div></AuthGuard>);

        await waitFor(() => expect(getCloudKitSession).toHaveBeenCalled());
        expect(screen.getByText(CHILD)).not.toBeNull();
        expect(screen.queryByRole('link', { name: /Made with Akashic/i })).toBeNull();
        expect(screen.queryByRole('link', { name: 'Privacy' })).toBeNull();
    });
});
