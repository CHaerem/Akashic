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
 * Clear all cache entries (useful for testing)
 */
export function clearMatchCache(): void {
    matchCache.clear();
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
        const url = `https://api.mapbox.com/matching/v5/mapbox/${profile}/${coordString}?` +
            `access_token=${accessToken}&` +
            `geometries=geojson&` +
            `radiuses=${radiusString}&` +
            `tidy=true&` +
            `overview=full`;

        console.log('[MapMatching] Requesting match for', sampled.length, 'points');

        const response = await fetch(url);

        if (!response.ok) {
            const errorText = await response.text();
            console.warn('[MapMatching] API error:', response.status, response.statusText, errorText);
            return { coordinates: [], confidence: 0, matched: false };
        }

        const data: MapboxMatchingResponse = await response.json();
        console.log('[MapMatching] Response code:', data.code, 'matchings:', data.matchings?.length || 0);

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

export interface SnapRouteResult {
    /** Snapped route coordinates */
    coordinates: RouteCoordinate[];
    /** Number of segments that were successfully snapped */
    snappedSegments: number;
    /** Total number of segments processed */
    totalSegments: number;
    /** Average confidence across all segments */
    averageConfidence: number;
}

/**
 * Snap an entire route to trails using Map Matching API
 * Processes the route in chunks to handle API limits (100 points max)
 * Preserves elevation data from original route
 *
 * @param route Array of [lng, lat, elevation] coordinates
 * @param accessToken Mapbox access token
 * @param onProgress Optional callback for progress updates (0-1)
 * @returns Snapped route with statistics
 */
export async function snapRouteToTrails(
    route: RouteCoordinate[],
    accessToken: string,
    onProgress?: (progress: number) => void
): Promise<SnapRouteResult> {
    if (route.length < 2) {
        return {
            coordinates: route,
            snappedSegments: 0,
            totalSegments: 0,
            averageConfidence: 0
        };
    }

    // Process in chunks of ~80 points (with overlap for smooth joins)
    const CHUNK_SIZE = 80;
    const OVERLAP = 5;

    const chunks: RouteCoordinate[][] = [];
    let startIndex = 0;

    while (startIndex < route.length) {
        const endIndex = Math.min(startIndex + CHUNK_SIZE, route.length);
        chunks.push(route.slice(startIndex, endIndex));

        if (endIndex >= route.length) break;
        // Next chunk starts with overlap
        startIndex = endIndex - OVERLAP;
    }

    const results: RouteCoordinate[][] = [];
    let snappedCount = 0;
    let totalConfidence = 0;

    console.log('[SnapRoute] Processing', chunks.length, 'chunks from', route.length, 'total points');

    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];

        // Convert to 2D coordinates for API
        const coords2D: Coordinate[] = chunk.map(c => [c[0], c[1]]);

        console.log(`[SnapRoute] Processing chunk ${i + 1}/${chunks.length} with ${chunk.length} points`);

        // Try to snap this chunk
        const matchResult = await tryMapMatching(coords2D, {
            accessToken,
            snapRadius: 50, // Slightly larger radius for existing routes
            profile: 'walking',
            minConfidence: 0.3 // Lower threshold for existing routes
        });

        console.log(`[SnapRoute] Chunk ${i + 1} result: matched=${matchResult.matched}, confidence=${matchResult.confidence.toFixed(2)}, coords=${matchResult.coordinates.length}`);

        if (matchResult.matched && matchResult.coordinates.length > 0) {
            // Snap was successful - interpolate elevations from original
            const snappedWithElevation = interpolateElevations(
                matchResult.coordinates,
                chunk
            );
            results.push(snappedWithElevation);
            snappedCount++;
            totalConfidence += matchResult.confidence;
        } else {
            // Keep original chunk if snapping failed
            results.push(chunk);
            totalConfidence += 0;
        }

        // Report progress
        if (onProgress) {
            onProgress((i + 1) / chunks.length);
        }

        // Small delay between API calls to avoid rate limiting
        if (i < chunks.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    // Merge chunks, removing overlap duplicates
    const mergedCoordinates = mergeChunks(results, OVERLAP);

    console.log(`[SnapRoute] Complete: ${snappedCount}/${chunks.length} chunks snapped, ${mergedCoordinates.length} total points`);

    return {
        coordinates: mergedCoordinates,
        snappedSegments: snappedCount,
        totalSegments: chunks.length,
        averageConfidence: chunks.length > 0 ? totalConfidence / chunks.length : 0
    };
}

/**
 * Interpolate elevations from original route to snapped coordinates
 */
function interpolateElevations(
    snapped: RouteCoordinate[],
    original: RouteCoordinate[]
): RouteCoordinate[] {
    return snapped.map(point => {
        // Find nearest point in original for elevation
        let minDist = Infinity;
        let nearestElevation = 0;

        for (const orig of original) {
            const dist = Math.sqrt(
                (point[0] - orig[0]) ** 2 + (point[1] - orig[1]) ** 2
            );
            if (dist < minDist) {
                minDist = dist;
                nearestElevation = orig[2];
            }
        }

        return [point[0], point[1], nearestElevation];
    });
}

/**
 * Merge overlapping chunks into a single route
 */
function mergeChunks(
    chunks: RouteCoordinate[][],
    overlap: number
): RouteCoordinate[] {
    if (chunks.length === 0) return [];
    if (chunks.length === 1) return chunks[0];

    const result: RouteCoordinate[] = [...chunks[0]];

    for (let i = 1; i < chunks.length; i++) {
        // Skip the first `overlap` points of subsequent chunks (they overlap with previous)
        const chunk = chunks[i];
        const startIndex = Math.min(overlap, chunk.length);
        result.push(...chunk.slice(startIndex));
    }

    return result;
}
