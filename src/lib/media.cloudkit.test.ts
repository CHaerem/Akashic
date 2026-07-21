import { describe, it, expect, vi } from 'vitest';

// Force CloudKit mode for the whole module graph.
vi.mock('./backend', () => ({ isCloudKitBackend: true, dataBackend: 'cloudkit' }));
vi.mock('./supabase', () => ({ supabase: null, isAuthEnabled: false }));

import { getAccessToken, buildMediaUrl, uploadPhoto, deletePhotoFiles } from './media';

describe('media (cloudkit mode)', () => {
    it('getAccessToken returns null (no bearer token in CloudKit)', async () => {
        expect(await getAccessToken()).toBeNull();
    });

    it('buildMediaUrl passes through absolute https URLs unchanged, ignoring the token', () => {
        const assetUrl = 'https://cvws.icloud-content.com/B/abc/photo.jpg?o=signed-token';
        expect(buildMediaUrl(assetUrl)).toBe(assetUrl);
        expect(buildMediaUrl(assetUrl, 'ignored-token')).toBe(assetUrl);
        expect(buildMediaUrl('http://example.com/y.jpg', 'ignored')).toBe('http://example.com/y.jpg');
    });

    it('buildMediaUrl still resolves relative paths against the media base', () => {
        expect(buildMediaUrl('journeys/1/photos/a.jpg')).toBe(
            'https://akashic-media.chris-haerem.workers.dev/journeys/1/photos/a.jpg'
        );
    });

    it('uploadPhoto throws a clear native-only error', async () => {
        const file = new File(['x'], 't.jpg', { type: 'image/jpeg' });
        await expect(uploadPhoto('journey-1', file, false)).rejects.toThrow(/native-only/);
    });

    it('deletePhotoFiles throws a clear native-only error', async () => {
        await expect(deletePhotoFiles('journey-1', 'photo-1')).rejects.toThrow(/native-only/);
    });
});
