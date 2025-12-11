#!/usr/bin/env npx tsx
/**
 * Migration Script: Convert .mov videos to .mp4 for cross-browser compatibility
 *
 * .mov (QuickTime) only works in Safari. This script converts all .mov videos
 * in R2 to .mp4 (H.264) which works in all browsers.
 *
 * Usage:
 *   SUPABASE_SERVICE_KEY="..." npx tsx scripts/migrateMovToMp4.ts [--dry-run]
 *
 * Prerequisites:
 *   - wrangler configured with R2 access
 *   - ffmpeg installed
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
const TEMP_DIR = path.join(os.tmpdir(), 'akashic-mov-migration');
const PROJECT_ROOT = '/Users/christopherhaerem/Privat/Akashic';

// Initialize Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

/**
 * Download a file from R2
 */
function downloadFromR2(r2Path: string, localPath: string): boolean {
  try {
    const cmd = `npx wrangler r2 object get "${R2_BUCKET}/${r2Path}" --file="${localPath}" --remote`;
    execSync(cmd, { stdio: 'pipe', cwd: PROJECT_ROOT });
    return true;
  } catch (error) {
    console.error(`  Failed to download from R2: ${error}`);
    return false;
  }
}

/**
 * Upload a file to R2
 */
function uploadToR2(localPath: string, r2Path: string): boolean {
  try {
    const cmd = `npx wrangler r2 object put "${R2_BUCKET}/${r2Path}" --file="${localPath}" --content-type="video/mp4" --remote`;
    execSync(cmd, { stdio: 'pipe', cwd: PROJECT_ROOT });
    return true;
  } catch (error) {
    console.error(`  Failed to upload to R2: ${error}`);
    return false;
  }
}

/**
 * Delete a file from R2
 */
function deleteFromR2(r2Path: string): boolean {
  try {
    const cmd = `npx wrangler r2 object delete "${R2_BUCKET}/${r2Path}" --remote`;
    execSync(cmd, { stdio: 'pipe', cwd: PROJECT_ROOT });
    return true;
  } catch (error) {
    console.error(`  Failed to delete from R2: ${error}`);
    return false;
  }
}

/**
 * Convert .mov to .mp4 using ffmpeg
 * Uses H.264 codec for maximum browser compatibility
 */
function convertToMp4(inputPath: string, outputPath: string): boolean {
  try {
    // H.264 with AAC audio, compatible with all browsers
    // -movflags +faststart: Optimize for web streaming
    // -c:v libx264: H.264 video codec
    // -c:a aac: AAC audio codec
    // -preset fast: Balance between speed and compression
    // -crf 23: Quality (lower = better, 23 is default)
    const cmd = `ffmpeg -y -i "${inputPath}" -c:v libx264 -c:a aac -preset fast -crf 23 -movflags +faststart "${outputPath}"`;
    execSync(cmd, { stdio: 'pipe' });
    return true;
  } catch (error) {
    console.error(`  Failed to convert video: ${error}`);
    return false;
  }
}

/**
 * Main migration function
 */
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  if (!SUPABASE_SERVICE_KEY) {
    console.error('Error: SUPABASE_SERVICE_KEY environment variable is required');
    process.exit(1);
  }

  console.log('\n🎬 MOV to MP4 Migration Script');
  console.log('================================');
  if (dryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made\n');
  }

  // Fetch all video records with .mov extension
  console.log('📋 Fetching .mov videos from database...');
  const { data: videos, error } = await supabase
    .from('photos')
    .select('id, url, journey_id')
    .eq('media_type', 'video')
    .ilike('url', '%.mov');

  if (error) {
    console.error('Error fetching videos:', error.message);
    process.exit(1);
  }

  if (!videos || videos.length === 0) {
    console.log('✅ No .mov videos found - nothing to migrate!');
    process.exit(0);
  }

  console.log(`   Found ${videos.length} .mov videos to convert\n`);

  if (dryRun) {
    console.log('Videos that would be converted:');
    videos.forEach((v, i) => console.log(`  ${i + 1}. ${v.url}`));
    console.log('\nRun without --dry-run to perform the migration.');
    process.exit(0);
  }

  // Create temp directory
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }

  let converted = 0;
  let failed = 0;

  for (let i = 0; i < videos.length; i++) {
    const video = videos[i];
    const movPath = video.url;
    const mp4Path = movPath.replace(/\.mov$/i, '.mp4');

    console.log(`\n[${i + 1}/${videos.length}] Converting: ${path.basename(movPath)}`);

    const localMovPath = path.join(TEMP_DIR, `${video.id}.mov`);
    const localMp4Path = path.join(TEMP_DIR, `${video.id}.mp4`);

    try {
      // Step 1: Download .mov from R2
      process.stdout.write('  ↓ Downloading...');
      if (!downloadFromR2(movPath, localMovPath)) {
        console.log(' FAILED');
        failed++;
        continue;
      }
      console.log(' OK');

      // Step 2: Convert to .mp4
      process.stdout.write('  ⚙ Converting...');
      if (!convertToMp4(localMovPath, localMp4Path)) {
        console.log(' FAILED');
        failed++;
        continue;
      }
      console.log(' OK');

      // Step 3: Upload .mp4 to R2
      process.stdout.write('  ↑ Uploading...');
      if (!uploadToR2(localMp4Path, mp4Path)) {
        console.log(' FAILED');
        failed++;
        continue;
      }
      console.log(' OK');

      // Step 4: Update database record
      process.stdout.write('  📝 Updating DB...');
      const { error: updateError } = await supabase
        .from('photos')
        .update({ url: mp4Path })
        .eq('id', video.id);

      if (updateError) {
        console.log(` FAILED: ${updateError.message}`);
        failed++;
        continue;
      }
      console.log(' OK');

      // Step 5: Delete old .mov from R2
      process.stdout.write('  🗑 Deleting old .mov...');
      if (deleteFromR2(movPath)) {
        console.log(' OK');
      } else {
        console.log(' WARN (old file may remain)');
      }

      converted++;
    } finally {
      // Clean up temp files
      try {
        if (fs.existsSync(localMovPath)) fs.unlinkSync(localMovPath);
        if (fs.existsSync(localMp4Path)) fs.unlinkSync(localMp4Path);
      } catch { /* ignore */ }
    }
  }

  // Clean up temp directory
  try {
    fs.rmSync(TEMP_DIR, { recursive: true });
  } catch { /* ignore */ }

  console.log('\n================================');
  console.log('✅ Migration complete!');
  console.log(`   Converted: ${converted}`);
  console.log(`   Failed: ${failed}`);
}

main().catch(console.error);
