import { describe, it, expect } from 'vitest';
import {
    getDateForDay,
    isPhotoFromDay,
    formatDateShort,
    formatDateLong,
    formatDateWithWeekday,
    getPhotoDayNumber,
} from './dates';
import type { Photo } from '../types/trek';

describe('dates utilities', () => {
    describe('getDateForDay', () => {
        it('returns null if dateStarted is undefined', () => {
            expect(getDateForDay(undefined, 1)).toBeNull();
        });

        it('returns the start date for day 1', () => {
            const result = getDateForDay('2024-10-01', 1);
            expect(result).toBeInstanceOf(Date);
            expect(result?.getFullYear()).toBe(2024);
            expect(result?.getMonth()).toBe(9); // October is month 9
            expect(result?.getDate()).toBe(1);
        });

        it('returns correct date for day 5', () => {
            const result = getDateForDay('2024-10-01', 5);
            expect(result?.getDate()).toBe(5);
        });

        it('handles month boundaries', () => {
            const result = getDateForDay('2024-10-30', 3);
            expect(result?.getMonth()).toBe(10); // November
            expect(result?.getDate()).toBe(1);
        });

        it('handles year boundaries', () => {
            const result = getDateForDay('2024-12-30', 3);
            expect(result?.getFullYear()).toBe(2025);
            expect(result?.getMonth()).toBe(0); // January
            expect(result?.getDate()).toBe(1);
        });
    });

    describe('isPhotoFromDay', () => {
        it('returns false if photo has no taken_at', () => {
            const photo = { id: '1', url: 'test.jpg' } as Photo;
            const date = new Date('2024-10-05');
            expect(isPhotoFromDay(photo, date)).toBe(false);
        });

        it('returns true if photo was taken on the same day', () => {
            const photo = {
                id: '1',
                url: 'test.jpg',
                taken_at: '2024-10-05T14:30:00Z',
            } as Photo;
            const date = new Date('2024-10-05');
            expect(isPhotoFromDay(photo, date)).toBe(true);
        });

        it('returns false if photo was taken on a different day', () => {
            const photo = {
                id: '1',
                url: 'test.jpg',
                taken_at: '2024-10-06T10:00:00Z',
            } as Photo;
            const date = new Date('2024-10-05');
            expect(isPhotoFromDay(photo, date)).toBe(false);
        });

        it('ignores time differences on the same day', () => {
            // Use local dates to avoid timezone issues
            const photo = {
                id: '1',
                url: 'test.jpg',
                taken_at: new Date(2024, 9, 5, 23, 59, 59).toISOString(), // Oct 5 late evening local
            } as Photo;
            const date = new Date(2024, 9, 5, 0, 0, 0); // Oct 5 midnight local
            expect(isPhotoFromDay(photo, date)).toBe(true);
        });
    });

    describe('formatDateShort', () => {
        it('formats date as "Mon D"', () => {
            const date = new Date('2024-10-05');
            expect(formatDateShort(date)).toBe('Oct 5');
        });

        it('formats single digit days without leading zero', () => {
            const date = new Date('2024-01-01');
            expect(formatDateShort(date)).toBe('Jan 1');
        });

        it('formats double digit days', () => {
            const date = new Date('2024-12-25');
            expect(formatDateShort(date)).toBe('Dec 25');
        });
    });

    describe('formatDateLong', () => {
        it('formats date as "Month D, YYYY"', () => {
            const date = new Date('2024-10-05');
            expect(formatDateLong(date)).toBe('October 5, 2024');
        });

        it('formats different year correctly', () => {
            const date = new Date('2023-03-15');
            expect(formatDateLong(date)).toBe('March 15, 2023');
        });
    });

    describe('formatDateWithWeekday', () => {
        it('formats date with weekday', () => {
            const date = new Date('2024-10-05'); // Saturday
            expect(formatDateWithWeekday(date)).toBe('Saturday, Oct 5');
        });

        it('handles different weekdays', () => {
            const date = new Date('2024-10-07'); // Monday
            expect(formatDateWithWeekday(date)).toBe('Monday, Oct 7');
        });
    });

    describe('getPhotoDayNumber', () => {
        it('returns null if photo has no taken_at', () => {
            const photo = { id: '1', url: 'test.jpg' } as Photo;
            expect(getPhotoDayNumber(photo, '2024-10-01', 10)).toBeNull();
        });

        it('returns null if dateStarted is undefined', () => {
            const photo = {
                id: '1',
                url: 'test.jpg',
                taken_at: '2024-10-05',
            } as Photo;
            expect(getPhotoDayNumber(photo, undefined, 10)).toBeNull();
        });

        it('returns day 1 for photo on start date', () => {
            const photo = {
                id: '1',
                url: 'test.jpg',
                taken_at: '2024-10-01T12:00:00Z',
            } as Photo;
            expect(getPhotoDayNumber(photo, '2024-10-01', 10)).toBe(1);
        });

        it('returns correct day number for later dates', () => {
            const photo = {
                id: '1',
                url: 'test.jpg',
                taken_at: '2024-10-05T12:00:00Z',
            } as Photo;
            expect(getPhotoDayNumber(photo, '2024-10-01', 10)).toBe(5);
        });

        it('returns null if day number exceeds maxDays', () => {
            const photo = {
                id: '1',
                url: 'test.jpg',
                taken_at: '2024-10-15T12:00:00Z',
            } as Photo;
            expect(getPhotoDayNumber(photo, '2024-10-01', 10)).toBeNull();
        });

        it('returns null if photo is before journey start', () => {
            const photo = {
                id: '1',
                url: 'test.jpg',
                taken_at: '2024-09-30T12:00:00Z',
            } as Photo;
            expect(getPhotoDayNumber(photo, '2024-10-01', 10)).toBeNull();
        });
    });
});
