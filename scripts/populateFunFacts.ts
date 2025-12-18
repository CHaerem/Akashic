/**
 * Script to populate fun facts, POIs, and historical sites for journey waypoints
 *
 * Usage: SUPABASE_SERVICE_KEY="..." npx tsx scripts/populateFunFacts.ts
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://pbqvnxeldpgvcrdbxcvr.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_SERVICE_KEY) {
    console.error('❌ SUPABASE_SERVICE_KEY environment variable is required');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Fun facts organized by journey slug and day number
const FUN_FACTS_DATA: Record<string, Record<number, {
    funFacts?: Array<{
        id: string;
        content: string;
        category: string;
        source?: string;
        learn_more_url?: string;
    }>;
    pointsOfInterest?: Array<{
        id: string;
        name: string;
        category: string;
        coordinates: [number, number];
        elevation?: number;
        description?: string;
        tips?: string[];
    }>;
    historicalSites?: Array<{
        id: string;
        name: string;
        coordinates: [number, number];
        summary: string;
        description?: string;
        period?: string;
        significance?: 'major' | 'minor' | 'notable';
        tags?: string[];
        links?: Array<{ label: string; url: string }>;
    }>;
}>> = {
    // Kilimanjaro - Lemosho Route
    'kilimanjaro': {
        1: {
            funFacts: [
                {
                    id: 'kili-1-1',
                    content: 'Kilimanjaro is the tallest free-standing mountain in the world, rising 5,895 meters from the surrounding plains without being part of a mountain range.',
                    category: 'geology',
                    source: 'National Geographic',
                },
                {
                    id: 'kili-1-2',
                    content: 'The Lemosho Route passes through 5 distinct climate zones in just 6 days - from tropical rainforest to arctic summit!',
                    category: 'climate',
                },
                {
                    id: 'kili-1-3',
                    content: 'Blue monkeys and black-and-white colobus monkeys are commonly spotted in this rainforest zone. Listen for their calls!',
                    category: 'wildlife',
                },
            ],
            pointsOfInterest: [
                {
                    id: 'kili-poi-1-1',
                    name: 'Londorossi Gate',
                    category: 'info',
                    coordinates: [37.1089, -3.0175],
                    elevation: 2100,
                    description: 'The official park registration point for the Lemosho Route. Named after a nearby village.',
                    tips: ['Bring your passport for registration', 'Use the restroom facilities here'],
                },
            ],
        },
        2: {
            funFacts: [
                {
                    id: 'kili-2-1',
                    content: 'The giant heather plants in this zone can grow up to 10 meters tall - much larger than their European cousins which only reach about 60cm.',
                    category: 'flora',
                },
                {
                    id: 'kili-2-2',
                    content: 'Kilimanjaro generates its own weather. Moisture from the Indian Ocean hits the mountain and creates a unique microclimate.',
                    category: 'climate',
                    source: 'Kilimanjaro Research Program',
                },
            ],
            pointsOfInterest: [
                {
                    id: 'kili-poi-2-1',
                    name: 'Shira Plateau Viewpoint',
                    category: 'viewpoint',
                    coordinates: [37.2456, -3.0678],
                    elevation: 3500,
                    description: 'Panoramic views of the Shira Plateau, one of Kilimanjaro\'s three volcanic cones.',
                },
            ],
        },
        3: {
            funFacts: [
                {
                    id: 'kili-3-1',
                    content: 'The Shira Plateau is the remains of an ancient volcano that collapsed around 500,000 years ago. It was once as tall as Kibo peak is today.',
                    category: 'geology',
                },
                {
                    id: 'kili-3-2',
                    content: 'At this altitude, water boils at about 87°C instead of 100°C, which is why camp cooking takes longer!',
                    category: 'science',
                },
                {
                    id: 'kili-3-3',
                    content: '"Pole pole" (slowly slowly) is the Swahili mantra for climbing Kilimanjaro. A slow pace helps your body acclimatize.',
                    category: 'survival',
                },
            ],
        },
        4: {
            funFacts: [
                {
                    id: 'kili-4-1',
                    content: 'The Lava Tower is a 300-foot volcanic plug formed when lava hardened inside a volcanic vent. It\'s over 100,000 years old.',
                    category: 'geology',
                },
                {
                    id: 'kili-4-2',
                    content: 'Today\'s route follows the "climb high, sleep low" acclimatization strategy - you\'ll go up to 4,600m then descend to camp at 3,900m.',
                    category: 'survival',
                },
            ],
            pointsOfInterest: [
                {
                    id: 'kili-poi-4-1',
                    name: 'Lava Tower',
                    category: 'landmark',
                    coordinates: [37.3156, -3.0823],
                    elevation: 4630,
                    description: 'An impressive 300-foot volcanic rock formation. Technical climbers sometimes scale its face.',
                    tips: ['Great acclimatization stop', 'Take a hot drink at the tower base'],
                },
            ],
        },
        5: {
            funFacts: [
                {
                    id: 'kili-5-1',
                    content: 'The Barranco Wall, though intimidating, has a summit success rate of over 95%. It\'s a scramble, not a technical climb.',
                    category: 'adventure',
                },
                {
                    id: 'kili-5-2',
                    content: 'Giant Senecios (groundsels) found here are prehistoric plants that have evolved to survive freezing nights and intense UV radiation.',
                    category: 'flora',
                    source: 'Botanical Journal of Tanzania',
                },
            ],
            pointsOfInterest: [
                {
                    id: 'kili-poi-5-1',
                    name: 'Barranco Wall',
                    category: 'landmark',
                    coordinates: [37.3389, -3.0912],
                    elevation: 3950,
                    description: 'The famous "Breakfast Wall" - a 257m rock scramble that\'s the highlight of many climbers\' journeys.',
                    tips: ['Follow your guide\'s exact path', 'Keep three points of contact', 'Don\'t look down!'],
                },
            ],
        },
        6: {
            funFacts: [
                {
                    id: 'kili-6-1',
                    content: 'The glaciers on Kilimanjaro have shrunk by 85% since 1912. Scientists estimate they could disappear entirely by 2040.',
                    category: 'climate',
                    source: 'Ohio State University Research',
                    learn_more_url: 'https://news.osu.edu/kilimanjaro-ice-study/',
                },
                {
                    id: 'kili-6-2',
                    content: 'You\'re now in the alpine desert zone. Despite looking barren, this area hosts specialized plants and animals adapted to extreme conditions.',
                    category: 'flora',
                },
            ],
        },
        7: {
            funFacts: [
                {
                    id: 'kili-7-1',
                    content: 'Uhuru Peak means "Freedom Peak" in Swahili. It was renamed in 1961 when Tanzania gained independence from British rule.',
                    category: 'history',
                },
                {
                    id: 'kili-7-2',
                    content: 'At the summit, there\'s about 50% less oxygen than at sea level. Your body is working twice as hard just to breathe!',
                    category: 'science',
                },
                {
                    id: 'kili-7-3',
                    content: 'The oldest person to summit Kilimanjaro was Anne Lorimor at age 89 in 2019!',
                    category: 'adventure',
                    source: 'Guinness World Records',
                },
            ],
            historicalSites: [
                {
                    id: 'kili-hist-7-1',
                    name: 'Uhuru Peak',
                    coordinates: [37.3556, -3.0758],
                    summary: 'The highest point in Africa at 5,895m. Named for Tanzanian independence in 1961.',
                    description: 'Hans Meyer and Ludwig Purtscheller became the first Europeans to reach this summit on October 6, 1889. The peak was originally called Kaiser Wilhelm Spitze but renamed Uhuru (Freedom) Peak when Tanzania gained independence.',
                    period: '1889 - Present',
                    significance: 'major',
                    tags: ['summit', 'independence', 'first ascent'],
                    links: [
                        { label: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Mount_Kilimanjaro' },
                    ],
                },
            ],
            pointsOfInterest: [
                {
                    id: 'kili-poi-7-1',
                    name: 'Stella Point',
                    category: 'summit',
                    coordinates: [37.3512, -3.0789],
                    elevation: 5756,
                    description: 'The crater rim point where most climbers reach at sunrise. Just 1 more hour to Uhuru!',
                },
                {
                    id: 'kili-poi-7-2',
                    name: 'Furtwängler Glacier',
                    category: 'landmark',
                    coordinates: [37.3534, -3.0756],
                    elevation: 5800,
                    description: 'One of the last remaining glaciers near the summit, named after German climber Walter Furtwängler.',
                },
            ],
        },
        8: {
            funFacts: [
                {
                    id: 'kili-8-1',
                    content: 'The descent from summit to Mweka Gate covers over 3,700m of elevation loss in just one day - be kind to your knees!',
                    category: 'survival',
                },
                {
                    id: 'kili-8-2',
                    content: 'You\'ll receive an official summit certificate at the gate - green for reaching Stella Point (5,756m), gold for Uhuru Peak (5,895m).',
                    category: 'adventure',
                },
            ],
        },
    },
    // Add more journeys here...
};

interface WaypointWithJourney {
    id: string;
    name: string;
    day_number: number;
    fun_facts: unknown;
    points_of_interest: unknown;
    historical_sites: unknown;
    journeys: {
        slug: string;
        name: string;
    };
}

async function main() {
    console.log('💡 Populating fun facts, POIs, and historical sites...\n');

    // Fetch all waypoints with their journey slug
    const { data: waypoints, error } = await supabase
        .from('waypoints')
        .select(`
            id,
            name,
            day_number,
            fun_facts,
            points_of_interest,
            historical_sites,
            journeys!inner (
                slug,
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

    for (const waypoint of waypoints as unknown as WaypointWithJourney[]) {
        const journey = waypoint.journeys;
        const journeyData = FUN_FACTS_DATA[journey.slug];

        if (!journeyData) {
            console.log(`⏭️  ${journey.name}: No data configured for this journey`);
            skipped++;
            continue;
        }

        const dayData = journeyData[waypoint.day_number];

        if (!dayData) {
            console.log(`⏭️  ${journey.name} Day ${waypoint.day_number}: No data for this day`);
            skipped++;
            continue;
        }

        // Check if already has data
        const hasFunFacts = Array.isArray(waypoint.fun_facts) && waypoint.fun_facts.length > 0;
        const hasPOIs = Array.isArray(waypoint.points_of_interest) && waypoint.points_of_interest.length > 0;
        const hasHistoricalSites = Array.isArray(waypoint.historical_sites) && waypoint.historical_sites.length > 0;

        if (hasFunFacts && hasPOIs && hasHistoricalSites) {
            console.log(`⏭️  ${journey.name} Day ${waypoint.day_number}: ${waypoint.name} (already has all data)`);
            skipped++;
            continue;
        }

        console.log(`🔄 ${journey.name} Day ${waypoint.day_number}: ${waypoint.name}`);

        const updateData: Record<string, unknown> = {};

        if (dayData.funFacts && !hasFunFacts) {
            updateData.fun_facts = dayData.funFacts;
            console.log(`   💡 Adding ${dayData.funFacts.length} fun facts`);
        }

        if (dayData.pointsOfInterest && !hasPOIs) {
            updateData.points_of_interest = dayData.pointsOfInterest;
            console.log(`   📍 Adding ${dayData.pointsOfInterest.length} points of interest`);
        }

        if (dayData.historicalSites && !hasHistoricalSites) {
            updateData.historical_sites = dayData.historicalSites;
            console.log(`   🏛️ Adding ${dayData.historicalSites.length} historical sites`);
        }

        if (Object.keys(updateData).length === 0) {
            console.log(`   ⏭️ No new data to add`);
            skipped++;
            continue;
        }

        // Update waypoint in database
        const { error: updateError } = await supabase
            .from('waypoints')
            .update(updateData)
            .eq('id', waypoint.id);

        if (updateError) {
            console.log(`   ❌ Update failed:`, updateError.message);
        } else {
            console.log(`   ✅ Updated`);
            updated++;
        }
    }

    console.log('\n📊 Summary:');
    console.log(`   ✅ Updated: ${updated}`);
    console.log(`   ⏭️ Skipped: ${skipped}`);
}

main().catch(console.error);
