import { describe, it, expect } from 'vitest';
import { calculateStats, generateElevationProfile } from './stats.ts';

describe('stats utilities', () => {
    describe('calculateStats', () => {
        const mockTrekData = {
            stats: {
                duration: 7,
                totalDistance: 70
            },
            camps: [
                { elevationGainFromPrevious: 500 },
                { elevationGainFromPrevious: 800 },
                { elevationGainFromPrevious: 300 },
                { elevationGainFromPrevious: 1200 },
                { elevationGainFromPrevious: 200 }
            ],
            route: {
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

        it('includes difficulty rating', () => {
            const stats = calculateStats(mockTrekData);
            expect(stats.difficulty).toBe('Hard');
        });

        it('handles trek with no elevation gain', () => {
            const flatTrek = {
                ...mockTrekData,
                camps: [
                    { elevationGainFromPrevious: 0 },
                    { elevationGainFromPrevious: 0 }
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
            expect(generateElevationProfile(null)).toBeNull();
            expect(generateElevationProfile(undefined)).toBeNull();
        });

        it('generates profile for valid coordinates', () => {
            const coords = [
                [37.0, -3.0, 1800],
                [37.1, -3.1, 2200],
                [37.2, -3.2, 2800],
                [37.3, -3.3, 3500]
            ];
            const profile = generateElevationProfile(coords);

            expect(profile).not.toBeNull();
            expect(profile.minEle).toBe(1800);
            expect(profile.maxEle).toBe(3500);
            expect(profile.totalDist).toBeGreaterThan(0);
        });

        it('generates valid SVG paths', () => {
            const coords = [
                [37.0, -3.0, 1800],
                [37.1, -3.1, 2200],
                [37.2, -3.2, 2800]
            ];
            const profile = generateElevationProfile(coords);

            expect(profile.linePath).toMatch(/^M /);
            expect(profile.linePath).toContain(' L ');
            expect(profile.areaPath).toContain(' Z');
        });

        it('handles single point', () => {
            const coords = [[37.0, -3.0, 2000]];
            const profile = generateElevationProfile(coords);

            expect(profile).not.toBeNull();
            expect(profile.minEle).toBe(2000);
            expect(profile.maxEle).toBe(2000);
            expect(profile.totalDist).toBe(0);
        });

        it('handles flat terrain (same elevation)', () => {
            const coords = [
                [37.0, -3.0, 2000],
                [37.1, -3.1, 2000],
                [37.2, -3.2, 2000]
            ];
            const profile = generateElevationProfile(coords);

            expect(profile.minEle).toBe(2000);
            expect(profile.maxEle).toBe(2000);
        });

        it('calculates plot elevation range with padding', () => {
            const coords = [
                [37.0, -3.0, 1000],
                [37.1, -3.1, 2000]
            ];
            const profile = generateElevationProfile(coords);

            // plotMinEle should be less than minEle (padding)
            expect(profile.plotMinEle).toBeLessThan(profile.minEle);
            // plotMaxEle should be greater than maxEle (padding)
            expect(profile.plotMaxEle).toBeGreaterThan(profile.maxEle);
        });
    });
});
