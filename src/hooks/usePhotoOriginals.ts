/**
 * Full-size photo URL resolution for the signed-in viewer (photo architecture v2).
 *
 * The grid shows thumbnails; the lightbox / day gallery want the full-size original.
 * Historically the original was an asset on the `Photo` record, so `photo.url` carried
 * it. iOS is moving originals into per-journey `PhotoMedia` records, after which a
 * repacked photo's `photo.url` is empty and the original must be fetched on demand
 * (see mediaAdapter.fetchOriginalUrl).
 *
 * The upgrade chain, per photo, is:
 *   1. `photo.url` present            → use it (pre-repack original, or the public
 *                                        showcase's thumb-as-url — signed-out is thumbs
 *                                        only by design and never fetches).
 *   2. resolved PhotoMedia original   → use it once fetchOriginalUrl has returned.
 *   3. otherwise                      → the thumb. The thumb is always the floor, so a
 *                                        repacked photo is never a broken image.
 *
 * Resolution is lazy: callers `requestOriginal(photo)` for the photo(s) actually on
 * screen rather than firing a lookup for every photo in a journey (hundreds on
 * Kilimanjaro). Without a `journeySlug` — or when a photo already carries its url —
 * the hook is inert, so the signed-out showcase and pre-repack data are untouched.
 */

import { useCallback, useRef, useState } from 'react';
import type { Photo } from '../types/trek';
import { fetchOriginalUrl } from '../lib/journeys';

interface UsePhotoOriginalsReturn {
    /** Best full-size URL available right now for a photo (never empty when a thumb exists). */
    getFullSizeUrl: (photo: Photo) => string;
    /** Kick off (once) an on-demand original lookup for a photo that lacks one. */
    requestOriginal: (photo: Photo | undefined | null) => void;
}

export function usePhotoOriginals(
    journeySlug: string | undefined,
    getMediaUrl: (path: string) => string
): UsePhotoOriginalsReturn {
    const [originals, setOriginals] = useState<Record<string, string>>({});
    // Photo ids already requested this session — a Set in a ref so re-requesting is a
    // cheap no-op and does not itself trigger renders.
    const requested = useRef<Set<string>>(new Set());

    const requestOriginal = useCallback(
        (photo: Photo | undefined | null) => {
            // Inert unless we have a journey to resolve against and the photo actually
            // lacks its original (a non-empty url means the original is already in hand,
            // which is also the signed-out showcase's thumb-as-url case).
            if (!journeySlug || !photo || photo.url) return;
            if (requested.current.has(photo.id)) return;
            requested.current.add(photo.id);

            fetchOriginalUrl(photo.id, journeySlug)
                .then((url) => {
                    if (url) setOriginals((prev) => ({ ...prev, [photo.id]: url }));
                    // On null (miss / failure) allow a later retry; the thumb shows meanwhile.
                    else requested.current.delete(photo.id);
                })
                .catch(() => {
                    requested.current.delete(photo.id);
                });
        },
        [journeySlug]
    );

    const getFullSizeUrl = useCallback(
        (photo: Photo): string => {
            if (photo.url) return getMediaUrl(photo.url);
            const resolved = originals[photo.id];
            if (resolved) return getMediaUrl(resolved);
            // Floor: the thumb. Never a broken image.
            return getMediaUrl(photo.thumbnail_url || '');
        },
        [originals, getMediaUrl]
    );

    return { getFullSizeUrl, requestOriginal };
}
