/**
 * Migration script: Move trek data from JSON files to Supabase
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE=your_key node scripts/migrateToSupabase.js
 *
 * This script requires the service role key to bypass RLS and insert data.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://pbqvnxeldpgvcrdbxcvr.supabase.co';
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;

if (!SUPABASE_SERVICE_ROLE) {
    console.error('Error: SUPABASE_SERVICE_ROLE environment variable is required');
    console.error('Usage: SUPABASE_SERVICE_ROLE=your_key node scripts/migrateToSupabase.js');
    process.exit(1);
}

// Create admin client with service role key
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
    auth: { persistSession: false }
});

// Trek config from trekConfig.ts
const trekConfigs = [
    {
        id: 'kilimanjaro',
        name: 'Kilimanjaro',
        country: 'Tanzania',
        elevation: '5,895m',
        lat: -3.0674,
        lng: 37.3556,
        preferredBearing: -20,
        preferredPitch: 60
    },
    {
        id: 'mount-kenya',
        name: 'Mount Kenya',
        country: 'Kenya',
        elevation: '5,199m',
        lat: -0.1521,
        lng: 37.3084,
        preferredBearing: -20,
        preferredPitch: 60
    },
    {
        id: 'inca-trail',
        name: 'Inca Trail',
        country: 'Peru',
        elevation: '4,215m',
        lat: -13.1631,
        lng: -72.5450,
        preferredBearing: 45,
        preferredPitch: 60
    }
];

// Load trek JSON data
function loadTrekData(trekId) {
    const filePath = join(__dirname, '..', 'src', 'data', `${trekId.replace('-', '')}.json`);
    try {
        // Handle different file naming conventions
        let data;
        try {
            data = readFileSync(filePath, 'utf-8');
        } catch {
            // Try alternate naming (mountKenya vs mount-kenya)
            const altPath = join(__dirname, '..', 'src', 'data',
                trekId === 'mount-kenya' ? 'mountKenya.json' :
                trekId === 'inca-trail' ? 'incaTrail.json' :
                `${trekId}.json`);
            data = readFileSync(altPath, 'utf-8');
        }
        return JSON.parse(data);
    } catch (err) {
        console.error(`Failed to load trek data for ${trekId}:`, err.message);
        return null;
    }
}

// Get the first user (since sign-ups are disabled, there should only be one)
async function getOwnerUserId() {
    const { data, error } = await supabase.auth.admin.listUsers();

    if (error) {
        console.error('Error listing users:', error.message);
        return null;
    }

    if (!data.users || data.users.length === 0) {
        console.error('No users found. Please sign in at least once before running migration.');
        return null;
    }

    // Return the first user's ID
    console.log(`Found user: ${data.users[0].email}`);
    return data.users[0].id;
}

// Parse elevation string like "5,895m" to integer
function parseElevation(elevStr) {
    if (!elevStr) return null;
    return parseInt(elevStr.replace(/,/g, '').replace('m', ''), 10);
}

// Parse camp date string to ISO date or null
function parseCampDate(dateStr, journeyStartDate) {
    if (!dateStr) return null;

    // Handle "Oct 1", "Sep 29" format
    const monthMatch = dateStr.match(/^(Oct|Sep|Nov|Dec|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug)\s+(\d+)$/i);
    if (monthMatch) {
        const monthMap = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
                          jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
        const month = monthMap[monthMatch[1].toLowerCase()];
        const day = monthMatch[2].padStart(2, '0');
        // Use 2023 as default year (from journey dates)
        const year = journeyStartDate ? journeyStartDate.split('-')[0] : '2023';
        return `${year}-${month}-${day}`;
    }

    // "Day X" format - skip, use day_number instead
    return null;
}

// Migrate a single trek
async function migrateTrek(trekConfig, trekData, userId) {
    console.log(`\nMigrating trek: ${trekConfig.name}`);

    // Insert journey
    const journey = {
        user_id: userId,
        name: trekData.name || trekConfig.name,
        slug: trekData.slug || trekConfig.id,
        description: trekData.description || null,
        country: trekData.country || trekConfig.country,
        journey_type: 'trek',
        summit_elevation: trekData.stats?.highestPoint?.elevation || parseElevation(trekConfig.elevation),
        total_distance: trekData.stats?.totalDistance || null,
        total_days: trekData.stats?.duration || null,
        date_started: trekData.dates?.start || null,
        date_ended: trekData.dates?.end || null,
        hero_image_url: trekData.heroImage || null,
        gpx_url: null, // GPX stored as route in JSON for now
        center_coordinates: [trekConfig.lng, trekConfig.lat],
        default_zoom: 12,
        is_public: true // Make existing treks public
    };

    const { data: journeyData, error: journeyError } = await supabase
        .from('journeys')
        .insert(journey)
        .select()
        .single();

    if (journeyError) {
        console.error(`  Error inserting journey: ${journeyError.message}`);
        return null;
    }

    console.log(`  Journey created: ${journeyData.id}`);

    // Insert waypoints (camps)
    if (trekData.camps && trekData.camps.length > 0) {
        const waypoints = trekData.camps.map((camp, index) => ({
            journey_id: journeyData.id,
            name: camp.name,
            waypoint_type: camp.id === 'uhuru-peak' || camp.id === 'point-lenana' ? 'summit' : 'camp',
            day_number: camp.dayNumber || null,
            coordinates: camp.coordinates, // [lng, lat]
            elevation: camp.elevation || null,
            description: camp.notes || null,
            highlights: camp.highlights || [],
            arrival_time: null,
            departure_time: null,
            date_visited: parseCampDate(camp.date, trekData.dates?.start),
            sort_order: index
        }));

        const { data: waypointData, error: waypointError } = await supabase
            .from('waypoints')
            .insert(waypoints)
            .select();

        if (waypointError) {
            console.error(`  Error inserting waypoints: ${waypointError.message}`);
        } else {
            console.log(`  Created ${waypointData.length} waypoints`);
        }
    }

    return journeyData;
}

// Add waypoints to an existing journey
async function addWaypointsToJourney(journeyId, trekData) {
    console.log(`  Adding waypoints to journey ${journeyId}...`);

    // Check if waypoints already exist
    const { data: existing } = await supabase
        .from('waypoints')
        .select('id')
        .eq('journey_id', journeyId);

    if (existing && existing.length > 0) {
        console.log(`  Journey already has ${existing.length} waypoints, skipping`);
        return;
    }

    if (!trekData.camps || trekData.camps.length === 0) {
        console.log('  No camps to migrate');
        return;
    }

    const waypoints = trekData.camps.map((camp, index) => ({
        journey_id: journeyId,
        name: camp.name,
        waypoint_type: camp.id === 'uhuru-peak' || camp.id === 'point-lenana' ? 'summit' : 'camp',
        day_number: camp.dayNumber || null,
        coordinates: camp.coordinates,
        elevation: camp.elevation || null,
        description: camp.notes || null,
        highlights: camp.highlights || [],
        arrival_time: null,
        departure_time: null,
        date_visited: parseCampDate(camp.date, trekData.dates?.start),
        sort_order: index
    }));

    const { data: waypointData, error: waypointError } = await supabase
        .from('waypoints')
        .insert(waypoints)
        .select();

    if (waypointError) {
        console.error(`  Error inserting waypoints: ${waypointError.message}`);
    } else {
        console.log(`  Created ${waypointData.length} waypoints`);
    }
}

// Update journey with route and stats data
async function updateJourneyRouteData(journeyId, trekConfig, trekData) {
    console.log(`  Updating route and stats...`);

    const updateData = {
        route: trekData.route || null,
        stats: trekData.stats || null,
        preferred_bearing: trekConfig.preferredBearing,
        preferred_pitch: trekConfig.preferredPitch
    };

    const { error } = await supabase
        .from('journeys')
        .update(updateData)
        .eq('id', journeyId);

    if (error) {
        console.error(`  Error updating route: ${error.message}`);
    } else {
        const coordCount = trekData.route?.coordinates?.length || 0;
        console.log(`  Updated route (${coordCount} coordinates) and stats`);
    }
}

// Main migration function
async function migrate() {
    console.log('Starting migration to Supabase...\n');

    // Get owner user ID
    const userId = await getOwnerUserId();
    if (!userId) {
        console.error('Migration aborted: No user found');
        process.exit(1);
    }

    // Check if data already exists
    const { data: existingJourneys } = await supabase
        .from('journeys')
        .select('id, slug, route');

    const existingBySlug = new Map((existingJourneys || []).map(j => [j.slug, { id: j.id, hasRoute: !!j.route }]));

    if (existingJourneys && existingJourneys.length > 0) {
        console.log('Existing journeys in database:');
        existingJourneys.forEach(j => console.log(`  - ${j.slug} (route: ${j.route ? 'yes' : 'no'})`));
        console.log('');
    }

    // Migrate each trek
    for (const config of trekConfigs) {
        const trekData = loadTrekData(config.id);
        if (!trekData) continue;

        if (existingBySlug.has(config.id)) {
            // Journey exists
            const existing = existingBySlug.get(config.id);
            console.log(`\nJourney "${config.name}" exists (${existing.id})`);

            // Add waypoints if missing
            await addWaypointsToJourney(existing.id, trekData);

            // Add route if missing
            if (!existing.hasRoute) {
                await updateJourneyRouteData(existing.id, config, trekData);
            } else {
                console.log(`  Route already exists, skipping`);
            }
        } else {
            // Create new journey
            await migrateTrek(config, trekData, userId);
        }
    }

    console.log('\nMigration complete!');
}

// Run migration
migrate().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
});
