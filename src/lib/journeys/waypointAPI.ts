/**
 * Waypoint CRUD operations
 */

import { supabase } from '../supabase';
import type { DbWaypoint } from './types';

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
 * New waypoint data structure
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

/**
 * Create a new waypoint for a journey
 */
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
