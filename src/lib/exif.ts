/**
 * EXIF metadata extraction utilities
 * Extracts GPS coordinates and date taken from photos
 */

import exifr from 'exifr';

export interface PhotoMetadata {
    /** GPS coordinates as [longitude, latitude] */
    coordinates?: [number, number];
    /** Date the photo was taken */
    takenAt?: Date;
    /** Camera make */
    cameraMake?: string;
    /** Camera model */
    cameraModel?: string;
}

/**
 * Extract metadata from an image file
 * Returns coordinates in [lng, lat] format for consistency with GeoJSON
 */
export async function extractPhotoMetadata(file: File): Promise<PhotoMetadata> {
    try {
        const exif = await exifr.parse(file, {
            // Only extract what we need (include GPS ref fields for sign handling)
            pick: ['GPSLatitude', 'GPSLongitude', 'GPSLatitudeRef', 'GPSLongitudeRef', 'DateTimeOriginal', 'Make', 'Model'],
            // Parse GPS coordinates to decimal degrees (applies N/S E/W signs)
            gps: true,
        });

        if (!exif) {
            return {};
        }

        const metadata: PhotoMetadata = {};

        // Extract GPS coordinates (exifr returns { latitude, longitude } when gps: true)
        if (exif.latitude !== undefined && exif.longitude !== undefined) {
            // Store as [lng, lat] for GeoJSON compatibility
            metadata.coordinates = [exif.longitude, exif.latitude];
        }

        // Extract date taken
        if (exif.DateTimeOriginal) {
            metadata.takenAt = new Date(exif.DateTimeOriginal);
        }

        // Extract camera info (for potential future use)
        if (exif.Make) {
            metadata.cameraMake = exif.Make;
        }
        if (exif.Model) {
            metadata.cameraModel = exif.Model;
        }

        return metadata;
    } catch (error) {
        console.warn('Failed to extract EXIF data:', error);
        return {};
    }
}

/**
 * Extract metadata from multiple files
 */
export async function extractMetadataFromFiles(files: File[]): Promise<Map<File, PhotoMetadata>> {
    const results = new Map<File, PhotoMetadata>();

    await Promise.all(
        files.map(async (file) => {
            const metadata = await extractPhotoMetadata(file);
            results.set(file, metadata);
        })
    );

    return results;
}
