/**
 * Supabase data layer for journeys
 * Fetches and transforms journey data from Supabase to match existing app types
 */

import { supabase } from './supabase';
import type { TrekConfig, TrekData, Camp, Route, TrekStats, Photo, Profile, JourneyMember, JourneyRole } from '../types/trek';

// Database types (from Supabase)
interface DbJourney {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    country: string | null;
    summit_elevation: number | null;
    total_distance: number | null;
    total_days: number | null;
    date_started: string | null;
    date_ended: string | null;
    hero_image_url: string | null;
    center_coordinates: [number, number] | null;
    route: Route | null;
    stats: TrekStats | null;
    preferred_bearing: number | null;
    preferred_pitch: number | null;
    is_public: boolean;
}

interface DbWaypoint {
    id: string;
    journey_id: string;
    name: string;
    waypoint_type: string;
    day_number: number | null;
    coordinates: [number, number];
    elevation: number | null;
    description: string | null;
    highlights: string[] | null;
    sort_order: number | null;
    /** Distance from journey start along route (km) */
    route_distance_km: number | null;
    /** Index in route coordinates array */
    route_point_index: number | null;
}

// Transform database journey to TrekConfig (for globe markers)
function toTrekConfig(journey: DbJourney): TrekConfig {
    const [lng, lat] = journey.center_coordinates || [0, 0];
    return {
        id: journey.slug,
        name: journey.name.split(' - ')[0], // "Kilimanjaro - Lemosho Route" -> "Kilimanjaro"
        country: journey.country || '',
        elevation: journey.summit_elevation ? `${journey.summit_elevation.toLocaleString()}m` : '',
        lat,
        lng,
        preferredBearing: journey.preferred_bearing || 0,
        preferredPitch: journey.preferred_pitch || 60,
        slug: journey.slug
    };
}


/**
 * Find the closest route point index for a camp's coordinates
 */
function findClosestRoutePointIndex(
    campCoords: [number, number],
    routeCoords: [number, number, number][]
): number {
    let minDistance = Infinity;
    let closestIndex = 0;

    for (let i = 0; i < routeCoords.length; i++) {
        const routePoint = routeCoords[i];
        // Simple distance calculation (good enough for finding closest point)
        const dLng = routePoint[0] - campCoords[0];
        const dLat = routePoint[1] - campCoords[1];
        const dist = dLng * dLng + dLat * dLat;
        if (dist < minDistance) {
            minDistance = dist;
            closestIndex = i;
        }
    }

    return closestIndex;
}

/**
 * Calculate elevation gain between two route indices
 * Only counts positive elevation changes (gain, not loss)
 */
function calculateElevationGainBetweenIndices(
    routeCoords: [number, number, number][],
    startIndex: number,
    endIndex: number
): number {
    if (startIndex >= endIndex) return 0;

    let totalGain = 0;
    for (let i = startIndex + 1; i <= endIndex; i++) {
        const elevDiff = routeCoords[i][2] - routeCoords[i - 1][2];
        if (elevDiff > 0) {
            totalGain += elevDiff;
        }
    }

    return Math.round(totalGain);
}

// Transform database journey + waypoints to TrekData
function toTrekData(journey: DbJourney, waypoints: DbWaypoint[]): TrekData {
    const routeCoords = journey.route?.coordinates || [];

    // First pass: create camps with their route positions
    const sortedWaypoints = waypoints
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

    // Calculate route indices for each camp
    const campRouteIndices: number[] = sortedWaypoints.map(w => {
        if (w.route_point_index != null) {
            return Math.min(w.route_point_index, routeCoords.length - 1);
        }
        if (routeCoords.length === 0) return 0;
        return findClosestRoutePointIndex(w.coordinates, routeCoords);
    });

    // Create camps with calculated elevation gains
    const camps: Camp[] = sortedWaypoints.map((w, i) => {
        let elevationGainFromPrevious = 0;

        if (i > 0 && routeCoords.length > 0) {
            const prevIndex = campRouteIndices[i - 1];
            const currIndex = campRouteIndices[i];
            elevationGainFromPrevious = calculateElevationGainBetweenIndices(
                routeCoords,
                prevIndex,
                currIndex
            );
        }

        return {
            id: w.id,
            name: w.name,
            dayNumber: w.day_number || i + 1,
            elevation: w.elevation || 0,
            coordinates: w.coordinates,
            elevationGainFromPrevious,
            notes: w.description || '',
            highlights: w.highlights || [],
            routeDistanceKm: w.route_distance_km,
            routePointIndex: w.route_point_index,
        };
    });

    return {
        id: journey.slug,
        name: journey.name,
        country: journey.country || '',
        description: journey.description || '',
        stats: journey.stats || {
            duration: journey.total_days || 0,
            totalDistance: journey.total_distance || 0,
            totalElevationGain: 0,
            highestPoint: {
                name: 'Summit',
                elevation: journey.summit_elevation || 0
            }
        },
        camps,
        route: journey.route || { type: 'LineString', coordinates: [] },
        dateStarted: journey.date_started || undefined
    };
}

