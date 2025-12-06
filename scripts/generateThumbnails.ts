/**
 * Script to generate thumbnails for existing photos that don't have them
 * Uses wrangler for direct R2 access
 *
 * Run with: npx tsx scripts/generateThumbnails.ts
 */

import { createClient } from '@supabase/supabase-js';
import { execSync } from 'child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';

// Configuration
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://pbqvnxeldpgvcrdbnxcvr.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const R2_BUCKET = 'akashic-media';
const THUMBNAIL_MAX_SIZE = 400;
const THUMBNAIL_QUALITY = 80;
const TEMP_DIR = '/tmp/akashic-thumbnails';

if (!SUPABASE_SERVICE_KEY) {
    console.error('Error: SUPABASE_SERVICE_KEY environment variable required');
    console.error('Usage: SUPABASE_SERVICE_KEY=your_key npx tsx scripts/generateThumbnails.ts');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

interface Photo {
    id: string;
    journey_id: string;
    url: string;
    thumbnail_url: string | null;
}

// Ensure temp directory exists
if (!existsSync(TEMP_DIR)) {
    mkdirSync(TEMP_DIR, { recursive: true });
}

/**
 * Download file from R2 using wrangler
 */
function downloadFromR2(path: string, localPath: string): boolean {
    try {
        execSync(
            `npx wrangler r2 object get ${R2_BUCKET}/${path} --file="${localPath}" --remote`,
            { stdio: 'pipe', cwd: process.cwd() }
        );
        return true;
    } catch {
        return false;
    }
}

/**
 * Upload file to R2 using wrangler
 */
function uploadToR2(localPath: string, r2Path: string): boolean {
    try {
        execSync(
            `npx wrangler r2 object put ${R2_BUCKET}/${r2Path} --file="${localPath}" --content-type="image/jpeg" --remote`,
            { stdio: 'pipe', cwd: process.cwd() }
        );
        return true;
    } catch {
        return false;
    }
}

/**
 * Create thumbnail using sharp
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
    } catch {
        return false;
    }
}

async function main() {
    console.log('🖼️  Thumbnail Generation Script (R2 Direct)');
    console.log('============================================\n');

    // Fetch all photos without thumbnails
    const { data: photos, error } = await supabase
        .from('photos')
        .select('id, journey_id, url, thumbnail_url')
        .is('thumbnail_url', null);

    if (error) {
        console.error('Failed to fetch photos:', error.message);
        process.exit(1);
    }

    if (!photos || photos.length === 0) {
        console.log('✅ All photos already have thumbnails!');
        return;
    }

    console.log(`Found ${photos.length} photos without thumbnails\n`);

    let success = 0;
    let failed = 0;

    for (const photo of photos as Photo[]) {
        const shortId = photo.id.slice(0, 8);
        process.stdout.write(`Processing ${shortId}... `);

        const originalPath = join(TEMP_DIR, `${photo.id}_original`);
        const thumbPath = join(TEMP_DIR, `${photo.id}_thumb.jpg`);

        try {
            // Download original from R2
            if (!downloadFromR2(photo.url, originalPath)) {
                throw new Error('Download failed');
            }

            // Create thumbnail
            if (!await createThumbnail(originalPath, thumbPath)) {
                throw new Error('Thumbnail creation failed');
            }

            // Generate thumbnail R2 path
            const thumbR2Path = photo.url.replace(/\.[^.]+$/, '_thumb.jpg');

            // Upload thumbnail to R2
            if (!uploadToR2(thumbPath, thumbR2Path)) {
                throw new Error('Upload failed');
            }

            // Update database
            const { error: updateError } = await supabase
                .from('photos')
                .update({ thumbnail_url: thumbR2Path })
                .eq('id', photo.id);

            if (updateError) {
                throw new Error(`DB update failed: ${updateError.message}`);
            }

            console.log(`✅ ${thumbR2Path}`);
            success++;
        } catch (err) {
            console.log(`❌ ${err instanceof Error ? err.message : 'Unknown error'}`);
            failed++;
        } finally {
            // Cleanup temp files
            try {
                if (existsSync(originalPath)) rmSync(originalPath);
                if (existsSync(thumbPath)) rmSync(thumbPath);
            } catch { /* ignore cleanup errors */ }
        }
    }

    // Cleanup temp directory
    try {
        rmSync(TEMP_DIR, { recursive: true });
    } catch { /* ignore */ }

    console.log('\n============================================');
    console.log(`✅ Success: ${success}`);
    console.log(`❌ Failed: ${failed}`);
}

main().catch(console.error);
