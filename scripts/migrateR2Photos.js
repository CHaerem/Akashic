/**
 * R2 Photo Migration Script
 *
 * Migrates photos from slug-based paths to UUID-based paths in R2.
 * This is a one-time migration script.
 *
 * Before running:
 * 1. Set environment variables:
 *    - SUPABASE_URL
 *    - SUPABASE_SERVICE_KEY (service role key, not anon key)
 *    - CLOUDFLARE_ACCOUNT_ID
 *    - CLOUDFLARE_R2_ACCESS_KEY_ID
 *    - CLOUDFLARE_R2_SECRET_ACCESS_KEY
 *    - CLOUDFLARE_R2_BUCKET_NAME (e.g., 'akashic-media')
 *
 * 2. npm install @aws-sdk/client-s3 (R2 uses S3-compatible API)
 *
 * Usage:
 *   node scripts/migrateR2Photos.js --dry-run   # Preview changes
 *   node scripts/migrateR2Photos.js             # Execute migration
 */

import { createClient } from '@supabase/supabase-js';
import {
    S3Client,
    CopyObjectCommand,
    DeleteObjectCommand,
    HeadObjectCommand,
} from '@aws-sdk/client-s3';

// Configuration
const DRY_RUN = process.argv.includes('--dry-run');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
const R2_BUCKET = process.env.CLOUDFLARE_R2_BUCKET_NAME || 'akashic-media';

// Validate config
if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
    process.exit(1);
}

if (!CF_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    console.error('Missing Cloudflare R2 credentials');
    process.exit(1);
}

