import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The signed-out public showcase (T3.3). These mock the CloudKit bootstrap so no CDN
 * load or network call happens; asset bodies (routeJSON, waypointsJSON) are served by
 * a stubbed global fetch, exactly as the live public DB hands back { downloadURL }
 * descriptors that must be fetched.
 *
 * QUA-40: the records and the asset bodies are no longer local to this file. They come
 * from `src/fixtures/publicShowcase.ts` and `src/fixtures/assets/`, which is also what
 * the E2E fixture container serves — so this suite is the drift detector for the E2E
 * gate. The shape is defined once, and a payload the mappers cannot read goes red here
 * in 5 s instead of in Playwright. Reading the asset bytes off disk (rather than
 * re-declaring them) is what makes that guarantee exact.
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
import {
    buildPublicJourneyRecords,
    buildPublicPhotoRecords,
    PRIMARY_FIXTURE_SLUG,
    SECONDARY_FIXTURE_SLUG,
    FIXTURE_ASSET_FILES,
} from '../../../../fixtures/publicShowcase';
import type { TrekData, Camp } from '../../../../types/trek';

/** Any absolute http origin will do here; only assetUrl's scheme check cares. */
const ORIGIN = 'https://fixture.invalid';
const ASSET_DIR = join(process.cwd(), 'src/fixtures/assets');

/** The exact bytes the Vite dev server hands the browser during an E2E run. */
function readAssetBody(file: string): unknown {
    return JSON.parse(readFileSync(join(ASSET_DIR, file), 'utf8'));
}

const ALPINE_ROUTE = readAssetBody('e2e-alpine-loop.route.json') as {
    coordinates: [number, number, number][];
};

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

/**
 * Serve the fixture asset bodies from disk, keyed on the URL the records actually carry.
 * `delayMs` lets a test stagger completion order, which is what the deterministic-sort
 * test needs.
 */