// Cache for journey data
let journeyCache: {
    treks: TrekConfig[];
    trekDataMap: Record<string, TrekData>;
    loaded: boolean;
} = {
    treks: [],
    trekDataMap: {},
    loaded: false
};

/**
 * Fetch all public journeys from Supabase
 */
export async function fetchJourneys(): Promise<{
    treks: TrekConfig[];
    trekDataMap: Record<string, TrekData>;
}> {
    if (!supabase) {
        console.warn('Supabase not configured, using empty data');
        return { treks: [], trekDataMap: {} };
    }

    // Fetch journeys
    // MVP: Any authenticated user can see all journeys
    // Future: Add sharing permissions (private, shared, public)
    const { data: journeys, error: journeysError } = await supabase
        .from('journeys')
        .select('*')
        .order('name');

    if (journeysError) {
        console.error('Error fetching journeys:', journeysError);
        return { treks: [], trekDataMap: {} };
    }

    if (!journeys || journeys.length === 0) {
        return { treks: [], trekDataMap: {} };
    }

    // Fetch all waypoints for these journeys
    const journeyIds = journeys.map(j => j.id);
    const { data: waypoints, error: waypointsError } = await supabase
        .from('waypoints')
        .select('*')
        .in('journey_id', journeyIds)
        .order('sort_order');

    if (waypointsError) {
        console.error('Error fetching waypoints:', waypointsError);
    }

    // Group waypoints by journey
    const waypointsByJourney: Record<string, DbWaypoint[]> = {};
    (waypoints || []).forEach(w => {
        if (!waypointsByJourney[w.journey_id]) {
            waypointsByJourney[w.journey_id] = [];
        }
        waypointsByJourney[w.journey_id].push(w);
    });

    // Transform to app types
    const treks: TrekConfig[] = [];
    const trekDataMap: Record<string, TrekData> = {};

    journeys.forEach(journey => {
        const config = toTrekConfig(journey);
        const data = toTrekData(journey, waypointsByJourney[journey.id] || []);

        treks.push(config);
        trekDataMap[journey.slug] = data;
    });

    // Update cache
    journeyCache = { treks, trekDataMap, loaded: true };

    return { treks, trekDataMap };
}

/**
 * Get cached journey data (call fetchJourneys first)
 */
export function getJourneyCache() {
    return journeyCache;
}

/**
 * Get trek data by ID from cache
 */
export function getTrekData(id: string): TrekData | null {
    return journeyCache.trekDataMap[id] || null;
}

/**
 * Get trek config by ID from cache
 */
export function getTrekConfig(id: string): TrekConfig | null {
    return journeyCache.treks.find(t => t.id === id) || null;
}

/**
 * Check if data is loaded
 */
export function isDataLoaded(): boolean {
    return journeyCache.loaded;
}

/**
 * Fetch photos for a journey
 */
export async function fetchPhotos(journeyId: string): Promise<Photo[]> {
    if (!supabase) {
        console.warn('Supabase not configured');
        return [];
    }

    const { data, error } = await supabase
        .from('photos')
        .select('*')
        .eq('journey_id', journeyId)
        .order('sort_order', { ascending: true })
        .order('taken_at', { ascending: true, nullsFirst: false });

    if (error) {
        console.error('Error fetching photos:', error);
        return [];
    }

    return data || [];
}

/**
 * Create a new photo record after upload
 */
