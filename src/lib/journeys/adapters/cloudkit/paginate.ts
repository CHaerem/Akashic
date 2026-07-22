/**
 * Paginated CloudKit JS queries.
 *
 * `performQuery` returns at most ~100 records per call and hands back a
 * `continuationMarker` when more exist. Reading only the first page silently
 * truncates: the real archive has 939 photos on one journey, so an unpaginated
 * read showed roughly a tenth of them with no error anywhere.
 *
 * Two things are load-bearing here and easy to get wrong:
 *  - the marker goes in the *options* argument, not in the query. Putting it in
 *    the query re-runs the first page forever (a loop that "succeeds" while
 *    counting the same records over and over).
 *  - a response that returns the same marker it was given is not progress —
 *    stop, or the loop never ends.
 */

const PAGE_LIMIT = 200;
/** Safety valve: 200 x 50 = 10 000 records per query, far beyond any journey. */
const MAX_PAGES = 50;

/**
 * Run `query` against `db`, following continuation markers until exhausted.
 * Records are de-duplicated by `recordName`, so an overlapping page can never
 * inflate the result.
 */
export async function performQueryAll(
    db: CloudKitJS.Database,
    query: CloudKitJS.Query,
    options: Record<string, unknown> = {}
): Promise<CloudKitJS.Record[]> {
    const byName = new Map<string, CloudKitJS.Record>();
    let marker: string | undefined;
    let pages = 0;

    do {
        const opts: Record<string, unknown> = { resultsLimit: PAGE_LIMIT, ...options };
        if (marker) opts.continuationMarker = marker;

        const response = await db.performQuery(query, opts);
        for (const record of response.records ?? []) {
            if (record?.recordName) byName.set(record.recordName, record);
        }

        const next = response.continuationMarker;
        if (!next || next === marker) break; // exhausted, or no forward progress
        marker = next;
    } while (++pages < MAX_PAGES);

    return [...byName.values()];
}
