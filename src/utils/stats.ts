/**
 * Statistics calculation utilities for trek data
 */

import { getDistanceFromLatLonInKm } from './geography';
import type { TrekData, Camp, ExtendedStats, ElevationProfile, ElevationPoint, CampMarker } from '../types/trek';

/**
 * Calculate elevation stats from route coordinates between two indices
 */
function calculateSegmentElevation(
    coords: [number, number, number][],
    startIdx: number,
    endIdx: number
): { gain: number; loss: number } {
    let gain = 0;
    let loss = 0;
    for (let i = startIdx + 1; i <= endIdx && i < coords.length; i++) {
        const diff = coords[i][2] - coords[i - 1][2];
        if (diff > 0) gain += diff;
        else loss += Math.abs(diff);
    }
    return { gain: Math.round(gain), loss: Math.round(loss) };
}

/**
 * Find the closest route point index for given coordinates
 */
function findRoutePointIndex(
    point: [number, number],
    coords: [number, number, number][]
): number {
    let minDist = Infinity;
    let closestIdx = 0;
    for (let i = 0; i < coords.length; i++) {
        const dx = coords[i][0] - point[0];
        const dy = coords[i][1] - point[1];
        const dist = dx * dx + dy * dy;
        if (dist < minDist) {
            minDist = dist;
            closestIdx = i;
        }
    }
    return closestIdx;
}

/**
 * Calculate distance along route between two indices (km)
 */
function calculateRouteDistance(
    coords: [number, number, number][],
    startIdx: number,
    endIdx: number
): number {
    let dist = 0;
    for (let i = startIdx + 1; i <= endIdx && i < coords.length; i++) {
        dist += getDistanceFromLatLonInKm(
            coords[i - 1][1], coords[i - 1][0],
            coords[i][1], coords[i][0]
        );
    }
    return dist;
}

/**
 * Format hiking time from minutes to readable string
 */
function formatHikingTime(totalMinutes: number): string {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = Math.round(totalMinutes % 60);
    if (hours === 0) return `${minutes}min`;
    if (minutes === 0) return `${hours}h`;
    return `${hours}h ${minutes}min`;
}

/**
 * Estimate hiking time using Naismith's Rule with Tranter's corrections
 * Base: 5 km/h horizontal + 1 min per 10m ascent + 1 min per 20m descent
 */
function estimateHikingTimeMinutes(distanceKm: number, elevGain: number, elevLoss: number): number {
    const baseTime = (distanceKm / 5) * 60; // minutes at 5km/h
    const ascentTime = elevGain / 10; // 1 min per 10m
    const descentTime = elevLoss / 20; // 1 min per 20m descent
    return baseTime + ascentTime + descentTime;
}

/**
 * Calculate extended statistics for a trek
 */
export function calculateStats(trekData: TrekData): ExtendedStats {
    const duration = trekData.stats.duration;
    const distance = trekData.stats.totalDistance;
    const coords = trekData.route.coordinates;
    const camps = trekData.camps;

    // Avoid division by zero
    const safeDuration = duration > 0 ? duration : 1;
    const avgDailyDistance = (distance / safeDuration).toFixed(1);

    // Calculate per-day stats
    let maxDailyGain = 0;
    let maxDailyLoss = 0;
    let longestDayDistance = 0;
    let longestDayNumber = 1;
    let steepestDayGradient = 0;
    let steepestDayNumber = 1;

    // Sort camps by day number
    const sortedCamps = [...camps].sort((a, b) => a.dayNumber - b.dayNumber);

    // Calculate route indices for each camp
    const campIndices = sortedCamps.map(camp => {
        if (camp.routePointIndex != null) {
            return Math.min(camp.routePointIndex, coords.length - 1);
        }
        return findRoutePointIndex(camp.coordinates, coords);
    });

    // Calculate daily stats
    let totalGain = 0;
    let totalLoss = 0;

    for (let i = 0; i < sortedCamps.length; i++) {
        const startIdx = i === 0 ? 0 : campIndices[i - 1];
        const endIdx = campIndices[i];

        const { gain, loss } = calculateSegmentElevation(coords, startIdx, endIdx);
        const segmentDist = calculateRouteDistance(coords, startIdx, endIdx);

        totalGain += gain;
        totalLoss += loss;

        if (gain > maxDailyGain) {
            maxDailyGain = gain;
        }
        if (loss > maxDailyLoss) {
            maxDailyLoss = loss;
        }
        if (segmentDist > longestDayDistance) {
            longestDayDistance = segmentDist;
            longestDayNumber = sortedCamps[i].dayNumber;
        }

        // Calculate gradient (elevation change per km)
        if (segmentDist > 0) {
            const gradient = (gain + loss) / segmentDist;
            if (gradient > steepestDayGradient) {
                steepestDayGradient = gradient;
                steepestDayNumber = sortedCamps[i].dayNumber;
            }
        }
    }

    // Also use the elevationGainFromPrevious if it's larger (computed in journeys.ts)
    camps.forEach(camp => {
        if (camp.elevationGainFromPrevious > maxDailyGain) {
            maxDailyGain = camp.elevationGainFromPrevious;
        }
    });

    // Calculate average altitude
    const avgAltitude = coords.length > 0
        ? Math.round(coords.reduce((sum, c) => sum + c[2], 0) / coords.length)
        : 0;

    // Calculate total hiking time estimate
    const totalTimeMinutes = estimateHikingTimeMinutes(distance, totalGain, totalLoss);
    const estimatedTotalTime = formatHikingTime(totalTimeMinutes);

    // Get start and end elevation
    const startElevation = coords.length > 0 ? Math.round(coords[0][2]) : 0;
    const endElevation = coords.length > 0 ? Math.round(coords[coords.length - 1][2]) : 0;

    return {
        avgDailyDistance,
        maxDailyGain,
        maxDailyLoss,
        totalElevationGain: totalGain,
        totalElevationLoss: totalLoss,
        startElevation,
        endElevation,
        avgAltitude,
        longestDayDistance: Math.round(longestDayDistance * 10) / 10,
        longestDayNumber,
        estimatedTotalTime,
        steepestDayGradient: Math.round(steepestDayGradient),
        steepestDayNumber
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
