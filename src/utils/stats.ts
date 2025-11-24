/**
 * Statistics calculation utilities for trek data
 */

import { getDistanceFromLatLonInKm } from './geography';
import type { TrekData, ExtendedStats, ElevationProfile } from '../types/trek';

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
 * Generate elevation profile data for SVG rendering
 */
export function generateElevationProfile(
    coordinates: [number, number, number][] | null | undefined
): ElevationProfile | null {
    if (!coordinates || coordinates.length === 0) return null;

    // Calculate cumulative distance and extract elevation
    const points: { dist: number; ele: number }[] = [];
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

        points.push({ dist: totalDist, ele });
    }

    // Normalize to SVG viewbox
    const width = 300;
    const height = 120;

    // Add padding to elevation range for better visuals
    const eleRange = maxEle - minEle;
    const plotMinEle = Math.max(0, minEle - (eleRange > 0 ? eleRange * 0.1 : 100));
    const plotMaxEle = maxEle + (eleRange > 0 ? eleRange * 0.1 : 100);
    const plotEleRange = plotMaxEle - plotMinEle;

    const pathPoints = points.map(p => {
        const x = totalDist > 0 ? (p.dist / totalDist) * width : 0;
        const y = plotEleRange > 0 ? height - ((p.ele - plotMinEle) / plotEleRange) * height : height / 2;
        return `${x},${y}`;
    });

    // Generate SVG paths
    const linePath = `M ${pathPoints.join(' L ')}`;
    const areaPath = `${linePath} L ${width},${height} L 0,${height} Z`;

    return { linePath, areaPath, minEle, maxEle, totalDist, plotMinEle, plotMaxEle };
}
