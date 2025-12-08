/**
 * Journey CRUD operations and cache management
 */

import { supabase } from '../supabase';
import type { TrekConfig, TrekData, Route } from '../../types/trek';
import type { DbJourney, DbWaypoint } from './types';
import { toTrekConfig, toTrekData } from './transforms';

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
