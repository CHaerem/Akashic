import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Photo } from '../../types/trek';

// Mock Supabase
const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockEq = vi.fn();
const mockOrder = vi.fn();
const mockSingle = vi.fn();

const mockFrom = vi.fn(() => ({
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
    delete: mockDelete,
}));

vi.mock('../supabase', () => ({
    supabase: {
        from: (table: string) => mockFrom(table),
    },
}));

// Mock media module for deletePhotoFiles
vi.mock('../media', () => ({
    deletePhotoFiles: vi.fn().mockResolvedValue(undefined),
}));

// Import after mocks
import {
    fetchPhotos,
    createPhoto,
    updatePhoto,
    deletePhoto,
    assignPhotoToWaypoint,
    getPhotosForWaypoint,
} from './photoAPI';

describe('photoAPI', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        // Setup chain mocks
        mockSelect.mockReturnValue({
            eq: mockEq,
            order: mockOrder,
            single: mockSingle,
        });
        mockInsert.mockReturnValue({
            select: () => ({ single: mockSingle }),
        });
        mockUpdate.mockReturnValue({
            eq: mockEq,
        });
        mockDelete.mockReturnValue({
            eq: mockEq,
        });
        mockEq.mockReturnValue({
            order: mockOrder,
            select: () => ({ single: mockSingle }),
            single: mockSingle,
        });
        mockOrder.mockReturnValue({
            order: mockOrder,
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('fetchPhotos', () => {
        it('fetches photos for a journey', async () => {
            const mockPhotos = [
                { id: 'photo-1', journey_id: 'journey-1', url: 'photo1.jpg', coordinates: [1, 2] },
                { id: 'photo-2', journey_id: 'journey-1', url: 'photo2.jpg', coordinates: [3, 4] },
            ];

            mockOrder.mockReturnValueOnce({
                order: vi.fn().mockResolvedValue({ data: mockPhotos, error: null }),
            });

            const result = await fetchPhotos('journey-1');

            expect(mockFrom).toHaveBeenCalledWith('photos');
            expect(mockSelect).toHaveBeenCalledWith('*');
            expect(result).toHaveLength(2);
            expect(result[0].id).toBe('photo-1');
        });

        it('transforms GeoJSON coordinates to simple arrays', async () => {
            const mockPhotos = [
                {
                    id: 'photo-1',
                    journey_id: 'journey-1',
                    url: 'photo1.jpg',
                    coordinates: { type: 'Point', coordinates: [37.5, -3.2] },
                },
            ];

            mockOrder.mockReturnValueOnce({
                order: vi.fn().mockResolvedValue({ data: mockPhotos, error: null }),
            });

            const result = await fetchPhotos('journey-1');

            expect(result[0].coordinates).toEqual([37.5, -3.2]);
        });

        it('handles null coordinates', async () => {
            const mockPhotos = [
                { id: 'photo-1', journey_id: 'journey-1', url: 'photo1.jpg', coordinates: null },
            ];

            mockOrder.mockReturnValueOnce({
                order: vi.fn().mockResolvedValue({ data: mockPhotos, error: null }),
            });

            const result = await fetchPhotos('journey-1');

            expect(result[0].coordinates).toBeNull();
        });

        it('returns empty array on error', async () => {
            mockOrder.mockReturnValueOnce({
                order: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
            });

            const result = await fetchPhotos('journey-1');

            expect(result).toEqual([]);
        });
    });

    describe('createPhoto', () => {
        it('creates a photo with all fields', async () => {
            const newPhoto = {
                journey_id: 'journey-1',
                url: 'photos/new-photo.jpg',
                thumbnail_url: 'photos/new-photo_thumb.jpg',
                caption: 'Test caption',
                coordinates: [37.5, -3.2] as [number, number],
                taken_at: '2024-01-15T10:30:00Z',
            };

            const createdPhoto = { id: 'photo-new', ...newPhoto };
            mockSingle.mockResolvedValueOnce({ data: createdPhoto, error: null });

            const result = await createPhoto(newPhoto);

            expect(mockFrom).toHaveBeenCalledWith('photos');
            expect(mockInsert).toHaveBeenCalledWith(newPhoto);
            expect(result?.id).toBe('photo-new');
            expect(result?.caption).toBe('Test caption');
        });

        it('throws error on insert failure', async () => {
            mockSingle.mockResolvedValueOnce({ data: null, error: { message: 'Insert failed' } });

            await expect(createPhoto({
                journey_id: 'journey-1',
                url: 'photo.jpg',
            })).rejects.toThrow('Insert failed');
        });
    });

    describe('updatePhoto', () => {
        it('updates photo caption', async () => {
            const updatedPhoto = { id: 'photo-1', caption: 'New caption' };
            mockSingle.mockResolvedValueOnce({ data: updatedPhoto, error: null });
            mockEq.mockReturnValueOnce({
                select: () => ({ single: mockSingle }),
            });

            const result = await updatePhoto('photo-1', { caption: 'New caption' });

            expect(mockFrom).toHaveBeenCalledWith('photos');
            expect(mockUpdate).toHaveBeenCalledWith({ caption: 'New caption' });
            expect(result?.caption).toBe('New caption');
        });

        it('updates photo as hero', async () => {
            const updatedPhoto = { id: 'photo-1', is_hero: true };
            mockSingle.mockResolvedValueOnce({ data: updatedPhoto, error: null });
            mockEq.mockReturnValueOnce({
                select: () => ({ single: mockSingle }),
            });

            const result = await updatePhoto('photo-1', { is_hero: true });

            expect(mockUpdate).toHaveBeenCalledWith({ is_hero: true });
            expect(result?.is_hero).toBe(true);
        });

        it('updates photo coordinates', async () => {
            const newCoords: [number, number] = [38.0, -4.0];
            const updatedPhoto = { id: 'photo-1', coordinates: newCoords };
            mockSingle.mockResolvedValueOnce({ data: updatedPhoto, error: null });
            mockEq.mockReturnValueOnce({
                select: () => ({ single: mockSingle }),
            });

            const result = await updatePhoto('photo-1', { coordinates: newCoords });

            expect(mockUpdate).toHaveBeenCalledWith({ coordinates: newCoords });
        });

        it('throws error on update failure', async () => {
            mockSingle.mockResolvedValueOnce({ data: null, error: { message: 'Update failed' } });
            mockEq.mockReturnValueOnce({
                select: () => ({ single: mockSingle }),
            });

            await expect(updatePhoto('photo-1', { caption: 'test' })).rejects.toThrow('Update failed');
        });
    });

    describe('deletePhoto', () => {
        it('deletes photo from DB and R2', async () => {
            // First call: fetch photo to get journey_id
            mockSingle.mockResolvedValueOnce({
                data: { id: 'photo-1', journey_id: 'journey-1' },
                error: null,
            });

            // Second call: delete from DB
            mockEq.mockReturnValueOnce({
                single: mockSingle,
            });
            mockEq.mockResolvedValueOnce({ error: null });

            const result = await deletePhoto('photo-1');

            expect(result).toBe(true);
            expect(mockFrom).toHaveBeenCalledWith('photos');
        });

        it('throws error if photo not found', async () => {
            mockSingle.mockResolvedValueOnce({ data: null, error: null });

            await expect(deletePhoto('nonexistent')).rejects.toThrow('Photo not found');
        });

        it('continues with DB delete even if R2 delete fails', async () => {
            // Fetch photo
            mockSingle.mockResolvedValueOnce({
                data: { id: 'photo-1', journey_id: 'journey-1' },
                error: null,
            });

            // Mock R2 delete to fail
            const { deletePhotoFiles } = await import('../media');
            vi.mocked(deletePhotoFiles).mockRejectedValueOnce(new Error('R2 error'));

            // DB delete succeeds
            mockEq.mockReturnValueOnce({ single: mockSingle });
            mockEq.mockResolvedValueOnce({ error: null });

            // Should not throw - DB delete still happens
            const result = await deletePhoto('photo-1');
            expect(result).toBe(true);
        });
    });

    describe('assignPhotoToWaypoint', () => {
        it('assigns photo to waypoint', async () => {
            mockEq.mockResolvedValueOnce({ error: null });

            const result = await assignPhotoToWaypoint('photo-1', 'waypoint-1');

            expect(mockFrom).toHaveBeenCalledWith('photos');
            expect(mockUpdate).toHaveBeenCalledWith({ waypoint_id: 'waypoint-1' });
            expect(result).toBe(true);
        });

        it('unassigns photo from waypoint with null', async () => {
            mockEq.mockResolvedValueOnce({ error: null });

            const result = await assignPhotoToWaypoint('photo-1', null);

            expect(mockUpdate).toHaveBeenCalledWith({ waypoint_id: null });
            expect(result).toBe(true);
        });

        it('throws error on assignment failure', async () => {
            mockEq.mockResolvedValueOnce({ error: { message: 'Assignment failed' } });

            await expect(assignPhotoToWaypoint('photo-1', 'waypoint-1')).rejects.toThrow('Assignment failed');
        });
    });

    describe('getPhotosForWaypoint', () => {
        it('fetches photos for a specific waypoint', async () => {
            const mockPhotos = [
                { id: 'photo-1', waypoint_id: 'waypoint-1', url: 'photo1.jpg' },
                { id: 'photo-2', waypoint_id: 'waypoint-1', url: 'photo2.jpg' },
            ];

            mockEq.mockReturnValueOnce({
                order: vi.fn().mockReturnValue({
                    order: vi.fn().mockResolvedValue({ data: mockPhotos, error: null }),
                }),
            });

            const result = await getPhotosForWaypoint('waypoint-1');

            expect(mockFrom).toHaveBeenCalledWith('photos');
            expect(result).toHaveLength(2);
        });

        it('transforms GeoJSON coordinates', async () => {
            const mockPhotos = [
                {
                    id: 'photo-1',
                    waypoint_id: 'waypoint-1',
                    coordinates: { type: 'Point', coordinates: [37.5, -3.2] },
                },
            ];

            mockEq.mockReturnValueOnce({
                order: vi.fn().mockReturnValue({
                    order: vi.fn().mockResolvedValue({ data: mockPhotos, error: null }),
                }),
            });

            const result = await getPhotosForWaypoint('waypoint-1');

            expect(result[0].coordinates).toEqual([37.5, -3.2]);
        });

        it('returns empty array on error', async () => {
            mockEq.mockReturnValueOnce({
                order: vi.fn().mockReturnValue({
                    order: vi.fn().mockResolvedValue({ data: null, error: { message: 'Error' } }),
                }),
            });

            const result = await getPhotosForWaypoint('waypoint-1');

            expect(result).toEqual([]);
        });
    });
});
