import { describe, it, expect } from 'vitest';
import { buildMediaUrl, getJourneyPhotoPath } from './media';

describe('media utilities', () => {
    describe('buildMediaUrl', () => {
        it('builds URL without token when not provided', () => {
            const url = buildMediaUrl('journeys/123/photos/abc.jpg');
            expect(url).toBe('https://akashic-media.chris-haerem.workers.dev/journeys/123/photos/abc.jpg');
        });

        it('builds URL without token when null', () => {
            const url = buildMediaUrl('journeys/123/photos/abc.jpg', null);
            expect(url).toBe('https://akashic-media.chris-haerem.workers.dev/journeys/123/photos/abc.jpg');
        });

        it('builds URL without token when undefined', () => {
            const url = buildMediaUrl('journeys/123/photos/abc.jpg', undefined);
            expect(url).toBe('https://akashic-media.chris-haerem.workers.dev/journeys/123/photos/abc.jpg');
        });

        it('appends token as query parameter', () => {
            const url = buildMediaUrl('journeys/123/photos/abc.jpg', 'my-token');
            expect(url).toBe('https://akashic-media.chris-haerem.workers.dev/journeys/123/photos/abc.jpg?token=my-token');
        });

        it('encodes special characters in token', () => {
            const url = buildMediaUrl('path/to/file.jpg', 'token+with/special=chars&more');
            expect(url).toContain('?token=token%2Bwith%2Fspecial%3Dchars%26more');
        });

        it('handles empty path', () => {
            const url = buildMediaUrl('');
            expect(url).toBe('https://akashic-media.chris-haerem.workers.dev/');
        });

        it('handles paths with special characters', () => {
            const url = buildMediaUrl('journeys/uuid-123/photos/photo with spaces.jpg', 'token');
            expect(url).toBe('https://akashic-media.chris-haerem.workers.dev/journeys/uuid-123/photos/photo with spaces.jpg?token=token');
        });
    });

    describe('getJourneyPhotoPath', () => {
        it('generates correct path with default extension', () => {
            const path = getJourneyPhotoPath('journey-uuid', 'photo-uuid');
            expect(path).toBe('journeys/journey-uuid/photos/photo-uuid.jpg');
        });

        it('uses custom extension when provided', () => {
            const path = getJourneyPhotoPath('journey-uuid', 'photo-uuid', 'png');
            expect(path).toBe('journeys/journey-uuid/photos/photo-uuid.png');
        });

        it('handles UUID format IDs', () => {
            const path = getJourneyPhotoPath(
                'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
                'f0e1d2c3-b4a5-6789-0123-456789abcdef',
                'webp'
            );
            expect(path).toBe(
                'journeys/a1b2c3d4-e5f6-7890-abcd-ef1234567890/photos/f0e1d2c3-b4a5-6789-0123-456789abcdef.webp'
            );
        });

        it('handles empty strings', () => {
            const path = getJourneyPhotoPath('', '', '');
            expect(path).toBe('journeys//photos/.');
        });

        it('does not encode special characters in IDs', () => {
            const path = getJourneyPhotoPath('journey/with/slashes', 'photo', 'jpg');
            expect(path).toBe('journeys/journey/with/slashes/photos/photo.jpg');
        });
    });
});
