/**
 * Media utilities for loading images from authenticated R2 storage
 */

import { supabase } from './supabase';

const MEDIA_BASE_URL = import.meta.env.VITE_MEDIA_URL || 'https://akashic-media.chris-haerem.workers.dev';

/**
 * Get the current user's access token for authenticated media requests
 */
export async function getAccessToken(): Promise<string | null> {
    if (!supabase) return null;

    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ?? null;
}

/**
 * Build an authenticated URL for a media resource
 * Appends the JWT token as a query parameter for <img> tag usage
 */
export async function getAuthenticatedMediaUrl(path: string): Promise<string> {
    const token = await getAccessToken();
    const baseUrl = `${MEDIA_BASE_URL}/${path}`;

    if (token) {
        return `${baseUrl}?token=${encodeURIComponent(token)}`;
    }

    // Return URL without token (will fail auth if journey is not public)
    return baseUrl;
}

/**
 * Build a media URL synchronously (for use when token is already known)
 */
export function buildMediaUrl(path: string, token?: string | null): string {
    const baseUrl = `${MEDIA_BASE_URL}/${path}`;

    if (token) {
        return `${baseUrl}?token=${encodeURIComponent(token)}`;
    }

    return baseUrl;
}

/**
 * Get a photo path for a journey
 */
export function getJourneyPhotoPath(journeySlug: string, photoId: string, extension = 'jpg'): string {
    return `journeys/${journeySlug}/photos/${photoId}.${extension}`;
}
