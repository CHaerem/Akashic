import type { Photo } from '../types/trek';

interface PreloadOptions {
    cache?: Set<string>;
    createImage?: () => {
        src: string;
        decode?: () => Promise<void>;
        onload?: () => void;
        onerror?: () => void;
    };
}

/**
 * Preload photo thumbnails to warm the browser cache before rendering.
 * Defaults to thumbnail_url when available, falls back to the full image url.
 */
export function preloadPhotoImages(
    photos: Photo[],
    getMediaUrl: (path: string) => string,
    { cache = new Set<string>(), createImage = () => new Image() }: PreloadOptions = {},
) {
    photos.forEach(photo => {
        const path = photo.thumbnail_url ?? photo.url;
        if (!path) return;

        const url = getMediaUrl(path);
        if (cache.has(url)) return;

        cache.add(url);
        const img = createImage();
        img.src = url;
    });

    return cache;
}

/**
 * Preload and decode thumbnails, resolving once the browser has the pixels ready.
 * This helps avoid decode-induced hitches during transitions.
 */
export async function preloadPhotoImagesAsync(
    photos: Photo[],
    getMediaUrl: (path: string) => string,
    { cache = new Set<string>(), createImage = () => new Image() }: PreloadOptions = {},
) {
    const loads: Promise<void>[] = [];

    photos.forEach(photo => {
        const path = photo.thumbnail_url ?? photo.url;
        if (!path) return;

        const url = getMediaUrl(path);
        if (cache.has(url)) return;

        cache.add(url);
        const img = createImage();

        const waitForDecode = new Promise<void>(resolve => {
            const resolveOnce = () => resolve();
            if (typeof img.decode === 'function') {
                img.decode().then(resolveOnce).catch(resolveOnce);
            } else {
                img.onload = resolveOnce;
                img.onerror = resolveOnce;
            }
        });

        img.src = url;
        loads.push(waitForDecode);
    });

    await Promise.allSettled(loads);
    return cache;
}