function stubAssetFetch(delayMs: Record<string, number> = {}) {
    const fetchMock = vi.fn(async (url: string) => {
        const file = FIXTURE_ASSET_FILES.find((f) => url.endsWith(`/${f}`));
        if (!file) throw new Error(`unexpected fetch: ${url}`);
        const wait = delayMs[file];
        if (wait) await new Promise((r) => setTimeout(r, wait));
        return { ok: true, json: async () => readAssetBody(file) } as unknown as Response;
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
                makePublicDb({ PublicJourney: buildPublicJourneyRecords(ORIGIN) })
            );
        });

        it('maps a PublicJourney (recordName = slug) into treks + trekData', async () => {
            stubAssetFetch();
            const { treks, trekDataMap } = await fetchPublicJourneys();

            expect(treks).toHaveLength(2);
            expect(treks[0].id).toBe(PRIMARY_FIXTURE_SLUG);
            expect(treks[0].slug).toBe(PRIMARY_FIXTURE_SLUG);
            expect(treks[0].name).toBe('Alpine Loop'); // split before " - "

            const data = trekDataMap[PRIMARY_FIXTURE_SLUG];
            expect(data.uuid).toBe(PRIMARY_FIXTURE_SLUG); // no UUID in the mirror: id === slug
            expect(data.dateStarted).toBe('2024-07-01T00:00:00.000Z'); // TIMESTAMP -> ISO
            // statsJSON parsed inline
            expect(data.stats.totalElevationGain).toBe(1440);
            // centerLocation is a LOCATION field -> [lng, lat]
            expect([treks[0].lng, treks[0].lat]).toEqual([8.42, 61.672]);
        });

        it('synthesizes stats for a journey with no statsJSON', async () => {
            // The secondary fixture deliberately omits statsJSON, so toTrekData falls back
            // to total_days / total_distance / summit_elevation. Nothing else in the E2E
            // run exercises that branch.
            stubAssetFetch();
            const { trekDataMap } = await fetchPublicJourneys();
            const stats = trekDataMap[SECONDARY_FIXTURE_SLUG].stats;
            expect(stats.duration).toBe(3);
            expect(stats.totalDistance).toBe(8);
            expect(stats.highestPoint.elevation).toBe(520);
        });

        it('resolves the routeJSON + waypointsJSON assets and builds camps', async () => {
            stubAssetFetch();
            const { trekDataMap } = await fetchPublicJourneys();
            const data = trekDataMap[PRIMARY_FIXTURE_SLUG];

            // route asset fetched — the exact bytes served over HTTP in the E2E run
            expect(data.route.coordinates).toEqual(ALPINE_ROUTE.coordinates);

            // waypoints asset fetched, snake_cased and turned into camps
            expect(data.camps).toHaveLength(5);
            expect(data.camps.map((c) => c.dayNumber)).toEqual([1, 2, 3, 4, 5]);
            expect(data.camps[0].id).toBe('alpine-camp-1');
            expect(data.camps[0].name).toBe('Birch Grove Camp');
            // camelCase day content survives (snakeCaseKeys -> transform)
            expect(data.camps[0].weather?.temperatureMax).toBe(13.2);
            expect(data.camps[1].funFacts?.[0]?.learnMoreUrl).toBe(
                'https://example.invalid/moraine'
            );
            // route present, so per-day distance/elevation are computed (> 0)
            expect(data.camps[1].elevationGainFromPrevious).toBeGreaterThan(0);
        });

        it('derives day distance both ways: from route_distance_km, and by Haversine', async () => {
            stubAssetFetch();
            const { trekDataMap } = await fetchPublicJourneys();
            const camps = trekDataMap[PRIMARY_FIXTURE_SLUG].camps;

            // Day 2 has no route_distance_km, so the distance comes from walking the route
            // coordinates between the two camps' indices (MEASURED 8.51 - 3.40 km).
            expect(camps[1].routeDistanceKm).toBeNull();
            expect(camps[1].dayDistance).toBeCloseTo(5.1, 1);
            // Day 4 and day 3 both carry route_distance_km, so the subtraction path runs.
            expect(camps[3].dayDistance).toBeCloseTo(18.7 - 13.6, 1);
            // Day 3 carries no route_point_index, so findClosestRoutePointIndex derived it.
            expect(camps[2].routePointIndex).toBeNull();
            expect(camps[2].elevationGainFromPrevious).toBeGreaterThan(0);
        });

        it('falls back to `${slug}-day-N` for a camp with no id', async () => {
            stubAssetFetch();
            const { trekDataMap } = await fetchPublicJourneys();
            expect(trekDataMap[PRIMARY_FIXTURE_SLUG].camps[2].id).toBe(
                `${PRIMARY_FIXTURE_SLUG}-day-3`
            );
        });

        it('maps the Swift Camp `notes` field into camp notes (not the absent `description`)', async () => {
            stubAssetFetch();
            const { trekDataMap } = await fetchPublicJourneys();
            const camps = trekDataMap[PRIMARY_FIXTURE_SLUG].camps;
            // The showcase used to drop every day's notes because mapWaypoint read
            // `description`, which the Camp payload never carries.
            expect(camps[0].notes).toBe(
                'Camp beneath the birches; a meltwater river runs alongside.'
            );
            expect(camps[1].notes).toBe(
                'Open moraine, with the first clear view of the ridge above.'
            );
            // The rest of the day header/stats/highlights the web UI renders also survive.
            expect(camps[0].highlights).toEqual(['Birch forest', 'River crossing']);
            expect(camps[3].routeDistanceKm).toBe(18.7);
            expect(camps[3].routePointIndex).toBe(11);
        });

        it('populates the shared journeyCache the whole app reads', async () => {
            stubAssetFetch();
            await fetchPublicJourneys();
            const cache = getJourneyCacheState();
            expect(cache.loaded).toBe(true);
            expect(cache.trekDataMap[PRIMARY_FIXTURE_SLUG]).toBeDefined();
        });
    });

    describe('fetchPublicJourneys — deterministic ordering', () => {
        beforeEach(() => {
            getCloudKitSession.mockResolvedValue({ user: null });
        });

        it('orders by dateStarted descending, not by which asset resolves first', async () => {
            // The builder returns records in the OPPOSITE order to the expected sort
            // (coastal first), and the completion order is opposite too: the alpine assets
            // are delayed, so without a deterministic sort treks would come back
            // [coastal, alpine]. Each journey awaits its own asset fetches, so completion
            // order follows latency, not the query — which really did reshuffle the globe's
            // journey order between page loads.
            getPublicDatabase.mockResolvedValue(
                makePublicDb({ PublicJourney: buildPublicJourneyRecords(ORIGIN) })
            );
            stubAssetFetch({
                'e2e-alpine-loop.route.json': 5,
                'e2e-alpine-loop.waypoints.json': 5,
            });

            const { treks } = await fetchPublicJourneys();
            // Most recent first, regardless of asset-fetch latency — stable across reloads.
            expect(treks.map((t) => t.id)).toEqual([PRIMARY_FIXTURE_SLUG, SECONDARY_FIXTURE_SLUG]);
        });
    });

    describe('fetchPublicPhotos', () => {
        beforeEach(() => {
            getCloudKitSession.mockResolvedValue({ user: null });
            // Seed the cache with camps so dayNumber -> waypoint_id synthesis works.
            const camps = [
                { id: 'alpine-camp-1', dayNumber: 1 } as Camp,
                { id: `${PRIMARY_FIXTURE_SLUG}-day-3`, dayNumber: 3 } as Camp,
                { id: 'alpine-camp-5', dayNumber: 5 } as Camp,
            ];
            setJourneyCacheState({
                treks: [],
                trekDataMap: {
                    [PRIMARY_FIXTURE_SLUG]: { camps } as unknown as TrekData,
                },
                loaded: true,
            });
        });

        it('maps PublicPhoto rows: thumb -> url/thumbnail, TIMESTAMP + LOCATION, sorted', async () => {
            const photos = buildPublicPhotoRecords(ORIGIN);
            // Query order is deliberately not sort order.
            getPublicDatabase.mockResolvedValue(
                makePublicDb({ PublicPhoto: [photos[2], photos[0], photos[1]] })
            );

            const result = await fetchPublicPhotos(PRIMARY_FIXTURE_SLUG);

            expect(result).toHaveLength(3);
            // sorted by sort_order
            expect(result.map((p) => p.id)).toEqual([
                `${PRIMARY_FIXTURE_SLUG}-photo-1`,
                `${PRIMARY_FIXTURE_SLUG}-photo-2`,
                `${PRIMARY_FIXTURE_SLUG}-photo-3`,
            ]);

            const first = result[0];
            expect(first.url).toBe(`${ORIGIN}/src/fixtures/assets/thumb.png`);
            expect(first.thumbnail_url).toBe(first.url);
            expect(first.caption).toBe('Fixture photo, day 1');
            expect(first.taken_at).toBe('2024-07-02T00:00:00.000Z'); // TIMESTAMP -> ISO
            expect(first.coordinates).toEqual([8.34, 61.624]); // LOCATION -> [lng, lat]
        });

        it('filters PublicPhoto by the exact journeySlug STRING predicate (no cross-journey bleed)', async () => {
            // Two journeys' photos share the PublicPhoto table; the query must select
            // only this journey's. A dropped filter would bleed every journey's photos
            // into each grid; a malformed one would return none. The mock DB honors
            // filterBy, so a wrong predicate shape shows up as the wrong rows here.
            const otherJourneyPhoto = {
                recordName: 'coastal-1',
                recordType: 'PublicPhoto',
                fields: {
                    journeySlug: { value: SECONDARY_FIXTURE_SLUG },
                    thumb: { value: { downloadURL: 'https://x/c1.jpg' } },
                    dayNumber: { value: 1 },
                    sortOrder: { value: 0 },
                },
            };
            const db = makePublicDb({
                PublicPhoto: [...buildPublicPhotoRecords(ORIGIN), otherJourneyPhoto],
            });
            getPublicDatabase.mockResolvedValue(db);

            const result = await fetchPublicPhotos(PRIMARY_FIXTURE_SLUG);

            // Only the alpine journey's three photos — the coastal one is excluded.
            expect(result.map((p) => p.id)).toEqual([
                `${PRIMARY_FIXTURE_SLUG}-photo-1`,
                `${PRIMARY_FIXTURE_SLUG}-photo-2`,
                `${PRIMARY_FIXTURE_SLUG}-photo-3`,
            ]);

            // Pin the predicate's exact shape: a plain STRING equality on journeySlug
            // (not a REFERENCE), which is what the world-readable public field takes.
            const photoCall = db.performQuery.mock.calls.find(
                ([q]) => (q as CloudKitJS.Query).recordType === 'PublicPhoto'
            );
            expect((photoCall?.[0] as CloudKitJS.Query).filterBy).toEqual([
                {
                    fieldName: 'journeySlug',
                    comparator: 'EQUALS',
                    fieldValue: { value: PRIMARY_FIXTURE_SLUG },
                },
            ]);
        });

        it('synthesizes waypoint_id from dayNumber via the cached camps', async () => {
            // The day-3 camp's own id is derived (`${slug}-day-3`, no id in the payload),
            // so this also proves the two derivations agree.
            const noDayNumber = {
                recordName: 'pp-no-day',
                recordType: 'PublicPhoto',
                fields: {
                    journeySlug: { value: PRIMARY_FIXTURE_SLUG },
                    thumb: { value: { downloadURL: 'https://x/n.jpg' } },
                    sortOrder: { value: 9 },
                },
            };
            getPublicDatabase.mockResolvedValue(
                makePublicDb({ PublicPhoto: [...buildPublicPhotoRecords(ORIGIN), noDayNumber] })
            );

            const result = await fetchPublicPhotos(PRIMARY_FIXTURE_SLUG);
            expect(result[0].waypoint_id).toBe('alpine-camp-1');
            expect(result[1].waypoint_id).toBe(`${PRIMARY_FIXTURE_SLUG}-day-3`);
            expect(result[2].waypoint_id).toBe('alpine-camp-5');
            // no dayNumber -> waypoint_id null (falls through to usePhotoDay's coarser tiers)
            expect(result[3].waypoint_id).toBeNull();
        });
    });

    describe('fetchJourneys falls back to the public mirror when signed out', () => {
        it('routes to the public DB and never touches shared/private', async () => {
            getCloudKitSession.mockResolvedValue({ user: null });
            getPublicDatabase.mockResolvedValue(
                makePublicDb({ PublicJourney: buildPublicJourneyRecords(ORIGIN) })
            );
            stubAssetFetch();

            const { treks } = await fetchJourneys();

            expect(treks).toHaveLength(2);
            expect(treks[0].id).toBe(PRIMARY_FIXTURE_SLUG);
            expect(getPublicDatabase).toHaveBeenCalled();
            expect(getSharedDatabase).not.toHaveBeenCalled();
            expect(getPrivateDatabase).not.toHaveBeenCalled();
        });

        it('getJourneyIdBySlug returns the slug (the public id) without a private query', async () => {
            getCloudKitSession.mockResolvedValue({ user: null });

            // Component photo-loading resolves slug -> id before fetchPhotos; signed-out
            // the id IS the slug, so this must not touch the private DBs (which return
            // null there and would leave the showcase photoless).
            await expect(getJourneyIdBySlug(PRIMARY_FIXTURE_SLUG)).resolves.toBe(
                PRIMARY_FIXTURE_SLUG
            );
            expect(getSharedDatabase).not.toHaveBeenCalled();
            expect(getPrivateDatabase).not.toHaveBeenCalled();
        });
    });
});
