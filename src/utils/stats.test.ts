import { describe, it, expect } from 'vitest';
import { calculateStats, generateElevationProfile } from './stats';
import type { TrekData } from '../types/trek';

describe('stats utilities', () => {
    describe('calculateStats', () => {
        const mockTrekData: TrekData = {
            id: 'test-trek',
            name: 'Test Trek',
            country: 'Test Country',
            description: 'Test description',
            stats: {
                duration: 7,
                totalDistance: 70,
                totalElevationGain: 3000,
                highestPoint: { name: 'Peak', elevation: 5000 }
            },
            camps: [
                { id: 'c1', name: 'Camp 1', dayNumber: 1, elevation: 2000, coordinates: [0, 0], elevationGainFromPrevious: 500, notes: '' },
                { id: 'c2', name: 'Camp 2', dayNumber: 2, elevation: 2500, coordinates: [0, 0], elevationGainFromPrevious: 800, notes: '' },
                { id: 'c3', name: 'Camp 3', dayNumber: 3, elevation: 3000, coordinates: [0, 0], elevationGainFromPrevious: 300, notes: '' },
                { id: 'c4', name: 'Camp 4', dayNumber: 4, elevation: 4000, coordinates: [0, 0], elevationGainFromPrevious: 1200, notes: '' },
                { id: 'c5', name: 'Camp 5', dayNumber: 5, elevation: 4200, coordinates: [0, 0], elevationGainFromPrevious: 200, notes: '' }
            ],
            route: {
                type: 'LineString',
                coordinates: [[37.0, -3.0, 1800]]
            }
        };

        it('calculates average daily distance', () => {
            const stats = calculateStats(mockTrekData);
            expect(stats.avgDailyDistance).toBe('10.0');
        });

        it('finds maximum daily elevation gain', () => {
            const stats = calculateStats(mockTrekData);
            expect(stats.maxDailyGain).toBe(1200);
        });

        it('extracts start elevation from route', () => {
            const stats = calculateStats(mockTrekData);
            expect(stats.startElevation).toBe(1800);
        });

        it('handles trek with no elevation gain', () => {
            const flatTrek: TrekData = {
                ...mockTrekData,
                camps: [
                    { id: 'c1', name: 'Camp 1', dayNumber: 1, elevation: 2000, coordinates: [0, 0], elevationGainFromPrevious: 0, notes: '' },
                    { id: 'c2', name: 'Camp 2', dayNumber: 2, elevation: 2000, coordinates: [0, 0], elevationGainFromPrevious: 0, notes: '' }
                ]
            };
            const stats = calculateStats(flatTrek);
            expect(stats.maxDailyGain).toBe(0);
        });
    });

    describe('generateElevationProfile', () => {
        it('returns null for empty coordinates', () => {
            expect(generateElevationProfile([])).toBeNull();
        });

        it('returns null for null/undefined', () => {
            expect(generateElevationProfile(null as unknown as [number, number, number][])).toBeNull();
            expect(generateElevationProfile(undefined as unknown as [number, number, number][])).toBeNull();
        });

        it('generates profile for valid coordinates', () => {
            const coords: [number, number, number][] = [
                [37.0, -3.0, 1800],
                [37.1, -3.1, 2200],
                [37.2, -3.2, 2800],
                [37.3, -3.3, 3500]
            ];
            const profile = generateElevationProfile(coords);

            expect(profile).not.toBeNull();
            expect(profile!.minEle).toBe(1800);
            expect(profile!.maxEle).toBe(3500);
            expect(profile!.totalDist).toBeGreaterThan(0);
        });

        it('generates valid SVG paths', () => {
            const coords: [number, number, number][] = [
                [37.0, -3.0, 1800],
                [37.1, -3.1, 2200],
                [37.2, -3.2, 2800]
            ];
            const profile = generateElevationProfile(coords);

            expect(profile!.linePath).toMatch(/^M /);
            expect(profile!.linePath).toContain(' L ');
            expect(profile!.areaPath).toContain(' Z');
        });

        it('handles single point', () => {
            const coords: [number, number, number][] = [[37.0, -3.0, 2000]];
            const profile = generateElevationProfile(coords);

            expect(profile).not.toBeNull();
            expect(profile!.minEle).toBe(2000);
            expect(profile!.maxEle).toBe(2000);
            expect(profile!.totalDist).toBe(0);
        });

        it('handles flat terrain (same elevation)', () => {
            const coords: [number, number, number][] = [
                [37.0, -3.0, 2000],
                [37.1, -3.1, 2000],
                [37.2, -3.2, 2000]
            ];
            const profile = generateElevationProfile(coords);

            expect(profile!.minEle).toBe(2000);
            expect(profile!.maxEle).toBe(2000);
        });

        it('calculates plot elevation range with padding', () => {
            const coords: [number, number, number][] = [
                [37.0, -3.0, 1000],
                [37.1, -3.1, 2000]
            ];
            const profile = generateElevationProfile(coords);

            // plotMinEle should be less than minEle (padding)
            expect(profile!.plotMinEle).toBeLessThan(profile!.minEle);
            // plotMaxEle should be greater than maxEle (padding)
            expect(profile!.plotMaxEle).toBeGreaterThan(profile!.maxEle);
        });

        it('includes raw points with SVG coordinates', () => {
            const coords: [number, number, number][] = [
                [37.0, -3.0, 1800],
                [37.1, -3.1, 2200],
                [37.2, -3.2, 2800]
            ];
            const profile = generateElevationProfile(coords);

            expect(profile!.points).toBeDefined();
            expect(profile!.points.length).toBe(3);

            // Each point should have dist, ele, x, y
            profile!.points.forEach(point => {
                expect(point).toHaveProperty('dist');
                expect(point).toHaveProperty('ele');
                expect(point).toHaveProperty('x');
                expect(point).toHaveProperty('y');
            });

            // First point should be at x=0
            expect(profile!.points[0].x).toBe(0);
            expect(profile!.points[0].dist).toBe(0);

            // Last point should be at x=300 (SVG width)
            expect(profile!.points[2].x).toBe(300);
        });

        it('generates camp markers when camps are provided', () => {
            const coords: [number, number, number][] = [
                [37.0, -3.0, 1800],
                [37.05, -3.05, 2000],
                [37.1, -3.1, 2200],
                [37.15, -3.15, 2400],
                [37.2, -3.2, 2800]
            ];
            const camps = [
                { id: 'c1', name: 'Camp 1', dayNumber: 1, elevation: 2000, coordinates: [37.05, -3.05] as [number, number], elevationGainFromPrevious: 200, notes: '' },
                { id: 'c2', name: 'Camp 2', dayNumber: 2, elevation: 2400, coordinates: [37.15, -3.15] as [number, number], elevationGainFromPrevious: 400, notes: '' }
            ];

            const profile = generateElevationProfile(coords, camps);

            expect(profile!.campMarkers).toBeDefined();
            expect(profile!.campMarkers.length).toBe(2);

            // First camp marker
            expect(profile!.campMarkers[0].campId).toBe('c1');
            expect(profile!.campMarkers[0].dayNumber).toBe(1);
            expect(profile!.campMarkers[0].name).toBe('Camp 1');
            expect(profile!.campMarkers[0].x).toBeGreaterThan(0);
            expect(profile!.campMarkers[0].x).toBeLessThan(300);

            // Second camp marker
            expect(profile!.campMarkers[1].campId).toBe('c2');
            expect(profile!.campMarkers[1].dayNumber).toBe(2);
        });

        it('sorts camp markers by distance', () => {
            const coords: [number, number, number][] = [
                [37.0, -3.0, 1800],
                [37.1, -3.1, 2200],
                [37.2, -3.2, 2800]
            ];
            // Provide camps in reverse order
            const camps = [
                { id: 'c2', name: 'Camp 2', dayNumber: 2, elevation: 2800, coordinates: [37.2, -3.2] as [number, number], elevationGainFromPrevious: 600, notes: '' },
                { id: 'c1', name: 'Camp 1', dayNumber: 1, elevation: 2200, coordinates: [37.1, -3.1] as [number, number], elevationGainFromPrevious: 400, notes: '' }
            ];

            const profile = generateElevationProfile(coords, camps);

            // Should be sorted by distance (Camp 1 comes first)
            expect(profile!.campMarkers[0].name).toBe('Camp 1');
            expect(profile!.campMarkers[1].name).toBe('Camp 2');
            expect(profile!.campMarkers[0].dist).toBeLessThan(profile!.campMarkers[1].dist);
        });

        it('returns empty camp markers for camps too far from route', () => {
            const coords: [number, number, number][] = [
                [37.0, -3.0, 1800],
                [37.1, -3.1, 2200]
            ];
            // Camp is 10 degrees away - way too far from route
            const camps = [
                { id: 'c1', name: 'Far Camp', dayNumber: 1, elevation: 2000, coordinates: [47.0, -3.0] as [number, number], elevationGainFromPrevious: 200, notes: '' }
            ];

            const profile = generateElevationProfile(coords, camps);

            expect(profile!.campMarkers.length).toBe(0);
        });

        it('returns empty camp markers when no camps provided', () => {
            const coords: [number, number, number][] = [
                [37.0, -3.0, 1800],
                [37.1, -3.1, 2200]
            ];

            const profile = generateElevationProfile(coords);

            expect(profile!.campMarkers).toBeDefined();
            expect(profile!.campMarkers.length).toBe(0);
        });
    });
});
