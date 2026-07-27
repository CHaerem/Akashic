/**
 * E2E fixture records for the signed-out public showcase (QUA-40).
 *
 * WHY THIS EXISTS. `.github/workflows/e2e.yml` used to read the same two repository
 * variables the production deploy reads (`VITE_CLOUDKIT_ENV`,
 * `VITE_CLOUDKIT_API_TOKEN`). Those were switched to production at
 * 2026-07-27T06:36, and the gate went red 57 minutes later with no commit touching
 * the fetch path. MEASURED directly against the CloudKit REST endpoint with the
 * production token:
 *
 *     Origin: https://akashic.no      -> HTTP 200
 *     Origin: http://localhost:5173   -> HTTP 401
 *     (no Origin header)              -> HTTP 401
 *
 * The production token is origin-restricted to the apex, and a CI runner serves the
 * app from localhost. So the gate could only ever be red — publishing a journey into
 * the production mirror would not have helped either, because the 401 is an
 * authorisation failure that happens before any record is considered.
 *
 * These records replace the container, not the mappers. They are shaped as CloudKit
 * REST payloads — TIMESTAMP as epoch millis, LOCATION as `{latitude, longitude}`,
 * ASSET as `{downloadURL, fileChecksum}`, day content camelCase from Swift — so
 * `performQueryAll`, every coercion in `records.ts`, `recordToPublicDbJourney`,
 * `mapWaypoint`, the deterministic sort and `toTrekConfig`/`toTrekData` all still run
 * for real. See `e2eCloudKitContainer.ts` for the seam and what it does NOT cover.
 *
 * TWO CONSUMERS, ONE SOURCE OF TRUTH: `publicAdapter.test.ts` imports these builders
 * instead of keeping its own, and reads the same asset bodies off disk for its stubbed
 * `fetch`. So the 462 unit tests are the drift detector for the e2e fixture — the shape
 * is defined once, and a payload the mappers cannot read goes red in vitest (5 s) before
 * it goes red in Playwright.
 */

/**
 * Unique literal grepped for by `scripts/assertNoFixtureInBundle.mjs`.
 *
 * The claim "Rollup drops the dead branch, so the fixture cannot ship" is exactly the
 * kind of build-tool belief this repo has been burned by before (`INFOPLIST_KEY_*`
 * silently dropped from every shipped plist; warning counts read off incremental
 * builds). So it is asserted against the built artifact rather than written down.
 *
 * It has to be LOAD-BEARING DATA, and finding that out cost a wrong first attempt worth
 * recording. The marker started as `const MARKER = E2E_FIXTURE_MARKER; void MARKER;` in
 * the container module, purely so the string would be retained — and the positive control
 * (`VITE_E2E_TEST_MODE=true vite build`, then grep) showed the marker absent from a build
 * that plainly *did* contain the fixture: Rollup inlined the constant and dropped the
 * `void` statement, so the tripwire could never have fired. A guard you have not seen fail
 * is not a guard. It is now the prefix of every CKAsset `fileChecksum` the fixture emits,
 * i.e. part of an object a live function returns, which cannot be shaken out while the
 * module ships. Verified failing on a flag-on build.
 */
export const E2E_FIXTURE_MARKER = 'AKASHIC_E2E_FIXTURE_DO_NOT_SHIP';

/** Path the Vite dev server serves the CKAsset bodies from. See ./assets/README.md. */
export const FIXTURE_ASSET_PATH = '/src/fixtures/assets';

/**
 * Build an absolute CKAsset `downloadURL` for a fixture body.
 *
 * It MUST be absolute with an http(s) scheme: `assetUrl` (records.ts:106-113) accepts
 * only `/^https?:\/\//i`, so a relative path, a `blob:` URL or a `data:` URL all return
 * null — `resolveJsonField` then yields `route: null`, which is the defect that once
 * dropped the globe route line and zeroed every camp's day distance while looking
 * entirely healthy. Built from the caller's origin rather than a hardcoded
 * `localhost:5173` so it survives Playwright reusing a dev server on another port.
 */
export function fixtureAssetUrl(origin: string, file: string): string {
    return `${origin}${FIXTURE_ASSET_PATH}/${file}`;
}

/** The asset bodies each fixture journey points at, in the order the adapter fetches them. */
export const FIXTURE_ASSET_FILES = [
    'e2e-alpine-loop.route.json',
    'e2e-alpine-loop.waypoints.json',
    'e2e-coastal-ridge.route.json',
    'e2e-coastal-ridge.waypoints.json',
] as const;

