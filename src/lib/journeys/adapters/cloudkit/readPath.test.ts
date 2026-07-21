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

        it('returns empty data when no journey records exist', async () => {
            getSharedDatabase.mockResolvedValue(makeDb({}));
            getPrivateDatabase.mockResolvedValue(makeDb({}));

            const result = await fetchJourneys();
            expect(result).toEqual({ treks: [], trekDataMap: {} });
        });
    });

    describe('fetchPhotos', () => {
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
        it('saves the caption and returns the mapped photo', async () => {
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

            expect(sharedDb.saveRecords).toHaveBeenCalled();
            expect(result?.id).toBe('photo-1');
            expect(result?.caption).toBe('New caption');
        });
    });
});
