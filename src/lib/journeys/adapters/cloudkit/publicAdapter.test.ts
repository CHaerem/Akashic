import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The signed-out public showcase (T3.3). These mock the CloudKit bootstrap so no CDN
 * load or network call happens; asset bodies (routeJSON, waypointsJSON) are served by
 * a stubbed global fetch, exactly as the live public DB hands back { downloadURL }
 * descriptors that must be fetched.
 */

const getPublicDatabase = vi.fn();
const getSharedDatabase = vi.fn();
const getPrivateDatabase = vi.fn();
const getCloudKitSession = vi.fn();

vi.mock('../../../cloudkit', () => ({
    getPublicDatabase: () => getPublicDatabase(),
    getSharedDatabase: () => getSharedDatabase(),
    getPrivateDatabase: () => getPrivateDatabase(),
    getCloudKitSession: () => getCloudKitSession(),
}));

import {
    isSignedIn,
    resetAuthCache,
    fetchPublicJourneys,
    fetchPublicPhotos,
} from './publicAdapter';
import { fetchJourneys, getJourneyIdBySlug } from './journeyAdapter';
import { setJourneyCacheState, getJourneyCacheState } from '../../journeyCache';
import type { TrekData, Camp } from '../../../../types/trek';

const ROUTE_URL = 'https://cvws.icloud/route.json';
const WAYPOINTS_URL = 'https://cvws.icloud/waypoints.json';

const ROUTE_JSON = {
    type: 'LineString',
    coordinates: [
        [37.0, -3.0, 1800],
        [37.1, -3.1, 3500],
    ],
};

// camelCase, exactly as Swift's Codable encodes a `Camp` (apple/Akashic/Models/
// Domain.swift) into the waypointsJSON asset — note the day text field is `notes`,
// NOT `description`, and route positioning is `routePointIndex` / `routeDistanceKm`.
const WAYPOINTS_JSON = [
    {
        id: 'camp-1',
        name: 'Big Tree Camp',
        dayNumber: 1,
        elevation: 2780,
        coordinates: [37.0, -3.0],
        notes: 'Camp beneath the giant heather; a river runs alongside.',
        highlights: ['Giant heather', 'River crossing'],
        routePointIndex: 0,
        routeDistanceKm: 6.2,
        weather: { temperatureMax: 13.2, temperatureMin: 4.1 },
        funFacts: [{ id: 'f1', content: 'Giant heather grows here', category: 'nature', learnMoreUrl: 'https://x' }],
    },
    {
        // no id — must fall back to `${slug}-day-${dayNumber}`
        name: 'Shira Camp',
        dayNumber: 2,
        elevation: 3500,
        coordinates: [37.1, -3.1],
        notes: 'Open moorland with the first summit views.',
        highlights: ['Summit views'],
        routePointIndex: 1,
        routeDistanceKm: 11.9,
    },
];

function makePublicJourneyRecord() {
    return {
        recordName: 'kilimanjaro',
        recordType: 'PublicJourney',
        fields: {
            slug: { value: 'kilimanjaro' },
            name: { value: 'Kilimanjaro - Lemosho Route' },
            country: { value: 'Tanzania' },
            summitElevation: { value: 5895 },
            totalDistance: { value: 62 },
            totalDays: { value: 8 },
            dateStarted: { value: 1664496000000, type: 'TIMESTAMP' },
            centerLocation: { value: { latitude: -3.07, longitude: 37.35 } },
            preferredBearing: { value: 45 },
            preferredPitch: { value: 60 },
            statsJSON: { value: JSON.stringify({ duration: 8, totalDistance: 62, totalElevationGain: 4200, highestPoint: { name: 'Uhuru Peak', elevation: 5895 } }) },
            routeJSON: { value: { downloadURL: ROUTE_URL, fileChecksum: 'r1' } },
            waypointsJSON: { value: { downloadURL: WAYPOINTS_URL, fileChecksum: 'w1' } },
            heroThumb: { value: { downloadURL: 'https://cvws.icloud/hero.jpg' } },
        },
    };
}

/**
 * Mock public DB that HONORS `filterBy` for STRING equality — the real container
 * rejects a malformed predicate outright, so a mock that ignored filterBy could not
 * tell a correct journeySlug predicate from a dropped one (a dropped filter would bleed
 * every journey's photos into each grid; a malformed one would return none).
 */
