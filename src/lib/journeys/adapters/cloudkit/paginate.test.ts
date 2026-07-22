import { describe, it, expect, vi } from 'vitest';
import { performQueryAll } from './paginate';

function rec(name: string): CloudKitJS.Record {
    return { recordName: name, recordType: 'Photo', fields: {} } as CloudKitJS.Record;
}

/** A database whose performQuery serves fixed pages, keyed by continuation marker. */
function pagedDb(pages: Array<{ records: CloudKitJS.Record[]; continuationMarker?: string }>) {
    const performQuery = vi.fn(async (_q: CloudKitJS.Query, opts?: Record<string, unknown>) => {
        const marker = opts?.continuationMarker as string | undefined;
        const index = marker ? Number(marker) : 0;
        return pages[index] ?? { records: [] };
    });
    return { db: { performQuery } as unknown as CloudKitJS.Database, performQuery };
}

describe('performQueryAll', () => {
    it('follows continuation markers across every page', async () => {
        const { db, performQuery } = pagedDb([
            { records: [rec('a'), rec('b')], continuationMarker: '1' },
            { records: [rec('c')], continuationMarker: '2' },
            { records: [rec('d')] },
        ]);

        const all = await performQueryAll(db, { recordType: 'Photo' });

        expect(all.map((r) => r.recordName)).toEqual(['a', 'b', 'c', 'd']);
        expect(performQuery).toHaveBeenCalledTimes(3);
    });

    it('puts the marker in the options argument, not the query', async () => {
        const { db, performQuery } = pagedDb([
            { records: [rec('a')], continuationMarker: '1' },
            { records: [rec('b')] },
        ]);

        await performQueryAll(db, { recordType: 'Photo' });

        const [query, opts] = performQuery.mock.calls[1];
        expect(query).not.toHaveProperty('continuationMarker');
        expect(opts).toMatchObject({ continuationMarker: '1' });
    });

    it('stops when a page repeats its own marker instead of looping forever', async () => {
        // A server that keeps handing back the same marker would otherwise spin
        // until the page cap, re-counting the same records (observed live: a
        // 318-photo zone reported 2000).
        const performQuery = vi.fn(async () => ({
            records: [rec('a')],
            continuationMarker: 'stuck',
        }));
        const db = { performQuery } as unknown as CloudKitJS.Database;

        const all = await performQueryAll(db, { recordType: 'Photo' });

        expect(all).toHaveLength(1);
        expect(performQuery).toHaveBeenCalledTimes(2);
    });

    it('de-duplicates records that appear on more than one page', async () => {
        const { db } = pagedDb([
            { records: [rec('a'), rec('b')], continuationMarker: '1' },
            { records: [rec('b'), rec('c')] },
        ]);

        const all = await performQueryAll(db, { recordType: 'Photo' });

        expect(all.map((r) => r.recordName).sort()).toEqual(['a', 'b', 'c']);
    });

    it('returns a single page unchanged when there is no marker', async () => {
        const { db, performQuery } = pagedDb([{ records: [rec('a'), rec('b')] }]);

        const all = await performQueryAll(db, { recordType: 'Photo' });

        expect(all).toHaveLength(2);
        expect(performQuery).toHaveBeenCalledTimes(1);
    });
});
