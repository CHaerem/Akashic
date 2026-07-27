/**
 * Media URL helpers for components.
 *
 * There is no longer a token to wait for: CloudKit asset URLs are absolute and
 * pre-authenticated. The hook keeps its shape (including `token` and `loading`, which
 * callers gate their first render on) so components did not have to change with T3.4.
 *
 * `getPhotoUrl` is gone with LEG-05. It built `journeys/<id>/photos/<id>.jpg` for the
 * media Worker to resolve, and no CloudKit record can carry a path like that — see the
 * note in `lib/media.ts`.
 */

import { useCallback } from 'react';
import { buildMediaUrl } from '../lib/media';

interface UseMediaReturn {
    /** Always null — CloudKit assets carry their own authorisation. */
    token: null;
    /** Build a loadable URL for a CloudKit asset URL. */
    getMediaUrl: (path: string) => string;
    /** Always false — nothing is fetched here any more. */
    loading: false;
}

export function useMedia(): UseMediaReturn {
    const getMediaUrl = useCallback((path: string) => buildMediaUrl(path), []);

    return { token: null, getMediaUrl, loading: false };
}
