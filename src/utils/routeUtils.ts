/**
 * Route utility functions for calculating distances and snapping waypoints to routes
 */

export type RouteCoordinate = [number, number, number]; // [lng, lat, elevation]
export type Coordinate = [number, number]; // [lng, lat]

/**
 * Calculate distance between two coordinates using Haversine formula
 * @returns Distance in kilometers
 */
export function haversineDistance(
    coord1: Coordinate | RouteCoordinate,
    coord2: Coordinate | RouteCoordinate
): number {
    const R = 6371; // Earth's radius in km
    const [lng1, lat1] = coord1;
    const [lng2, lat2] = coord2;

    const dLat = toRadians(lat2 - lat1);
    const dLng = toRadians(lng2 - lng1);

    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
}

function toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
}

/**
 * Calculate cumulative distances along a route
 * @returns Array of cumulative distances in km for each point
 */
export function calculateRouteDistances(route: RouteCoordinate[]): number[] {
    const distances: number[] = [0];
    let cumulative = 0;

    for (let i = 1; i < route.length; i++) {
        cumulative += haversineDistance(route[i - 1], route[i]);
        distances.push(cumulative);
    }

    return distances;
}

/**
 * Get the total length of a route in km
 */
export function getRouteLength(route: RouteCoordinate[]): number {
    const distances = calculateRouteDistances(route);
    return distances[distances.length - 1] || 0;
}

/**
 * Result of finding the nearest point on a route
 */
export interface NearestPointResult {
    /** Index of the nearest point in the route array */
    index: number;
    /** The actual coordinates of the nearest point */
    coordinates: RouteCoordinate;
    /** Distance from the input point to the nearest route point in km */
    distance: number;
    /** Cumulative distance along route from start to this point in km */
    routeDistance: number;
}

/**
 * Find the nearest point on a route to a given coordinate
 * Also finds the best interpolated position between route points for more precision
 */
export function findNearestPointOnRoute(
    coord: Coordinate,
    route: RouteCoordinate[]
): NearestPointResult | null {
    if (route.length === 0) return null;

    let nearestIndex = 0;
    let nearestDistance = Infinity;

    // First pass: find nearest vertex
    for (let i = 0; i < route.length; i++) {
        const dist = haversineDistance(coord, route[i]);
        if (dist < nearestDistance) {
            nearestDistance = dist;
            nearestIndex = i;
        }
    }

    // Second pass: check if point on adjacent segments is closer
    // This handles cases where the closest point is between two vertices
    let bestIndex = nearestIndex;
    let bestDistance = nearestDistance;
    let bestPoint = route[nearestIndex];

    // Check segment before
    if (nearestIndex > 0) {
        const projected = projectPointOnSegment(
            coord,
            route[nearestIndex - 1],
            route[nearestIndex]
        );
        if (projected) {
            const dist = haversineDistance(coord, projected.point);
            if (dist < bestDistance) {
                bestDistance = dist;
                bestIndex = nearestIndex - 1;
                bestPoint = projected.point;
            }
        }
    }

    // Check segment after
    if (nearestIndex < route.length - 1) {
        const projected = projectPointOnSegment(
            coord,
            route[nearestIndex],
            route[nearestIndex + 1]
        );
        if (projected) {
            const dist = haversineDistance(coord, projected.point);
            if (dist < bestDistance) {
                bestDistance = dist;
                bestIndex = nearestIndex;
                bestPoint = projected.point;
            }
        }
    }

    // Calculate route distance
    const routeDistances = calculateRouteDistances(route);
    let routeDistance = routeDistances[bestIndex];

    // If we projected onto a segment, add the extra distance
    if (bestIndex < route.length - 1) {
        const segmentStart = route[bestIndex];
        routeDistance += haversineDistance(segmentStart, bestPoint);
    }

    return {
        index: bestIndex,
        coordinates: bestPoint,
        distance: bestDistance,
        routeDistance
    };
}

/**
 * Project a point onto a line segment
 * Returns the projected point if it falls within the segment, null otherwise
 */
