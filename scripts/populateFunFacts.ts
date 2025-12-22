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

interface FunFact {
    id: string;
    content: string;
    category: string;
    source?: string;
    learn_more_url?: string;
}

interface PointOfInterest {
    id: string;
    name: string;
    category: string;
    coordinates: [number, number];
    elevation?: number;
    description?: string;
    tips?: string[];
}

interface HistoricalSite {
    id: string;
    name: string;
    coordinates: [number, number];
    summary: string;
    description?: string;
    period?: string;
    significance?: 'major' | 'minor' | 'notable';
    tags?: string[];
    links?: Array<{ label: string; url: string }>;
}

interface WaypointData {
    funFacts?: FunFact[];
    pointsOfInterest?: PointOfInterest[];
    historicalSites?: HistoricalSite[];
}

// Fun facts organized by journey slug and waypoint name
// Using waypoint name as key allows multiple waypoints per day
const FUN_FACTS_DATA: Record<string, Record<string, WaypointData>> = {
    // ============================================
    // KILIMANJARO - LEMOSHO ROUTE (7 days)
    // ============================================
    'kilimanjaro': {
        'Mti Mkubwa (Big Tree Camp)': {
            funFacts: [
                {
                    id: 'kili-1-1',
                    content: 'Kilimanjaro is the tallest free-standing mountain in the world, rising 5,895 meters from the surrounding plains without being part of a mountain range.',
                    category: 'geology',
                    source: 'National Geographic',
                },
                {
                    id: 'kili-1-2',
                    content: 'The Lemosho Route passes through 5 distinct climate zones - from tropical rainforest to arctic summit. Today you hiked through the rainforest zone!',
                    category: 'climate',
                },
                {
                    id: 'kili-1-3',
                    content: 'Blue monkeys and black-and-white colobus monkeys are commonly spotted in this rainforest zone. The colobus has no thumb - unique among primates!',
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
        'Shira II Camp': {
            funFacts: [
                {
                    id: 'kili-2-1',
                    content: 'The giant heather plants in this zone can grow up to 10 meters tall - much larger than their European cousins which only reach about 60cm.',
                    category: 'flora',
                },
                {
                    id: 'kili-2-2',
                    content: 'Kilimanjaro generates its own weather. Moisture from the Indian Ocean hits the mountain and creates a unique microclimate with afternoon clouds.',
                    category: 'climate',
                    source: 'Kilimanjaro Research Program',
                },
                {
                    id: 'kili-2-3',
                    content: 'The Shira Plateau is the remains of an ancient volcano that collapsed around 500,000 years ago. It was once as tall as Kibo peak is today!',
                    category: 'geology',
                },
            ],
            pointsOfInterest: [
                {
                    id: 'kili-poi-2-1',
                    name: 'Shira Plateau Viewpoint',
                    category: 'viewpoint',
                    coordinates: [37.2456, -3.0678],
                    elevation: 3500,
                    description: 'Panoramic views of the Shira Plateau, one of Kilimanjaro\'s three volcanic cones that collapsed 500,000 years ago.',
                },
            ],
        },
        'Barranco Camp': {
            funFacts: [
                {
                    id: 'kili-3-1',
                    content: 'Today\'s route followed the "climb high, sleep low" strategy - you went up to Lava Tower (4,630m) then descended to camp at 3,987m for better acclimatization.',
                    category: 'survival',
                },
                {
                    id: 'kili-3-2',
                    content: 'At this altitude, water boils at about 87°C instead of 100°C, which is why camp cooking takes longer!',
                    category: 'science',
                },
                {
                    id: 'kili-3-3',
                    content: '"Pole pole" (slowly slowly) is the Swahili mantra for climbing Kilimanjaro. A slow pace helps your body acclimatize to the thin air.',
                    category: 'survival',
                },
            ],
            pointsOfInterest: [
                {
                    id: 'kili-poi-3-1',
                    name: 'Lava Tower',
                    category: 'landmark',
                    coordinates: [37.3156, -3.0823],
                    elevation: 4630,
                    description: 'A 300-foot volcanic plug formed when lava hardened inside a volcanic vent over 100,000 years ago. Technical climbers sometimes scale its face.',
                    tips: ['Great acclimatization stop', 'Take a hot drink at the tower base'],
                },
            ],
        },
        'Karanga Camp': {
            funFacts: [
                {
                    id: 'kili-4-1',
                    content: 'The Barranco Wall you climbed this morning, though intimidating, has a success rate of over 95%. It\'s a scramble, not a technical climb!',
                    category: 'adventure',
                },
                {
                    id: 'kili-4-2',
                    content: 'Giant Senecios (groundsels) found here are prehistoric plants that have evolved to survive freezing nights and intense UV radiation at high altitude.',
                    category: 'flora',
                    source: 'Botanical Journal of Tanzania',
                },
                {
                    id: 'kili-4-3',
                    content: 'Karanga means "little food" in Swahili - this was historically the last water point before the summit push.',
                    category: 'culture',
                },
            ],
            pointsOfInterest: [
                {
                    id: 'kili-poi-4-1',
                    name: 'Barranco Wall',
                    category: 'landmark',
                    coordinates: [37.3389, -3.0912],
                    elevation: 3950,
                    description: 'The famous "Breakfast Wall" - a 257m rock scramble that\'s the highlight of many climbers\' journeys.',
                    tips: ['Follow your guide\'s exact path', 'Keep three points of contact', 'Don\'t look down!'],
                },
            ],
        },
        'Barafu Camp (Base Camp)': {
            funFacts: [
                {
                    id: 'kili-5-1',
                    content: 'The glaciers on Kilimanjaro have shrunk by 85% since 1912. Scientists estimate they could disappear entirely by 2040.',
                    category: 'climate',
                    source: 'Ohio State University Research',
                    learn_more_url: 'https://news.osu.edu/kilimanjaro-ice-study/',
                },
                {
                    id: 'kili-5-2',
                    content: 'You\'re now in the alpine desert zone at 4,655m. Despite looking barren, specialized lichens and insects survive here.',
                    category: 'flora',
                },
                {
                    id: 'kili-5-3',
                    content: '"Barafu" means "ice" in Swahili - a reminder of the glaciers that once extended much lower on the mountain.',
                    category: 'culture',
                },
            ],
        },
        'Uhuru Peak (Summit)': {
            funFacts: [
                {
                    id: 'kili-6-1',
                    content: 'Uhuru Peak means "Freedom Peak" in Swahili. It was renamed in 1961 when Tanzania gained independence from British rule.',
                    category: 'history',
                },
                {
                    id: 'kili-6-2',
                    content: 'At the summit, there\'s about 50% less oxygen than at sea level. Your body is working twice as hard just to breathe!',
                    category: 'science',
                },
                {
                    id: 'kili-6-3',
                    content: 'The oldest person to summit Kilimanjaro was Anne Lorimor at age 89 in 2019!',
                    category: 'adventure',
                    source: 'Guinness World Records',
                },
            ],
            historicalSites: [
                {
                    id: 'kili-hist-6-1',
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
                    id: 'kili-poi-6-1',
                    name: 'Stella Point',
                    category: 'summit',
                    coordinates: [37.3512, -3.0789],
                    elevation: 5756,
                    description: 'The crater rim point where most climbers reach at sunrise. Just 1 more hour to Uhuru!',
                },
                {
                    id: 'kili-poi-6-2',
                    name: 'Furtwängler Glacier',
                    category: 'landmark',
                    coordinates: [37.3534, -3.0756],
                    elevation: 5800,
                    description: 'One of the last remaining glaciers near the summit, named after German climber Walter Furtwängler who summited in 1912.',
                },
            ],
        },
        'Mweka Camp': {
            funFacts: [
                {
                    id: 'kili-6-4',
                    content: 'The descent from summit to Mweka Camp covers over 2,800m of elevation loss - more than the height of the Swiss Alps from base to peak!',
                    category: 'adventure',
                },
                {
                    id: 'kili-6-5',
                    content: 'Your porters carry up to 20kg each and make this journey multiple times per month. Many are from the local Chagga tribe.',
                    category: 'culture',
                },
            ],
        },
        'Mweka Gate (Finish)': {
            funFacts: [
                {
                    id: 'kili-7-1',
                    content: 'You\'ll receive an official summit certificate at the gate - green for reaching Stella Point (5,756m), gold for Uhuru Peak (5,895m).',
                    category: 'adventure',
                },
                {
                    id: 'kili-7-2',
                    content: 'The Chagga people who live on Kilimanjaro\'s slopes have farmed its fertile volcanic soil for over 500 years, growing coffee and bananas.',
                    category: 'culture',
                },
            ],
        },
    },

    // ============================================
    // INCA TRAIL TO MACHU PICCHU (4 days)
    // ============================================
    'inca-trail': {
        'Wayllabamba Camp': {
            funFacts: [
                {
                    id: 'inca-1-1',
                    content: 'Wayllabamba means "grassy plain" in Quechua. Much of the village is built on original Inca foundations - a living museum of indigenous culture.',
                    category: 'culture',
                    source: 'Peru Ministry of Culture',
                },
                {
                    id: 'inca-1-2',
                    content: 'The first archaeological site you passed, Llactapata (Patallacta), has 112 rooms and was burned by Manco Inca in 1536 to discourage Spanish pursuit.',
                    category: 'history',
                },
                {
                    id: 'inca-1-3',
                    content: 'Giant hummingbirds (Patagona gigas), the largest hummingbird species at over 18cm, are commonly seen near Patallacta.',
                    category: 'wildlife',
                },
            ],
            pointsOfInterest: [
                {
                    id: 'inca-poi-1-1',
                    name: 'Llactapata/Patallacta Ruins',
                    category: 'landmark',
                    coordinates: [-72.52, -13.22],
                    elevation: 2750,
                    description: 'First major Inca site with 112 rooms. Served as a control point for agricultural products along the royal Inca road network.',
                },
            ],
            historicalSites: [
                {
                    id: 'inca-hist-1-1',
                    name: 'Patallacta',
                    coordinates: [-72.52, -13.22],
                    summary: 'Agricultural redistribution center with 112 rooms, burned by Manco Inca in 1536.',
                    description: 'This archaeological site comprises rooms built with rustic and carved stones. The agricultural sector measures 600 by 150 meters, divided into 25 levels of terraces.',
                    period: '15th century - 1536',
                    significance: 'notable',
                    tags: ['agriculture', 'Inca', 'terraces'],
                },
            ],
        },
        'Pacaymayo Camp': {
            funFacts: [
                {
                    id: 'inca-2-1',
                    content: 'Dead Woman\'s Pass (Warmiwañusca) at 4,215m is the highest point on the Inca Trail - nearly 1,800m higher than Machu Picchu itself!',
                    category: 'adventure',
                    source: 'National Geographic',
                },
                {
                    id: 'inca-2-2',
                    content: '"Warmiwañusca" combines Quechua words for "woman" (warmi) and "dead" (wañusca). The mountain\'s profile resembles a supine woman when viewed from the valley.',
                    category: 'culture',
                },
                {
                    id: 'inca-2-3',
                    content: 'Polylepis (Queñua) trees with distinctive red peeling bark are the highest-growing trees in the world, surviving above 5,000m in these Andean forests.',
                    category: 'flora',
                },
                {
                    id: 'inca-2-4',
                    content: 'Vizcachas, resembling large rabbits with long tails and related to chinchillas, are commonly seen sunbathing on rocks near the pass.',
                    category: 'wildlife',
                },
            ],
            pointsOfInterest: [
                {
                    id: 'inca-poi-2-1',
                    name: 'Dead Woman\'s Pass (Warmiwañusca)',
                    category: 'summit',
                    coordinates: [-72.52, -13.20],
                    elevation: 4215,
                    description: 'The highest point on the Inca Trail. 1,200m elevation gain from Wayllabamba in a single day.',
                    tips: ['Start early to avoid afternoon weather', 'Take it slow - altitude affects everyone'],
                },
            ],
        },
        'Wiñay Wayna Camp': {
            funFacts: [
                {
                    id: 'inca-3-1',
                    content: 'Day 3 is the most archaeologically rich section - you passed four major Inca sites: Runkurakay, Sayacmarca, Phuyupatamarca, and Wiñay Wayna.',
                    category: 'history',
                },
                {
                    id: 'inca-3-2',
                    content: '"Wiñay Wayna" means "Forever Young" in Quechua, named after an orchid that was used as a military emblem by Inca warriors.',
                    category: 'culture',
                },
                {
                    id: 'inca-3-3',
                    content: 'Phuyupatamarca ("City Above the Clouds") has 5 ceremonial stone baths fed by underground channels that are still flowing today after 500+ years!',
                    category: 'history',
                    source: 'UNESCO',
                },
                {
                    id: 'inca-3-4',
                    content: 'The Cock-of-the-Rock (Rupícola peruviana), Peru\'s vibrant orange national bird, can be spotted on mountain cliffs in this cloud forest zone.',
                    category: 'wildlife',
                },
                {
                    id: 'inca-3-5',
                    content: 'Over 400 orchid species thrive along the Inca Trail, including the endemic "Golden Angel Orchid" (Masdevallia veitchiana).',
                    category: 'flora',
                },
            ],
            pointsOfInterest: [
                {
                    id: 'inca-poi-3-1',
                    name: 'Runkurakay',
                    category: 'landmark',
                    coordinates: [-72.51, -13.19],
                    elevation: 3850,
                    description: 'A tambo (rest station) for chasquis (Inca messengers). Features unusual circular enclosures rare in Inca architecture.',
                },
                {
                    id: 'inca-poi-3-2',
                    name: 'Sayacmarca',
                    category: 'landmark',
                    coordinates: [-72.5169, -13.2281],
                    elevation: 3600,
                    description: '"Inaccessible Town" - accessed by climbing 98 vertical stone steps. Discovered by Hiram Bingham in 1915.',
                },
                {
                    id: 'inca-poi-3-3',
                    name: 'Phuyupatamarca',
                    category: 'landmark',
                    coordinates: [-72.5317, -13.2064],
                    elevation: 3650,
                    description: '"City Above the Clouds" with 5 ceremonial baths fed by underground channels still flowing after 500+ years.',
                },
            ],
            historicalSites: [
                {
                    id: 'inca-hist-3-1',
                    name: 'Wiñay Wayna Ruins',
                    coordinates: [-72.5352, -13.1890],
                    summary: 'Best preserved ruins before Machu Picchu, with dramatic terraces and water fountains for ritual cleansing.',
                    description: 'Built under Emperor Pachacutec in the mid-15th century. Rediscovered by explorer Paul Fejos in 1941. Features agricultural terraces cascading down the hillside.',
                    period: '15th century',
                    significance: 'major',
                    tags: ['terraces', 'fountains', 'Pachacutec'],
                    links: [
                        { label: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Winay_Wayna' },
                    ],
                },
            ],
        },
        'Machu Picchu (Sun Gate)': {
            funFacts: [
                {
                    id: 'inca-4-1',
                    content: 'Intipunku (Sun Gate) was the main checkpoint for pilgrims entering Machu Picchu. It\'s aligned to frame the sunrise on the winter solstice (June 21).',
                    category: 'history',
                    source: 'UNESCO World Heritage',
                },
                {
                    id: 'inca-4-2',
                    content: 'The Inca Trail is part of the Qhapaq Ñan, a 40,000 km road network spanning 6 countries - declared UNESCO World Heritage in 2014.',
                    category: 'history',
                    source: 'UNESCO',
                    learn_more_url: 'https://whc.unesco.org/en/list/1459',
                },
                {
                    id: 'inca-4-3',
                    content: 'Chasquis (Inca messengers) could relay a message 240km in a single day using relay stations (tambos) like the ones you passed on the trail.',
                    category: 'history',
                },
                {
                    id: 'inca-4-4',
                    content: 'The spectacled bear (Tremarctos ornatus), South America\'s only bear species, inhabits the surrounding cloud forest. Called "ukuku" in Quechua.',
                    category: 'wildlife',
                },
            ],
            pointsOfInterest: [
                {
                    id: 'inca-poi-4-1',
                    name: 'Intipunku (Sun Gate)',
                    category: 'viewpoint',
                    coordinates: [-72.538, -13.159],
                    elevation: 2745,
                    description: 'The iconic first view of Machu Picchu. Aligned for the winter solstice sunrise on June 21.',
                    tips: ['Arrive early for the classic misty view', 'Best photos in early morning light'],
                },
            ],
            historicalSites: [
                {
                    id: 'inca-hist-4-1',
                    name: 'Machu Picchu',
                    coordinates: [-72.5450, -13.1631],
                    summary: 'UNESCO World Heritage Site - the "Lost City of the Incas" built by Emperor Pachacutec around 1450.',
                    description: 'One of the New Seven Wonders of the World. The citadel was never found by Spanish conquistadors and remained unknown to the outside world until Hiram Bingham\'s expedition in 1911.',
                    period: '1450 - 1572',
                    significance: 'major',
                    tags: ['UNESCO', 'Wonder of the World', 'Pachacutec'],
                    links: [
                        { label: 'UNESCO', url: 'https://whc.unesco.org/en/list/274' },
                        { label: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Machu_Picchu' },
                    ],
                },
            ],
        },
    },

    // ============================================
    // MOUNT KENYA - CHOGORIA/SIRIMON (5 days)
    // ============================================
    'mount-kenya': {
        'Special Camp': {
            funFacts: [
                {
                    id: 'kenya-1-1',
                    content: 'Mount Kenya is an extinct stratovolcano that formed 2.6-3.1 million years ago. At its peak, it may have exceeded 7,000m - taller than Kilimanjaro today!',
                    category: 'geology',
                    source: 'UNESCO World Heritage',
                },
                {
                    id: 'kenya-1-2',
                    content: 'Mount Kenya is called "Kirinyaga" (Mountain of Whiteness) by the Kikuyu people. It\'s considered the home of Ngai, the creator God.',
                    category: 'culture',
                },
                {
                    id: 'kenya-1-3',
                    content: 'The bamboo zone you passed through features Oldeania alpina bamboo growing up to 15 meters tall. Natural pathways are kept open by elephants and buffalo!',
                    category: 'flora',
                },
            ],
            pointsOfInterest: [
                {
                    id: 'kenya-poi-1-1',
                    name: 'Chogoria Gate',
                    category: 'info',
                    coordinates: [37.52, -0.17],
                    elevation: 2950,
                    description: 'The scenic eastern entrance to Mount Kenya National Park on the Chogoria route.',
                },
            ],
        },
        'Lake Ellis Camp': {
            funFacts: [
                {
                    id: 'kenya-2-1',
                    content: 'Mount Kenya has 12 remnant glaciers, all receding rapidly. The Lewis Glacier has lost 90% of its volume since 1934 and may disappear by 2030.',
                    category: 'climate',
                    source: 'UNEP',
                },
                {
                    id: 'kenya-2-2',
                    content: 'The Mount Kenya hyrax (rock hyrax) is common here. Despite looking like a rodent, it\'s actually more closely related to elephants and manatees!',
                    category: 'wildlife',
                },
                {
                    id: 'kenya-2-3',
                    content: 'The lower alpine zone features high tussock-grass moorland with waist-high Festuca pilgeri grasses adapted to extreme temperature swings.',
                    category: 'flora',
                },
            ],
            pointsOfInterest: [
                {
                    id: 'kenya-poi-2-1',
                    name: 'Lake Ellis',
                    category: 'landmark',
                    coordinates: [37.38, -0.12],
                    elevation: 3466,
                    description: 'A beautiful alpine lake marking the transition into the afroalpine zone. Critical acclimatization stop on the Chogoria route.',
                },
            ],
        },
        'Lake Michaelson Camp': {
            funFacts: [
                {
                    id: 'kenya-3-1',
                    content: 'Lake Michaelson sits in the dramatic Gorges Valley surrounded by 200-300m vertical cliffs. It was named by Halford Mackinder during the first ascent in 1899.',
                    category: 'geology',
                },
                {
                    id: 'kenya-3-2',
                    content: 'Giant groundsels (Dendrosenecio keniodendron) can reach 10 meters tall here - prehistoric plants adapted to freezing nights and intense UV radiation.',
                    category: 'flora',
                },
                {
                    id: 'kenya-3-3',
                    content: 'Vivienne Falls, visible from the valley, is Kenya\'s tallest waterfall at 457m (1,500 ft) - the 5th tallest in Africa!',
                    category: 'geology',
                },
                {
                    id: 'kenya-3-4',
                    content: 'The scarlet-tufted malachite sunbird, endemic to East African alpine zones, feeds almost exclusively on Lobelia telekii nectar at this elevation.',
                    category: 'wildlife',
                },
            ],
            pointsOfInterest: [
                {
                    id: 'kenya-poi-3-1',
                    name: 'Lake Michaelson',
                    category: 'landmark',
                    coordinates: [37.32, -0.13],
                    elevation: 3961,
                    description: 'A stunning 30-acre lake feeding the Nithi River, surrounded by towering cliffs and considered the most beautiful spot on Mount Kenya.',
                },
                {
                    id: 'kenya-poi-3-2',
                    name: 'Gorges Valley',
                    category: 'viewpoint',
                    coordinates: [37.31, -0.14],
                    elevation: 4000,
                    description: 'Dramatic U-shaped glacial valley with 300m vertical cliffs, including "The Temple" buttress.',
                },
                {
                    id: 'kenya-poi-3-3',
                    name: 'Vivienne Falls',
                    category: 'landmark',
                    coordinates: [37.30, -0.12],
                    elevation: 3984,
                    description: 'Kenya\'s tallest waterfall at 457m. Named after British adventurer Vivienne de Watteville who explored Mount Kenya in 1928-29.',
                },
            ],
        },
        'Sirimon Gate (Finish)': {
            funFacts: [
                {
                    id: 'kenya-4-1',
                    content: 'In 1899, Halford Mackinder led a caravan of 176 people to make the first successful ascent of Mount Kenya\'s Batian peak with Italian guides César Ollier and Joseph Brocherel.',
                    category: 'history',
                },
                {
                    id: 'kenya-4-2',
                    content: 'Mount Kenya\'s three highest peaks are named after Maasai laibons (spiritual leaders): Batian (5,199m), Nelion (5,188m), and Point Lenana (4,985m).',
                    category: 'history',
                },
                {
                    id: 'kenya-4-3',
                    content: 'Mount Kenya was designated a UNESCO Biosphere Reserve in 1978 and World Heritage Site in 1997, recognizing its outstanding natural value.',
                    category: 'history',
                    source: 'UNESCO',
                },
            ],
            historicalSites: [
                {
                    id: 'kenya-hist-4-1',
                    name: 'Mount Kenya National Park',
                    coordinates: [37.35, -0.15],
                    summary: 'UNESCO World Heritage Site established in 1949, protecting Africa\'s second-highest mountain and its unique ecosystems.',
                    description: 'The park covers 715 square kilometers and hosts an estimated 5,000 plant and animal species. The afroalpine vegetation is among the rarest ecosystems on the African continent.',
                    period: '1949 - Present',
                    significance: 'major',
                    tags: ['UNESCO', 'biodiversity', 'conservation'],
                    links: [
                        { label: 'UNESCO', url: 'https://whc.unesco.org/en/list/800/' },
                    ],
                },
            ],
        },
        'Safari: Saruni Basecamp': {
            funFacts: [
                {
                    id: 'kenya-5-1',
                    content: 'The Laikipia/Samburu region offers the "Samburu Special Five" - species unique to northern Kenya: Grevy\'s zebra, reticulated giraffe, Beisa oryx, Somali ostrich, and the elegant gerenuk.',
                    category: 'wildlife',
                },
                {
                    id: 'kenya-5-2',
                    content: 'Mount Kenya serves as a critical water tower for millions of Kenyans. As glaciers recede, rivers are becoming less predictable - elders report snow coverage that was extensive in the 1960s is now almost gone.',
                    category: 'climate',
                    source: 'UNEP',
                },
                {
                    id: 'kenya-5-3',
                    content: 'Saruni community conservancies maintain higher wildlife densities than many national parks while providing income directly to local Samburu landowners.',
                    category: 'culture',
                },
            ],
        },
    },
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

        // Look up by waypoint name instead of day number
        const waypointData = journeyData[waypoint.name];

        if (!waypointData) {
            console.log(`⏭️  ${journey.name} Day ${waypoint.day_number}: ${waypoint.name} (no data configured)`);
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

        if (waypointData.funFacts && !hasFunFacts) {
            updateData.fun_facts = waypointData.funFacts;
            console.log(`   💡 Adding ${waypointData.funFacts.length} fun facts`);
        }

        if (waypointData.pointsOfInterest && !hasPOIs) {
            updateData.points_of_interest = waypointData.pointsOfInterest;
            console.log(`   📍 Adding ${waypointData.pointsOfInterest.length} points of interest`);
        }

        if (waypointData.historicalSites && !hasHistoricalSites) {
            updateData.historical_sites = waypointData.historicalSites;
            console.log(`   🏛️ Adding ${waypointData.historicalSites.length} historical sites`);
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
