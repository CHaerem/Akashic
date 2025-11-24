import { describe, it, expect } from 'vitest';
import {
    deg2rad,
    rad2deg,
    getDistanceFromLatLonInKm,
    calculateBearing,
    findCoordIndex,
    calculateRouteDistance
} from './geography';

describe('geography utilities', () => {
    describe('deg2rad', () => {
        it('converts 0 degrees to 0 radians', () => {
            expect(deg2rad(0)).toBe(0);
        });

        it('converts 180 degrees to PI radians', () => {
            expect(deg2rad(180)).toBeCloseTo(Math.PI);
        });

        it('converts 90 degrees to PI/2 radians', () => {
            expect(deg2rad(90)).toBeCloseTo(Math.PI / 2);
        });

        it('converts 360 degrees to 2*PI radians', () => {
            expect(deg2rad(360)).toBeCloseTo(2 * Math.PI);
        });

        it('handles negative degrees', () => {
            expect(deg2rad(-90)).toBeCloseTo(-Math.PI / 2);
        });
    });

    describe('rad2deg', () => {
        it('converts 0 radians to 0 degrees', () => {
            expect(rad2deg(0)).toBe(0);
        });

        it('converts PI radians to 180 degrees', () => {
            expect(rad2deg(Math.PI)).toBeCloseTo(180);
        });

        it('converts PI/2 radians to 90 degrees', () => {
            expect(rad2deg(Math.PI / 2)).toBeCloseTo(90);
        });

        it('is inverse of deg2rad', () => {
            expect(rad2deg(deg2rad(45))).toBeCloseTo(45);
            expect(rad2deg(deg2rad(123.456))).toBeCloseTo(123.456);
        });
    });

    describe('getDistanceFromLatLonInKm', () => {
        it('returns 0 for same coordinates', () => {
            expect(getDistanceFromLatLonInKm(0, 0, 0, 0)).toBe(0);
            expect(getDistanceFromLatLonInKm(52.5, 13.4, 52.5, 13.4)).toBe(0);
        });

        it('calculates distance between London and Paris (~344 km)', () => {
            // London: 51.5074, -0.1278
            // Paris: 48.8566, 2.3522
            const distance = getDistanceFromLatLonInKm(51.5074, -0.1278, 48.8566, 2.3522);
            expect(distance).toBeGreaterThan(340);
            expect(distance).toBeLessThan(350);
        });

        it('calculates distance between New York and Los Angeles (~3940 km)', () => {
            // NYC: 40.7128, -74.0060
            // LA: 34.0522, -118.2437
            const distance = getDistanceFromLatLonInKm(40.7128, -74.0060, 34.0522, -118.2437);
            expect(distance).toBeGreaterThan(3900);
            expect(distance).toBeLessThan(4000);
        });

        it('handles crossing the equator', () => {
            const distance = getDistanceFromLatLonInKm(1, 0, -1, 0);
            expect(distance).toBeGreaterThan(200);
            expect(distance).toBeLessThan(230);
        });

        it('handles crossing the prime meridian', () => {
            const distance = getDistanceFromLatLonInKm(0, 1, 0, -1);
            expect(distance).toBeGreaterThan(200);
            expect(distance).toBeLessThan(230);
        });
    });

    describe('calculateBearing', () => {
        it('returns 0 for due north', () => {
            const bearing = calculateBearing(0, 0, 1, 0);
            expect(bearing).toBeCloseTo(0, 0);
        });

        it('returns 90 for due east', () => {
            const bearing = calculateBearing(0, 0, 0, 1);
            expect(bearing).toBeCloseTo(90, 0);
        });

        it('returns 180 for due south', () => {
            const bearing = calculateBearing(1, 0, 0, 0);
            expect(bearing).toBeCloseTo(180, 0);
        });

        it('returns 270 for due west', () => {
            const bearing = calculateBearing(0, 1, 0, 0);
            expect(bearing).toBeCloseTo(270, 0);
        });

        it('returns value between 0 and 360', () => {
            const bearing = calculateBearing(51.5, -0.1, 48.8, 2.3);
            expect(bearing).toBeGreaterThanOrEqual(0);
            expect(bearing).toBeLessThan(360);
        });
    });

    describe('findCoordIndex', () => {
        const routeCoords: [number, number, number][] = [
            [37.3556, -3.0674, 1800],
            [37.3600, -3.0700, 2000],
            [37.3650, -3.0750, 2500],
            [37.3700, -3.0800, 3000]
        ];

        it('finds exact match at beginning', () => {
            expect(findCoordIndex(routeCoords, [37.3556, -3.0674])).toBe(0);
        });

        it('finds exact match in middle', () => {
            expect(findCoordIndex(routeCoords, [37.3650, -3.0750])).toBe(2);
        });

        it('finds match within tolerance', () => {
            expect(findCoordIndex(routeCoords, [37.35561, -3.06741])).toBe(0);
        });

        it('returns -1 for no match', () => {
            expect(findCoordIndex(routeCoords, [0, 0])).toBe(-1);
        });

        it('returns -1 for empty array', () => {
            expect(findCoordIndex([], [37.3556, -3.0674])).toBe(-1);
        });

        it('respects custom tolerance', () => {
            // Should not match with tight tolerance
            expect(findCoordIndex(routeCoords, [37.356, -3.068], 0.00001)).toBe(-1);
            // Should match with loose tolerance
            expect(findCoordIndex(routeCoords, [37.356, -3.068], 0.01)).toBe(0);
        });
    });

    describe('calculateRouteDistance', () => {
        it('returns 0 for empty array', () => {
            expect(calculateRouteDistance([])).toBe(0);
        });

        it('returns 0 for single point', () => {
            expect(calculateRouteDistance([[0, 0, 0]])).toBe(0);
        });

        it('calculates distance for two points', () => {
            const coords: [number, number, number][] = [
                [0, 0, 0],
                [0, 1, 0]
            ];
            const distance = calculateRouteDistance(coords);
            expect(distance).toBeGreaterThan(100);
            expect(distance).toBeLessThan(120);
        });

        it('sums distances along route', () => {
            const coords: [number, number, number][] = [
                [0, 0, 0],
                [0, 1, 0],
                [0, 2, 0]
            ];
            const distance = calculateRouteDistance(coords);
            // Should be roughly 2x the distance of a single segment
            expect(distance).toBeGreaterThan(200);
            expect(distance).toBeLessThan(240);
        });

        it('handles null/undefined', () => {
            expect(calculateRouteDistance(null as unknown as [number, number, number][])).toBe(0);
            expect(calculateRouteDistance(undefined as unknown as [number, number, number][])).toBe(0);
        });
    });
});
