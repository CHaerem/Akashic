/**
 * Tests for mapMatching.ts - Map Matching API wrapper
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tryMapMatching, processDrawnSegment, snapRouteToTrails, clearMatchCache } from './mapMatching';
import type { Coordinate, RouteCoordinate } from '../utils/routeUtils';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('mapMatching', () => {
    beforeEach(() => {
        mockFetch.mockClear();
        clearMatchCache(); // Clear cache before each test to prevent test pollution
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('tryMapMatching', () => {
        const testCoordinates: Coordinate[] = [
            [37.3544, -3.0674], // Kilimanjaro area
            [37.3545, -3.0675],
            [37.3546, -3.0676],
            [37.3547, -3.0677],
            [37.3548, -3.0678],
        ];

        const mockAccessToken = 'test-mapbox-token';

        it('returns empty result for less than 2 points', async () => {
            const result = await tryMapMatching([testCoordinates[0]], {
                accessToken: mockAccessToken,
            });

            expect(result.matched).toBe(false);
            expect(result.coordinates).toHaveLength(0);
            expect(result.confidence).toBe(0);
            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('returns original points for very short segments', async () => {
            // Two points very close together (less than MIN_SEGMENT_LENGTH)
            const shortSegment: Coordinate[] = [
                [37.3544, -3.0674],
                [37.35441, -3.06741], // ~1 meter apart
            ];

            const result = await tryMapMatching(shortSegment, {
                accessToken: mockAccessToken,
            });

            expect(result.matched).toBe(false);
            expect(result.coordinates).toHaveLength(2);
            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('calls Mapbox API with correct URL format', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    code: 'Ok',
                    matchings: [{
                        confidence: 0.8,
                        geometry: {
                            coordinates: [[37.3544, -3.0674], [37.3548, -3.0678]],
                            type: 'LineString'
                        },
                        legs: []
                    }]
                })
            });

            await tryMapMatching(testCoordinates, {
                accessToken: mockAccessToken,
                profile: 'walking',
                snapRadius: 25,
            });

            expect(mockFetch).toHaveBeenCalledTimes(1);
            const calledUrl = mockFetch.mock.calls[0][0];

            // Check URL structure
            expect(calledUrl).toContain('https://api.mapbox.com/matching/v5/mapbox/walking/');
            expect(calledUrl).toContain(`access_token=${mockAccessToken}`);
            expect(calledUrl).toContain('geometries=geojson');
            expect(calledUrl).toContain('radiuses=');
            expect(calledUrl).toContain('tidy=true');
            expect(calledUrl).toContain('overview=full');
        });

        it('returns matched result when API returns Ok', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    code: 'Ok',
                    matchings: [{
                        confidence: 0.85,
                        geometry: {
                            coordinates: [
                                [37.3544, -3.0674],
                                [37.3546, -3.0676],
                                [37.3548, -3.0678]
                            ],
                            type: 'LineString'
                        },
                        legs: []
                    }]
                })
            });

            const result = await tryMapMatching(testCoordinates, {
                accessToken: mockAccessToken,
            });

            expect(result.matched).toBe(true);
            expect(result.confidence).toBe(0.85);
            expect(result.coordinates).toHaveLength(3);
            // Check coordinates are RouteCoordinate format [lng, lat, elevation]
            expect(result.coordinates[0]).toEqual([37.3544, -3.0674, 0]);
        });

        it('returns not matched when confidence is below threshold', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    code: 'Ok',
                    matchings: [{
                        confidence: 0.3, // Below default 0.5 threshold
                        geometry: {
                            coordinates: [[37.3544, -3.0674], [37.3548, -3.0678]],
                            type: 'LineString'
                        },
                        legs: []
                    }]
                })
            });

            const result = await tryMapMatching(testCoordinates, {
                accessToken: mockAccessToken,
                minConfidence: 0.5,
            });

            expect(result.matched).toBe(false);
            expect(result.confidence).toBe(0.3);
            expect(result.coordinates).toHaveLength(2);
        });

        it('returns empty result when API returns NoMatch', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    code: 'NoMatch',
                    matchings: []
                })
            });

            const result = await tryMapMatching(testCoordinates, {
                accessToken: mockAccessToken,
            });

            expect(result.matched).toBe(false);
            expect(result.coordinates).toHaveLength(0);
            expect(result.confidence).toBe(0);
        });

        it('handles API error response', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 401,
                statusText: 'Unauthorized',
                text: () => Promise.resolve('Invalid token')
            });

            const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

            const result = await tryMapMatching(testCoordinates, {
                accessToken: 'invalid-token',
            });

            expect(result.matched).toBe(false);
            expect(result.coordinates).toHaveLength(0);
            expect(consoleSpy).toHaveBeenCalled();
        });

        it('handles network errors gracefully', async () => {
            mockFetch.mockRejectedValueOnce(new Error('Network error'));

            const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

            const result = await tryMapMatching(testCoordinates, {
                accessToken: mockAccessToken,
            });

            expect(result.matched).toBe(false);
            expect(result.coordinates).toHaveLength(0);
            expect(consoleSpy).toHaveBeenCalled();
        });

        it('samples points when exceeding 100 limit', async () => {
            // Create 150 points
            const manyPoints: Coordinate[] = [];
            for (let i = 0; i < 150; i++) {
                manyPoints.push([37.3544 + i * 0.001, -3.0674 + i * 0.001]);
            }

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    code: 'Ok',
                    matchings: [{
                        confidence: 0.9,
                        geometry: {
                            coordinates: [[37.3544, -3.0674], [37.5, -2.9]],
                            type: 'LineString'
                        },
                        legs: []
                    }]
                })
            });

            await tryMapMatching(manyPoints, {
                accessToken: mockAccessToken,
            });

            // Check that the URL contains sampled coordinates (should be <= 100)
            const calledUrl = mockFetch.mock.calls[0][0] as string;
            const coordsPart = calledUrl.split('/walking/')[1].split('?')[0];
            const coordCount = coordsPart.split(';').length;

            expect(coordCount).toBeLessThanOrEqual(100);
        });
    });

    describe('snapRouteToTrails', () => {
        const mockAccessToken = 'test-mapbox-token';

        // Create a realistic route with ~200 points
        const createTestRoute = (numPoints: number): RouteCoordinate[] => {
            const route: RouteCoordinate[] = [];
            for (let i = 0; i < numPoints; i++) {
                route.push([
                    37.3544 + i * 0.0005,
                    -3.0674 + i * 0.0003,
                    4500 + i * 10 // Elevation
                ]);
            }
            return route;
        };

        it('returns original route for less than 2 points', async () => {
            const shortRoute: RouteCoordinate[] = [[37.3544, -3.0674, 4500]];

            const result = await snapRouteToTrails(shortRoute, mockAccessToken);

            expect(result.coordinates).toEqual(shortRoute);
            expect(result.snappedSegments).toBe(0);
            expect(result.totalSegments).toBe(0);
            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('processes route in chunks of 80 points', async () => {
            const route = createTestRoute(200);

            // Mock successful responses for each chunk
            mockFetch.mockImplementation(() => Promise.resolve({
                ok: true,
                json: () => Promise.resolve({
                    code: 'Ok',
                    matchings: [{
                        confidence: 0.7,
                        geometry: {
                            coordinates: [[37.3544, -3.0674], [37.4, -3.0]],
                            type: 'LineString'
                        },
                        legs: []
                    }]
                })
            }));

            const progressUpdates: number[] = [];
            const result = await snapRouteToTrails(route, mockAccessToken, (progress) => {
                progressUpdates.push(progress);
            });

            // 200 points with chunk size 80 and overlap 5 = ~3 chunks
            expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(2);
            expect(result.totalSegments).toBeGreaterThanOrEqual(2);

            // Progress should go from 0 to 1
            expect(progressUpdates.length).toBeGreaterThan(0);
            expect(progressUpdates[progressUpdates.length - 1]).toBe(1);
        });

        it('preserves elevation data when snapping', async () => {
            const route: RouteCoordinate[] = [
                [37.3544, -3.0674, 4500],
                [37.3554, -3.0684, 4600],
                [37.3564, -3.0694, 4700],
            ];

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    code: 'Ok',
                    matchings: [{
                        confidence: 0.8,
                        geometry: {
                            coordinates: [
                                [37.3544, -3.0674],
                                [37.3550, -3.0680], // New point from snapping
                                [37.3564, -3.0694]
                            ],
                            type: 'LineString'
                        },
                        legs: []
                    }]
                })
            });

            const result = await snapRouteToTrails(route, mockAccessToken);

            // All result coordinates should have elevation
            result.coordinates.forEach(coord => {
                expect(coord).toHaveLength(3);
                expect(coord[2]).toBeGreaterThan(0); // Should have interpolated elevation
            });
        });

        it('keeps original chunks when API returns NoMatch', async () => {
            const route = createTestRoute(50); // Small route, single chunk

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    code: 'NoMatch',
                    matchings: []
                })
            });

            const result = await snapRouteToTrails(route, mockAccessToken);

            expect(result.snappedSegments).toBe(0);
            expect(result.totalSegments).toBe(1);
            // Route should be preserved (minus overlap handling)
            expect(result.coordinates.length).toBeGreaterThan(0);
        });

        it('reports correct statistics with partial failure', async () => {
            const route = createTestRoute(200);

            // Use mockResolvedValueOnce for sequential responses
            // First chunk succeeds
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    code: 'Ok',
                    matchings: [{
                        confidence: 0.75,
                        geometry: {
                            coordinates: [[37.3544, -3.0674], [37.4, -3.0]],
                            type: 'LineString'
                        },
                        legs: []
                    }]
                })
            });
            // Second chunk fails
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    code: 'NoMatch',
                    matchings: []
                })
            });
            // Third chunk succeeds
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    code: 'Ok',
                    matchings: [{
                        confidence: 0.75,
                        geometry: {
                            coordinates: [[37.5, -2.9], [37.6, -2.8]],
                            type: 'LineString'
                        },
                        legs: []
                    }]
                })
            });

            const result = await snapRouteToTrails(route, mockAccessToken);

            // Should have partial success (2 out of 3)
            expect(result.totalSegments).toBe(3);
            expect(result.snappedSegments).toBe(2);
        });
    });

    describe('processDrawnSegment', () => {
        const mockAccessToken = 'test-mapbox-token';

        it('returns empty for less than 2 points', async () => {
            const result = await processDrawnSegment([[37.3544, -3.0674]], mockAccessToken);

            expect(result.coordinates).toHaveLength(0);
            expect(result.wasSnapped).toBe(false);
        });

        it('uses snapped coordinates when match succeeds', async () => {
            // Use unique coordinates to avoid cache hits
            const drawnPoints: Coordinate[] = [
                [37.1111, -3.1111],
                [37.1121, -3.1121],
                [37.1131, -3.1131],
            ];

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    code: 'Ok',
                    matchings: [{
                        confidence: 0.9,
                        geometry: {
                            coordinates: [
                                [37.1112, -3.1112], // Slightly different - snapped
                                [37.1122, -3.1122],
                                [37.1132, -3.1132]
                            ],
                            type: 'LineString'
                        },
                        legs: []
                    }]
                })
            });

            const result = await processDrawnSegment(drawnPoints, mockAccessToken);

            expect(result.wasSnapped).toBe(true);
            expect(result.confidence).toBe(0.9);
            expect(result.coordinates).toHaveLength(3);
        });

        it('falls back to simplified freehand when no match', async () => {
            // Use unique coordinates to avoid cache hits
            const drawnPoints: Coordinate[] = [
                [37.2222, -3.2222],
                [37.2232, -3.2232],
                [37.2242, -3.2242],
            ];

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    code: 'NoMatch',
                    matchings: []
                })
            });

            const result = await processDrawnSegment(drawnPoints, mockAccessToken);

            expect(result.wasSnapped).toBe(false);
            expect(result.coordinates.length).toBeGreaterThan(0);
        });
    });

    describe('edge cases and error handling', () => {
        const mockAccessToken = 'test-mapbox-token';

        it('handles empty token gracefully', async () => {
            const coords: Coordinate[] = [
                [37.3544, -3.0674],
                [37.3554, -3.0684],
            ];

            // With empty token, API should return 401
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 401,
                statusText: 'Unauthorized',
                text: () => Promise.resolve('Not Authorized - Invalid Token')
            });

            vi.spyOn(console, 'warn').mockImplementation(() => {});

            const result = await tryMapMatching(coords, {
                accessToken: '', // Empty token
            });

            expect(result.matched).toBe(false);
            expect(result.coordinates).toHaveLength(0);
        });

        it('logs API response details for debugging', async () => {
            const coords: Coordinate[] = [
                [37.3544, -3.0674],
                [37.3554, -3.0684],
            ];

            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    code: 'NoSegment',
                    message: 'Could not find a matching segment'
                })
            });

            await tryMapMatching(coords, {
                accessToken: mockAccessToken,
            });

            // Should have logged request details
            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('[MapMatching]'),
                expect.anything(),
                expect.anything()
            );
        });

        it('handles malformed API response', async () => {
            const coords: Coordinate[] = [
                [37.3544, -3.0674],
                [37.3554, -3.0684],
            ];

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    // Missing expected fields
                    code: 'Ok',
                    // matchings is undefined
                })
            });

            const result = await tryMapMatching(coords, {
                accessToken: mockAccessToken,
            });

            expect(result.matched).toBe(false);
            expect(result.coordinates).toHaveLength(0);
        });
    });

    describe('integration scenarios', () => {
        const mockAccessToken = 'test-mapbox-token';

        it('handles real-world Kilimanjaro coordinates', async () => {
            // Real coordinates from the Kilimanjaro trek
            const kiliRoute: RouteCoordinate[] = [
                [37.3543701, -3.0673599, 4703],
                [37.3544006, -3.0674896, 4700],
                [37.3544312, -3.0676193, 4697],
                [37.3544617, -3.0677490, 4694],
                [37.3544922, -3.0678787, 4691],
            ];

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    code: 'Ok',
                    matchings: [{
                        confidence: 0.65,
                        geometry: {
                            coordinates: [
                                [37.3543701, -3.0673599],
                                [37.3544922, -3.0678787]
                            ],
                            type: 'LineString'
                        },
                        legs: []
                    }]
                })
            });

            const result = await snapRouteToTrails(kiliRoute, mockAccessToken);

            expect(result.coordinates.length).toBeGreaterThan(0);
            // Elevations should be preserved/interpolated
            result.coordinates.forEach(coord => {
                expect(coord[2]).toBeGreaterThanOrEqual(4690);
                expect(coord[2]).toBeLessThanOrEqual(4710);
            });
        });

        it('handles API rate limiting gracefully', async () => {
            const route = createTestRoute(200);

            // Simulate rate limit on second call
            let callCount = 0;
            mockFetch.mockImplementation(() => {
                callCount++;
                if (callCount === 2) {
                    return Promise.resolve({
                        ok: false,
                        status: 429,
                        statusText: 'Too Many Requests',
                        text: () => Promise.resolve('Rate limited')
                    });
                }
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        code: 'Ok',
                        matchings: [{
                            confidence: 0.8,
                            geometry: {
                                coordinates: [[37.3544, -3.0674], [37.4, -3.0]],
                                type: 'LineString'
                            },
                            legs: []
                        }]
                    })
                });
            });

            vi.spyOn(console, 'warn').mockImplementation(() => {});

            const result = await snapRouteToTrails(route, mockAccessToken);

            // Should still return a result (partial success)
            expect(result.coordinates.length).toBeGreaterThan(0);
        });

        // Helper function
        function createTestRoute(numPoints: number): RouteCoordinate[] {
            const route: RouteCoordinate[] = [];
            for (let i = 0; i < numPoints; i++) {
                route.push([
                    37.3544 + i * 0.0005,
                    -3.0674 + i * 0.0003,
                    4500 + i * 10
                ]);
            }
            return route;
        }
    });
});
