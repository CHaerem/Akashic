/**
 * Date utilities for journey and photo operations
 */

import type { Photo } from '../types/trek';

/**
 * Get the actual date for a specific day number based on journey start date
 * @param dateStarted - The journey start date string (ISO format)
 * @param dayNumber - The day number (1-indexed)
 * @returns Date object for that day, or null if dateStarted is undefined
 */
export function getDateForDay(dateStarted: string | undefined, dayNumber: number): Date | null {
    if (!dateStarted) return null;
    const start = new Date(dateStarted);
    start.setDate(start.getDate() + (dayNumber - 1));
    return start;
}

/**
 * Check if a photo was taken on a specific date (comparing just the date, not time)
 * @param photo - Photo with optional taken_at field
 * @param targetDate - The date to compare against
 * @returns true if the photo was taken on the target date
 */
export function isPhotoFromDay(photo: Photo, targetDate: Date): boolean {
    if (!photo.taken_at) return false;
    const photoDate = new Date(photo.taken_at);
    return (
        photoDate.getFullYear() === targetDate.getFullYear() &&
        photoDate.getMonth() === targetDate.getMonth() &&
        photoDate.getDate() === targetDate.getDate()
    );
}

/**
 * Format a date as short string (e.g., "Oct 5")
 * @param date - Date to format
 * @returns Formatted string like "Oct 5"
 */
export function formatDateShort(date: Date): string {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Format a date as long string (e.g., "October 5, 2024")
 * @param date - Date to format
 * @returns Formatted string like "October 5, 2024"
 */
export function formatDateLong(date: Date): string {
    return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

/**
 * Format a date with weekday (e.g., "Friday, Oct 5")
 * @param date - Date to format
 * @returns Formatted string like "Friday, Oct 5"
 */
export function formatDateWithWeekday(date: Date): string {
    return date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

/**
 * Get the day number for a photo based on journey start date
 * @param photo - Photo with optional taken_at field
 * @param dateStarted - The journey start date string
 * @param maxDays - Maximum valid day number
 * @returns Day number (1-indexed), or null if can't determine
 */
export function getPhotoDayNumber(
    photo: Photo,
    dateStarted: string | undefined,
    maxDays: number
): number | null {
    if (!photo.taken_at || !dateStarted) return null;

    const photoDate = new Date(photo.taken_at);
    const startDate = new Date(dateStarted);
    const diffTime = photoDate.getTime() - startDate.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    const dayNum = diffDays + 1;

    if (dayNum >= 1 && dayNum <= maxDays) {
        return dayNum;
    }
    return null;
}
