/**
 * Mapbox Map Matching API wrapper
 * Snaps GPS traces to roads and trails
 */

import type { Coordinate, RouteCoordinate } from '../utils/routeUtils';
import { samplePoints, simplifyRoute, SIMPLIFY_TOLERANCE } from '../utils/routeUtils';

export interface MapMatchResult {
    /** Snapped route coordinates */
    coordinates: RouteCoordinate[];
    /** Confidence score 0-1 (higher = better match) */
    confidence: number;
    /** Whether the match was successful */
    matched: boolean;
}

interface MapboxMatchingResponse {
    code: string;
    matchings?: Array<{
        confidence: number;
        geometry: {
            coordinates: [number, number][];
            type: string;
        };
        legs: Array<{
            summary: string;
            weight: number;
            duration: number;
            distance: number;
        }>;
    }>;
    tracepoints?: Array<{
        matchings_index: number;
        waypoint_index: number;
        alternatives_count: number;
        name: string;
        location: [number, number];
    } | null>;
}

// Simple in-memory cache for recent API results
const matchCache = new Map<string, { result: MapMatchResult; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Generate cache key from coordinates
 */
function getCacheKey(coords: Coordinate[]): string {
    // Use first, middle, and last point + count for key
    if (coords.length === 0) return 'empty';
    const first = coords[0];
    const last = coords[coords.length - 1];
    const mid = coords[Math.floor(coords.length / 2)];
    return `${coords.length}:${first[0].toFixed(4)},${first[1].toFixed(4)}:${mid[0].toFixed(4)},${mid[1].toFixed(4)}:${last[0].toFixed(4)},${last[1].toFixed(4)}`;
}

/**
 * Clean expired cache entries
 */
function cleanCache(): void {
    const now = Date.now();
    for (const [key, value] of matchCache.entries()) {
        if (now - value.timestamp > CACHE_TTL_MS) {
            matchCache.delete(key);
        }
    }
}

/**
 * Try to match a drawn path to trails/roads using Mapbox Map Matching API
 *
 * @param drawnPoints Array of [lng, lat] coordinates from user drawing
 * @param options Configuration options
 * @returns Match result with snapped coordinates and confidence
 */
export async function tryMapMatching(
    drawnPoints: Coordinate[],
    options: {
        /** Mapbox access token */
        accessToken: string;
        /** Max distance in meters to snap to road (default: 25) */
        snapRadius?: number;
        /** Profile to use: 'walking' | 'cycling' | 'driving' (default: 'walking') */
        profile?: 'walking' | 'cycling' | 'driving';
        /** Minimum confidence to consider a match successful (default: 0.5) */
        minConfidence?: number;
    }
): Promise<MapMatchResult> {
    const {
        accessToken,
        snapRadius = 25,
        profile = 'walking',
        minConfidence = 0.5
    } = options;

    // Minimum segment length to attempt matching (50 meters worth of degrees at equator)
    const MIN_SEGMENT_LENGTH = 0.0005;

    // Check if segment is too short
    if (drawnPoints.length < 2) {
        return { coordinates: [], confidence: 0, matched: false };
    }

    const startPoint = drawnPoints[0];
    const endPoint = drawnPoints[drawnPoints.length - 1];
    const segmentLength = Math.sqrt(
        (endPoint[0] - startPoint[0]) ** 2 + (endPoint[1] - startPoint[1]) ** 2
    );

    if (segmentLength < MIN_SEGMENT_LENGTH) {
        // Too short to match, return original points
        return {
            coordinates: drawnPoints.map(p => [p[0], p[1], 0]),
            confidence: 0,
            matched: false
        };
    }

    // Check cache
    const cacheKey = getCacheKey(drawnPoints);
    const cached = matchCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        return cached.result;
    }

    // Sample points to max 100 (API limit)
    const sampled = samplePoints(drawnPoints, 100);

    // Build coordinate string for API
    const coordString = sampled.map(c => `${c[0]},${c[1]}`).join(';');

    // Build radius string (same radius for all points)
    const radiusString = sampled.map(() => snapRadius.toString()).join(';');

    try {
        const response = await fetch(
            `https://api.mapbox.com/matching/v5/mapbox/${profile}/${coordString}?` +
            `access_token=${accessToken}&` +
            `geometries=geojson&` +
            `radiuses=${radiusString}&` +
            `tidy=true&` +
            `overview=full`
        );

        if (!response.ok) {
            console.warn('Map Matching API error:', response.status, response.statusText);
            return { coordinates: [], confidence: 0, matched: false };
        }

        const data: MapboxMatchingResponse = await response.json();

        if (data.code === 'Ok' && data.matchings && data.matchings.length > 0) {
            const matching = data.matchings[0];
            const confidence = matching.confidence;

            // Convert to RouteCoordinates (add 0 elevation - will be filled in later)
            const coordinates: RouteCoordinate[] = matching.geometry.coordinates.map(
                coord => [coord[0], coord[1], 0]
            );

            const result: MapMatchResult = {
                coordinates,
                confidence,
                matched: confidence >= minConfidence
            };

            // Cache the result
            cleanCache();
            matchCache.set(cacheKey, { result, timestamp: Date.now() });

            return result;
        }

        // No match found
        return { coordinates: [], confidence: 0, matched: false };

    } catch (error) {
        console.warn('Map Matching API call failed:', error);
        return { coordinates: [], confidence: 0, matched: false };
    }
}

/**
 * Process a drawn segment with intelligent snapping
 * Tries Map Matching first, falls back to simplified freehand if no match
 *
 * @param drawnPoints Array of [lng, lat] coordinates from user drawing
 * @param accessToken Mapbox access token
 * @returns Processed route coordinates
 */
export async function processDrawnSegment(
    drawnPoints: Coordinate[],
    accessToken: string
): Promise<{
    coordinates: RouteCoordinate[];
    wasSnapped: boolean;
    confidence: number;
}> {
    if (drawnPoints.length < 2) {
        return { coordinates: [], wasSnapped: false, confidence: 0 };
    }

    // Try Map Matching first
    const matchResult = await tryMapMatching(drawnPoints, {
        accessToken,
        snapRadius: 25,
        profile: 'walking',
        minConfidence: 0.5
    });

    if (matchResult.matched && matchResult.coordinates.length > 0) {
        // Successfully matched to trail
        return {
            coordinates: matchResult.coordinates,
            wasSnapped: true,
            confidence: matchResult.confidence
        };
    }

    // No match - use simplified freehand
    // Convert to RouteCoordinates first
    const routeCoords: RouteCoordinate[] = drawnPoints.map(p => [p[0], p[1], 0]);

    // Simplify to reduce point count
    const simplified = simplifyRoute(routeCoords, SIMPLIFY_TOLERANCE.medium);

    return {
        coordinates: simplified,
        wasSnapped: false,
        confidence: matchResult.confidence
    };
}
