import type { Photo } from '../types/trek';

interface PreloadOptions {
    cache?: Set<string>;
    createImage?: () => { src: string };
}

/**
 * Preload photo thumbnails to warm the browser cache before rendering.
 * Defaults to thumbnail_url when available, falls back to the full image url.
 */
export function preloadPhotoImages(
    photos: Photo[],
    getMediaUrl: (path: string) => string,
    { cache = new Set<string>(), createImage = () => new Image() }: PreloadOptions = {}
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
