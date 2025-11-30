import { describe, expect, it, vi } from 'vitest';
import type { Photo } from '../types/trek';
import { preloadPhotoImages } from './photoPrefetch';

describe('preloadPhotoImages', () => {
    const photos: Photo[] = [
        {
            id: '1',
            journey_id: 'journey',
            url: '/full/image-1.jpg',
            thumbnail_url: '/thumbs/image-1.jpg',
        },
        {
            id: '2',
            journey_id: 'journey',
            url: '/full/image-2.jpg',
            // no thumbnail
        },
        {
            id: '3',
            journey_id: 'journey',
            url: '/full/image-1-duplicate.jpg',
            thumbnail_url: '/thumbs/image-1.jpg',
        },
    ];

    it('preloads thumbnails and falls back to full image paths', () => {
        const created: string[] = [];
        const cache = new Set<string>();
        const createImage = () => ({
            get src() {
                return '';
            },
            set src(value: string) {
                created.push(value);
            }
        });

        preloadPhotoImages(photos, path => `https://cdn.test${path}`, { cache, createImage });

        expect(created).toEqual([
            'https://cdn.test/thumbs/image-1.jpg',
            'https://cdn.test/full/image-2.jpg',
        ]);
        // Cache should record the warmed URLs
        expect(cache.has('https://cdn.test/thumbs/image-1.jpg')).toBe(true);
        expect(cache.has('https://cdn.test/full/image-2.jpg')).toBe(true);
    });

    it('avoids reloading cached URLs', () => {
        const createImage = vi.fn(() => ({ src: '' }));
        const cache = new Set<string>(['https://cdn.test/thumbs/image-1.jpg']);

        preloadPhotoImages(photos, path => `https://cdn.test${path}`, { cache, createImage });

        expect(createImage).toHaveBeenCalledTimes(1);
        expect(cache.size).toBe(2);
        expect(cache.has('https://cdn.test/thumbs/image-1.jpg')).toBe(true);
        expect(cache.has('https://cdn.test/full/image-2.jpg')).toBe(true);
    });
});
