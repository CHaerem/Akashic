#!/usr/bin/env npx tsx
/**
 * Bulk Photo Upload Script - Direct R2 + Supabase
 *
 * Uploads photos directly to R2 (bypassing the worker auth) and creates DB records.
 *
 * Usage:
 *   SUPABASE_SERVICE_KEY="..." npx tsx scripts/bulkUploadR2.ts <folder> <journey-slug>
 *
 * Prerequisites:
 *   - wrangler configured with R2 access
 *   - SUPABASE_SERVICE_KEY environment variable
 */

import { createClient } from '@supabase/supabase-js';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Configuration
const SUPABASE_URL = 'https://pbqvnxeldpgvcrdbxcvr.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const R2_BUCKET = 'akashic-media';
const THUMBNAIL_MAX_SIZE = 400;
const THUMBNAIL_QUALITY = 80;
const TEMP_DIR = path.join(os.tmpdir(), 'akashic-bulk-upload');
const TRACKING_FILE = path.join(path.dirname(new URL(import.meta.url).pathname), '.upload-tracking.json');

// Load/save tracking file for uploaded filenames
function loadTrackingFile(): Record<string, string[]> {
  try {
    if (fs.existsSync(TRACKING_FILE)) {
      return JSON.parse(fs.readFileSync(TRACKING_FILE, 'utf-8'));
    }
  } catch { /* ignore */ }
  return {};
}

function saveTrackingFile(journeyId: string, files: string[]): void {
  // Re-read file before saving to avoid race conditions with parallel uploads
  const current = loadTrackingFile();
  current[journeyId] = files;
  fs.writeFileSync(TRACKING_FILE, JSON.stringify(current, null, 2));
}

// Supported media extensions
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.heic', '.heif', '.webp'];
const VIDEO_EXTENSIONS = ['.mov', '.mp4', '.m4v', '.webm'];
const MEDIA_EXTENSIONS = [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS];

// Initialize Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

/**
 * Get journey ID by slug
 */
async function getJourneyId(slug: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('journeys')
    .select('id')
    .eq('slug', slug)
    .single();

  if (error) {
    console.error('Error fetching journey:', error.message);
    return null;
  }

  return data?.id || null;
}

/**
 * Upload a file to R2 using wrangler CLI
 */
function uploadToR2(localPath: string, r2Path: string): boolean {
  try {
    // Use wrangler r2 object put with --remote to upload to actual R2 (not local)
    const cmd = `npx wrangler r2 object put "${R2_BUCKET}/${r2Path}" --file="${localPath}" --content-type="${getContentType(localPath)}" --remote`;
    execSync(cmd, { stdio: 'pipe', cwd: '/Users/christopherhaerem/Privat/Akashic' });
    return true;
  } catch (error) {
    console.error(`  Failed to upload to R2: ${error}`);
    return false;
  }
}

/**
 * Get content type from file extension
 */
function getContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const types: Record<string, string> = {
    // Images
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.heic': 'image/heic',
    '.heif': 'image/heif',
    '.webp': 'image/webp',
    // Videos
    '.mov': 'video/quicktime',
    '.mp4': 'video/mp4',
    '.m4v': 'video/x-m4v',
    '.webm': 'video/webm',
  };
  return types[ext] || 'application/octet-stream';
}

/**
 * Check if file is a video
 */
function isVideoFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return VIDEO_EXTENSIONS.includes(ext);
}

/**
 * Check if file needs conversion (non-mp4 video)
 */
function needsConversion(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ['.mov', '.m4v', '.webm'].includes(ext);
}

/**
 * Convert video to mp4 for cross-browser compatibility
 * Uses H.264 codec which works in all browsers
 */
function convertToMp4(inputPath: string, outputPath: string): boolean {
  try {
    // H.264 with AAC audio, compatible with all browsers
    // -movflags +faststart: Optimize for web streaming
    const cmd = `ffmpeg -y -i "${inputPath}" -c:v libx264 -c:a aac -preset fast -crf 23 -movflags +faststart "${outputPath}"`;
    execSync(cmd, { stdio: 'pipe' });
    return true;
  } catch (error) {
    console.error(`  Failed to convert video: ${error}`);
    return false;
  }
}

/**
 * Generate a UUID
 */
function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Create a thumbnail using sharp (for images)
 */
