import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * On-demand photo originals (photo architecture v2). The original lives in a
 * `PhotoMedia` record (`media-<photoId>`) inside a per-journey MEDIA zone
 * (`journey-<uuid>-media`), looked up in whichever database the journey's own zone
 * lives in. Every failure mode here returns null quietly, so the caller can keep the
 * thumb as the floor.
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

import { fetchOriginalUrl, clearOriginalUrlCache } from './mediaAdapter';
import { rememberJourneyZones, clearJourneyZones } from './journeyZones';

const ZONE = { zoneName: 'journey-uuid-1', ownerRecordName: '_owner', zoneType: 'REGULAR_CUSTOM_ZONE' };

const journeyRecord = {
    recordName: 'uuid-1',
    recordType: 'Journey',
    zoneID: ZONE,
    fields: { slug: { value: 'kilimanjaro' }, name: { value: 'Kilimanjaro' } },
};

const mediaRecord = (photoId: string, url: string) => ({
    recordName: `media-${photoId}`,
    recordType: 'PhotoMedia',
    fields: { original: { value: { downloadURL: url } } },
});

/** A database that answers a lookup only when asked for the right (media) zone. */
function makeMediaDb(recordsByZone: Record<string, unknown[]>) {
    const calls: Array<{ recordNames: unknown; options?: CloudKitJS.QueryOptions }> = [];
    return {
        calls,
        db: {
            fetchRecords: vi.fn(async (recordNames: unknown, options?: CloudKitJS.QueryOptions) => {
                calls.push({ recordNames, options });
                const zone = options?.zoneID?.zoneName;
                return { records: (zone && recordsByZone[zone]) || [] };
            }),
            // resolveJourneyZone falls back to a query when a zone is unknown; keep it empty.
            performQuery: vi.fn(async () => ({ records: [] })),
            saveRecords: vi.fn(async () => ({ records: [] })),
            deleteRecords: vi.fn(async () => ({ records: [] })),
        },
    };
}

function emptyDb() {
    return makeMediaDb({}).db;
}

