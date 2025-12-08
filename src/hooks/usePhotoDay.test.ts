import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePhotoDay } from './usePhotoDay';
import type { TrekData, Photo, Camp } from '../types/trek';

// Helper to create mock trek data
function createMockTrekData(overrides: Partial<TrekData> = {}): TrekData {
    return {
        id: 'test-trek',
        name: 'Test Trek',
        country: 'Test Country',
        description: 'A test trek',
        stats: {
            duration: 3,
            totalDistance: 30,
            totalElevationGain: 2000,
            highestPoint: { name: 'Summit', elevation: 5000 }
        },
        camps: [
            {
                id: 'camp-1',
                name: 'Camp 1',
                dayNumber: 1,
                elevation: 2000,
                coordinates: [37.0, -3.0],
                elevationGainFromPrevious: 0,
                notes: '',
                highlights: [],
                routeDistanceKm: 0,
                routePointIndex: 0,
            },
            {
                id: 'camp-2',
                name: 'Camp 2',
                dayNumber: 2,
                elevation: 3000,
                coordinates: [37.1, -3.1],
                elevationGainFromPrevious: 1000,
                notes: '',
                highlights: [],
                routeDistanceKm: 10,
                routePointIndex: 50,
            },
            {
                id: 'camp-3',
                name: 'Camp 3',
                dayNumber: 3,
                elevation: 4000,
                coordinates: [37.2, -3.2],
                elevationGainFromPrevious: 1000,
                notes: '',
                highlights: [],
                routeDistanceKm: 20,
                routePointIndex: 100,
            },
        ],
        route: {
            type: 'LineString',
            coordinates: Array.from({ length: 101 }, (_, i) => [
                37.0 + (i * 0.002),
                -3.0 - (i * 0.002),
                2000 + (i * 20)
            ])
        },
        dateStarted: '2024-01-01',
        ...overrides
    };
}

// Helper to create mock photo
function createMockPhoto(overrides: Partial<Photo> = {}): Photo {
    return {
        id: `photo-${Math.random().toString(36).substr(2, 9)}`,
        journey_id: 'test-journey',
        url: 'https://example.com/photo.jpg',
        ...overrides
    } as Photo;
}

