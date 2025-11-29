/**
 * Hook for loading authenticated media from R2 storage
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { buildMediaUrl, getJourneyPhotoPath } from '../lib/media';

interface UseMediaReturn {
    /** Current access token (may be null if not authenticated) */
    token: string | null;
    /** Build an authenticated URL for any media path */
    getMediaUrl: (path: string) => string;
    /** Get authenticated photo URL (using journey UUID) */
    getPhotoUrl: (journeyId: string, photoId: string, extension?: string) => string;
    /** Whether the token is being loaded */
    loading: boolean;
}

/**
 * Hook that provides authenticated media URLs
 * Automatically refreshes when auth state changes
 */
export function useMedia(): UseMediaReturn {
    const [token, setToken] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!supabase) {
            setLoading(false);
            return;
        }

        // Get initial session
        supabase.auth.getSession().then(({ data: { session } }) => {
            setToken(session?.access_token ?? null);
            setLoading(false);
        });

        // Listen for auth changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            setToken(session?.access_token ?? null);
        });

        return () => subscription.unsubscribe();
    }, []);

    const getMediaUrl = useCallback((path: string) => {
        return buildMediaUrl(path, token);
    }, [token]);

    const getPhotoUrl = useCallback((journeyId: string, photoId: string, extension = 'jpg') => {
        return buildMediaUrl(getJourneyPhotoPath(journeyId, photoId, extension), token);
    }, [token]);

    return {
        token,
        getMediaUrl,
        getPhotoUrl,
        loading,
    };
}