async function createImageThumbnail(inputPath: string, outputPath: string): Promise<boolean> {
  try {
    const sharp = (await import('sharp')).default;
    await sharp(inputPath)
      .resize(THUMBNAIL_MAX_SIZE, THUMBNAIL_MAX_SIZE, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: THUMBNAIL_QUALITY })
      .toFile(outputPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a thumbnail from video using ffmpeg (extracts frame at 1 second or 10%)
 */
function createVideoThumbnail(inputPath: string, outputPath: string): boolean {
  try {
    // First get video duration to pick a good frame
    const durationCmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${inputPath}"`;
    let duration = 1;
    try {
      const durationStr = execSync(durationCmd, { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf-8' }).trim();
      duration = parseFloat(durationStr) || 1;
    } catch {
      // Default to 1 second if we can't get duration
    }

    // Extract frame at 10% of video or 1 second, whichever is smaller
    const seekTime = Math.min(duration * 0.1, 1);

    // ffmpeg command to extract a frame and resize
    const cmd = `ffmpeg -y -ss ${seekTime} -i "${inputPath}" -vframes 1 -vf "scale=${THUMBNAIL_MAX_SIZE}:${THUMBNAIL_MAX_SIZE}:force_original_aspect_ratio=decrease" -q:v 2 "${outputPath}"`;
    execSync(cmd, { stdio: 'pipe' });
    return true;
  } catch (error) {
    console.error(`  Failed to create video thumbnail: ${error}`);
    return false;
  }
}

/**
 * Get video duration in seconds using ffprobe
 */
function getVideoDuration(filePath: string): number | null {
  try {
    const cmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`;
    const durationStr = execSync(cmd, { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf-8' }).trim();
    const duration = parseFloat(durationStr);
    return isNaN(duration) ? null : Math.round(duration);
  } catch {
    return null;
  }
}

/**
 * Create thumbnail (routes to image or video handler)
 */
async function createThumbnail(inputPath: string, outputPath: string): Promise<boolean> {
  if (isVideoFile(inputPath)) {
    return createVideoThumbnail(inputPath, outputPath);
  } else {
    return createImageThumbnail(inputPath, outputPath);
  }
}

/**
 * Extract basic EXIF data using exiftool if available, otherwise skip
 * Uses -n flag for numeric (decimal) GPS output
 */
function extractExif(filePath: string): { coordinates?: [number, number]; takenAt?: string } {
  try {
    const result = execSync(
      `exiftool -json -n -GPSLatitude -GPSLongitude -DateTimeOriginal "${filePath}"`,
      { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf-8' }
    );
    const data = JSON.parse(result)[0];

    let coordinates: [number, number] | undefined;
    if (data.GPSLatitude !== undefined && data.GPSLongitude !== undefined) {
      // With -n flag, values are already decimal numbers with correct sign
      coordinates = [data.GPSLongitude, data.GPSLatitude];
    }

    let takenAt: string | undefined;
    if (data.DateTimeOriginal) {
      // Format: "2017:09:29 20:48:45" -> ISO
      const normalized = data.DateTimeOriginal.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
      takenAt = new Date(normalized).toISOString();
    }

    return { coordinates, takenAt };
  } catch {
    return {};
  }
}

/**
 * Main upload function
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log('Usage: SUPABASE_SERVICE_KEY="..." npx tsx scripts/bulkUploadR2.ts <folder> <journey-slug>');
    console.log('');
    console.log('Example:');
    console.log('  export SUPABASE_SERVICE_KEY="eyJ..."');
    console.log('  npx tsx scripts/bulkUploadR2.ts ~/Desktop/akashic-photo-exports/inca-trail inca-trail');
    process.exit(1);
  }

  if (!SUPABASE_SERVICE_KEY) {
    console.error('Error: SUPABASE_SERVICE_KEY environment variable is required');
    process.exit(1);
  }

  const [folderPath, journeySlug] = args;
  const resolvedPath = path.resolve(folderPath.replace(/^~/, process.env.HOME || ''));

  // Validate folder
  if (!fs.existsSync(resolvedPath)) {
    console.error(`Error: Folder not found: ${resolvedPath}`);
    process.exit(1);
  }

  // Get journey ID
  console.log(`\n📍 Looking up journey: ${journeySlug}`);
  const journeyId = await getJourneyId(journeySlug);
  if (!journeyId) {
    console.error(`Error: Journey not found: ${journeySlug}`);
    process.exit(1);
  }
  console.log(`   Found journey ID: ${journeyId}`);

  // Get list of media files (photos and videos)
  const files = fs.readdirSync(resolvedPath)
    .filter(f => MEDIA_EXTENSIONS.includes(path.extname(f).toLowerCase()))
    .sort();

  const imageCount = files.filter(f => IMAGE_EXTENSIONS.includes(path.extname(f).toLowerCase())).length;
  const videoCount = files.filter(f => VIDEO_EXTENSIONS.includes(path.extname(f).toLowerCase())).length;

  console.log(`\n📸 Found ${files.length} media files to upload`);
  console.log(`   Images: ${imageCount}, Videos: ${videoCount}`);
  console.log(`   Destination: R2 bucket "${R2_BUCKET}"`);
  console.log('');

  // Load tracking file to check which files have already been uploaded
  const tracking = loadTrackingFile();
  const uploadedFiles = new Set(tracking[journeyId] || []);
  console.log(`   Already uploaded (tracked): ${uploadedFiles.size}`);

  // Create temp directory for thumbnails
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }

  // Upload photos
  let uploaded = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const filePath = path.join(resolvedPath, file);

    // Check if already uploaded (by filename)
    if (uploadedFiles.has(file)) {
      skipped++;
      continue;
    }

    // Determine if this is a video
    const isVideo = isVideoFile(filePath);
    const mediaType = isVideo ? 'video' : 'image';

    // Extract EXIF for metadata (works for images, some metadata for videos)
    const exif = extractExif(filePath);

    // Get video duration if applicable
    const duration = isVideo ? getVideoDuration(filePath) : null;

    const photoId = uuid();

    // Determine final extension (convert non-mp4 videos to mp4)
    let ext = path.extname(file).toLowerCase();
    if (ext === '.jpeg') ext = '.jpg';
    const shouldConvert = isVideo && needsConversion(filePath);
    if (shouldConvert) ext = '.mp4'; // Will be converted to mp4

    const r2Path = `journeys/${journeyId}/photos/${photoId}${ext}`;
    const thumbR2Path = `journeys/${journeyId}/photos/${photoId}_thumb.jpg`;

    const mediaIcon = isVideo ? '🎬' : '📷';
    const convertLabel = shouldConvert ? ' (→mp4)' : '';
    process.stdout.write(`\r  [${i + 1}/${files.length}] ${mediaIcon} Uploading ${file.substring(0, 32).padEnd(32)}${convertLabel}...`);

    // For videos that need conversion, convert first then upload
    let uploadPath = filePath;
    let tempMp4Path: string | null = null;

    if (shouldConvert) {
      tempMp4Path = path.join(TEMP_DIR, `${photoId}.mp4`);
      if (!convertToMp4(filePath, tempMp4Path)) {
        console.log(`\n  ⚠️  Video conversion failed for ${file}`);
        failed++;
        continue;
      }
      uploadPath = tempMp4Path;
    }

    // Upload original (or converted) to R2
    const success = uploadToR2(uploadPath, r2Path);

    // Clean up converted file if it was temporary
    if (tempMp4Path && fs.existsSync(tempMp4Path)) {
      try { fs.unlinkSync(tempMp4Path); } catch { /* ignore */ }
    }

    if (success) {
      // Create and upload thumbnail
      let thumbnailUrl: string | null = null;
      const thumbLocalPath = path.join(TEMP_DIR, `${photoId}_thumb.jpg`);

      try {
        const thumbCreated = await createThumbnail(filePath, thumbLocalPath);
        if (thumbCreated) {
          const thumbUploaded = uploadToR2(thumbLocalPath, thumbR2Path);
          if (thumbUploaded) {
            thumbnailUrl = thumbR2Path;
          }
        }
      } catch {
        // Continue without thumbnail if creation fails
      } finally {
        // Clean up temp file
        try {
          if (fs.existsSync(thumbLocalPath)) fs.unlinkSync(thumbLocalPath);
        } catch { /* ignore */ }
      }

      // Insert DB record
      const { error: dbError } = await supabase.from('photos').insert({
        id: photoId,
        journey_id: journeyId,
        url: r2Path,
        thumbnail_url: thumbnailUrl,
        coordinates: exif.coordinates ? { type: 'Point', coordinates: exif.coordinates } : null,
        taken_at: exif.takenAt,
        sort_order: i,
        media_type: mediaType,
        duration: duration,
      });

      if (dbError) {
        console.log(`\n  ⚠️  DB insert failed for ${file}: ${dbError.message}`);
        failed++;
      } else {
        uploaded++;
        // Track uploaded file to prevent re-uploads on subsequent runs
        uploadedFiles.add(file);
        saveTrackingFile(journeyId, Array.from(uploadedFiles));
      }
    } else {
      failed++;
    }
  }

  // Clean up temp directory
  try {
    fs.rmSync(TEMP_DIR, { recursive: true });
  } catch { /* ignore */ }

  console.log(`\n\n✅ Upload complete!`);
  console.log(`   Uploaded: ${uploaded}`);
  console.log(`   Skipped (already exists): ${skipped}`);
  console.log(`   Failed: ${failed}`);
}

main().catch(console.error);
