/**
 * Geography utility functions for distance and bearing calculations
 */

/**
 * Convert degrees to radians
 */
export function deg2rad(deg: number): number {
    return deg * (Math.PI / 180);
}

/**
 * Convert radians to degrees
 */
export function rad2deg(rad: number): number {
    return rad * (180 / Math.PI);
}

/**
 * Calculate distance between two coordinates using Haversine formula
 * @returns Distance in kilometers
 */
export function getDistanceFromLatLonInKm(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
): number {
    const R = 6371; // Radius of the earth in km
    const dLat = deg2rad(lat2 - lat1);
    const dLon = deg2rad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

/**
 * Calculate bearing from one coordinate to another
 * @returns Bearing in degrees (0-360)
 */
export function calculateBearing(
    startLat: number,
    startLng: number,
    destLat: number,
    destLng: number
): number {
    const startLatRad = deg2rad(startLat);
    const startLngRad = deg2rad(startLng);
    const destLatRad = deg2rad(destLat);
    const destLngRad = deg2rad(destLng);

    const y = Math.sin(destLngRad - startLngRad) * Math.cos(destLatRad);
    const x = Math.cos(startLatRad) * Math.sin(destLatRad) -
        Math.sin(startLatRad) * Math.cos(destLatRad) * Math.cos(destLngRad - startLngRad);
    const brng = Math.atan2(y, x);
    return (rad2deg(brng) + 360) % 360;
}

/**
 * Find the index of a coordinate in an array (with tolerance for floating point precision)
 * @param routeCoords - Array of [lng, lat, elevation] coordinates
 * @param target - Target coordinate [lng, lat]
 * @param tolerance - Tolerance for matching (default 0.0001)
 * @returns Index of coordinate or -1 if not found
 */
export function findCoordIndex(
    routeCoords: [number, number, number][],
    target: [number, number],
    tolerance: number = 0.0001
): number {
    return routeCoords.findIndex(c =>
        Math.abs(c[0] - target[0]) < tolerance &&
        Math.abs(c[1] - target[1]) < tolerance
    );
}

/**
 * Find the nearest route point index to a target coordinate
 * Unlike findCoordIndex, this always returns a valid index (never -1)
 * @param routeCoords - Array of [lng, lat, elevation] coordinates
 * @param target - Target coordinate [lng, lat]
 * @returns Index of nearest coordinate
 */
export function findNearestCoordIndex(
    routeCoords: [number, number, number][],
    target: [number, number]
): number {
    if (routeCoords.length === 0) return 0;

    let minDist = Infinity;
    let nearestIdx = 0;

    for (let i = 0; i < routeCoords.length; i++) {
        const c = routeCoords[i];
        // Simple squared distance (faster than Haversine for comparison)
        const dist = (c[0] - target[0]) ** 2 + (c[1] - target[1]) ** 2;
        if (dist < minDist) {
            minDist = dist;
            nearestIdx = i;
        }
    }

    return nearestIdx;
}

/**
 * Calculate total distance along a route
 * @param coordinates - Array of [lng, lat, elevation] coordinates
 * @returns Total distance in kilometers
 */
export function calculateRouteDistance(
    coordinates: [number, number, number][] | null | undefined
): number {
    if (!coordinates || coordinates.length < 2) return 0;

    let totalDist = 0;
    for (let i = 1; i < coordinates.length; i++) {
        const prev = coordinates[i - 1];
        const curr = coordinates[i];
        totalDist += getDistanceFromLatLonInKm(prev[1], prev[0], curr[1], curr[0]);
    }
    return totalDist;
}
