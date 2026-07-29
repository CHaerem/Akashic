import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useTrekData } from './useTrekData';
import type { TrekConfig } from '../types/trek';

/**
 * QUA-72: the ?journey= deep link — the showcase's only acquisition channel — must resolve by
 * EXACT id and report a miss visibly. It used to resolve with `includes()` against both id and
 * name, so `?journey=kilimanjaro` with kilimanjaro-2023 AND kilimanjaro-2024 published opened
 * whichever sorted first (a shared link could open the WRONG journey), and a typo'd or
 * unpublished slug landed silently on the globe, which reads as "the share is broken".
 *
 * Separate file from useTrekData.test.ts because these tests need a treks-carrying mock of
 * JourneysContext (that file's module-level mock pins treks to []), and vi.mock is per-module.
 */

const trek = (id: string, name: string): TrekConfig => ({
    id,
    name,
    country: 'Tanzania',
    elevation: '5,895m',
    lat: -3.0674,
    lng: 37.3556,
    preferredBearing: 180,
    preferredPitch: 60,
    slug: id,
});

// Two journeys whose ids share a prefix — the exact case where partial matching picks wrongly.
const treks = [trek('kilimanjaro-2023', 'Kilimanjaro'), trek('kilimanjaro-2024', 'Kilimanjaro again')];

vi.mock('../contexts/JourneysContext', () => ({
    useJourneys: () => ({
        treks,
        trekDataMap: {},
        loading: false,
        error: null,
        refetch: vi.fn(),
    }),
}));

describe('useTrekData ?journey= deep link (QUA-72)', () => {
    beforeEach(() => {
        window.history.replaceState({}, '', '/');
    });

    afterEach(() => {
        window.history.replaceState({}, '', '/');
    });

    it('opens the journey on an exact id match', async () => {
        window.history.replaceState({}, '', '/?journey=kilimanjaro-2024');
        const { result } = renderHook(() => useTrekData());

        await waitFor(() => {
            expect(result.current.selectedTrek?.id).toBe('kilimanjaro-2024');
        });
        expect(result.current.sharedLinkMiss).toBeNull();
    });

    it('does not guess on a partial slug — it reports the miss instead of opening the wrong journey', async () => {
        window.history.replaceState({}, '', '/?journey=kilimanjaro');
        const { result } = renderHook(() => useTrekData());

        await waitFor(() => {
            expect(result.current.sharedLinkMiss).toBe('kilimanjaro');
        });
        expect(result.current.selectedTrek).toBeNull();
        expect(result.current.view).toBe('globe');
    });

    it('reports an unknown slug and can clear the notice', async () => {
        window.history.replaceState({}, '', '/?journey=does-not-exist');
        const { result } = renderHook(() => useTrekData());

        await waitFor(() => {
            expect(result.current.sharedLinkMiss).toBe('does-not-exist');
        });

        result.current.clearSharedLinkMiss();
        await waitFor(() => {
            expect(result.current.sharedLinkMiss).toBeNull();
        });
    });
});

describe('useTrekData URL/title sync (QUA-73)', () => {
    beforeEach(() => {
        window.history.replaceState({}, '', '/');
        document.title = 'Akashic — Your treks on a living globe';
    });

    it('writes ?journey= and the document title when a journey is opened', async () => {
        const { result } = renderHook(() => useTrekData());

        await act(async () => {
            result.current.selectTrek(treks[0]);
        });
        await act(async () => {
            result.current.handleExplore();
        });

        await waitFor(() => {
            expect(window.location.search).toContain('journey=kilimanjaro-2023');
        });
        expect(document.title).toBe('Kilimanjaro — Akashic');
    });

    it('clears the params and title when returning to the globe', async () => {
        const { result } = renderHook(() => useTrekData());
        await act(async () => { result.current.selectTrek(treks[0]); });
        await act(async () => { result.current.handleExplore(); });
        await waitFor(() => expect(window.location.search).toContain('journey='));

        await act(async () => { result.current.handleBackToGlobe(); });

        await waitFor(() => expect(window.location.search).not.toContain('journey='));
        expect(document.title).toBe('Akashic — Your treks on a living globe');
    });

    it('Back navigates within the app instead of leaving the site', async () => {
        const { result } = renderHook(() => useTrekData());
        await act(async () => { result.current.selectTrek(treks[0]); });
        await act(async () => { result.current.handleExplore(); });
        await waitFor(() => expect(window.location.search).toContain('journey=kilimanjaro-2023'));

        // Simulate the browser Back gesture: history pops to the pre-journey URL and fires
        // popstate — the hook must return to the globe rather than the site being exited.
        await act(async () => {
            window.history.replaceState({}, '', '/');
            window.dispatchEvent(new PopStateEvent('popstate'));
        });

        await waitFor(() => {
            expect(result.current.view).toBe('globe');
        });
        expect(result.current.selectedTrek).toBeNull();
    });
});
