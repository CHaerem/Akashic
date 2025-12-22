/**
 * Transform functions for journey data
 * Converts database records to app types
 */

import type { TrekConfig, TrekData, Camp, FunFact, PointOfInterest, HistoricalSite, FunFactCategory, POICategory } from '../../types/trek';
import type { DbJourney, DbWaypoint, DbFunFact, DbPointOfInterest, DbHistoricalSite } from './types';

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
 * Transform database fun fact to app type
 */
function toFunFact(dbFact: DbFunFact): FunFact {
    return {
        id: dbFact.id,
        content: dbFact.content,
        category: dbFact.category as FunFactCategory,
        source: dbFact.source,
        learnMoreUrl: dbFact.learn_more_url,
        icon: dbFact.icon,
    };
}

/**
 * Transform database point of interest to app type
 */
function toPointOfInterest(dbPoi: DbPointOfInterest): PointOfInterest {
    return {
        id: dbPoi.id,
        name: dbPoi.name,
        category: dbPoi.category as POICategory,
        coordinates: dbPoi.coordinates,
        elevation: dbPoi.elevation,
        description: dbPoi.description,
        routeDistanceKm: dbPoi.route_distance_km,
        tips: dbPoi.tips,
        timeFromPrevious: dbPoi.time_from_previous,
        icon: dbPoi.icon,
    };
}

/**
 * Transform database historical site to app type
 */
function toHistoricalSite(dbSite: DbHistoricalSite, dayNumber?: number): HistoricalSite {
    return {
        id: dbSite.id,
        name: dbSite.name,
        coordinates: dbSite.coordinates,
        elevation: dbSite.elevation,
        routeDistanceKm: dbSite.route_distance_km,
        summary: dbSite.summary,
        description: dbSite.description,
        period: dbSite.period,
        significance: dbSite.significance,
        imageUrls: dbSite.image_urls,
        links: dbSite.links,
        tags: dbSite.tags,
        dayNumber,
    };
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

        const dayNumber = w.day_number || i + 1;

        // Debug: Log fun facts data
        if (w.fun_facts && w.fun_facts.length > 0) {
            console.log(`[transforms] Camp "${w.name}" has ${w.fun_facts.length} fun facts`);
        }

        return {
            id: w.id,
            name: w.name,
            dayNumber,
            elevation: w.elevation || 0,
            coordinates: w.coordinates,
            elevationGainFromPrevious,
            notes: w.description || '',
            highlights: w.highlights || [],
            routeDistanceKm: w.route_distance_km,
            routePointIndex: w.route_point_index,
            weather: w.weather ? {
                temperatureMax: w.weather.temperature_max,
                temperatureMin: w.weather.temperature_min,
                precipitationSum: w.weather.precipitation_sum,
                windSpeedMax: w.weather.wind_speed_max,
                weatherCode: w.weather.weather_code,
            } : null,
            funFacts: w.fun_facts?.map(toFunFact) || [],
            pointsOfInterest: w.points_of_interest?.map(toPointOfInterest) || [],
            historicalSites: w.historical_sites?.map(s => toHistoricalSite(s, dayNumber)) || [],
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
