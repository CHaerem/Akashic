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

// Configuration
const SUPABASE_URL = 'https://pbqvnxeldpgvcrdbxcvr.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const R2_BUCKET = 'akashic-media';

// Supported image extensions
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.heic', '.heif', '.webp'];

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
    // Use wrangler r2 object put
    const cmd = `npx wrangler r2 object put "${R2_BUCKET}/${r2Path}" --file="${localPath}" --content-type="${getContentType(localPath)}"`;
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
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.heic': 'image/heic',
    '.heif': 'image/heif',
    '.webp': 'image/webp',
  };
  return types[ext] || 'image/jpeg';
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

  // Get list of photos
  const files = fs.readdirSync(resolvedPath)
    .filter(f => IMAGE_EXTENSIONS.includes(path.extname(f).toLowerCase()))
    .sort();

  console.log(`\n📸 Found ${files.length} photos to upload`);
  console.log(`   Destination: R2 bucket "${R2_BUCKET}"`);
  console.log('');

  // Check for existing photos to avoid duplicates
  const { data: existingPhotos } = await supabase
    .from('photos')
    .select('url')
    .eq('journey_id', journeyId);

  const existingUrls = new Set((existingPhotos || []).map(p => p.url));
  console.log(`   Existing photos in DB: ${existingUrls.size}`);

  // Upload photos
  let uploaded = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const filePath = path.join(resolvedPath, file);
    const photoId = uuid();
    const ext = path.extname(file).toLowerCase() === '.jpeg' ? '.jpg' : path.extname(file).toLowerCase();
    const r2Path = `journeys/${journeyId}/photos/${photoId}${ext}`;

    // Check if already uploaded
    if (existingUrls.has(r2Path)) {
      skipped++;
      continue;
    }

    process.stdout.write(`\r  [${i + 1}/${files.length}] Uploading ${file.substring(0, 40).padEnd(40)}...`);

    // Extract EXIF
    const exif = extractExif(filePath);

    // Upload to R2
    const success = uploadToR2(filePath, r2Path);

    if (success) {
      // Insert DB record
      const { error: dbError } = await supabase.from('photos').insert({
        id: photoId,
        journey_id: journeyId,
        url: r2Path,
        coordinates: exif.coordinates ? { type: 'Point', coordinates: exif.coordinates } : null,
        taken_at: exif.takenAt,
        sort_order: i,
      });

      if (dbError) {
        console.log(`\n  ⚠️  DB insert failed for ${file}: ${dbError.message}`);
        failed++;
      } else {
        uploaded++;
      }
    } else {
      failed++;
    }
  }

  console.log(`\n\n✅ Upload complete!`);
  console.log(`   Uploaded: ${uploaded}`);
  console.log(`   Skipped (already exists): ${skipped}`);
  console.log(`   Failed: ${failed}`);
}

main().catch(console.error);
