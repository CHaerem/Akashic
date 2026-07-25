import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { Photo } from '../types/trek';
import { usePhotoOriginals } from './usePhotoOriginals';
import { fetchOriginalUrl } from '../lib/journeys';

vi.mock('../lib/journeys', () => ({
    fetchOriginalUrl: vi.fn(),
}));

const mockFetchOriginalUrl = fetchOriginalUrl as Mock;

// A recognisable stand-in for the real getMediaUrl (which passes absolute URLs through).
const getMediaUrl = (path: string) => `M:${path}`;

function photo(over: Partial<Photo>): Photo {
    return {
        id: 'p1',
        journey_id: 'j1',
        url: '',
        thumbnail_url: 'thumb.jpg',
        ...over,
    } as Photo;
}

describe('usePhotoOriginals — the thumb→original upgrade chain', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('uses Photo.url when present (pre-repack / public), and never fetches', () => {
        const { result } = renderHook(() => usePhotoOriginals('kilimanjaro', getMediaUrl));
        const p = photo({ url: 'original.jpg', thumbnail_url: 'thumb.jpg' });

        expect(result.current.getFullSizeUrl(p)).toBe('M:original.jpg');

        act(() => result.current.requestOriginal(p));
        expect(mockFetchOriginalUrl).not.toHaveBeenCalled();
    });

    it('falls back to the thumb, and does not fetch, when there is no journey slug', () => {
        const { result } = renderHook(() => usePhotoOriginals(undefined, getMediaUrl));
        const p = photo({ url: '', thumbnail_url: 'thumb.jpg' });

        expect(result.current.getFullSizeUrl(p)).toBe('M:thumb.jpg');

        act(() => result.current.requestOriginal(p));
        expect(mockFetchOriginalUrl).not.toHaveBeenCalled();
    });

    it('shows the thumb first, then upgrades to the PhotoMedia original once resolved', async () => {
        mockFetchOriginalUrl.mockResolvedValue('https://cvws.icloud-content.com/p1-original');
        const { result } = renderHook(() => usePhotoOriginals('kilimanjaro', getMediaUrl));
        const p = photo({ id: 'p1', url: '', thumbnail_url: 'thumb.jpg' });

        // Before resolution: the floor is the thumb — never a broken image.
        expect(result.current.getFullSizeUrl(p)).toBe('M:thumb.jpg');

        act(() => result.current.requestOriginal(p));
        expect(mockFetchOriginalUrl).toHaveBeenCalledWith('p1', 'kilimanjaro');

        // After resolution: upgraded to the on-demand original.
        await waitFor(() =>
            expect(result.current.getFullSizeUrl(p)).toBe('M:https://cvws.icloud-content.com/p1-original')
        );
    });

    it('stays on the thumb when the original cannot be resolved', async () => {
        mockFetchOriginalUrl.mockResolvedValue(null);
        const { result } = renderHook(() => usePhotoOriginals('kilimanjaro', getMediaUrl));
        const p = photo({ id: 'p9', url: '', thumbnail_url: 'thumb9.jpg' });

        act(() => result.current.requestOriginal(p));
        await waitFor(() => expect(mockFetchOriginalUrl).toHaveBeenCalled());

        expect(result.current.getFullSizeUrl(p)).toBe('M:thumb9.jpg');
    });

    it('requests a given photo at most once', async () => {
        mockFetchOriginalUrl.mockResolvedValue('https://x/orig');
        const { result } = renderHook(() => usePhotoOriginals('kilimanjaro', getMediaUrl));
        const p = photo({ id: 'p1', url: '' });

        act(() => {
            result.current.requestOriginal(p);
            result.current.requestOriginal(p);
        });
        await waitFor(() => expect(mockFetchOriginalUrl).toHaveBeenCalled());

        expect(mockFetchOriginalUrl).toHaveBeenCalledTimes(1);
    });
});
