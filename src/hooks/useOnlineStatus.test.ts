import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useOnlineStatus, useCacheStatus, useCacheStorage } from './useOnlineStatus';

describe('useOnlineStatus', () => {
    let onlineGetter: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        // Mock navigator.onLine
        onlineGetter = vi.spyOn(navigator, 'onLine', 'get');
    });

    afterEach(() => {
        onlineGetter.mockRestore();
        vi.clearAllMocks();
    });

    it('returns online status based on navigator.onLine', () => {
        onlineGetter.mockReturnValue(true);
        const { result } = renderHook(() => useOnlineStatus());
        expect(result.current.isOnline).toBe(true);
        expect(result.current.wasOffline).toBe(false);
    });

    it('returns offline status when navigator.onLine is false', () => {
        onlineGetter.mockReturnValue(false);
        const { result } = renderHook(() => useOnlineStatus());
        expect(result.current.isOnline).toBe(false);
    });

    it('updates when going offline', async () => {
        onlineGetter.mockReturnValue(true);
        const { result } = renderHook(() => useOnlineStatus());

        expect(result.current.isOnline).toBe(true);

        // Simulate going offline
        act(() => {
            window.dispatchEvent(new Event('offline'));
        });

        expect(result.current.isOnline).toBe(false);
        expect(result.current.wasOffline).toBe(true);
    });

    it('updates when coming online after being offline', async () => {
        onlineGetter.mockReturnValue(true);
        const { result } = renderHook(() => useOnlineStatus());

        // First go offline
        act(() => {
            window.dispatchEvent(new Event('offline'));
        });

        expect(result.current.isOnline).toBe(false);
        expect(result.current.wasOffline).toBe(true);

        // Then come back online
        act(() => {
            window.dispatchEvent(new Event('online'));
        });

        expect(result.current.isOnline).toBe(true);
        // wasOffline should stay true briefly (for reconnection message)
        expect(result.current.wasOffline).toBe(true);
    });

    it('clears wasOffline after timeout when coming back online', async () => {
        vi.useFakeTimers();
        onlineGetter.mockReturnValue(false);
        const { result } = renderHook(() => useOnlineStatus());

        // Go offline first
        act(() => {
            window.dispatchEvent(new Event('offline'));
        });

        // Then come back online
        act(() => {
            window.dispatchEvent(new Event('online'));
        });

        expect(result.current.wasOffline).toBe(true);

        // Fast-forward 3 seconds
        act(() => {
            vi.advanceTimersByTime(3000);
        });

        expect(result.current.wasOffline).toBe(false);

        vi.useRealTimers();
    });

    it('cleans up event listeners on unmount', () => {
        const addSpy = vi.spyOn(window, 'addEventListener');
        const removeSpy = vi.spyOn(window, 'removeEventListener');

        onlineGetter.mockReturnValue(true);
        const { unmount } = renderHook(() => useOnlineStatus());

        expect(addSpy).toHaveBeenCalledWith('online', expect.any(Function));
        expect(addSpy).toHaveBeenCalledWith('offline', expect.any(Function));

        unmount();

        expect(removeSpy).toHaveBeenCalledWith('online', expect.any(Function));
        expect(removeSpy).toHaveBeenCalledWith('offline', expect.any(Function));

        addSpy.mockRestore();
        removeSpy.mockRestore();
    });
});

describe('useCacheStatus', () => {
    const mockCache = {
        keys: vi.fn(),
    };

    beforeEach(() => {
        // Mock caches API
        Object.defineProperty(global, 'caches', {
            value: {
                open: vi.fn().mockResolvedValue(mockCache),
            },
            writable: true,
        });
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('returns empty array when cache has no entries', async () => {
        mockCache.keys.mockResolvedValue([]);

        const { result } = renderHook(() => useCacheStatus('test-cache'));

        await waitFor(() => {
            expect(result.current.isChecking).toBe(false);
        });

        expect(result.current.cachedUrls).toEqual([]);
    });

    it('returns cached URLs', async () => {
        mockCache.keys.mockResolvedValue([
            { url: 'https://example.com/image1.jpg' },
            { url: 'https://example.com/image2.jpg' },
        ]);

        const { result } = renderHook(() => useCacheStatus('test-cache'));

        await waitFor(() => {
            expect(result.current.isChecking).toBe(false);
        });

        expect(result.current.cachedUrls).toEqual([
            'https://example.com/image1.jpg',
            'https://example.com/image2.jpg',
        ]);
    });

    it('provides refresh function', async () => {
        mockCache.keys.mockResolvedValue([]);

        const { result } = renderHook(() => useCacheStatus('test-cache'));

        await waitFor(() => {
            expect(result.current.isChecking).toBe(false);
        });

        expect(typeof result.current.refresh).toBe('function');
    });
});

describe('useCacheStorage', () => {
    beforeEach(() => {
        // Mock navigator.storage
        Object.defineProperty(global.navigator, 'storage', {
            value: {
                estimate: vi.fn().mockResolvedValue({
                    usage: 1000000,
                    quota: 10000000,
                }),
            },
            writable: true,
            configurable: true,
        });
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('returns storage usage', async () => {
        const { result } = renderHook(() => useCacheStorage());

        await waitFor(() => {
            expect(result.current).not.toBeNull();
        });

        expect(result.current).toEqual({
            used: 1000000,
            quota: 10000000,
        });
    });

    it('returns null initially', () => {
        const { result } = renderHook(() => useCacheStorage());
        // Initially null before async completes
        expect(result.current).toBeNull();
    });
});
