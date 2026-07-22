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

// camelCase, as Swift's Codable writes it into the waypointsJSON asset.
const WAYPOINTS_JSON = [
    {
        id: 'camp-1',
        name: 'Big Tree Camp',
        dayNumber: 1,
        sortOrder: 0,
        coordinates: [37.0, -3.0],
        elevation: 2780,
        routePointIndex: 0,
        weather: { temperatureMax: 13.2, temperatureMin: 4.1 },
        funFacts: [{ id: 'f1', content: 'Giant heather grows here', category: 'nature', learnMoreUrl: 'https://x' }],
    },
    {
        // no id — must fall back to `${slug}-day-${dayNumber}`
        name: 'Shira Camp',
        dayNumber: 2,
        sortOrder: 1,
        coordinates: [37.1, -3.1],
        elevation: 3500,
        routePointIndex: 1,
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

function makePublicDb(recordsByType: Record<string, unknown[]>) {
    return {
        performQuery: vi.fn(async (query: CloudKitJS.Query) => ({
            records: recordsByType[query.recordType] ?? [],
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

        it('populates the shared journeyCache the whole app reads', async () => {
            stubAssetFetch();
            await fetchPublicJourneys();
            const cache = getJourneyCacheState();
            expect(cache.loaded).toBe(true);
            expect(cache.trekDataMap.kilimanjaro).toBeDefined();
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
