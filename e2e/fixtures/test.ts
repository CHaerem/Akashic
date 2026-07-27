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
 * on purpose.
 *
 * ## MAP-05 INVERTED WHAT THAT EXCEPTION MEANS, and this is the important paragraph
 *
 * When MAP-03 wrote the section above, `ALLOWED_APPLE_HOSTS` was a hole opened for exactly one
 * project. The other three ran the Mapbox build and reached no Apple host at all, so the
 * exception was narrow and the 18-passing run was untouched by it.
 *
 * MAP-05 deleted Mapbox. There is no tokenless journey surface any more, so **every project that
 * opens a journey now depends on Apple's CDN and on a minted MapKit JWT**, and
 * `ALLOWED_APPLE_HOSTS` has gone from an exception to the norm. That is a real loss and it is
 * recorded here rather than quietly absorbed: the suite was deterministic and third-party-free
 * apart from Mapbox's tiles, and it is now deterministic and third-party-free apart from Apple's.
 * An Apple CDN outage can turn this gate red, which is precisely the property QUA-40 removed for
 * CloudKit. The mitigation is that it CANNOT go red from an iCloud/CloudKit outage — the hard block
 * below still covers that whole family, and MapKit is a different service from CloudKit.
 *
 * WHAT IS STILL COVERED, unchanged and worth keeping straight: the CloudKit family stays
 * hard-blocked and asserted empty per run, so the fixture container cannot quietly regain a data
 * dependency. That was always the point of this file, and MAP-05 does not weaken it.
 *
 * NOT COVERED, and it would be false to claim otherwise: this makes the suite
 * CloudKit-independent and deterministic, NOT offline. The landing globe alone is genuinely
 * offline — MAP-02 draws it from precached coastline geometry with no token and no tiles — so
 * `app.spec.ts`'s first screen would survive with the network cut. A journey view would not.
 */
const APPLE_HOSTS =
    /^https?:\/\/([\w-]+\.)*(apple-cloudkit\.com|icloud\.com|icloud-content\.com|apple\.com|cdn-apple\.com|apple-mapkit\.com)(:\d+)?(\/|$)/i;

/**
 * The ONLY Apple hosts a spec may legitimately reach, and only because MapKit JS cannot be
 * served any other way. Kept as its own list rather than a hole in `APPLE_HOSTS` so that the
 * allowance is visible, enumerable, and asserted against.
 *
 * Unchanged by MAP-05 — `cdn.apple-mapkit.com` and `sat-cdn.apple-mapkit.com` are still the whole
 * set — but what it MEANS changed; see the header. It is no longer one project's exception.
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