/**
 * The primary fixture journey: five days, the shape `day-navigation.spec.ts` drives.
 *
 * DELIBERATELY NOT SLUGGED `kilimanjaro`. The judges split on this — one line of
 * argument was to reuse the owner's real slug so `day-navigation.spec.ts`'s hardcoded
 * `['kilimanjaro','mount-kenya','inca-trail']` resolves with no spec edit. My judgement
 * is the opposite, and I am recording it here because it is a real disagreement: a
 * fixture wearing the owner's slug teaches every future reader that the gate exercises
 * a real published journey, which is the class of false belief QUA-40 exists to remove.
 * The two hardcoded call sites are rewritten to discover a trek with >= 5 camps instead,
 * and an `e2e-` prefix makes it impossible to mistake fixture data for live data in a
 * screenshot or a trace.
 */
export const PRIMARY_FIXTURE_SLUG = 'e2e-alpine-loop';
export const SECONDARY_FIXTURE_SLUG = 'e2e-coastal-ridge';

/** How many camps the primary fixture journey has (days 1..5). */
export const PRIMARY_FIXTURE_DAY_COUNT = 5;

/**
 * Day 5 sits >= 10 km from the nearest route point (MEASURED: 12.28 km from route
 * index 0), which is what makes `useMapbox.ts:1079`'s `distanceToRoute <= 10` gate fall
 * through to `flyTo` instead of `fitBounds`. Four day-navigation tests have always
 * *claimed* to cover that branch and never did: `selectTrekWithCamps` picked
 * Kilimanjaro first, whose day 5 is on-route, so they only ever asserted
 * `getCurrentDay() === 5`. The specs now assert the branch itself.
 */
export const OFF_ROUTE_FIXTURE_DAY = 5;

/**
 * Total route span of the primary fixture, MEASURED at 20.41 km end to end.
 *
 * Kept compact on purpose. `verifyCameraPosition`'s original 50 km tolerance was not a
 * position check at all — it passed because 50 km is wider than the whole Kilimanjaro
 * massif. With a 20 km fixture the tolerance can be tightened to something that would
 * actually catch a camera stuck on the previous day.
 */
export const PRIMARY_FIXTURE_ROUTE_SPAN_KM = 20.41;

type Fields = Record<string, { value: unknown; type?: string }>;

function asset(origin: string, file: string, checksum: string) {
    return {
        value: {
            downloadURL: fixtureAssetUrl(origin, file),
            // Marker-prefixed so the tripwire literal is real returned data — see
            // E2E_FIXTURE_MARKER above for why a decorative reference was not enough.
            fileChecksum: `${E2E_FIXTURE_MARKER}/${checksum}`,
        },
    };
}

/**
 * The two `PublicJourney` records, in CloudKit REST wire format.
 *
 * TEXT IS LOAD-BEARING, not decoration. Playwright's `getByText` is a case-insensitive
 * substring match and `expect(locator).toBeVisible()` throws on more than one hit, so a
 * `name` or `description` containing "summit", "distance", "duration", "ascent" or
 * "start" collides with `OverviewTab`'s four stat labels or the Sidebar's "Start"
 * button and produces a strict-mode violation that reads nothing like a data problem.
 * Every string below is checked against that list.
 */
