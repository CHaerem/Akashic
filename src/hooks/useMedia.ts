/**
 * Media URL helpers for components.
 *
 * There is no longer a token to wait for: CloudKit asset URLs are absolute and
 * pre-authenticated. The hook keeps its shape (including `token` and `loading`, which
 * callers gate their first render on) so components did not have to change with T3.4.
 */

import { useCallback } from 'react';
import { buildMediaUrl, getJourneyPhotoPath } from '../lib/media';

interface UseMediaReturn {
    /** Always null — CloudKit assets carry their own authorisation. */
    token: null;
    /** Build a loadable URL for any media path or absolute asset URL. */
    getMediaUrl: (path: string) => string;
    /** Legacy relative path for a journey photo (pre-CloudKit objects). */
    getPhotoUrl: (journeyId: string, photoId: string, extension?: string) => string;
    /** Always false — nothing is fetched here any more. */
    loading: false;
}

export function useMedia(): UseMediaReturn {
    const getMediaUrl = useCallback((path: string) => buildMediaUrl(path), []);

    const getPhotoUrl = useCallback(
        (journeyId: string, photoId: string, extension = 'jpg') =>
            buildMediaUrl(getJourneyPhotoPath(journeyId, photoId, extension)),
        []
    );

    return { token: null, getMediaUrl, getPhotoUrl, loading: false };
}