export async function createPhoto(photo: {
    journey_id: string;
    url: string;
    thumbnail_url?: string;
    caption?: string;
    coordinates?: [number, number];
    taken_at?: string;
    waypoint_id?: string;
}): Promise<Photo | null> {
    if (!supabase) {
        console.warn('Supabase not configured');
        return null;
    }

    const { data, error } = await supabase
        .from('photos')
        .insert(photo)
        .select()
        .single();

    if (error) {
        console.error('Error creating photo:', error);
        throw new Error(error.message);
    }

    return data;
}

/**
 * Update a photo record
 */
export async function updatePhoto(
    photoId: string,
    updates: Partial<Pick<Photo, 'caption' | 'waypoint_id' | 'coordinates' | 'is_hero' | 'sort_order'>>
): Promise<Photo | null> {
    if (!supabase) {
        console.warn('Supabase not configured');
        return null;
    }

    const { data, error } = await supabase
        .from('photos')
        .update(updates)
        .eq('id', photoId)
        .select()
        .single();

    if (error) {
        console.error('Error updating photo:', error);
        throw new Error(error.message);
    }

    return data;
}

/**
 * Delete a photo record
 */
export async function deletePhoto(photoId: string): Promise<boolean> {
    if (!supabase) {
        console.warn('Supabase not configured');
        return false;
    }

    const { error } = await supabase
        .from('photos')
        .delete()
        .eq('id', photoId);

    if (error) {
        console.error('Error deleting photo:', error);
        throw new Error(error.message);
    }

    return true;
}

/**
 * Get the database journey ID from a slug
 */
export async function getJourneyIdBySlug(slug: string): Promise<string | null> {
    if (!supabase) return null;

    const { data, error } = await supabase
        .from('journeys')
        .select('id')
        .eq('slug', slug)
        .single();

    if (error) {
        console.error('Error fetching journey ID:', error);
        return null;
    }

    return data?.id || null;
}

/**
 * Editable journey fields
 */
export interface JourneyUpdate {
    name?: string;
    description?: string;
    country?: string;
    date_started?: string | null;
    date_ended?: string | null;
    total_days?: number | null;
    total_distance?: number | null;
    summit_elevation?: number | null;
    route?: Route | null;
}

/**
 * Update a journey
 */
export async function updateJourney(slug: string, updates: JourneyUpdate): Promise<boolean> {
    if (!supabase) {
        console.warn('Supabase not configured');
        return false;
    }

    const { error } = await supabase
        .from('journeys')
        .update(updates)
        .eq('slug', slug);

    if (error) {
        console.error('Error updating journey:', error);
        throw new Error(error.message);
    }

    // Update local cache if loaded
    if (journeyCache.loaded && journeyCache.trekDataMap[slug]) {
        const cached = journeyCache.trekDataMap[slug];
        if (updates.name !== undefined) cached.name = updates.name;
        if (updates.description !== undefined) cached.description = updates.description;
        if (updates.country !== undefined) cached.country = updates.country;
        if (updates.date_started !== undefined) cached.dateStarted = updates.date_started || undefined;
        if (updates.route !== undefined) cached.route = updates.route || { type: 'LineString', coordinates: [] };
    }

    return true;
}

/**
 * Update journey route coordinates
 * Recalculates total_distance based on new route
 */
export async function updateJourneyRoute(slug: string, route: Route): Promise<boolean> {
    if (!supabase) {
        console.warn('Supabase not configured');
        return false;
    }

    // Calculate total distance from route coordinates
    let totalDistance = 0;
    const coords = route.coordinates;
    for (let i = 1; i < coords.length; i++) {
        const [lng1, lat1] = coords[i - 1];
        const [lng2, lat2] = coords[i];
        // Haversine formula for distance
        const R = 6371;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) ** 2;
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        totalDistance += R * c;
    }

    const { error } = await supabase
        .from('journeys')
        .update({
            route,
            total_distance: Math.round(totalDistance * 10) / 10
        })
        .eq('slug', slug);

    if (error) {
        console.error('Error updating journey route:', error);
        throw new Error(error.message);
    }

    // Update local cache
    if (journeyCache.loaded && journeyCache.trekDataMap[slug]) {
        journeyCache.trekDataMap[slug].route = route;
        journeyCache.trekDataMap[slug].stats.totalDistance = Math.round(totalDistance * 10) / 10;
    }

    return true;
}

/**
 * Get full journey details for editing
 */
