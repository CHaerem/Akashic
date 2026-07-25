/**
 * Media URLs.
 *
 * CloudKit hands back full, pre-authenticated `CKAsset` download URLs, so there is
 * nothing to sign or proxy — the token plumbing this module used to carry (a Supabase
 * JWT appended as `?token=`) went away with Supabase itself (T3.4).
 *
 * The relative-path fallback still resolves against the media Worker, which stays up
 * until the Phase 5 decommission; nothing written since the migration uses it.
 */

// Thumbnail settings
const THUMBNAIL_MAX_SIZE = 400; // Max width/height in pixels
const THUMBNAIL_QUALITY = 0.8; // JPEG quality (0-1)

const MEDIA_BASE_URL = import.meta.env.VITE_MEDIA_URL || 'https://akashic-media.chris-haerem.workers.dev';

/**
 * Resolve a media reference to a loadable URL.
 *
 * An absolute URL — every CloudKit asset — is already complete and passes through
 * untouched. Anything else is treated as a legacy relative object path.
 */
export function buildMediaUrl(path: string): string {
    if (/^https?:\/\//i.test(path)) {
        return path;
    }
    return `${MEDIA_BASE_URL}/${path}`;
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
 * Uses createImageBitmap with imageOrientation to properly handle EXIF rotation
 * @param file - Original image file
 * @param maxSize - Maximum width/height for thumbnail
 * @returns Blob of the resized image as JPEG
 */
export async function createThumbnail(file: File, maxSize = THUMBNAIL_MAX_SIZE): Promise<Blob> {
    // Use createImageBitmap for proper EXIF orientation handling
    // The 'from-image' option ensures EXIF rotation is applied
    const bitmap = await createImageBitmap(file, {
        imageOrientation: 'from-image',
        premultiplyAlpha: 'none',
        colorSpaceConversion: 'default',
    });

    // Calculate new dimensions maintaining aspect ratio
    let width = bitmap.width;
    let height = bitmap.height;

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
        bitmap.close();
        throw new Error('Failed to get canvas context');
    }

    // Use high-quality image smoothing
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    // Convert to blob
    return new Promise((resolve, reject) => {
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
    });
}

/**
 * Upload a photo to R2 storage with automatic thumbnail generation
 * @param journeyId - The journey UUID to upload to
 * @param file - The file to upload
 * @param generateThumbnail - Whether to generate and upload a thumbnail (default: true)
 * @returns Upload result with photo ID, path, and optional thumbnail path
 */
export async function uploadPhoto(
    _journeyId: string,
    _file: File,
    _generateThumbnail = true
): Promise<UploadResult & { thumbnailPath?: string }> {
    throw new Error('[cloudkit] Photo upload is native-only — use the iOS app');
}

/**
 * Delete a photo and its thumbnail from R2 storage
 * @param journeyId - The journey UUID
 * @param photoId - The photo UUID (without extension)
 * @returns true if successful
 */
export async function deletePhotoFiles(_journeyId: string, _photoId: string): Promise<boolean> {
    throw new Error('[cloudkit] Photo deletion is native-only — use the iOS app');
}
