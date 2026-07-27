/**
 * A `CloudKitJS.Container` that never touches Apple (QUA-40).
 *
 * Installed by the one guard in `src/lib/cloudkit.ts:getContainer()` when
 * `VITE_E2E_TEST_MODE === 'true'`. See `publicShowcase.ts` for the 200/401 origin
 * measurements that made this necessary, and `assets/README.md` for how the CKAsset
 * bodies are served.
 *
 * WHY THE SEAM IS AT `getContainer()` AND NOT AT `fetchPublicJourneys()`.
 * `getContainer` is the only function in `src/` that calls `loadCloudKit()` (the
 * `cdn.apple-cloudkit.com` script injection), `CloudKit.configure()` with the token and
 * environment, and `getDefaultContainer()` — and it is the sole ancestor of every
 * exported facade function. Short-circuiting `fetchPublicJourneys` alone leaves four
 * further 401/throw surfaces alive, each of which fails
 * `day-navigation.spec.ts`'s zero-console-error test on its own:
 *   - `fetchPublicPhotos` (publicAdapter.ts:303) via AkashicApp -> getJourneyIdBySlug
 *     -> fetchPhotos, logging '[cloudkit] Error fetching public photos'
 *   - `canUserComment` (commentAdapter.ts:301) — the one read with NO signed-out guard,
 *     mounted by DayCommentsSection for every selected day, logging
 *     '[cloudkit] Error checking comment permission'
 *   - `AuthGuard.tsx:43`'s unconditional `getCloudKitSession()` probe
 *   - `onCloudKitAuthChange`'s two listeners
 * Fixing surfaces one at a time is how the survey for this task found three and still
 * missed the auth listeners. Replacing the boundary fixes the class.
 *
 * WHAT THIS STOPS TESTING, stated plainly because it matters more than the fix:
 * the e2e gate no longer validates the CloudKit token, its environment scoping, or its
 * Allowed Origins — which is the very defect class that caused QUA-40. The suite was an
 * accidental canary for "is the production token usable from this origin", and this
 * removes it. It was a canary that could only ever report red from localhost, so it was
 * not a useful one, but the replacement has to be explicit: an owner-run check against
 * the deployed apex with a real `Origin` header (CLAUDE.md documents the trailing-slash
 * Allowed-Origins failure that makes this non-theoretical). Also lost: CloudKit JS
 * itself, real wire encodings, `QueryResponse.hasErrors`, cross-origin asset fetching,
 * and the real sign-in/out transition.
 *
 * WHAT STILL RUNS FOR REAL: everything above the SDK boundary — `performQueryAll`'s
 * paging, all of `records.ts`, `recordToPublicDbJourney`/`mapWaypoint`, the deterministic
 * sort, `resolveJsonField`'s ASSET branch including a real `fetch`, `toTrekConfig` /
 * `toTrekData` with the Haversine day-distance derivation, `journeyCache`, and the whole
 * UI and map layer. Apple's MapKit CDN remains a live dependency of every spec that opens a
 * journey — it was `api.mapbox.com` until MAP-05 deleted that surface, and the exact host names
 * are listed in `e2e/fixtures/test.ts`'s allowlist rather than here, because
 * `src/lib/map/boundary.test.ts` rejects a `mapkit.`-prefixed token anywhere outside the adapter
 * and its regex cannot tell a hostname in a comment from an API call. This
 * change makes the suite CloudKit-independent, NOT offline.
 */

import { buildPublicJourneyRecords, buildPublicPhotoRecords } from './publicShowcase';

type Filter = {
    fieldName: string;
    comparator: string;
    fieldValue?: { value?: unknown };
};

/**
 * Honour `filterBy` for STRING equality, exactly as the real container does.
 *
 * Not a convenience: `fetchPublicPhotos` sends a plain STRING predicate on
 * `journeySlug` (publicAdapter.ts:311), and a fixture DB that ignored `filterBy` could
 * not tell a correct predicate from a dropped one — a dropped filter bleeds every
 * journey's photos into each grid. Only EQUALS is modelled; anything else is reported
 * as a non-match rather than silently passing, so an unmodelled predicate shows up as
 * missing rows instead of as a fixture that lies.
 */
