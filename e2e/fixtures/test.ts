import { test as base, expect } from '@playwright/test';

/**
 * The E2E `test` every spec imports instead of `@playwright/test` (QUA-40).
 *
 * It adds one thing: a standing assertion that the app made ZERO requests to Apple.
 *
 * WHY THAT ASSERTION EXISTS. The gate went red on 2026-07-27 because
 * `.github/workflows/e2e.yml` read the same two repository variables the production
 * deploy reads (`VITE_CLOUDKIT_ENV`, `VITE_CLOUDKIT_API_TOKEN`). MEASURED against the
 * CloudKit REST endpoint with the production token:
 *
 *     Origin: https://akashic.no      -> HTTP 200
 *     Origin: http://localhost:5173   -> HTTP 401
 *     (no Origin header)              -> HTTP 401
 *
 * The production token is origin-locked to the apex; a CI runner serves the app from
 * localhost, so every call 401s and `fetchPublicJourneys` logged
 * "[cloudkit] Error fetching public journeys". The fix is a fixture container behind
 * `VITE_E2E_TEST_MODE` (see `src/fixtures/e2eCloudKitContainer.ts`), and the two
 * variables are gone from the workflow.
 *
 * A fixture that is *supposed* to keep the suite off Apple's network is a belief. This
 * turns it into a per-run measurement: any request to an Apple host is aborted AND
 * recorded, and the recording is asserted empty at teardown. So the suite cannot quietly
 * regain a CloudKit dependency — not through a stray `cdn.apple-cloudkit.com` script, not
 * through a CKAsset URL that escaped the fixture. It also means an iCloud outage can never
 * turn this gate red again. (It used to claim it would catch "a new adapter" too. It would
 * not have — see the MAP-03 section below.)
 *
 * A regex (not a glob) so only matching requests enter a JS handler: every spec waits on
 * a real map canvas, and routing `**` through Playwright would put a round trip in front of
 * every tile.
 *
 * ## MAP-03 changed what this can honestly claim, and the change is deliberate
 *
 * This file used to claim the assertion would catch a live Apple dependency regained
 * "through a new adapter". It would NOT have: `APPLE_HOSTS` never matched
 * `cdn.apple-mapkit.com` or `sat-cdn.apple-mapkit.com`, so a MapKit surface would have slipped
 * through in silence — the assertion passing for the wrong reason, which is the failure shape
 * this whole file exists to remove.
 *
 * So MapKit's hosts are now matched and **explicitly allowed**, recorded separately, and the
 * CloudKit family stays hard-blocked. A MapKit request no longer sneaks past; it is let through
 * on purpose, and only in the one project that needs it.
 *
 * WHAT THAT COSTS. The `chromium-mapkit` project has a **live dependency on Apple's CDN** and
 * on a minted MapKit JWT — there is no npm package for MapKit JS and no offline fallback. The
 * default projects do not: `VITE_MAP_VENDOR` defaults to `mapbox`, so the 18-passing run is
 * unchanged. **Putting `chromium-mapkit` in CI needs the `MAPKIT_PRIVATE_KEY` secret plus a
 * minting step, and that is the dispatching session's call, not this file's.**
 *
 * NOT COVERED, and it would be false to claim otherwise: Mapbox remains a live dependency of
 * every default spec — the style, the glyphs and the terrain DEM are all fetched, and
 * `secrets.VITE_MAPBOX_TOKEN` is still required. MEASURED over a full page load, the complete
 * set of external hosts the default suite contacts is exactly
 * `["api.mapbox.com", "events.mapbox.com"]` and nothing else. So this makes the suite
 * CloudKit-independent and deterministic, NOT offline.
 */
const APPLE_HOSTS =
    /^https?:\/\/([\w-]+\.)*(apple-cloudkit\.com|icloud\.com|icloud-content\.com|apple\.com|cdn-apple\.com|apple-mapkit\.com)(:\d+)?(\/|$)/i;

/**
 * The ONLY Apple hosts a spec may legitimately reach, and only because MapKit JS cannot be
 * served any other way. Kept as its own list rather than a hole in `APPLE_HOSTS` so that the
 * exception is visible, enumerable, and asserted against.
 */
const ALLOWED_APPLE_HOSTS = /^https?:\/\/([\w-]+\.)*apple-mapkit\.com(:\d+)?(\/|$)/i;

export const test = base.extend<{ noAppleNetwork: void }>({
    noAppleNetwork: [
        async ({ page }, use) => {
            const blocked: string[] = [];
            const allowed: string[] = [];
            await page.route(APPLE_HOSTS, async (route) => {
                const url = route.request().url();
                if (ALLOWED_APPLE_HOSTS.test(url)) {
                    allowed.push(url);
                    await route.continue();
                    return;
                }
                blocked.push(url);
                await route.abort('blockedbyclient');
            });

            await use();

            expect(
                blocked,
                'The app contacted an Apple host that is not MapKit\'s CDN. In E2E mode ' +
                    'getContainer() must return the local fixture container and never reach ' +
                    'loadCloudKit() or the REST endpoint — a production CloudKit token is ' +
                    'origin-locked to https://akashic.no and 401s from localhost, which is exactly ' +
                    'how QUA-40 turned this gate red.'
            ).toEqual([]);

            // Not an assertion, a measurement: it prints in the run log so anyone reading a CI job can
            // see whether that job had a live Apple dependency, rather than inferring it from the
            // project name.
            if (allowed.length > 0) {
                const hosts = [...new Set(allowed.map((u) => new URL(u).host))].sort();
                console.log(`[network] allowed Apple hosts this test: ${hosts.join(', ')}`);
            }
        },
        { auto: true },
    ],
});

export { expect };
