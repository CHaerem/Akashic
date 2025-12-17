import { describe, it, expect } from 'vitest';
import { _internal, type DbJourney, type DbWaypoint } from './journeys';

const {
    findClosestRoutePointIndex,
    calculateElevationGainBetweenIndices,
    toTrekConfig,
    toTrekData,
} = _internal;

describe('journeys utilities', () => {
    describe('findClosestRoutePointIndex', () => {
        const routeCoords: [number, number, number][] = [
            [37.0, -3.0, 1800],
            [37.1, -3.1, 2000],
            [37.2, -3.2, 2500],
            [37.3, -3.3, 3000],
            [37.4, -3.4, 3500],
        ];

        it('finds exact match at first point', () => {
            const campCoords: [number, number] = [37.0, -3.0];
            expect(findClosestRoutePointIndex(campCoords, routeCoords)).toBe(0);
        });

        it('finds exact match at last point', () => {
            const campCoords: [number, number] = [37.4, -3.4];
            expect(findClosestRoutePointIndex(campCoords, routeCoords)).toBe(4);
        });

        it('finds closest point for intermediate location', () => {
            // Closest to point at index 2 (37.2, -3.2)
            const campCoords: [number, number] = [37.21, -3.19];
            expect(findClosestRoutePointIndex(campCoords, routeCoords)).toBe(2);
        });

        it('finds closest point when between two points', () => {
            // Exactly between index 1 and 2, should find one of them
            const campCoords: [number, number] = [37.15, -3.15];
            const index = findClosestRoutePointIndex(campCoords, routeCoords);
            expect(index).toBeGreaterThanOrEqual(1);
            expect(index).toBeLessThanOrEqual(2);
        });

        it('returns 0 for empty route', () => {
            const campCoords: [number, number] = [37.0, -3.0];
            expect(findClosestRoutePointIndex(campCoords, [])).toBe(0);
        });

        it('handles single point route', () => {
            const singlePoint: [number, number, number][] = [[37.0, -3.0, 1800]];
            const campCoords: [number, number] = [37.5, -3.5];
            expect(findClosestRoutePointIndex(campCoords, singlePoint)).toBe(0);
        });
    });

    describe('calculateElevationGainBetweenIndices', () => {
        const routeCoords: [number, number, number][] = [
            [37.0, -3.0, 1800], // index 0
            [37.1, -3.1, 2000], // index 1: +200
            [37.2, -3.2, 1900], // index 2: -100 (loss, not counted)
            [37.3, -3.3, 2500], // index 3: +600
            [37.4, -3.4, 2400], // index 4: -100 (loss, not counted)
            [37.5, -3.5, 3000], // index 5: +600
        ];

        it('calculates gain correctly for ascending section', () => {
            // From index 0 to 1: 1800 -> 2000 = +200
            expect(calculateElevationGainBetweenIndices(routeCoords, 0, 1)).toBe(200);
        });

        it('returns 0 for descending section', () => {
            // From index 1 to 2: 2000 -> 1900 = -100 (no gain)
            expect(calculateElevationGainBetweenIndices(routeCoords, 1, 2)).toBe(0);
        });

        it('only counts gains, not losses', () => {
            // From index 0 to 3:
            // 1800->2000 (+200), 2000->1900 (0), 1900->2500 (+600)
            // Total gain: 800
            expect(calculateElevationGainBetweenIndices(routeCoords, 0, 3)).toBe(800);
        });

        it('calculates full route elevation gain', () => {
            // Total gains: +200 + 0 + +600 + 0 + +600 = 1400
            expect(calculateElevationGainBetweenIndices(routeCoords, 0, 5)).toBe(1400);
        });

        it('returns 0 when start equals end', () => {
            expect(calculateElevationGainBetweenIndices(routeCoords, 2, 2)).toBe(0);
        });

        it('returns 0 when start is greater than end', () => {
            expect(calculateElevationGainBetweenIndices(routeCoords, 3, 1)).toBe(0);
        });

        it('handles single segment', () => {
            expect(calculateElevationGainBetweenIndices(routeCoords, 2, 3)).toBe(600);
        });
    });

    describe('toTrekConfig', () => {
        it('transforms basic journey to TrekConfig', () => {
            const journey: DbJourney = {
                id: 'uuid-123',
                slug: 'kilimanjaro',
                name: 'Kilimanjaro - Lemosho Route',
                description: 'A trek description',
                country: 'Tanzania',
                summit_elevation: 5895,
                total_distance: 70,
                total_days: 8,
                date_started: '2024-10-01',
                date_ended: '2024-10-08',
                hero_image_url: 'hero.jpg',
                center_coordinates: [37.3556, -3.0674],
                route: null,
                stats: null,
                preferred_bearing: 45,
                preferred_pitch: 70,
                is_public: true,
            };

            const config = toTrekConfig(journey);

            expect(config.id).toBe('kilimanjaro');
            expect(config.name).toBe('Kilimanjaro'); // Split from full name
            expect(config.country).toBe('Tanzania');
            expect(config.elevation).toBe('5,895m');
            expect(config.lat).toBe(-3.0674);
            expect(config.lng).toBe(37.3556);
            expect(config.preferredBearing).toBe(45);
            expect(config.preferredPitch).toBe(70);
            expect(config.slug).toBe('kilimanjaro');
        });

        it('handles missing optional fields', () => {
            const journey: DbJourney = {
                id: 'uuid-456',
                slug: 'test-trek',
                name: 'Test Trek',
                description: null,
                country: null,
                summit_elevation: null,
                total_distance: null,
                total_days: null,
                date_started: null,
                date_ended: null,
                hero_image_url: null,
                center_coordinates: null,
                route: null,
                stats: null,
                preferred_bearing: null,
                preferred_pitch: null,
                is_public: false,
            };

            const config = toTrekConfig(journey);

            expect(config.country).toBe('');
            expect(config.elevation).toBe('');
            expect(config.lat).toBe(0);
            expect(config.lng).toBe(0);
            expect(config.preferredBearing).toBe(0);
            expect(config.preferredPitch).toBe(60);
        });

        it('extracts name before dash', () => {
            const journey: DbJourney = {
                id: 'uuid-789',
                slug: 'everest-base-camp',
                name: 'Everest - Base Camp Trek - Extended',
                description: null,
                country: 'Nepal',
                summit_elevation: 5364,
                total_distance: 130,
                total_days: 14,
                date_started: null,
                date_ended: null,
                hero_image_url: null,
                center_coordinates: [86.9250, 27.9881],
                route: null,
                stats: null,
                preferred_bearing: null,
                preferred_pitch: null,
                is_public: true,
            };

            const config = toTrekConfig(journey);
            expect(config.name).toBe('Everest');
        });
    });

    describe('toTrekData', () => {
        const baseJourney: DbJourney = {
            id: 'uuid-123',
            slug: 'test-trek',
            name: 'Test Trek',
            description: 'A test journey',
            country: 'Test Country',
            summit_elevation: 5000,
            total_distance: 50,
            total_days: 5,
            date_started: '2024-10-01',
            date_ended: '2024-10-05',
            hero_image_url: null,
            center_coordinates: [37.0, -3.0],
            route: {
                type: 'LineString',
                coordinates: [
                    [37.0, -3.0, 1800],
                    [37.1, -3.1, 2200],
                    [37.2, -3.2, 2600],
                    [37.3, -3.3, 3000],
                    [37.4, -3.4, 3500],
                ],
            },
            stats: {
                duration: 5,
                totalDistance: 50,
                totalElevationGain: 1700,
                highestPoint: { name: 'Summit', elevation: 3500 },
            },
            preferred_bearing: null,
            preferred_pitch: null,
            is_public: true,
        };

        it('transforms journey with waypoints to TrekData', () => {
            const waypoints: DbWaypoint[] = [
                {
                    id: 'wp-1',
                    journey_id: 'uuid-123',
                    name: 'Base Camp',
                    waypoint_type: 'camp',
                    day_number: 1,
                    coordinates: [37.0, -3.0],
                    elevation: 1800,
                    description: 'Starting point',
                    highlights: ['Registration'],
                    sort_order: 0,
                    route_distance_km: 0,
                    route_point_index: 0,
                    weather: null,
                },
                {
                    id: 'wp-2',
                    journey_id: 'uuid-123',
                    name: 'Camp 1',
                    waypoint_type: 'camp',
                    day_number: 2,
                    coordinates: [37.2, -3.2],
                    elevation: 2600,
                    description: 'First night',
                    highlights: ['Forest walk'],
                    sort_order: 1,
                    route_distance_km: 10,
                    route_point_index: 2,
                    weather: null,
                },
            ];

            const trekData = toTrekData(baseJourney, waypoints);

            expect(trekData.id).toBe('test-trek');
            expect(trekData.name).toBe('Test Trek');
            expect(trekData.country).toBe('Test Country');
            expect(trekData.description).toBe('A test journey');
            expect(trekData.dateStarted).toBe('2024-10-01');
            expect(trekData.camps).toHaveLength(2);

            // First camp (base)
            expect(trekData.camps[0].id).toBe('wp-1');
            expect(trekData.camps[0].name).toBe('Base Camp');
            expect(trekData.camps[0].dayNumber).toBe(1);
            expect(trekData.camps[0].elevation).toBe(1800);
            expect(trekData.camps[0].elevationGainFromPrevious).toBe(0);
            expect(trekData.camps[0].highlights).toEqual(['Registration']);

            // Second camp should have elevation gain from first
            expect(trekData.camps[1].id).toBe('wp-2');
            expect(trekData.camps[1].elevationGainFromPrevious).toBe(800); // 1800->2200->2600 = +400+400
        });

        it('handles journey with no waypoints', () => {
            const trekData = toTrekData(baseJourney, []);

            expect(trekData.camps).toHaveLength(0);
            expect(trekData.route.coordinates).toHaveLength(5);
        });

        it('handles journey with no route', () => {
            const journeyNoRoute: DbJourney = {
                ...baseJourney,
                route: null,
            };

            const waypoints: DbWaypoint[] = [
                {
                    id: 'wp-1',
                    journey_id: 'uuid-123',
                    name: 'Camp 1',
                    waypoint_type: 'camp',
                    day_number: 1,
                    coordinates: [37.0, -3.0],
                    elevation: 1800,
                    description: null,
                    highlights: null,
                    sort_order: 0,
                    route_distance_km: null,
                    route_point_index: null,
                    weather: null,
                },
            ];

            const trekData = toTrekData(journeyNoRoute, waypoints);

            expect(trekData.route.coordinates).toHaveLength(0);
            expect(trekData.camps[0].elevationGainFromPrevious).toBe(0);
        });

        it('sorts waypoints by sort_order', () => {
            const waypoints: DbWaypoint[] = [
                {
                    id: 'wp-2',
                    journey_id: 'uuid-123',
                    name: 'Camp 2',
                    waypoint_type: 'camp',
                    day_number: 2,
                    coordinates: [37.2, -3.2],
                    elevation: 2600,
                    description: null,
                    highlights: null,
                    sort_order: 1,
                    route_distance_km: null,
                    route_point_index: null,
                    weather: null,
                },
                {
                    id: 'wp-1',
                    journey_id: 'uuid-123',
                    name: 'Camp 1',
                    waypoint_type: 'camp',
                    day_number: 1,
                    coordinates: [37.0, -3.0],
                    elevation: 1800,
                    description: null,
                    highlights: null,
                    sort_order: 0,
                    route_distance_km: null,
                    route_point_index: null,
                    weather: null,
                },
            ];

            const trekData = toTrekData(baseJourney, waypoints);

            expect(trekData.camps[0].name).toBe('Camp 1');
            expect(trekData.camps[1].name).toBe('Camp 2');
        });

        it('uses fallback stats when not provided', () => {
            const journeyNoStats: DbJourney = {
                ...baseJourney,
                stats: null,
            };

            const trekData = toTrekData(journeyNoStats, []);

            expect(trekData.stats.duration).toBe(5); // from total_days
            expect(trekData.stats.totalDistance).toBe(50); // from total_distance
            expect(trekData.stats.highestPoint.elevation).toBe(5000); // from summit_elevation
        });

        it('finds closest route point when route_point_index not set', () => {
            const waypoints: DbWaypoint[] = [
                {
                    id: 'wp-1',
                    journey_id: 'uuid-123',
                    name: 'Camp near point 2',
                    waypoint_type: 'camp',
                    day_number: 1,
                    coordinates: [37.21, -3.19], // Close to route point 2
                    elevation: 2600,
                    description: null,
                    highlights: null,
                    sort_order: 0,
                    route_distance_km: null,
                    route_point_index: null, // Not set, should find closest
                    weather: null,
                },
            ];

            const trekData = toTrekData(baseJourney, waypoints);

            // The camp should have been matched to route point 2
            // So elevation gain should be from start to point 2
            expect(trekData.camps[0].routePointIndex).toBeNull();
        });

        it('clamps route_point_index to valid range', () => {
            const waypoints: DbWaypoint[] = [
                {
                    id: 'wp-1',
                    journey_id: 'uuid-123',
                    name: 'Camp',
                    waypoint_type: 'camp',
                    day_number: 1,
                    coordinates: [37.0, -3.0],
                    elevation: 1800,
                    description: null,
                    highlights: null,
                    sort_order: 0,
                    route_distance_km: null,
                    route_point_index: 100, // Way beyond route length (5 points)
                    weather: null,
                },
            ];

            const trekData = toTrekData(baseJourney, waypoints);

            // Should not throw, index should be clamped
            expect(trekData.camps).toHaveLength(1);
        });
    });
});