function matchesFilters(record: CloudKitJS.Record, query: CloudKitJS.Query): boolean {
    const filters = (query.filterBy ?? []) as Filter[];
    return filters.every((f) => {
        if (f.comparator !== 'EQUALS') return false;
        return record.fields?.[f.fieldName]?.value === f.fieldValue?.value;
    });
}

/** An empty database — what the private and shared zones look like to a signed-out visitor. */
function emptyDatabase(): CloudKitJS.Database {
    const empty = async (): Promise<CloudKitJS.QueryResponse> => ({ records: [] });
    return {
        performQuery: empty,
        fetchRecords: empty,
        saveRecords: empty,
        deleteRecords: empty,
    };
}

/**
 * A database over a fixed record set, paginated the way CloudKit paginates.
 *
 * `resultsLimit` and `continuationMarker` are implemented faithfully even though the
 * seeded volume never triggers a second page — a fixture that quietly ignored paging
 * would make `performQueryAll` untestable here the day someone seeds 300 records.
 */
function fixtureDatabase(recordsByType: Record<string, CloudKitJS.Record[]>): CloudKitJS.Database {
    const performQuery = async (
        query: CloudKitJS.Query,
        options?: CloudKitJS.QueryOptions
    ): Promise<CloudKitJS.QueryResponse> => {
        const all = (recordsByType[query.recordType] ?? []).filter((r) => matchesFilters(r, query));
        const limit = typeof options?.resultsLimit === 'number' ? options.resultsLimit : all.length;
        const offset = Number.parseInt(String(options?.continuationMarker ?? '0'), 10) || 0;
        const page = all.slice(offset, offset + limit);
        const next = offset + limit;
        return next < all.length
            ? { records: page, continuationMarker: String(next) }
            : { records: page };
    };
    const empty = async (): Promise<CloudKitJS.QueryResponse> => ({ records: [] });
    return {
        performQuery,
        fetchRecords: empty,
        saveRecords: empty,
        deleteRecords: empty,
    };
}

/**
 * Build the fixture container.
 *
 * `origin` is `window.location.origin`, so the CKAsset `downloadURL`s point at whatever
 * port the dev server actually came up on.
 */
export function createE2EFixtureContainer(origin: string): CloudKitJS.Container {
    const publicDatabase = fixtureDatabase({
        PublicJourney: buildPublicJourneyRecords(origin),
        PublicPhoto: buildPublicPhotoRecords(origin),
    });

    // A promise that never settles. This is a trap, not a detail. AuthGuard's
    // `listenOut()` (AuthGuard.tsx:167-176) re-subscribes inside its own `.then`, so a
    // `whenUserSignsOut()` that resolved immediately is an unbounded promise loop; and a
    // `whenUserSignsIn()` that resolved with a user flips `signedInRef.current` and hits
    // `window.location.reload()` (AuthGuard.tsx:65-69) — a reload loop that would time
    // out every spec with no visible cause.
    const never = <T>(): Promise<T> => new Promise<T>(() => {});

    return {
        publicCloudDatabase: publicDatabase,
        // Empty rather than throwing: E2E mode's data layer takes the public path
        // (setUpAuth resolves null below, so isSignedIn() is false), but a stray
        // signed-in-path call should stay quiet instead of console-erroring.
        privateCloudDatabase: emptyDatabase(),
        sharedCloudDatabase: emptyDatabase(),
        // Load-bearing: resolving null is what keeps `isSignedIn()` (publicAdapter.ts:69)
        // deterministically false, so journeyAdapter.ts:83 and photoAdapter.ts:65 route to
        // the public adapters. That matches the chimera the UI already assumes — AuthGuard
        // forces `signedIn = true` at the UI layer while the data layer reads public. It
        // also makes `canUserComment` return false without logging.
        setUpAuth: async () => null,
        whenUserSignsIn: () => never<CloudKitJS.UserIdentity>(),
        whenUserSignsOut: () => never<void>(),
        fetchShareParticipants: async () => ({ participants: [] }),
    };
}
