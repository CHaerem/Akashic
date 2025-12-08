/**
 * Transform functions for journey data
 * Converts database records to app types
 */

import type { TrekConfig, TrekData, Camp } from '../../types/trek';
import type { DbJourney, DbWaypoint } from './types';

/**
 * Transform database journey to TrekConfig (for globe markers)
 */
export function toTrekConfig(journey: DbJourney): TrekConfig {
    const [lng, lat] = journey.center_coordinates || [0, 0];
    return {
        id: journey.slug,
        name: journey.name.split(' - ')[0], // "Kilimanjaro - Lemosho Route" -> "Kilimanjaro"
        country: journey.country || '',
        elevation: journey.summit_elevation ? `${journey.summit_elevation.toLocaleString()}m` : '',
        lat,
        lng,
        preferredBearing: journey.preferred_bearing || 0,
        preferredPitch: journey.preferred_pitch || 60,
        slug: journey.slug
    };
}

/**
 * Find the closest route point index for a camp's coordinates
 */
export function findClosestRoutePointIndex(
    campCoords: [number, number],
    routeCoords: [number, number, number][]
): number {
    let minDistance = Infinity;
    let closestIndex = 0;

    for (let i = 0; i < routeCoords.length; i++) {
        const routePoint = routeCoords[i];
        // Simple distance calculation (good enough for finding closest point)
        const dLng = routePoint[0] - campCoords[0];
        const dLat = routePoint[1] - campCoords[1];
        const dist = dLng * dLng + dLat * dLat;
        if (dist < minDistance) {
            minDistance = dist;
            closestIndex = i;
        }
    }

    return closestIndex;
}

/**
 * Calculate elevation gain between two route indices
 * Only counts positive elevation changes (gain, not loss)
 */
export function calculateElevationGainBetweenIndices(
    routeCoords: [number, number, number][],
    startIndex: number,
    endIndex: number
): number {
    if (startIndex >= endIndex) return 0;

    let totalGain = 0;
    for (let i = startIndex + 1; i <= endIndex; i++) {
        const elevDiff = routeCoords[i][2] - routeCoords[i - 1][2];
        if (elevDiff > 0) {
            totalGain += elevDiff;
        }
    }

    return Math.round(totalGain);
}

/**
 * Transform database journey + waypoints to TrekData
 */
export function toTrekData(journey: DbJourney, waypoints: DbWaypoint[]): TrekData {
    const routeCoords = journey.route?.coordinates || [];

    // First pass: create camps with their route positions
    const sortedWaypoints = waypoints
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

    // Calculate route indices for each camp
    const campRouteIndices: number[] = sortedWaypoints.map(w => {
        if (w.route_point_index != null) {
            return Math.min(w.route_point_index, routeCoords.length - 1);
        }
        if (routeCoords.length === 0) return 0;
        return findClosestRoutePointIndex(w.coordinates, routeCoords);
    });

    // Create camps with calculated elevation gains
    const camps: Camp[] = sortedWaypoints.map((w, i) => {
        let elevationGainFromPrevious = 0;

        if (i > 0 && routeCoords.length > 0) {
            const prevIndex = campRouteIndices[i - 1];
            const currIndex = campRouteIndices[i];
            elevationGainFromPrevious = calculateElevationGainBetweenIndices(
                routeCoords,
                prevIndex,
                currIndex
            );
        }

        return {
            id: w.id,
            name: w.name,
            dayNumber: w.day_number || i + 1,
            elevation: w.elevation || 0,
            coordinates: w.coordinates,
            elevationGainFromPrevious,
            notes: w.description || '',
            highlights: w.highlights || [],
            routeDistanceKm: w.route_distance_km,
            routePointIndex: w.route_point_index,
        };
    });

    return {
        id: journey.slug,
        name: journey.name,
        country: journey.country || '',
        description: journey.description || '',
        stats: journey.stats || {
            duration: journey.total_days || 0,
            totalDistance: journey.total_distance || 0,
            totalElevationGain: 0,
            highestPoint: {
                name: 'Summit',
                elevation: journey.summit_elevation || 0
            }
        },
        camps,
        route: journey.route || { type: 'LineString', coordinates: [] },
        dateStarted: journey.date_started || undefined
    };
}
