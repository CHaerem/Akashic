/**
 * Media utilities for loading images from authenticated R2 storage
 */

import { supabase } from './supabase';

// Thumbnail settings
const THUMBNAIL_MAX_SIZE = 400; // Max width/height in pixels
const THUMBNAIL_QUALITY = 0.8; // JPEG quality (0-1)

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
 * Get a photo path for a journey (uses UUID for immutable paths)
 */
export function getJourneyPhotoPath(journeyId: string, photoId: string, extension = 'jpg'): string {
    return `journeys/${journeyId}/photos/${photoId}.${extension}`;
}

/**
 * Upload result from the media Worker with extracted metadata
 */
export interface UploadResult {
    photoId: string;
    path: string;
    size: number;
    contentType: string;
    // Thumbnail path (generated client-side)
    thumbnailPath?: string;
    // Extracted EXIF metadata (optional)
    coordinates?: [number, number];
    takenAt?: Date;
}

/**
 * Create a thumbnail from an image file using Canvas API
 * @param file - Original image file
 * @param maxSize - Maximum width/height for thumbnail
 * @returns Blob of the resized image as JPEG
 */
export async function createThumbnail(file: File, maxSize = THUMBNAIL_MAX_SIZE): Promise<Blob> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);

        img.onload = () => {
            URL.revokeObjectURL(url);

            // Calculate new dimensions maintaining aspect ratio
            let width = img.width;
            let height = img.height;

            if (width > height) {
                if (width > maxSize) {
                    height = Math.round((height * maxSize) / width);
                    width = maxSize;
                }
            } else {
                if (height > maxSize) {
                    width = Math.round((width * maxSize) / height);
                    height = maxSize;
                }
            }

            // Create canvas and draw resized image
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;

            const ctx = canvas.getContext('2d');
            if (!ctx) {
                reject(new Error('Failed to get canvas context'));
                return;
            }

            // Use high-quality image smoothing
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, width, height);

            // Convert to blob
            canvas.toBlob(
                (blob) => {
                    if (blob) {
                        resolve(blob);
                    } else {
                        reject(new Error('Failed to create thumbnail blob'));
                    }
                },
                'image/jpeg',
                THUMBNAIL_QUALITY
            );
        };

        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Failed to load image'));
        };

        img.src = url;
    });
}

/**
 * Upload a file to R2 storage (internal helper)
 */
async function uploadFile(journeyId: string, file: File | Blob, token: string, filename?: string): Promise<UploadResult> {
    const formData = new FormData();
    if (file instanceof File) {
        formData.append('file', file);
    } else {
        formData.append('file', file, filename || 'thumbnail.jpg');
    }

    const response = await fetch(`${MEDIA_BASE_URL}/upload/journeys/${journeyId}/photos`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
        },
        body: formData,
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Upload failed' }));
        throw new Error(error.error || 'Upload failed');
    }

    return response.json();
}

/**
 * Upload a photo to R2 storage with automatic thumbnail generation
 * @param journeyId - The journey UUID to upload to
 * @param file - The file to upload
 * @param generateThumbnail - Whether to generate and upload a thumbnail (default: true)
 * @returns Upload result with photo ID, path, and optional thumbnail path
 */
export async function uploadPhoto(
    journeyId: string,
    file: File,
    generateThumbnail = true
): Promise<UploadResult & { thumbnailPath?: string }> {
    const token = await getAccessToken();

    if (!token) {
        throw new Error('Authentication required');
    }

    // Upload original photo
    const result = await uploadFile(journeyId, file, token);

    // Generate and upload thumbnail if requested
    if (generateThumbnail) {
        try {
            const thumbnailBlob = await createThumbnail(file);
            const thumbnailResult = await uploadFile(
                journeyId,
                thumbnailBlob,
                token,
                `${result.photoId}_thumb.jpg`
            );
            return {
                ...result,
                thumbnailPath: thumbnailResult.path,
            };
        } catch (err) {
            console.warn('Failed to generate thumbnail, continuing without:', err);
            // Continue without thumbnail if generation fails
        }
    }

    return result;
}

/**
 * Delete a photo and its thumbnail from R2 storage
 * @param journeyId - The journey UUID
 * @param photoId - The photo UUID (without extension)
 * @returns true if successful
 */
export async function deletePhotoFiles(journeyId: string, photoId: string): Promise<boolean> {
    const token = await getAccessToken();

    if (!token) {
        throw new Error('Authentication required');
    }

    const response = await fetch(`${MEDIA_BASE_URL}/journeys/${journeyId}/photos/${photoId}`, {
        method: 'DELETE',
        headers: {
            'Authorization': `Bearer ${token}`,
        },
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Delete failed' }));
        throw new Error(error.error || 'Failed to delete photo files');
    }

    return true;
}
