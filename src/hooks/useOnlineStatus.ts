import { useState, useEffect, useCallback } from 'react';

export interface OnlineStatus {
    isOnline: boolean;
    wasOffline: boolean; // Track if we were recently offline
}

export function useOnlineStatus(): OnlineStatus {
    const [isOnline, setIsOnline] = useState(() =>
        typeof navigator !== 'undefined' ? navigator.onLine : true
    );
    const [wasOffline, setWasOffline] = useState(false);

    useEffect(() => {
        const handleOnline = () => {
            setIsOnline(true);
            // Keep wasOffline true for a short time to show reconnection message
            setTimeout(() => setWasOffline(false), 3000);
        };

        const handleOffline = () => {
            setIsOnline(false);
            setWasOffline(true);
        };

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);

    return { isOnline, wasOffline };
}

// Hook to check if a specific resource is cached
export function useCacheStatus(cacheName: string) {
    const [cachedUrls, setCachedUrls] = useState<string[]>([]);
    const [isChecking, setIsChecking] = useState(false);

    const checkCache = useCallback(async () => {
        if (!('caches' in window)) return;

        setIsChecking(true);
        try {
            const cache = await caches.open(cacheName);
            const keys = await cache.keys();
            setCachedUrls(keys.map(req => req.url));
        } catch {
            console.warn(`Failed to check cache: ${cacheName}`);
        }
        setIsChecking(false);
    }, [cacheName]);

    useEffect(() => {
        checkCache();
    }, [checkCache]);

    return { cachedUrls, isChecking, refresh: checkCache };
}

// Hook to get cache storage usage
export function useCacheStorage() {
    const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null);

    useEffect(() => {
        const checkStorage = async () => {
            if ('storage' in navigator && 'estimate' in navigator.storage) {
                try {
                    const estimate = await navigator.storage.estimate();
                    setUsage({
                        used: estimate.usage || 0,
                        quota: estimate.quota || 0
                    });
                } catch {
                    // Storage API not available
                }
            }
        };

        checkStorage();
        // Check periodically
        const interval = setInterval(checkStorage, 30000);
        return () => clearInterval(interval);
    }, []);

    return usage;
}
