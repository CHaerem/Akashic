import type { Photo } from '../types/trek';

interface PrefetchOptions {
  cache?: Set<string>;
}

/**
 * Preload photo thumbnails/urls to warm browser cache before view transitions.
 */
export async function preloadPhotoImagesAsync(
  photos: Photo[],
  getMediaUrl: (path: string) => string,
  options: PrefetchOptions = {}
): Promise<Set<string>> {
  const cache = options.cache ?? new Set<string>();

  const loaders = photos.map((photo) => {
    const src = getMediaUrl(photo.thumbnail_url || photo.url);
    if (cache.has(src)) return Promise.resolve(cache);

    cache.add(src);
    return new Promise<Set<string>>((resolve) => {
      const img = new Image();
      img.onload = img.onerror = () => resolve(cache);
      img.src = src;
    });
  });

  await Promise.all(loaders);
  return cache;
}