export function buildPublicJourneyRecords(origin: string): CloudKitJS.Record[] {
    const alpine: Fields = {
        slug: { value: PRIMARY_FIXTURE_SLUG },
        // Split on " - " for TrekConfig.name -> "Alpine Loop"; full string for TrekData.name.
        name: { value: 'Alpine Loop - Fixture Traverse' },
        description: {
            value:
                'A deterministic five-day fixture journey. The end-to-end gate reads these ' +
                'records from a local fixture, never from a live CloudKit container.',
        },
        country: { value: 'Norway' },
        summitElevation: { value: 2340 },
        totalDistance: { value: 20.4 },
        totalDays: { value: 5 },
        // TIMESTAMP: epoch millis as a NUMBER, so isoDateOrNull does the conversion.
        // Later than the coastal journey, so the dateStarted-desc sort puts it first.
        dateStarted: { value: 1_719_792_000_000, type: 'TIMESTAMP' }, // 2024-07-01
        dateEnded: { value: 1_720_137_600_000, type: 'TIMESTAMP' }, // 2024-07-05
        // LOCATION: {latitude, longitude}, so toLngLat does the unwrap.
        centerLocation: { value: { latitude: 61.672, longitude: 8.42 } },
        preferredBearing: { value: 40 },
        preferredPitch: { value: 60 },
        // statsJSON stays an inline STRING (camelCase already matches TrekStats).
        statsJSON: {
            value: JSON.stringify({
                duration: 5,
                totalDistance: 20.4,
                totalElevationGain: 1440,
                highestPoint: { name: 'High Col', elevation: 2340 },
            }),
        },
        // ASSETs: a metadata query returns only the descriptor, so resolveJsonField has
        // to fetch both bodies. This is the branch with the defect history.
        routeJSON: asset(origin, 'e2e-alpine-loop.route.json', 'fixture-alpine-route'),
        waypointsJSON: asset(origin, 'e2e-alpine-loop.waypoints.json', 'fixture-alpine-wp'),
        heroThumb: asset(origin, 'thumb.png', 'fixture-thumb'),
    };

    const coastal: Fields = {
        slug: { value: SECONDARY_FIXTURE_SLUG },
        name: { value: 'Coastal Ridge - Fixture Shore' },
        description: {
            value:
                'A short fixture journey of three days. It exists so the globe holds more than ' +
                'one marker and the ordering rule has something to order.',
        },
        country: { value: 'Norway' },
        summitElevation: { value: 520 },
        totalDistance: { value: 8 },
        totalDays: { value: 3 },
        dateStarted: { value: 1_688_169_600_000, type: 'TIMESTAMP' }, // 2023-07-01
        centerLocation: { value: { latitude: 60.42, longitude: 5.36 } },
        preferredBearing: { value: 210 },
        preferredPitch: { value: 55 },
        // No statsJSON on purpose: toTrekData then synthesizes stats from
        // total_days/total_distance/summit_elevation, which is a live branch nothing
        // else in the e2e run exercises.
        routeJSON: asset(origin, 'e2e-coastal-ridge.route.json', 'fixture-coastal-route'),
        waypointsJSON: asset(origin, 'e2e-coastal-ridge.waypoints.json', 'fixture-coastal-wp'),
    };

    // The public mirror has no UUIDs: a PublicJourney's recordName IS the slug. Records
    // are returned in the OPPOSITE order to the expected sort, so the deterministic
    // ordering at publicAdapter.ts:223-230 has to do real work.
    return [
        { recordName: SECONDARY_FIXTURE_SLUG, recordType: 'PublicJourney', fields: coastal },
        { recordName: PRIMARY_FIXTURE_SLUG, recordType: 'PublicJourney', fields: alpine },
    ];
}

/**
 * `PublicPhoto` thumbnails for the primary journey, joined on the `journeySlug` STRING
 * field.
 *
 * `dayNumber` 1/3/5 exercises `buildDayToWaypointId`'s day -> camp-id synthesis,
 * including the day-3 camp whose id is itself derived (`${slug}-day-3`, because that
 * waypoint carries no `id`). The `thumb` descriptors MUST point at a body that really
 * resolves: `useMapbox.ts:1437` puts the URL straight into an `<img src>`, and a 404
 * surfaces in Chromium as a console error of type `error`, which
 * `day-navigation.spec.ts` collects and fails on (it filters only on 'DevTools').
 *
 * Deliberately three photos, not the 200+ that would exercise `performQueryAll`'s paging
 * loop end to end: the fixture DB below implements `resultsLimit` + continuation markers
 * faithfully, `paginate.test.ts` already covers the loop in 6 ms, and 200 photo markers
 * would add 200 image loads and 200 DOM nodes to every single e2e test.
 */
export function buildPublicPhotoRecords(origin: string): CloudKitJS.Record[] {
    const thumb = asset(origin, 'thumb.png', 'fixture-thumb');
    // Near each photo's own day camp, as a LOCATION field, so toLngLat runs on photo
    // coordinates too and the map's photo-marker grouping has something to group.
    const at: Record<number, { latitude: number; longitude: number }> = {
        1: { latitude: 61.624, longitude: 8.34 },
        3: { latitude: 61.696, longitude: 8.46 },
        5: { latitude: 61.52, longitude: 8.14 },
    };
    return [1, 3, 5].map((day, index) => ({
        recordName: `${PRIMARY_FIXTURE_SLUG}-photo-${index + 1}`,
        recordType: 'PublicPhoto',
        fields: {
            journeySlug: { value: PRIMARY_FIXTURE_SLUG },
            thumb,
            dayNumber: { value: day },
            sortOrder: { value: index },
            caption: { value: `Fixture photo, day ${day}` },
            coordinates: { value: at[day] },
            takenAt: { value: 1_719_792_000_000 + day * 86_400_000, type: 'TIMESTAMP' },
        } satisfies Fields,
    }));
}
