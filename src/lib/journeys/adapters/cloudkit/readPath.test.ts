import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the CloudKit bootstrap wrapper so no network / CDN load happens.
const getSharedDatabase = vi.fn();
const getPrivateDatabase = vi.fn();
const getPublicDatabase = vi.fn();
const getCloudKitSession = vi.fn();

vi.mock('../../../cloudkit', () => ({
    getSharedDatabase: () => getSharedDatabase(),
    getPrivateDatabase: () => getPrivateDatabase(),
    getPublicDatabase: () => getPublicDatabase(),
    getCloudKitSession: () => getCloudKitSession(),
}));

import { fetchJourneys } from './journeyAdapter';
import { fetchPhotos, updatePhoto } from './photoAdapter';
import { rememberJourneyZones, rememberRecordZone, clearJourneyZones } from './journeyZones';

const TEST_ZONE = {
    recordName: 'j-1',
    zoneID: { zoneName: 'journey-j-1', ownerRecordName: '_owner' },
    scope: 'shared' as const,
};
import { getJourneyCacheState } from '../../journeyCache';

function makeDb(handlers: {
    performQuery?: (q: CloudKitJS.Query) => Promise<{ records: unknown[] }>;
    saveRecords?: (r: unknown) => Promise<{ records: unknown[] }>;
}) {
    return {
        performQuery: vi.fn(handlers.performQuery ?? (async () => ({ records: [] }))),
        fetchRecords: vi.fn(async () => ({ records: [] })),
        saveRecords: vi.fn(handlers.saveRecords ?? (async () => ({ records: [] }))),
        deleteRecords: vi.fn(async () => ({ records: [] })),
    };
}

