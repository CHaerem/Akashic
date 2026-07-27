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
 * regain a live dependency — not through a new adapter, not through a stray
 * `cdn.apple-cloudkit.com` script, not through a CKAsset URL that escaped the fixture.
 * It also means an Apple CDN outage can never turn this gate red again.
 *
 * A regex (not a glob) so only matching requests enter a JS handler: every spec waits on
 * a real Mapbox canvas, and routing `**` through Playwright would put a round trip in
 * front of every tile.
 *
 * NOT COVERED, and it would be false to claim otherwise: Mapbox remains a live dependency
 * of all four specs — the style, the glyphs and the terrain DEM are all fetched, and
 * `secrets.VITE_MAPBOX_TOKEN` is still required. MEASURED over a full page load, the
 * complete set of external hosts the suite contacts is exactly
 * `["api.mapbox.com", "events.mapbox.com"]` and nothing else. So this change makes the
 * suite CloudKit-independent and deterministic, NOT offline.
 */
const APPLE_HOSTS =
    /^https?:\/\/([\w-]+\.)*(apple-cloudkit\.com|icloud\.com|icloud-content\.com|apple\.com|cdn-apple\.com)(:\d+)?(\/|$)/i;

export const test = base.extend<{ noAppleNetwork: void }>({
    noAppleNetwork: [
        async ({ page }, use) => {
            const attempted: string[] = [];
            await page.route(APPLE_HOSTS, async (route) => {
                attempted.push(route.request().url());
                await route.abort('blockedbyclient');
            });

            await use();

            expect(
                attempted,
                'The app contacted an Apple host. In E2E mode getContainer() must return the ' +
                    'local fixture container and never reach loadCloudKit() or the REST endpoint — ' +
                    'a production CloudKit token is origin-locked to https://akashic.no and 401s ' +
                    'from localhost, which is exactly how QUA-40 turned this gate red.'
            ).toEqual([]);
        },
        { auto: true },
    ],
});

export { expect };
