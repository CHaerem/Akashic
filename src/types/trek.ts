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
    /** Distance from journey start along route (km) - if set via RouteEditor */
    routeDistanceKm?: number | null;
    /** Index in route coordinates array - if set via RouteEditor */
    routePointIndex?: number | null;
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
    /** Start date of the journey (YYYY-MM-DD) */
    dateStarted?: string;
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

export interface ElevationPoint {
    dist: number;
    ele: number;
    x: number;
    y: number;
}

export interface CampMarker {
    campId: string;
    dayNumber: number;
    name: string;
    dist: number;
    ele: number;
    x: number;
    y: number;
}

export interface ElevationProfile {
    linePath: string;
    areaPath: string;
    minEle: number;
    maxEle: number;
    totalDist: number;
    plotMinEle: number;
    plotMaxEle: number;
    /** Raw points for hover detection */
    points: ElevationPoint[];
    /** Camp positions on the profile */
    campMarkers: CampMarker[];
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