function projectPointOnSegment(
    point: Coordinate,
    segStart: RouteCoordinate,
    segEnd: RouteCoordinate
): { point: RouteCoordinate; t: number } | null {
    const [px, py] = point;
    const [ax, ay, az] = segStart;
    const [bx, by, bz] = segEnd;

    const dx = bx - ax;
    const dy = by - ay;

    // Segment length squared (in coordinate space, not actual distance)
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return null;

    // Parameter t for the projection onto the line
    // t = 0 means projection is at segStart, t = 1 means at segEnd
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));

    // If t is at the extremes, don't use projection (vertex is closer)
    if (t <= 0.01 || t >= 0.99) return null;

    // Interpolate position
    const projX = ax + t * dx;
    const projY = ay + t * dy;
    const projZ = az + t * (bz - az); // Interpolate elevation too

    return {
        point: [projX, projY, projZ],
        t
    };
}

/**
 * Get route segment for a specific day (from camp to camp)
 * @param route Full route coordinates
 * @param startIndex Route index of previous camp (or 0 for day 1)
 * @param endIndex Route index of this camp
 */
export function getRouteSegment(
    route: RouteCoordinate[],
    startIndex: number,
    endIndex: number
): RouteCoordinate[] {
    if (startIndex < 0) startIndex = 0;
    if (endIndex >= route.length) endIndex = route.length - 1;
    if (startIndex > endIndex) return [];

    return route.slice(startIndex, endIndex + 1);
}

/**
 * Calculate statistics for a route segment
 */
export interface RouteSegmentStats {
    distance: number; // km
    elevationGain: number; // meters
    elevationLoss: number; // meters
    startElevation: number;
    endElevation: number;
}

export function calculateSegmentStats(segment: RouteCoordinate[]): RouteSegmentStats {
    if (segment.length === 0) {
        return { distance: 0, elevationGain: 0, elevationLoss: 0, startElevation: 0, endElevation: 0 };
    }

    let distance = 0;
    let elevationGain = 0;
    let elevationLoss = 0;

    for (let i = 1; i < segment.length; i++) {
        distance += haversineDistance(segment[i - 1], segment[i]);

        const elevDiff = segment[i][2] - segment[i - 1][2];
        if (elevDiff > 0) {
            elevationGain += elevDiff;
        } else {
            elevationLoss += Math.abs(elevDiff);
        }
    }

    return {
        distance,
        elevationGain,
        elevationLoss,
        startElevation: segment[0][2],
        endElevation: segment[segment.length - 1][2]
    };
}

/**
 * Find the route point index closest to a given distance from start
 */
export function findIndexAtDistance(
    route: RouteCoordinate[],
    targetDistance: number
): number {
    const distances = calculateRouteDistances(route);

    for (let i = 0; i < distances.length; i++) {
        if (distances[i] >= targetDistance) {
            // Return the closer of this point or previous
            if (i === 0) return 0;
            const prevDiff = targetDistance - distances[i - 1];
            const currDiff = distances[i] - targetDistance;
            return prevDiff < currDiff ? i - 1 : i;
        }
    }

    return route.length - 1;
}

/**
 * Interpolate a point at a specific distance along the route
 */
export function interpolatePointAtDistance(
    route: RouteCoordinate[],
    targetDistance: number
): RouteCoordinate | null {
    if (route.length === 0) return null;
    if (targetDistance <= 0) return route[0];

    const distances = calculateRouteDistances(route);
    const totalLength = distances[distances.length - 1];

    if (targetDistance >= totalLength) return route[route.length - 1];

    // Find the segment containing the target distance
    for (let i = 1; i < distances.length; i++) {
        if (distances[i] >= targetDistance) {
            const segmentStart = route[i - 1];
            const segmentEnd = route[i];
            const segmentLength = distances[i] - distances[i - 1];
            const distIntoSegment = targetDistance - distances[i - 1];
            const t = distIntoSegment / segmentLength;

            return [
                segmentStart[0] + t * (segmentEnd[0] - segmentStart[0]),
                segmentStart[1] + t * (segmentEnd[1] - segmentStart[1]),
                segmentStart[2] + t * (segmentEnd[2] - segmentStart[2])
            ];
        }
    }

    return route[route.length - 1];
}