export async function getJourneyForEdit(slug: string): Promise<DbJourney | null> {
    if (!supabase) return null;

    const { data, error } = await supabase
        .from('journeys')
        .select('*')
        .eq('slug', slug)
        .single();

    if (error) {
        console.error('Error fetching journey:', error);
        return null;
    }

    return data;
}

// Export DbJourney type for components
export type { DbJourney, DbWaypoint };

/**
 * Editable waypoint fields
 */
export interface WaypointUpdate {
    name?: string;
    description?: string;
    elevation?: number | null;
    day_number?: number | null;
    highlights?: string[] | null;
    coordinates?: [number, number];
    route_distance_km?: number | null;
    route_point_index?: number | null;
}

/**
 * Update a waypoint
 */
export async function updateWaypoint(waypointId: string, updates: WaypointUpdate): Promise<boolean> {
    if (!supabase) {
        console.warn('Supabase not configured');
        return false;
    }

    const { error } = await supabase
        .from('waypoints')
        .update(updates)
        .eq('id', waypointId);

    if (error) {
        console.error('Error updating waypoint:', error);
        throw new Error(error.message);
    }

    return true;
}

/**
 * Get waypoint by ID
 */
export async function getWaypoint(waypointId: string): Promise<DbWaypoint | null> {
    if (!supabase) return null;

    const { data, error } = await supabase
        .from('waypoints')
        .select('*')
        .eq('id', waypointId)
        .single();

    if (error) {
        console.error('Error fetching waypoint:', error);
        return null;
    }

    return data;
}

/**
 * Assign a photo to a waypoint (day)
 */
export async function assignPhotoToWaypoint(photoId: string, waypointId: string | null): Promise<boolean> {
    if (!supabase) {
        console.warn('Supabase not configured');
        return false;
    }

    const { error } = await supabase
        .from('photos')
        .update({ waypoint_id: waypointId })
        .eq('id', photoId);

    if (error) {
        console.error('Error assigning photo to waypoint:', error);
        throw new Error(error.message);
    }

    return true;
}

/**
 * Get photos assigned to a specific waypoint
 */
export async function getPhotosForWaypoint(waypointId: string): Promise<Photo[]> {
    if (!supabase) return [];

    const { data, error } = await supabase
        .from('photos')
        .select('*')
        .eq('waypoint_id', waypointId)
        .order('sort_order', { ascending: true })
        .order('taken_at', { ascending: true, nullsFirst: false });

    if (error) {
        console.error('Error fetching photos for waypoint:', error);
        return [];
    }

    return data || [];
}

/**
 * Update waypoint position on route
 * Used when dragging a camp marker to a new position
 */
export async function updateWaypointPosition(
    waypointId: string,
    coordinates: [number, number],
    elevation: number | null,
    routeDistanceKm: number | null,
    routePointIndex: number | null
): Promise<boolean> {
    if (!supabase) {
        console.warn('Supabase not configured');
        return false;
    }

    const { error } = await supabase
        .from('waypoints')
        .update({
            coordinates,
            elevation,
            route_distance_km: routeDistanceKm,
            route_point_index: routePointIndex
        })
        .eq('id', waypointId);

    if (error) {
        console.error('Error updating waypoint position:', error);
        throw new Error(error.message);
    }

    return true;
}

/**
 * Create a new waypoint for a journey
 */
export interface NewWaypoint {
    journey_id: string;
    name: string;
    waypoint_type?: string;
    day_number?: number;
    coordinates: [number, number];
    elevation?: number;
    description?: string;
    sort_order?: number;
    route_distance_km?: number;
    route_point_index?: number;
}

export async function createWaypoint(waypoint: NewWaypoint): Promise<DbWaypoint | null> {
    if (!supabase) {
        console.warn('Supabase not configured');
        return null;
    }

    const { data, error } = await supabase
        .from('waypoints')
        .insert({
            ...waypoint,
            waypoint_type: waypoint.waypoint_type || 'camp'
        })
        .select()
        .single();

    if (error) {
        console.error('Error creating waypoint:', error);
        throw new Error(error.message);
    }

    return data;
}

/**
 * Delete a waypoint
 */
export async function deleteWaypoint(waypointId: string): Promise<boolean> {
    if (!supabase) {
        console.warn('Supabase not configured');
        return false;
    }

    const { error } = await supabase
        .from('waypoints')
        .delete()
        .eq('id', waypointId);

    if (error) {
        console.error('Error deleting waypoint:', error);
        throw new Error(error.message);
    }

    return true;
}

