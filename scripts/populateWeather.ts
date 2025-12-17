/**
 * Script to fetch historical weather data from Open-Meteo API
 * and populate the waypoints table in Supabase
 *
 * Usage: SUPABASE_SERVICE_KEY="..." npx tsx scripts/populateWeather.ts
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://pbqvnxeldpgvcrdbxcvr.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_SERVICE_KEY) {
    console.error('❌ SUPABASE_SERVICE_KEY environment variable is required');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

interface WeatherResponse {
    daily: {
        time: string[];
        temperature_2m_max: number[];
        temperature_2m_min: number[];
        precipitation_sum: number[];
        wind_speed_10m_max: number[];
        weather_code: number[];
    };
}

interface WaypointWithJourney {
    id: string;
    name: string;
    day_number: number;
    coordinates: [number, number];
    weather: unknown;
    journeys: {
        date_started: string;
        name: string;
    };
}

/**
 * Fetch historical weather from Open-Meteo API
 */
async function fetchWeather(
    latitude: number,
    longitude: number,
    date: string
): Promise<WeatherResponse['daily'] | null> {
    const url = new URL('https://archive-api.open-meteo.com/v1/archive');
    url.searchParams.set('latitude', latitude.toString());
    url.searchParams.set('longitude', longitude.toString());
    url.searchParams.set('start_date', date);
    url.searchParams.set('end_date', date);
    url.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,weather_code');
    url.searchParams.set('timezone', 'auto');

    try {
        const response = await fetch(url.toString());
        if (!response.ok) {
            console.error(`  ⚠️ API error: ${response.status} ${response.statusText}`);
            return null;
        }
        const data: WeatherResponse = await response.json();
        return data.daily;
    } catch (error) {
        console.error(`  ⚠️ Fetch error:`, error);
        return null;
    }
}

/**
 * Calculate date for a waypoint based on journey start date and day number
 */
function calculateDate(startDate: string, dayNumber: number): string {
    const date = new Date(startDate);
    date.setDate(date.getDate() + dayNumber - 1);
    return date.toISOString().split('T')[0];
}

/**
 * Main function to populate weather data
 */
async function main() {
    console.log('🌤️ Fetching waypoints with journey dates...\n');

    // Fetch all waypoints with their journey's date_started
    const { data: waypoints, error } = await supabase
        .from('waypoints')
        .select(`
            id,
            name,
            day_number,
            coordinates,
            weather,
            journeys!inner (
                date_started,
                name
            )
        `)
        .not('day_number', 'is', null)
        .order('day_number');

    if (error) {
        console.error('❌ Error fetching waypoints:', error);
        process.exit(1);
    }

    if (!waypoints || waypoints.length === 0) {
        console.log('No waypoints found.');
        return;
    }

    console.log(`Found ${waypoints.length} waypoints to process.\n`);

    let updated = 0;
    let skipped = 0;
    let failed = 0;

    for (const waypoint of waypoints as unknown as WaypointWithJourney[]) {
        const journey = waypoint.journeys;

        // Skip if already has weather data
        if (waypoint.weather) {
            console.log(`⏭️  ${journey.name} Day ${waypoint.day_number}: ${waypoint.name} (already has weather)`);
            skipped++;
            continue;
        }

        // Skip if no start date
        if (!journey.date_started) {
            console.log(`⏭️  ${journey.name} Day ${waypoint.day_number}: ${waypoint.name} (no start date)`);
            skipped++;
            continue;
        }

        const [lng, lat] = waypoint.coordinates;
        const date = calculateDate(journey.date_started, waypoint.day_number);

        console.log(`🔄 ${journey.name} Day ${waypoint.day_number}: ${waypoint.name}`);
        console.log(`   📍 ${lat.toFixed(4)}, ${lng.toFixed(4)} on ${date}`);

        // Fetch weather from Open-Meteo
        const weather = await fetchWeather(lat, lng, date);

        if (!weather || weather.time.length === 0) {
            console.log(`   ❌ No weather data available`);
            failed++;
            continue;
        }

        // Prepare weather data for storage
        const weatherData = {
            temperature_max: weather.temperature_2m_max[0],
            temperature_min: weather.temperature_2m_min[0],
            precipitation_sum: weather.precipitation_sum[0],
            wind_speed_max: weather.wind_speed_10m_max[0],
            weather_code: weather.weather_code[0],
            fetched_at: new Date().toISOString(),
        };

        console.log(`   🌡️ ${weatherData.temperature_min}°C - ${weatherData.temperature_max}°C`);
        console.log(`   💨 ${weatherData.wind_speed_max} km/h, 💧 ${weatherData.precipitation_sum} mm`);

        // Update waypoint in database
        const { error: updateError } = await supabase
            .from('waypoints')
            .update({ weather: weatherData })
            .eq('id', waypoint.id);

        if (updateError) {
            console.log(`   ❌ Update failed:`, updateError.message);
            failed++;
        } else {
            console.log(`   ✅ Updated`);
            updated++;
        }

        // Be nice to the API - small delay between requests
        await new Promise(resolve => setTimeout(resolve, 200));
    }

    console.log('\n📊 Summary:');
    console.log(`   ✅ Updated: ${updated}`);
    console.log(`   ⏭️ Skipped: ${skipped}`);
    console.log(`   ❌ Failed: ${failed}`);
}

main().catch(console.error);
