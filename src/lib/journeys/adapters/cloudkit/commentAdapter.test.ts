import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Comment adapter — the two review findings that only bite a real session:
 *  1. canUserComment returned false for every signed-in user (the composer was dead
 *     for the whole family) because it read CKShare participants, which are empty for
 *     the OWNER of an unshared journey. Correct semantics: signed-in can comment.
 *  2. updateComment must not resurrect a comment deleted elsewhere as a ghost record
 *     (a tagless save is an INSERT — verification doc fault #6).
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

import { canUserComment, updateComment } from './commentAdapter';
import { rememberRecordZone, clearJourneyZones } from './journeyZones';
import type { JourneyZone } from './journeyZones';

const ZONE: JourneyZone = {
    recordName: 'j-1',
    zoneID: { zoneName: 'journey-j-1', ownerRecordName: '_owner' },
    scope: 'private',
};

function makeDb(handlers: {
    fetchRecords?: (n: string) => Promise<{ records: unknown[]; hasErrors?: boolean }>;
    saveRecords?: (r: unknown) => Promise<{ records: unknown[]; hasErrors?: boolean }>;
} = {}) {
    return {
        performQuery: vi.fn(async () => ({ records: [] })),
        fetchRecords: vi.fn(handlers.fetchRecords ?? (async () => ({ records: [] }))),
        saveRecords: vi.fn(handlers.saveRecords ?? (async () => ({ records: [] }))),
        deleteRecords: vi.fn(async () => ({ records: [] })),
    };
}

describe('canUserComment', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns true for any signed-in user — including the owner of an unshared journey', async () => {
        // The owner has no CKShare participants, which is exactly what the old
        // membership check tripped over. A signed-in user can comment on any journey
        // they can read, and the read layer only surfaces journeys they may read.
        getCloudKitSession.mockResolvedValue({ user: { userRecordName: 'owner' } });
        await expect(canUserComment('some-journey')).resolves.toBe(true);
    });

    it('returns false when signed out', async () => {
        getCloudKitSession.mockResolvedValue({ user: null });
        await expect(canUserComment('some-journey')).resolves.toBe(false);
    });

    it('returns false (without throwing) when the session probe rejects', async () => {
        getCloudKitSession.mockRejectedValue(new Error('offline'));
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        await expect(canUserComment('some-journey')).resolves.toBe(false);
        errSpy.mockRestore();
    });
});

describe('updateComment — no ghost resurrection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearJourneyZones();
        // The comment's zone is learned when its day loads.
        rememberRecordZone([{ recordName: 'c1' } as unknown as CloudKitJS.Record], ZONE);
        getCloudKitSession.mockResolvedValue({ user: { userRecordName: 'owner' } });
    });

    it('refuses to save when the comment was deleted elsewhere (hasErrors, no record)', async () => {
        const db = makeDb({ fetchRecords: async () => ({ records: [], hasErrors: true }) });
        getPrivateDatabase.mockResolvedValue(db);
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        await expect(updateComment('c1', { content: 'edit after delete' })).rejects.toThrow(
            /not found/
        );
        // No insert attempted — nothing to resurrect.
        expect(db.saveRecords).not.toHaveBeenCalled();
        errSpy.mockRestore();
    });

    it('still saves an edit when the comment exists (change tag present)', async () => {
        const saved = {
            recordName: 'c1',
            fields: {
                content: { value: 'edited' },
                createdAt: { value: '2024-01-01T00:00:00Z' },
                modifiedAt: { value: '2024-01-02T00:00:00Z' },
            },
        };
        const db = makeDb({
            fetchRecords: async () => ({
                records: [{ recordName: 'c1', recordChangeTag: 'tag-1', fields: {} }],
            }),
            saveRecords: async () => ({ records: [saved] }),
        });
        getPrivateDatabase.mockResolvedValue(db);

        const result = await updateComment('c1', { content: 'edited' });
        expect(result?.content).toBe('edited');
        // The save carried the fetched change tag, so it was an UPDATE, not an insert.
        const savedArg = (db.saveRecords.mock.calls[0][0] as Array<{ recordChangeTag?: string }>)[0];
        expect(savedArg.recordChangeTag).toBe('tag-1');
    });
});
