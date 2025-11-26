/**
 * Supabase data layer for journeys
 * Fetches and transforms journey data from Supabase to match existing app types
 */

import { supabase } from './supabase';
import type { TrekConfig, TrekData, Camp, Route, TrekStats, Photo } from '../types/trek';

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

// Transform database waypoint to Camp
function toCamp(waypoint: DbWaypoint, index: number): Camp {
    return {
        id: waypoint.id,
        name: waypoint.name,
        dayNumber: waypoint.day_number || index + 1,
        elevation: waypoint.elevation || 0,
        coordinates: waypoint.coordinates,
        elevationGainFromPrevious: 0, // Not stored in DB, could be calculated
        notes: waypoint.description || '',
        highlights: waypoint.highlights || [],
        // bearing and pitch can be added to waypoints table if needed
    };
}

// Transform database journey + waypoints to TrekData
function toTrekData(journey: DbJourney, waypoints: DbWaypoint[]): TrekData {
    const camps = waypoints
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
        .map((w, i) => toCamp(w, i));

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
