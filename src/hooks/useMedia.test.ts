import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useMedia } from './useMedia';

// Mock supabase
const mockSubscription = { unsubscribe: vi.fn() };
const mockOnAuthStateChange = vi.fn(() => ({
    data: { subscription: mockSubscription }
}));
const mockGetSession = vi.fn();

vi.mock('../lib/supabase', () => ({
    supabase: {
        auth: {
            getSession: () => mockGetSession(),
            onAuthStateChange: (callback: (event: string, session: unknown) => void) => mockOnAuthStateChange(callback),
        }
    }
}));

// Mock media utilities
vi.mock('../lib/media', () => ({
    buildMediaUrl: (path: string, token: string | null) => {
        const baseUrl = 'https://media.example.com';
        return token ? `${baseUrl}/${path}?token=${token}` : `${baseUrl}/${path}`;
    },
    getJourneyPhotoPath: (journeyId: string, photoId: string, extension: string) => {
        return `journeys/${journeyId}/photos/${photoId}.${extension}`;
    }
}));

describe('useMedia', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('returns loading state initially', () => {
        mockGetSession.mockReturnValue(new Promise(() => {})); // Never resolves
        const { result } = renderHook(() => useMedia());
        expect(result.current.loading).toBe(true);
    });

    it('sets token from session', async () => {
        mockGetSession.mockResolvedValue({
            data: { session: { access_token: 'test-token-123' } }
        });

        const { result } = renderHook(() => useMedia());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.token).toBe('test-token-123');
    });

    it('sets token to null when no session', async () => {
        mockGetSession.mockResolvedValue({
            data: { session: null }
        });

        const { result } = renderHook(() => useMedia());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.token).toBeNull();
    });

    it('builds media URL with token', async () => {
        mockGetSession.mockResolvedValue({
            data: { session: { access_token: 'my-token' } }
        });

        const { result } = renderHook(() => useMedia());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        const url = result.current.getMediaUrl('images/photo.jpg');
        expect(url).toBe('https://media.example.com/images/photo.jpg?token=my-token');
    });

    it('builds media URL without token when not authenticated', async () => {
        mockGetSession.mockResolvedValue({
            data: { session: null }
        });

        const { result } = renderHook(() => useMedia());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        const url = result.current.getMediaUrl('images/photo.jpg');
        expect(url).toBe('https://media.example.com/images/photo.jpg');
    });

    it('builds photo URL with journey and photo IDs', async () => {
        mockGetSession.mockResolvedValue({
            data: { session: { access_token: 'token' } }
        });

        const { result } = renderHook(() => useMedia());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        const url = result.current.getPhotoUrl('journey-123', 'photo-456');
        expect(url).toBe('https://media.example.com/journeys/journey-123/photos/photo-456.jpg?token=token');
    });

    it('supports custom photo extension', async () => {
        mockGetSession.mockResolvedValue({
            data: { session: { access_token: 'token' } }
        });

        const { result } = renderHook(() => useMedia());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        const url = result.current.getPhotoUrl('journey-123', 'photo-456', 'webp');
        expect(url).toBe('https://media.example.com/journeys/journey-123/photos/photo-456.webp?token=token');
    });

    it('unsubscribes from auth changes on unmount', async () => {
        mockGetSession.mockResolvedValue({
            data: { session: null }
        });

        const { unmount } = renderHook(() => useMedia());

        await waitFor(() => {
            expect(mockOnAuthStateChange).toHaveBeenCalled();
        });

        unmount();

        expect(mockSubscription.unsubscribe).toHaveBeenCalled();
    });

    it('memoizes getMediaUrl callback', async () => {
        mockGetSession.mockResolvedValue({
            data: { session: { access_token: 'token' } }
        });

        const { result, rerender } = renderHook(() => useMedia());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        const firstCallback = result.current.getMediaUrl;
        rerender();
        const secondCallback = result.current.getMediaUrl;

        // Callback should be stable (same reference) when token hasn't changed
        expect(firstCallback).toBe(secondCallback);
    });
});
