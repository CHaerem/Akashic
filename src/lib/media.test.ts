import { describe, it, expect } from 'vitest';
import { buildMediaUrl, getJourneyPhotoPath } from './media';

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

    it('resolves a legacy relative path against the media origin', () => {
        expect(buildMediaUrl('journeys/j-1/photos/p-1.jpg')).toMatch(
            /^https?:\/\/.+\/journeys\/j-1\/photos\/p-1\.jpg$/
        );
    });

    it('builds the legacy photo path', () => {
        expect(getJourneyPhotoPath('j-1', 'p-1')).toBe('journeys/j-1/photos/p-1.jpg');
        expect(getJourneyPhotoPath('j-1', 'p-1', 'heic')).toBe('journeys/j-1/photos/p-1.heic');
    });
});
