#!/usr/bin/env npx tsx
/**
 * Cleanup Duplicate Photos Script
 *
 * Identifies and removes duplicate photos based on journey_id + taken_at.
 * Keeps the oldest record (first uploaded) and deletes duplicates.
 * Also removes orphaned R2 files.
 *
 * Usage:
 *   SUPABASE_SERVICE_KEY="..." npx tsx scripts/cleanupDuplicates.ts [--dry-run]
 */

import { createClient } from '@supabase/supabase-js';
import { execSync } from 'child_process';

const SUPABASE_URL = 'https://pbqvnxeldpgvcrdbxcvr.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const R2_BUCKET = 'akashic-media';

if (!SUPABASE_SERVICE_KEY) {
  console.error('Error: SUPABASE_SERVICE_KEY environment variable required');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const dryRun = process.argv.includes('--dry-run');

interface Photo {
  id: string;
  journey_id: string;
  taken_at: string | null;
  created_at: string;
  url: string;
  thumbnail_url: string | null;
}

function deleteFromR2(r2Path: string): boolean {
  if (dryRun) {
    console.log(`    [DRY-RUN] Would delete R2: ${r2Path}`);
    return true;
  }
  try {
    execSync(`npx wrangler r2 object delete ${R2_BUCKET}/${r2Path} --remote`, {
      stdio: 'pipe',
      cwd: process.cwd()
    });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  console.log(dryRun ? '🔍 DRY RUN - No changes will be made\n' : '🧹 Cleaning up duplicate photos\n');

  // Fetch all photos
  console.log('Fetching all photos...');
  const { data: photos, error } = await supabase
    .from('photos')
    .select('id, journey_id, taken_at, created_at, url, thumbnail_url')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error fetching photos:', error.message);
    process.exit(1);
  }

  console.log(`Found ${photos?.length || 0} total photos\n`);

  if (!photos || photos.length === 0) {
    console.log('No photos to process');
    return;
  }

  // Group by journey_id + taken_at
  const groups = new Map<string, Photo[]>();
  for (const photo of photos as Photo[]) {
    const key = `${photo.journey_id}|${photo.taken_at || 'null'}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(photo);
  }

  // Find duplicates
  const duplicatesToDelete: Photo[] = [];
  let uniqueCount = 0;

  for (const [key, group] of groups) {
    if (group.length > 1) {
      // Keep the first (oldest by created_at), delete the rest
      const [keep, ...remove] = group;
      duplicatesToDelete.push(...remove);
    }
    uniqueCount++;
  }

  console.log(`📊 Analysis:`);
  console.log(`   Unique photos: ${uniqueCount}`);
  console.log(`   Duplicates to remove: ${duplicatesToDelete.length}`);
  console.log('');

  if (duplicatesToDelete.length === 0) {
    console.log('✅ No duplicates found!');
    return;
  }

  // Delete duplicates
  console.log(`${dryRun ? 'Would delete' : 'Deleting'} ${duplicatesToDelete.length} duplicates...\n`);

  let dbDeleted = 0;
  let r2Deleted = 0;
  let r2Failed = 0;

  for (let i = 0; i < duplicatesToDelete.length; i++) {
    const photo = duplicatesToDelete[i];
    process.stdout.write(`\r  [${i + 1}/${duplicatesToDelete.length}] Processing ${photo.id.substring(0, 8)}...`);

    // Delete from R2 (photo and thumbnail)
    if (photo.url) {
      if (deleteFromR2(photo.url)) {
        r2Deleted++;
      } else {
        r2Failed++;
      }
    }
    if (photo.thumbnail_url) {
      deleteFromR2(photo.thumbnail_url);
    }

    // Delete from database
    if (!dryRun) {
      const { error: deleteError } = await supabase
        .from('photos')
        .delete()
        .eq('id', photo.id);

      if (!deleteError) {
        dbDeleted++;
      }
    } else {
      dbDeleted++;
    }
  }

  console.log('\n');
  console.log(`✅ Cleanup complete!`);
  console.log(`   DB records ${dryRun ? 'would be ' : ''}deleted: ${dbDeleted}`);
  console.log(`   R2 files ${dryRun ? 'would be ' : ''}deleted: ${r2Deleted}`);
  if (r2Failed > 0) {
    console.log(`   R2 deletions failed: ${r2Failed}`);
  }

  // Verify final count
  if (!dryRun) {
    const { count } = await supabase
      .from('photos')
      .select('id', { count: 'exact', head: true });
    console.log(`\n   Final photo count: ${count}`);
  }
}

main().catch(console.error);