/**
 * Update sort order for multiple waypoints (for reordering)
 */
export async function updateWaypointOrder(
    updates: Array<{ id: string; sort_order: number; day_number: number }>
): Promise<boolean> {
    if (!supabase) {
        console.warn('Supabase not configured');
        return false;
    }

    // Use a transaction-like approach with multiple updates
    for (const update of updates) {
        const { error } = await supabase
            .from('waypoints')
            .update({ sort_order: update.sort_order, day_number: update.day_number })
            .eq('id', update.id);

        if (error) {
            console.error('Error updating waypoint order:', error);
            throw new Error(error.message);
        }
    }

    return true;
}

// ============================================
// Member Management Functions
// ============================================

/**
 * Get all members of a journey with their profiles
 */
export async function getJourneyMembers(journeyId: string): Promise<JourneyMember[]> {
    if (!supabase) {
        console.warn('Supabase not configured');
        return [];
    }

    const { data, error } = await supabase
        .from('journey_members')
        .select(`
            *,
            profile:profiles(*)
        `)
        .eq('journey_id', journeyId)
        .order('created_at');

    if (error) {
        console.error('Error fetching journey members:', error);
        return [];
    }

    return data || [];
}

/**
 * Get all registered users (for invite dropdown)
 */
export async function getRegisteredUsers(): Promise<Profile[]> {
    if (!supabase) {
        console.warn('Supabase not configured');
        return [];
    }

    const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .order('display_name');

    if (error) {
        console.error('Error fetching profiles:', error);
        return [];
    }

    return data || [];
}

/**
 * Add a member to a journey (owner only)
 */
export async function addJourneyMember(
    journeyId: string,
    userId: string,
    role: JourneyRole
): Promise<JourneyMember | null> {
    if (!supabase) {
        console.warn('Supabase not configured');
        return null;
    }

    // Get current user to set as inviter
    const { data: { user } } = await supabase.auth.getUser();

    const { data, error } = await supabase
        .from('journey_members')
        .insert({
            journey_id: journeyId,
            user_id: userId,
            role,
            invited_by: user?.id
        })
        .select(`
            *,
            profile:profiles(*)
        `)
        .single();

    if (error) {
        console.error('Error adding journey member:', error);
        throw new Error(error.message);
    }

    return data;
}

/**
 * Remove a member from a journey (owner only, or self-remove)
 */
export async function removeJourneyMember(journeyId: string, userId: string): Promise<boolean> {
    if (!supabase) {
        console.warn('Supabase not configured');
        return false;
    }

    const { error } = await supabase
        .from('journey_members')
        .delete()
        .eq('journey_id', journeyId)
        .eq('user_id', userId);

    if (error) {
        console.error('Error removing journey member:', error);
        throw new Error(error.message);
    }

    return true;
}

/**
 * Update a member's role (owner only)
 */
export async function updateMemberRole(
    journeyId: string,
    userId: string,
    newRole: JourneyRole
): Promise<boolean> {
    if (!supabase) {
        console.warn('Supabase not configured');
        return false;
    }

    const { error } = await supabase
        .from('journey_members')
        .update({ role: newRole })
        .eq('journey_id', journeyId)
        .eq('user_id', userId);

    if (error) {
        console.error('Error updating member role:', error);
        throw new Error(error.message);
    }

    return true;
}

/**
 * Get current user's role in a journey
 */
export async function getUserJourneyRole(journeyId: string): Promise<JourneyRole | null> {
    if (!supabase) {
        console.warn('Supabase not configured');
        return null;
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await supabase
        .from('journey_members')
        .select('role')
        .eq('journey_id', journeyId)
        .eq('user_id', user.id)
        .single();

    if (error) {
        // User is not a member
        return null;
    }

    return data?.role as JourneyRole || null;
}

/**
 * Check if current user has at least the required role for a journey
 */
export async function userHasRole(journeyId: string, requiredRole: JourneyRole): Promise<boolean> {
    const userRole = await getUserJourneyRole(journeyId);
    if (!userRole) return false;

    const roleHierarchy: Record<JourneyRole, number> = {
        'viewer': 1,
        'editor': 2,
        'owner': 3
    };

    return roleHierarchy[userRole] >= roleHierarchy[requiredRole];
}
