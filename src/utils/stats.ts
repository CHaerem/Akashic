/**
 * Statistics calculation utilities for trek data
 */

import { getDistanceFromLatLonInKm } from './geography';
import type { TrekData, Camp, ExtendedStats, ElevationProfile, ElevationPoint, CampMarker } from '../types/trek';

/**
 * Calculate extended statistics for a trek
 */
export function calculateStats(trekData: TrekData): ExtendedStats {
    const duration = trekData.stats.duration;
    const distance = trekData.stats.totalDistance;
    const avgDailyDistance = (distance / duration).toFixed(1);

    let maxDailyGain = 0;
    trekData.camps.forEach(camp => {
        if (camp.elevationGainFromPrevious > maxDailyGain) {
            maxDailyGain = camp.elevationGainFromPrevious;
        }
    });

    return {
        avgDailyDistance,
        maxDailyGain,
        difficulty: 'Hard',
        startElevation: trekData.route.coordinates[0][2]
    };
}

/**
 * Find the closest route point to a camp's coordinates
 */
function findCampDistanceOnRoute(
    campCoords: [number, number],
    routeCoords: [number, number, number][],
    cumulativeDistances: number[]
): { dist: number; ele: number } | null {
    let minDistance = Infinity;
    let closestIndex = 0;

    for (let i = 0; i < routeCoords.length; i++) {
        const routePoint = routeCoords[i];
        const dist = getDistanceFromLatLonInKm(
            campCoords[1], campCoords[0],  // camp lat, lng
            routePoint[1], routePoint[0]   // route lat, lng
        );
        if (dist < minDistance) {
            minDistance = dist;
            closestIndex = i;
        }
    }

    // Only match if within 500m of the route
    if (minDistance > 0.5) return null;

    return {
        dist: cumulativeDistances[closestIndex],
        ele: routeCoords[closestIndex][2]
    };
}

/**
 * Generate elevation profile data for SVG rendering
 */
export function generateElevationProfile(
    coordinates: [number, number, number][] | null | undefined,
    camps?: Camp[]
): ElevationProfile | null {
    if (!coordinates || coordinates.length === 0) return null;

    // Calculate cumulative distance and extract elevation
    const rawPoints: { dist: number; ele: number }[] = [];
    const cumulativeDistances: number[] = [];
    let totalDist = 0;
    let minEle = Infinity;
    let maxEle = -Infinity;

    for (let i = 0; i < coordinates.length; i++) {
        const coord = coordinates[i];
        const ele = coord[2];

        if (i > 0) {
            const prev = coordinates[i - 1];
            totalDist += getDistanceFromLatLonInKm(prev[1], prev[0], coord[1], coord[0]);
        }

        if (ele < minEle) minEle = ele;
        if (ele > maxEle) maxEle = ele;

        rawPoints.push({ dist: totalDist, ele });
        cumulativeDistances.push(totalDist);
    }

    // Normalize to SVG viewbox
    const width = 300;
    const height = 120;

    // Add padding to elevation range for better visuals
    const eleRange = maxEle - minEle;
    const plotMinEle = Math.max(0, minEle - (eleRange > 0 ? eleRange * 0.1 : 100));
    const plotMaxEle = maxEle + (eleRange > 0 ? eleRange * 0.1 : 100);
    const plotEleRange = plotMaxEle - plotMinEle;

    // Convert to SVG coordinates
    const toSvgCoords = (dist: number, ele: number): { x: number; y: number } => ({
        x: totalDist > 0 ? (dist / totalDist) * width : 0,
        y: plotEleRange > 0 ? height - ((ele - plotMinEle) / plotEleRange) * height : height / 2
    });

    // Generate points with SVG coordinates
    const points: ElevationPoint[] = rawPoints.map(p => ({
        ...p,
        ...toSvgCoords(p.dist, p.ele)
    }));

    // Generate SVG paths
    const pathPoints = points.map(p => `${p.x},${p.y}`);
    const linePath = `M ${pathPoints.join(' L ')}`;
    const areaPath = `${linePath} L ${width},${height} L 0,${height} Z`;

    // Calculate camp markers
    const campMarkers: CampMarker[] = [];
    if (camps && camps.length > 0) {
        for (const camp of camps) {
            let campPos: { dist: number; ele: number } | null = null;

            // Use stored route distance if available (more accurate)
            if (camp.routeDistanceKm != null && camp.routePointIndex != null) {
                // Use the stored route position
                const routeIndex = Math.min(camp.routePointIndex, coordinates.length - 1);
                campPos = {
                    dist: camp.routeDistanceKm,
                    ele: coordinates[routeIndex][2]
                };
            } else {
                // Fall back to finding closest route point
                campPos = findCampDistanceOnRoute(camp.coordinates, coordinates, cumulativeDistances);
            }

            if (campPos) {
                const svgCoords = toSvgCoords(campPos.dist, campPos.ele);
                campMarkers.push({
                    campId: camp.id,
                    dayNumber: camp.dayNumber,
                    name: camp.name,
                    dist: campPos.dist,
                    ele: campPos.ele,
                    ...svgCoords
                });
            }
        }
        // Sort by distance
        campMarkers.sort((a, b) => a.dist - b.dist);
    }

    return {
        linePath,
        areaPath,
        minEle,
        maxEle,
        totalDist,
        plotMinEle,
        plotMaxEle,
        points,
        campMarkers
    };
}
