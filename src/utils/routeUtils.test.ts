import { describe, it, expect } from 'vitest';
import {
    douglasPeucker,
    simplifyRoute,
    samplePoints,
    SIMPLIFY_TOLERANCE,
    haversineDistance,
    type Coordinate,
    type RouteCoordinate
} from './routeUtils';

describe('douglasPeucker', () => {
    it('returns same points for 2 or fewer points', () => {
        const single: Coordinate[] = [[0, 0]];
        const two: Coordinate[] = [[0, 0], [1, 1]];

        expect(douglasPeucker(single, 0.1)).toEqual(single);
        expect(douglasPeucker(two, 0.1)).toEqual(two);
    });

    it('simplifies a straight line to just endpoints', () => {
        // Points along a straight line from (0,0) to (1,1)
        const points: Coordinate[] = [
            [0, 0],
            [0.25, 0.25],
            [0.5, 0.5],
            [0.75, 0.75],
            [1, 1]
        ];

        const result = douglasPeucker(points, 0.01);
        expect(result).toEqual([[0, 0], [1, 1]]);
    });

    it('preserves points that deviate from the line', () => {
        // Points with a significant bend in the middle
        const points: Coordinate[] = [
            [0, 0],
            [0.5, 0.5],  // slightly off line
            [0.5, 1],    // significant deviation
            [1, 1]
        ];

        // With a large epsilon, should simplify to endpoints
        const simplified = douglasPeucker(points, 1);
        expect(simplified.length).toBeLessThan(points.length);

        // With a tiny epsilon, should keep all points that deviate
        const detailed = douglasPeucker(points, 0.001);
        expect(detailed.length).toBeGreaterThanOrEqual(3);
    });

    it('handles a zigzag pattern', () => {
        // Zigzag pattern that should be preserved
        const points: Coordinate[] = [
            [0, 0],
            [1, 1],
            [2, 0],
            [3, 1],
            [4, 0]
        ];

        // With small epsilon, should keep all points
        const result = douglasPeucker(points, 0.01);
        expect(result.length).toBe(5);
    });

    it('uses SIMPLIFY_TOLERANCE presets correctly', () => {
        // Create a route with some noise
        const points: Coordinate[] = [];
        for (let i = 0; i <= 100; i++) {
            const x = i / 100;
            // Add small noise (< 5m in degrees)
            const noise = (Math.random() - 0.5) * 0.00002;
            points.push([x, x + noise]);
        }

        const high = douglasPeucker(points, SIMPLIFY_TOLERANCE.high);
        const medium = douglasPeucker(points, SIMPLIFY_TOLERANCE.medium);
        const low = douglasPeucker(points, SIMPLIFY_TOLERANCE.low);

        // More aggressive tolerance should result in fewer points
        expect(low.length).toBeLessThanOrEqual(medium.length);
        expect(medium.length).toBeLessThanOrEqual(high.length);
    });
});

describe('simplifyRoute', () => {
    it('preserves elevation data', () => {
        const route: RouteCoordinate[] = [
            [0, 0, 100],
            [0.5, 0, 150],
            [1, 0, 200]
        ];

        const simplified = simplifyRoute(route, 0.1);

        // All points should have elevation
        simplified.forEach(point => {
            expect(point[2]).toBeGreaterThan(0);
        });
    });

    it('simplifies while keeping elevations from nearest original points', () => {
        // Create a route with varying elevations
        const route: RouteCoordinate[] = [
            [0, 0, 1000],
            [0.25, 0.25, 1100],
            [0.5, 0.5, 1200],
            [0.75, 0.75, 1300],
            [1, 1, 1400]
        ];

        const simplified = simplifyRoute(route, 0.1);

        // Should have at least endpoints
        expect(simplified.length).toBeGreaterThanOrEqual(2);

        // First and last should match original elevations
        expect(simplified[0][2]).toBe(1000);
        expect(simplified[simplified.length - 1][2]).toBe(1400);
    });
});

describe('samplePoints', () => {
    it('returns all points if count is below max', () => {
        const points = [[0, 0], [1, 1], [2, 2]];
        expect(samplePoints(points, 10)).toEqual(points);
    });

    it('samples evenly across the array', () => {
        const points = Array.from({ length: 100 }, (_, i) => [i, i]);
        const sampled = samplePoints(points, 10);

        expect(sampled.length).toBe(10);
        // First and last should be preserved
        expect(sampled[0]).toEqual([0, 0]);
        expect(sampled[sampled.length - 1]).toEqual([99, 99]);
    });

    it('always includes first and last points', () => {
        const points = [[0, 0], [1, 1], [2, 2], [3, 3], [4, 4]];
        const sampled = samplePoints(points, 3);

        expect(sampled[0]).toEqual([0, 0]);
        expect(sampled[sampled.length - 1]).toEqual([4, 4]);
    });

    it('works with single point', () => {
        const points = [[5, 5]];
        expect(samplePoints(points, 10)).toEqual([[5, 5]]);
    });
});

describe('haversineDistance', () => {
    it('returns 0 for same point', () => {
        const point: Coordinate = [0, 0];
        expect(haversineDistance(point, point)).toBe(0);
    });

    it('calculates approximate distance for known coordinates', () => {
        // London to Paris is approximately 344 km
        const london: Coordinate = [-0.1276, 51.5074];
        const paris: Coordinate = [2.3522, 48.8566];

        const distance = haversineDistance(london, paris);
        expect(distance).toBeGreaterThan(330);
        expect(distance).toBeLessThan(360);
    });

    it('is symmetric', () => {
        const a: Coordinate = [10, 20];
        const b: Coordinate = [30, 40];

        expect(haversineDistance(a, b)).toBeCloseTo(haversineDistance(b, a));
    });

    it('works with RouteCoordinate (3-element arrays)', () => {
        const a: RouteCoordinate = [0, 0, 100];
        const b: RouteCoordinate = [1, 1, 200];

        // Should ignore elevation and just use lng/lat
        const distance = haversineDistance(a, b);
        expect(distance).toBeGreaterThan(0);
    });
});