function makePublicDb(recordsByType: Record<string, unknown[]>) {
    type Rec = { fields?: Record<string, { value?: unknown }> };
    type Filter = { fieldName: string; comparator: string; fieldValue: { value?: unknown } };
    const matches = (record: Rec, query: CloudKitJS.Query): boolean =>
        ((query.filterBy ?? []) as Filter[]).every((f) => {
            const actual = record.fields?.[f.fieldName]?.value;
            // Only STRING equality is modelled here (journeySlug); anything else would
            // need a shape this mock does not pretend to support.
            return f.comparator === 'EQUALS' && actual === f.fieldValue.value;
        });
    return {
        performQuery: vi.fn(async (query: CloudKitJS.Query) => ({
            records: (recordsByType[query.recordType] ?? []).filter((r) =>
                matches(r as Rec, query)
            ),
        })),
        fetchRecords: vi.fn(async () => ({ records: [] })),
        saveRecords: vi.fn(async () => ({ records: [] })),
        deleteRecords: vi.fn(async () => ({ records: [] })),
    };
}

function stubAssetFetch() {
    const fetchMock = vi.fn(async (url: string) => {
        if (url === ROUTE_URL) return { ok: true, json: async () => ROUTE_JSON } as unknown as Response;
        if (url === WAYPOINTS_URL) return { ok: true, json: async () => WAYPOINTS_JSON } as unknown as Response;
        throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

describe('publicAdapter — signed-out showcase', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetAuthCache();
        setJourneyCacheState({ treks: [], trekDataMap: {}, loaded: false });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    describe('isSignedIn', () => {
        it('resolves false when there is no session, and caches it', async () => {
            getCloudKitSession.mockResolvedValue({ user: null });

            expect(await isSignedIn()).toBe(false);
            expect(await isSignedIn()).toBe(false);
            // Cached — the session is probed at most once per page load.
            expect(getCloudKitSession).toHaveBeenCalledTimes(1);
        });

        it('resolves true when a user is present', async () => {
            getCloudKitSession.mockResolvedValue({ user: { userRecordName: 'u' } });
            expect(await isSignedIn()).toBe(true);
        });

        it('does not throw if the probe rejects — treats it as signed-out', async () => {
            getCloudKitSession.mockRejectedValue(new Error('offline'));
            expect(await isSignedIn()).toBe(false);
        });
    });

    describe('fetchPublicJourneys', () => {
        beforeEach(() => {
            getCloudKitSession.mockResolvedValue({ user: null });
            getPublicDatabase.mockResolvedValue(
                makePublicDb({ PublicJourney: [makePublicJourneyRecord()] })
            );
        });

        it('maps a PublicJourney (recordName = slug) into treks + trekData', async () => {
            stubAssetFetch();
            const { treks, trekDataMap } = await fetchPublicJourneys();

            expect(treks).toHaveLength(1);
            expect(treks[0].id).toBe('kilimanjaro');
            expect(treks[0].slug).toBe('kilimanjaro');
            expect(treks[0].name).toBe('Kilimanjaro'); // split before " - "

            const data = trekDataMap.kilimanjaro;
            expect(data.uuid).toBe('kilimanjaro'); // no UUID in the mirror: id === slug
            expect(data.dateStarted).toBe('2022-09-30T00:00:00.000Z'); // TIMESTAMP -> ISO
            // statsJSON parsed inline
            expect(data.stats.totalElevationGain).toBe(4200);
        });

        it('resolves the routeJSON + waypointsJSON assets and builds camps', async () => {
            stubAssetFetch();
            const { trekDataMap } = await fetchPublicJourneys();
            const data = trekDataMap.kilimanjaro;

            // route asset fetched
            expect(data.route.coordinates).toEqual(ROUTE_JSON.coordinates);

            // waypoints asset fetched, snake_cased and turned into camps
            expect(data.camps).toHaveLength(2);
            expect(data.camps[0].id).toBe('camp-1');
            expect(data.camps[0].name).toBe('Big Tree Camp');
            // camelCase day content survives (snakeCaseKeys -> transform)
            expect(data.camps[0].weather?.temperatureMax).toBe(13.2);
            expect(data.camps[0].funFacts?.[0]?.learnMoreUrl).toBe('https://x');
            // route present, so per-day distance/elevation are computed (> 0)
            expect(data.camps[1].elevationGainFromPrevious).toBeGreaterThan(0);
        });

        it('falls back to `${slug}-day-N` for a camp with no id', async () => {
            stubAssetFetch();
            const { trekDataMap } = await fetchPublicJourneys();
            expect(trekDataMap.kilimanjaro.camps[1].id).toBe('kilimanjaro-day-2');
        });

        it('maps the Swift Camp `notes` field into camp notes (not the absent `description`)', async () => {
            stubAssetFetch();
            const { trekDataMap } = await fetchPublicJourneys();
            const camps = trekDataMap.kilimanjaro.camps;
            // The showcase used to drop every day's notes because mapWaypoint read
            // `description`, which the Camp payload never carries.
            expect(camps[0].notes).toBe('Camp beneath the giant heather; a river runs alongside.');
            expect(camps[1].notes).toBe('Open moorland with the first summit views.');
            // The rest of the day header/stats/highlights the web UI renders also survive.
            expect(camps[0].highlights).toEqual(['Giant heather', 'River crossing']);
            expect(camps[0].routeDistanceKm).toBe(6.2);
            expect(camps[0].routePointIndex).toBe(0);
        });

        it('populates the shared journeyCache the whole app reads', async () => {
            stubAssetFetch();
            await fetchPublicJourneys();
            const cache = getJourneyCacheState();
            expect(cache.loaded).toBe(true);
            expect(cache.trekDataMap.kilimanjaro).toBeDefined();
        });
    });

    describe('fetchPublicJourneys — deterministic ordering', () => {
        beforeEach(() => {
            getCloudKitSession.mockResolvedValue({ user: null });
        });

        function journeyRecord(slug: string, name: string, dateMs: number, waypointsUrl: string) {
            return {
                recordName: slug,
                recordType: 'PublicJourney',
                fields: {
                    slug: { value: slug },
                    name: { value: name },
                    dateStarted: { value: dateMs, type: 'TIMESTAMP' },
                    waypointsJSON: { value: { downloadURL: waypointsUrl, fileChecksum: slug } },
                },
            };
        }

        it('orders by dateStarted descending, not by which asset resolves first', async () => {
            const INCA_WP = 'https://cvws.icloud/inca-wp.json';
            const KILI_WP = 'https://cvws.icloud/kili-wp.json';
            // Records arrive inca-first (query order); only the sort should reorder them.
            getPublicDatabase.mockResolvedValue(
                makePublicDb({
                    PublicJourney: [
                        journeyRecord('inca-trail', 'Inca Trail', 1_600_000_000_000, INCA_WP), // 2020
                        journeyRecord('kilimanjaro', 'Kilimanjaro', 1_700_000_000_000, KILI_WP), // 2023
                    ],
                })
            );
            // Completion order is the OPPOSITE of the desired order: the earlier-dated
            // journey (inca) resolves immediately, the later-dated one (kili) after a
            // tick. Without a deterministic sort, treks would come back [inca, kili].
            vi.stubGlobal(
                'fetch',
                vi.fn(async (url: string) => {
                    if (url === KILI_WP) await new Promise((r) => setTimeout(r, 5));
                    return { ok: true, json: async () => [] } as unknown as Response;
                })
            );

            const { treks } = await fetchPublicJourneys();
            // Most recent first, regardless of asset-fetch latency — stable across reloads.
            expect(treks.map((t) => t.id)).toEqual(['kilimanjaro', 'inca-trail']);
        });
    });

    describe('fetchPublicPhotos', () => {
        beforeEach(() => {
            getCloudKitSession.mockResolvedValue({ user: null });
            // Seed the cache with camps so dayNumber -> waypoint_id synthesis works.
            const camps = [
                { id: 'camp-1', dayNumber: 1 } as Camp,
                { id: 'camp-2', dayNumber: 2 } as Camp,
            ];
            setJourneyCacheState({
                treks: [],
                trekDataMap: { kilimanjaro: { camps } as unknown as TrekData },
                loaded: true,
            });
        });

        it('maps PublicPhoto rows: thumb -> url/thumbnail, TIMESTAMP + LOCATION, sorted', async () => {
            const photos = [
                {
                    recordName: 'pp-3',
                    fields: { journeySlug: { value: 'kilimanjaro' }, thumb: { value: { downloadURL: 'https://x/3.jpg' } }, sortOrder: { value: 2 } },
                },
                {
                    recordName: 'pp-1',
                    fields: {
                        journeySlug: { value: 'kilimanjaro' },
                        thumb: { value: { downloadURL: 'https://x/1.jpg' } },
                        takenAt: { value: 1664720662000, type: 'TIMESTAMP' },
                        coordinates: { value: { latitude: -3.0, longitude: 37.0 } },
                        dayNumber: { value: 1 },
                        sortOrder: { value: 0 },
                        caption: { value: 'Summit push' },
                    },
                },
                {
                    recordName: 'pp-2',
                    fields: { journeySlug: { value: 'kilimanjaro' }, thumb: { value: { downloadURL: 'https://x/2.jpg' } }, dayNumber: { value: 2 }, sortOrder: { value: 1 } },
                },
            ];
            getPublicDatabase.mockResolvedValue(makePublicDb({ PublicPhoto: photos }));

            const result = await fetchPublicPhotos('kilimanjaro');

            expect(result).toHaveLength(3);
            // sorted by sort_order
            expect(result.map((p) => p.id)).toEqual(['pp-1', 'pp-2', 'pp-3']);

            const first = result[0];
            expect(first.url).toBe('https://x/1.jpg');
            expect(first.thumbnail_url).toBe('https://x/1.jpg');
            expect(first.caption).toBe('Summit push');
            expect(first.taken_at).toBe('2022-10-02T14:24:22.000Z'); // TIMESTAMP -> ISO
            expect(first.coordinates).toEqual([37.0, -3.0]); // LOCATION -> [lng, lat]
        });

        it('filters PublicPhoto by the exact journeySlug STRING predicate (no cross-journey bleed)', async () => {
            // Two journeys' photos share the PublicPhoto table; the query must select
            // only this journey's. A dropped filter would bleed every journey's photos
            // into each grid; a malformed one would return none. The mock DB honors
            // filterBy, so a wrong predicate shape shows up as the wrong rows here.
            const photos = [
                { recordName: 'kili-1', fields: { journeySlug: { value: 'kilimanjaro' }, thumb: { value: { downloadURL: 'https://x/k1.jpg' } }, dayNumber: { value: 1 }, sortOrder: { value: 0 } } },
                { recordName: 'inca-1', fields: { journeySlug: { value: 'inca-trail' }, thumb: { value: { downloadURL: 'https://x/i1.jpg' } }, dayNumber: { value: 1 }, sortOrder: { value: 0 } } },
                { recordName: 'kili-2', fields: { journeySlug: { value: 'kilimanjaro' }, thumb: { value: { downloadURL: 'https://x/k2.jpg' } }, dayNumber: { value: 2 }, sortOrder: { value: 1 } } },
            ];
            const db = makePublicDb({ PublicPhoto: photos });
            getPublicDatabase.mockResolvedValue(db);

            const result = await fetchPublicPhotos('kilimanjaro');

            // Only kilimanjaro's two photos — inca-trail's is excluded by the filter.
            expect(result.map((p) => p.id)).toEqual(['kili-1', 'kili-2']);

            // Pin the predicate's exact shape: a plain STRING equality on journeySlug
            // (not a REFERENCE), which is what the world-readable public field takes.
            const photoCall = db.performQuery.mock.calls.find(
                ([q]) => (q as CloudKitJS.Query).recordType === 'PublicPhoto'
            );
            expect((photoCall?.[0] as CloudKitJS.Query).filterBy).toEqual([
                { fieldName: 'journeySlug', comparator: 'EQUALS', fieldValue: { value: 'kilimanjaro' } },
            ]);
        });

        it('synthesizes waypoint_id from dayNumber via the cached camps', async () => {
            const photos = [
                { recordName: 'pp-1', fields: { journeySlug: { value: 'kilimanjaro' }, thumb: { value: { downloadURL: 'https://x/1.jpg' } }, dayNumber: { value: 1 }, sortOrder: { value: 0 } } },
                { recordName: 'pp-2', fields: { journeySlug: { value: 'kilimanjaro' }, thumb: { value: { downloadURL: 'https://x/2.jpg' } }, dayNumber: { value: 2 }, sortOrder: { value: 1 } } },
                // no dayNumber -> waypoint_id null (falls through to usePhotoDay's coarser tiers)
                { recordName: 'pp-3', fields: { journeySlug: { value: 'kilimanjaro' }, thumb: { value: { downloadURL: 'https://x/3.jpg' } }, sortOrder: { value: 2 } } },
            ];
            getPublicDatabase.mockResolvedValue(makePublicDb({ PublicPhoto: photos }));

            const result = await fetchPublicPhotos('kilimanjaro');
            expect(result[0].waypoint_id).toBe('camp-1');
            expect(result[1].waypoint_id).toBe('camp-2');
            expect(result[2].waypoint_id).toBeNull();
        });
    });

    describe('fetchJourneys falls back to the public mirror when signed out', () => {
        it('routes to the public DB and never touches shared/private', async () => {
            getCloudKitSession.mockResolvedValue({ user: null });
            getPublicDatabase.mockResolvedValue(
                makePublicDb({ PublicJourney: [makePublicJourneyRecord()] })
            );
            stubAssetFetch();

            const { treks } = await fetchJourneys();

            expect(treks).toHaveLength(1);
            expect(treks[0].id).toBe('kilimanjaro');
            expect(getPublicDatabase).toHaveBeenCalled();
            expect(getSharedDatabase).not.toHaveBeenCalled();
            expect(getPrivateDatabase).not.toHaveBeenCalled();
        });

        it('getJourneyIdBySlug returns the slug (the public id) without a private query', async () => {
            getCloudKitSession.mockResolvedValue({ user: null });

            // Component photo-loading resolves slug -> id before fetchPhotos; signed-out
            // the id IS the slug, so this must not touch the private DBs (which return
            // null there and would leave the showcase photoless).
            await expect(getJourneyIdBySlug('kilimanjaro')).resolves.toBe('kilimanjaro');
            expect(getSharedDatabase).not.toHaveBeenCalled();
            expect(getPrivateDatabase).not.toHaveBeenCalled();
        });
    });
});