describe('usePhotoDay', () => {
    describe('waypointToDayMap', () => {
        it('builds a map from waypoint IDs to day numbers', () => {
            const trekData = createMockTrekData();
            const { result } = renderHook(() => usePhotoDay(trekData, []));

            expect(result.current.waypointToDayMap.get('camp-1')).toBe(1);
            expect(result.current.waypointToDayMap.get('camp-2')).toBe(2);
            expect(result.current.waypointToDayMap.get('camp-3')).toBe(3);
        });

        it('returns empty map when no camps', () => {
            const trekData = createMockTrekData({ camps: [] });
            const { result } = renderHook(() => usePhotoDay(trekData, []));

            expect(result.current.waypointToDayMap.size).toBe(0);
        });
    });

    describe('getPhotoDay - Tier 1: Explicit waypoint_id', () => {
        it('returns day number from explicit waypoint_id assignment', () => {
            const trekData = createMockTrekData();
            const photo = createMockPhoto({ waypoint_id: 'camp-2' });

            const { result } = renderHook(() => usePhotoDay(trekData, [photo]));

            expect(result.current.getPhotoDay(photo)).toBe(2);
        });

        it('ignores invalid waypoint_id', () => {
            const trekData = createMockTrekData();
            const photo = createMockPhoto({ waypoint_id: 'invalid-camp' });

            const { result } = renderHook(() => usePhotoDay(trekData, [photo]));

            // Should fall through to other methods (returns null if no other matches)
            expect(result.current.getPhotoDay(photo)).toBeNull();
        });
    });

    describe('getPhotoDay - Tier 2: Date matching', () => {
        it('matches photo by date relative to journey start', () => {
            const trekData = createMockTrekData({ dateStarted: '2024-01-01' });
            const photo = createMockPhoto({
                taken_at: '2024-01-02T12:00:00Z' // Day 2
            });

            const { result } = renderHook(() => usePhotoDay(trekData, [photo]));

            expect(result.current.getPhotoDay(photo)).toBe(2);
        });

        it('returns day 1 for photo on start date', () => {
            const trekData = createMockTrekData({ dateStarted: '2024-01-01' });
            const photo = createMockPhoto({
                taken_at: '2024-01-01T15:00:00Z' // Day 1
            });

            const { result } = renderHook(() => usePhotoDay(trekData, [photo]));

            expect(result.current.getPhotoDay(photo)).toBe(1);
        });

        it('ignores date if outside journey duration', () => {
            const trekData = createMockTrekData({ dateStarted: '2024-01-01' }); // 3 day trek
            const photo = createMockPhoto({
                taken_at: '2024-01-10T12:00:00Z' // Day 10 - outside trek
            });

            const { result } = renderHook(() => usePhotoDay(trekData, [photo]));

            // Should fall through to location-based matching or return null
            expect(result.current.getPhotoDay(photo)).toBeNull();
        });

        it('skips date matching if journey has no start date', () => {
            const trekData = createMockTrekData({ dateStarted: undefined });
            const photo = createMockPhoto({
                taken_at: '2024-01-02T12:00:00Z'
            });

            const { result } = renderHook(() => usePhotoDay(trekData, [photo]));

            // Should fall through to other methods
            expect(result.current.getPhotoDay(photo)).toBeNull();
        });
    });

    describe('getPhotoDay - Tier 3: Location-based route matching', () => {
        it('matches photo near route to correct day segment', () => {
            const trekData = createMockTrekData();
            // Photo coordinates near route point ~60 (between camp 2 at index 50 and camp 3 at index 100)
            const photo = createMockPhoto({
                coordinates: [37.12, -3.12] // Near route point ~60
            });

            const { result } = renderHook(() => usePhotoDay(trekData, [photo]));

            // Should match to day 3 (next camp after route point 60)
            expect(result.current.getPhotoDay(photo)).toBe(3);
        });

        it('matches photo before first camp to day 1', () => {
            const trekData = createMockTrekData();
            // Photo at start of route
            const photo = createMockPhoto({
                coordinates: [37.0, -3.0]
            });

            const { result } = renderHook(() => usePhotoDay(trekData, [photo]));

            expect(result.current.getPhotoDay(photo)).toBe(1);
        });

        it('ignores photo far from route (>2km)', () => {
            const trekData = createMockTrekData();
            // Photo coordinates far from route
            const photo = createMockPhoto({
                coordinates: [40.0, -5.0] // ~300km away
            });

            const { result } = renderHook(() => usePhotoDay(trekData, [photo]));

            // Should fall through to nearest camp fallback, but also likely >5km away
            expect(result.current.getPhotoDay(photo)).toBeNull();
        });
    });

    describe('getPhotoDay - Tier 4: Nearest camp fallback', () => {
        it('matches photo to nearest camp within 5km', () => {
            const trekData = createMockTrekData({ route: undefined }); // No route for this test
            // Photo near camp 2
            const photo = createMockPhoto({
                coordinates: [37.105, -3.105] // Close to camp-2 at [37.1, -3.1]
            });

            const { result } = renderHook(() => usePhotoDay(trekData, [photo]));

            expect(result.current.getPhotoDay(photo)).toBe(2);
        });

        it('returns null if photo is >5km from all camps', () => {
            const trekData = createMockTrekData({ route: undefined });
            const photo = createMockPhoto({
                coordinates: [50.0, -10.0] // Far from all camps
            });

            const { result } = renderHook(() => usePhotoDay(trekData, [photo]));

            expect(result.current.getPhotoDay(photo)).toBeNull();
        });
    });

    describe('getPhotosForDay', () => {
        it('returns all photos for a specific day', () => {
            const trekData = createMockTrekData();
            const photos = [
                createMockPhoto({ id: 'p1', waypoint_id: 'camp-1' }),
                createMockPhoto({ id: 'p2', waypoint_id: 'camp-2' }),
                createMockPhoto({ id: 'p3', waypoint_id: 'camp-1' }),
                createMockPhoto({ id: 'p4', waypoint_id: 'camp-2' }),
            ];

            const { result } = renderHook(() => usePhotoDay(trekData, photos));

            const day1Photos = result.current.getPhotosForDay(1);
            expect(day1Photos).toHaveLength(2);
            expect(day1Photos.map(p => p.id)).toEqual(['p1', 'p3']);

            const day2Photos = result.current.getPhotosForDay(2);
            expect(day2Photos).toHaveLength(2);
            expect(day2Photos.map(p => p.id)).toEqual(['p2', 'p4']);
        });

        it('returns empty array for day with no photos', () => {
            const trekData = createMockTrekData();
            const photos = [
                createMockPhoto({ waypoint_id: 'camp-1' }),
            ];

            const { result } = renderHook(() => usePhotoDay(trekData, photos));

            expect(result.current.getPhotosForDay(3)).toEqual([]);
        });
    });

    describe('photosByDay', () => {
        it('groups photos by day number', () => {
            const trekData = createMockTrekData();
            const photos = [
                createMockPhoto({ id: 'p1', waypoint_id: 'camp-1' }),
                createMockPhoto({ id: 'p2', waypoint_id: 'camp-2' }),
                createMockPhoto({ id: 'p3', waypoint_id: 'camp-3' }),
            ];

            const { result } = renderHook(() => usePhotoDay(trekData, photos));

            expect(result.current.photosByDay[1]).toHaveLength(1);
            expect(result.current.photosByDay[2]).toHaveLength(1);
            expect(result.current.photosByDay[3]).toHaveLength(1);
            expect(result.current.photosByDay.unassigned).toHaveLength(0);
        });

        it('puts unmatched photos in unassigned group', () => {
            const trekData = createMockTrekData({ route: undefined });
            const photos = [
                createMockPhoto({ id: 'p1', waypoint_id: 'camp-1' }),
                createMockPhoto({ id: 'p2' }), // No waypoint, no date, no coords
                createMockPhoto({ id: 'p3', coordinates: [100, 100] }), // Far from everything
            ];

            const { result } = renderHook(() => usePhotoDay(trekData, photos));

            expect(result.current.photosByDay[1]).toHaveLength(1);
            expect(result.current.photosByDay.unassigned).toHaveLength(2);
        });

        it('initializes all day groups even with no photos', () => {
            const trekData = createMockTrekData();

            const { result } = renderHook(() => usePhotoDay(trekData, []));

            expect(result.current.photosByDay[1]).toEqual([]);
            expect(result.current.photosByDay[2]).toEqual([]);
            expect(result.current.photosByDay[3]).toEqual([]);
            expect(result.current.photosByDay.unassigned).toEqual([]);
        });
    });

    describe('memoization', () => {
        it('memoizes waypointToDayMap when camps do not change', () => {
            const trekData = createMockTrekData();
            const { result, rerender } = renderHook(() => usePhotoDay(trekData, []));

            const firstMap = result.current.waypointToDayMap;
            rerender();
            const secondMap = result.current.waypointToDayMap;

            expect(firstMap).toBe(secondMap);
        });

        it('updates waypointToDayMap when camps change', () => {
            const trekData1 = createMockTrekData();
            const { result, rerender } = renderHook(
                ({ data }) => usePhotoDay(data, []),
                { initialProps: { data: trekData1 } }
            );

            const firstMap = result.current.waypointToDayMap;

            const trekData2 = createMockTrekData({
                camps: [
                    ...trekData1.camps,
                    {
                        id: 'camp-4',
                        name: 'Camp 4',
                        dayNumber: 4,
                        elevation: 5000,
                        coordinates: [37.3, -3.3],
                        elevationGainFromPrevious: 1000,
                        notes: '',
                        highlights: [],
                    },
                ]
            });

            rerender({ data: trekData2 });
            const secondMap = result.current.waypointToDayMap;

            expect(firstMap).not.toBe(secondMap);
            expect(secondMap.get('camp-4')).toBe(4);
        });
    });
});
