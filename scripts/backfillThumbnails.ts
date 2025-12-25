#!/usr/bin/env npx tsx
/**
 * Backfill Thumbnails Script
 *
 * Generates thumbnails for photos that are missing them.
 * Downloads each photo from R2, creates a thumbnail, uploads it, and updates the DB.
 *
 * Usage:
 *   SUPABASE_SERVICE_KEY="..." npx tsx scripts/backfillThumbnails.ts <journey-slug>
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
const TEMP_DIR = path.join(os.tmpdir(), 'akashic-thumbnail-backfill');

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
 * Download a file from R2 using wrangler CLI
 */
function downloadFromR2(r2Path: string, localPath: string): boolean {
  try {
    const cmd = `npx wrangler r2 object get "${R2_BUCKET}/${r2Path}" --file="${localPath}" --remote`;
    execSync(cmd, { stdio: 'pipe', cwd: '/Users/christopherhaerem/Privat/Akashic' });
    return true;
  } catch (error) {
    console.error(`  Failed to download from R2: ${error}`);
    return false;
  }
}

/**
 * Upload a file to R2 using wrangler CLI
 */
function uploadToR2(localPath: string, r2Path: string): boolean {
  try {
    const cmd = `npx wrangler r2 object put "${R2_BUCKET}/${r2Path}" --file="${localPath}" --content-type="image/jpeg" --remote`;
    execSync(cmd, { stdio: 'pipe', cwd: '/Users/christopherhaerem/Privat/Akashic' });
    return true;
  } catch (error) {
    console.error(`  Failed to upload to R2: ${error}`);
    return false;
  }
}

/**
 * Create a thumbnail using Sharp
 */
async function createThumbnail(inputPath: string, outputPath: string): Promise<boolean> {
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
  } catch (error) {
    console.error(`  Failed to create thumbnail: ${error}`);
    return false;
  }
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.log('Usage: SUPABASE_SERVICE_KEY="..." npx tsx scripts/backfillThumbnails.ts <journey-slug>');
    console.log('');
    console.log('Example:');
    console.log('  export SUPABASE_SERVICE_KEY="eyJ..."');
    console.log('  npx tsx scripts/backfillThumbnails.ts mount-kenya');
    process.exit(1);
  }

  if (!SUPABASE_SERVICE_KEY) {
    console.error('Error: SUPABASE_SERVICE_KEY environment variable is required');
    process.exit(1);
  }

  const journeySlug = args[0];

  // Get journey ID
  console.log(`\n📍 Looking up journey: ${journeySlug}`);
  const journeyId = await getJourneyId(journeySlug);
  if (!journeyId) {
    console.error(`Error: Journey not found: ${journeySlug}`);
    process.exit(1);
  }
  console.log(`   Found journey ID: ${journeyId}`);

  // Get photos without thumbnails
  console.log('\n🔍 Finding photos without thumbnails...');
  const { data: photos, error } = await supabase
    .from('photos')
    .select('id, url, thumbnail_url')
    .eq('journey_id', journeyId)
    .is('thumbnail_url', null)
    .order('sort_order', { ascending: true });

  if (error) {
    console.error('Error fetching photos:', error.message);
    process.exit(1);
  }

  if (!photos || photos.length === 0) {
    console.log('   All photos have thumbnails!');
    process.exit(0);
  }

  console.log(`   Found ${photos.length} photos without thumbnails`);

  // Create temp directory
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }

  // Process each photo
  let success = 0;
  let failed = 0;

  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i];
    const photoId = photo.id;
    const photoUrl = photo.url;

    // Derive thumbnail path
    const ext = path.extname(photoUrl);
    const baseName = path.basename(photoUrl, ext);
    const thumbR2Path = photoUrl.replace(baseName + ext, `${baseName}_thumb.jpg`);

    process.stdout.write(`\r  [${i + 1}/${photos.length}] Processing ${photoId.substring(0, 8)}...`);

    // Download original photo
    const localPhotoPath = path.join(TEMP_DIR, `${photoId}${ext}`);
    const localThumbPath = path.join(TEMP_DIR, `${photoId}_thumb.jpg`);

    if (!downloadFromR2(photoUrl, localPhotoPath)) {
      console.log(`\n  ⚠️  Failed to download ${photoId}`);
      failed++;
      continue;
    }

    // Create thumbnail
    const thumbCreated = await createThumbnail(localPhotoPath, localThumbPath);
    if (!thumbCreated) {
      console.log(`\n  ⚠️  Failed to create thumbnail for ${photoId}`);
      failed++;
      // Clean up
      try { fs.unlinkSync(localPhotoPath); } catch { /* ignore */ }
      continue;
    }

    // Upload thumbnail
    if (!uploadToR2(localThumbPath, thumbR2Path)) {
      console.log(`\n  ⚠️  Failed to upload thumbnail for ${photoId}`);
      failed++;
      // Clean up
      try { fs.unlinkSync(localPhotoPath); } catch { /* ignore */ }
      try { fs.unlinkSync(localThumbPath); } catch { /* ignore */ }
      continue;
    }

    // Update DB record
    const { error: updateError } = await supabase
      .from('photos')
      .update({ thumbnail_url: thumbR2Path })
      .eq('id', photoId);

    if (updateError) {
      console.log(`\n  ⚠️  Failed to update DB for ${photoId}: ${updateError.message}`);
      failed++;
    } else {
      success++;
    }

    // Clean up temp files
    try { fs.unlinkSync(localPhotoPath); } catch { /* ignore */ }
    try { fs.unlinkSync(localThumbPath); } catch { /* ignore */ }
  }

  // Clean up temp directory
  try {
    fs.rmSync(TEMP_DIR, { recursive: true });
  } catch { /* ignore */ }

  console.log(`\n\n✅ Thumbnail backfill complete!`);
  console.log(`   Success: ${success}`);
  console.log(`   Failed: ${failed}`);
}

main().catch(console.error);