describe('fetchOriginalUrl (on-demand photo originals)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearJourneyZones();
        clearOriginalUrlCache();
    });

    it('looks up media-<photoId> in the derived <zone>-media zone and returns the original downloadURL', async () => {
        rememberJourneyZones([journeyRecord as unknown as CloudKitJS.Record], 'private');
        const priv = makeMediaDb({
            'journey-uuid-1-media': [mediaRecord('p1', 'https://cvws.icloud-content.com/p1-original')],
        });
        getPrivateDatabase.mockResolvedValue(priv.db);
        getSharedDatabase.mockResolvedValue(emptyDb());

        const url = await fetchOriginalUrl('p1', 'kilimanjaro');

        expect(url).toBe('https://cvws.icloud-content.com/p1-original');
        expect(priv.calls).toHaveLength(1);
        // Record name is `media-<photoId>`, looked up (not filtered on — recordName is
        // not queryable).
        expect(priv.calls[0].recordNames).toBe('media-p1');
        // Media zone is derived from the journey zone by suffixing `-media`, and it goes
        // in the OPTIONS argument (trap #4), carrying the owner's record name.
        expect(priv.calls[0].options?.zoneID?.zoneName).toBe('journey-uuid-1-media');
        expect(priv.calls[0].options?.zoneID?.ownerRecordName).toBe('_owner');
        // desiredKeys trims the response to just the asset we need.
        expect(priv.calls[0].options?.desiredKeys).toEqual(['original']);
    });

    it('routes an owned journey to the private database, never the shared one', async () => {
        rememberJourneyZones([journeyRecord as unknown as CloudKitJS.Record], 'private');
        const priv = makeMediaDb({ 'journey-uuid-1-media': [mediaRecord('p2', 'https://x/p2')] });
        const shared = makeMediaDb({ 'journey-uuid-1-media': [mediaRecord('p2', 'https://SHARED/p2')] });
        getPrivateDatabase.mockResolvedValue(priv.db);
        getSharedDatabase.mockResolvedValue(shared.db);

        const url = await fetchOriginalUrl('p2', 'kilimanjaro');

        expect(url).toBe('https://x/p2');
        expect(priv.calls).toHaveLength(1);
        expect(shared.calls).toHaveLength(0);
    });

    it('routes a shared-in journey to the shared database, preserving ownerRecordName', async () => {
        rememberJourneyZones([journeyRecord as unknown as CloudKitJS.Record], 'shared');
        const shared = makeMediaDb({ 'journey-uuid-1-media': [mediaRecord('p3', 'https://shared/p3')] });
        const priv = makeMediaDb({ 'journey-uuid-1-media': [mediaRecord('p3', 'https://PRIVATE/p3')] });
        getSharedDatabase.mockResolvedValue(shared.db);
        getPrivateDatabase.mockResolvedValue(priv.db);

        const url = await fetchOriginalUrl('p3', 'kilimanjaro');

        expect(url).toBe('https://shared/p3');
        expect(shared.calls).toHaveLength(1);
        expect(priv.calls).toHaveLength(0);
        // The shared DB rejects a zone id without ownerRecordName (trap #5); the derived
        // media zone must keep it.
        expect(shared.calls[0].options?.zoneID?.ownerRecordName).toBe('_owner');
    });

    it('caches a resolved original per photoId for the page lifetime', async () => {
        rememberJourneyZones([journeyRecord as unknown as CloudKitJS.Record], 'private');
        const priv = makeMediaDb({ 'journey-uuid-1-media': [mediaRecord('p4', 'https://x/p4')] });
        getPrivateDatabase.mockResolvedValue(priv.db);
        getSharedDatabase.mockResolvedValue(emptyDb());

        const first = await fetchOriginalUrl('p4', 'kilimanjaro');
        const second = await fetchOriginalUrl('p4', 'kilimanjaro');

        expect(first).toBe('https://x/p4');
        expect(second).toBe('https://x/p4');
        // The second call is served from cache — no second lookup.
        expect(priv.calls).toHaveLength(1);
    });

    it('returns null on a lookup that reports hasErrors, and keeps it retryable (not cached)', async () => {
        rememberJourneyZones([journeyRecord as unknown as CloudKitJS.Record], 'private');
        const priv = {
            fetchRecords: vi.fn(async () => ({
                records: [],
                hasErrors: true,
                errors: [{ reason: 'record not found' }],
            })),
            performQuery: vi.fn(async () => ({ records: [] })),
            saveRecords: vi.fn(async () => ({ records: [] })),
            deleteRecords: vi.fn(async () => ({ records: [] })),
        };
        getPrivateDatabase.mockResolvedValue(priv);
        getSharedDatabase.mockResolvedValue(emptyDb());

        await expect(fetchOriginalUrl('p5', 'kilimanjaro')).resolves.toBeNull();
        // A failure must not pin the photo to its thumb forever: a later open retries.
        await fetchOriginalUrl('p5', 'kilimanjaro');
        expect(priv.fetchRecords).toHaveBeenCalledTimes(2);
    });

    it('returns null when the media record is absent', async () => {
        rememberJourneyZones([journeyRecord as unknown as CloudKitJS.Record], 'private');
        const priv = makeMediaDb({}); // the media zone holds no PhotoMedia record
        getPrivateDatabase.mockResolvedValue(priv.db);
        getSharedDatabase.mockResolvedValue(emptyDb());

        await expect(fetchOriginalUrl('p6', 'kilimanjaro')).resolves.toBeNull();
    });

    it('returns null when the journey zone cannot be resolved', async () => {
        // No zone remembered; resolveJourneyZone queries and finds nothing.
        getPrivateDatabase.mockResolvedValue(emptyDb());
        getSharedDatabase.mockResolvedValue(emptyDb());

        await expect(fetchOriginalUrl('p7', 'unknown-journey')).resolves.toBeNull();
    });

    it('returns null when the lookup throws', async () => {
        rememberJourneyZones([journeyRecord as unknown as CloudKitJS.Record], 'private');
        const priv = {
            fetchRecords: vi.fn(async () => {
                throw new Error('network down');
            }),
            performQuery: vi.fn(async () => ({ records: [] })),
            saveRecords: vi.fn(async () => ({ records: [] })),
            deleteRecords: vi.fn(async () => ({ records: [] })),
        };
        getPrivateDatabase.mockResolvedValue(priv);
        getSharedDatabase.mockResolvedValue(emptyDb());

        await expect(fetchOriginalUrl('p8', 'kilimanjaro')).resolves.toBeNull();
    });
});
