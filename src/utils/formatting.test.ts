import { describe, it, expect } from 'vitest';
import {
    formatDistance,
    formatElevation,
    formatElevationGain,
    formatElevationLoss,
    formatDuration,
    formatHikingTime,
    formatNumber,
    formatPercent,
} from './formatting';

describe('formatting utilities', () => {
    describe('formatDistance', () => {
        it('formats distances under 1km in meters', () => {
            expect(formatDistance(0.5)).toBe('500m');
            expect(formatDistance(0.1)).toBe('100m');
            expect(formatDistance(0.05)).toBe('50m');
        });

        it('formats distances 1km and over in kilometers', () => {
            expect(formatDistance(1)).toBe('1.0 km');
            expect(formatDistance(2.5)).toBe('2.5 km');
            expect(formatDistance(10.75)).toBe('10.8 km');
        });

        it('rounds meter values', () => {
            expect(formatDistance(0.567)).toBe('567m');
        });
    });

    describe('formatElevation', () => {
        it('formats elevation without sign by default', () => {
            expect(formatElevation(1234)).toBe('1234m');
            expect(formatElevation(500)).toBe('500m');
        });

        it('shows + sign when showSign is true and value is positive', () => {
            expect(formatElevation(500, true)).toBe('+500m');
        });

        it('does not show + for zero or negative', () => {
            expect(formatElevation(0, true)).toBe('0m');
            expect(formatElevation(-100, true)).toBe('-100m');
        });

        it('rounds decimal values', () => {
            expect(formatElevation(1234.7)).toBe('1235m');
            expect(formatElevation(1234.3)).toBe('1234m');
        });
    });

    describe('formatElevationGain', () => {
        it('always shows + prefix', () => {
            expect(formatElevationGain(500)).toBe('+500m');
        });

        it('uses absolute value for negative inputs', () => {
            expect(formatElevationGain(-500)).toBe('+500m');
        });

        it('rounds values', () => {
            expect(formatElevationGain(123.7)).toBe('+124m');
        });
    });

    describe('formatElevationLoss', () => {
        it('always shows - prefix', () => {
            expect(formatElevationLoss(300)).toBe('-300m');
        });

        it('uses absolute value', () => {
            expect(formatElevationLoss(-300)).toBe('-300m');
        });

        it('rounds values', () => {
            expect(formatElevationLoss(123.4)).toBe('-123m');
        });
    });

    describe('formatDuration', () => {
        it('formats durations under 1 hour in minutes', () => {
            expect(formatDuration(0.5)).toBe('30 min');
            expect(formatDuration(0.75)).toBe('45 min');
        });

        it('formats durations as hour ranges', () => {
            expect(formatDuration(4)).toMatch(/\d+-\d+ hours/);
        });

        it('handles single hour correctly', () => {
            expect(formatDuration(1)).toMatch(/hour/);
        });
    });

    describe('formatHikingTime', () => {
        it('formats durations under 60 minutes without hours', () => {
            expect(formatHikingTime(30)).toBe('30m');
            expect(formatHikingTime(45)).toBe('45m');
        });

        it('formats exact hours without minutes', () => {
            expect(formatHikingTime(60)).toBe('1h');
            expect(formatHikingTime(120)).toBe('2h');
        });

        it('formats hours and minutes', () => {
            expect(formatHikingTime(90)).toBe('1h 30m');
            expect(formatHikingTime(150)).toBe('2h 30m');
        });

        it('rounds minute values', () => {
            expect(formatHikingTime(91.5)).toBe('1h 32m');
        });
    });

    describe('formatNumber', () => {
        it('adds thousands separator', () => {
            expect(formatNumber(1234)).toBe('1,234');
            expect(formatNumber(1234567)).toBe('1,234,567');
        });

        it('handles small numbers', () => {
            expect(formatNumber(123)).toBe('123');
        });
    });

    describe('formatPercent', () => {
        it('formats decimal as percentage', () => {
            expect(formatPercent(0.5)).toBe('50.0%');
            expect(formatPercent(0.425)).toBe('42.5%');
        });

        it('respects decimals parameter', () => {
            expect(formatPercent(0.4256, 2)).toBe('42.56%');
            expect(formatPercent(0.5, 0)).toBe('50%');
        });

        it('handles values over 1', () => {
            expect(formatPercent(1.5)).toBe('150.0%');
        });
    });
});
