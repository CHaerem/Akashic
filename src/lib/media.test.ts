import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildMediaUrl, getJourneyPhotoPath, uploadPhoto, deletePhotoFiles } from './media';

// Mock Supabase for getAccessToken
vi.mock('./supabase', () => ({
    supabase: {
        auth: {
            getSession: vi.fn(),
        },
    },
}));

// Mock global fetch
const mockFetch = vi.fn();

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

    describe('uploadPhoto', () => {
        beforeEach(() => {
            vi.stubGlobal('fetch', mockFetch);
            mockFetch.mockReset();
        });

        afterEach(() => {
            vi.unstubAllGlobals();
        });

        it('throws error when not authenticated', async () => {
            const { supabase } = await import('./supabase');
            vi.mocked(supabase!.auth.getSession).mockResolvedValue({
                data: { session: null },
                error: null,
            });

            const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' });

            await expect(uploadPhoto('journey-1', file, false)).rejects.toThrow('Authentication required');
        });

        it('uploads photo to correct endpoint', async () => {
            const { supabase } = await import('./supabase');
            vi.mocked(supabase!.auth.getSession).mockResolvedValue({
                data: { session: { access_token: 'test-token' } as any },
                error: null,
            });

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    photoId: 'photo-123',
                    path: 'journeys/journey-1/photos/photo-123.jpg',
                    size: 1024,
                    contentType: 'image/jpeg',
                }),
            });

            const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' });
            const result = await uploadPhoto('journey-1', file, false);

            expect(mockFetch).toHaveBeenCalledWith(
                'https://akashic-media.chris-haerem.workers.dev/upload/journeys/journey-1/photos',
                expect.objectContaining({
                    method: 'POST',
                    headers: {
                        'Authorization': 'Bearer test-token',
                    },
                })
            );
            expect(result.photoId).toBe('photo-123');
        });

        it('throws error on upload failure', async () => {
            const { supabase } = await import('./supabase');
            vi.mocked(supabase!.auth.getSession).mockResolvedValue({
                data: { session: { access_token: 'test-token' } as any },
                error: null,
            });

            mockFetch.mockResolvedValueOnce({
                ok: false,
                json: () => Promise.resolve({ error: 'File too large' }),
            });

            const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' });

            await expect(uploadPhoto('journey-1', file, false)).rejects.toThrow('File too large');
        });

        it('returns result with photo details', async () => {
            const { supabase } = await import('./supabase');
            vi.mocked(supabase!.auth.getSession).mockResolvedValue({
                data: { session: { access_token: 'test-token' } as any },
                error: null,
            });

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    photoId: 'abc-123',
                    path: 'journeys/j1/photos/abc-123.jpg',
                    size: 2048,
                    contentType: 'image/jpeg',
                }),
            });

            const file = new File(['image data'], 'photo.jpg', { type: 'image/jpeg' });
            const result = await uploadPhoto('j1', file, false);

            expect(result).toEqual({
                photoId: 'abc-123',
                path: 'journeys/j1/photos/abc-123.jpg',
                size: 2048,
                contentType: 'image/jpeg',
            });
        });
    });

    describe('deletePhotoFiles', () => {
        beforeEach(() => {
            vi.stubGlobal('fetch', mockFetch);
            mockFetch.mockReset();
        });

        afterEach(() => {
            vi.unstubAllGlobals();
        });

        it('throws error when not authenticated', async () => {
            const { supabase } = await import('./supabase');
            vi.mocked(supabase!.auth.getSession).mockResolvedValue({
                data: { session: null },
                error: null,
            });

            await expect(deletePhotoFiles('journey-1', 'photo-1')).rejects.toThrow('Authentication required');
        });

        it('sends DELETE request to correct endpoint', async () => {
            const { supabase } = await import('./supabase');
            vi.mocked(supabase!.auth.getSession).mockResolvedValue({
                data: { session: { access_token: 'test-token' } as any },
                error: null,
            });

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ success: true }),
            });

            const result = await deletePhotoFiles('journey-1', 'photo-1');

            expect(mockFetch).toHaveBeenCalledWith(
                'https://akashic-media.chris-haerem.workers.dev/journeys/journey-1/photos/photo-1',
                expect.objectContaining({
                    method: 'DELETE',
                    headers: {
                        'Authorization': 'Bearer test-token',
                    },
                })
            );
            expect(result).toBe(true);
        });

        it('throws error on delete failure', async () => {
            const { supabase } = await import('./supabase');
            vi.mocked(supabase!.auth.getSession).mockResolvedValue({
                data: { session: { access_token: 'test-token' } as any },
                error: null,
            });

            mockFetch.mockResolvedValueOnce({
                ok: false,
                json: () => Promise.resolve({ error: 'Photo not found' }),
            });

            await expect(deletePhotoFiles('journey-1', 'photo-1')).rejects.toThrow('Photo not found');
        });
    });
});
