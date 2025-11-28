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
    /** Points of interest along the route */
    pointsOfInterest?: PointOfInterest[];
    /** Detailed segment information between camps */
    segments?: RouteSegment[];
    /** Notable route highlights/sections */
    routeHighlights?: RouteHighlight[];
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

/**
 * Point of Interest categories for route markers
 */
export type POICategory =
    | 'viewpoint'      // Scenic overlooks, panoramic views
    | 'water'          // Water sources, rivers, lakes
    | 'landmark'       // Notable landmarks, monuments
    | 'shelter'        // Shelters, huts, emergency spots
    | 'warning'        // Hazards, difficult sections
    | 'info'           // Information points, trail markers
    | 'wildlife'       // Wildlife spotting areas
    | 'photo_spot'     // Recommended photo spots
    | 'rest_area'      // Rest stops, picnic areas
    | 'summit';        // Peak or summit points

/**
 * Point of Interest along the journey route
 */
export interface PointOfInterest {
    id: string;
    name: string;
    category: POICategory;
    coordinates: [number, number];  // [lng, lat]
    elevation?: number;
    description?: string;
    /** Distance from journey start along route (km) */
    routeDistanceKm?: number;
    /** Tips or additional info */
    tips?: string[];
    /** Approximate time from previous POI/camp */
    timeFromPrevious?: string;
    /** Icon to display (optional, uses category default) */
    icon?: string;
}

/**
 * Route segment between two camps with detailed statistics
 */
export interface RouteSegment {
    fromCampId: string;
    toCampId: string;
    distance: number;           // km
    elevationGain: number;      // meters gained
    elevationLoss: number;      // meters lost
    estimatedTime: string;      // e.g., "4-5 hours"
    difficulty: 'easy' | 'moderate' | 'challenging' | 'difficult';
    terrain?: string[];         // e.g., ['rocky', 'forest', 'exposed']
    highlights?: string[];      // Notable features along segment
    warnings?: string[];        // Hazards or cautions
}

/**
 * Enhanced route information with highlights
 */
export interface RouteHighlight {
    id: string;
    name: string;
    type: 'steep_climb' | 'river_crossing' | 'scenic_section' | 'technical' | 'exposed' | 'forest' | 'alpine';
    /** Start distance from journey start (km) */
    startDistanceKm: number;
    /** End distance from journey start (km) */
    endDistanceKm: number;
    description?: string;
    color?: string;  // Custom color for visualization
}

export type ViewMode = 'globe' | 'trek';
export type TabType = 'overview' | 'journey' | 'stats' | 'photos';
