import { describe, it, expect } from 'vitest';
import { buildMediaUrl, uploadPhoto, deletePhotoFiles } from './media';

describe('buildMediaUrl', () => {
    /**
     * Every CloudKit asset arrives as a complete, pre-authenticated
     * `cvws.icloud-content.com` URL. Prefixing it with the media Worker origin —
     * which is what happened before the passthrough — produced a 404 for all 1538
     * photos.
     */
    it('passes absolute URLs through untouched', () => {
        const assetUrl = 'https://cvws.icloud-content.com/B/AbC123/photo.jpg?o=token&v=1';
        expect(buildMediaUrl(assetUrl)).toBe(assetUrl);
    });

    it('passes http as well as https', () => {
        expect(buildMediaUrl('http://example.test/x.jpg')).toBe('http://example.test/x.jpg');
    });

    /**
     * The relative-path branch used to prepend the media Worker origin. It was dead
     * against the real schema (no `url` STRING on `Photo`, `RecordCoder` writes `""`),
     * and the Worker is being decommissioned — so an unresolvable reference must not
     * become a request to that host. LEG-05.
     */
    it('does not resolve a relative path against any origin', () => {
        expect(buildMediaUrl('journeys/j-1/photos/p-1.jpg')).toBe('');
    });

    it('resolves an absent url to an empty string, not a host', () => {
        expect(buildMediaUrl('')).toBe('');
    });
});

describe('media writes', () => {
    /**
     * Both used to be the R2 upload/delete path. They are native-only now, and they
     * must reject rather than resolve — a resolved no-op is how six components came to
     * animate shut over work that was never saved.
     */
    it('refuse loudly instead of pretending to succeed', async () => {
        await expect(uploadPhoto('j-1', new File([], 'x.jpg'))).rejects.toThrow(/native-only/);
        await expect(deletePhotoFiles('j-1', 'p-1')).rejects.toThrow(/native-only/);
    });
});