describe('cloudkit read path', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('fetchJourneys', () => {
        it('maps CloudKit records to app types and populates the shared cache', async () => {
            const journeyRecord = {
                recordName: 'uuid-1',
                recordType: 'Journey',
                fields: {
                    slug: { value: 'kilimanjaro' },
                    name: { value: 'Kilimanjaro - Lemosho' },
                    country: { value: 'Tanzania' },
                    summitElevation: { value: 5895 },
                    centerLocation: { value: { latitude: -3.07, longitude: 37.35 } },
                    routeJSON: { value: JSON.stringify({ type: 'LineString', coordinates: [[37, -3, 1800], [37.2, -3.2, 2600]] }) },
                    isPublic: { value: 1 },
                },
            };
            const waypointRecord = {
                recordName: 'wp-1',
                recordType: 'Waypoint',
                fields: {
                    journeyRef: { value: { recordName: 'uuid-1' } },
                    name: { value: 'Base Camp' },
                    dayNumber: { value: 1 },
                    coordinates: { value: [37, -3] },
                    elevation: { value: 1800 },
                    sortOrder: { value: 0 },
                    routePointIndex: { value: 0 },
                },
            };

            const sharedDb = makeDb({
                performQuery: async (q) => {
                    if (q.recordType === 'Journey') return { records: [journeyRecord] };
                    if (q.recordType === 'Waypoint') return { records: [waypointRecord] };
                    return { records: [] };
                },
            });
            const privateDb = makeDb({});

            getSharedDatabase.mockResolvedValue(sharedDb);
            getPrivateDatabase.mockResolvedValue(privateDb);

            const { treks, trekDataMap } = await fetchJourneys();

            expect(treks).toHaveLength(1);
            expect(treks[0].id).toBe('kilimanjaro');
            expect(treks[0].name).toBe('Kilimanjaro'); // split before " - "
            expect(trekDataMap.kilimanjaro.camps).toHaveLength(1);
            expect(trekDataMap.kilimanjaro.camps[0].name).toBe('Base Camp');

            // Shared module-level cache is populated (same cache journeyAPI reads).
            const cache = getJourneyCacheState();
            expect(cache.loaded).toBe(true);
            expect(cache.trekDataMap.kilimanjaro).toBeDefined();
        });

        it('fetches an asset-backed routeJSON so the route survives to toTrekData', async () => {
            // RecordCoder writes routeJSON as a CKAsset (MAPPING §6): CloudKit JS surfaces the
            // field as a { downloadURL } descriptor, NOT the JSON string. Reading it with the
            // synchronous parser alone silently produced route: null for every journey —
            // no globe route line, and zeroed per-day distance/elevation on every camp.
            const routeGeoJSON = {
                type: 'LineString',
                coordinates: [
                    [37, -3, 1800],
                    [37.2, -3.2, 2600],
                ],
            };
            const journeyRecord = {
                recordName: 'uuid-asset',
                recordType: 'Journey',
                fields: {
                    slug: { value: 'kilimanjaro' },
                    name: { value: 'Kilimanjaro' },
                    centerLocation: { value: { latitude: -3.07, longitude: 37.35 } },
                    routeJSON: {
                        value: {
                            downloadURL: 'https://cvws.icloud/route-uuid-asset.json',
                            fileChecksum: 'abc123',
                            size: 1234,
                        },
                    },
                },
            };
            const waypointRecord = {
                recordName: 'wp-1',
                recordType: 'Waypoint',
                fields: {
                    journeyRef: { value: { recordName: 'uuid-asset' } },
                    name: { value: 'Base Camp' },
                    dayNumber: { value: 1 },
                    coordinates: { value: [37.2, -3.2] },
                    elevation: { value: 2600 },
                    sortOrder: { value: 0 },
                    routePointIndex: { value: 1 },
                },
            };

            const fetchMock = vi.fn(async (url: string) => {
                expect(url).toBe('https://cvws.icloud/route-uuid-asset.json');
                return { ok: true, json: async () => routeGeoJSON } as unknown as Response;
            });
            vi.stubGlobal('fetch', fetchMock);

            getSharedDatabase.mockResolvedValue(
                makeDb({
                    performQuery: async (q) => {
                        if (q.recordType === 'Journey') return { records: [journeyRecord] };
                        if (q.recordType === 'Waypoint') return { records: [waypointRecord] };
                        return { records: [] };
                    },
                })
            );
            getPrivateDatabase.mockResolvedValue(makeDb({}));

            const { trekDataMap } = await fetchJourneys();

            expect(fetchMock).toHaveBeenCalledTimes(1);
            expect(trekDataMap.kilimanjaro.route.coordinates).toEqual(routeGeoJSON.coordinates);
            expect(trekDataMap.kilimanjaro.camps[0].elevationGainFromPrevious).toBeGreaterThan(0);
            vi.unstubAllGlobals();
        });

        it('leaves the route null when the asset fetch fails, without throwing', async () => {
            const journeyRecord = {
                recordName: 'uuid-broken',
                recordType: 'Journey',
                fields: {
                    slug: { value: 'inca-trail' },
                    name: { value: 'Inca Trail' },
                    routeJSON: { value: { downloadURL: 'https://cvws.icloud/gone.json' } },
                },
            };
            vi.stubGlobal(
                'fetch',
                vi.fn(async () => {
                    throw new Error('network down');
                })
            );
            getSharedDatabase.mockResolvedValue(
                makeDb({
                    performQuery: async (q) =>
                        q.recordType === 'Journey' ? { records: [journeyRecord] } : { records: [] },
                })
            );
            getPrivateDatabase.mockResolvedValue(makeDb({}));

            const { trekDataMap } = await fetchJourneys();
            expect(trekDataMap['inca-trail'].route.coordinates).toEqual([]);
            vi.unstubAllGlobals();
        });

        it('returns empty data when no journey records exist', async () => {
            getSharedDatabase.mockResolvedValue(makeDb({}));
            getPrivateDatabase.mockResolvedValue(makeDb({}));

            const result = await fetchJourneys();
            expect(result).toEqual({ treks: [], trekDataMap: {} });
        });
    });

    describe('fetchPhotos', () => {
        // Photo reads are scoped to the journey's zone, so the journey has to be
        // known first (see journeyZones — this is what the live container taught us).
        beforeEach(() => {
            clearJourneyZones();
            rememberJourneyZones(
                [{
                    recordName: 'j-1',
                    recordType: 'Journey',
                    zoneID: { zoneName: 'journey-j-1' },
                    fields: { slug: { value: 'j-1' } },
                } as unknown as CloudKitJS.Record],
                'shared'
            );
        });

        it('maps photo records with full asset URLs, sorted by sort_order', async () => {
            const photos = [
                {
                    recordName: 'p-2',
                    fields: {
                        journeyRef: { value: { recordName: 'j-1' } },
                        image: { value: { downloadURL: 'https://cvws.icloud/p2.jpg' } },
                        sortOrder: { value: 2 },
                    },
                },
                {
                    recordName: 'p-1',
                    fields: {
                        journeyRef: { value: { recordName: 'j-1' } },
                        image: { value: { downloadURL: 'https://cvws.icloud/p1.jpg' } },
                        sortOrder: { value: 1 },
                    },
                },
            ];
            getSharedDatabase.mockResolvedValue(makeDb({ performQuery: async () => ({ records: photos }) }));
            getPrivateDatabase.mockResolvedValue(makeDb({}));

            const result = await fetchPhotos('j-1');

            expect(result).toHaveLength(2);
            expect(result[0].id).toBe('p-1'); // sort_order 1 before 2
            expect(result[0].url).toBe('https://cvws.icloud/p1.jpg');
        });
    });

    describe('updatePhoto (caption light edit)', () => {
        // A write needs the record's zone and database, which reads record on the way
        // past — a photo that was never loaded cannot be edited.
        beforeEach(() => {
            clearJourneyZones();
            rememberRecordZone(
                [{ recordName: 'photo-1' } as unknown as CloudKitJS.Record],
                TEST_ZONE
            );
        });

        it('saves the caption into the photo zone and returns the mapped photo', async () => {
            const saved = {
                recordName: 'photo-1',
                fields: {
                    journeyRef: { value: { recordName: 'j-1' } },
                    caption: { value: 'New caption' },
                    image: { value: { downloadURL: 'https://cvws.icloud/x.jpg' } },
                },
            };
            const sharedDb = makeDb({ saveRecords: async () => ({ records: [saved] }) });
            getSharedDatabase.mockResolvedValue(sharedDb);

            const result = await updatePhoto('photo-1', { caption: 'New caption' });

            // The zone goes in the options argument; on the record it is ignored.
            expect(sharedDb.saveRecords).toHaveBeenCalledWith(expect.any(Array), {
                zoneID: TEST_ZONE.zoneID,
            });
            expect(result?.id).toBe('photo-1');
            expect(result?.caption).toBe('New caption');
        });
    });
});
