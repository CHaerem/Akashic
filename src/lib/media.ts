/**
 * Media URLs.
 *
 * CloudKit hands back full, pre-authenticated `CKAsset` download URLs, so there is
 * nothing to sign or proxy — the token plumbing this module used to carry (a Supabase
 * JWT appended as `?token=`) went away with Supabase itself (T3.4).
 *
 * There is no relative-path fallback any more (LEG-05). It used to resolve against the
 * media Worker, and it was dead code against the real schema: `apple/CloudKit/schema.ckdb`
 * declares no `url`/`thumbnailUrl` STRING on `Photo` — only `original`/`thumb` ASSETs —
 * and `RecordCoder.swift:349` writes `url: ""` when it drops the old R2 path. So no
 * CloudKit record can carry a relative object path, and nothing since the migration
 * produced one. Removing it retires the last source reference to the Worker host
 * *before* the host is deleted (Phase 5), which is the order that cannot break.
 */

import { refuseNativeOnlyWrite } from './nativeOnly';

// Thumbnail settings
const THUMBNAIL_MAX_SIZE = 400; // Max width/height in pixels
const THUMBNAIL_QUALITY = 0.8; // JPEG quality (0-1)

/**
 * Resolve a media reference to a loadable URL.
 *
 * An absolute URL — every CloudKit asset — is already complete and passes through
 * untouched. Anything else is unresolvable: callers reach here with
 * `photo.thumbnail_url || photo.url`, and the only non-absolute value those can hold is
 * `''` (see `recordToPhoto` in `adapters/cloudkit/records.ts`). Returning `''` keeps that
 * an empty `<img>` instead of a request to a host that is being decommissioned.
 */
export function buildMediaUrl(path: string): string {
    if (/^https?:\/\//i.test(path)) {
        return path;
    }
    if (import.meta.env.DEV && path) {
        console.warn(`[media] not a CloudKit asset URL, cannot resolve: ${path}`);
    }
    return '';
}

/**
 * Upload result with extracted metadata
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
 * Upload a photo. Native-only: there is no web write path (see `lib/nativeOnly.ts`).
 * Throws rather than resolving, so a caller cannot mistake it for a success.
 */
export async function uploadPhoto(
    _journeyId: string,
    _file: File,
    _generateThumbnail = true
): Promise<UploadResult & { thumbnailPath?: string }> {
    refuseNativeOnlyWrite('Photo upload');
}

/**
 * Delete a photo and its thumbnail. Native-only, and throws for the same reason as
 * {@link uploadPhoto}.
 */
export async function deletePhotoFiles(_journeyId: string, _photoId: string): Promise<boolean> {
    refuseNativeOnlyWrite('Photo deletion');
}
