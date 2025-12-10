/**
 * Photo CRUD operations
 */

import { supabase } from '../supabase';
import type { Photo } from '../../types/trek';

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

    // Transform GeoJSON coordinates to simple [lng, lat] arrays
    return (data || []).map(photo => ({
        ...photo,
        coordinates: photo.coordinates?.coordinates ?? photo.coordinates ?? null
    }));
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
    updates: Partial<Pick<Photo, 'caption' | 'waypoint_id' | 'coordinates' | 'is_hero' | 'sort_order' | 'rotation'>>
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
 * Delete a photo record and its files from R2 storage
 */
export async function deletePhoto(photoId: string): Promise<boolean> {
    if (!supabase) {
        console.warn('Supabase not configured');
        return false;
    }

    // First, fetch the photo to get journey_id for R2 deletion
    const { data: photo, error: fetchError } = await supabase
        .from('photos')
        .select('id, journey_id')
        .eq('id', photoId)
        .single();

    if (fetchError) {
        console.error('Error fetching photo for deletion:', fetchError);
        throw new Error(`Failed to fetch photo: ${fetchError.message}`);
    }
    if (!photo) {
        throw new Error('Photo not found - it may have already been deleted');
    }

    // Delete files from R2 storage
    try {
        const { deletePhotoFiles } = await import('../media');
        await deletePhotoFiles(photo.journey_id, photo.id);
    } catch (r2Error) {
        console.warn('Failed to delete R2 files (continuing with DB delete):', r2Error);
        // Continue with DB deletion even if R2 fails
        // The files may not exist or already be deleted
    }

    // Delete the database record
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

    // Transform GeoJSON coordinates to simple [lng, lat] arrays
    return (data || []).map(photo => ({
        ...photo,
        coordinates: photo.coordinates?.coordinates ?? photo.coordinates ?? null
    }));
}
