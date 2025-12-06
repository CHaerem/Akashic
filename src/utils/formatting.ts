/**
 * Formatting utilities for display values
 */

/**
 * Format distance for display
 * @param distanceKm Distance in kilometers
 * @returns Formatted string like "500m" or "2.5 km"
 */
export function formatDistance(distanceKm: number): string {
    if (distanceKm < 1) {
        return `${Math.round(distanceKm * 1000)}m`;
    }
    return `${distanceKm.toFixed(1)} km`;
}

/**
 * Format elevation for display
 * @param meters Elevation in meters
 * @param showSign Whether to show + prefix for positive values
 * @returns Formatted string like "1234m" or "+500m"
 */
export function formatElevation(meters: number, showSign = false): string {
    const prefix = showSign && meters > 0 ? '+' : '';
    return `${prefix}${Math.round(meters)}m`;
}

/**
 * Format elevation gain (always positive with + prefix)
 * @param meters Elevation gain in meters
 * @returns Formatted string like "+500m"
 */
export function formatElevationGain(meters: number): string {
    return `+${Math.round(Math.abs(meters))}m`;
}

/**
 * Format elevation loss (always negative with - prefix)
 * @param meters Elevation loss in meters
 * @returns Formatted string like "-300m"
 */
export function formatElevationLoss(meters: number): string {
    return `-${Math.round(Math.abs(meters))}m`;
}

/**
 * Format duration in hours for display
 * @param hours Duration in hours (can be fractional)
 * @returns Formatted string like "4-5 hours" or "30 min"
 */
export function formatDuration(hours: number): string {
    if (hours < 1) {
        return `${Math.round(hours * 60)} min`;
    }
    const lowerBound = Math.max(1, Math.floor(hours * 0.9));
    const upperBound = Math.ceil(hours * 1.1);

    if (lowerBound >= upperBound) {
        return `${lowerBound} hour${lowerBound !== 1 ? 's' : ''}`;
    }
    return `${lowerBound}-${upperBound} hours`;
}

/**
 * Format hiking time from minutes
 * @param minutes Duration in minutes
 * @returns Formatted string like "2h 30m" or "45m"
 */
export function formatHikingTime(minutes: number): string {
    if (minutes < 60) {
        return `${Math.round(minutes)}m`;
    }
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    if (mins === 0) {
        return `${hours}h`;
    }
    return `${hours}h ${mins}m`;
}

/**
 * Format a number with thousands separator
 * @param num Number to format
 * @returns Formatted string like "1,234"
 */
export function formatNumber(num: number): string {
    return num.toLocaleString('en-US');
}

/**
 * Format percentage
 * @param value Decimal value (0-1)
 * @param decimals Number of decimal places
 * @returns Formatted string like "42.5%"
 */
export function formatPercent(value: number, decimals = 1): string {
    return `${(value * 100).toFixed(decimals)}%`;
}
