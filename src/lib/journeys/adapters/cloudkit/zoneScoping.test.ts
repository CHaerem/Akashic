import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Regression tests for the three faults that only a live container exposed (T3.2).
 * Every one of them produced an *empty or null result*, never an error — which is
 * why mocks that returned whatever the adapter asked for missed all three.
 */

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

import { fetchPhotos, getPhotosForWaypoint } from './photoAdapter';
import { recordToPhoto, recordToDbJourney } from './records';
import { rememberJourneyZones, resolveJourneyZone, clearJourneyZones } from './journeyZones';

const ZONE = { zoneName: 'journey-uuid-1', ownerRecordName: '_owner', zoneType: 'REGULAR_CUSTOM_ZONE' };

const journeyRecord = {
    recordName: 'uuid-1',
    recordType: 'Journey',
    zoneID: ZONE,
    fields: { slug: { value: 'kilimanjaro' }, name: { value: 'Kilimanjaro' } },
};

/** Records a database that answers only when asked for the right zone. */
function makeZoneAwareDb(recordsByZone: Record<string, unknown[]>) {
    const calls: Array<{ query: CloudKitJS.Query; options?: CloudKitJS.QueryOptions }> = [];
    return {
        calls,
        db: {
            performQuery: vi.fn(async (query: CloudKitJS.Query, options?: CloudKitJS.QueryOptions) => {
                calls.push({ query, options });
                const zone = options?.zoneID?.zoneName;
                return { records: (zone && recordsByZone[zone]) || [] };
            }),
            fetchRecords: vi.fn(async () => ({ records: [] })),
            saveRecords: vi.fn(async () => ({ records: [] })),
            deleteRecords: vi.fn(async () => ({ records: [] })),
        },
    };
}

function emptyDb() {
    return {
        performQuery: vi.fn(async () => ({ records: [] })),
        fetchRecords: vi.fn(async () => ({ records: [] })),
        saveRecords: vi.fn(async () => ({ records: [] })),
        deleteRecords: vi.fn(async () => ({ records: [] })),
    };
}

describe('journey zone resolution', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearJourneyZones();
    });

    it('resolves a journey by slug as well as by record name', () => {
        rememberJourneyZones([journeyRecord as unknown as CloudKitJS.Record], 'private');
        return Promise.all([
            expect(resolveJourneyZone('kilimanjaro')).resolves.toMatchObject({ recordName: 'uuid-1' }),
            expect(resolveJourneyZone('uuid-1')).resolves.toMatchObject({ zoneID: ZONE }),
        ]);
    });

    it('does not leak zones between accounts', async () => {
        rememberJourneyZones([journeyRecord as unknown as CloudKitJS.Record], 'private');
        clearJourneyZones();
        getPrivateDatabase.mockResolvedValue(emptyDb());
        getSharedDatabase.mockResolvedValue(emptyDb());
        await expect(resolveJourneyZone('kilimanjaro')).resolves.toBeNull();
    });
});

describe('photo reads are scoped to the journey zone', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearJourneyZones();
        rememberJourneyZones([journeyRecord as unknown as CloudKitJS.Record], 'private');
    });

    /**
     * The original query filtered `journeyRef == journeyId` while callers pass a slug
     * and the field holds a UUID reference. CloudKit rejected it outright, the error
     * was swallowed, and a journey with 939 photos rendered as having none.
     */
    it('queries the zone rather than filtering on a reference', async () => {
        const photo = { recordName: 'p1', recordType: 'Photo', zoneID: ZONE, fields: {} };
        const priv = makeZoneAwareDb({ 'journey-uuid-1': [photo] });
        getPrivateDatabase.mockResolvedValue(priv.db);
        getSharedDatabase.mockResolvedValue(emptyDb());

        const photos = await fetchPhotos('kilimanjaro');

        expect(photos).toHaveLength(1);
        expect(priv.calls[0].options?.zoneID?.zoneName).toBe('journey-uuid-1');
        expect(priv.calls[0].query.filterBy).toBeUndefined();
    });

    it('returns empty — and warns — when the journey has no zone', async () => {
        clearJourneyZones();
        getPrivateDatabase.mockResolvedValue(emptyDb());
        getSharedDatabase.mockResolvedValue(emptyDb());
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        await expect(fetchPhotos('does-not-exist')).resolves.toEqual([]);
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    /** A reference field needs a reference predicate, not a bare string. */
    it('filters day photos with a typed REFERENCE predicate', async () => {
        const priv = makeZoneAwareDb({});
        getPrivateDatabase.mockResolvedValue(priv.db);
        getSharedDatabase.mockResolvedValue(emptyDb());

        await getPhotosForWaypoint('wp-1');

        const filter = priv.calls[0].query.filterBy?.[0] as {
            fieldName: string;
            fieldValue: { value: { recordName: string }; type: string };
        };
        expect(filter.fieldName).toBe('waypointRef');
        expect(filter.fieldValue.type).toBe('REFERENCE');
        expect(filter.fieldValue.value.recordName).toBe('wp-1');
    });
});

describe('date fields arrive as CloudKit TIMESTAMPs', () => {
    /**
     * Every date in the schema is epoch milliseconds, not the ISO string Postgres
     * returned. Read as a string they all became null, which cost the web app its
     * journey date ranges *and* every photo's `taken_at` — and `taken_at` is what
     * `usePhotoDay` matches a photo to its day with.
     */
    it('reads a numeric takenAt into an ISO string', () => {
        const photo = recordToPhoto({
            recordName: 'p1',
            recordType: 'Photo',
            fields: { takenAt: { value: 1664720662000, type: 'TIMESTAMP' } },
        } as unknown as CloudKitJS.Record);
        expect(photo.taken_at).toBe('2022-10-02T14:24:22.000Z');
    });

    it('reads numeric journey dates into ISO strings', () => {
        const journey = recordToDbJourney({
            recordName: 'uuid-1',
            recordType: 'Journey',
            fields: {
                dateStarted: { value: 1664496000000, type: 'TIMESTAMP' },
                dateEnded: { value: 1696809600000, type: 'TIMESTAMP' },
            },
        } as unknown as CloudKitJS.Record);
        expect(journey.date_started).toBe('2022-09-30T00:00:00.000Z');
        expect(journey.date_ended).toBe('2023-10-09T00:00:00.000Z');
    });

    it('still accepts ISO strings, so older records keep working', () => {
        const photo = recordToPhoto({
            recordName: 'p1',
            recordType: 'Photo',
            fields: { takenAt: { value: '2022-10-02T14:24:22.000Z' } },
        } as unknown as CloudKitJS.Record);
        expect(photo.taken_at).toBe('2022-10-02T14:24:22.000Z');
    });

    it('leaves a missing date null rather than inventing the epoch', () => {
        const photo = recordToPhoto({
            recordName: 'p1',
            recordType: 'Photo',
            fields: {},
        } as unknown as CloudKitJS.Record);
        expect(photo.taken_at).toBeNull();
    });
});
