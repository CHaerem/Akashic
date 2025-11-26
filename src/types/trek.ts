/**
 * Type definitions for trek data structures
 */

export interface Coordinates {
    /** [longitude, latitude, elevation] */
    0: number;
    1: number;
    2: number;
}

export interface Camp {
    id: string;
    name: string;
    dayNumber: number;
    elevation: number;
    coordinates: [number, number];
    elevationGainFromPrevious: number;
    notes: string;
    highlights?: string[];
    bearing?: number;
    pitch?: number;
}

export interface Route {
    type: 'LineString';
    coordinates: [number, number, number][];
}

export interface HighestPoint {
    name: string;
    elevation: number;
}

export interface TrekStats {
    duration: number;
    totalDistance: number;
    totalElevationGain: number;
    highestPoint: HighestPoint;
}

export interface TrekData {
    id: string;
    name: string;
    country: string;
    description: string;
    stats: TrekStats;
    camps: Camp[];
    route: Route;
}

export interface TrekConfig {
    id: string;
    name: string;
    country: string;
    elevation: string;
    lat: number;
    lng: number;
    preferredBearing: number;
    preferredPitch: number;
    /** Slug for building media URLs (e.g., hero images) */
    slug: string;
}

export interface ExtendedStats {
    avgDailyDistance: string;
    maxDailyGain: number;
    difficulty: string;
    startElevation: number;
}

export interface ElevationProfile {
    linePath: string;
    areaPath: string;
    minEle: number;
    maxEle: number;
    totalDist: number;
    plotMinEle: number;
    plotMaxEle: number;
}

export interface Photo {
    id: string;
    journey_id: string;
    waypoint_id?: string | null;
    url: string;
    thumbnail_url?: string | null;
    caption?: string | null;
    coordinates?: [number, number] | null;
    taken_at?: string | null;
    is_hero?: boolean;
    sort_order?: number;
    created_at?: string;
}

export type ViewMode = 'globe' | 'trek';
export type TabType = 'overview' | 'journey' | 'stats' | 'photos';