// Initialize clients
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const r2 = new S3Client({
    region: 'auto',
    endpoint: `https://${CF_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
});

async function checkObjectExists(key) {
    try {
        await r2.send(new HeadObjectCommand({
            Bucket: R2_BUCKET,
            Key: key,
        }));
        return true;
    } catch (error) {
        if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
            return false;
        }
        throw error;
    }
}

async function copyObject(sourceKey, destKey) {
    if (DRY_RUN) {
        console.log(`  [DRY RUN] Would copy: ${sourceKey} -> ${destKey}`);
        return true;
    }

    try {
        await r2.send(new CopyObjectCommand({
            Bucket: R2_BUCKET,
            CopySource: `${R2_BUCKET}/${sourceKey}`,
            Key: destKey,
        }));
        console.log(`  Copied: ${sourceKey} -> ${destKey}`);
        return true;
    } catch (error) {
        console.error(`  Error copying ${sourceKey}:`, error.message);
        return false;
    }
}

async function deleteObject(key) {
    if (DRY_RUN) {
        console.log(`  [DRY RUN] Would delete: ${key}`);
        return true;
    }

    try {
        await r2.send(new DeleteObjectCommand({
            Bucket: R2_BUCKET,
            Key: key,
        }));
        console.log(`  Deleted: ${key}`);
        return true;
    } catch (error) {
        console.error(`  Error deleting ${key}:`, error.message);
        return false;
    }
}

async function migratePhotos() {
    console.log('\n=== R2 Photo Migration ===');
    console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : 'LIVE'}`);
    console.log(`Bucket: ${R2_BUCKET}\n`);

    // Fetch all journeys to get slug -> id mapping
    const { data: journeys, error: journeysError } = await supabase
        .from('journeys')
        .select('id, slug');

    if (journeysError) {
        console.error('Error fetching journeys:', journeysError);
        return;
    }

    const slugToId = {};
    journeys.forEach(j => {
        slugToId[j.slug] = j.id;
    });

    console.log(`Found ${journeys.length} journeys\n`);

    // Fetch all photos
    const { data: photos, error: photosError } = await supabase
        .from('photos')
        .select('id, url, journey_id');

    if (photosError) {
        console.error('Error fetching photos:', photosError);
        return;
    }

    console.log(`Found ${photos.length} photos to check\n`);

    let migrated = 0;
    let skipped = 0;
    let failed = 0;

    for (const photo of photos) {
        const oldPath = photo.url;

        // Check if path is slug-based (contains a non-UUID segment)
        // Slug paths: journeys/{slug}/photos/{id}.jpg
        // UUID paths: journeys/{uuid}/photos/{id}.jpg
        const pathMatch = oldPath.match(/^journeys\/([^/]+)\/photos\/(.+)$/);

        if (!pathMatch) {
            console.log(`Skipping (invalid path): ${oldPath}`);
            skipped++;
            continue;
        }

        const [, identifier, filename] = pathMatch;

        // Check if it's already a UUID (36 chars with hyphens)
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);

        if (isUUID) {
            console.log(`Already UUID-based: ${oldPath}`);
            skipped++;
            continue;
        }

        // It's a slug-based path, need to migrate
        const journeyId = slugToId[identifier];
        if (!journeyId) {
            console.log(`Warning: No journey found for slug '${identifier}', skipping ${oldPath}`);
            skipped++;
            continue;
        }

        const newPath = `journeys/${journeyId}/photos/${filename}`;

        console.log(`\nMigrating photo ${photo.id}:`);
        console.log(`  Old: ${oldPath}`);
        console.log(`  New: ${newPath}`);

        // Check if source exists
        const sourceExists = await checkObjectExists(oldPath);
        if (!sourceExists) {
            console.log(`  Source file not found in R2, skipping`);
            skipped++;
            continue;
        }

        // Check if destination already exists
        const destExists = await checkObjectExists(newPath);
        if (destExists) {
            console.log(`  Destination already exists, updating DB only`);
        } else {
            // Copy to new location
            const copied = await copyObject(oldPath, newPath);
            if (!copied) {
                failed++;
                continue;
            }
        }

        // Update database
        if (!DRY_RUN) {
            const { error: updateError } = await supabase
                .from('photos')
                .update({ url: newPath })
                .eq('id', photo.id);

            if (updateError) {
                console.error(`  Error updating DB:`, updateError.message);
                failed++;
                continue;
            }
            console.log(`  Updated DB record`);
        } else {
            console.log(`  [DRY RUN] Would update DB: url = ${newPath}`);
        }

        // Delete old file (only if copy succeeded)
        if (!destExists) {
            await deleteObject(oldPath);
        }

        migrated++;
    }

    // Migrate hero images on journeys
    console.log('\n--- Hero Images ---\n');

    for (const journey of journeys) {
        // Fetch hero_image_url
        const { data: j, error } = await supabase
            .from('journeys')
            .select('hero_image_url')
            .eq('id', journey.id)
            .single();

        if (error || !j?.hero_image_url) continue;

        const oldPath = j.hero_image_url;
        const pathMatch = oldPath.match(/^journeys\/([^/]+)\/(.+)$/);

        if (!pathMatch) continue;

        const [, identifier, rest] = pathMatch;
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);

        if (isUUID) {
            console.log(`Hero already UUID-based: ${oldPath}`);
            continue;
        }

        const newPath = `journeys/${journey.id}/${rest}`;

        console.log(`\nMigrating hero for ${journey.slug}:`);
        console.log(`  Old: ${oldPath}`);
        console.log(`  New: ${newPath}`);

        const sourceExists = await checkObjectExists(oldPath);
        if (!sourceExists) {
            console.log(`  Source not found, skipping`);
            continue;
        }

        const destExists = await checkObjectExists(newPath);
        if (!destExists) {
            const copied = await copyObject(oldPath, newPath);
            if (!copied) continue;
        }

        if (!DRY_RUN) {
            const { error: updateError } = await supabase
                .from('journeys')
                .update({ hero_image_url: newPath })
                .eq('id', journey.id);

            if (updateError) {
                console.error(`  Error updating DB:`, updateError.message);
                continue;
            }
            console.log(`  Updated DB`);
        } else {
            console.log(`  [DRY RUN] Would update DB: hero_image_url = ${newPath}`);
        }

        if (!destExists) {
            await deleteObject(oldPath);
        }
    }

    console.log('\n=== Migration Summary ===');
    console.log(`Migrated: ${migrated}`);
    console.log(`Skipped: ${skipped}`);
    console.log(`Failed: ${failed}`);

    if (DRY_RUN) {
        console.log('\nThis was a dry run. Run without --dry-run to execute.');
    }
}

migratePhotos().catch(console.error);
